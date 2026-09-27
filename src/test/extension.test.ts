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

	test('contributed views and their commands are available after activation', async () => {
		const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'quick-note-md');
		assert.ok(extension);
		await extension.activate();
		const views = extension.packageJSON.contributes.views['quick-note-md'].map((view: { id: string }) => view.id);
		assert.deepStrictEqual(views, ['quick-note-md.sidebar', 'quick-note-md.memos', 'quick-note-md.todos']);
		const commands = await vscode.commands.getCommands(true);
		for (const name of ['quick-note-md.newMemo', 'quick-note-md.newTodo', 'quick-note-md.refresh']) {
			assert.ok(commands.includes(name), name);
		}
		const contributedCommands = extension.packageJSON.contributes.commands.map((command: { command: string }) => command.command);
		for (const name of ['quick-note-md.newMemo', 'quick-note-md.newTodo', 'quick-note-md.refresh']) {
			assert.ok(contributedCommands.includes(name), name);
		}
	});

	test('empty contexts require successful empty reads and clear on errors', async () => {
		const target = vscode.commands as typeof vscode.commands & Record<string, unknown>;
		const original = target.executeCommand;
		const execute = original as (command: string, ...args: unknown[]) => Promise<unknown>;
		const contexts = new Map<string, unknown[]>();
		target.executeCommand = (async (command: string, ...args: unknown[]) => {
			if (command === 'setContext' && typeof args[0] === 'string') {
				const values = contexts.get(args[0]) ?? [];
				values.push(args[1]);
				contexts.set(args[0], values);
			}
			return execute.call(vscode.commands, command, ...args);
		}) as typeof vscode.commands.executeCommand;
		try {
			await vscode.commands.executeCommand('quick-note-md.refresh');
			assert.deepStrictEqual(contexts.get('quick-note-md.memosEmpty'), [false, true]);
			assert.deepStrictEqual(contexts.get('quick-note-md.todosEmpty'), [false, true]);

			contexts.clear();
			await vscode.workspace.fs.delete(notesRoot(), { recursive: true, useTrash: false });
			await vscode.workspace.fs.writeFile(notesRoot(), Buffer.from('not a directory'));
			await vscode.commands.executeCommand('quick-note-md.refresh');
			assert.deepStrictEqual(contexts.get('quick-note-md.memosEmpty'), [false]);
			assert.deepStrictEqual(contexts.get('quick-note-md.todosEmpty'), [false]);
		} finally {
			target.executeCommand = original;
		}
	});

	test('newMemo creates unique managed files and appendMemo writes only to the selected note', async () => {
		queueInput('日本語メモ', '日本語メモ', '追記');
		await vscode.commands.executeCommand('quick-note-md.newMemo');
		await vscode.commands.executeCommand('quick-note-md.newMemo');
		const memos = await store.list();
		const files = memos.map(item => item.uri.path.split('/').pop()).sort();
		assert.deepStrictEqual(files, ['日本語メモ-2.md', '日本語メモ.md']);
		const memo = memos.find(item => item.uri.path.endsWith('/日本語メモ.md'));
		assert.ok(memo);
		await vscode.commands.executeCommand('quick-note-md.appendMemo', memo.uri);
		const created = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(notesRoot(), '日本語メモ.md'));
		assert.strictEqual(created.getText().replace(/\r\n/g, '\n'), '# 日本語メモ\n追記\n');
	});

	test('newTodo, status changes, delete, and showSource follow the command contract', async () => {
		const errors: string[] = [];
		queueInput('確認タスク');
		patchWindow('showWarningMessage', (async () => '削除') as typeof vscode.window.showWarningMessage);
		patchWindow('showErrorMessage', (async (message: string) => { errors.push(message); }) as typeof vscode.window.showErrorMessage);
		await vscode.commands.executeCommand('quick-note-md.newTodo');
		let todo = (await store.todos())[0];
		await vscode.commands.executeCommand('quick-note-md.completeTodo', new TodoNode(todo));
		assert.deepStrictEqual(errors, []);
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
