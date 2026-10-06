import * as assert from 'assert';
import * as vscode from 'vscode';
import { chmod, mkdtemp, realpath, symlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { DocumentStore } from '../documents';
import { parseChatMarkdown } from '../chatMarkdown';

// Feature 001 storage contract coverage: EOF append only, targeted line updates, and safe conflict handling.
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
	const readNormalized = async (uri: vscode.Uri): Promise<string> => (await read(uri)).replace(/\r\n/g, '\n');
	const write = async (uri: vscode.Uri, text: string): Promise<void> => vscode.workspace.fs.writeFile(uri, Buffer.from(text));

	test('memo collisions never overwrite; nested Markdown discovery and lazy Todo creation', async () => {
		const first = await store.createMemo('日本語');
		const second = await store.createMemo('日本語');
		assert.notStrictEqual(first.toString(), second.toString());
		assert.strictEqual(await readNormalized(first), '# 日本語\n');
		const sub = vscode.Uri.joinPath(root, 'sub');
		await vscode.workspace.fs.createDirectory(sub);
		await write(vscode.Uri.joinPath(sub, 'nested.md'), '- [ ] nested\n');
		await write(vscode.Uri.joinPath(sub, 'ignored.txt'), '- [ ] ignored\n');
		assert.strictEqual((await store.list()).length, 3);
		await store.createTodo('new');
		assert.strictEqual(await readNormalized(vscode.Uri.joinPath(root, 'todo.md')), '- [ ] new\n');
		assert.deepStrictEqual((await store.todos()).map(todo => todo.text).sort(), ['nested', 'new']);
	});

	test('chat creation uses unique filenames and appends replies without replacing existing Markdown', async () => {
		const id = '52a9f08231de4f09bcabac71fc083071';
		const first = await store.createChat('会話', '2026-10-04 07:30', '## 本文内の見出し', id);
		const second = await store.createChat('会話', '2026-10-04 07:31', '別の会話', '11a62a887897493db8501b19dc0dfb44');
		assert.notStrictEqual(first.toString(), second.toString());
		const original = await readNormalized(first);
		assert.ok(original.includes('<!-- quick-note-md:message ' + id + ':start -->'));
		const opened = await store.readChat(first);
		await store.appendChatMessage(first, '返信', '2026-10-04 07:42', 'reply', '21a62a887897493db8501b19dc0dfb44', opened.version);
		const result = await readNormalized(first);
		assert.ok(result.startsWith(original));
		assert.ok(result.includes('## 本文内の見出し'));
		assert.ok(result.includes('## 返信'));
		assert.strictEqual(parseChatMarkdown(result).state, 'valid');
	});

	test('chat task toggles update only a current checkbox marker and reject stale documents', async () => {
		const uri = vscode.Uri.joinPath(root, 'task-chat.md');
		const message = '<!-- quick-note-md:message 52a9f08231de4f09bcabac71fc083071:start -->\n- [ ] keep text\n<!-- quick-note-md:message 52a9f08231de4f09bcabac71fc083071:end -->';
		const original = `# tasks\n\n## 本文\n\n### 2026-10-04 07:30\n${message}\n`;
		await write(uri, original);
		const opened = await store.readChat(uri);
		const task = parseChatMarkdown(opened.text).thread?.sections[0].messages[0].tasks[0];
		assert.ok(task);
		await store.toggleChatTask(uri, '52a9f08231de4f09bcabac71fc083071', task.id, true, opened.version);
		assert.strictEqual(await readNormalized(uri), original.replace('- [ ] keep text', '- [x] keep text'));
		await assert.rejects(store.toggleChatTask(uri, '52a9f08231de4f09bcabac71fc083071', task.id, false, opened.version));
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

	test('saved direct edits become the base for the next append', async () => {
		const uri = vscode.Uri.joinPath(root, 'memo.md');
		await write(uri, 'before\n');
		const document = await vscode.workspace.openTextDocument(uri);
		const change = new vscode.WorkspaceEdit();
		change.insert(uri, new vscode.Position(1, 0), 'saved change\n');
		assert.ok(await vscode.workspace.applyEdit(change));
		assert.strictEqual(await document.save(), true);
		await store.append(uri, 'next');
		assert.strictEqual(await readNormalized(uri), 'before\nsaved change\nnext\n');
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
		assert.strictEqual(await readNormalized(uri), '# Keep\n- [ ] same\n- [?] unknown\nTail');
		const unknown = (await store.todos())[1];
		await assert.rejects(store.deleteTodo(unknown));
		await assert.rejects(store.setStatus(unknown, 'done'));
		assert.strictEqual(await readNormalized(uri), '# Keep\n- [ ] same\n- [?] unknown\nTail');
	});

	test('a malformed body boundary makes deletion read-only and preserves the complete source', async () => {
		const uri = vscode.Uri.joinPath(root, 'tasks.md');
		const source = '- [ ] first\n<!-- quick-note-md:body -->\ntext\n- [ ] second\n<!-- quick-note-md:end-body -->\n';
		await write(uri, source);
		const todos = await store.todos();
		assert.deepStrictEqual(todos.map(todo => todo.text), ['first']);
		assert.strictEqual(todos[0].readOnly, true);
		await assert.rejects(store.deleteTodo(todos[0]));
		assert.strictEqual(await readNormalized(uri), source);
	});

	test('body and reply edits each write only their own guarded range', async () => {
		const uri = vscode.Uri.joinPath(root, 'tasks.md');
		await write(uri, '- [ ] task\n');
		let todo = (await store.todos())[0];
		await store.editTodoBody(todo, '本文1行目\n本文2行目');
		todo = (await store.todos())[0];
		assert.strictEqual(todo.bodyMarkdown, '本文1行目\n本文2行目');
		await store.addTodoComment(todo, 'リプライ1');
		todo = (await store.todos())[0];
		await store.addTodoComment(todo, 'リプライ2');
		todo = (await store.todos())[0];
		assert.deepStrictEqual(todo.comments?.comments.map(comment => comment.bodyMarkdown), ['リプライ1', 'リプライ2']);
		const firstId = todo.comments!.comments[0].id;
		await store.editTodoComment(todo, firstId, '編集後リプライ1');
		todo = (await store.todos())[0];
		assert.deepStrictEqual(todo.comments?.comments.map(comment => comment.bodyMarkdown), ['編集後リプライ1', 'リプライ2']);
		await store.deleteTodoComment(todo, todo.comments!.comments[0].id);
		todo = (await store.todos())[0];
		assert.deepStrictEqual(todo.comments?.comments.map(comment => comment.bodyMarkdown), ['リプライ2']);
		assert.strictEqual(todo.bodyMarkdown, '本文1行目\n本文2行目', '本文は削除操作の影響を受けない');
		await assert.rejects(store.editTodoComment(todo, 'missing', 'x'));
		await assert.rejects(store.deleteTodoComment(todo, 'missing'));
	});

	test('adding a body after metadata keeps metadata and replies attached to the same Todo', async () => {
		const uri = vscode.Uri.joinPath(root, 'tasks.md');
		await write(uri, '- [ ] task\n- [ ] keep\n');
		let todo = (await store.todos())[0];
		await store.setTodoMetadata(todo, ['work'], '2030-01-01');
		todo = (await store.todos())[0];
		await store.addTodoComment(todo, 'existing reply');
		todo = (await store.todos())[0];
		await store.editTodoBody(todo, 'new body');
		const [updated, sibling] = await store.todos();
		assert.deepStrictEqual(updated.labels, ['work']);
		assert.strictEqual(updated.dueDate, '2030-01-01');
		assert.strictEqual(updated.bodyMarkdown, 'new body');
		assert.deepStrictEqual(updated.comments?.comments.map(comment => comment.bodyMarkdown), ['existing reply']);
		assert.strictEqual(sibling.text, 'keep');
		assert.ok((await readNormalized(uri)).indexOf('quick-note-md:meta') <
			(await readNormalized(uri)).indexOf('quick-note-md:body'));
	});

	test('setTodoMetadata guards only the metadata line and preserves body, replies, and status', async () => {
		const uri = vscode.Uri.joinPath(root, 'tasks.md');
		await write(uri, '- [x] done task\n');
		let todo = (await store.todos())[0];
		await store.editTodoBody(todo, '本文');
		todo = (await store.todos())[0];
		await store.setTodoMetadata(todo, ['a', 'b', 'a', ' c '], '2030-01-01');
		todo = (await store.todos())[0];
		assert.deepStrictEqual(todo.labels, ['a', 'b', 'c']);
		assert.strictEqual(todo.dueDate, '2030-01-01');
		assert.strictEqual(todo.status, 'done');
		assert.strictEqual(todo.bodyMarkdown, '本文');
		await store.setTodoMetadata(todo, [], undefined);
		todo = (await store.todos())[0];
		assert.deepStrictEqual(todo.labels, []);
		assert.strictEqual(todo.dueDate, undefined);
		assert.strictEqual(todo.bodyMarkdown, '本文', '本文は属性更新の影響を受けない');
		await assert.rejects(store.setTodoMetadata(todo, [], 'not-a-date'));
		const beforeInvalidLabels = await read(uri);
		await assert.rejects(store.setTodoMetadata(todo, ['comma,label'], undefined));
		await assert.rejects(store.setTodoMetadata(todo, ['quote"label'], undefined));
		assert.strictEqual(await read(uri), beforeInvalidLabels);
	});

	test('deleting a Todo removes its body and replies as one guarded block, leaving siblings untouched', async () => {
		const uri = vscode.Uri.joinPath(root, 'tasks.md');
		await write(uri, '- [ ] keep\n- [ ] remove\n');
		const target = (await store.todos()).find(todo => todo.text === 'remove')!;
		await store.editTodoBody(target, '本文');
		const withBody = (await store.todos()).find(todo => todo.text === 'remove')!;
		await store.addTodoComment(withBody, 'リプライ');
		const withReply = (await store.todos()).find(todo => todo.text === 'remove')!;
		await store.deleteTodo(withReply);
		const remaining = await store.todos();
		assert.deepStrictEqual(remaining.map(todo => todo.text), ['keep']);
		assert.strictEqual(await readNormalized(uri), '- [ ] keep\n');
	});

	test('range edits validate version, offsets and original text with UTF-16', async () => {
		const uri = vscode.Uri.joinPath(root, 'text.md');
		await write(uri, '😀 日本語\nkeep\n');
		const document = await vscode.workspace.openTextDocument(uri);
		const version = document.version;
		const next = await store.edit(uri, version, 3, 6, '日本語', '更新');
		assert.strictEqual(await readNormalized(uri), '😀 更新\nkeep\n');
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
		assert.strictEqual(await readNormalized(uri), '- [ ] saved\n');
		assert.strictEqual(document.getText().replace(/\r\n/g, '\n'), '- [ ] edited\n- [n] unsaved\n');
	});

	test('queue recovers after a conflict; simultaneous same-version edits do not overwrite', async () => {
		await store.createTodo('task');
		const ref = (await store.todos())[0];
		const result = await Promise.allSettled([store.setStatus(ref, 'done'), store.setStatus(ref, 'warn')]);
		assert.strictEqual(result.filter(item => item.status === 'fulfilled').length, 1);
		await store.append(ref.uri, 'after conflict');
		assert.strictEqual(await readNormalized(ref.uri), '- [x] task\nafter conflict\n');
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

	test('todo creation fails safely when the default source path stops being a Markdown file', async () => {
		await store.createTodo('task');
		const uri = vscode.Uri.joinPath(root, 'todo.md');
		await vscode.workspace.fs.delete(uri);
		await vscode.workspace.fs.createDirectory(uri);
		await assert.rejects(store.createTodo('blocked'));
		const stat = await vscode.workspace.fs.stat(uri);
		assert.ok(stat.type & vscode.FileType.Directory);
	});

	test('raw line mismatch cannot modify a different task at the same document version', async () => {
		await store.createTodo('original');
		const ref = (await store.todos())[0];
		await assert.rejects(store.setStatus({ ...ref, raw: '- [ ] another' }, 'done'));
		assert.strictEqual(await readNormalized(ref.uri), '- [ ] original\n');
	});

	test('external disk changes are not overwritten by a stale Todo operation', async () => {
		await store.createTodo('original');
		const ref = (await store.todos())[0];
		await write(ref.uri, '- [ ] external change\n');
		await assert.rejects(store.setStatus(ref, 'done'));
		assert.strictEqual(await readNormalized(ref.uri), '- [ ] external change\n');
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
			assert.strictEqual(document.getText().replace(/\r\n/g, '\n'), '- [ ] edited\nconcurrent change\n');
			assert.strictEqual(await readNormalized(ref.uri), document.getText().replace(/\r\n/g, '\n'));
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

	test('1,000-line Markdown files remain operable for list, append, and Todo completion', async () => {
		const uri = vscode.Uri.joinPath(root, 'large.md');
		const body = Array.from({ length: 999 }, (_, index) => `line ${index}`).join('\n');
		await write(uri, `${body}\n- [ ] tail task\n`);
		assert.ok((await store.list()).some(item => item.uri.toString() === uri.toString()));
		await store.append(uri, 'after');
		const todo = (await store.todos()).find(item => item.uri.toString() === uri.toString());
		assert.ok(todo);
		await store.setStatus(todo!, 'done');
		const text = await read(uri);
		const normalized = text.replace(/\r\n/g, '\n');
		assert.ok(normalized.startsWith('line 0\nline 1\n'));
		assert.ok(normalized.includes('- [x] tail task\nafter\n'));
		assert.ok(text.split('\n').length >= 1001);
	});
});
