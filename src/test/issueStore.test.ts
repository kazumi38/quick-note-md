import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { IssueStore } from '../issueStore';

suite('IssueStore', () => {
	let directory: string;
	let store: IssueStore;

	setup(async () => {
		directory = await mkdtemp(join(tmpdir(), 'quick-note-issues-'));
		store = new IssueStore(vscode.Uri.file(directory));
	});

	teardown(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	test('creates one Markdown file with a durable sequence ledger and no metadata sidecar', async () => {
		const first = await store.create({ title: '  First Issue  ', bodyMarkdown: '' });
		assert.strictEqual(first.id, 1);
		assert.strictEqual(first.title, 'First Issue');
		assert.strictEqual(first.state, 'open');
		assert.deepStrictEqual(first.labels, []);
		assert.deepStrictEqual(first.comments, []);
		const files = await import('fs/promises').then(fs => fs.readdir(store.root.fsPath));
		assert.ok(files.includes('issue-000001.md'));
		assert.ok(files.includes('.sequence.md'));
		assert.ok(!files.some(file => file.endsWith('.meta')));
	});

	test('searches title and body, counts all states, and lists malformed records read-only', async () => {
		const one = await store.create({ title: '日本語 issue', bodyMarkdown: 'Needle in the body' });
		await store.update(one.id, one.revision, { state: 'closed' });
		const two = await store.create({ title: 'Other', bodyMarkdown: 'text' });
		await writeFile(join(store.root.fsPath, 'issue-000003.md'), '<!-- quick-note-md:issue:v1 {broken} -->\n');
		const result = await store.list({ query: 'needle', state: 'all' });
		assert.deepStrictEqual(result.issues.map(issue => issue.id), [1]);
		assert.strictEqual(result.openCount, 1);
		assert.strictEqual(result.closedCount, 1);
		assert.strictEqual(result.invalid.length, 1);
		assert.strictEqual(result.invalid[0].raw, '<!-- quick-note-md:issue:v1 {broken} -->\n');
		assert.strictEqual((await store.list({ state: 'closed' })).issues[0].id, 1);
		assert.strictEqual(two.id, 2);
	});

	test('updates a single field and rejects stale revisions without replacing external content', async () => {
		const issue = await store.create({ title: 'Initial', bodyMarkdown: 'Body' });
		const path = join(store.root.fsPath, 'issue-000001.md');
		const original = await readFile(path, 'utf8');
		const external = original.replace('Body', 'External');
		await writeFile(path, external);
		await assert.rejects(store.update(issue.id, issue.revision, { title: 'Stale' }), /changed after editing/);
		assert.strictEqual(await readFile(path, 'utf8'), external);
	});

	test('refuses writes when the same Issue is dirty in a VS Code editor', async () => {
		const issue = await store.create({ title: 'Initial', bodyMarkdown: 'Body' });
		const uri = vscode.Uri.file(join(store.root.fsPath, 'issue-000001.md'));
		const document = await vscode.workspace.openTextDocument(uri);
		const edit = new vscode.WorkspaceEdit();
		edit.insert(uri, new vscode.Position(document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length), 'unsaved');
		assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
		assert.strictEqual(document.isDirty, true);
		await assert.rejects(store.update(issue.id, issue.revision, { title: 'Must not overwrite' }), /unsaved editor changes/);
		assert.strictEqual((await store.read(issue.id))?.issue?.title, 'Initial');
		await document.save();
	});

	test('preserves created time, comments, and unrelated files when editing a title', async () => {
		const issue = await store.create({ title: 'Initial', bodyMarkdown: 'Body' });
		const withComment = await store.update(issue.id, issue.revision, {
			comment: { bodyMarkdown: 'First comment' },
		});
		const other = join(store.root.fsPath, 'unrelated.txt');
		await writeFile(other, 'untouched');
		const renamed = await store.update(withComment.id, withComment.revision, { title: 'Renamed' });
		assert.strictEqual(renamed.title, 'Renamed');
		assert.strictEqual(renamed.createdAt, issue.createdAt);
		assert.deepStrictEqual(renamed.comments, withComment.comments);
		assert.strictEqual(await readFile(other, 'utf8'), 'untouched');
	});

	test('never reuses IDs after deletion and rejects empty titles or whitespace comments', async () => {
		const first = await store.create({ title: 'First', bodyMarkdown: '' });
		await rm(join(store.root.fsPath, 'issue-000001.md'));
		const second = await store.create({ title: 'Second', bodyMarkdown: '' });
		assert.strictEqual(second.id, 2);
		await assert.rejects(store.create({ title: '  ', bodyMarkdown: '' }), /title/);
		await assert.rejects(store.update(second.id, second.revision, { comment: { bodyMarkdown: '  ' } }), /Comment/);
		assert.strictEqual(first.id, 1);
	});

	test('keeps invalid source intact and does not follow an Issue-file symlink', async function () {
		const raw = '<!-- quick-note-md:issue:v9 {} -->\n';
		const file = join(store.root.fsPath, 'issue-000001.md');
		await import('fs/promises').then(fs => fs.mkdir(store.root.fsPath, { recursive: true }));
		await writeFile(file, raw);
		const malformed = await store.read(1);
		assert.strictEqual(malformed?.issue, undefined);
		assert.strictEqual(malformed?.raw, raw);
		assert.strictEqual((await readFile(file, 'utf8')), raw);
	});

	test('surfaces valid and incomplete interrupted-write recovery files without adopting them', async () => {
		const issue = await store.create({ title: 'Canonical', bodyMarkdown: 'Original' });
		const path = join(store.root.fsPath, 'issue-000001.md.interrupted.tmp');
		const valid = await readFile(join(store.root.fsPath, 'issue-000001.md'), 'utf8');
		await writeFile(path, valid.replace('Original', 'Recovery copy'));
		const result = await store.list();
		assert.strictEqual(result.issues[0].bodyMarkdown, 'Original');
		assert.match(result.invalid[0].error!, /recovery file was preserved/);
		assert.strictEqual((await readFile(path, 'utf8')).includes('Recovery copy'), true);
		assert.strictEqual(issue.id, 1);
	});

	test('keeps 100 create and update operations isolated with exactly one comment per Issue', async function () {
		this.timeout(60_000);
		const sentinel = await store.create({ title: 'Untouched', bodyMarkdown: 'Keep this Issue unchanged.' });
		for (let index = 0; index < 50; index++) {
			const created = await store.create({ title: `Issue ${index}`, bodyMarkdown: `Body ${index}` });
			const updated = await store.update(created.id, created.revision, {
				title: `Updated ${index}`,
				bodyMarkdown: `Updated body ${index}`,
				labels: [`label-${index}`],
				comment: { bodyMarkdown: `Comment ${index}` },
			});
			assert.strictEqual(updated.comments.length, 1);
			assert.strictEqual(updated.comments[0].bodyMarkdown, `Comment ${index}`);
			assert.strictEqual(updated.title, `Updated ${index}`);
		}

		const result = await store.list();
		assert.strictEqual(result.issues.length, 51);
		assert.strictEqual(result.issues.reduce((total, issue) => total + issue.comments.length, 0), 50);
		assert.strictEqual((await store.read(sentinel.id))?.issue?.revision, sentinel.revision);
		assert.strictEqual((await store.read(sentinel.id))?.issue?.bodyMarkdown, 'Keep this Issue unchanged.');
	});
});
