import * as assert from 'assert';
import { appendText, parseTodoComments, parseTodos, safeFileName, serializeComments, serializeTodoMetadata, statusInfo, statusOrder } from '../core';

suite('Markdown core', () => {
	test('all statuses, uppercase X, ordered and nested lists retain source coordinates', () => {
		const source = '- [ ] 一\n- [x] 二\n- [X] 三\n- [n] 四\n- [-] 五\n- [!] 六\n- [i] 七\n  - [ ] 😀 nested\n1. [x] ordered';
		const todos = parseTodos(source);
		assert.deepStrictEqual(todos.map(todo => todo.status), ['open', 'done', 'done', 'note', 'skip', 'warn', 'important', 'open', 'done']);
		assert.strictEqual(todos[7].markerStart, 4);
		assert.strictEqual(todos[7].line, 7);
		assert.strictEqual(todos[7].text, '😀 nested');
		assert.strictEqual(statusOrder[0], 'important');
		assert.strictEqual(statusInfo.important.marker, 'i');
	});

	test('code fences and indented code are excluded, including nested fenced code', () => {
		const source = '````md\n- [ ] hidden\n````\n\n    - [ ] indented\n\n- [ ] visible\n  ```\n  - [x] nested code\n  ```\n  - [n] nested real\n\n~~~\n- [!] hidden too\n~~~';
		assert.deepStrictEqual(parseTodos(source).map(todo => todo.text), ['visible', 'nested real']);
	});

	test('malformed markers remain unknown and duplicate tasks retain independent rows', () => {
		const todos = parseTodos('- [?] mystery\n- [xx] broken\n- [ incomplete\n- [ ]missing-space\n- [ ] same\n- [ ] same');
		assert.deepStrictEqual(todos.map(todo => todo.status), ['unknown', 'unknown', 'unknown', 'unknown', 'open', 'open']);
		assert.strictEqual(todos[4].line, 4);
		assert.strictEqual(todos[5].line, 5);
		assert.strictEqual(todos[0].raw, '- [?] mystery');
	});

	test('CRLF parsing, plain prose and escaped brackets are safe', () => {
		assert.deepStrictEqual(parseTodos('prose [ ] ignored\r\n- \\[ ] escaped\r\n- [!] yes\r\n').map(todo => [todo.line, todo.raw]), [[2, '- [!] yes']]);
		assert.deepStrictEqual(parseTodos(''), []);
	});

	test('missing list spacing is unknown, while Markdown links and code remain excluded', () => {
		const todos = parseTodos('-[ ] broken\n- [label](url)\n- [label][reference]\n- [label]: url\n\n```\n-[ ] fenced\n```\n\n    -[ ] indented\n\n-[x] broken too');
		assert.deepStrictEqual(todos.map(todo => [todo.line, todo.status, todo.raw]), [
			[0, 'unknown', '-[ ] broken'],
			[11, 'unknown', '-[x] broken too'],
		]);
	});

	test('shortcut reference links are not unknown Todos but task text may contain links', () => {
		const todos = parseTodos('- [release]\n\n[release]: https://example.com\n\n- [ ] [link](https://example.com)\n- [x] [release]');
		assert.deepStrictEqual(todos.map(todo => [todo.line, todo.status, todo.text]), [
			[4, 'open', '[link](https://example.com)'],
			[5, 'done', '[release]'],
		]);
	});

	test('comment blocks retain order and checkbox-like Markdown is not parsed as Todo', () => {
		const source = '- [!] task\r\n<!-- quick-note-md:comments -->\r\n<!-- quick-note-md:comment -->\r\n# 背景\r\n- [ ] check later\r\n<!-- quick-note-md:end-comment -->\r\n<!-- quick-note-md:comment -->\r\n対応方針\r\n<!-- quick-note-md:end-comment -->\r\n<!-- quick-note-md:end-comments -->\r\n- [ ] next\r\n';
		const todos = parseTodos(source);
		assert.deepStrictEqual(todos.map(todo => todo.text), ['task', 'next']);
		const set = parseTodoComments(source, todos[0], 'notes/todo.md');
		assert.strictEqual(set.readOnly, false);
		assert.deepStrictEqual(set.comments.map(comment => comment.bodyMarkdown), ['# 背景\n- [ ] check later', '対応方針']);
		assert.strictEqual(set.comments[0].order, 0);
		assert.ok(serializeComments(set.comments.map(comment => comment.bodyMarkdown), '\r\n').includes('\r\n<!-- quick-note-md:end-comments -->'));
	});

	test('Todo metadata is optional, preserved for old rows, and parsed independently of replies', () => {
		const source = '- [ ] task\n<!-- quick-note-md:meta labels="IMP, 顧客" due="2026-10-01" -->\n'
			+ '<!-- quick-note-md:comments -->\n<!-- quick-note-md:comment -->\n- [ ] reply checkbox\n'
			+ '<!-- quick-note-md:end-comment -->\n<!-- quick-note-md:end-comments -->\n- [ ] old';
		const todos = parseTodos(source);
		assert.deepStrictEqual(todos.map(todo => [todo.text, todo.labels, todo.dueDate]), [
			['task', ['IMP', '顧客'], '2026-10-01'],
			['old', [], undefined],
		]);
		assert.deepStrictEqual(parseTodoComments(source, todos[0]).comments[0].bodyMarkdown, '- [ ] reply checkbox');
		assert.strictEqual(serializeTodoMetadata([' IMP ', 'IMP'], '2026-10-01'), '<!-- quick-note-md:meta labels="IMP" due="2026-10-01" -->\n');
	});

	test('malformed comment boundaries are preserved as read-only data', () => {
		const todo = parseTodos('- [ ] task\n<!-- quick-note-md:comments -->\n<!-- quick-note-md:comment -->\nunfinished')[0];
		const set = parseTodoComments('- [ ] task\n<!-- quick-note-md:comments -->\n<!-- quick-note-md:comment -->\nunfinished', todo);
		assert.strictEqual(set.readOnly, true);
		assert.ok(set.warning);
		assert.ok(set.sourceText.includes('unfinished'));
	});

	for (const eol of ['\n', '\r\n']) {
		test(`append only returns suffix preserving ${JSON.stringify(eol)}`, () => {
			assert.strictEqual(appendText('', 'first', eol), `first${eol}`);
			assert.strictEqual(appendText(`old${eol}`, 'next'), `next${eol}`);
			assert.strictEqual(appendText(`old${eol}last`, 'next'), `${eol}next${eol}`);
			let text = `original${eol}`;
			for (let index = 0; index < 10; index++) { text += appendText(text, `追加 ${index}`); }
			assert.strictEqual(text, `original${eol}` + Array.from({ length: 10 }, (_, index) => `追加 ${index}${eol}`).join(''));
		});
	}

	test('appending to a final non-newline row and invalid inputs', () => {
		assert.strictEqual(appendText('existing', 'new'), '\nnew\n');
		for (const input of ['', '  ', 'a\nb', 'a\rb', 'a\u0000b']) { assert.throws(() => appendText('', input)); }
		assert.throws(() => appendText('', 'a', '\r'));
	});

	test('filenames allow Japanese but never separators, reserved names, or trailing dots', () => {
		assert.strictEqual(safeFileName('日本語メモ'), '日本語メモ');
		assert.strictEqual(safeFileName(' a/b\\c:*?"<>|. '), 'abc');
		for (const name of ['', '..', '...', '/\\:*?', 'CON', 'nul.md', 'COM1', 'lpt9.log', 'LPT¹']) {
			assert.throws(() => safeFileName(name), name);
		}
		assert.throws(() => safeFileName('あ'.repeat(100)));
	});
});
