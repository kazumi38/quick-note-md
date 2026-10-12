import * as assert from 'assert';
import { validateMetadata, validateRevision } from '../issueMetadata';

suite('Issue metadata validation', () => {
	const metadata = {
		id: 1,
		title: '  title  ',
		state: 'open',
		labels: [' bug ', 'Bug'],
		createdAt: '2026-10-12T06:00:00.000Z',
		updatedAt: '2026-10-12T06:00:00.000Z',
	};

	test('normalizes title and labels and permits distinct case-sensitive labels', () => {
		assert.deepStrictEqual(validateMetadata(metadata), {
			...metadata,
			title: 'title',
			labels: ['bug', 'Bug'],
		});
	});

	test('rejects invalid IDs, empty titles, unsupported state, invalid timestamps and duplicate labels', () => {
		for (const value of [
			{ ...metadata, id: 0 },
			{ ...metadata, title: '  ' },
			{ ...metadata, state: 'blocked' },
			{ ...metadata, createdAt: 'not a timestamp' },
			{ ...metadata, createdAt: '2026-02-31T06:00:00Z' },
			{ ...metadata, labels: ['bug', ' bug '] },
			{ ...metadata, labels: ['   '] },
		]) {
			assert.throws(() => validateMetadata(value));
		}
	});

	test('accepts only non-negative integer revisions', () => {
		assert.strictEqual(validateRevision(0), 0);
		assert.throws(() => validateRevision(-1));
		assert.throws(() => validateRevision(1.5));
	});
});
