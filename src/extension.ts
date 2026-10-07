import * as vscode from 'vscode';
import { defaultView, isManaged, notesRoot } from './configuration';
import { statusInfo, statusOrder, TodoStatus } from './core';
import { DocumentStore } from './documents';
import { NoteEditor } from './editor';
import { isCommentNode, MemoNode, Sidebar, todoRefFromNode, TodoNode } from './sidebar';
import { SidebarView } from './sidebarView';
import { ChatView } from './chatView';

export function activate(context: vscode.ExtensionContext): void {
	const store = new DocumentStore(notesRoot);
	const sidebar = new Sidebar(store);
	const editor = new NoteEditor(context, store);
	const unifiedView = new SidebarView(context, store);
	const chatView = new ChatView(context, store);
	context.subscriptions.push(sidebar, unifiedView, chatView, vscode.window.registerCustomEditorProvider(
		NoteEditor.viewType, editor, { supportsMultipleEditorsPerDocument: true }),
		vscode.window.registerWebviewViewProvider(ChatView.viewType, chatView, { webviewOptions: { retainContextWhenHidden: true } }));

	// Feature 001 command contract: newMemo / openMemo / appendMemo / newTodo / completeTodo /
	// reopenTodo / deleteTodo / showSource are all routed through the shared store + refresh flow.
	const register = (name: string, action: (item?: unknown) => Promise<unknown>) => {
		context.subscriptions.push(vscode.commands.registerCommand(`quick-note-md.${name}`, async (item?: unknown) => {
			try {
				await action(item);
			} catch (error) {
				await vscode.window.showErrorMessage(error instanceof Error ? error.message : '操作を完了できませんでした。');
			} finally {
				sidebar.schedule();
				if (name !== 'refresh') {
					void unifiedView.refresh().catch(error =>
						vscode.window.showErrorMessage(error instanceof Error ? error.message : '一覧を更新できませんでした。'));
					void chatView.refresh().catch(error =>
						vscode.window.showErrorMessage(error instanceof Error ? error.message : 'チャット一覧を更新できませんでした。'));
				}
			}
		}));
	};
	context.subscriptions.push(vscode.commands.registerCommand('quick-note-md.newChat', async () => {
		try {
			await chatView.revealAndStartNewChat();
		} catch (error) {
			await vscode.window.showErrorMessage(error instanceof Error ? error.message : '新しいチャットを開始できませんでした。');
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('quick-note-md.openIssues', async () => {
		try {
			await unifiedView.reveal();
		} catch (error) {
			await vscode.window.showErrorMessage(error instanceof Error ? error.message : 'メモと Todo を開けませんでした。');
		}
	}));
	const memoUri = (item?: unknown, requireManaged = true): vscode.Uri => {
		const todo = todoRefFromNode(item);
		const uri = item instanceof MemoNode ? item.uri : todo ? todo.uri
			: item instanceof vscode.Uri ? item : editor.activeUri ?? vscode.window.activeTextEditor?.document.uri
				?? sidebar.memoView.selection[0]?.uri;
		if (!uri || (requireManaged && !isManaged(uri))) {
			throw new Error('ノート保存先の Markdown メモを選択してください。');
		}
		return uri;
	};
	const todoItem = (item?: unknown): TodoNode => {
		const selection = item ?? sidebar.todoView.selection[0];
		const todo = todoRefFromNode(selection);
		if (!todo) { throw new Error('Todo 項目を選択してください。'); }
		return new TodoNode(todo);
	};
	const open = async (uri: vscode.Uri, mode = defaultView()) => {
		await vscode.commands.executeCommand('vscode.openWith', uri, mode === 'source' ? 'default' : NoteEditor.viewType);
	};
	const inputLine = (prompt: string) => vscode.window.showInputBox({
		prompt, ignoreFocusOut: true,
		validateInput: value => !value.trim() ? '内容を入力してください。'
			: /[\r\n\0]/.test(value) ? '1 行のテキストを入力してください。複数行はソースで編集できます。' : undefined
	});
	const inputComment = (prompt: string, value?: string) => vscode.window.showInputBox({
		prompt, value, ignoreFocusOut: true,
		validateInput: text => text.trim() ? undefined : 'コメントを入力してください。'
	});

	register('newMemo', async () => {
		await unifiedView.revealAndStartCreate('memo');
	});
	register('openMemo', async item => open(memoUri(item)));
	register('appendMemo', async item => {
		const uri = memoUri(item);
		const text = await inputLine('メモの末尾に追記');
		if (text !== undefined) { await store.append(uri, text); }
	});
	register('newTodo', async () => {
		await unifiedView.revealAndStartCreate('todo');
	});
	register('addTodoComment', async item => {
		const todo = todoItem(item).todo;
		if (todo.status === 'unknown' || todo.comments?.readOnly) {
			throw new Error('認識できない Todo は生 Markdown で編集してください。');
		}
		const text = await inputComment('Todo コメントを追加（複数行 Markdown）');
		if (text !== undefined) { await store.addTodoComment(todo, text); }
	});
	register('editTodoBody', async item => {
		const todo = todoItem(item).todo;
		const text = await vscode.window.showInputBox({ prompt: 'Todo 本文（Markdown）', value: todo.bodyMarkdown ?? '', ignoreFocusOut: true });
		if (text !== undefined) { await store.editTodoBody(todo, text); }
	});
	register('editTodoComment', async item => {
		if (!isCommentNode(item)) { throw new Error('編集するコメントを選択してください。'); }
		const text = await inputComment('Todo コメントを編集（複数行 Markdown）', item.comment.bodyMarkdown);
		if (text !== undefined) { await store.editTodoComment(item.todo, item.comment.id, text); }
	});
	register('deleteTodoComment', async item => {
		if (!isCommentNode(item)) { throw new Error('削除するリプライを選択してください。'); }
		if (await vscode.window.showWarningMessage('このリプライを削除しますか？', { modal: true }, '削除') === '削除') {
			await store.deleteTodoComment(item.todo, item.comment.id);
		}
	});
	register('editTodoMetadata', async item => {
		const todo = todoItem(item).todo;
		if (todo.status === 'unknown') { throw new Error('認識できない Todo はソースで編集してください。'); }
		const labels = await vscode.window.showInputBox({
			prompt: 'ラベル（カンマ区切り、空欄で削除）',
			value: (todo.labels ?? []).join(', '),
			ignoreFocusOut: true,
		});
		if (labels === undefined) { return; }
		const dueDate = await vscode.window.showInputBox({
			prompt: '対応日（YYYY-MM-DD、空欄で未設定）',
			value: todo.dueDate ?? '',
			ignoreFocusOut: true,
			validateInput: value => value && !/^\d{4}-\d{2}-\d{2}$/.test(value) ? 'YYYY-MM-DD 形式で入力してください。' : undefined,
		});
		if (dueDate !== undefined) {
			await store.setTodoMetadata(todo, labels.split(',').map(label => label.trim()).filter(Boolean), dueDate || undefined);
		}
	});
	register('completeTodo', async item => store.setStatus(todoItem(item).todo, 'done'));
	register('reopenTodo', async item => store.setStatus(todoItem(item).todo, 'open'));
	register('changeStatus', async item => {
		const todo = todoItem(item).todo;
		if (todo.status === 'unknown') { throw new Error('認識できない Todo はソースで編集してください。'); }
		const options = statusOrder.filter((status): status is Exclude<TodoStatus, 'unknown'> => status !== 'unknown')
			.map(status => ({ label: statusInfo[status].label, description: `[${statusInfo[status].marker}]`, status }));
		const selected = await vscode.window.showQuickPick(options, { placeHolder: 'Todo のステータスを選択' });
		if (selected) { await store.setStatus(todo, selected.status); }
	});
	register('deleteTodo', async item => {
		const todo = todoItem(item).todo;
		if (todo.status === 'unknown') { throw new Error('認識できない Todo はソースで編集してください。'); }
		if (await vscode.window.showWarningMessage(`「${todo.text}」を削除しますか？`,
			{ modal: true, detail: `${todo.comments?.comments.length ?? 0} 件のコメントも削除されます。Markdown の対象範囲だけを削除します。` }, '削除') === '削除') {
			await store.deleteTodo(todo);
		}
	});
	register('showSource', async item => {
		const uri = memoUri(item, false);
		await open(uri, 'source');
		if (item instanceof TodoNode) {
			const document = await vscode.workspace.openTextDocument(uri);
			const line = Math.min(item.todo.line, document.lineCount - 1);
			const selection = new vscode.Range(line, 0, line, 0);
			await vscode.window.showTextDocument(document, { selection });
		}
	});
	register('showRendered', async item => open(memoUri(item), 'rendered'));
	register('toggleView', async item => open(memoUri(item, !editor.activeUri), editor.activeUri ? 'source' : 'rendered'));
	register('refresh', async () => {
		await sidebar.refresh();
		await unifiedView.refresh();
		await chatView.refresh();
	});

	let watcher: vscode.FileSystemWatcher | undefined;
	const watch = () => {
		watcher?.dispose();
		watcher = undefined;
		try {
			watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(notesRoot(), '**/*.[mM][dD]'));
			watcher.onDidCreate(() => { sidebar.schedule(); void chatView.refresh(); });
			watcher.onDidChange(() => { sidebar.schedule(); void chatView.refresh(); });
			watcher.onDidDelete(() => { sidebar.schedule(); void chatView.refresh(); });
		} catch { /* The empty workspace is explained in the sidebar. */ }
		sidebar.schedule();
		void unifiedView.refresh();
		void chatView.refresh();
	};
	context.subscriptions.push(
		{ dispose: () => watcher?.dispose() },
		vscode.workspace.onDidChangeTextDocument(event => {
			try {
				if (isManaged(event.document.uri)) {
					sidebar.schedule();
					void chatView.refresh();
				}
			} catch { /* No workspace. */ }
		}),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('quick-note-md')) { watch(); }
		}),
		vscode.workspace.onDidChangeWorkspaceFolders(watch),
		vscode.workspace.onDidRenameFiles(() => { sidebar.schedule(); void chatView.refresh(); }),
		vscode.workspace.onDidDeleteFiles(() => { sidebar.schedule(); void chatView.refresh(); })
	);
	watch();
}
