import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { statusInfo, statusOrder, TodoStatus } from './core';
import { labelColor, labelPalette, setLabelColor } from './configuration';
import { renderSafeMarkdown } from './rendering';
import { DocumentStore, TodoRef } from './documents';
import { DraftKind, DraftStore } from './drafts';
import { DraftManager, ReconciledDraft } from './draftManager';

interface DraftView { state: 'dirty' | 'conflict'; text?: string; labels?: string[]; dueDate?: string }

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

export class SidebarView implements vscode.WebviewViewProvider, vscode.Disposable {
	public static readonly viewType = 'quick-note-md.sidebar';
	private view: vscode.WebviewView | undefined;
	private todos: TodoRef[] = [];
	private disposed = false;
	private readonly drafts: DraftManager;
	private readonly draftStore: DraftStore;

	constructor(private readonly context: vscode.ExtensionContext, private readonly store: DocumentStore) {
		this.draftStore = new DraftStore(vscode.Uri.joinPath(context.globalStorageUri, 'sidebar-drafts'));
		this.drafts = new DraftManager(this.draftStore);
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')] };
		view.webview.html = this.html(view.webview);
		view.webview.onDidReceiveMessage(message => void this.message(message));
		void this.refresh();
	}

	async refresh(): Promise<void> {
		if (this.disposed) { return; }
		try {
			this.todos = await this.store.todos();
		} catch {
			this.todos = [];
			return;
		}
		const files = await this.store.list().catch(() => []);
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
		const snapshot = {
			labelPalette: [...labelPalette],
			files: files.map(file => ({ uri: file.uri.toString(), title: file.title })),
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
			orphans,
		};
		await this.view?.webview.postMessage({ kind: 'snapshot', ...snapshot });
	}

	private id(todo: TodoRef): string {
		return `${todo.uri.toString()}::${todo.line}::${todo.raw}`;
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
		await this.view?.webview.postMessage({ kind: 'draftResult', field, id: this.id(todo), replyId, action, success });
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
		if (!value || typeof value !== 'object' || Array.isArray(value)) { return; }
		const message = value as SidebarMessage;
		if (message.kind === 'ready') { await this.refresh(); return; }
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
			await this.view?.webview.postMessage({ kind: 'preview', field: 'body', id: this.id(todo), text: message.text, html: renderSafeMarkdown(message.text) });
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
			await this.view?.webview.postMessage({ kind: 'preview', field: 'reply', id: this.id(todo), replyId: message.replyId, text: message.text, html: renderSafeMarkdown(message.text) });
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
		return `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${style}"></head><body><main id="app" aria-label="QuickNoteMD サイドバー"></main><script nonce="${nonce}" src="${script}"></script></body></html>`;
	}

	dispose(): void {
		this.disposed = true;
		this.view = undefined;
	}
}
