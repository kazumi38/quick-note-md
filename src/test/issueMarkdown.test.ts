import * as assert from 'assert';
import { IssueRecord, validateMetadata } from '../issueMetadata';
import { parseIssueMarkdown, serializeIssueMarkdown } from '../issueMarkdown';
import { renderSafeMarkdown } from '../rendering';

const metadata = {
	id: 27,
	title: 'Markdownプレビューで日本語の見出しが崩れる',
	state: 'open' as const,
	labels: ['bug', 'エディター'],
	createdAt: '2026-10-12T01:00:00.000Z',
	updatedAt: '2026-10-12T06:00:00.000Z',
};

function document(bodyMarkdown = '## 現象\n\n説明本文。', comments: Array<{ id: string; createdAt: string; bodyMarkdown: string }> = []): string {
	return serializeIssueMarkdown({ ...metadata, bodyMarkdown, comments } satisfies Omit<IssueRecord, 'revision'>);
}

suite('Issue Markdown format', () => {
	test('round-trips issue metadata, markdown body, and ordered comments without sidecars', () => {
		const source = document('## 現象\n\n説明本文。', [
			{ id: 'c1', createdAt: '2026-10-11T08:00:00.000Z', bodyMarkdown: '最初のコメント。' },
			{ id: 'c2', createdAt: '2026-10-12T06:00:00.000Z', bodyMarkdown: '- 再現した\n- 修正待ち' },
		]);
		const parsed = parseIssueMarkdown(source, 27);
		assert.deepStrictEqual(parsed, {
			...metadata,
			bodyMarkdown: '## 現象\n\n説明本文。',
			comments: [
				{ id: 'c1', createdAt: '2026-10-11T08:00:00.000Z', bodyMarkdown: '最初のコメント。' },
				{ id: 'c2', createdAt: '2026-10-12T06:00:00.000Z', bodyMarkdown: '- 再現した\n- 修正待ち' },
			],
		});
		assert.doesNotMatch(source, /\.meta/);
		assert.match(source, /<!-- quick-note-md:comment:v1/);
		const rendered = renderSafeMarkdown(parsed.bodyMarkdown);
		assert.doesNotMatch(rendered, /quick-note-md:/);
	});

	test('supports empty body, no comments, unicode, and CRLF', () => {
		const source = serializeIssueMarkdown({ ...metadata, bodyMarkdown: '', comments: [] }, '\r\n');
		assert.ok(source.includes('\r\n'));
		assert.deepStrictEqual(parseIssueMarkdown(source, 27), { ...metadata, bodyMarkdown: '', comments: [] });
		const body = '  lead\n\ntrailing\n';
		const crlf = serializeIssueMarkdown({ ...metadata, bodyMarkdown: body.replace(/\n/g, '\r\n'), comments: [] }, '\r\n');
		assert.strictEqual(parseIssueMarkdown(crlf).bodyMarkdown, body.replace(/\n/g, '\r\n'));
	});

	test('escapes comment terminators in metadata JSON', () => {
		const custom = validateMetadata({ ...metadata, title: 'literal --> value' });
		const source = serializeIssueMarkdown({ ...custom, bodyMarkdown: '', comments: [] });
		assert.doesNotMatch(source.split('\n')[0], /literal --> value/);
		assert.strictEqual(parseIssueMarkdown(source).title, 'literal --> value');
	});

	test('rejects invalid metadata, unknown markers, filename mismatch, and broken comment ranges', () => {
		assert.throws(() => validateMetadata({ ...metadata, title: '  ' }));
		assert.throws(() => parseIssueMarkdown(document(), 28), /does not match/);
		assert.throws(() => parseIssueMarkdown(document().replace('issue:v1', 'issue:v2')), /unsupported/);
		assert.throws(() => parseIssueMarkdown(document().replace('issue:v1 {', 'issue:v1 {broken} {')), /JSON|position/i);
	});

	test('rejects duplicate IDs, missing boundaries, and reserved markers in user content', () => {
		const valid = document('body', [
			{ id: 'dup', createdAt: '2026-10-11T08:00:00Z', bodyMarkdown: 'first' },
			{ id: 'unique', createdAt: '2026-10-12T08:00:00Z', bodyMarkdown: 'second' },
		]);
		const duplicate = valid.replace('"id":"unique"', '"id":"dup"');
		assert.throws(() => parseIssueMarkdown(duplicate), /duplicated/);
		const missingEnd = valid.replace('<!-- quick-note-md:end-comments -->', '');
		assert.throws(() => parseIssueMarkdown(missingEnd), /not closed/);
		const duplicateBoundary = valid.replace(
			'<!-- quick-note-md:comments:v1 -->',
			'<!-- quick-note-md:comments:v1 -->\n<!-- quick-note-md:comments:v1 -->',
		);
		assert.throws(() => parseIssueMarkdown(duplicateBoundary), /start marker/);
		assert.throws(() => serializeIssueMarkdown({ ...metadata, bodyMarkdown: '<!-- quick-note-md:comments:v1 -->', comments: [] }));
	});
});
