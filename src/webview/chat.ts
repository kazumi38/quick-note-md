import { createChatComposer } from './chatComposer';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

interface ChatListItem { id: string; title: string; dirty: boolean; readOnly: boolean; parseState: string }
interface ChatSnapshot {
	kind: 'snapshot';
	generation: number;
	state: 'loading' | 'ready' | 'empty' | 'unavailable' | 'error';
	error?: string;
	chats: ChatListItem[];
	selectedChat?: string;
	documentVersion?: number;
	selectedDirty?: boolean;
	selectedReadOnly?: boolean;
	selectedParseState?: string;
	draftConflict?: boolean;
	thread?: {
		title: string;
		sections: Array<{
			id: string;
			name: string;
			messages: Array<{
				id?: string;
				timestamp: string;
				html: string;
				tasks: Array<{ id: string; checked: boolean; status: string }>;
			}>;
		}>;
	};
	activeDraft?: { draftId: string; chatId?: string; sectionId: string; title?: string; markdown: string; revision: number };
	sectionDraft?: { draftId: string; chatId: string; sectionId: string; markdown: string; revision: number };
	recovery?: Array<{ draftId: string; title?: string; markdown: string; revision: number; conflict: boolean }>;
}

const vscode = acquireVsCodeApi();
const app = document.querySelector<HTMLElement>('#app');
let generation = 0;
let composer: ReturnType<typeof createChatComposer> | undefined;
let composerForm: HTMLElement | undefined;
let snapshot: ChatSnapshot | undefined;
let activeMarkdown = '';
let activeDraftId = '';
let activeSectionId = '本文';
let activeRevision = 0;
let activeChatId: string | undefined;
let titleValue = '';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (text !== undefined) { node.textContent = text; }
	return node;
}

function post(kind: string, fields: Record<string, unknown> = {}): void {
	vscode.postMessage({ kind, ...fields });
}

function saveDraft(markdown = activeMarkdown): void {
	if (!activeDraftId) { return; }
	activeRevision++;
	post('draftChanged', {
		draftId: activeDraftId,
		revision: activeRevision,
		chatId: activeChatId,
		sectionId: activeSectionId,
		title: titleValue,
		markdown
	});
}

function setComposer(markdown: string): HTMLElement {
	composer?.destroy();
	activeMarkdown = markdown;
	const wrapper = element('section');
	composerForm = wrapper;
	wrapper.className = 'composer';
	if (!activeChatId) {
		const title = element('input');
		title.type = 'text';
		title.className = 'chat-title-input';
		title.placeholder = 'チャットのタイトル';
		title.setAttribute('aria-label', 'チャットのタイトル');
		title.value = titleValue;
		title.addEventListener('input', () => {
			titleValue = title.value;
			saveDraft();
		});
		wrapper.append(title);
	}
	const editor = element('div');
	editor.className = 'composer-surface';
	wrapper.append(editor);
	const error = element('p');
	error.className = 'composer-error';
	error.setAttribute('role', 'status');
	wrapper.append(error);
	composer = createChatComposer(editor, markdown, next => {
		activeMarkdown = next;
		saveDraft(next);
	}, message => {
		error.textContent = message;
	});
	const actions = element('div');
	actions.className = 'composer-actions';
	const send = element('button', '送信');
	send.className = 'send-button';
	send.type = 'button';
	const sendDraft = (retryConflict = false) => {
		post('send', {
			operationId: crypto.randomUUID(),
			draftId: activeDraftId,
			revision: activeRevision,
			chatId: activeChatId,
			sectionId: activeSectionId,
			title: titleValue,
			markdown: activeMarkdown,
			retryConflict
		});
	};
	send.disabled = Boolean(snapshot?.selectedDirty || snapshot?.selectedReadOnly || snapshot?.draftConflict ||
		(snapshot?.selectedParseState && snapshot.selectedParseState !== 'valid'));
	send.addEventListener('click', () => sendDraft());
	actions.append(send);
	wrapper.append(actions);
	(wrapper as HTMLElement & { sendDraft?: (retryConflict: boolean) => void }).sendDraft = sendDraft;
	return wrapper;
}

function renderThread(parent: HTMLElement, current: ChatSnapshot): void {
	const thread = current.thread;
	if (!thread) { return; }
	const heading = element('h2', thread.title);
	parent.append(heading);
	for (const section of thread.sections) {
		parent.append(element('h3', section.name));
		for (const message of section.messages) {
			const article = element('article');
			article.className = 'chat-message';
			article.append(element('time', message.timestamp));
			const content = element('div');
			content.className = 'message-content';
			content.innerHTML = message.html;
			if (message.id) {
				let listIndex = 0;
				const listItems = [...content.querySelectorAll('li')];
				for (const task of message.tasks) {
					let matched: HTMLLIElement | undefined;
					for (; listIndex < listItems.length; listIndex++) {
						const item = listItems[listIndex];
						const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
						let text: Node | null;
						while ((text = walker.nextNode())) {
							if (text.parentElement?.closest('code, pre')) { continue; }
							const marker = /^(\s*)\[([ xX!in-])\](?:\s+|$)/.exec(text.textContent ?? '');
							if (!marker) { continue; }
							const expected = marker[2] === ' ' ? 'open' : marker[2].toLowerCase() === 'x' ? 'done'
								: marker[2] === 'i' ? 'info' : marker[2] === '!' ? 'warn'
									: marker[2] === 'n' ? 'note' : 'skip';
							if (expected !== task.status) { continue; }
							text.textContent = (text.textContent ?? '').replace(/^\s*\[([ xX!in-])\](?:\s+|$)/, '');
							matched = item;
							break;
						}
						listIndex++;
						if (matched) { break; }
					}
					if (!matched) { continue; }
					if (task.status === 'open' || task.status === 'done') {
						const label = element('label');
						label.className = 'message-task';
						const checkbox = element('input');
						checkbox.type = 'checkbox';
						checkbox.checked = task.checked;
						checkbox.disabled = Boolean(current.selectedDirty || current.selectedReadOnly ||
							current.selectedParseState !== 'valid');
						checkbox.setAttribute('aria-label', task.checked ? 'メッセージ内のタスク: 完了' : 'メッセージ内のタスク: 未完了');
						checkbox.addEventListener('change', () => {
							post('toggleTask', {
								operationId: crypto.randomUUID(),
								chatId: current.selectedChat,
								messageId: message.id,
								taskId: task.id,
								checked: checkbox.checked,
								documentVersion: current.documentVersion ?? -1
							});
						});
						label.append(checkbox, element('span', task.checked ? '完了' : '未完了'));
						matched.prepend(label);
					} else {
						const labels: Record<string, string> = {
							info: 'IMP（重要）', warn: 'WARN（注意）', note: 'Note（参考）', skip: 'Skip（対応不要）'
						};
						const status = element('span', labels[task.status] ?? task.status);
						status.className = `message-task-status task-${task.status}`;
						matched.prepend(status);
					}
				}
			}
			article.append(content);
			parent.append(article);
		}
	}
}

function render(current: ChatSnapshot): void {
	if (!app) { return; }
	if (current.generation < generation) { return; }
	if (current.state === 'loading' && snapshot) { return; }
	if (current.activeDraft?.draftId === activeDraftId && composerForm) {
		current = {
			...current,
			activeDraft: {
				...current.activeDraft,
				markdown: activeMarkdown,
				revision: activeRevision,
				title: titleValue
			}
		};
	} else if (current.activeDraft?.draftId !== activeDraftId) {
		composer?.destroy();
		composer = undefined;
		composerForm = undefined;
		activeDraftId = current.activeDraft?.draftId ?? '';
	}
	generation = current.generation;
	snapshot = current;
	app.replaceChildren();
	const heading = element('h1', 'QuickNote チャット');
	app.append(heading);
	const toolbar = element('div');
	toolbar.className = 'toolbar';
	const newChat = element('button', '新しいチャット');
	newChat.disabled = current.state === 'unavailable';
	newChat.addEventListener('click', () => post('newChat'));
	const refresh = element('button', '更新');
	refresh.addEventListener('click', () => post('refresh'));
	toolbar.append(newChat, refresh);
	app.append(toolbar);
	if (current.error) {
		const status = element('p', current.error);
		status.setAttribute('role', 'alert');
		app.append(status);
	}
	if (current.state === 'unavailable') {
		app.append(element('p', 'ワークスペース フォルダーを開いてください。'));
	}
	const layout = element('div');
	layout.className = 'chat-layout';
	const list = element('nav');
	list.className = 'chat-list';
	list.setAttribute('aria-label', 'チャット一覧');
	for (const chat of current.chats) {
		const button = element('button', `${chat.title}${chat.dirty ? ' (未保存)' : ''}${chat.readOnly ? ' (読み取り専用)' : ''}`);
		button.className = chat.id === current.selectedChat ? 'selected' : '';
		button.addEventListener('click', () => post('selectChat', { chatId: chat.id }));
		list.append(button);
	}
	layout.append(list);
	const conversation = element('section');
	conversation.className = 'conversation';
	if (current.selectedChat) {
		const openSource = element('button', '原文を開く');
		openSource.addEventListener('click', () => post('openSource', { chatId: current.selectedChat }));
		conversation.append(openSource);
	}
	if (current.state === 'loading') {
		conversation.append(element('p', '読み込み中…'));
	} else if (!current.chats.length && !current.activeDraft && current.state !== 'unavailable') {
		conversation.append(element('p', 'チャットはありません。「新しいチャット」から作成してください。'));
	}
	renderThread(conversation, current);
	if (current.activeDraft) {
		activeDraftId = current.activeDraft.draftId;
		activeChatId = current.activeDraft.chatId;
		activeSectionId = current.activeDraft.sectionId;
		activeRevision = current.activeDraft.revision;
		titleValue = current.activeDraft.title ?? '';
		const form = composerForm ?? setComposer(current.activeDraft.markdown);
		form.querySelector('.draft-actions')?.remove();
		const send = form.querySelector<HTMLButtonElement>('.send-button');
		if (send) {
			send.disabled = Boolean(current.selectedDirty || current.selectedReadOnly || current.draftConflict ||
				(current.selectedParseState && current.selectedParseState !== 'valid'));
		}
		if (current.draftConflict || current.selectedDirty || current.selectedReadOnly) {
			const recovery = element('div');
			recovery.className = 'draft-actions';
			const copy = element('button', '下書きをコピー');
			copy.addEventListener('click', () => post('copyDraft', {
				draftId: current.activeDraft?.draftId, revision: current.activeDraft?.revision
			}));
			recovery.append(copy);
			if (current.selectedChat) {
				const source = element('button', '原文を開く');
				source.addEventListener('click', () => post('openSource', { chatId: current.selectedChat }));
				recovery.append(source);
			}
			const reload = element('button', '最新状態を再読み込み');
			reload.addEventListener('click', () => post('refresh'));
			recovery.append(reload);
			if (current.draftConflict && current.selectedChat && !current.selectedDirty &&
				!current.selectedReadOnly && current.selectedParseState === 'valid') {
				const retry = element('button', '最新状態を確認して再送信');
				retry.addEventListener('click', () => {
					(form as HTMLElement & { sendDraft?: (retryConflict: boolean) => void }).sendDraft?.(true);
				});
				recovery.append(retry);
			}
			form.prepend(recovery);
		}
		conversation.append(form);
	} else {
		composer?.destroy();
		composer = undefined;
		composerForm = undefined;
		activeDraftId = '';
	}
	layout.append(conversation);
	app.append(layout);
	if (current.recovery?.length) {
		const section = element('section');
		section.className = 'draft-recovery';
		section.append(element('h2', '復旧できる下書き'));
		for (const draft of current.recovery) {
			const item = element('div');
			item.append(element('p', `${draft.title ?? '新しいチャット'}${draft.conflict ? ' (競合)' : ''}`));
			const copy = element('button', '下書きをコピー');
			copy.addEventListener('click', () => post('copyDraft', { draftId: draft.draftId, revision: draft.revision }));
			const discard = element('button', '破棄');
			discard.addEventListener('click', () => post('recoverDraft', { draftId: draft.draftId, action: 'discard' }));
			item.append(copy);
			if (current.state !== 'unavailable') {
				const restore = element('button', '復元');
				restore.addEventListener('click', () => post('recoverDraft', { draftId: draft.draftId, action: 'restore' }));
				item.append(restore);
			}
			item.append(discard);
			section.append(item);
		}
		app.append(section);
	}
}

window.addEventListener('message', event => {
	const message = event.data as ChatSnapshot | { kind: 'draftAck' } | { kind: 'operationResult'; message?: string; ok: boolean };
	if (message.kind === 'snapshot') {
		render(message);
	} else if (message.kind === 'operationResult' && !message.ok && app) {
		const recovery = element('section');
		recovery.setAttribute('role', 'alert');
		recovery.append(element('p', message.message ?? '操作に失敗しました。下書きは保持されています。'));
		if (activeDraftId) {
			const copy = element('button', '下書きをコピー');
			copy.addEventListener('click', () => post('copyDraft', { draftId: activeDraftId, revision: activeRevision }));
			recovery.append(copy);
		}
		if (snapshot?.selectedChat) {
			const source = element('button', '原文を開く');
			source.addEventListener('click', () => post('openSource', { chatId: snapshot?.selectedChat }));
			recovery.append(source);
		}
		const refresh = element('button', '最新状態を再読み込み');
		refresh.addEventListener('click', () => post('refresh'));
		recovery.append(refresh);
		app.prepend(recovery);
	}
});

post('ready');
