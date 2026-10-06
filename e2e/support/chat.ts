import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { expect, type Frame } from '@playwright/test';
import type { ScenarioEnvironment } from './environment';

export function chatTitleInput(chat: Frame) {
	return chat.getByRole('textbox', { name: 'チャットのタイトル' });
}

export function messageEditor(chat: Frame) {
	return chat.getByRole('textbox', { name: 'Markdown メッセージ本文' });
}

export function sendButton(chat: Frame) {
	return chat.getByRole('button', { name: '送信', exact: true });
}

export async function savedChatFiles(environment: ScenarioEnvironment): Promise<string[]> {
	const notesPath = join(environment.workspacePath, 'notes');
	try {
		return (await readdir(notesPath)).filter(name => /\.md$/i.test(name)).map(name => join(notesPath, name));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return []; }
		throw error;
	}
}

export async function readOnlySavedChat(environment: ScenarioEnvironment): Promise<string> {
	const files = await savedChatFiles(environment);
	expect(files, 'expected exactly one saved chat in the isolated workspace').toHaveLength(1);
	return readFile(files[0], 'utf8');
}
