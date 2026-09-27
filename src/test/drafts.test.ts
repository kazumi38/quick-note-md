import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DraftSnapshot, DraftStore } from '../drafts';
import { currentBaseSource, DraftManager, draftBackupKey, reconcileDrafts } from '../draftManager';
import { TodoRef } from '../documents';

suite('Draft persistence and restart reconciliation', () => {
	const base = (overrides: Partial<TodoRef> = {}): TodoRef => ({
		uri: vscode.Uri.file('/notes/example.md'), version: 1, line: 2,
		raw: '- [ ] 日本語 Todo', text: '日本語 Todo', status: 'open', markerStart: 2,
		bodyMarkdown: '本文', labels: ['a'], dueDate: '2030-01-01',
		comments: { todoId: { filePath: '/notes/example.md', lineNumber: 2, originalText: '- [ ] 日本語 Todo' },
			comments: [{ id: 'comment-0', todoId: { filePath: '/notes/example.md', lineNumber: 2, originalText: '- [ ] 日本語 Todo' }, order: 0, bodyMarkdown: '返信' }],
			sourceText: '', readOnly: false },
		...overrides,
	});

	test('save, load and remove round-trip a snapshot by backup key', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'quick-note-drafts-'));
		try {
			const store = new DraftStore(vscode.Uri.file(directory));
			const snapshot: DraftSnapshot = {
				kind: 'body', backupKey: 'key-1', todoIdentity: { filePath: '/notes/example.md', originalText: '- [ ] 日本語 Todo' },
				text: '下書き本文', baseSource: '本文', state: 'dirty',
			};
			assert.strictEqual(await store.load('key-1'), undefined);
			await store.save(snapshot);
			assert.deepStrictEqual(await store.load('key-1'), snapshot);
			await store.remove('key-1');
			assert.strictEqual(await store.load('key-1'), undefined);
			await store.remove('key-1'); // Removing a missing backup is a no-op, not an error.
		} finally {
			await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
		}
	});

	test('list enumerates saved backups and silently skips corrupt or foreign files', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'quick-note-drafts-'));
		try {
			const store = new DraftStore(vscode.Uri.file(directory));
			assert.deepStrictEqual(await store.list(), []);
			const snapshot: DraftSnapshot = {
				kind: 'attributes', backupKey: 'key-a', todoIdentity: { filePath: '/notes/a.md', originalText: '- [ ] a' },
				labels: ['x'], baseSource: '{}', state: 'dirty',
			};
			await store.save(snapshot);
			await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(vscode.Uri.file(directory), 'corrupt.json'), Buffer.from('not json'));
			await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(vscode.Uri.file(directory), 'ignored.txt'), Buffer.from('irrelevant'));
			const list = await store.list();
			assert.strictEqual(list.length, 1);
			assert.deepStrictEqual(list[0], snapshot);
		} finally {
			await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
		}
	});

	test('reconciliation restores a matching draft, flags external changes and orphans unmatched drafts', () => {
		const todo = base();
		const matchingSnapshot: DraftSnapshot = {
			kind: 'body', backupKey: draftBackupKey({ filePath: todo.uri.fsPath, originalText: todo.raw, kind: 'body' }),
			todoIdentity: { filePath: todo.uri.fsPath, originalText: todo.raw },
			text: '未保存の本文', baseSource: currentBaseSource(todo, 'body'), state: 'dirty',
		};
		const staleSnapshot: DraftSnapshot = {
			kind: 'body', backupKey: 'stale-key',
			todoIdentity: { filePath: todo.uri.fsPath, originalText: todo.raw },
			text: '古い下書き', baseSource: '別の本文（外部で変更された）', state: 'dirty',
		};
		const orphanSnapshot: DraftSnapshot = {
			kind: 'body', backupKey: 'orphan-key',
			todoIdentity: { filePath: '/notes/deleted.md', originalText: '- [ ] 消えた Todo' },
			text: '孤立した下書き', baseSource: '', state: 'dirty',
		};
		const results = reconcileDrafts([matchingSnapshot, staleSnapshot, orphanSnapshot], [todo], ref => `${ref.uri.toString()}::${ref.line}::${ref.raw}`);
		assert.strictEqual(results[0].state, 'dirty');
		assert.strictEqual(results[0].todoKey, `${todo.uri.toString()}::${todo.line}::${todo.raw}`);
		assert.strictEqual(results[1].state, 'conflict');
		assert.strictEqual(results[1].todoKey, `${todo.uri.toString()}::${todo.line}::${todo.raw}`);
		assert.strictEqual(results[2].todoKey, undefined);
	});

	test('ambiguous matches (duplicate identity) are never auto-applied', () => {
		const todo = base();
		const duplicate = base({ version: 2 });
		const snapshot: DraftSnapshot = {
			kind: 'body', backupKey: 'dup-key', todoIdentity: { filePath: todo.uri.fsPath, originalText: todo.raw },
			text: '下書き', baseSource: currentBaseSource(todo, 'body'), state: 'dirty',
		};
		const [result] = reconcileDrafts([snapshot], [todo, duplicate], ref => `${ref.line}`);
		assert.strictEqual(result.todoKey, undefined);
	});

	test('DraftManager persists changes keyed by file/original-text/kind/reply and clears them on save', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'quick-note-drafts-'));
		try {
			const manager = new DraftManager(new DraftStore(vscode.Uri.file(directory)));
			const todo = base();
			await manager.change(todo, 'body', { text: '編集中の本文' });
			await manager.change(todo, 'reply', { text: '編集中の返信' }, 'comment-0');
			const key = (ref: TodoRef) => `${ref.uri.toString()}::${ref.line}::${ref.raw}`;
			const reconciled = await manager.reconcile([todo], key);
			assert.strictEqual(reconciled.length, 2);
			assert.ok(reconciled.every(entry => entry.state === 'dirty' && entry.todoKey === key(todo)));
			await manager.clear(todo, 'body');
			await manager.clear(todo, 'reply', 'comment-0');
			assert.deepStrictEqual(await manager.reconcile([todo], key), []);
		} finally {
			await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
		}
	});
});
