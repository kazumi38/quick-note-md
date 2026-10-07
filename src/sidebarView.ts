import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { statusInfo, statusOrder, TodoStatus } from './core';
import { labelColor, labelPalette, setLabelColor } from './configuration';
import { maxEditLength, renderSafeMarkdown } from './rendering';
import { DocumentStore, MemoRef, TodoRef } from './documents';
import { DraftKind, DraftStore } from './drafts';
import { DraftManager, ReconciledDraft } from './draftManager';

interface DraftView { state: 'dirty' | 'conflict'; text?: string; labels?: string[]; dueDate?: string }

function record(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

export type DueState = 'overdue' | 'upcoming' | 'none';

/**
 * Local-calendar due-date urgency: overdue only when not done and strictly before today;
 * upcoming within the next 3 days; done Todos are never flagged overdue or upcoming.
 */
export function computeDueState(dueDate: string | undefined, status: TodoStatus, today = new Date()): DueState {
	if (!dueDate || status === 'done') { return 'none'; }
	const calendarDay = (date: Date): string =>
		`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
	const todayIso = calendarDay(today);
	if (dueDate < todayIso) { return 'overdue'; }
	const upcoming = new Date(today); upcoming.setDate(upcoming.getDate() + 3);
	return dueDate <= calendarDay(upcoming) ? 'upcoming' : 'none';
}

/** Every message the webview can send; unknown/malformed shapes are ignored rather than trusted. */
type SidebarMessage =
	| { kind: 'ready' }
	| { kind: 'startCreate'; itemKind: 'memo' | 'todo' }
	| { kind: 'createIssue'; itemKind: 'memo' | 'todo'; title: string; bodyMarkdown: string; requestId: string }
	| { kind: 'saveIssue'; itemId: string; field: 'title' | 'body' | 'labels' | 'comment' | 'status'; value: string | string[]; commentId?: string; requestId: string }
	| { kind: 'deleteIssueComment'; itemId: string; commentId: string; requestId: string }
	| { kind: 'newMemo' }
	| { kind: 'newTodo' }
	| { kind: 'refresh' }
	| { kind: 'source'; id: string }
	| { kind: 'openFile'; fileUri: string }
	| { kind: 'setStatus'; id: string; status: string }
	| { kind: 'saveBody'; id: string; text: string }
	| { kind: 'discardBody'; id: string }
	| { kind: 'draftBody'; id: string; text: string }
	| { kind: 'previewBody'; id: string; text: string }
	| { kind: 'saveAttributes'; id: string; labels: string[]; dueDate?: string }
	| { kind: 'discardAttributes'; id: string }
	| { kind: 'draftAttributes'; id: string; labels: string[]; dueDate?: string }
	| { kind: 'saveReply'; id: string; replyId?: string; text: string }
	| { kind: 'discardReply'; id: string; replyId?: string }
	| { kind: 'draftReply'; id: string; replyId?: string; text: string }
	| { kind: 'previewReply'; id: string; replyId?: string; text: string }
	| { kind: 'deleteReply'; id: string; replyId: string }
	| { kind: 'deleteTodo'; id: string }
	| { kind: 'setLabelColor'; label: string; color: string }
	| { kind: 'discardOrphan'; backupKey: string };

export class SidebarView implements vscode.Disposable {
	public static readonly viewType = 'quick-note-md.issue';
	private panel: vscode.WebviewPanel | undefined;
	private panelReady = false;
	private pendingCreate: 'memo' | 'todo' | undefined;
	private todos: TodoRef[] = [];
	private memos: MemoRef[] = [];
	private disposed = false;
	private generation = 0;
	private readonly drafts: DraftManager;
	private readonly draftStore: DraftStore;

	constructor(private readonly context: vscode.ExtensionContext, private readonly store: DocumentStore) {
		this.draftStore = new DraftStore(vscode.Uri.joinPath(context.globalStorageUri, 'sidebar-drafts'));
		this.drafts = new DraftManager(this.draftStore);
	}

	async reveal(): Promise<void> {
		if (this.disposed) { throw new Error('メモと Todo の画面は利用できません。'); }
		if (!this.panel) {
			const panel = vscode.window.createWebviewPanel(
				SidebarView.viewType,
				'メモと Todo',
				vscode.ViewColumn.One,
				{
					enableScripts: true,
					retainContextWhenHidden: true,
					localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
				},
			);
			this.panel = panel;
			this.panelReady = false;
			panel.webview.html = this.html(panel.webview);
			panel.webview.onDidReceiveMessage(message => void this.message(message));
			panel.onDidDispose(() => {
				if (this.panel === panel) {
					this.panel = undefined;
					this.panelReady = false;
					this.pendingCreate = undefined;
				}
			});
		}
		this.panel.reveal(vscode.ViewColumn.One);
		void this.refresh();
	}

	async revealAndStartCreate(itemKind: 'memo' | 'todo'): Promise<void> {
		const waitingForWebview = !this.panel || !this.panelReady;
		if (waitingForWebview) { this.pendingCreate = itemKind; }
		await this.reveal();
		if (!waitingForWebview) {
			await this.panel?.webview.postMessage({ kind: 'openCreatePanel', itemKind });
		}
	}

	async refresh(): Promise<void> {
		if (this.disposed) { return; }
		const generation = ++this.generation;
		this.todos = [];
		this.memos = [];
		await this.panel?.webview.postMessage({
			kind: 'snapshot', state: 'loading', files: [], todos: [], issues: [], orphans: [], labelPalette: [],
		});
		if (this.disposed || generation !== this.generation) { return; }
		if (!vscode.workspace.workspaceFolders?.length) {
			await this.panel?.webview.postMessage({
				kind: 'snapshot', state: 'unavailable', error: 'ワークスペース フォルダーを開いてください。',
				files: [], todos: [], issues: [], orphans: [], labelPalette: [...labelPalette],
			});
			return;
		}

		const [todoResult, fileResult, memoResult] = await Promise.allSettled([this.store.todos(), this.store.list(), this.store.memos()]);
		if (this.disposed || generation !== this.generation) { return; }
		this.todos = todoResult.status === 'fulfilled' ? todoResult.value : [];
		this.memos = memoResult.status === 'fulfilled' ? memoResult.value : [];
		const files = fileResult.status === 'fulfilled' ? fileResult.value : [];
		const errors = [
			...(todoResult.status === 'rejected' ? [todoResult.reason] : []),
			...(fileResult.status === 'rejected' ? [fileResult.reason] : []),
			...(memoResult.status === 'rejected' ? [memoResult.reason] : []),
		];
		const error = errors.map(reason => reason instanceof Error ? reason.message : '一覧を読み込めませんでした。').join('\n');
		let reconciled: ReconciledDraft[] = [];
		try { reconciled = await this.drafts.reconcile(this.todos, todo => this.id(todo)); } catch { reconciled = []; }
		const draftsById = new Map<string, DraftView>();
		const orphans: { backupKey: string; kind: DraftKind; text?: string; labels?: string[]; dueDate?: string }[] = [];
		for (const entry of reconciled) {
			if (!entry.todoKey) {
				orphans.push({
					backupKey: entry.snapshot.backupKey, kind: entry.snapshot.kind,
					text: entry.snapshot.text, labels: entry.snapshot.labels, dueDate: entry.snapshot.dueDate,
				});
				continue;
			}
			const key = `${entry.todoKey}::${entry.snapshot.kind}::${entry.snapshot.replyId ?? ''}`;
			draftsById.set(key, {
				state: entry.state, text: entry.snapshot.text, labels: entry.snapshot.labels, dueDate: entry.snapshot.dueDate,
			});
		}
		const viewState = errors.length ? 'error' : files.length || this.todos.length || this.memos.length ? 'ready' : 'empty';
		const displayFiles = new Map(files.map(file => [file.uri.toString(), file]));
		for (const todo of this.todos) {
			const uri = todo.uri.toString();
			if (!displayFiles.has(uri)) {
				displayFiles.set(uri, {
					uri: todo.uri,
					title: todo.uri.path.split('/').pop()?.replace(/\.md$/i, '') || todo.uri.fsPath,
					mtime: 0,
				});
			}
		}
		const snapshot = {
			state: viewState,
			error: error || undefined,
			labelPalette: [...labelPalette],
			files: [...displayFiles.values()].map(file => ({ uri: file.uri.toString(), title: file.title })),
			todos: this.todos.map(todo => {
				const id = this.id(todo);
				const replies = (todo.comments?.comments ?? []).map(reply => ({
					id: reply.id, text: reply.bodyMarkdown, html: renderSafeMarkdown(reply.bodyMarkdown),
					draft: draftsById.get(`${id}::reply::${reply.id}`),
				}));
				return {
					id, fileUri: todo.uri.toString(), status: todo.status, statusLabel: statusInfo[todo.status].label,
					title: todo.text, labels: (todo.labels ?? []).map(name => ({ name, color: labelColor(name) })),
					dueDate: todo.dueDate,
					dueState: computeDueState(todo.dueDate, todo.status),
					bodyMarkdown: todo.bodyMarkdown, bodyHtml: todo.bodyMarkdown ? renderSafeMarkdown(todo.bodyMarkdown) : '',
					replies, readOnly: Boolean(todo.readOnly) || todo.status === 'unknown', warning: todo.warning,
					bodyDraft: draftsById.get(`${id}::body::`),
					attributesDraft: draftsById.get(`${id}::attributes::`),
					newReplyDraft: draftsById.get(`${id}::reply::`),
				};
			}),
			issues: [
				...this.memos.map(memo => ({
					id: this.memoId(memo), selectionKey: this.memoId(memo), kind: 'memo', fileTitle: memo.title, title: memo.title,
					bodyMarkdown: memo.descriptionMarkdown, bodyHtml: renderSafeMarkdown(memo.descriptionMarkdown),
					labels: memo.labels.map(name => ({ name, color: labelColor(name) })),
					comments: memo.comments.map(comment => ({
						id: comment.id, text: comment.bodyMarkdown, html: renderSafeMarkdown(comment.bodyMarkdown),
					})),
					readOnly: memo.readOnly, warning: memo.warning, version: memo.version,
				})),
				...this.todos.map(todo => ({
					id: this.id(todo), selectionKey: `${todo.uri.toString()}::${todo.line}`,
					kind: 'todo', fileTitle: todo.uri.path.split('/').pop()?.replace(/\.md$/i, '') ?? '',
					title: todo.text, status: todo.status, statusLabel: statusInfo[todo.status].label,
					bodyMarkdown: todo.bodyMarkdown ?? '', bodyHtml: todo.bodyMarkdown ? renderSafeMarkdown(todo.bodyMarkdown) : '',
					labels: (todo.labels ?? []).map(name => ({ name, color: labelColor(name) })),
					comments: (todo.comments?.comments ?? []).map(comment => ({
						id: comment.id, text: comment.bodyMarkdown, html: renderSafeMarkdown(comment.bodyMarkdown),
					})),
					readOnly: Boolean(todo.readOnly) || todo.status === 'unknown', warning: todo.warning, version: todo.version,
				})),
			],
			orphans,
		};
		if (this.disposed || generation !== this.generation) { return; }
		await this.panel?.webview.postMessage({ kind: 'snapshot', ...snapshot });
	}

	private id(todo: TodoRef): string {
		return `${todo.uri.toString()}::${todo.line}::${todo.raw}`;
	}

	private memoId(memo: MemoRef): string { return `${memo.uri.toString()}::memo`; }

	private findMemo(id: unknown): MemoRef | undefined {
		return typeof id === 'string' && id.length <= 4096 ? this.memos.find(candidate => this.memoId(candidate) === id) : undefined;
	}

	private async issueOperation(requestId: string, action: () => Promise<unknown>): Promise<void> {
		try {
			const result = await action();
			await this.panel?.webview.postMessage({
				kind: 'issueResult', requestId, success: true,
				selectionKey: typeof result === 'string' ? result : undefined,
			});
		} catch (error) {
			await this.panel?.webview.postMessage({
				kind: 'issueResult', requestId, success: false,
				error: error instanceof Error ? error.message : '操作を完了できませんでした。',
			});
		} finally {
			await this.refresh();
		}
	}

	private find(id: unknown): TodoRef | undefined {
		return typeof id === 'string' && id.length <= 4096 ? this.todos.find(candidate => this.id(candidate) === id) : undefined;
	}

	private async notify(action: () => Promise<unknown>): Promise<boolean> {
		try {
			await action();
			return true;
		} catch (error) {
			await vscode.window.showErrorMessage(error instanceof Error ? error.message : '操作を完了できませんでした。');
			return false;
		} finally {
			await this.refresh();
		}
	}

	private async finishDraftAction(field: DraftKind, todo: TodoRef, action: 'save' | 'discard',
		operation: () => Promise<unknown>, replyId?: string): Promise<void> {
		const success = await this.notify(operation);
		await this.panel?.webview.postMessage({ kind: 'draftResult', field, id: this.id(todo), replyId, action, success });
	}

	private async changeDraft(todo: TodoRef, kind: DraftKind,
		value: { text?: string; labels?: string[]; dueDate?: string }, replyId?: string): Promise<void> {
		try {
			await this.drafts.change(todo, kind, value, replyId);
		} catch (error) {
			await vscode.window.showErrorMessage(`下書きを保存できませんでした: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async message(value: unknown): Promise<void> {
		if (!record(value)) { return; }
		const message = value as SidebarMessage;
		if (message.kind === 'createIssue') {
			if (!exactKeys(value, ['kind', 'itemKind', 'title', 'bodyMarkdown', 'requestId']) ||
				!['memo', 'todo'].includes(String(value.itemKind)) || typeof value.title !== 'string' ||
				value.title.length > 220 || typeof value.bodyMarkdown !== 'string' || value.bodyMarkdown.length > maxEditLength ||
				typeof value.requestId !== 'string' || !/^[\w-]{1,100}$/.test(value.requestId)) { return; }
			await this.issueOperation(value.requestId, async () => value.itemKind === 'memo'
				? `${(await this.store.createMemoWithBody(value.title as string, value.bodyMarkdown as string)).toString()}::memo`
				: this.store.createTodoWithBody(value.title as string, value.bodyMarkdown as string));
			return;
		}
		if (message.kind === 'saveIssue') {
			const keys = Object.keys(value).sort();
			const allowed = ['commentId', 'field', 'itemId', 'kind', 'requestId', 'value'];
			if (keys.some(key => !allowed.includes(key)) || !['kind', 'field', 'itemId', 'requestId', 'value'].every(key => keys.includes(key)) ||
				typeof value.itemId !== 'string' || value.itemId.length > 4096 ||
				typeof value.requestId !== 'string' || !/^[\w-]{1,100}$/.test(value.requestId) ||
				typeof value.field !== 'string' || !['title', 'body', 'labels', 'comment', 'status'].includes(value.field) ||
				(typeof value.value !== 'string' && !Array.isArray(value.value)) ||
				(typeof value.value === 'string' && value.value.length > maxEditLength) ||
				(Array.isArray(value.value) && (value.value.length > 100 || value.value.some(label => typeof label !== 'string' || label.length > 256))) ||
				(value.commentId !== undefined && (typeof value.commentId !== 'string' || value.commentId.length > 200))) { return; }
			const memo = this.findMemo(value.itemId);
			const todo = this.find(value.itemId);
			if (!memo && !todo) { return; }
			await this.issueOperation(value.requestId, async () => {
				const issueLabels = (): string[] => {
					if (!Array.isArray(value.value) || !value.value.every(label => typeof label === 'string')) {
						throw new Error('ラベルの形式が不正です。');
					}
					const labels = value.value.map(label => label.trim());
					if (labels.some(label => !label) || new Set(labels).size !== labels.length) {
						throw new Error('ラベルは空欄にできず、同じ名前を重複して登録できません。');
					}
					return labels;
				};
				if (memo) {
					if (value.field === 'title' && typeof value.value === 'string') {
						return `${(await this.store.renameMemo(memo, value.value)).toString()}::memo`;
					}
					if (value.field === 'body' && typeof value.value === 'string') { await this.store.editMemoBody(memo, value.value); return; }
					if (value.field === 'labels') {
						await this.store.setMemoLabels(memo, issueLabels()); return;
					}
					if (value.field === 'comment' && typeof value.value === 'string') {
						if (typeof value.commentId === 'string') { await this.store.editMemoComment(memo, value.commentId, value.value); }
						else { await this.store.addMemoComment(memo, value.value); }
						return;
					}
					throw new Error('メモでは利用できない操作です。');
				}
				if (!todo) { throw new Error('対象のTodoが見つかりません。'); }
				if (value.field === 'title' && typeof value.value === 'string') { await this.store.editTodoTitle(todo, value.value); return; }
				if (value.field === 'body' && typeof value.value === 'string') { await this.store.editTodoBody(todo, value.value); return; }
				if (value.field === 'labels') {
					await this.store.setTodoMetadata(todo, issueLabels(), todo.dueDate); return;
				}
				if (value.field === 'comment' && typeof value.value === 'string') {
					if (typeof value.commentId === 'string') { await this.store.editTodoComment(todo, value.commentId, value.value); }
					else { await this.store.addTodoComment(todo, value.value); }
					return;
				}
				if (value.field === 'status' && typeof value.value === 'string' &&
					statusOrder.includes(value.value as TodoStatus) && value.value !== 'unknown') {
					await this.store.setStatus(todo, value.value as Exclude<TodoStatus, 'unknown'>); return;
				}
				throw new Error('Todoでは利用できない操作です。');
			});
			return;
		}
		if (message.kind === 'deleteIssueComment') {
			if (!exactKeys(value, ['kind', 'itemId', 'commentId', 'requestId']) ||
				typeof value.itemId !== 'string' || value.itemId.length > 4096 ||
				typeof value.commentId !== 'string' || value.commentId.length > 200 ||
				typeof value.requestId !== 'string' || !/^[\w-]{1,100}$/.test(value.requestId)) { return; }
			const memo = this.findMemo(value.itemId);
			const todo = this.find(value.itemId);
			if (!memo && !todo) { return; }
			await this.issueOperation(value.requestId, async () => {
				if (memo) { await this.store.deleteMemoComment(memo, value.commentId as string); }
				else if (todo) { await this.store.deleteTodoComment(todo, value.commentId as string); }
			});
			return;
		}
		if (message.kind === 'ready') {
			this.panelReady = true;
			await this.refresh();
			if (this.pendingCreate) {
				await this.panel?.webview.postMessage({ kind: 'openCreatePanel', itemKind: this.pendingCreate });
				this.pendingCreate = undefined;
			}
			return;
		}
		if (message.kind === 'newMemo' || message.kind === 'newTodo') {
			await vscode.commands.executeCommand(`quick-note-md.${message.kind}`);
			return;
		}
		if (message.kind === 'refresh') {
			await vscode.commands.executeCommand('quick-note-md.refresh');
			return;
		}
		if (message.kind === 'openFile') {
			if (typeof message.fileUri !== 'string') { return; }
			await vscode.commands.executeCommand('quick-note-md.openMemo', vscode.Uri.parse(message.fileUri));
			return;
		}
		if (message.kind === 'discardOrphan') {
			if (typeof message.backupKey !== 'string') { return; }
			await this.notify(async () => this.draftStore.remove(message.backupKey));
			return;
		}
		const todo = this.find((message as { id?: unknown }).id);
		if (!todo) { return; }
		if (message.kind === 'source') { await vscode.commands.executeCommand('quick-note-md.showSource', todo.uri); return; }
		if (message.kind === 'setStatus') {
			const status = message.status as TodoStatus;
			if (!statusOrder.includes(status) || status === 'unknown') { return; }
			await this.notify(() => this.store.setStatus(todo, status));
			return;
		}
		if ((message.kind === 'draftBody' || message.kind === 'previewBody') && typeof message.text === 'string') {
			if (message.kind === 'draftBody') { await this.changeDraft(todo, 'body', { text: message.text }); }
			await this.panel?.webview.postMessage({ kind: 'preview', field: 'body', id: this.id(todo), text: message.text, html: renderSafeMarkdown(message.text) });
			return;
		}
		if (message.kind === 'saveBody' && typeof message.text === 'string') {
			await this.finishDraftAction('body', todo, 'save', async () => {
				await this.store.editTodoBody(todo, message.text);
				await this.drafts.clear(todo, 'body');
			});
			return;
		}
		if (message.kind === 'discardBody') {
			await this.finishDraftAction('body', todo, 'discard', () => this.drafts.clear(todo, 'body')); return;
		}
		if (message.kind === 'draftAttributes' && Array.isArray(message.labels)) {
			await this.changeDraft(todo, 'attributes', { labels: message.labels, dueDate: message.dueDate });
			return;
		}
		if (message.kind === 'saveAttributes' && Array.isArray(message.labels)) {
			await this.finishDraftAction('attributes', todo, 'save', async () => {
				await this.store.setTodoMetadata(todo, message.labels, message.dueDate);
				await this.drafts.clear(todo, 'attributes');
			});
			return;
		}
		if (message.kind === 'discardAttributes') {
			await this.finishDraftAction('attributes', todo, 'discard', () => this.drafts.clear(todo, 'attributes')); return;
		}
		if ((message.kind === 'draftReply' || message.kind === 'previewReply') && typeof message.text === 'string') {
			if (message.kind === 'draftReply') { await this.changeDraft(todo, 'reply', { text: message.text }, message.replyId); }
			await this.panel?.webview.postMessage({ kind: 'preview', field: 'reply', id: this.id(todo), replyId: message.replyId, text: message.text, html: renderSafeMarkdown(message.text) });
			return;
		}
		if (message.kind === 'saveReply' && typeof message.text === 'string') {
			await this.finishDraftAction('reply', todo, 'save', async () => {
				if (message.replyId) { await this.store.editTodoComment(todo, message.replyId, message.text); }
				else { await this.store.addTodoComment(todo, message.text); }
				await this.drafts.clear(todo, 'reply', message.replyId);
			}, message.replyId);
			return;
		}
		if (message.kind === 'discardReply') {
			await this.finishDraftAction('reply', todo, 'discard', () => this.drafts.clear(todo, 'reply', message.replyId), message.replyId); return;
		}
		if (message.kind === 'deleteReply' && typeof message.replyId === 'string') {
			await this.notify(async () => {
				if (await vscode.window.showWarningMessage('このリプライを削除しますか？', { modal: true }, '削除') !== '削除') { return; }
				await this.store.deleteTodoComment(todo, message.replyId);
				await this.drafts.clear(todo, 'reply', message.replyId);
			});
			return;
		}
		if (message.kind === 'deleteTodo') {
			await this.notify(async () => {
				if (todo.status === 'unknown') { throw new Error('認識できない Todo はソースで編集してください。'); }
				if (await vscode.window.showWarningMessage(`「${todo.text}」を削除しますか？`,
					{ modal: true, detail: `${todo.comments?.comments.length ?? 0} 件のコメントも削除されます。` }, '削除') !== '削除') { return; }
				await this.store.deleteTodo(todo);
				await this.drafts.clear(todo, 'body');
				await this.drafts.clear(todo, 'attributes');
				for (const reply of todo.comments?.comments ?? []) { await this.drafts.clear(todo, 'reply', reply.id); }
			});
			return;
		}
		if (message.kind === 'setLabelColor' && typeof message.label === 'string' && typeof message.color === 'string') {
			await this.notify(() => setLabelColor(message.label, message.color as (typeof labelPalette)[number]));
			return;
		}
	}

	private html(webview: vscode.Webview): string {
		const nonce = randomBytes(16).toString('hex');
		const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.js'));
		const style = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.css'));
		const composerScript = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'issueComposer.js'));
		const issueStyle = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'issue.css'));
		return `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${style}"><link rel="stylesheet" href="${issueStyle}"></head><body class="issue-ui"><main id="app" aria-label="QuickNoteMD メモと Todo"></main><script nonce="${nonce}" src="${composerScript}"></script><script nonce="${nonce}" src="${script}"></script></body></html>`;
	}

	dispose(): void {
		this.disposed = true;
		this.panel?.dispose();
		this.panel = undefined;
		this.panelReady = false;
	}
}
