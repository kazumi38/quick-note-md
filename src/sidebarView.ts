import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { DocumentStore, TodoRef } from './documents';

type SidebarMessage =
	| { kind: 'ready' }
	| { kind: 'select'; id: string }
	| { kind: 'source'; id: string };

export class SidebarView implements vscode.WebviewViewProvider, vscode.Disposable {
	public static readonly viewType = 'quick-note-md.sidebar';
	private view: vscode.WebviewView | undefined;
	private todos: TodoRef[] = [];
	private disposed = false;

	constructor(private readonly context: vscode.ExtensionContext, private readonly store: DocumentStore) {}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')] };
		view.webview.html = this.html(view.webview);
		view.webview.onDidReceiveMessage(message => this.message(message));
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
		await this.view?.webview.postMessage({ kind: 'snapshot', todos: this.todos.map(todo => ({
			id: this.id(todo), title: todo.text, status: todo.status, labels: todo.labels ?? [], dueDate: todo.dueDate,
			bodyMarkdown: todo.bodyMarkdown, replies: todo.comments?.comments.map(reply => ({ id: reply.id, text: reply.bodyMarkdown })) ?? [],
			readOnly: todo.readOnly || todo.status === 'unknown',
		})) });
	}

	private id(todo: TodoRef): string {
		return `${todo.uri.toString()}::${todo.line}::${todo.raw}`;
	}

	private async message(value: unknown): Promise<void> {
		if (!value || typeof value !== 'object' || Array.isArray(value)) { return; }
		const message = value as Record<string, unknown>;
		if (message.kind === 'ready' && Object.keys(message).length === 1) { await this.refresh(); return; }
		if ((message.kind !== 'select' && message.kind !== 'source') || typeof message.id !== 'string' || message.id.length > 2048) { return; }
		const todo = this.todos.find(candidate => this.id(candidate) === message.id);
		if (!todo) { return; }
		if (message.kind === 'source') { await vscode.commands.executeCommand('quick-note-md.showSource', todo.uri); }
		else { await this.view?.webview.postMessage({ kind: 'selected', id: message.id }); }
	}

	private html(webview: vscode.Webview): string {
		const nonce = randomBytes(16).toString('hex');
		const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.js'));
		const style = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.css'));
		return `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${style}"></head><body><main id="app" aria-label="Todo 一覧"></main><script nonce="${nonce}" src="${script}"></script></body></html>`;
	}

	dispose(): void {
		this.disposed = true;
		this.view = undefined;
	}
}
