import * as assert from 'assert';
import { parseChatMarkdown, serializeChatMessage } from '../chatMarkdown';

const messageId = '52a9f08231de4f09bcabac71fc083071';

suite('Chat Markdown compatibility', () => {
	test('preserves section and message file order without splitting message body headings', () => {
		const source = `# title

## Archive

${serializeChatMessage('2026-10-04 07:30', '### 2026-10-04 07:31\n## Archive', messageId)}

## Replies
`;
		const result = parseChatMarkdown(source);
		assert.strictEqual(result.state, 'valid');
		assert.deepStrictEqual(result.thread?.sections.map(section => section.name), ['Archive', 'Replies']);
		assert.strictEqual(result.thread?.sections[0].messages[0].bodyMarkdown, '### 2026-10-04 07:31\n## Archive');
	});

	test('reads legacy messages but rejects malformed titles, timestamps, and marker pairs for writing', () => {
		assert.strictEqual(parseChatMarkdown('# title\n\n## Main\n\n### 2026-10-04 07:30\nbody').state, 'legacy');
		for (const source of [
			'## Main\n',
			'# title\n\n# second\n\n## Main\n',
			'# title\n\n## Main\n\n### 2026-99-99 25:61\nbody',
			`# title\n\n## Main\n\n${serializeChatMessage('2026-10-04 07:30', 'body', messageId).replace(`${messageId}:end`, `${messageId}:start`)}`
		]) {
			assert.strictEqual(parseChatMarkdown(source).state, 'unsupported', source);
		}
	});
});
