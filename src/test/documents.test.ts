import * as assert from 'assert';
import * as vscode from 'vscode';
import { chmod, mkdtemp, realpath, symlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { DocumentStore } from '../documents';

suite('DocumentStore integration', () => {
	let root: vscode.Uri;
	let store: DocumentStore;

	setup(async () => {
		root = vscode.Uri.file(await realpath(await mkdtemp(join(tmpdir(), 'quick-note-documents-'))));
		store = new DocumentStore(() => root);
	});

	teardown(async () => {
		for (const document of vscode.workspace.textDocuments) {
			if (document.uri.toString().startsWith(root.toString() + '/') && document.isDirty) {
				await vscode.window.showTextDocument(document);
				await vscode.commands.executeCommand('workbench.action.files.revert');
			}
		}
		await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
	});

	const read = async (uri: vscode.Uri): Promise<string> => Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
	const write = async (uri: vscode.Uri, text: string): Promise<void> => vscode.workspace.fs.writeFile(uri, Buffer.from(text));

	test('memo collisions never overwrite; nested Markdown discovery and lazy Todo creation', async () => {
		const first = await store.createMemo('日本語');
		const second = await store.createMemo('日本語');
		assert.notStrictEqual(first.toString(), second.toString());
		assert.strictEqual(await read(first), '# 日本語\n');
		const sub = vscode.Uri.joinPath(root, 'sub');
		await vscode.workspace.fs.createDirectory(sub);
		await write(vscode.Uri.joinPath(sub, 'nested.md'), '- [ ] nested\n');
		await write(vscode.Uri.joinPath(sub, 'ignored.txt'), '- [ ] ignored\n');
		assert.strictEqual((await store.list()).length, 3);
		await store.createTodo('new');
		assert.strictEqual(await read(vscode.Uri.joinPath(root, 'todo.md')), '- [ ] new\n');
		assert.deepStrictEqual((await store.todos()).map(todo => todo.text).sort(), ['nested', 'new']);
	});

	test('ten concurrent appends serialize without losing content or CRLF', async () => {
		const uri = vscode.Uri.joinPath(root, 'crlf.md');
		await write(uri, 'original\r\n');
		await Promise.all(Array.from({ length: 10 }, (_, index) => store.append(uri, `line ${index}`)));
		assert.strictEqual(await read(uri), 'original\r\n' + Array.from({ length: 10 }, (_, index) => `line ${index}\r\n`).join(''));
	});

	test('concurrent initial Todo creation is lossless', async () => {
		await Promise.all(Array.from({ length: 10 }, (_, index) => store.createTodo(`task ${index}`)));
		const rows = (await store.todos()).map(todo => todo.text);
		assert.strictEqual(rows.length, 10);
		assert.strictEqual(new Set(rows).size, 10);
	});

	test('status edits touch only marker and distinguish duplicate lines; stale refs fail', async () => {
		const uri = vscode.Uri.joinPath(root, 'tasks.md');
		const original = '# Header\r\n- [ ] same\r\n- [ ] same\r\n  - [X] 😀 **nested**\r\n';
		await write(uri, original);
		const refs = await store.todos();
		await store.setStatus(refs[1], 'important');
		assert.strictEqual(await read(uri), original.replace('- [ ] same\r\n  -', '- [i] same\r\n  -'));
		await assert.rejects(store.setStatus(refs[0], 'done'));
		const fresh = await store.todos();
		await store.setStatus(fresh[2], 'note');
		assert.ok((await read(uri)).includes('  - [n] 😀 **nested**\r\n'));
	});

	test('all six status transitions preserve text', async () => {
		await store.createTodo('**text**');
		for (const status of ['done', 'note', 'skip', 'warn', 'important', 'open'] as const) {
			await store.setStatus((await store.todos())[0], status);
			const ref = (await store.todos())[0];
			assert.strictEqual(ref.status, status);
			assert.strictEqual(ref.text, '**text**');
		}
	});

	test('delete removes only requested row and unknown rows are read-only', async () => {
		const uri = vscode.Uri.joinPath(root, 'tasks.md');
		await write(uri, '# Keep\n- [ ] same\n- [ ] same\n- [?] unknown\nTail');
		await store.deleteTodo((await store.todos())[1]);
		assert.strictEqual(await read(uri), '# Keep\n- [ ] same\n- [?] unknown\nTail');
		const unknown = (await store.todos())[1];
		await assert.rejects(store.deleteTodo(unknown));
		await assert.rejects(store.setStatus(unknown, 'done'));
		assert.strictEqual(await read(uri), '# Keep\n- [ ] same\n- [?] unknown\nTail');
	});

	test('range edits validate version, offsets and original text with UTF-16', async () => {
		const uri = vscode.Uri.joinPath(root, 'text.md');
		await write(uri, '😀 日本語\nkeep\n');
		const document = await vscode.workspace.openTextDocument(uri);
		const version = document.version;
		const next = await store.edit(uri, version, 3, 6, '日本語', '更新');
		assert.strictEqual(await read(uri), '😀 更新\nkeep\n');
		assert.strictEqual(next, document.version);
		await assert.rejects(store.edit(uri, version, 3, 5, '更新', 'old'));
		await assert.rejects(store.edit(uri, next, 3, 5, 'wrong', 'bad'));
		await assert.rejects(store.edit(uri, next, -1, 0, '', 'bad'));
	});

	test('dirty source is read live; side operations reject and editor edits retain unsaved changes', async () => {
		await store.createTodo('saved');
		const uri = vscode.Uri.joinPath(root, 'todo.md');
		const document = await vscode.workspace.openTextDocument(uri);
		const change = new vscode.WorkspaceEdit();
		change.insert(uri, new vscode.Position(1, 0), '- [n] unsaved\n');
		assert.ok(await vscode.workspace.applyEdit(change));
		assert.strictEqual(document.isDirty, true);
		assert.strictEqual((await store.todos()).length, 2);
		await assert.rejects(store.append(uri, 'blocked'));
		await assert.rejects(store.createTodo('blocked'));
		await assert.rejects(store.setStatus((await store.todos())[0], 'done'));
		await store.edit(uri, document.version, 6, 11, 'saved', 'edited');
		assert.strictEqual(document.isDirty, true);
		assert.strictEqual(await read(uri), '- [ ] saved\n');
		assert.strictEqual(document.getText(), '- [ ] edited\n- [n] unsaved\n');
	});

	test('queue recovers after a conflict; simultaneous same-version edits do not overwrite', async () => {
		await store.createTodo('task');
		const ref = (await store.todos())[0];
		const result = await Promise.allSettled([store.setStatus(ref, 'done'), store.setStatus(ref, 'warn')]);
		assert.strictEqual(result.filter(item => item.status === 'fulfilled').length, 1);
		await store.append(ref.uri, 'after conflict');
		assert.strictEqual(await read(ref.uri), '- [x] task\nafter conflict\n');
	});

	test('deleted, outside-root and read-only targets are rejected', async () => {
		await store.createTodo('task');
		const ref = (await store.todos())[0];
		await assert.rejects(store.append(vscode.Uri.joinPath(root, '..', 'outside.md'), 'bad'));
		if (process.platform !== 'win32') {
			await chmod(ref.uri.fsPath, 0o444);
			try { await assert.rejects(store.setStatus(ref, 'done')); }
			finally { await chmod(ref.uri.fsPath, 0o644); }
		}
		await vscode.workspace.fs.delete(ref.uri);
		await assert.rejects(store.setStatus(ref, 'done'));
	});

	test('raw line mismatch cannot modify a different task at the same document version', async () => {
		await store.createTodo('original');
		const ref = (await store.todos())[0];
		await assert.rejects(store.setStatus({ ...ref, raw: '- [ ] another' }, 'done'));
		assert.strictEqual(await read(ref.uri), '- [ ] original\n');
	});

	test('external disk changes are not overwritten by a stale Todo operation', async () => {
		await store.createTodo('original');
		const ref = (await store.todos())[0];
		await write(ref.uri, '- [ ] external change\n');
		await assert.rejects(store.setStatus(ref, 'done'));
		assert.strictEqual(await read(ref.uri), '- [ ] external change\n');
	});

	test('edits during save are reported as conflicts rather than acknowledged as our version', async () => {
		await store.createTodo('original');
		const ref = (await store.todos())[0];
		const document = await vscode.workspace.openTextDocument(ref.uri);
		let changed = false;
		const listener = vscode.workspace.onWillSaveTextDocument(event => {
			if (event.document.uri.toString() === ref.uri.toString() && !changed) {
				changed = true;
				event.waitUntil(Promise.resolve([vscode.TextEdit.insert(new vscode.Position(1, 0), 'concurrent change\n')]));
			}
		});
		try {
			await assert.rejects(store.edit(ref.uri, ref.version, 6, 14, 'original', 'edited'), /変更/);
			assert.strictEqual(changed, true);
			assert.strictEqual(document.getText(), '- [ ] edited\nconcurrent change\n');
			assert.strictEqual(await read(ref.uri), document.getText());
		} finally { listener.dispose(); }
	});

	test('deleted files with dirty editor contents are not recreated or silently saved', async () => {
		await store.createTodo('original');
		const uri = vscode.Uri.joinPath(root, 'todo.md');
		const document = await vscode.workspace.openTextDocument(uri);
		const change = new vscode.WorkspaceEdit();
		change.insert(uri, new vscode.Position(1, 0), 'unsaved\n');
		assert.ok(await vscode.workspace.applyEdit(change));
		await vscode.workspace.fs.delete(uri);
		await assert.rejects(store.createTodo('new'));
		assert.strictEqual(document.isDirty, true);
		assert.ok(document.getText().includes('unsaved'));
		// Restore the backing file so teardown can revert the retained dirty document.
		await write(uri, '- [ ] original\n');
	});

	test('symlink files and directories are neither listed nor modified', async function () {
		if (process.platform === 'win32') { this.skip(); }
		const actual = await store.createMemo('actual');
		const link = vscode.Uri.joinPath(root, 'link.md');
		await symlink(actual.fsPath, link.fsPath);
		await symlink(root.fsPath, join(root.fsPath, 'cycle'));
		assert.strictEqual((await store.list()).length, 1);
		await assert.rejects(store.append(link, 'bad'));
		const throughRoot = new DocumentStore(() => vscode.Uri.joinPath(root, 'cycle'));
		await assert.rejects(throughRoot.list());
		assert.strictEqual(await read(actual), '# actual\n');
	});

	test('platform-style symlink ancestors outside the configured root are allowed', async function () {
		if (process.platform === 'win32') { this.skip(); }
		const parent = vscode.Uri.joinPath(root, 'actual-parent');
		const managed = vscode.Uri.joinPath(parent, 'notes');
		await vscode.workspace.fs.createDirectory(managed);
		const link = vscode.Uri.joinPath(root, 'parent-link');
		await symlink(parent.fsPath, link.fsPath);
		const throughAncestor = new DocumentStore(() => vscode.Uri.joinPath(link, 'notes'));
		await throughAncestor.createTodo('allowed');
		assert.strictEqual(await read(vscode.Uri.joinPath(managed, 'todo.md')), '- [ ] allowed\n');
		assert.strictEqual((await throughAncestor.todos()).length, 1);
	});
});
