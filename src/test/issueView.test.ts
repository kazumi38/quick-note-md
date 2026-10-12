import * as assert from 'assert';
import * as vscode from 'vscode';
import { join } from 'path';
import { tmpdir } from 'os';
import { issueDraftStoreUri, validateIssueViewMessage } from '../issueView';

suite('Issue sidebar message validation', () => {
	test('isolates persisted drafts by workspace without exposing the workspace path', () => {
		const globalStorage = vscode.Uri.file(join(tmpdir(), 'quick-note-global'));
		const firstWorkspace = vscode.Uri.file(join(tmpdir(), 'quick-note-first'));
		const secondWorkspace = vscode.Uri.file(join(tmpdir(), 'quick-note-second'));
		const firstDrafts = issueDraftStoreUri(globalStorage, firstWorkspace);
		assert.strictEqual(firstDrafts.toString(), issueDraftStoreUri(globalStorage, firstWorkspace).toString());
		assert.notStrictEqual(firstDrafts.toString(), issueDraftStoreUri(globalStorage, secondWorkspace).toString());
		assert.ok(firstDrafts.path.startsWith(globalStorage.path));
		assert.ok(!firstDrafts.path.includes('quick-note-first'));
	});

	test('accepts only typed, bounded messages without file paths or unknown fields', () => {
		assert.deepStrictEqual(validateIssueViewMessage({ kind: 'ready' }), { kind: 'ready' });
		assert.strictEqual(validateIssueViewMessage({
			kind: 'selectIssue', issueId: 27, snapshotRevision: 1, uri: 'file:///secret',
		}), undefined);
		assert.strictEqual(validateIssueViewMessage({
			kind: 'saveField', operationId: 'op', issueId: -1, field: 'title', value: 'x', baseRevision: 0,
		}), undefined);
		assert.strictEqual(validateIssueViewMessage({
			kind: 'saveField', operationId: 'op', issueId: 27, field: 'unknown', value: 'x', baseRevision: 0,
		}), undefined);
		assert.strictEqual(validateIssueViewMessage({
			kind: 'draftChanged', draftId: 'draft', revision: 0, field: 'body', value: 'x'.repeat(262145),
		}), undefined);
	});

	test('accepts supported title, label, and comment operations', () => {
		assert.deepStrictEqual(validateIssueViewMessage({
			kind: 'saveField', operationId: 'op-1', issueId: 27, field: 'title', value: 'Title', baseRevision: 2,
		}), {
			kind: 'saveField', operationId: 'op-1', issueId: 27, field: 'title', value: 'Title', baseRevision: 2,
		});
		assert.ok(validateIssueViewMessage({
			kind: 'saveField', operationId: 'op-2', issueId: 27, field: 'labels', value: ['bug'], baseRevision: 2,
		}));
		assert.ok(validateIssueViewMessage({
			kind: 'saveField', operationId: 'op-3', issueId: 27, field: 'comment', value: 'reply', baseRevision: 2,
		}));
	});
});
