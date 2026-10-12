import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { IssueDraftStore, validateIssueDraft } from '../issueDrafts';

suite('Issue draft store', () => {
	let directory: string;
	let store: IssueDraftStore;

	setup(async () => {
		directory = await mkdtemp(join(tmpdir(), 'quick-note-issue-drafts-'));
		store = new IssueDraftStore(vscode.Uri.file(directory));
	});

	teardown(async () => { await rm(directory, { recursive: true, force: true }); });

	test('persists, lists, loads, and removes drafts without touching sibling files', async () => {
		const draft = {
			draftId: 'draft-1',
			issueId: 27,
			field: 'comment' as const,
			value: 'unsaved comment',
			baseRevision: 4,
			status: 'dirty' as const,
		};
		await store.save(draft);
		assert.deepStrictEqual(await store.load(draft.draftId), draft);
		assert.deepStrictEqual(await store.list(), [draft]);
		await store.remove(draft.draftId);
		assert.strictEqual(await store.load(draft.draftId), undefined);
	});

	test('validates schema, field, revision, and bounded input', () => {
		const draft = {
			draftId: 'new',
			field: 'title' as const,
			value: 'Title',
			baseRevision: 0,
			status: 'dirty' as const,
		};
		assert.deepStrictEqual(validateIssueDraft(draft), draft);
		assert.throws(() => validateIssueDraft({ ...draft, baseRevision: -1 }));
		assert.throws(() => validateIssueDraft({ ...draft, field: 'legacy' }));
		assert.throws(() => validateIssueDraft({ ...draft, value: 'x'.repeat(600000) }));
	});
});
