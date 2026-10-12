import * as assert from 'assert';
import { renderSafeMarkdown } from '../rendering';

suite('Issue Markdown rendering', () => {
	test('keeps raw HTML, links, and remote images inert while preserving Markdown structure', () => {
		const html = renderSafeMarkdown([
			'# Heading',
			'',
			'<script>alert(1)</script>',
			'',
			'[command](command:evil)',
			'',
			'![remote](https://example.invalid/image.png)',
			'',
			'- item',
			'',
			'```ts',
			'const value = 1;',
			'```',
		].join('\n'));
		assert.match(html, /<h1>Heading<\/h1>/);
		assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
		assert.doesNotMatch(html, /<script|<a\b|<img\b|href=|src=/i);
		assert.match(html, /<span class="link">command<\/span>/);
		assert.match(html, /画像: remote/);
		assert.match(html, /<ul>/);
		assert.match(html, /const value = 1;/);
	});
});
