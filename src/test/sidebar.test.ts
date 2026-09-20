import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { directorySegments } from '../configuration';
import { statusInfo } from '../core';
import { TodoRef } from '../documents';
import { MemoNode, MemoProvider, StatusNode, TodoNode, TodoProvider } from '../sidebar';

suite('Sidebar and settings', () => {
	const todo: TodoRef = {
		uri: vscode.Uri.file('/notes/example.md'), version: 1, line: 2,
		raw: '- [ ] 日本語 Todo', text: '日本語 Todo', status: 'open', markerStart: 2
	};

	test('accepts platform-independent relative directories only', () => {
		assert.deepStrictEqual(directorySegments('notes/日本語'), ['notes', '日本語']);
		assert.deepStrictEqual(directorySegments('notes\\child'), ['notes', 'child']);
		for (const path of ['', ' ', '/notes', '../notes', 'notes/../outside', './notes', 'C:\\notes', 'notes//child', 'notes\0']) {
			assert.throws(() => directorySegments(path));
		}
	});

	test('groups IMP first, counts statuses and collapses completed items', () => {
		const provider = new TodoProvider();
		try {
			provider.update([todo, { ...todo, line: 3, status: 'important' }, { ...todo, line: 4, status: 'done' }]);
			const groups = provider.getChildren() as StatusNode[];
			assert.strictEqual(groups[0].status, 'important');
			assert.strictEqual(groups[0].items.length, 1);
			assert.strictEqual(groups.find(group => group.status === 'open')?.items.length, 1);
			assert.strictEqual(groups.find(group => group.status === 'done')?.collapsibleState,
				vscode.TreeItemCollapsibleState.Collapsed);
			assert.strictEqual(provider.getChildren(groups[0]).length, 1);
			assert.deepStrictEqual(provider.getChildren(groups[0].items[0]), []);
		} finally { provider.dispose(); }
	});

	test('duplicate text has distinct row identities and unknown rows are read-only', () => {
		const first = new TodoNode(todo);
		const second = new TodoNode({ ...todo, line: 3 });
		assert.notStrictEqual(first.id, second.id);
		const unknown = new TodoNode({ ...todo, status: 'unknown' });
		assert.strictEqual(unknown.contextValue, 'unknownTodo');
		assert.ok(unknown.accessibilityInformation?.label.includes(statusInfo.unknown.label));
		assert.strictEqual(unknown.command?.command, 'quick-note-md.showSource');
	});

	test('memo tree exposes its URI and fires refresh events', () => {
		const provider = new MemoProvider();
		let events = 0;
		const subscription = provider.onDidChangeTreeData(() => events++);
		try {
			const memo = new MemoNode(todo.uri, 'example', 0);
			provider.update([memo]);
			assert.strictEqual(events, 1);
			assert.strictEqual(provider.getChildren()[0].resourceUri, todo.uri);
			assert.strictEqual(memo.command?.command, 'quick-note-md.openMemo');
		} finally { subscription.dispose(); provider.dispose(); }
	});

	test('extension registers all user commands and optional rendered editor', async () => {
		const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'quick-note-md');
		assert.ok(extension, 'QuickNoteMD extension is installed in the test host');
		await extension.activate();
		const commands = await vscode.commands.getCommands(true);
		for (const name of ['newMemo', 'appendMemo', 'openMemo', 'newTodo', 'completeTodo', 'reopenTodo',
			'changeStatus', 'deleteTodo', 'showSource', 'showRendered', 'toggleView', 'refresh']) {
			assert.ok(commands.includes(`quick-note-md.${name}`), name);
		}
		assert.strictEqual(extension.packageJSON.contributes.customEditors[0].priority, 'option');
		assert.strictEqual(extension.packageJSON.contributes.configuration.properties['quick-note-md.defaultView'].default,
			'rendered');
	});

	test('source fallback remains available outside the managed directory', async () => {
		const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'quick-note-md');
		assert.ok(extension);
		await extension.activate();
		const directory = await mkdtemp(join(tmpdir(), 'quick-note-source-'));
		const uri = vscode.Uri.file(join(directory, 'external.md'));
		try {
			await writeFile(uri.fsPath, '# External\n');
			await vscode.commands.executeCommand('quick-note-md.showSource', uri);
			assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), uri.toString());
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
