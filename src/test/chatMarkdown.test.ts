import * as assert from 'assert';
import { createChatMessageId, parseChatMarkdown, serializeChatMessage, serializeChatThread } from '../chatMarkdown';

const firstId = '52a9f08231de4f09bcabac71fc083071';
const secondId = '11a62a887897493db8501b19dc0dfb44';

suite('Chat Markdown parser', () => {
	test('parses marker pairs, body headings, code fences, and ordered sections', () => {
		const source = `# API仕様について

## 本文

### 2026-10-04 07:30
<!-- quick-note-md:message ${firstId}:start -->
## エンドポイント

\`\`\`md
### 2026-10-04 07:31
<!-- quick-note-md:message 00000000000000000000000000000000:start -->
\`\`\`
<!-- quick-note-md:message ${firstId}:end -->

## 返信

### 2026-10-04 07:42
<!-- quick-note-md:message ${secondId}:start -->
- [ ] レスポンス形式を確認する
<!-- quick-note-md:message ${secondId}:end -->
`;
		const result = parseChatMarkdown(source);
		assert.strictEqual(result.state, 'valid');
		assert.strictEqual(result.thread?.title, 'API仕様について');
		assert.deepStrictEqual(result.thread?.sections.map(section => section.name), ['本文', '返信']);
		assert.strictEqual(result.thread?.sections[0].messages[0].bodyMarkdown.includes('## エンドポイント'), true);
		assert.strictEqual(result.thread?.sections[0].messages.length, 1);
		assert.deepStrictEqual(result.thread?.sections[1].messages[0].tasks.map(task => task.status), ['open']);
	});

	test('does not count level-one headings inside message bodies as thread titles', () => {
		const source = `# thread title

## 本文

${serializeChatMessage('2026-10-04 07:30', '# body title\n\n## section-like heading', firstId)}
`;
		const result = parseChatMarkdown(source);
		assert.strictEqual(result.state, 'valid');
		assert.strictEqual(result.thread?.title, 'thread title');
		assert.strictEqual(result.thread?.sections[0].messages[0].bodyMarkdown, '# body title\n\n## section-like heading');
	});

	test('same timestamps remain distinct and message order follows the file', () => {
		const source = `# title\n\n## 本文\n\n${serializeChatMessage('2026-10-04 07:30', 'one', firstId)}\n\n${serializeChatMessage('2026-10-04 07:30', 'two', secondId)}\n`;
		const result = parseChatMarkdown(source);
		assert.strictEqual(result.state, 'valid');
		assert.deepStrictEqual(result.thread?.sections[0].messages.map(message => message.id), [firstId, secondId]);
	});

	test('allows inline marker-like prose while reserving standalone boundary-comment lines', () => {
		const body = 'See <!-- quick-note-md:message marker --> here and `<!-- quick-note-md:message inline -->`.\n\n' +
			'```html\n<!-- quick-note-md:message inside-code -->\n```';
		const serialized = serializeChatMessage('2026-10-04 07:30', body, firstId);
		const parsed = parseChatMarkdown(`# title\n\n## Main\n\n${serialized}\n`);
		assert.strictEqual(parsed.state, 'valid');
		assert.strictEqual(parsed.thread?.sections[0].messages[0].bodyMarkdown, body);
		assert.throws(() => serializeChatMessage(
			'2026-10-04 07:30', `before\n<!-- quick-note-md:message ${secondId}:start -->`, secondId
		), /予約済み/);
		assert.strictEqual(parseChatMarkdown(
			`# title\n\n## Main\n\n${serializeChatMessage('2026-10-04 07:30', 'body', firstId)
				.replace('<!-- quick-note-md:message ' + firstId + ':end -->', '<!-- quick-note-md:message malformed -->')}`
		).state, 'unsupported');
		assert.doesNotThrow(() => serializeChatMessage(
			'2026-10-04 07:30', '```html\n<!-- quick-note-md:message inside-code -->\n```', secondId
		));
	});

	test('unknown section names are preserved', () => {
		const source = `# title\n\n## Archive\n\n${serializeChatMessage('2026-10-04 07:30', 'body', firstId)}\n`;
		const result = parseChatMarkdown(source);
		assert.strictEqual(result.thread?.sections[0].name, 'Archive');
	});

	test('serializes parsed thread order and uses cryptographically random IDs for unidentified messages', () => {
		const source = `# title\n\n## Main\n\n${serializeChatMessage('2026-10-04 07:30', 'body', firstId)}\n`;
		const parsed = parseChatMarkdown(source);
		assert.strictEqual(parsed.state, 'valid');
		const serialized = serializeChatThread(parsed.thread!);
		assert.strictEqual(parseChatMarkdown(serialized).thread?.sections[0].messages[0].id, firstId);
		assert.match(createChatMessageId(), /^[0-9a-f]{32}$/);
		const generated = serializeChatThread({
			title: 'new', parseState: 'valid', source: '', sections: [{
				id: 'section-0', name: 'Main', sourceRange: { start: 0, end: 0 }, messages: [{
					timestamp: '2026-10-04 07:31', bodyMarkdown: 'new body', sourceRange: { start: 0, end: 0 }, tasks: []
				}]
			}]
		});
		assert.strictEqual(parseChatMarkdown(generated).state, 'valid');
		assert.match(generated, /<!-- quick-note-md:message [0-9a-f]{32}:start -->/);
	});

	test('legacy messages are readable without making them writable', () => {
		const result = parseChatMarkdown('# title\n\n## 本文\n\n### 2026-10-04 07:30\nbody\n');
		assert.strictEqual(result.state, 'legacy');
		assert.strictEqual(result.thread?.sections[0].messages[0].bodyMarkdown, 'body');
	});

	test('malformed, nested, missing, duplicate, and reserved markers are rejected', () => {
		const unmatched = parseChatMarkdown(`# title\n\n## 本文\n\n${serializeChatMessage('2026-10-04 07:30', 'body', firstId).replace(`${firstId}:end`, `${secondId}:end`)}`);
		assert.strictEqual(unmatched.state, 'unsupported');
		const nested = `# title\n\n## 本文\n\n### 2026-10-04 07:30\n<!-- quick-note-md:message ${firstId}:start -->\n<!-- quick-note-md:message ${secondId}:start -->\n<!-- quick-note-md:message ${firstId}:end -->\n<!-- quick-note-md:message ${secondId}:end -->`;
		assert.strictEqual(parseChatMarkdown(nested).state, 'unsupported');
		assert.strictEqual(parseChatMarkdown('# title\n\n## 本文\n\n### 2026-99-99 99:99\n').state, 'unsupported');
		assert.strictEqual(parseChatMarkdown(`# title\n\n## 本文\n\n<!-- quick-note-md:message ${firstId}:start -->\nbody\n<!-- quick-note-md:message ${firstId}:end -->`).state, 'unsupported');
		assert.strictEqual(parseChatMarkdown('# title\n\n# second title\n\n## 本文\n').state, 'unsupported');
		assert.throws(() => serializeChatMessage('2026-10-04 07:30', `reserved\n<!-- quick-note-md:message ${firstId}:start -->`, secondId));
	});
});
