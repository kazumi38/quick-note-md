import { chmod, readFile } from 'fs/promises';
import { test, expect } from './fixtures';
import { messageEditor, readOnlySavedChat, sendButton } from './support/chat';
import { join } from 'path';

test.use({ fixtureChat: 'saved-chat' });
test('read-only chat prevents sending and preserves the reply draft and file', async ({ chat, environment }) => {
	const savedChatPath = join(environment.workspacePath, 'notes', 'Saved E2E Chat.md');

	await chat.getByRole('button', { name: 'Saved E2E Chat' }).click();
	await expect(messageEditor(chat)).toBeVisible();
	const draft = `Preserve after failed save ${Date.now()}`;
	await messageEditor(chat).fill(draft);
	const originalFile = await readFile(savedChatPath, 'utf8');
	await chmod(savedChatPath, 0o444);

	try {
		await expect(chat.getByRole('button', { name: 'Saved E2E Chat (読み取り専用)' })).toBeVisible();
		await expect(sendButton(chat)).toBeDisabled();
		await expect(messageEditor(chat)).toContainText(draft);
		expect(await readOnlySavedChat(environment)).toBe(originalFile);
	} finally {
		await chmod(savedChatPath, 0o666);
	}
});
