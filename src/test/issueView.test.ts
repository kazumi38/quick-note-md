import * as assert from 'assert';
import * as vscode from 'vscode';
import { join } from 'path';
import { tmpdir } from 'os';
import { IssueView, issueDraftStoreUri, validateIssueViewMessage } from '../issueView';

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

	test('accepts optional bounded label filters and rejects malformed filter messages', () => {
		assert.deepStrictEqual(validateIssueViewMessage({
			kind: 'setFilter', query: '', stateFilter: 'all',
		}), { kind: 'setFilter', query: '', stateFilter: 'all' });
		assert.deepStrictEqual(validateIssueViewMessage({
			kind: 'setFilter', query: 'needle', stateFilter: 'closed', label: 'bug',
		}), { kind: 'setFilter', query: 'needle', stateFilter: 'closed', label: 'bug' });
		assert.deepStrictEqual(validateIssueViewMessage({
			kind: 'setFilter', query: '', stateFilter: 'all', label: '',
		}), { kind: 'setFilter', query: '', stateFilter: 'all', label: '' });
		assert.strictEqual(validateIssueViewMessage({
			kind: 'setFilter', query: '', stateFilter: 'all', label: 1,
		}), undefined);
		assert.strictEqual(validateIssueViewMessage({
			kind: 'setFilter', query: '', stateFilter: 'all', label: 'x'.repeat(1001),
		}), undefined);
		assert.strictEqual(validateIssueViewMessage({
			kind: 'setFilter', query: '', stateFilter: 'all', label: 'bug', unexpected: true,
		}), undefined);
	});

	test('retains query, state, and label when navigating back to the list', async () => {
		const view = new IssueView({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		const internal = view as unknown as {
			query: string;
			stateFilter: 'all' | 'open' | 'closed';
			labelFilter?: string;
			selectedIssueId?: number;
			refresh: () => Promise<void>;
			handleMessage: (value: unknown) => Promise<void>;
		};
		internal.query = 'needle';
		internal.stateFilter = 'closed';
		internal.labelFilter = 'bug';
		internal.selectedIssueId = 42;
		internal.refresh = async () => undefined;

		await internal.handleMessage({ kind: 'backToList' });

		assert.strictEqual(internal.query, 'needle');
		assert.strictEqual(internal.stateFilter, 'closed');
		assert.strictEqual(internal.labelFilter, 'bug');
		assert.strictEqual(internal.selectedIssueId, undefined);
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
