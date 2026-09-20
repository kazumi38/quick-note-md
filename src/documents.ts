import * as vscode from 'vscode';
import { posix } from 'path';
import { lstat } from 'fs/promises';
import { appendText, ParsedTodo, parseTodos, safeFileName, statusInfo, TodoStatus, validateInput } from './core';

export interface TodoRef extends ParsedTodo {
	uri: vscode.Uri;
	version: number;
}

function missing(error: unknown): boolean {
	return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}

export class DocumentStore {
	private readonly queues = new Map<string, Promise<unknown>>();

	constructor(private readonly getRoot: () => vscode.Uri) {}

	private serial<T>(uri: vscode.Uri, action: () => Promise<T>): Promise<T> {
		const key = uri.toString();
		const previous = this.queues.get(key) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(action);
		this.queues.set(key, next);
		void next.finally(() => {
			if (this.queues.get(key) === next) { this.queues.delete(key); }
		}).catch(() => undefined);
		return next;
	}

	private async guard(uri: vscode.Uri, allowMissing = false): Promise<vscode.FileStat | undefined> {
		const root = this.getRoot();
		const relative = posix.relative(root.path, uri.path);
		if (uri.scheme !== root.scheme || uri.authority !== root.authority || uri.query || uri.fragment ||
			relative === '..' || relative.startsWith('../') || posix.isAbsolute(relative)) {
			throw new Error('保存先フォルダーの外は変更できません。');
		}
		let last: vscode.FileStat | undefined;
		const parts = relative.split('/').filter(Boolean);
		// Ancestors of the configured root may legitimately be platform symlinks (for example /var on macOS).
		for (let index = 0; index <= parts.length; index++) {
			const current = vscode.Uri.joinPath(root, ...parts.slice(0, index));
			try {
				last = await vscode.workspace.fs.stat(current);
				if (last.type & vscode.FileType.SymbolicLink) { throw new Error('シンボリックリンクは使用できません。'); }
				if (index < parts.length && !(last.type & vscode.FileType.Directory)) {
					throw new Error('保存先の親がフォルダーではありません。');
				}
			} catch (error) {
				if (allowMissing && missing(error)) { return undefined; }
				throw error;
			}
		}
		return last;
	}

	private async writable(uri: vscode.Uri): Promise<void> {
		const stat = await this.guard(uri);
		if (!stat || !(stat.type & vscode.FileType.File)) { throw new Error('Markdown ファイルが見つかりません。'); }
		if (stat.permissions === vscode.FilePermission.Readonly || vscode.workspace.fs.isWritableFileSystem(uri.scheme) === false) {
			throw new Error('ファイルは読み取り専用です。');
		}
		if (uri.scheme === 'file' && ((await lstat(uri.fsPath)).mode & 0o222) === 0) {
			throw new Error('ファイルは読み取り専用です。');
		}
	}

	private async document(uri: vscode.Uri, allowDirty = false): Promise<vscode.TextDocument> {
		await this.writable(uri);
		const document = await vscode.workspace.openTextDocument(uri);
		if (document.isDirty && !allowDirty) {
			throw new Error('未保存の変更があります。保存してから再実行してください。');
		}
		if (!document.isDirty) {
			const disk = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8').replace(/^\uFEFF/, '');
			if (disk !== document.getText()) { throw new Error('ファイルが外部で変更されました。再読み込みしてください。'); }
		}
		return document;
	}

	async list(): Promise<{ uri: vscode.Uri; title: string; mtime: number }[]> {
		const root = this.getRoot();
		const stat = await this.guard(root, true);
		if (!stat) { return []; }
		if (!(stat.type & vscode.FileType.Directory)) { throw new Error('保存先がフォルダーではありません。'); }
		const files: { uri: vscode.Uri; title: string; mtime: number }[] = [];
		const visit = async (directory: vscode.Uri): Promise<void> => {
			await this.guard(directory);
			for (const [name, type] of await vscode.workspace.fs.readDirectory(directory)) {
				if (type & vscode.FileType.SymbolicLink) { continue; }
				const uri = vscode.Uri.joinPath(directory, name);
				const info = await this.guard(uri, true);
				if (!info) { continue; }
				if (info.type & vscode.FileType.Directory) { await visit(uri); }
				else if ((info.type & vscode.FileType.File) && /\.md$/i.test(name)) {
					files.push({ uri, title: name.replace(/\.md$/i, ''), mtime: info.mtime });
				}
			}
		};
		await visit(root);
		return files.sort((a, b) => b.mtime - a.mtime || a.uri.toString().localeCompare(b.uri.toString()));
	}

	private async ensureRoot(): Promise<void> {
		const root = this.getRoot();
		await this.guard(root, true);
		await vscode.workspace.fs.createDirectory(root);
		await this.guard(root);
	}

	private async create(uri: vscode.Uri, text: string): Promise<void> {
		await this.guard(uri, true);
		const open = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString() && !document.isClosed);
		if (open && (open.isDirty || open.getText())) {
			throw new Error('同じ場所のエディターに内容が残っています。保存先と未保存の変更を確認してください。');
		}
		const edit = new vscode.WorkspaceEdit();
		edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
		edit.insert(uri, new vscode.Position(0, 0), text);
		if (!await vscode.workspace.applyEdit(edit)) { throw new Error('ファイルを作成できませんでした。同名ファイルや権限を確認してください。'); }
		const document = await vscode.workspace.openTextDocument(uri);
		if (document.getText() !== text.replace(/\r\n|\r|\n/g, document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n')) {
			throw new Error('作成中に別の変更がありました。入力を保持したまま保存を中止しました。');
		}
		await this.save(document);
	}

	private async save(document: vscode.TextDocument): Promise<void> {
		try {
			if (await document.save()) { return; }
		} catch {
			// Keep the document dirty so the user's input remains recoverable in the editor.
		}
		throw new Error('保存できませんでした。入力・編集内容はエディターに保持されています。');
	}

	async createMemo(title: string): Promise<vscode.Uri> {
		validateInput(title);
		const base = safeFileName(title).replace(/\.md$/i, '');
		if (!base) { throw new Error('使用できるファイル名を入力してください。'); }
		await this.ensureRoot();
		for (let index = 0; index < 1000; index++) {
			const uri = vscode.Uri.joinPath(this.getRoot(), `${base}${index ? `-${index + 1}` : ''}.md`);
			const created = await this.serial(uri, async () => {
				if (await this.guard(uri, true)) { return false; }
				await this.create(uri, `# ${title}\n`);
				return true;
			});
			if (created) { return uri; }
		}
		throw new Error('同名のメモが多すぎます。別の名前を指定してください。');
	}

	async createTodo(text: string): Promise<void> {
		validateInput(text);
		await this.ensureRoot();
		const uri = vscode.Uri.joinPath(this.getRoot(), 'todo.md');
		await this.serial(uri, async () => {
			if (!await this.guard(uri, true)) { await this.create(uri, `- [ ] ${text}\n`); }
			else { await this.appendNow(uri, `- [ ] ${text}`); }
		});
	}

	async append(uri: vscode.Uri, text: string): Promise<void> {
		validateInput(text);
		return this.serial(uri, () => this.appendNow(uri, text));
	}

	private async appendNow(uri: vscode.Uri, text: string): Promise<void> {
		const document = await this.document(uri);
		const existing = document.getText();
		const suffix = appendText(existing, text, document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
		await this.editNow(document, document.version, existing.length, existing.length, '', suffix, false);
	}

	async todos(): Promise<TodoRef[]> {
		const result: TodoRef[] = [];
		for (const { uri } of await this.list()) {
			await this.guard(uri);
			const document = await vscode.workspace.openTextDocument(uri);
			result.push(...parseTodos(document.getText()).map(todo => ({ ...todo, uri, version: document.version })));
		}
		return result;
	}

	private async todoDocument(ref: TodoRef): Promise<vscode.TextDocument> {
		const document = await this.document(ref.uri);
		if (document.version !== ref.version || ref.line < 0 || ref.line >= document.lineCount ||
			document.lineAt(ref.line).text !== ref.raw) {
			throw new Error('Todo が変更されました。一覧を更新して再実行してください。');
		}
		const actual = parseTodos(document.getText()).find(todo => todo.line === ref.line);
		if (!actual || actual.status === 'unknown' || actual.markerStart !== ref.markerStart || actual.status !== ref.status) {
			throw new Error('この Todo は安全に変更できません。Markdown で編集してください。');
		}
		return document;
	}

	async setStatus(ref: TodoRef, status: Exclude<TodoStatus, 'unknown'>): Promise<void> {
		if (!statusInfo[status] || (status as TodoStatus) === 'unknown') { throw new Error('ステータスが不正です。'); }
		return this.serial(ref.uri, async () => {
			const document = await this.todoDocument(ref);
			const start = document.offsetAt(new vscode.Position(ref.line, ref.markerStart + 1));
			await this.editNow(document, ref.version, start, start + 1, ref.raw[ref.markerStart + 1], statusInfo[status].marker, false);
		});
	}

	async deleteTodo(ref: TodoRef): Promise<void> {
		return this.serial(ref.uri, async () => {
			const document = await this.todoDocument(ref);
			const range = document.lineAt(ref.line).rangeIncludingLineBreak;
			await this.editNow(document, ref.version, document.offsetAt(range.start), document.offsetAt(range.end), document.getText(range), '', false);
		});
	}

	async edit(uri: vscode.Uri, version: number, start: number, end: number, before: string, text: string): Promise<number> {
		return this.serial(uri, async () => {
			const document = await this.document(uri, true);
			return this.editNow(document, version, start, end, before, text, document.isDirty);
		});
	}

	private async editNow(document: vscode.TextDocument, version: number, start: number, end: number, before: string, text: string, retainDirty: boolean): Promise<number> {
		await this.writable(document.uri);
		if (!retainDirty) {
			const disk = Buffer.from(await vscode.workspace.fs.readFile(document.uri)).toString('utf8').replace(/^\uFEFF/, '');
			if (disk !== document.getText()) { throw new Error('ファイルが外部で変更されました。再読み込みしてください。'); }
		}
		const content = document.getText();
		if (document.version !== version || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 ||
			end < start || end > content.length || content.slice(start, end) !== before || (!retainDirty && document.isDirty)) {
			throw new Error('内容が変更されました。再読み込みしてから編集してください。');
		}
		if (document.offsetAt(document.positionAt(start)) !== start || document.offsetAt(document.positionAt(end)) !== end) {
			throw new Error('改行の途中は編集できません。');
		}
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, new vscode.Range(document.positionAt(start), document.positionAt(end)), text);
		if (!await vscode.workspace.applyEdit(edit)) { throw new Error('編集を適用できませんでした。'); }
		const normalizedText = text.replace(/\r\n|\r|\n/g, document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
		const expected = content.slice(0, start) + normalizedText + content.slice(end);
		const expectedVersion = document.version === version + 1 || (expected === content && document.version === version);
		if (!expectedVersion || document.getText() !== expected) {
			throw new Error('編集中に別の変更がありました。入力を保持したまま保存を中止しました。Markdown を確認してください。');
		}
		const appliedVersion = document.version;
		if (retainDirty) {
			void vscode.window.showWarningMessage('未保存の変更を保持しています。Markdown を確認して保存してください。');
		} else { await this.save(document); }
		if (document.version !== appliedVersion || document.getText() !== expected) {
			throw new Error('保存中に別の変更がありました。最新の Markdown を確認してから編集してください。');
		}
		return appliedVersion;
	}
}
