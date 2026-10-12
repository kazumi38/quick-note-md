import * as vscode from 'vscode';
import { lstat, readdir, rm } from 'fs/promises';
import { isAbsolute, relative, resolve, sep } from 'path';
import { directorySegments } from './configuration';
import { IssueStore } from './issueStore';

const completionKey = 'issue-sidebar.legacy-cleanup-complete';

export interface MigrationContext {
	globalStorageUri: vscode.Uri;
	workspaceState: {
		get<T>(key: string): T | undefined;
		update(key: string, value: unknown): Thenable<void>;
	};
}

function overlaps(left: string, right: string): boolean {
	const a = resolve(left);
	const b = resolve(right);
	const aToB = relative(a, b);
	const bToA = relative(b, a);
	return !aToB.startsWith(`..${sep}`) && !isAbsolute(aToB)
		|| !bToA.startsWith(`..${sep}`) && !isAbsolute(bToA);
}

function missing(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

async function assertNoLinks(path: string): Promise<void> {
	let stat;
	try { stat = await lstat(path); } catch (error) {
		if (missing(error)) { return; }
		throw error;
	}
	if (stat.isSymbolicLink()) {
		throw new Error(`Legacy cleanup refused a symbolic link: ${path}`);
	}
	if (!stat.isDirectory()) { return; }
	for (const entry of await readdir(path, { withFileTypes: true })) {
		await assertNoLinks(resolve(path, entry.name));
	}
}

async function assertNoLinkedAncestors(path: string, root: string): Promise<void> {
	const rel = relative(resolve(root), resolve(path));
	if (!rel || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
		throw new Error('Cleanup path escaped its approved storage root.');
	}
	let current = resolve(root);
	for (const segment of rel.split(sep)) {
		current = resolve(current, segment);
		try {
			if ((await lstat(current)).isSymbolicLink()) {
				throw new Error(`Legacy cleanup refused a symbolic link: ${current}`);
			}
		} catch (error) {
			if (!missing(error)) { throw error; }
			return;
		}
	}
}

function assertContained(target: string, root: string, description: string): void {
	const relativeTarget = relative(resolve(root), resolve(target));
	if (!relativeTarget || relativeTarget.startsWith(`..${sep}`) || isAbsolute(relativeTarget)) {
		throw new Error(`${description} must be a child path, never the storage root or an external path.`);
	}
}

export async function migrateLegacyData(
	context: MigrationContext,
	workspace: vscode.Uri,
	legacyNotesDirectory = vscode.workspace.getConfiguration('quick-note-md', workspace)
		.get<string>('notesDirectory', 'notes'),
): Promise<void> {
	if (workspace.scheme !== 'file') { throw new Error('Legacy data cleanup requires a local workspace folder.'); }
	if (context.workspaceState.get<boolean>(completionKey)) { return; }

	const workspaceRoot = resolve(workspace.fsPath);
	const workspaceSegments = directorySegments(legacyNotesDirectory);
	const oldWorkspacePath = vscode.Uri.joinPath(workspace, ...workspaceSegments).fsPath;
	const issueStorePath = vscode.Uri.joinPath(workspace, '.quick-note-md', 'issues').fsPath;
	const issueDraftPath = vscode.Uri.joinPath(context.globalStorageUri, 'issue-drafts').fsPath;
	const globalStoragePath = context.globalStorageUri.fsPath;
	const oldTargets = [
		{ path: oldWorkspacePath, root: workspaceRoot, name: 'legacy notes directory', directory: true },
		{ path: resolve(globalStoragePath, 'chat-drafts'), root: globalStoragePath, name: 'legacy chat drafts', directory: true },
		{ path: resolve(globalStoragePath, 'sidebar-drafts'), root: globalStoragePath, name: 'legacy sidebar drafts', directory: true },
	];

	if (workspaceSegments.some(segment => segment === '.quick-note-md')) {
		throw new Error('The legacy notes directory cannot overlap the new Issue store.');
	}
	for (const target of oldTargets) {
		assertContained(target.path, target.root, target.name);
		if (overlaps(target.path, issueStorePath) || overlaps(target.path, issueDraftPath)) {
			throw new Error(`${target.name} overlaps new Issue data; cleanup was stopped without deleting anything.`);
		}
		await assertNoLinkedAncestors(target.path, target.root);
	}
	for (const target of oldTargets) {
		if (target.directory) {
			try {
				const stat = await lstat(target.path);
				if (stat.isSymbolicLink() || !stat.isDirectory()) {
					throw new Error(`${target.name} is not a safe directory; cleanup was stopped.`);
				}
			} catch (error) {
				if (!missing(error)) { throw error; }
			}
			await assertNoLinks(target.path);
		}
	}

	for (const target of oldTargets) {
		try {
			await rm(target.path, { recursive: true, force: true });
		} catch (error) {
			throw new Error(`Could not remove ${target.name} at ${target.path}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	await context.workspaceState.update(completionKey, true);
}

export function legacyMigrationPathsDoNotOverlap(paths: readonly string[]): boolean {
	for (let left = 0; left < paths.length; left++) {
		for (let right = left + 1; right < paths.length; right++) {
			if (overlaps(paths[left], paths[right])) { return false; }
		}
	}
	return true;
}
