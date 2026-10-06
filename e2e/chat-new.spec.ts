import { test, expect } from './fixtures';
import { readOnlySavedChat, savedChatFiles, sendButton, messageEditor, chatTitleInput } from './support/chat';

test('new chat is shown and saved in Markdown', async ({ chat, environment }) => {
	const title = `E2E chat ${Date.now()}`;
	const message = `E2E message ${Date.now()}`;

	await chat.getByRole('button', { name: '新しいチャット' }).click();
	await expect(chatTitleInput(chat)).toBeVisible();
	await chatTitleInput(chat).fill(title);
	await messageEditor(chat).fill(message);
	await sendButton(chat).click();

	await expect(chat.getByRole('heading', { name: title })).toBeVisible();
	await expect(chat.locator('.chat-message').filter({ hasText: message })).toBeVisible();

	await expect.poll(() => savedChatFiles(environment)).toHaveLength(1);
	const markdown = await readOnlySavedChat(environment);
	expect(markdown).toContain(`# ${title}`);
	expect(markdown).toContain(message);
});

test('empty new-chat message is rejected without creating a saved chat', async ({ chat, environment }) => {
	await chat.getByRole('button', { name: '新しいチャット' }).click();
	await expect(chatTitleInput(chat)).toBeVisible();
	await chatTitleInput(chat).fill(`Empty E2E ${Date.now()}`);
	await sendButton(chat).click();
	await expect(chat.getByRole('alert').filter({ hasText: /空白だけのメッセージは送信できません/ })).toBeVisible();
	expect(await savedChatFiles(environment)).toHaveLength(0);
});
