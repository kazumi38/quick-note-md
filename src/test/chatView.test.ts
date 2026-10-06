import * as assert from 'assert';
import { validateChatWebviewMessage } from '../chatView';

suite('Chat Webview protocol validation', () => {
	test('accepts only bounded, typed composer operations', () => {
		assert.deepStrictEqual(validateChatWebviewMessage({ kind: 'ready' }), { kind: 'ready' });
		assert.deepStrictEqual(validateChatWebviewMessage({
			kind: 'draftChanged', draftId: 'a'.repeat(32), revision: 2,
			chatId: 'b'.repeat(32), sectionId: '返信', title: 'title', markdown: '**body**'
		}), {
			kind: 'draftChanged', draftId: 'a'.repeat(32), revision: 2,
			chatId: 'b'.repeat(32), sectionId: '返信', title: 'title', markdown: '**body**'
		});
	});

	test('rejects paths, HTML, extra properties, invalid IDs, and oversized source', () => {
		assert.strictEqual(validateChatWebviewMessage({
			kind: 'draftChanged', draftId: 'a'.repeat(32), revision: 1, sectionId: '本文',
			markdown: 'x', uri: 'file:///secret.md'
		}), undefined);
		assert.strictEqual(validateChatWebviewMessage({
			kind: 'send', operationId: 'operation', draftId: '../file', revision: 0,
			sectionId: '本文', markdown: '<img src=x onerror=alert(1)>'
		}), undefined);
		assert.strictEqual(validateChatWebviewMessage({
			kind: 'draftChanged', draftId: 'a'.repeat(32), revision: 1, sectionId: '本文',
			markdown: 'x'.repeat(32001)
		}), undefined);
		assert.strictEqual(validateChatWebviewMessage({
			kind: 'draftChanged', draftId: 'a'.repeat(32), revision: -1, sectionId: '本文', markdown: 'x'
		}), undefined);
		assert.strictEqual(validateChatWebviewMessage({
			kind: 'toggleTask', operationId: 'operation', chatId: 'b'.repeat(32),
			messageId: 'c'.repeat(32), taskId: `${'c'.repeat(32)}:12`, checked: true, documentVersion: -1
		}), undefined);
	});
});
