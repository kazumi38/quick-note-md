import * as vscode from 'vscode';
import { createHash, randomBytes } from 'crypto';
import { ChatDraftStore, ComposerDraft, fingerprint } from './chatDrafts';
import { DocumentStore } from './documents';
import { createChatMessageId, parseChatMarkdown } from './chatMarkdown';
import { renderSafeMarkdown } from './rendering';

type ChatWebviewMessage =
	| { kind: 'ready' | 'newChat' | 'refresh' }
	| { kind: 'selectChat'; chatId: string }
	| { kind: 'openSource'; chatId: string }
	| { kind: 'draftChanged'; draftId: string; revision: number; chatId?: string; sectionId: string; title?: string; markdown: string }
	| { kind: 'send'; operationId: string; draftId: string; revision: number; chatId?: string; sectionId: string; title?: string; markdown: string; retryConflict?: boolean }
	| { kind: 'toggleTask'; operationId: string; chatId: string; messageId: string; taskId: string; checked: boolean; documentVersion: number }
	| { kind: 'recoverDraft'; draftId: string; action: 'restore' | 'discard' }
	| { kind: 'copyDraft'; draftId: string; revision: number };

interface ChatRecord {
	id: string;
	uri: vscode.Uri;
	title: string;
	mtime: number;
	text: string;
	version: number;
	dirty: boolean;
	readOnly: boolean;
	parseState: 'valid' | 'legacy' | 'unsupported';
	issue?: string;
	thread?: NonNullable<ReturnType<typeof parseChatMarkdown>['thread']>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
	return Object.keys(value).every(key => allowed.includes(key));
}

function textField(value: unknown, maxLength: number): value is string {
	return typeof value === 'string' && value.length <= maxLength;
}

function hexId(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

function validRevision(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function failureCode(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	if (/読み取り専用/.test(message)) { return 'readOnly'; }
	if (/未保存/.test(message)) { return 'dirtyDocument'; }
	if (/見つかりません|削除|移動/.test(message)) { return 'missingTarget'; }
	if (/形式|マーカー|安全に追記|安全に更新/.test(message)) { return 'unsupportedFormat'; }
	if (/変更|競合|再読み込み|最新状態/.test(message)) { return 'conflict'; }
	if (/入力してください|空白だけ|不正|できません/.test(message)) { return 'invalidInput'; }
	return 'saveFailed';
}

export function validateChatWebviewMessage(value: unknown): ChatWebviewMessage | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) { return undefined; }
	const message = value as Record<string, unknown>;
	if (typeof message.kind !== 'string') { return undefined; }
	switch (message.kind) {
		case 'ready':
		case 'newChat':
		case 'refresh':
			return exactKeys(message, ['kind']) ? { kind: message.kind } : undefined;
		case 'selectChat':
		case 'openSource':
			return exactKeys(message, ['kind', 'chatId']) && hexId(message.chatId)
				? { kind: message.kind, chatId: message.chatId } : undefined;
		case 'draftChanged':
			return exactKeys(message, ['kind', 'draftId', 'revision', 'chatId', 'sectionId', 'title', 'markdown']) &&
				hexId(message.draftId) && validRevision(message.revision) &&
				(message.chatId === undefined || hexId(message.chatId)) &&
				textField(message.sectionId, 32) && (message.title === undefined || textField(message.title, 512)) &&
				textField(message.markdown, 32000)
				? {
					kind: 'draftChanged', draftId: message.draftId, revision: message.revision as number,
					chatId: message.chatId as string | undefined, sectionId: message.sectionId,
					title: message.title as string | undefined, markdown: message.markdown
				} : undefined;
		case 'send':
			return exactKeys(message, ['kind', 'operationId', 'draftId', 'revision', 'chatId', 'sectionId', 'title', 'markdown', 'retryConflict']) &&
				textField(message.operationId, 64) && hexId(message.draftId) &&
				validRevision(message.revision) && (message.chatId === undefined || hexId(message.chatId)) &&
				(message.retryConflict === undefined || typeof message.retryConflict === 'boolean') &&
				textField(message.sectionId, 32) && (message.title === undefined || textField(message.title, 512)) &&
				textField(message.markdown, 32000)
				? {
					kind: 'send', operationId: message.operationId, draftId: message.draftId,
					revision: message.revision as number, chatId: message.chatId as string | undefined,
					sectionId: message.sectionId, title: message.title as string | undefined, markdown: message.markdown,
					retryConflict: message.retryConflict as boolean | undefined
				} : undefined;
		case 'toggleTask':
			return exactKeys(message, ['kind', 'operationId', 'chatId', 'messageId', 'taskId', 'checked', 'documentVersion']) &&
				textField(message.operationId, 64) && hexId(message.chatId) &&
				hexId(message.messageId) && typeof message.taskId === 'string' &&
				/^[0-9a-f]{32}:\d+$/.test(message.taskId) &&
				typeof message.checked === 'boolean' && validRevision(message.documentVersion)
				? {
					kind: 'toggleTask', operationId: message.operationId, chatId: message.chatId,
					messageId: message.messageId, taskId: message.taskId, checked: message.checked,
					documentVersion: message.documentVersion as number
				} : undefined;
		case 'recoverDraft':
			return exactKeys(message, ['kind', 'draftId', 'action']) && hexId(message.draftId) &&
				(message.action === 'restore' || message.action === 'discard')
				? { kind: 'recoverDraft', draftId: message.draftId, action: message.action } : undefined;
		case 'copyDraft':
			return exactKeys(message, ['kind', 'draftId', 'revision']) && hexId(message.draftId) &&
				validRevision(message.revision)
				? { kind: 'copyDraft', draftId: message.draftId, revision: message.revision as number } : undefined;
		default:
			return undefined;
	}
}

export class ChatView implements vscode.WebviewViewProvider, vscode.Disposable {
	static readonly viewType = 'quick-note-md.chat';
	private view: vscode.WebviewView | undefined;
	private generation = 0;
	private disposed = false;
	private chats = new Map<string, ChatRecord>();
	private selectedChat: string | undefined;
	private activeDraft: ComposerDraft | undefined;
	private recovery: Array<{ draft: ComposerDraft; conflict: boolean }> = [];
	private draftErrors: string[] = [];
	private inFlight = new Set<string>();
	private sendingDrafts = new Set<string>();
	private draftQueues = new Map<string, Promise<void>>();
	private readonly drafts: ChatDraftStore;

	constructor(private readonly context: vscode.ExtensionContext, private readonly store: DocumentStore) {
		this.drafts = new ChatDraftStore(vscode.Uri.joinPath(context.globalStorageUri, 'chat-drafts'));
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
		};
		view.webview.html = this.html(view.webview);
		view.webview.onDidReceiveMessage((message: unknown) => {
			void this.handle(message).catch(error => this.report(error));
		});
		void this.refresh();
	}
	async revealAndStartNewChat(): Promise<void> {
		await vscode.commands.executeCommand('workbench.view.extension.quick-note-md');
		if (this.view) { await this.refresh(); }
		await this.startNewChat();
	}

	async startNewChat(): Promise<void> {
		this.selectedChat = undefined;
		this.activeDraft = {
			schemaVersion: 1, draftId: randomBytes(16).toString('hex'),
			target: { sectionId: '本文' }, title: '', markdown: '', baseFingerprint: null,
			revision: 0, updatedAt: Date.now()
		};
		await this.publish(++this.generation);
	}

	private chatId(uri: vscode.Uri): string {
		return createHash('sha256').update(uri.toString()).digest('hex').slice(0, 32);
	}

	async refresh(): Promise<void> {
		if (this.disposed) { return; }
		const generation = ++this.generation;
		await this.post({ kind: 'snapshot', generation, state: 'loading', chats: [] });
		if (!vscode.workspace.workspaceFolders?.length) {
			this.chats.clear();
			this.activeDraft = undefined;
			const stored = await this.drafts.list();
			this.draftErrors = stored.errors;
			this.recovery = stored.drafts.map(draft => ({ draft, conflict: draft.target.chatId !== undefined }));
			await this.post({
				kind: 'snapshot', generation, state: 'unavailable', chats: [],
				error: ['ワークスペース フォルダーを開いてください。', ...this.draftErrors].join('\n'),
				recovery: this.recovery.map(({ draft, conflict }) => ({
					draftId: draft.draftId, title: draft.title, markdown: draft.markdown,
					revision: draft.revision, conflict
				}))
			});
			return;
		}
		const records = new Map<string, ChatRecord>();
		const errors: string[] = [];
		let files: Awaited<ReturnType<DocumentStore['list']>> = [];
		try { files = await this.store.list(); } catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
		for (const file of files) {
			try {
				const opened = await this.store.readChat(file.uri);
				const parsed = parseChatMarkdown(opened.text);
				const id = this.chatId(file.uri);
				records.set(id, {
					id, uri: file.uri, title: parsed.thread?.title ?? file.title, mtime: file.mtime,
					text: opened.text, version: opened.version, dirty: opened.dirty, readOnly: opened.readOnly,
					parseState: parsed.state, issue: parsed.issue, thread: parsed.thread
				});
			} catch (error) {
				errors.push(error instanceof Error ? error.message : String(error));
			}
		}
		if (this.disposed || generation !== this.generation) { return; }
		this.chats = records;
		if (!this.selectedChat || !records.has(this.selectedChat)) {
			this.selectedChat = this.activeDraft && !this.activeDraft.target.chatId
				? undefined : records.keys().next().value;
		}
		const stored = await this.drafts.list();
		this.draftErrors = [...stored.errors];
		this.recovery = stored.drafts
			.filter(draft => draft.draftId !== this.activeDraft?.draftId)
			.map(draft => {
				const target = draft.target.chatId ? records.get(draft.target.chatId) : undefined;
				const conflict = draft.target.chatId !== undefined &&
					(!target || fingerprint(target.text) !== draft.baseFingerprint);
				return { draft, conflict };
			});
		await this.publish(generation, errors.length ? errors.join('\n') : this.draftErrors.join('\n'));
	}

	private async publish(generation: number, error?: string): Promise<void> {
		const chats = [...this.chats.values()].sort((a, b) =>
			b.mtime - a.mtime || a.uri.toString().localeCompare(b.uri.toString()));
		const selected = this.selectedChat ? this.chats.get(this.selectedChat) : undefined;
		const state = error ? 'error' : chats.length || this.activeDraft ? 'ready' : 'empty';
		const thread = selected?.thread ? {
			title: selected.thread.title,
			sections: selected.thread.sections.map(section => ({
				id: section.id,
				name: section.name,
				messages: section.messages.map(message => ({
					id: message.id,
					timestamp: message.timestamp,
					html: renderSafeMarkdown(message.bodyMarkdown),
					tasks: message.tasks.map(task => ({ id: task.id, checked: task.checked, status: task.status }))
				}))
			}))
		} : undefined;
		const selectedDraft = this.activeDraft ?? (selected ? this.findDraftFor(selected.id) : undefined);
		if (selectedDraft && !this.activeDraft) { this.activeDraft = selectedDraft; }
		const draftConflict = Boolean(selectedDraft?.target.chatId && selected &&
			selectedDraft.target.chatId === selected.id &&
			selectedDraft.baseFingerprint !== fingerprint(selected.text));
		await this.post({
			kind: 'snapshot',
			generation,
			state,
			error: error || (draftConflict ? 'チャットが下書き作成後に変更されています。下書きをコピーして原文を確認してください。'
				: selected?.issue ? `${selected.issue} 原文を開いて確認してください。`
					: selected?.parseState === 'legacy' ? '旧形式のチャットは読み取り専用です。原文を確認してください。' : undefined),
			chats: chats.map(chat => ({
				id: chat.id, title: chat.title, dirty: chat.dirty, readOnly: chat.readOnly, parseState: chat.parseState
			})),
			selectedChat: this.selectedChat,
			documentVersion: selected?.version,
			selectedDirty: selected?.dirty ?? false,
			selectedReadOnly: selected?.readOnly ?? false,
			selectedParseState: selected?.parseState,
			draftConflict,
			thread,
			activeDraft: selectedDraft ? {
				draftId: selectedDraft.draftId,
				chatId: selectedDraft.target.chatId,
				sectionId: selectedDraft.target.sectionId,
				title: selectedDraft.title,
				markdown: selectedDraft.markdown,
				revision: selectedDraft.revision
			} : undefined,
			recovery: this.recovery.filter(({ draft }) => draft.draftId !== selectedDraft?.draftId).map(({ draft, conflict }) => ({
				draftId: draft.draftId, title: draft.title, markdown: draft.markdown,
				revision: draft.revision, conflict
			}))
		});
	}

	private findDraftFor(chatId: string): ComposerDraft | undefined {
		const existing = this.recovery.find(entry =>
			entry.draft.target.chatId === chatId && entry.draft.target.sectionId === '返信' && !entry.conflict);
		if (existing) { return existing.draft; }
		const chat = this.chats.get(chatId);
		if (!chat) { return undefined; }
		return {
			schemaVersion: 1,
			draftId: randomBytes(16).toString('hex'),
			target: { chatId, sectionId: '返信' },
			markdown: '',
			baseFingerprint: fingerprint(chat.text),
			revision: 0,
			updatedAt: Date.now()
		};
	}

	private async post(message: unknown): Promise<void> {
		await this.view?.webview.postMessage(message);
	}

	private async enqueueDraft(draftId: string, action: () => Promise<void>): Promise<void> {
		const previous = this.draftQueues.get(draftId) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(action);
		this.draftQueues.set(draftId, next);
		void next.finally(() => {
			if (this.draftQueues.get(draftId) === next) { this.draftQueues.delete(draftId); }
		}).catch(() => undefined);
		return next;
	}

	private async result(operationId: string, operation: string, action: () => Promise<string | undefined>): Promise<void> {
		if (this.inFlight.has(operationId)) {
			await this.post({ kind: 'operationResult', operationId, operation, ok: false, code: 'invalidInput', message: 'この操作はすでに処理中です。' });
			return;
		}
		this.inFlight.add(operationId);
		try {
			const message = await action();
			await this.post({ kind: 'operationResult', operationId, operation, ok: true, message });
			try { await this.refresh(); } catch (error) { await this.report(error); }
		} catch (error) {
			try { await this.refresh(); } catch (refreshError) { await this.report(refreshError); }
			await this.post({
				kind: 'operationResult', operationId, operation, ok: false, code: failureCode(error),
				message: error instanceof Error ? error.message : String(error)
			});
		} finally {
			this.inFlight.delete(operationId);
		}
	}

	private async handle(raw: unknown): Promise<void> {
		const message = validateChatWebviewMessage(raw);
		if (!message) { return; }
		switch (message.kind) {
			case 'ready':
			case 'refresh':
				await this.refresh();
				return;
			case 'newChat':
				await this.startNewChat();
				return;
			case 'selectChat': {
				if (!this.chats.has(message.chatId)) { await this.refresh(); return; }
				this.selectedChat = message.chatId;
				this.activeDraft = this.findDraftFor(message.chatId);
				await this.publish(++this.generation);
				return;
			}
			case 'openSource': {
				const chat = this.chats.get(message.chatId);
				if (!chat) { throw new Error('対象のチャットがありません。'); }
				await vscode.window.showTextDocument(chat.uri);
				return;
			}
			case 'draftChanged': {
				if (!this.activeDraft || message.draftId !== this.activeDraft.draftId ||
					message.chatId !== this.activeDraft.target.chatId ||
					message.sectionId !== this.activeDraft.target.sectionId) { return; }
				if (message.revision <= this.activeDraft.revision) { return; }
				const next: ComposerDraft = {
					...this.activeDraft,
					title: message.title ?? this.activeDraft.title,
					markdown: message.markdown,
					revision: message.revision,
					updatedAt: Date.now()
				};
				this.activeDraft = next;
				await this.enqueueDraft(next.draftId, () => this.drafts.save(next));
				await this.post({ kind: 'draftAck', draftId: next.draftId, revision: next.revision, state: 'saved' });
				return;
			}
			case 'send': {
				if (this.sendingDrafts.has(message.draftId)) {
					await this.post({
						kind: 'operationResult', operationId: message.operationId, operation: 'send',
						ok: false, code: 'invalidInput', message: 'この下書きはすでに送信中です。'
					});
					return;
				}
				this.sendingDrafts.add(message.draftId);
				try {
					await this.result(message.operationId, 'send', async () => {
					const active = this.activeDraft;
					if (!active || active.draftId !== message.draftId || active.revision !== message.revision ||
						active.target.chatId !== message.chatId || active.target.sectionId !== message.sectionId ||
						active.markdown !== message.markdown || (active.title ?? '') !== (message.title ?? '')) {
						throw new Error('下書きが更新されました。最新の内容を確認してください。');
					}
					if (!message.markdown.trim()) { throw new Error('空白だけのメッセージは送信できません。'); }
					const now = new Date();
					const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
					const id = createChatMessageId();
					if (!message.chatId) {
						if (message.retryConflict) { throw new Error('新しいチャットには競合再試行を指定できません。'); }
						const title = active.title ?? '';
						const uri = await this.store.createChat(title, timestamp, message.markdown, id);
						this.selectedChat = this.chatId(uri);
					} else {
						const chat = this.chats.get(message.chatId);
						if (!chat) { throw new Error('対象のチャットが見つかりません。最新状態を再読み込みしてください。'); }
						if (chat.parseState !== 'valid') {
							throw new Error(chat.issue ?? 'このチャット形式には安全に追記できません。');
						}
						if (chat.dirty) { throw new Error('原文に未保存の変更があります。保存してから再送信してください。'); }
						if (chat.readOnly) { throw new Error('チャットは読み取り専用です。'); }
						if (active.baseFingerprint !== fingerprint(chat.text) && !message.retryConflict) {
							throw new Error('チャットが下書き作成後に変更されました。下書きをコピーして原文を確認してください。');
						}
						await this.store.appendChatMessage(chat.uri, message.sectionId, timestamp, message.markdown, id, chat.version);
					}
					if (this.activeDraft?.draftId === message.draftId && this.activeDraft.revision === message.revision) {
						try {
							await this.enqueueDraft(message.draftId, async () => {
								if (this.activeDraft?.draftId !== message.draftId ||
									this.activeDraft.revision !== message.revision) { return; }
								await this.drafts.remove(message.draftId);
								if (this.activeDraft?.draftId === message.draftId &&
									this.activeDraft.revision === message.revision) { this.activeDraft = undefined; }
							});
						} catch {
							if (this.activeDraft?.draftId === message.draftId &&
								this.activeDraft.revision === message.revision) {
								this.activeDraft = undefined;
							}
							return 'メッセージは保存されましたが、下書きの整理に失敗しました。重複送信せず、下書きを確認してください。';
						}
					}
					return undefined;
					});
				} finally {
					this.sendingDrafts.delete(message.draftId);
				}
				return;
			}
			case 'toggleTask': {
				await this.result(message.operationId, 'toggleTask', async () => {
					const chat = this.chats.get(message.chatId);
					if (!chat || chat.dirty || chat.readOnly || chat.parseState !== 'valid') {
						throw new Error(chat?.dirty ? '原文に未保存の変更があります。保存してから再試行してください。'
							: chat?.readOnly ? 'チャットは読み取り専用です。' : 'チャットを安全に更新できません。');
					}
					await this.store.toggleChatTask(chat.uri, message.messageId, message.taskId, message.checked, message.documentVersion);
				});
				return;
			}
			case 'recoverDraft': {
				const entry = this.recovery.find(item => item.draft.draftId === message.draftId);
				if (!entry) { throw new Error('復旧する下書きが見つかりません。'); }
				if (message.action === 'discard') {
					await this.drafts.remove(message.draftId);
					this.recovery = this.recovery.filter(item => item.draft.draftId !== message.draftId);
				} else {
					const draft = entry.draft;
					if (entry.conflict && (!draft.target.chatId || !this.chats.has(draft.target.chatId))) {
						throw new Error('元のチャットが見つかりません。下書きをコピーして原文を確認してください。');
					}
					this.activeDraft = draft;
					this.selectedChat = draft.target.chatId;
				}
				await this.publish(++this.generation);
				return;
			}
			case 'copyDraft': {
				const draft = this.activeDraft?.draftId === message.draftId ? this.activeDraft
					: this.recovery.find(item => item.draft.draftId === message.draftId)?.draft;
				if (!draft || draft.revision !== message.revision) { throw new Error('コピー対象の下書きが更新されています。'); }
				await vscode.env.clipboard.writeText(draft.markdown);
				await this.post({ kind: 'operationResult', operation: 'copyDraft', ok: true, message: '下書きをコピーしました。' });
				return;
			}
		}
	}

	private async report(error: unknown): Promise<void> {
		const message = error instanceof Error ? error.message : String(error);
		await vscode.window.showErrorMessage(message);
		await this.post({ kind: 'operationResult', operation: 'error', ok: false, code: 'saveFailed', message });
	}

	private html(webview: vscode.Webview): string {
		const nonce = randomBytes(16).toString('hex');
		const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'chat.js'));
		const style = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'chat.css'));
		return `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${style}"></head><body><main id="app" aria-label="QuickNoteMD チャット"></main><script nonce="${nonce}" src="${script}"></script></body></html>`;
	}

	dispose(): void {
		this.disposed = true;
		this.view = undefined;
	}
}
