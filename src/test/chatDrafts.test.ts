import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { ChatDraftStore, fingerprint, validateComposerDraft } from '../chatDrafts';

async function withStore(test: (store: ChatDraftStore, storage: vscode.Uri) => Promise<void>): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), 'quick-note-drafts-'));
	const storage = vscode.Uri.file(directory);
	try { await test(new ChatDraftStore(storage), storage); }
	finally { await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}

suite('Chat drafts', () => {
	test('validates versioned drafts and retains independent section targets', () => {
		const draft = validateComposerDraft({
			schemaVersion: 1,
			draftId: 'a'.repeat(32),
			target: { chatId: 'b'.repeat(32), sectionId: 'section-1' },
			title: 'title',
			markdown: '**draft**',
			baseFingerprint: fingerprint('# source'),
			revision: 3,
			updatedAt: 1
		});
		assert.strictEqual(draft.target.sectionId, 'section-1');
		assert.strictEqual(draft.revision, 3);
		assert.notStrictEqual(fingerprint('# source'), fingerprint('# changed'));
	});

	test('rejects malformed, oversized, and unknown schema data', () => {
		assert.throws(() => validateComposerDraft({ schemaVersion: 2 }), /スキーマ/);
		assert.throws(() => validateComposerDraft({
			schemaVersion: 1, draftId: 'bad', target: { sectionId: 'x' }, markdown: '',
			baseFingerprint: null, revision: 0, updatedAt: 0
		}), /破損/);
		assert.throws(() => validateComposerDraft({
			schemaVersion: 1, draftId: 'a'.repeat(32), target: { sectionId: 'x' }, markdown: 'x'.repeat(32001),
			baseFingerprint: null, revision: 0, updatedAt: 0
		}), /破損/);
		assert.throws(() => validateComposerDraft({
			schemaVersion: 1, draftId: 'a'.repeat(32), target: { chatId: '../file', sectionId: 'x' }, markdown: '',
			baseFingerprint: null, revision: 0, updatedAt: 0
		}), /破損/);
	});

	test('persists, lists, restores, and removes drafts independently', async () => {
		await withStore(async (store) => {
			const draft = validateComposerDraft({
				schemaVersion: 1, draftId: 'c'.repeat(32), target: { chatId: 'd'.repeat(32), sectionId: '返信' },
				markdown: '**reply**', baseFingerprint: fingerprint('source'), revision: 4, updatedAt: 2
			});
			await store.save(draft);
			assert.deepStrictEqual(await store.load(draft.draftId), draft);
			assert.deepStrictEqual((await store.list()).drafts, [draft]);
			await store.remove(draft.draftId);
			assert.strictEqual(await store.load(draft.draftId), undefined);
			assert.deepStrictEqual((await store.list()).drafts, []);
		});
	});

	test('keeps chat and section drafts separate across both matching and changed source fingerprints', async () => {
		await withStore(async store => {
			const source = '# chat';
			const first = validateComposerDraft({
				schemaVersion: 1, draftId: '1'.repeat(32),
				target: { chatId: 'a'.repeat(32), sectionId: '本文' },
				markdown: 'body draft', baseFingerprint: fingerprint(source), revision: 1, updatedAt: 1
			});
			const second = validateComposerDraft({
				schemaVersion: 1, draftId: '2'.repeat(32),
				target: { chatId: 'a'.repeat(32), sectionId: '返信' },
				markdown: 'reply draft', baseFingerprint: fingerprint(source), revision: 3, updatedAt: 2
			});
			const third = validateComposerDraft({
				schemaVersion: 1, draftId: '3'.repeat(32),
				target: { chatId: 'b'.repeat(32), sectionId: '返信' },
				markdown: 'other chat', baseFingerprint: fingerprint('# changed'), revision: 2, updatedAt: 3
			});
			await Promise.all([store.save(first), store.save(second), store.save(third)]);
			const restored = (await store.list()).drafts;
			assert.deepStrictEqual(restored.map(draft => draft.draftId).sort(),
				[first.draftId, second.draftId, third.draftId].sort());
			assert.strictEqual(restored.find(draft => draft.draftId === first.draftId)?.baseFingerprint,
				fingerprint(source));
			assert.notStrictEqual(restored.find(draft => draft.draftId === third.draftId)?.baseFingerprint,
				fingerprint(source));
			assert.deepStrictEqual(restored.map(draft => draft.target.sectionId).sort(), ['本文', '返信', '返信']);
		});
	});

	test('reports corrupt persisted entries without treating them as drafts', async () => {
		await withStore(async (_store, storage) => {
			const draftId = 'e'.repeat(32);
			const filename = `${createHash('sha256').update(draftId).digest('hex')}.json`;
			await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(storage, filename), Buffer.from('{"schemaVersion":99}'));
			const listed = await new ChatDraftStore(storage).list();
			assert.strictEqual(listed.drafts.length, 0);
			assert.match(listed.errors[0], /スキーマ/);
			await assert.rejects(new ChatDraftStore(storage).load(draftId), /スキーマ/);
		});
	});
});
