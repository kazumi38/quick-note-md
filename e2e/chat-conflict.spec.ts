import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { test, expect } from './fixtures';
import { messageEditor, readOnlySavedChat, sendButton } from './support/chat';

test.use({ fixtureChat: 'saved-chat' });
test('external edit conflict keeps the draft and external file changes', async ({ chat, environment }) => {
	const savedChatPath = join(environment.workspacePath, 'notes', 'Saved E2E Chat.md');

	await chat.getByRole('button', { name: 'Saved E2E Chat' }).click();
	await expect(messageEditor(chat)).toBeVisible();
	const draft = `Preserve through conflict ${Date.now()}`;
	await messageEditor(chat).fill(draft);

	const externalEdit = '\n<!-- external edit preserved by E2E -->\n';
	const originalFile = await readFile(savedChatPath, 'utf8');
	await writeFile(savedChatPath, `${originalFile}${externalEdit}`, 'utf8');
	await sendButton(chat).click();

	await expect(chat.getByRole('alert').filter({ hasText: /変更|競合|再読み込み|最新状態/ })).toBeVisible();
	await expect(messageEditor(chat)).toContainText(draft);
	expect(await readOnlySavedChat(environment)).toBe(`${originalFile}${externalEdit}`);
});
