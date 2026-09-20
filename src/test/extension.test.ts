import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { notesRoot } from '../configuration';
import { DocumentStore } from '../documents';
import { TodoNode } from '../sidebar';

suite('Extension commands', () => {
	let configuration: vscode.WorkspaceConfiguration;
	let store: DocumentStore;
	const restores: Array<() => void> = [];

	const patchWindow = <K extends keyof typeof vscode.window>(key: K, value: typeof vscode.window[K]) => {
		const target = vscode.window as typeof vscode.window & Record<string, unknown>;
		const original = target[key as string];
		target[key as string] = value;
		restores.push(() => { target[key as string] = original; });
	};

	const queueInput = (...values: Array<string | undefined>) => {
		const pending = [...values];
		patchWindow('showInputBox', (async () => pending.shift()) as typeof vscode.window.showInputBox);
	};

	setup(async () => {
		const workspace = vscode.workspace.workspaceFolders?.[0];
		assert.ok(workspace, 'workspace folder is required');
		const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'quick-note-md');
		assert.ok(extension, 'QuickNoteMD extension is installed in the test host');
		await extension.activate();
		configuration = vscode.workspace.getConfiguration('quick-note-md', workspace.uri);
		await configuration.update('notesDirectory',
			`out/extension-test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
			vscode.ConfigurationTarget.Workspace);
		store = new DocumentStore(notesRoot);
		await vscode.workspace.fs.createDirectory(notesRoot());
		await vscode.commands.executeCommand('quick-note-md.refresh');
	});

	teardown(async () => {
		while (restores.length) { restores.pop()?.(); }
		try {
			await vscode.workspace.fs.delete(notesRoot(), { recursive: true, useTrash: false });
		} catch {
			// Best effort cleanup for isolated test notes directories.
		}
		await configuration.update('notesDirectory', undefined, vscode.ConfigurationTarget.Workspace);
	});

	test('newMemo creates unique managed files and appendMemo writes only to the selected note', async () => {
		queueInput('日本語メモ', '日本語メモ', '追記');
		await vscode.commands.executeCommand('quick-note-md.newMemo');
		await vscode.commands.executeCommand('quick-note-md.newMemo');
		const files = (await store.list()).map(item => item.uri.path.split('/').pop()).sort();
		assert.deepStrictEqual(files, ['日本語メモ-2.md', '日本語メモ.md']);
		await vscode.commands.executeCommand('quick-note-md.appendMemo', (await store.list())[0].uri);
		const created = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(notesRoot(), '日本語メモ.md'));
		assert.strictEqual(created.getText(), '# 日本語メモ\n追記\n');
	});

	test('newTodo, status changes, delete, and showSource follow the command contract', async () => {
		queueInput('確認タスク');
		patchWindow('showWarningMessage', (async () => '削除') as typeof vscode.window.showWarningMessage);
		await vscode.commands.executeCommand('quick-note-md.newTodo');
		let todo = (await store.todos())[0];
		await vscode.commands.executeCommand('quick-note-md.completeTodo', new TodoNode(todo));
		todo = (await store.todos())[0];
		assert.strictEqual(todo.status, 'done');
		await vscode.commands.executeCommand('quick-note-md.showSource', new TodoNode(todo));
		assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), todo.uri.toString());
		assert.strictEqual(vscode.window.activeTextEditor?.selection.active.line, todo.line);
		await vscode.commands.executeCommand('quick-note-md.reopenTodo', new TodoNode(todo));
		todo = (await store.todos())[0];
		assert.strictEqual(todo.status, 'open');
		await vscode.commands.executeCommand('quick-note-md.deleteTodo', new TodoNode(todo));
		assert.deepStrictEqual(await store.todos(), []);
	});

	test('appendMemo safely rejects non-managed files and missing selection', async () => {
		const errors: string[] = [];
		queueInput('追記不可');
		patchWindow('showErrorMessage', (async (message: string) => {
			errors.push(message);
			return undefined;
		}) as typeof vscode.window.showErrorMessage);
		const directory = await mkdtemp(join(tmpdir(), 'quick-note-external-'));
		const uri = vscode.Uri.file(join(directory, 'external.md'));
		try {
			await writeFile(uri.fsPath, '# External\n');
			await vscode.commands.executeCommand('quick-note-md.appendMemo', uri);
			const text = await vscode.workspace.openTextDocument(uri);
			assert.strictEqual(text.getText(), '# External\n');
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await vscode.commands.executeCommand('quick-note-md.appendMemo');
			assert.strictEqual(errors.filter(message => message.includes('ノート保存先の Markdown メモを選択してください。')).length, 2);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
