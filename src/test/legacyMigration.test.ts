import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { migrateLegacyData } from '../legacyMigration';

suite('Legacy feature removal migration', () => {
	let workspace: vscode.Uri;
	let workspaceDirectory: string;
	let globalDirectory: string;
	let notesDirectory: string;
	const state = new Map<string, unknown>();
	const context = {
		globalStorageUri: vscode.Uri.file(''),
		workspaceState: {
			get: <T>(key: string) => state.get(key) as T | undefined,
			update: async (key: string, value: unknown) => { state.set(key, value); },
		},
	};

	setup(async () => {
		workspaceDirectory = await mkdtemp(join(tmpdir(), 'quick-note-migration-workspace-'));
		workspace = vscode.Uri.file(workspaceDirectory);
		globalDirectory = await mkdtemp(join(tmpdir(), 'quick-note-migration-'));
		context.globalStorageUri = vscode.Uri.file(globalDirectory);
		state.clear();
	});

	teardown(async () => {
		await rm(workspaceDirectory, { recursive: true, force: true });
		await rm(globalDirectory, { recursive: true, force: true });
	});

	test('removes only the approved legacy locations once and preserves Issue drafts and unrelated data', async () => {
		const relativePath = `out/migration-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		notesDirectory = join(workspace.fsPath, relativePath);
		await mkdir(join(notesDirectory, 'nested'), { recursive: true });
		await writeFile(join(notesDirectory, 'memo.md'), '# manual');
		await writeFile(join(notesDirectory, 'nested', 'chat.md'), 'old history');
		await mkdir(join(globalDirectory, 'chat-drafts'));
		await mkdir(join(globalDirectory, 'sidebar-drafts'));
		await mkdir(join(globalDirectory, 'issue-drafts'));
		await writeFile(join(globalDirectory, 'chat-drafts', 'old.json'), '{}');
		await writeFile(join(globalDirectory, 'sidebar-drafts', 'old.json'), '{}');
		await writeFile(join(globalDirectory, 'issue-drafts', 'keep.json'), '{}');
		await writeFile(join(globalDirectory, 'other.json'), '{}');

		await migrateLegacyData(context, workspace, relativePath);
		await assert.rejects(readFile(join(notesDirectory, 'memo.md')));
		await assert.rejects(readFile(join(globalDirectory, 'chat-drafts', 'old.json')));
		await assert.rejects(readFile(join(globalDirectory, 'sidebar-drafts', 'old.json')));
		assert.strictEqual(await readFile(join(globalDirectory, 'issue-drafts', 'keep.json'), 'utf8'), '{}');
		assert.strictEqual(await readFile(join(globalDirectory, 'other.json'), 'utf8'), '{}');

		await mkdir(notesDirectory, { recursive: true });
		await writeFile(join(notesDirectory, 'added-later.md'), 'preserve');
		await migrateLegacyData(context, workspace, relativePath);
		assert.strictEqual(await readFile(join(notesDirectory, 'added-later.md'), 'utf8'), 'preserve');
	});

	test('stops before deletion when the legacy folder overlaps the Issue store', async () => {
		const relativePath = '.quick-note-md/issues';
		const issueDirectory = join(workspace.fsPath, relativePath);
		await mkdir(issueDirectory, { recursive: true });
		await writeFile(join(issueDirectory, 'issue-000001.md'), 'keep');
		await assert.rejects(migrateLegacyData(context, workspace, relativePath), /overlap/);
		assert.strictEqual(await readFile(join(issueDirectory, 'issue-000001.md'), 'utf8'), 'keep');
	});
});
