import * as vscode from 'vscode';
import { createHash, randomUUID } from 'crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'path';
import { IssueComment, IssueDraftField, IssueRecord, IssueState, validateMetadata } from './issueMetadata';
import { parseIssueMarkdown, serializeIssueMarkdown } from './issueMarkdown';

export type IssueStateFilter = 'all' | IssueState;

export interface IssueReadResult {
	issueId: number;
	uri: vscode.Uri;
	raw: string;
	issue?: IssueRecord;
	error?: string;
}

export interface IssueListResult {
	issues: IssueRecord[];
	invalid: IssueReadResult[];
	openCount: number;
	closedCount: number;
	labels: string[];
}

export interface IssueSearchOptions {
	query?: string;
	state?: IssueStateFilter;
	label?: string;
}

export interface CreateIssueInput {
	title: string;
	bodyMarkdown: string;
}

export interface IssueChanges {
	title?: string;
	bodyMarkdown?: string;
	state?: IssueState;
	labels?: string[];
	comment?: { commentId?: string; bodyMarkdown: string };
}

const operationQueues = new Map<string, Promise<void>>();
const issueDirectoryName = '.quick-note-md';
const storeDirectoryName = 'issues';
const sequenceFileName = '.sequence.md';
const sequencePrefix = '<!-- quick-note-md:sequence:v1 ';

function issueFileName(id: number): string {
	return `issue-${String(id).padStart(6, '0')}.md`;
}

function revisionOf(source: string): number {
	return Number.parseInt(createHash('sha256').update(source).digest('hex').slice(0, 12), 16);
}

function isMissing(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function hasPathOverlap(left: string, right: string): boolean {
	const a = resolve(left);
	const b = resolve(right);
	return a === b || relative(a, b) === '' || !relative(a, b).startsWith(`..${sep}`) && !isAbsolute(relative(a, b))
		|| !relative(b, a).startsWith(`..${sep}`) && !isAbsolute(relative(b, a));
}

function issuePath(workspace: vscode.Uri, id: number): string {
	return resolve(workspace.fsPath, issueDirectoryName, storeDirectoryName, issueFileName(id));
}

function decodeSequence(source: string): number {
	const line = source.split(/\r?\n/, 1)[0];
	if (!line?.startsWith(sequencePrefix) || !line.endsWith(' -->')) {
		throw new Error('Issue sequence ledger is malformed; Issue creation is disabled to prevent ID reuse.');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(line.slice(sequencePrefix.length, -4).trim()) as unknown;
	} catch {
		throw new Error('Issue sequence ledger JSON is malformed; Issue creation is disabled to prevent ID reuse.');
	}
	if (!parsed || typeof parsed !== 'object' || !('nextId' in parsed)
		|| !Number.isSafeInteger(parsed.nextId) || (parsed.nextId as number) < 1) {
		throw new Error('Issue sequence ledger value is invalid; Issue creation is disabled to prevent ID reuse.');
	}
	return parsed.nextId as number;
}

function encodeSequence(nextId: number, eol: string): string {
	return `${sequencePrefix}${JSON.stringify({ nextId })} -->${eol}`;
}

function validateChanges(issue: IssueRecord, changes: IssueChanges): IssueRecord {
	const next: IssueRecord = {
		...issue,
		labels: [...issue.labels],
		comments: issue.comments.map(comment => ({ ...comment })),
	};
	if (changes.title !== undefined) {
		if (!changes.title.trim()) { throw new Error('Issue title cannot be empty.'); }
		next.title = changes.title.trim();
	}
	if (changes.bodyMarkdown !== undefined) { next.bodyMarkdown = changes.bodyMarkdown; }
	if (changes.state !== undefined) {
		if (changes.state !== 'open' && changes.state !== 'closed') { throw new Error('Issue state is invalid.'); }
		next.state = changes.state;
	}
	if (changes.labels !== undefined) {
		next.labels = changes.labels.map(label => label.trim());
		if (next.labels.some(label => !label) || new Set(next.labels).size !== next.labels.length) {
			throw new Error('Issue labels must be non-empty and unique.');
		}
	}
	if (changes.comment !== undefined) {
		const bodyMarkdown = changes.comment.bodyMarkdown.trim();
		if (!bodyMarkdown) { throw new Error('Comment cannot be empty.'); }
		if (changes.comment.commentId) {
			const index = next.comments.findIndex(comment => comment.id === changes.comment!.commentId);
			if (index < 0) { throw new Error('Comment no longer exists.'); }
			next.comments[index] = { ...next.comments[index], bodyMarkdown };
		} else {
			next.comments.push({ id: randomUUID(), bodyMarkdown, createdAt: new Date().toISOString() });
		}
	}
	next.updatedAt = new Date().toISOString();
	return next;
}

export class IssueStore {
	private readonly workspacePath: string;
	private readonly storePath: string;

	constructor(private readonly workspace: vscode.Uri) {
		if (workspace.scheme !== 'file') { throw new Error('Issue storage requires a local workspace folder.'); }
		this.workspacePath = resolve(workspace.fsPath);
		this.storePath = resolve(this.workspacePath, issueDirectoryName, storeDirectoryName);
		if (hasPathOverlap(this.storePath, this.workspacePath) && this.storePath === this.workspacePath) {
			throw new Error('Issue storage cannot be the workspace root.');
		}
	}

	get root(): vscode.Uri {
		return vscode.Uri.file(this.storePath);
	}

	private async assertPathSafe(create: boolean): Promise<void> {
		const workspaceReal = await realpath(this.workspacePath);
		const rootRelative = relative(workspaceReal, this.storePath);
		if (!rootRelative || rootRelative.startsWith(`..${sep}`) || isAbsolute(rootRelative)) {
			throw new Error('Issue storage must remain inside the workspace.');
		}
		let current = workspaceReal;
		for (const part of rootRelative.split(sep)) {
			current = resolve(current, part);
			try {
				const stats = await lstat(current);
				if (stats.isSymbolicLink() || !stats.isDirectory()) {
					throw new Error('Issue storage path cannot contain symbolic links or non-directory components.');
				}
			} catch (error) {
				if (!isMissing(error)) { throw error; }
				if (!create) { return; }
				await mkdir(current);
			}
			const actual = await realpath(current);
			const rel = relative(workspaceReal, actual);
			if (rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
				throw new Error('Issue storage resolves outside the workspace.');
			}
		}
	}

	private async readSource(path: string): Promise<string | undefined> {
		try {
			const stats = await lstat(path);
			if (stats.isSymbolicLink() || !stats.isFile()) {
				throw new Error('Issue files must be regular files, not symbolic links.');
			}
			const actual = await realpath(path);
			if (dirname(actual) !== await realpath(this.storePath)) {
				throw new Error('Issue file resolves outside the Issue store.');
			}
			return await readFile(path, 'utf8');
		} catch (error) {
			if (isMissing(error)) { return undefined; }
			throw error;
		}
	}

	private serial<T>(key: string, action: () => Promise<T>): Promise<T> {
		const previous = operationQueues.get(key) ?? Promise.resolve();
		let resolveResult: (value: T | PromiseLike<T>) => void;
		let rejectResult: (reason?: unknown) => void;
		const result = new Promise<T>((resolvePromise, rejectPromise) => {
			resolveResult = resolvePromise;
			rejectResult = rejectPromise;
		});
		const next = previous.catch(() => undefined).then(async () => {
			try { resolveResult(await action()); } catch (error) { rejectResult(error); }
		});
		operationQueues.set(key, next);
		void next.finally(() => {
			if (operationQueues.get(key) === next) { operationQueues.delete(key); }
		});
		return result;
	}

	private async atomicWrite(path: string, source: string, expectedSource: string | undefined, id: number): Promise<void> {
		const temp = `${path}.${randomUUID()}.tmp`;
		try {
			await writeFile(temp, source, { encoding: 'utf8', flag: 'wx' });
			const parsed = parseIssueMarkdown(await readFile(temp, 'utf8'), id);
			if (parsed.id !== id) { throw new Error('Temporary Issue file validation failed.'); }
			this.assertNoDirtyEditor(path);
			const current = await this.readSource(path);
			if (current !== expectedSource) {
				throw new Error('Issue changed on disk. The unsaved draft was preserved; reload before retrying.');
			}
			await rename(temp, path);
		} catch (error) {
			if (isMissing(error) && expectedSource === undefined) {
				throw new Error('Issue was removed before save completed.');
			}
			const reason = error instanceof Error ? error.message : String(error);
			throw new Error(`${reason} Recovery copy, if complete, is preserved at ${temp}.`);
		}
	}

	private assertNoDirtyEditor(path: string): void {
		const target = vscode.Uri.file(path).toString();
		if (vscode.workspace.textDocuments.some(document => document.uri.toString() === target && document.isDirty)) {
			throw new Error('Issue has unsaved editor changes. Save or close that document before updating it.');
		}
	}

	async read(id: number): Promise<IssueReadResult | undefined> {
		if (!Number.isSafeInteger(id) || id < 1) { throw new Error('Issue ID is invalid.'); }
		await this.assertPathSafe(false);
		const uri = vscode.Uri.file(issuePath(this.workspace, id));
		const raw = await this.readSource(uri.fsPath);
		if (raw === undefined) { return undefined; }
		try {
			const parsed = parseIssueMarkdown(raw, id);
			return { issueId: id, uri, raw, issue: { ...parsed, revision: revisionOf(raw) } };
		} catch (error) {
			return {
				issueId: id,
				uri,
				raw,
				error: error instanceof Error ? error.message : 'Issue Markdown is invalid.',
			};
		}
	}

	async list(options: IssueSearchOptions = {}): Promise<IssueListResult> {
		await this.assertPathSafe(false);
		let entries: import('fs').Dirent[] = [];
		try {
			entries = await readdir(this.storePath, { withFileTypes: true });
		} catch (error) {
			if (!isMissing(error)) { throw error; }
		}
		const records: IssueRecord[] = [];
		const invalid: IssueReadResult[] = [];
		for (const entry of entries) {
			const temporary = /^issue-(\d+)\.md\..+\.tmp$/.exec(entry.name);
			if (temporary) {
				const id = Number(temporary[1]);
				const path = resolve(this.storePath, entry.name);
				if (entry.isSymbolicLink() || !entry.isFile()) {
					invalid.push({ issueId: id, uri: vscode.Uri.file(path), raw: '', error: 'A recovery path is not a regular file.' });
				} else {
					const raw = await readFile(path, 'utf8');
					let reason = 'An interrupted-write recovery file was preserved; the canonical Issue was not changed.';
					try {
						if (parseIssueMarkdown(raw, id).id !== id) { throw new Error('Issue number differs.'); }
					} catch (error) {
						reason = `An incomplete recovery file was preserved: ${error instanceof Error ? error.message : String(error)}`;
					}
					invalid.push({ issueId: id, uri: vscode.Uri.file(path), raw, error: reason });
				}
				continue;
			}
			if (!/^issue-\d+\.md$/.test(entry.name)) { continue; }
			const id = Number(entry.name.match(/\d+/)?.[0]);
			const path = resolve(this.storePath, entry.name);
			if (entry.isSymbolicLink() || !entry.isFile()) {
				invalid.push({ issueId: id, uri: vscode.Uri.file(path), raw: '', error: 'Issue path is not a regular file.' });
				continue;
			}
			if (!Number.isSafeInteger(id) || id < 1 || issueFileName(id) !== entry.name) {
				const raw = await readFile(path, 'utf8');
				invalid.push({
					issueId: id,
					uri: vscode.Uri.file(path),
					raw,
					error: 'Issue filename is invalid.',
				});
				continue;
			}
			const result = await this.read(id);
			if (!result) { continue; }
			if (!result.issue) { invalid.push(result); } else { records.push(result.issue); }
		}
		const query = options.query?.trim().toLocaleLowerCase();
		const all = records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id);
		const labels = [...new Set(all.flatMap(issue => issue.labels.map(label => label.trim()).filter(Boolean)))].sort();
		const visible = all.filter(issue =>
			(options.state === undefined || options.state === 'all' || issue.state === options.state)
			&& (options.label === undefined || issue.labels.some(label => label.trim() === options.label))
			&& (!query || `${issue.title}\n${issue.bodyMarkdown}`.toLocaleLowerCase().includes(query)));
		return {
			issues: visible,
			invalid,
			openCount: all.filter(issue => issue.state === 'open').length,
			closedCount: all.filter(issue => issue.state === 'closed').length,
			labels,
		};
	}

	private async nextId(): Promise<{ id: number; sequenceRaw: string | undefined }> {
		const path = resolve(this.storePath, sequenceFileName);
		const sequenceRaw = await this.readSource(path);
		const entries = await this.list();
		const maxId = Math.max(0, ...entries.issues.map(issue => issue.id), ...entries.invalid.map(entry => entry.issueId || 0));
		const nextId = sequenceRaw === undefined ? maxId + 1 : Math.max(decodeSequence(sequenceRaw), maxId + 1);
		if (!Number.isSafeInteger(nextId) || nextId < 1) { throw new Error('No safe Issue number is available.'); }
		return { id: nextId, sequenceRaw };
	}

	private async saveSequence(nextId: number, expected: string | undefined): Promise<void> {
		const path = resolve(this.storePath, sequenceFileName);
		const current = await this.readSource(path);
		if (current !== expected) { throw new Error('Issue sequence changed during allocation. Retry creation.'); }
		const eol = current?.includes('\r\n') ? '\r\n' : '\n';
		const temp = `${path}.${randomUUID()}.tmp`;
		await writeFile(temp, encodeSequence(nextId, eol), { encoding: 'utf8', flag: 'wx' });
		if ((await this.readSource(path)) !== expected) {
			await rm(temp, { force: true });
			throw new Error('Issue sequence changed during allocation. Retry creation.');
		}
		if (expected === undefined) {
			try {
				await writeFile(path, await readFile(temp), { flag: 'wx' });
			} catch (error) {
				await rm(temp, { force: true });
				throw error;
			}
			await rm(temp, { force: true });
		} else {
			await rename(temp, path);
		}
	}

	async create(input: CreateIssueInput): Promise<IssueRecord> {
		await this.assertPathSafe(true);
		return this.serial(resolve(this.storePath, sequenceFileName), async () => {
			if (!input.title.trim()) { throw new Error('Issue title cannot be empty.'); }
			const { id, sequenceRaw } = await this.nextId();
			const now = new Date().toISOString();
			const issue: IssueRecord = {
				...validateMetadata({
					id, title: input.title, state: 'open', labels: [], createdAt: now, updatedAt: now,
				}),
				bodyMarkdown: input.bodyMarkdown,
				comments: [],
				revision: 0,
			};
			const path = issuePath(this.workspace, id);
			if (await this.readSource(path) !== undefined) {
				throw new Error('Issue number is already in use; retry creation.');
			}
			await this.saveSequence(id + 1, sequenceRaw);
			const eol = input.bodyMarkdown.includes('\r\n') ? '\r\n' : '\n';
			await this.atomicWrite(path, serializeIssueMarkdown(issue, eol), undefined, id);
			const saved = await this.read(id);
			if (!saved?.issue) { throw new Error(saved?.error ?? 'Created Issue could not be reread.'); }
			return saved.issue;
		});
	}

	async update(id: number, baseRevision: number, changes: IssueChanges): Promise<IssueRecord> {
		const path = issuePath(this.workspace, id);
		return this.serial(path, async () => {
			await this.assertPathSafe(false);
			const current = await this.read(id);
			if (!current?.issue) { throw new Error(current?.error ?? 'Issue no longer exists.'); }
			if (current.issue.revision !== baseRevision) {
				throw new Error('Issue changed after editing began. The unsaved draft was preserved.');
			}
			const next = validateChanges(current.issue, changes);
			const eol = current.raw.includes('\r\n') ? '\r\n' : '\n';
			await this.atomicWrite(path, serializeIssueMarkdown(next, eol), current.raw, id);
			const saved = await this.read(id);
			if (!saved?.issue) { throw new Error(saved?.error ?? 'Updated Issue could not be reread.'); }
			return saved.issue;
		});
	}

	async inspectFilesystemPath(path: string): Promise<boolean> {
		const target = resolve(path);
		try {
			const stat = await lstat(target);
			return stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory();
		} catch (error) {
			if (isMissing(error)) { return false; }
			throw error;
		}
	}

	static pathsOverlap(first: string, second: string): boolean {
		return hasPathOverlap(first, second);
	}

	static isIssueFileName(name: string): boolean {
		return basename(name) === name && /^issue-\d{6,}\.md$/.test(name);
	}
}

export type { IssueComment, IssueDraftField };
