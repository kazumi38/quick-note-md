import * as vscode from 'vscode';
import { createHash } from 'crypto';

export type DraftKind = 'body' | 'reply' | 'attributes';

export interface DraftSnapshot {
	kind: DraftKind;
	backupKey: string;
	todoIdentity: { filePath: string; originalText: string };
	replyId?: string;
	text?: string;
	labels?: string[];
	dueDate?: string;
	baseSource: string;
	baseVersion?: number;
	state: 'clean' | 'dirty' | 'saving' | 'conflict' | 'failed';
}

export class DraftStore {
	constructor(private readonly storage: vscode.Uri) {}

	private uri(key: string): vscode.Uri {
		const safe = createHash('sha256').update(key).digest('hex');
		return vscode.Uri.joinPath(this.storage, `${safe}.json`);
	}

	async save(snapshot: DraftSnapshot): Promise<void> {
		await vscode.workspace.fs.createDirectory(this.storage);
		await vscode.workspace.fs.writeFile(this.uri(snapshot.backupKey), Buffer.from(JSON.stringify(snapshot), 'utf8'));
	}

	async load(backupKey: string): Promise<DraftSnapshot | undefined> {
		try {
			const data = await vscode.workspace.fs.readFile(this.uri(backupKey));
			const parsed: unknown = JSON.parse(Buffer.from(data).toString('utf8'));
			if (!parsed || typeof parsed !== 'object' || !('backupKey' in parsed) || (parsed as { backupKey?: unknown }).backupKey !== backupKey) {
				throw new Error('下書きバックアップの形式が不正です。');
			}
			return parsed as DraftSnapshot;
		} catch (error) {
			if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') { return undefined; }
			throw error;
		}
	}

	async remove(backupKey: string): Promise<void> {
		try {
			await vscode.workspace.fs.delete(this.uri(backupKey), { useTrash: false });
		} catch (error) {
			if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) { throw error; }
		}
	}

	/** Enumerates every backup file, skipping unreadable or malformed entries rather than failing outright. */
	async list(): Promise<DraftSnapshot[]> {
		let entries: [string, vscode.FileType][];
		try {
			entries = await vscode.workspace.fs.readDirectory(this.storage);
		} catch (error) {
			if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') { return []; }
			throw error;
		}
		const snapshots: DraftSnapshot[] = [];
		for (const [name, type] of entries) {
			if (!(type & vscode.FileType.File) || !name.endsWith('.json')) { continue; }
			try {
				const data = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.storage, name));
				const parsed: unknown = JSON.parse(Buffer.from(data).toString('utf8'));
				if (parsed && typeof parsed === 'object' && typeof (parsed as { backupKey?: unknown }).backupKey === 'string') {
					snapshots.push(parsed as DraftSnapshot);
				}
			} catch { /* Corrupt or unreadable backups are skipped, never surfaced as data loss. */ }
		}
		return snapshots;
	}
}
