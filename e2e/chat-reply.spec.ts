import { test, expect } from './fixtures';
import { readOnlySavedChat, savedChatFiles, sendButton, messageEditor } from './support/chat';

const savedChatTitle = 'Saved E2E Chat';
const originalMessage = 'Original saved message';
test.use({ fixtureChat: 'saved-chat' });

test('saved chat can be reopened and replied to without changing the original message', async ({ chat, environment }) => {
	await expect(chat.getByRole('button', { name: savedChatTitle })).toBeVisible();
	await chat.getByRole('button', { name: savedChatTitle }).click();
	await expect(chat.getByRole('heading', { name: savedChatTitle })).toBeVisible();
	await expect(chat.locator('.chat-message').filter({ hasText: originalMessage })).toBeVisible();

	const reply = `E2E reply ${Date.now()}`;
	await messageEditor(chat).fill(reply);
	await sendButton(chat).click();
	await expect(chat.locator('.chat-message').filter({ hasText: reply })).toBeVisible();

	await expect.poll(() => savedChatFiles(environment)).toHaveLength(1);
	const markdown = await readOnlySavedChat(environment);
	expect(markdown).toContain(originalMessage);
	expect(markdown.split(reply).length - 1).toBe(1);
});
