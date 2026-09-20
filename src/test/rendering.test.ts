import * as assert from 'assert';
import * as vscode from 'vscode';
import { DocumentStore } from '../documents';
import { NoteEditor } from '../editor';
import { maxEditLength, renderNote, validateRenderedEdit } from '../rendering';

suite('安全なレンダリングと本文の編集', () => {
	test('見出し・強調・改行を変更せず UTF-16 本文だけ編集する', () => {
		const source = '# 😀 **太字** と *斜体* ##\r\n\r\n本文\r\n';
		const rendered = renderNote(source);
		assert.match(rendered.html, /<h1>/);
		assert.match(rendered.html, /<strong>/);
		assert.match(rendered.html, /<em>/);
		for (const span of rendered.spans) {
			assert.strictEqual(source.slice(span.start, span.end), span.text);
		}
		const target = rendered.spans.find(span => span.text === '太字')!;
		const span = validateRenderedEdit(source, target.id, target.text, '😀変更');
		assert.strictEqual(
			source.slice(0, span.start) + '😀変更' + source.slice(span.end),
			'# 😀 **😀変更** と *斜体* ##\r\n\r\n本文\r\n'
		);
	});

	test('段落・ATX 見出し・平坦な順序あり/なしリストに対応する', () => {
		for (const source of ['本文', '# 見出し', '### 見出し ###', '- 本文', '+ 本文', '* 本文', '12. 本文', '3) 本文']) {
			const span = renderNote(source).spans[0];
			assert.ok(span, source);
			assert.strictEqual(source.slice(span.start, span.end), span.text);
			assert.doesNotThrow(() => validateRenderedEdit(source, span.id, span.text, '変更'));
		}
	});

	test('太字・斜体・ネストした強調の記号をそのまま保持する', () => {
		for (const source of ['**bold**', '__bold__', '*italic*', '_italic_', '***both***', '**a *b* c**']) {
			const spans = renderNote(source).spans;
			assert.ok(spans.length, source);
			for (const span of spans) {
				assert.doesNotThrow(() => validateRenderedEdit(source, span.id, span.text, 'replacement'), source);
			}
		}
	});

	test('Todo 本文の編集は全ステータス記号と他の行を保持する', () => {
		const labels = ['未完了', '完了', '完了', 'Note', 'Skip', 'Warn', 'IMP'];
		[' ', 'x', 'X', 'n', '-', '!', 'i'].forEach((marker, index) => {
			const source = `- [${marker}] **項目**\r\n- [ ] 次\r\n`;
			const rendered = renderNote(source);
			assert.ok(rendered.html.includes(labels[index]));
			const target = rendered.spans[0];
			const span = validateRenderedEdit(source, target.id, target.text, '変更');
			assert.strictEqual(
				source.slice(0, span.start) + '変更' + source.slice(span.end),
				`- [${marker}] **変更**\r\n- [ ] 次\r\n`
			);
		});
	});

	test('空ファイルへ入力できる', () => {
		const span = validateRenderedEdit('', '0:0', '', '新規');
		assert.deepStrictEqual([span.start, span.end], [0, 0]);
		assert.doesNotThrow(() => validateRenderedEdit('本文', '0:0', '本文', ''));
	});

	test('複雑・不明・壊れた Markdown を編集不可にする', () => {
		for (const source of [
			'```\ncode\n```', '    code', '> quote', '| a | b |\n|---|---|\n| c | d |',
			'- parent\n  - nested', '- item\n  continuation', 'line one\nline two', 'Setext\n===',
			'![image](https://example.com/image.png)', '[link](https://example.com)', '`code`',
			'- [?] unknown', '- [xx] broken', '**broken', 'a &amp; b', 'a \\* b',
			'<b>HTML</b>', '~~strike~~'
		]) {
			assert.deepStrictEqual(renderNote(source).spans, [], source);
			assert.throws(() => validateRenderedEdit(source, '0:0', source, 'overwrite'), source);
		}
	});

	test('HTML・危険なリンク・画像は実行可能な HTML を作らない', () => {
		const source = '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n'
			+ '[command](command:evil)\n\n[data](data:text/html,evil)\n\n'
			+ '[https](https://example.com)\n\n![alt](https://example.com/a.png)';
		const { html } = renderNote(source);
		assert.ok(!/<script|<img|<a\b|href=|src=|onerror="/.test(html));
		assert.ok(html.includes('&lt;script&gt;'));
		assert.ok(html.includes('画像: alt'));
	});

	test('範囲偽装・古い本文・構造を変える入力を拒否する', () => {
		for (const [id, before, text] of [
			['1:0', '本文', '変更'], ['0:0', 'old', '変更'], ['0:0', '本文', '# heading'],
			['0:0', '本文', '- list'], ['0:0', '本文', '---'], ['0:0', '本文', 'one\ntwo'],
			['0:0', '本文', '**bold**'], ['0:0', '本文', '<script>'],
			['0:0', '本文', '\u0000'], ['0:0', '本文', 'x'.repeat(maxEditLength + 1)]
		]) {
			assert.throws(() => validateRenderedEdit('本文', id, before, text));
		}
		assert.throws(() => validateRenderedEdit('**bold**', '0:0', 'bold', ''));
		assert.throws(() => validateRenderedEdit('**bold**', '0:0', 'bold', ' leading'));
	});
});

suite('レンダリング Webview の境界', () => {
	test('バインドした文書と検証済み本文範囲だけを保存する', async () => {
		const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: '# **本文**' });
		const messages: Record<string, unknown>[] = [];
		const edits: unknown[][] = [];
		let receive: (message: unknown) => Promise<void>;
		let dispose: () => void;
		const noop = () => ({ dispose() {} });
		const webview = {
			options: {}, html: '', cspSource: 'vscode-webview:',
			asWebviewUri: (uri: vscode.Uri) => uri,
			postMessage: async (message: Record<string, unknown>) => { messages.push(message); return true; },
			onDidReceiveMessage: (listener: typeof receive) => { receive = listener; return noop(); }
		};
		const panel = {
			webview, active: true,
			onDidChangeViewState: noop,
			onDidDispose: (listener: () => void) => { dispose = listener; return noop(); }
		} as unknown as vscode.WebviewPanel;
		const store = { edit: async (...args: unknown[]) => { edits.push(args); return document.version; } } as unknown as DocumentStore;
		const context = { extensionUri: vscode.Uri.file(process.cwd()) } as vscode.ExtensionContext;
		const editor = new NoteEditor(context, store);
		editor.resolveCustomTextEditor(document, panel);
		try {
			assert.strictEqual(editor.activeUri?.toString(), document.uri.toString());
			assert.match(webview.html, /default-src 'none'/);
			assert.match(webview.html, /script-src 'nonce-/);
			assert.ok(!webview.html.includes('# **本文**'));
			assert.match(webview.html, /生 Markdown を表示/);
			assert.deepStrictEqual(
				(webview.options as vscode.WebviewOptions).localResourceRoots?.map(uri => uri.toString()),
				[vscode.Uri.joinPath(context.extensionUri, 'media').toString()]
			);
			await receive!({ kind: 'ready' });
			assert.strictEqual(messages.at(-1)?.kind, 'snapshot');
			const request = { kind: 'edit', requestId: 1, version: document.version, blockId: '0:0', before: '本文', text: '変更' };
			await receive!({ ...request, uri: vscode.Uri.file('/other').toString() });
			await receive!({ ...request, kind: 'executeCommand', command: 'evil' });
			await receive!({ ...request, start: 0, end: 8 });
			assert.strictEqual(edits.length, 0);
			await receive!({ ...request, blockId: 'missing' });
			assert.strictEqual(messages.at(-1)?.kind, 'conflict');
			await receive!({ ...request, requestId: 2, version: document.version - 1 });
			assert.strictEqual(messages.at(-1)?.kind, 'conflict');
			await receive!({ ...request, requestId: 3, text: '<script>' });
			assert.strictEqual(edits.length, 0);
			await receive!({ ...request, requestId: 4 });
			assert.strictEqual(edits.length, 1);
			assert.deepStrictEqual(edits[0], [document.uri, document.version, 4, 6, '本文', '変更']);
			assert.strictEqual(messages.at(-1)?.kind, 'ack');
			await receive!({ ...request, requestId: 4 });
			assert.strictEqual(edits.length, 1);
		} finally {
			dispose!();
		}
		assert.strictEqual(editor.activeUri, undefined);
	});
});
