import * as vscode from 'vscode';
import { createHash, randomUUID } from 'crypto';
import { IssueDraft, validateRevision } from './issueMetadata';

const allowedFields = new Set(['title', 'body', 'labels', 'comment', 'state']);
const maxDraftValue = 524288;

function safeDraft(value: unknown): IssueDraft {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Issue draft is invalid.');
	}
	const draft = value as Partial<IssueDraft>;
	if (typeof draft.draftId !== 'string' || !draft.draftId
		|| (draft.issueId !== undefined && (!Number.isSafeInteger(draft.issueId) || draft.issueId < 1))
		|| !allowedFields.has(draft.field ?? '')
		|| (draft.commentId !== undefined && (typeof draft.commentId !== 'string' || !draft.commentId))
		|| !(typeof draft.value === 'string' || Array.isArray(draft.value) && draft.value.every(item => typeof item === 'string'))
		|| JSON.stringify(draft.value).length > maxDraftValue
		|| (draft.status !== 'dirty' && draft.status !== 'conflict')) {
		throw new Error('Issue draft is invalid.');
	}
	validateRevision(draft.baseRevision);
	return draft as IssueDraft;
}

export class IssueDraftStore {
	constructor(private readonly storage: vscode.Uri) {}

	private uri(draftId: string): vscode.Uri {
		const digest = createHash('sha256').update(draftId).digest('hex');
		return vscode.Uri.joinPath(this.storage, `${digest}.json`);
	}

	async save(value: IssueDraft): Promise<void> {
		const draft = safeDraft(value);
		await vscode.workspace.fs.createDirectory(this.storage);
		const target = this.uri(draft.draftId);
		const temp = vscode.Uri.joinPath(this.storage, `.${randomUUID()}.tmp`);
		try {
			await vscode.workspace.fs.writeFile(temp, Buffer.from(JSON.stringify(draft), 'utf8'));
			await vscode.workspace.fs.rename(temp, target, { overwrite: true });
		} catch (error) {
			try { await vscode.workspace.fs.delete(temp); } catch { /* Preserve the storage failure. */ }
			throw error;
		}
	}

	async load(draftId: string): Promise<IssueDraft | undefined> {
		try {
			const bytes = await vscode.workspace.fs.readFile(this.uri(draftId));
			const draft = safeDraft(JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown);
			if (draft.draftId !== draftId) { throw new Error('Issue draft identity does not match its file.'); }
			return draft;
		} catch (error) {
			if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') { return undefined; }
			throw error;
		}
	}

	async list(): Promise<IssueDraft[]> {
		let entries: [string, vscode.FileType][];
		try { entries = await vscode.workspace.fs.readDirectory(this.storage); } catch (error) {
			if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') { return []; }
			throw error;
		}
		const drafts: IssueDraft[] = [];
		for (const [name, type] of entries) {
			if (!(type & vscode.FileType.File) || !/^[a-f0-9]{64}\.json$/.test(name)) { continue; }
			const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.storage, name));
			const draft = safeDraft(JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown);
			if (this.uri(draft.draftId).path.split('/').pop() !== name) {
				throw new Error(`Issue draft identity does not match file ${name}.`);
			}
			drafts.push(draft);
		}
		return drafts;
	}

	async remove(draftId: string): Promise<void> {
		try { await vscode.workspace.fs.delete(this.uri(draftId), { useTrash: false }); } catch (error) {
			if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) { throw error; }
		}
	}
}

export { safeDraft as validateIssueDraft };
