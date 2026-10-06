import * as vscode from 'vscode';
import { createHash } from 'crypto';

export interface ComposerDraft {
	schemaVersion: 1;
	draftId: string;
	target: { chatId?: string; sectionId: string };
	title?: string;
	markdown: string;
	baseFingerprint: string | null;
	revision: number;
	updatedAt: number;
}

export interface DraftListResult {
	drafts: ComposerDraft[];
	errors: string[];
}

export function fingerprint(source: string): string {
	return createHash('sha256').update(source, 'utf8').digest('hex');
}

export function validateComposerDraft(value: unknown): ComposerDraft {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('下書きデータの形式が不正です。');
	}
	const draft = value as Partial<ComposerDraft>;
	if (draft.schemaVersion !== 1) { throw new Error('未対応の下書きスキーマです。原文を確認してください。'); }
	const target = draft.target as ComposerDraft['target'] | undefined;
	if (typeof draft.draftId !== 'string' || !/^[0-9a-f]{32}$/.test(draft.draftId) ||
		!target || typeof target !== 'object' || Array.isArray(target) ||
		!Object.keys(target).every(key => key === 'chatId' || key === 'sectionId') ||
		typeof target.sectionId !== 'string' || target.sectionId.length === 0 || target.sectionId.length > 32 ||
		(target.chatId !== undefined && !/^[0-9a-f]{32}$/.test(target.chatId)) ||
		typeof draft.markdown !== 'string' || draft.markdown.length > 32000 ||
		(draft.title !== undefined && (typeof draft.title !== 'string' || draft.title.length > 512)) ||
		(draft.baseFingerprint !== null && (typeof draft.baseFingerprint !== 'string' ||
			!/^[0-9a-f]{64}$/.test(draft.baseFingerprint))) ||
		!Number.isSafeInteger(draft.revision) || (draft.revision ?? 0) < 0 ||
		!Number.isSafeInteger(draft.updatedAt) || (draft.updatedAt ?? 0) < 0 ||
		!Object.keys(value).every(key => ['schemaVersion', 'draftId', 'target', 'title', 'markdown',
			'baseFingerprint', 'revision', 'updatedAt'].includes(key))) {
		throw new Error('下書きデータが破損しているか、不正な値を含んでいます。');
	}
	return draft as ComposerDraft;
}

export function draftUri(storage: vscode.Uri, draftId: string): vscode.Uri {
	if (!/^[0-9a-f]{32}$/.test(draftId)) { throw new Error('下書き ID が不正です。'); }
	const filename = createHash('sha256').update(draftId).digest('hex');
	return vscode.Uri.joinPath(storage, `${filename}.json`);
}

export class ChatDraftStore {
	constructor(private readonly storage: vscode.Uri) {}

	async save(value: ComposerDraft): Promise<void> {
		const draft = validateComposerDraft(value);
		await vscode.workspace.fs.createDirectory(this.storage);
		await vscode.workspace.fs.writeFile(draftUri(this.storage, draft.draftId),
			Buffer.from(JSON.stringify(draft), 'utf8'));
	}

	async load(draftId: string): Promise<ComposerDraft | undefined> {
		try {
			const bytes = await vscode.workspace.fs.readFile(draftUri(this.storage, draftId));
			return validateComposerDraft(JSON.parse(Buffer.from(bytes).toString('utf8')));
		} catch (error) {
			if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') { return undefined; }
			throw error;
		}
	}

	async list(): Promise<DraftListResult> {
		let entries: [string, vscode.FileType][];
		try {
			entries = await vscode.workspace.fs.readDirectory(this.storage);
		} catch (error) {
			if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
				return { drafts: [], errors: [] };
			}
			throw error;
		}
		const result: DraftListResult = { drafts: [], errors: [] };
		for (const [filename, type] of entries) {
			if (!(type & vscode.FileType.File) || !/^[0-9a-f]{64}\.json$/.test(filename)) { continue; }
			const uri = vscode.Uri.joinPath(this.storage, filename);
			try {
				const bytes = await vscode.workspace.fs.readFile(uri);
				const draft = validateComposerDraft(JSON.parse(Buffer.from(bytes).toString('utf8')));
				if (draftUri(this.storage, draft.draftId).path !== uri.path) {
					throw new Error('下書きファイル名と ID が一致しません。');
				}
				result.drafts.push(draft);
			} catch (error) {
				result.errors.push(`${filename}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		return result;
	}

	async remove(draftId: string): Promise<void> {
		try {
			await vscode.workspace.fs.delete(draftUri(this.storage, draftId), { useTrash: false });
		} catch (error) {
			if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) { throw error; }
		}
	}
}
