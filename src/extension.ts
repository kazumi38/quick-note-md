import * as vscode from 'vscode';
import { defaultView, isManaged, notesRoot } from './configuration';
import { safeFileName, statusInfo, statusOrder, TodoStatus } from './core';
import { DocumentStore } from './documents';
import { NoteEditor } from './editor';
import { MemoNode, Sidebar, TodoNode } from './sidebar';

export function activate(context: vscode.ExtensionContext): void {
	const store = new DocumentStore(notesRoot);
	const sidebar = new Sidebar(store);
	const editor = new NoteEditor(context, store);
	context.subscriptions.push(sidebar, vscode.window.registerCustomEditorProvider(
		NoteEditor.viewType, editor, { supportsMultipleEditorsPerDocument: true }));

	const register = (name: string, action: (item?: unknown) => Promise<unknown>) => {
		context.subscriptions.push(vscode.commands.registerCommand(`quick-note-md.${name}`, async (item?: unknown) => {
			try {
				await action(item);
			} catch (error) {
				await vscode.window.showErrorMessage(error instanceof Error ? error.message : '操作を完了できませんでした。');
			} finally {
				sidebar.schedule();
			}
		}));
	};
	const memoUri = (item?: unknown): vscode.Uri => {
		const uri = item instanceof MemoNode ? item.uri : item instanceof TodoNode ? item.todo.uri
			: item instanceof vscode.Uri ? item : editor.activeUri ?? vscode.window.activeTextEditor?.document.uri
				?? sidebar.memoView.selection[0]?.uri;
		if (!uri || !isManaged(uri)) {
			throw new Error('ノート保存先の Markdown メモを選択してください。');
		}
		return uri;
	};
	const todoItem = (item?: unknown): TodoNode => {
		const selection = item ?? sidebar.todoView.selection[0];
		if (!(selection instanceof TodoNode)) { throw new Error('Todo 項目を選択してください。'); }
		return selection;
	};
	const open = async (uri: vscode.Uri, mode = defaultView()) => {
		await vscode.commands.executeCommand('vscode.openWith', uri, mode === 'source' ? 'default' : NoteEditor.viewType);
	};
	const inputLine = (prompt: string) => vscode.window.showInputBox({
		prompt, ignoreFocusOut: true,
		validateInput: value => !value.trim() ? '内容を入力してください。'
			: /[\r\n\0]/.test(value) ? '1 行のテキストを入力してください。複数行はソースで編集できます。' : undefined
	});

	register('newMemo', async () => {
		notesRoot();
		const title = await vscode.window.showInputBox({
			prompt: '新しいメモのタイトル', ignoreFocusOut: true,
			validateInput: value => {
				try { safeFileName(value); return undefined; }
				catch (error) { return error instanceof Error ? error.message : 'タイトルを入力してください。'; }
			}
		});
		if (title !== undefined) { await open(await store.createMemo(title)); }
	});
	register('openMemo', async item => open(memoUri(item)));
	register('appendMemo', async item => {
		const uri = memoUri(item);
		const text = await inputLine('メモの末尾に追記');
		if (text !== undefined) { await store.append(uri, text); }
	});
	register('newTodo', async () => {
		notesRoot();
		const text = await inputLine('新しい Todo');
		if (text !== undefined) { await store.createTodo(text); }
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
			{ modal: true, detail: 'Markdown の対象行だけを削除します。' }, '削除') === '削除') {
			await store.deleteTodo(todo);
		}
	});
	register('showSource', async item => {
		const uri = memoUri(item);
		await open(uri, 'source');
		if (item instanceof TodoNode) {
			const document = await vscode.workspace.openTextDocument(uri);
			const line = Math.min(item.todo.line, document.lineCount - 1);
			const selection = new vscode.Range(line, 0, line, 0);
			await vscode.window.showTextDocument(document, { selection });
		}
	});
	register('showRendered', async item => open(memoUri(item), 'rendered'));
	register('toggleView', async item => open(memoUri(item), editor.activeUri ? 'source' : 'rendered'));
	register('refresh', async () => sidebar.refresh());

	let watcher: vscode.FileSystemWatcher | undefined;
	const watch = () => {
		watcher?.dispose();
		watcher = undefined;
		try {
			watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(notesRoot(), '**/*.[mM][dD]'));
			watcher.onDidCreate(() => sidebar.schedule());
			watcher.onDidChange(() => sidebar.schedule());
			watcher.onDidDelete(() => sidebar.schedule());
		} catch { /* The empty workspace is explained in the sidebar. */ }
		sidebar.schedule();
	};
	context.subscriptions.push(
		{ dispose: () => watcher?.dispose() },
		vscode.workspace.onDidChangeTextDocument(event => {
			try { if (isManaged(event.document.uri)) { sidebar.schedule(); } } catch { /* No workspace. */ }
		}),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('quick-note-md')) { watch(); }
		}),
		vscode.workspace.onDidChangeWorkspaceFolders(watch),
		vscode.workspace.onDidRenameFiles(() => sidebar.schedule()),
		vscode.workspace.onDidDeleteFiles(() => sidebar.schedule())
	);
	watch();
}
