import * as vscode from 'vscode';
import { statusInfo, statusOrder, TodoStatus } from './core';
import { DocumentStore, TodoRef } from './documents';

export class MemoNode extends vscode.TreeItem {
	constructor(public readonly uri: vscode.Uri, title: string, mtime: number) {
		super(title);
		this.id = uri.toString();
		this.resourceUri = uri;
		this.contextValue = 'memo';
		this.iconPath = new vscode.ThemeIcon('note');
		this.tooltip = `${title}\n${uri.fsPath}\n更新: ${new Date(mtime).toLocaleString('ja-JP')}`;
		this.command = { command: 'quick-note-md.openMemo', title: 'メモを開く', arguments: [this] };
	}
}

export class TodoNode extends vscode.TreeItem {
	constructor(public readonly todo: TodoRef) {
		super(todo.text || todo.raw, ((todo.comments?.comments.length ?? 0) > 0 || todo.bodyMarkdown !== undefined)
			? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
		this.id = `${todo.uri.toString()}:${todo.line}`;
		const labels = todo.labels?.length ? todo.labels.map(label => `🏷 ${label}`).join(' ') : '';
		const due = todo.dueDate ? ` · 対応日 ${todo.dueDate}${todo.dueDate < new Date().toISOString().slice(0, 10) ? '（期限切れ）' : ''}` : '';
		this.description = [statusInfo[todo.status].label, labels, due,
			todo.comments?.comments.length ? `コメント ${todo.comments.comments.length}件` : ''].filter(Boolean).join(' · ');
		this.tooltip = `${this.description}: ${todo.text}\n${todo.uri.fsPath}:${todo.line + 1}`;
		this.contextValue = todo.status === 'unknown' ? 'unknownTodo'
			: todo.status === 'done' ? 'doneTodo' : 'activeTodo';
		this.iconPath = new vscode.ThemeIcon(statusInfo[todo.status].icon);
		this.accessibilityInformation = { label: `${this.description}: ${todo.text}` };
		this.command = { command: 'quick-note-md.showSource', title: 'ソースを開く', arguments: [this] };
	}
}

export class CommentNode extends vscode.TreeItem {
	constructor(public readonly todo: TodoRef, public readonly comment: NonNullable<TodoRef['comments']>['comments'][number]) {
		super(`コメント ${comment.order + 1}`, vscode.TreeItemCollapsibleState.None);
		this.id = `${todo.uri.toString()}:${todo.line}:${comment.id}`;
		this.description = comment.bodyMarkdown.split(/\r?\n/, 1)[0] || '（空コメント）';
		this.tooltip = comment.bodyMarkdown;
		this.contextValue = 'todoComment';
		this.accessibilityInformation = { label: `コメント ${comment.order + 1}: ${this.description}` };
		this.command = { command: 'quick-note-md.editTodoComment', title: 'Todo コメントを編集', arguments: [this] };
	}
}

export class TodoBodyNode extends vscode.TreeItem {
		constructor(public readonly todo: TodoRef) {
			super('本文', vscode.TreeItemCollapsibleState.None);
			this.id = `${todo.uri.toString()}:${todo.line}:body`;
			this.description = todo.bodyMarkdown?.split(/\r?\n/, 1)[0] || '本文を追加';
			this.contextValue = 'todoBody';
			this.tooltip = todo.bodyMarkdown || '本文はまだありません。';
			this.command = { command: 'quick-note-md.showSource', title: 'Todo の Markdown を開く', arguments: [this] };
		}
}

export class StatusNode extends vscode.TreeItem {
	constructor(public readonly status: TodoStatus, public readonly items: TodoNode[]) {
		super(`${statusInfo[status].label} (${items.length})`,
			status === 'done' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded);
		this.id = `status:${status}`;
		this.iconPath = new vscode.ThemeIcon(statusInfo[status].icon);
	}
}

export class MemoProvider implements vscode.TreeDataProvider<MemoNode>, vscode.Disposable {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;
	items: MemoNode[] = [];
	getTreeItem(item: MemoNode): vscode.TreeItem { return item; }
	getChildren(): MemoNode[] { return this.items; }
	update(items: MemoNode[]): void { this.items = items; this.changed.fire(); }
	dispose(): void { this.changed.dispose(); }
}

export class TodoProvider implements vscode.TreeDataProvider<StatusNode | TodoNode | CommentNode | TodoBodyNode>, vscode.Disposable {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;
	items: StatusNode[] = [];
	getTreeItem(item: StatusNode | TodoNode | CommentNode | TodoBodyNode): vscode.TreeItem { return item; }
	getChildren(item?: StatusNode | TodoNode | CommentNode | TodoBodyNode): (StatusNode | TodoNode | CommentNode | TodoBodyNode)[] {
		if (item instanceof StatusNode) { return item.items; }
		if (item instanceof TodoNode) {
			return [
				...(item.todo.bodyMarkdown !== undefined ? [new TodoBodyNode(item.todo)] : []),
				...(item.todo.comments?.comments ?? []).map(comment => new CommentNode(item.todo, comment)),
			];
		}
		return item ? [] : this.items;
	}
	update(items: TodoRef[]): void {
		this.items = statusOrder.map(status => new StatusNode(status,
			items.filter(item => item.status === status).map(item => new TodoNode(item))));
		this.changed.fire();
	}
	dispose(): void { this.changed.dispose(); }
}

export class Sidebar implements vscode.Disposable {
	readonly memos = new MemoProvider();
	readonly todos = new TodoProvider();
	readonly memoView = vscode.window.createTreeView('quick-note-md.memos', { treeDataProvider: this.memos });
	readonly todoView = vscode.window.createTreeView('quick-note-md.todos', { treeDataProvider: this.todos });
	private generation = 0;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;

	constructor(private readonly store: DocumentStore) {}

	schedule(): void {
		if (this.disposed) { return; }
		this.generation++;
		if (this.timer) { clearTimeout(this.timer); }
		this.timer = setTimeout(() => { void this.refresh(); }, 100);
	}

	async refresh(): Promise<void> {
		if (this.disposed) { return; }
		const generation = ++this.generation;
		try {
			const [memos, todos] = await Promise.all([this.store.list(), this.store.todos()]);
			if (this.disposed || generation !== this.generation) { return; }
			this.memos.update(memos.map(memo => new MemoNode(memo.uri, memo.title, memo.mtime)));
			this.todos.update(todos);
			const count = todos.filter(todo => ['open', 'warn', 'important'].includes(todo.status)).length;
			this.todoView.badge = { value: count, tooltip: '未解決（未完了・Warn・IMP）' };
			this.todoView.message = `未解決 ${count} 件（未完了・Warn・IMP）`;
			this.memoView.message = memos.length ? undefined : '「新規メモ」から Markdown メモを作成できます。';
		} catch (error) {
			if (this.disposed || generation !== this.generation) { return; }
			this.memos.update([]);
			this.todos.update([]);
			this.todoView.badge = undefined;
			const message = error instanceof Error ? error.message : '一覧を読み込めませんでした。';
			this.memoView.message = message;
			this.todoView.message = message;
		}
	}

	dispose(): void {
		this.disposed = true;
		this.generation++;
		if (this.timer) { clearTimeout(this.timer); }
		this.memoView.dispose();
		this.todoView.dispose();
		this.memos.dispose();
		this.todos.dispose();
	}
}
