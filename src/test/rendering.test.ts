import * as assert from 'assert';
import * as vscode from 'vscode';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { runInNewContext } from 'vm';
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
		assert.ok(!/<(?:script|img|a)\b|<[^>]+\s(?:href|src|onerror)=/i.test(html));
		assert.ok(html.includes('&lt;script&gt;'));
		assert.ok(html.includes('画像: alt'));
		const nodes = renderNote(source).nodes;
		assert.ok(JSON.stringify(nodes).includes('<script>alert(1)</script>'));
		const visit = (node: typeof nodes[number]) => {
			assert.ok(!['script', 'img', 'a', 'iframe'].includes(node.tag ?? ''));
			node.children?.forEach(visit);
		};
		nodes.forEach(visit);
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
			await receive!({ kind: 'ready' });
			await receive!({ ...request, requestId: 1 });
			assert.strictEqual(edits.length, 2);
			await receive!({ kind: 'pending', text: '破棄しない入力' });
			dispose!();
			editor.resolveCustomTextEditor(document, panel);
			messages.length = 0;
			await receive!({ kind: 'ready' });
			assert.ok(messages.some(message => message.kind === 'recovery' && message.text === '破棄しない入力'));
			await receive!({ kind: 'pending', text: null });
			dispose!();
			editor.resolveCustomTextEditor(document, panel);
			messages.length = 0;
			await receive!({ kind: 'ready' });
			assert.ok(!messages.some(message => message.kind === 'recovery'));
		} finally {
			dispose!();
		}
		assert.strictEqual(editor.activeUri, undefined);
	});

	function clientHarness(savedState: Record<string, unknown> = {}) {
		type Listener = (event: Record<string, unknown>) => void;
		class Element {
			public textContent = '';
			public value = '';
			public hidden = true;
			public innerHTML = '';
			public dataset = { blockId: '0:0' };
			public classList = { toggle() {} };
			public listeners = new Map<string, Listener>();
			public addEventListener(name: string, listener: Listener) { this.listeners.set(name, listener); }
			public matches() { return this === leaf; }
			public closest() { return this === leaf ? this : undefined; }
			public contains(element: unknown) { return element === this || (this === elements.note && element === leaf); }
			public focus() { document.activeElement = this; }
			public replaceChildren(...children: Element[]) { this.innerHTML = children.map(child => child.textContent).join(''); }
			public appendChild(child: Element) { this.textContent += child.textContent; }
			public setAttribute() {}
			public querySelectorAll() { return [leaf, ...extraLeaves]; }
		}
		const elements: Record<string, Element> = {};
		for (const id of ['note', 'status', 'recovery', 'pending', 'source', 'reload', 'discard']) {
			elements[id] = new Element();
		}
		const leaf = new Element();
		const extraLeaves: Element[] = [];
		leaf.textContent = '本文';
		const sent: Record<string, unknown>[] = [];
		const document = {
			activeElement: leaf,
			getElementById: (id: string) => elements[id],
			createTextNode: (text: string) => { const element = new Element(); element.textContent = text; return element; },
			createElement: () => new Element(),
			addEventListener() {}
		};
		let receive: Listener;
		let state = savedState;
		const timers = new Map<number, () => void>();
		let timerId = 0;
		runInNewContext(readFileSync(resolve(__dirname, '../../media/editor.js'), 'utf8'), {
			document,
			window: {
				addEventListener: (_name: string, listener: Listener) => { receive = listener; },
				getSelection: () => ({ rangeCount: 0 })
			},
			acquireVsCodeApi: () => ({
				getState: () => state,
				setState: (next: Record<string, unknown>) => { state = next; },
				postMessage: (message: Record<string, unknown>) => sent.push(message)
			}),
			setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId; },
			clearTimeout: (id: number) => timers.delete(id)
		});
		const snapshot = (version: number, text = '本文', kind = 'snapshot', requestId?: unknown) => ({
			kind, version, html: `<p>${text}</p>`, nodes: renderNote(text).nodes,
			spans: [{ id: '0:0', text, start: 0, end: text.length, kind: 'paragraph' }], requestId
		});
		const deliver = (message: Record<string, unknown>) => receive!({ data: message });
		deliver(snapshot(1));
		return {
			elements, leaf, sent, snapshot, deliver, state: () => state,
			addLeaf: (id: string, text: string) => {
				const element = new Element();
				element.dataset.blockId = id;
				element.textContent = text;
				extraLeaves.push(element);
			},
			fire: (name: string) => elements.note.listeners.get(name)!({ target: leaf }),
			flush: () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); }
		};
	}

	suite('Webview の入力・保存・競合制御', () => {
		test('入力中は DOM とカーソルを維持し、ACK まで次の保存を待つ', () => {
			const client = clientHarness();
			client.leaf.textContent = '変更';
			client.fire('input');
			client.flush();
			const first = client.sent.at(-1)!;
			assert.strictEqual(first.kind, 'edit');
			client.leaf.textContent = '変更を続ける';
			client.fire('input');
			client.flush();
			assert.strictEqual(client.sent.filter(message => message.kind === 'edit').length, 1);
			client.deliver(client.snapshot(2, '変更', 'ack', first.requestId));
			client.flush();
			const second = client.sent.at(-1)!;
			assert.strictEqual(second.before, '変更');
			assert.strictEqual(second.version, 2);
			assert.strictEqual(second.text, '変更を続ける');
			client.deliver(client.snapshot(3, '変更を続ける', 'ack', second.requestId));
			assert.strictEqual(client.leaf.textContent, '変更を続ける');
			assert.strictEqual(client.elements.note.innerHTML, '本文');
			assert.strictEqual(client.state().pending, undefined);
		});

		test('IME 変換中は保存せず確定後に保存する', () => {
			const client = clientHarness();
			client.fire('compositionstart');
			client.leaf.textContent = '日本語';
			client.fire('input');
			client.flush();
			assert.strictEqual(client.sent.filter(message => message.kind === 'edit').length, 0);
			client.fire('compositionend');
			client.flush();
			assert.strictEqual(client.sent.at(-1)?.text, '日本語');
		});

		test('競合と保存失敗で入力を保持し、明示的破棄まで更新しない', () => {
			for (const external of [true, false]) {
				const client = clientHarness();
				client.leaf.textContent = '未保存';
				client.fire('input');
				client.flush();
				const request = client.sent.at(-1)!;
				client.deliver(external ? client.snapshot(2, '外部変更') : {
					kind: 'conflict', requestId: request.requestId, message: '保存失敗'
				});
				assert.strictEqual(client.leaf.textContent, '未保存');
				assert.strictEqual(client.elements.pending.value, '未保存');
				assert.strictEqual(client.state().pending, '未保存');
				assert.strictEqual(client.elements.recovery.hidden, false);
				assert.strictEqual(client.elements.note.innerHTML, '本文');
				client.flush();
				assert.strictEqual(client.sent.filter(message => message.kind === 'edit').length, 1);
			}
		});

		test('非表示からの復帰で未保存の削除入力も復元する', () => {
			const client = clientHarness({ pending: '' });
			assert.strictEqual(client.elements.recovery.hidden, false);
			assert.match(client.elements.status.textContent, /復元/);
		});

		test('パネルを破棄しても拡張機能から未保存入力を回収できる', () => {
			const client = clientHarness();
			client.deliver({ kind: 'recovery', text: '前のパネルの入力' });
			assert.strictEqual(client.elements.pending.value, '前のパネルの入力');
			assert.strictEqual(client.elements.recovery.hidden, false);
			assert.strictEqual(client.state().pending, '前のパネルの入力');
		});

		test('保存失敗後の明示的破棄は同じバージョンでも表示を戻す', () => {
			const client = clientHarness();
			client.leaf.textContent = '未保存';
			client.fire('input');
			client.flush();
			const request = client.sent.at(-1)!;
			client.deliver({ kind: 'conflict', requestId: request.requestId, message: '保存失敗' });
			client.elements.note.innerHTML = '未保存の表示';
			client.elements.discard.listeners.get('click')!({});
			client.deliver(client.snapshot(1));
			assert.strictEqual(client.elements.note.innerHTML, '本文');
			assert.strictEqual(client.state().pending, undefined);
		});

		test('既存の未保存変更を保持した ACK を保存済みと表示しない', () => {
			const client = clientHarness();
			client.leaf.textContent = '変更';
			client.fire('input');
			client.flush();
			const request = client.sent.at(-1)!;
			client.deliver({ ...client.snapshot(2, '変更', 'ack', request.requestId), isDirty: true });
			assert.match(client.elements.status.textContent, /未保存変更/);
			assert.ok(!client.elements.status.textContent.includes('保存済み'));
			client.deliver({ ...client.snapshot(2, '変更'), isDirty: false });
			assert.match(client.elements.status.textContent, /保存済み/);
		});

		test('ACK 内の別本文変更と古い DOM を組み合わせず入力を保持する', () => {
			const client = clientHarness();
			client.addLeaf('2:0', '別の本文');
			const initial = renderNote('本文\n\n別の本文');
			client.deliver({ kind: 'snapshot', version: 2, ...initial });
			client.leaf.textContent = 'ローカルの変更';
			client.fire('input');
			client.flush();
			const request = client.sent.at(-1)!;
			client.deliver({
				kind: 'ack', version: 3, requestId: request.requestId,
				...renderNote('ローカルの変更\n\n外部の変更')
			});
			assert.strictEqual(client.elements.pending.value, 'ローカルの変更');
			assert.match(client.elements.status.textContent, /表示対象が変更/);
			client.fire('input');
			client.flush();
			assert.strictEqual(client.sent.filter(message => message.kind === 'edit').length, 1);
		});
	});
});
