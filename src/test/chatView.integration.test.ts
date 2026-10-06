import * as assert from 'assert';
import * as vscode from 'vscode';
import { createHash } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DocumentStore } from '../documents';
import { parseChatMarkdown } from '../chatMarkdown';
import { ChatDraftStore, fingerprint, validateComposerDraft } from '../chatDrafts';
import { ChatView } from '../chatView';

interface HostMessage {
	kind: string;
	[key: string]: unknown;
}

function isHostMessage(value: unknown): value is HostMessage {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
		typeof (value as Record<string, unknown>).kind === 'string');
}

suite('Chat view host integration', () => {
	test('sends one new thread and two replies, rejects replay, and restores persisted drafts', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'quick-note-chat-integration-'));
		const notes = vscode.Uri.joinPath(vscode.Uri.file(directory), 'notes');
		const storage = vscode.Uri.joinPath(vscode.Uri.file(directory), 'storage');
		const messages: HostMessage[] = [];
		let listener: ((message: unknown) => void) | undefined;
		const webview = {
			cspSource: 'vscode-resource:',
			options: {},
			html: '',
			asWebviewUri: (uri: vscode.Uri) => uri,
			onDidReceiveMessage: (next: (message: unknown) => void) => {
				listener = next;
				return { dispose() {} };
			},
			postMessage: async (message: unknown) => {
				if (isHostMessage(message)) { messages.push(message); }
				return true;
			}
		};
		const context = {
			globalStorageUri: storage,
			extensionUri: vscode.Uri.file(directory),
			subscriptions: []
		} as unknown as vscode.ExtensionContext;
		const store = new DocumentStore(() => notes);
		const provider = new ChatView(context, store);
		let restartedProvider: ChatView | undefined;
		const send = (message: unknown) => listener?.(message);
		let messageCursor = 0;
		const waitFor = async (predicate: (message: HostMessage) => boolean): Promise<HostMessage> => {
			const deadline = Date.now() + 5000;
			while (Date.now() < deadline) {
				for (; messageCursor < messages.length; messageCursor++) {
					const message = messages[messageCursor];
					if (predicate(message)) {
						messageCursor++;
						return message;
					}
				}
				await new Promise(resolve => setTimeout(resolve, 10));
			}
			throw new Error(`Timed out waiting for a chat host message. Recent messages: ${
				JSON.stringify(messages.slice(-8).map(message => ({
					kind: message.kind, selectedChat: message.selectedChat,
					draftId: (message.activeDraft as Record<string, unknown> | undefined)?.draftId,
					revision: (message.activeDraft as Record<string, unknown> | undefined)?.revision,
					operationId: message.operationId, ok: message.ok, message: message.message
				}))
			)}`);
		};
		const draftChanged = async (
			draftId: string, revision: number, chatId: string | undefined, sectionId: string,
			markdown: string, title?: string
		) => {
			send({ kind: 'draftChanged', draftId, revision, chatId, sectionId, markdown, title });
			await waitFor(message => message.kind === 'draftAck' &&
				message.draftId === draftId && message.revision === revision);
		};
		const submit = async (
			operationId: string, draftId: string, revision: number, chatId: string | undefined,
			sectionId: string, markdown: string, title?: string, retryConflict = false
		) => {
			send({ kind: 'send', operationId, draftId, revision, chatId, sectionId, markdown, title, retryConflict });
			return waitFor(message => message.kind === 'operationResult' && message.operationId === operationId);
		};
		const toggle = async (
			operationId: string, chatId: string, messageId: string, taskId: string,
			checked: boolean, documentVersion: number
		) => {
			send({ kind: 'toggleTask', operationId, chatId, messageId, taskId, checked, documentVersion });
			return waitFor(message => message.kind === 'operationResult' && message.operationId === operationId);
		};

		try {
			provider.resolveWebviewView({ webview } as unknown as vscode.WebviewView);
			await waitFor(message => message.kind === 'snapshot' && message.state === 'empty');
			send({ kind: 'newChat' });
			const firstDraft = await waitFor(message => message.kind === 'snapshot' &&
				(message.activeDraft as Record<string, unknown> | undefined)?.sectionId === '本文');
			const initial = firstDraft.activeDraft as Record<string, unknown>;
			const initialDraftId = String(initial.draftId);
			const emptyBody = await submit('empty-body', initialDraftId, 0, undefined, '本文', '', '');
			assert.strictEqual(emptyBody.ok, false);
			await draftChanged(initialDraftId, 1, undefined, '本文', '# body heading\n\nfirst message', '   ');
			const emptyTitle = await submit('empty-title', initialDraftId, 1, undefined, '本文',
				'# body heading\n\nfirst message', '   ');
			assert.strictEqual(emptyTitle.ok, false);
			await draftChanged(initialDraftId, 2, undefined, '本文',
				'# body heading\n\nfirst message\n\n- [ ] task', 'Integration chat');
			const initialSendAt = Date.now();
			const firstSend = await submit('send-1', initialDraftId, 2, undefined, '本文',
				'# body heading\n\nfirst message\n\n- [ ] task', 'Integration chat');
			assert.strictEqual(firstSend.ok, true);
			const created = await store.list();
			assert.strictEqual(created.length, 1);
			const chatId = createHash('sha256').update(created[0].uri.toString()).digest('hex').slice(0, 32);

			let latest = await waitFor(message => message.kind === 'snapshot' && message.selectedChat === chatId &&
				(message.activeDraft as Record<string, unknown> | undefined)?.sectionId === '返信');
			assert.ok(Date.now() - initialSendAt < 2000, 'the new thread should appear in a snapshot within two seconds');
			for (let reply = 1; reply <= 2; reply++) {
				const draft = latest.activeDraft as Record<string, unknown>;
				const draftId = String(draft.draftId);
				const content = `reply ${reply}`;
				await draftChanged(draftId, 1, chatId, '返信', content);
				const replySentAt = Date.now();
				const result = await submit(`reply-${reply}`, draftId, 1, chatId, '返信', content);
				assert.strictEqual(result.ok, true, String(result.message));
				latest = await waitFor(message => message.kind === 'snapshot' && message.selectedChat === chatId &&
					(message.activeDraft as Record<string, unknown> | undefined)?.draftId !== draftId);
				assert.ok(Date.now() - replySentAt < 2000, 'the reply should appear in a snapshot within two seconds');
			}

			const afterRepliesDraft = latest.activeDraft as Record<string, unknown>;
			const afterRepliesDraftId = String(afterRepliesDraft.draftId);
			await draftChanged(afterRepliesDraftId, 1, chatId, '返信', 'keep after save failure');
			const appendChatMessage = store.appendChatMessage.bind(store);
			store.appendChatMessage = async () => { throw new Error('injected save failure'); };
			const saveFailed = await submit('injected-save-failure', afterRepliesDraftId, 1, chatId,
				'返信', 'keep after save failure');
			store.appendChatMessage = appendChatMessage;
			assert.strictEqual(saveFailed.ok, false);
			assert.match(String(saveFailed.message), /injected save failure/);
			const failureSnapshot = messages.slice().reverse().find(message => message.kind === 'snapshot' &&
				message.selectedChat === chatId &&
				(message.activeDraft as Record<string, unknown> | undefined)?.draftId === afterRepliesDraftId &&
				(message.activeDraft as Record<string, unknown> | undefined)?.revision === 1);
			assert.ok(failureSnapshot);
			assert.strictEqual((failureSnapshot.activeDraft as Record<string, unknown>).markdown, 'keep after save failure');
			latest = failureSnapshot;

			const storedBeforeToggle = await store.readChat(created[0].uri);
			const firstMessage = parseChatMarkdown(storedBeforeToggle.text).thread?.sections[0].messages[0];
			const task = firstMessage?.tasks[0];
			if (!firstMessage?.id || !task?.id) { throw new Error('Expected the saved checkbox task in the first message.'); }
			const toggled = await toggle('toggle-task', chatId, firstMessage.id, task.id, true,
				latest.documentVersion as number);
			if (!toggled.ok) {
				throw new Error(`Task toggle failed: ${JSON.stringify(toggled)}; version=${latest.documentVersion}; task=${task.id}`);
			}
			const staleToggle = await toggle('stale-toggle', chatId, firstMessage.id, task.id, false,
				latest.documentVersion as number);
			assert.strictEqual(staleToggle.ok, false);
			const toggledSource = await store.readChat(created[0].uri);
			assert.match(toggledSource.text, /- \[x\] task/);
			const readChat = store.readChat.bind(store);
			store.readChat = async uri => ({ ...await readChat(uri), readOnly: true });
			send({ kind: 'refresh' });
			const readOnlySnapshot = await waitFor(message => message.kind === 'snapshot' &&
				message.selectedChat === chatId && message.selectedReadOnly === true);
			const blockedToggle = await toggle('readonly-toggle', chatId, firstMessage.id, task.id, false,
				readOnlySnapshot.documentVersion as number);
			assert.strictEqual(blockedToggle.ok, false);
			assert.match(String(blockedToggle.message), /読み取り専用/);
			store.readChat = readChat;
			send({ kind: 'refresh' });
			latest = await waitFor(message => message.kind === 'snapshot' && message.selectedChat === chatId &&
				message.selectedReadOnly === false);

			const replyDraft = latest.activeDraft as Record<string, unknown>;
			const conflictDraftId = String(replyDraft.draftId);
			await draftChanged(conflictDraftId, 2, chatId, '返信', 'keep through conflict');
			const currentDocument = await vscode.workspace.openTextDocument(created[0].uri);
			const edit = new vscode.WorkspaceEdit();
			edit.insert(created[0].uri, currentDocument.positionAt(currentDocument.getText().length), '\n<!-- external edit -->');
			assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
			send({ kind: 'refresh' });
			const dirtySnapshot = await waitFor(message => message.kind === 'snapshot' &&
				message.selectedChat === chatId && message.selectedDirty === true);
			assert.strictEqual(dirtySnapshot.selectedDirty, true);
			const blocked = await submit('dirty-send', conflictDraftId, 2, chatId, '返信', 'keep through conflict');
			assert.strictEqual(blocked.ok, false);

			assert.strictEqual(await currentDocument.save(), true);
			send({ kind: 'refresh' });
			const conflictSnapshot = await waitFor(message => message.kind === 'snapshot' &&
				message.selectedChat === chatId && message.draftConflict === true);
			assert.strictEqual(conflictSnapshot.draftConflict, true);
			const conflictActiveDraft = conflictSnapshot.activeDraft as Record<string, unknown>;
			assert.strictEqual(conflictActiveDraft.draftId, conflictDraftId);
			assert.strictEqual(conflictActiveDraft.revision, 2);
			assert.strictEqual(conflictActiveDraft.markdown, 'keep through conflict');
			const stale = await submit('stale-send', conflictDraftId, 2, chatId, '返信', 'keep through conflict');
			assert.strictEqual(stale.ok, false);
			const retried = await submit(
				'confirmed-retry', conflictDraftId, 2, chatId, '返信', 'keep through conflict', undefined, true
			);
			assert.strictEqual(retried.ok, true, String(retried.message));
			const afterRetry = await waitFor(message => message.kind === 'snapshot' && message.selectedChat === chatId &&
				(message.activeDraft as Record<string, unknown> | undefined)?.draftId !== conflictDraftId);
			const replay = await submit('replay-old-send', initialDraftId, 1, undefined, '本文',
				'# body heading\n\nfirst message', 'Integration chat');
			assert.strictEqual(replay.ok, false);
			assert.strictEqual((await store.list()).length, 1);
			const recoveryDraft = afterRetry.activeDraft as Record<string, unknown>;
			const recoveryDraftId = String(recoveryDraft.draftId);
			await draftChanged(recoveryDraftId, 1, chatId, '返信', 'recover me after restart');
			const changedAgain = new vscode.WorkspaceEdit();
			const latestDocument = await vscode.workspace.openTextDocument(created[0].uri);
			changedAgain.insert(created[0].uri, latestDocument.positionAt(latestDocument.getText().length), '\n<!-- changed after draft -->');
			assert.strictEqual(await vscode.workspace.applyEdit(changedAgain), true);
			assert.strictEqual(await latestDocument.save(), true);

			const orphanDraftId = 'e'.repeat(32);
			const orphanDraft = validateComposerDraft({
				schemaVersion: 1, draftId: orphanDraftId,
				target: { chatId: 'f'.repeat(32), sectionId: '返信' }, title: '', markdown: 'orphan draft',
				baseFingerprint: fingerprint('deleted source'), revision: 1, updatedAt: Date.now()
			});
			await new ChatDraftStore(vscode.Uri.joinPath(storage, 'chat-drafts')).save(orphanDraft);
			provider.dispose();

			const recoveredMessages: HostMessage[] = [];
			let recoveryListener: ((message: unknown) => void) | undefined;
			const recoveryWebview = {
				cspSource: 'vscode-resource:',
				options: {},
				html: '',
				asWebviewUri: (uri: vscode.Uri) => uri,
				onDidReceiveMessage: (next: (message: unknown) => void) => {
					recoveryListener = next;
					return { dispose() {} };
				},
				postMessage: async (message: unknown) => {
					if (isHostMessage(message)) { recoveredMessages.push(message); }
					return true;
				}
			};
			restartedProvider = new ChatView(context, store);
			restartedProvider.resolveWebviewView({ webview: recoveryWebview } as unknown as vscode.WebviewView);
			const recoveredSnapshot = await (async () => {
				const deadline = Date.now() + 5000;
				while (Date.now() < deadline) {
					const snapshot = recoveredMessages.find(message => message.kind === 'snapshot' &&
						(message.recovery as Array<Record<string, unknown>> | undefined)
							?.some(draft => draft.draftId === recoveryDraftId && draft.conflict === true));
					if (snapshot) { return snapshot; }
					await new Promise(resolve => setTimeout(resolve, 10));
				}
				throw new Error('Timed out waiting for the persisted draft recovery snapshot.');
			})();
			const recoverableDrafts = recoveredSnapshot.recovery as Array<Record<string, unknown>>;
			const recovered = recoverableDrafts.find(draft => draft.draftId === recoveryDraftId);
			assert.strictEqual(recovered?.markdown, 'recover me after restart');
			assert.strictEqual(recovered?.conflict, true);
			assert.strictEqual(recoverableDrafts.find(draft => draft.draftId === orphanDraftId)?.conflict, true);
			assert.ok(recoveryListener);

			const restoreAt = recoveredMessages.length;
			recoveryListener({ kind: 'recoverDraft', draftId: recoveryDraftId, action: 'restore' });
			const restoredSnapshot = await (async () => {
				const deadline = Date.now() + 5000;
				while (Date.now() < deadline) {
					const snapshot = recoveredMessages.slice(restoreAt).find(message => message.kind === 'snapshot' &&
						(message.activeDraft as Record<string, unknown> | undefined)?.draftId === recoveryDraftId);
					if (snapshot) { return snapshot; }
					await new Promise(resolve => setTimeout(resolve, 10));
				}
				throw new Error('Timed out waiting for the explicit draft restore snapshot.');
			})();
			assert.strictEqual(restoredSnapshot.draftConflict, true);
			const discardAt = recoveredMessages.length;
			recoveryListener({ kind: 'recoverDraft', draftId: orphanDraftId, action: 'discard' });
			const discardedSnapshot = await (async () => {
				const deadline = Date.now() + 5000;
				while (Date.now() < deadline) {
					const snapshot = recoveredMessages.slice(discardAt).find(message => message.kind === 'snapshot' &&
						!(message.recovery as Array<Record<string, unknown>> | undefined)
							?.some(draft => draft.draftId === orphanDraftId));
					if (snapshot) { return snapshot; }
					await new Promise(resolve => setTimeout(resolve, 10));
				}
				throw new Error('Timed out waiting for the explicit orphan draft discard snapshot.');
			})();
			assert.ok(discardedSnapshot);
			const saved = await store.readChat(created[0].uri);
			const parsed = parseChatMarkdown(saved.text);
			assert.strictEqual(parsed.state, 'valid');
			assert.deepStrictEqual(parsed.thread?.sections.map(section => section.messages.length), [1, 3]);
			assert.strictEqual(
				parsed.thread?.sections[0].messages[0].bodyMarkdown.replace(/\r\n/g, '\n'),
				'# body heading\n\nfirst message\n\n- [x] task'
			);
		} finally {
			provider.dispose();
			restartedProvider?.dispose();
			await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
		}
	});

	test('lists chats, selects their threads, and opens the source without applying stale snapshots', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'quick-note-chat-list-'));
		const notes = vscode.Uri.joinPath(vscode.Uri.file(directory), 'notes');
		const storage = vscode.Uri.joinPath(vscode.Uri.file(directory), 'storage');
		const messages: HostMessage[] = [];
		let listener: ((message: unknown) => void) | undefined;
		let listCalls = 0;
		const webview = {
			cspSource: 'vscode-resource:',
			options: {},
			html: '',
			asWebviewUri: (uri: vscode.Uri) => uri,
			onDidReceiveMessage: (next: (message: unknown) => void) => {
				listener = next;
				return { dispose() {} };
			},
			postMessage: async (message: unknown) => {
				if (isHostMessage(message)) { messages.push(message); }
				return true;
			}
		};
		const context = {
			globalStorageUri: storage,
			extensionUri: vscode.Uri.file(directory),
			subscriptions: []
		} as unknown as vscode.ExtensionContext;
		const store = new DocumentStore(() => notes);
		const baseList = store.list.bind(store);
		store.list = async () => {
			listCalls++;
			if (listCalls === 1) { await new Promise(resolve => setTimeout(resolve, 100)); }
			return baseList();
		};
		const provider = new ChatView(context, store);
		const send = (message: unknown) => listener?.(message);
		const waitFor = async (predicate: (message: HostMessage) => boolean): Promise<HostMessage> => {
			const deadline = Date.now() + 5000;
			while (Date.now() < deadline) {
				const found = messages.find(predicate);
				if (found) { return found; }
				await new Promise(resolve => setTimeout(resolve, 10));
			}
			throw new Error('Timed out waiting for the chat list snapshot.');
		};

		try {
			const chats = [
				await store.createChat('Chat one', '2026-10-04 07:30',
					'- [ ] open\n- [x] done\n- [i] important', '1'.repeat(32)),
				await store.createChat('Chat two', '2026-10-04 07:31', 'second conversation', '2'.repeat(32)),
				await store.createChat('Chat three', '2026-10-04 07:32', 'third conversation', '3'.repeat(32))
			];
			const secondSource = Buffer.from(await vscode.workspace.fs.readFile(chats[1]));
			await vscode.workspace.fs.writeFile(chats[1], Buffer.concat([
				secondSource, Buffer.from('\n## Future\n\nUnknown section content.\n')
			]));
			await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(notes, 'unsupported.md'),
				Buffer.from('# malformed\n\n## Section\n\n### not a timestamp\n'));

			provider.resolveWebviewView({ webview } as unknown as vscode.WebviewView);
			while (listCalls === 0) { await new Promise(resolve => setTimeout(resolve, 1)); }
			send({ kind: 'refresh' });
			const ready = await waitFor(message => message.kind === 'snapshot' && message.state === 'ready' &&
				(message.chats as Array<Record<string, unknown>> | undefined)?.length === 4);
			await new Promise(resolve => setTimeout(resolve, 150));
			const snapshots = messages.filter(message => message.kind === 'snapshot');
			assert.strictEqual(snapshots.some(message => message.generation === 1 && message.state === 'ready'), false);
			assert.strictEqual(ready.generation, 2);
			const entries = ready.chats as Array<Record<string, unknown>>;
			assert.strictEqual(entries.find(entry => entry.title === 'unsupported')?.parseState, 'unsupported');

			const selectedChatId = createHash('sha256').update(chats[1].toString()).digest('hex').slice(0, 32);
			send({ kind: 'selectChat', chatId: selectedChatId });
			const selected = await waitFor(message => message.kind === 'snapshot' &&
				message.selectedChat === selectedChatId && message.state === 'ready' && message.generation === 3);
			const thread = selected.thread as { title: string; sections: Array<{ name: string; messages: Array<{ tasks: Array<{ status: string; checked: boolean }> }> }> };
			assert.strictEqual(thread.title, 'Chat two');
			assert.ok(thread.sections.some(section => section.name === 'Future'));
			send({ kind: 'openSource', chatId: selectedChatId });
			const deadline = Date.now() + 5000;
			while (Date.now() < deadline && vscode.window.activeTextEditor?.document.uri.toString() !== chats[1].toString()) {
				await new Promise(resolve => setTimeout(resolve, 10));
			}
			assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), chats[1].toString());

			const firstChatId = createHash('sha256').update(chats[0].toString()).digest('hex').slice(0, 32);
			send({ kind: 'selectChat', chatId: firstChatId });
			const firstSelected = await waitFor(message => message.kind === 'snapshot' &&
				message.selectedChat === firstChatId && message.generation === 4);
			const firstThread = firstSelected.thread as typeof thread;
			const taskStatuses = firstThread.sections[0].messages[0].tasks.map(task => `${task.status}:${task.checked}`);
			assert.deepStrictEqual(taskStatuses, ['open:false', 'done:true', 'info:false']);
		} finally {
			provider.dispose();
			await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
		}
	});
});
