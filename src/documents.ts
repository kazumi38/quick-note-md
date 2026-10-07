import * as vscode from 'vscode';
import { posix, relative as pathRelative, isAbsolute as pathIsAbsolute } from 'path';
import { lstat } from 'fs/promises';
import { appendText, normalizeLabels, ParsedMemoExtension, ParsedTodo, parseMemoExtension, parseTodoComments, parseTodos, safeFileName, serializeComments, serializeMemoBody, serializeMemoExtension, serializeTodoBody, serializeTodoMetadata, statusInfo, TodoStatus, validateInput } from './core';
import { parseChatMarkdown, serializeChatMessage } from './chatMarkdown';

export interface TodoRef extends ParsedTodo {
	uri: vscode.Uri;
	version: number;
	comments?: ReturnType<typeof parseTodoComments>;
}

export interface MemoComment {
	id: string;
	order: number;
	bodyMarkdown: string;
}

export interface MemoRef extends Omit<ParsedMemoExtension, 'comments'> {
	uri: vscode.Uri;
	version: number;
	title: string;
	sourceText: string;
	comments: MemoComment[];
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
		const relative = uri.scheme === 'file' && root.scheme === 'file'
			? pathRelative(root.fsPath, uri.fsPath).replace(/\\/g, '/')
			: posix.relative(root.path, uri.path);
		if (uri.scheme !== root.scheme || uri.authority !== root.authority || uri.query || uri.fragment ||
			relative === '..' || relative.startsWith('../') || pathIsAbsolute(relative)) {
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
		if (await this.isReadOnly(uri, stat)) {
			throw new Error('ファイルは読み取り専用です。');
		}
	}

	private async isReadOnly(uri: vscode.Uri, stat: vscode.FileStat): Promise<boolean> {
		return stat.permissions === vscode.FilePermission.Readonly ||
			vscode.workspace.fs.isWritableFileSystem(uri.scheme) === false ||
			(uri.scheme === 'file' && ((await lstat(uri.fsPath)).mode & 0o222) === 0);
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

	async memos(): Promise<MemoRef[]> {
		const files = await this.list();
		const result: MemoRef[] = [];
		const todoUri = vscode.Uri.joinPath(this.getRoot(), 'todo.md').toString();
		for (const file of files) {
			if (file.uri.toString() === todoUri) { continue; }
			await this.guard(file.uri);
			const document = await vscode.workspace.openTextDocument(file.uri);
			const sourceText = document.getText();
			const chat = parseChatMarkdown(sourceText).thread;
			if (chat?.sections.some(section => section.messages.length > 0)) { continue; }
			const parsed = parseMemoExtension(sourceText);
			result.push({
				...parsed,
				uri: file.uri,
				version: document.version,
				title: file.title,
				sourceText,
				comments: parsed.comments.map((bodyMarkdown, order) => ({ id: `memo-comment-${order}`, order, bodyMarkdown })),
			});
		}
		return result;
	}

	private async memoDocument(ref: MemoRef): Promise<vscode.TextDocument> {
		const document = await this.document(ref.uri);
		if (document.version !== ref.version || document.getText() !== ref.sourceText) {
			throw new Error('メモが変更されました。一覧を更新して再実行してください。');
		}
		const parsed = parseMemoExtension(document.getText());
		if (parsed.readOnly) { throw new Error(parsed.warning ?? 'メモの拡張ブロックを安全に編集できません。'); }
		return document;
	}

	async createMemoWithBody(title: string, bodyMarkdown: string): Promise<vscode.Uri> {
		validateInput(title);
		const base = safeFileName(title).replace(/\.md$/i, '');
		if (!base) { throw new Error('使用できるファイル名を入力してください。'); }
		await this.ensureRoot();
		for (let index = 0; index < 1000; index++) {
			const uri = vscode.Uri.joinPath(this.getRoot(), `${base}${index ? `-${index + 1}` : ''}.md`);
			const created = await this.serial(uri, async () => {
				if (await this.guard(uri, true)) { return false; }
				await this.create(uri, serializeMemoBody(bodyMarkdown));
				return true;
			});
			if (created) { return uri; }
		}
		throw new Error('同名のメモが多すぎます。別の名前を指定してください。');
	}

	async editMemoBody(ref: MemoRef, bodyMarkdown: string): Promise<number> {
		return this.serial(ref.uri, async () => {
			const document = await this.memoDocument(ref);
			const parsed = parseMemoExtension(document.getText());
			const start = 0;
			const end = parsed.descriptionStoredLength;
			const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
			return this.editNow(document, ref.version, start, end, document.getText().slice(start, end),
				serializeMemoBody(bodyMarkdown, eol), false);
		});
	}

	private async updateMemoExtension(ref: MemoRef, labels: readonly string[], comments: readonly string[]): Promise<number> {
		return this.serial(ref.uri, async () => {
			const document = await this.memoDocument(ref);
			const source = document.getText();
			const parsed = parseMemoExtension(source);
			const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
			const updated = labels.length || comments.length
				? serializeMemoExtension(parsed.descriptionMarkdown, labels, comments, eol)
				: serializeMemoBody(parsed.descriptionMarkdown, eol);
			return this.editNow(document, ref.version, 0, source.length, source, updated, false);
		});
	}

	async setMemoLabels(ref: MemoRef, labels: readonly string[]): Promise<number> {
		const normalized = labels.map(label => label.trim());
		if (normalized.some(label => !label) || new Set(normalized).size !== normalized.length) {
			throw new Error('ラベル名は空白のみや同一表記の重複を避けてください。');
		}
		return this.updateMemoExtension(ref, normalizeLabels(normalized), ref.comments.map(comment => comment.bodyMarkdown));
	}

	async addMemoComment(ref: MemoRef, text: string): Promise<number> {
		if (!text.trim()) { throw new Error('コメントを入力してください。'); }
		return this.updateMemoExtension(ref, ref.labels, [...ref.comments.map(comment => comment.bodyMarkdown), text]);
	}

	async editMemoComment(ref: MemoRef, commentId: string, text: string): Promise<number> {
		if (!text.trim()) { throw new Error('コメントを入力してください。'); }
		const index = ref.comments.findIndex(comment => comment.id === commentId);
		if (index < 0) { throw new Error('コメントが見つかりません。'); }
		const comments = ref.comments.map((comment, ordinal) => ordinal === index ? text : comment.bodyMarkdown);
		return this.updateMemoExtension(ref, ref.labels, comments);
	}

	async deleteMemoComment(ref: MemoRef, commentId: string): Promise<number> {
		if (!ref.comments.some(comment => comment.id === commentId)) { throw new Error('コメントが見つかりません。'); }
		const comments = ref.comments.filter(comment => comment.id !== commentId).map(comment => comment.bodyMarkdown);
		return this.updateMemoExtension(ref, ref.labels, comments);
	}

	async renameMemo(ref: MemoRef, title: string): Promise<vscode.Uri> {
		validateInput(title);
		const base = safeFileName(title).replace(/\.md$/i, '');
		if (!base) { throw new Error('使用できるファイル名を入力してください。'); }
		return this.serial(ref.uri, async () => {
			const document = await this.memoDocument(ref);
			const target = vscode.Uri.joinPath(ref.uri.with({ path: ref.uri.path.slice(0, ref.uri.path.lastIndexOf('/')) }), `${base}.md`);
			if (target.toString() === ref.uri.toString()) { return ref.uri; }
			if (await this.guard(target, true)) { throw new Error('同じ名前のメモが既にあります。別のタイトルを指定してください。'); }
			await vscode.workspace.fs.rename(document.uri, target, { overwrite: false });
			return target;
		});
	}

	async readChat(uri: vscode.Uri): Promise<{ text: string; version: number; dirty: boolean; readOnly: boolean }> {
		const stat = await this.guard(uri);
		if (!stat || !(stat.type & vscode.FileType.File) || !/\.md$/i.test(uri.path)) {
			throw new Error('管理対象の Markdown チャットが見つかりません。');
		}
		const document = await vscode.workspace.openTextDocument(uri);
		return {
			text: document.getText(),
			version: document.version,
			dirty: document.isDirty,
			readOnly: await this.isReadOnly(uri, stat)
		};
	}

	async createChat(title: string, timestamp: string, body: string, id: string): Promise<vscode.Uri> {
		if (!title.trim()) { throw new Error('チャットのタイトルを入力してください。'); }
		if (!body.trim()) { throw new Error('本文を入力してください。'); }
		validateInput(title);
		const base = safeFileName(title).replace(/\.md$/i, '');
		if (!base) { throw new Error('使用できるチャット名を入力してください。'); }
		const message = serializeChatMessage(timestamp, body, id);
		await this.ensureRoot();
		for (let index = 0; index < 1000; index++) {
			const uri = vscode.Uri.joinPath(this.getRoot(), `${base}${index ? `-${index + 1}` : ''}.md`);
			const created = await this.serial(uri, async () => {
				if (await this.guard(uri, true)) { return false; }
				await this.create(uri, `# ${title}\n\n## 本文\n\n${message}\n`);
				return true;
			});
			if (created) { return uri; }
		}
		throw new Error('同名のチャットが多すぎます。別のタイトルを指定してください。');
	}

	async appendChatMessage(
		uri: vscode.Uri, sectionName: string, timestamp: string, body: string, id: string, expectedVersion: number
	): Promise<number> {
		if (!body.trim()) { throw new Error('本文を入力してください。'); }
		const message = serializeChatMessage(timestamp, body, id);
		return this.serial(uri, async () => {
			const document = await this.document(uri);
			if (document.version !== expectedVersion) { throw new Error('チャットが変更されました。最新状態を再読み込みしてください。'); }
			const source = document.getText();
			const parsed = parseChatMarkdown(source);
			if (parsed.state !== 'valid' || !parsed.thread) {
				throw new Error(parsed.issue ?? 'このチャット形式には安全に追記できません。');
			}
			const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
			const section = [...parsed.thread.sections].reverse().find(item => item.name === sectionName);
			if (!section) {
				const insertionAt = source.length;
				const separator = source.endsWith(eol + eol) ? '' : source.endsWith(eol) ? eol : eol + eol;
				const insertion = `${separator}## ${sectionName}${eol}${eol}${message}${eol}`;
				return this.editNow(document, expectedVersion, insertionAt, insertionAt, '', insertion, false);
			}
			const insertionAt = section.sourceRange.end;
			const beforeSection = source.slice(section.sourceRange.start, insertionAt);
			const separator = beforeSection.endsWith(eol + eol) ? '' : beforeSection.endsWith(eol) ? eol : eol + eol;
			const insertion = `${separator}${message}${eol}`;
			return this.editNow(document, expectedVersion, insertionAt, insertionAt, '', insertion, false);
		});
	}

	async toggleChatTask(uri: vscode.Uri, messageId: string, taskId: string, checked: boolean, expectedVersion: number): Promise<number> {
		return this.serial(uri, async () => {
			const document = await this.document(uri);
			if (document.version !== expectedVersion) { throw new Error('チャットが変更されました。最新状態を再読み込みしてください。'); }
			const parsed = parseChatMarkdown(document.getText());
			if (parsed.state !== 'valid' || !parsed.thread) {
				throw new Error(parsed.issue ?? 'このチャット形式ではチェック状態を変更できません。');
			}
			const message = parsed.thread.sections.flatMap(section => section.messages)
				.find(candidate => candidate.id === messageId);
			const task = message?.tasks.find(candidate => candidate.id === taskId);
			if (!task || !['open', 'done'].includes(task.status) || task.checked === checked) {
				throw new Error('対象のチェック項目が変更または削除されています。最新状態を再読み込みしてください。');
			}
			const start = task.start + 1;
			const before = document.getText()[start];
			return this.editNow(document, expectedVersion, start, start + 1, before, checked ? 'x' : ' ', false);
		});
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

	async createTodoWithBody(text: string, bodyMarkdown: string): Promise<string> {
		validateInput(text);
		await this.ensureRoot();
		const uri = vscode.Uri.joinPath(this.getRoot(), 'todo.md');
		await this.serial(uri, async () => {
			if (!await this.guard(uri, true)) {
				const eol = '\n';
				await this.create(uri, `- [ ] ${text}${eol}${bodyMarkdown.trim()
					? `${serializeTodoBody(bodyMarkdown, eol)}${eol}` : ''}`);
				return;
			}
			const document = await this.document(uri);
			const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
			const source = document.getText();
			const row = `- [ ] ${text}`;
			const suffix = `${appendText(source, row, eol)}${bodyMarkdown.trim()
				? `${serializeTodoBody(bodyMarkdown, eol)}${eol}` : ''}`;
			await this.editNow(document, document.version, source.length, source.length, '', suffix, false);
		});
		const matches = (await this.todos()).filter(todo => todo.uri.toString() === uri.toString() && todo.text === text);
		const created = matches[matches.length - 1];
		if (!created) { throw new Error('作成した Todo を一覧から特定できませんでした。'); }
		return `${uri.toString()}::${created.line}`;
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
			result.push(...parseTodos(document.getText()).map(todo => ({
				...todo, uri, version: document.version,
				comments: parseTodoComments(document.getText(), todo, uri.fsPath),
			})));
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
		if (!actual || actual.status === 'unknown' || actual.readOnly || actual.markerStart !== ref.markerStart || actual.status !== ref.status) {
			throw new Error(actual?.warning ?? 'この Todo は安全に変更できません。Markdown で編集してください。');
		}
		return document;
	}

	private extensionRange(document: vscode.TextDocument, ref: TodoRef): { start: number; end: number } | undefined {
		const lines = document.getText().split(/\r\n|\n|\r/);
		let line = ref.line + 1;
		if (lines[line]?.trim().startsWith('<!-- quick-note-md:meta')) { line++; }
		if (lines[line]?.trim() === '<!-- quick-note-md:body -->') {
			while (line < lines.length && lines[line]?.trim() !== '<!-- quick-note-md:end-body -->') { line++; }
			if (line >= lines.length) { return undefined; }
			line++;
		}
		if (lines[line]?.trim() === '<!-- quick-note-md:comments -->') {
			while (line < lines.length && lines[line]?.trim() !== '<!-- quick-note-md:end-comments -->') { line++; }
			if (line >= lines.length) { return undefined; }
			line++;
		}
		if (line === ref.line + 1) { return undefined; }
		const start = document.offsetAt(new vscode.Position(ref.line + 1, 0));
		return { start, end: document.offsetAt(new vscode.Position(line, 0)) };
	}

	/** Offset right after any existing meta/body blocks, i.e. where a comments block belongs if one is absent. */
	private metaBodyEndOffset(document: vscode.TextDocument, ref: TodoRef): number {
		const lines = document.getText().split(/\r\n|\n|\r/);
		let line = ref.line + 1;
		if (lines[line]?.trim().startsWith('<!-- quick-note-md:meta')) { line++; }
		if (lines[line]?.trim() === '<!-- quick-note-md:body -->') {
			while (line < lines.length && lines[line]?.trim() !== '<!-- quick-note-md:end-body -->') { line++; }
			line++;
		}
		return document.offsetAt(new vscode.Position(line, 0));
	}

	private todoComments(document: vscode.TextDocument, ref: TodoRef) {
		const actual = parseTodos(document.getText()).find(todo => todo.line === ref.line);
		if (!actual) { throw new Error('Todo が変更されました。一覧を更新して再実行してください。'); }
		const comments = parseTodoComments(document.getText(), actual, ref.uri.fsPath);
		if (comments.readOnly) { throw new Error(comments.warning ?? 'コメント境界を認識できないため編集できません。'); }
		return { actual, comments };
	}

	private commentRange(document: vscode.TextDocument, comments: ReturnType<typeof parseTodoComments>): { start: number; end: number } | undefined {
		if (!comments.sourceText) { return undefined; }
		const lines = document.getText().split(/\r\n|\n|\r/);
		let line = comments.todoId.lineNumber + 1;
		if (lines[line]?.trim().startsWith('<!-- quick-note-md:meta')) { line++; }
		if (lines[line]?.trim() === '<!-- quick-note-md:body -->') {
			while (line < lines.length && lines[line]?.trim() !== '<!-- quick-note-md:end-body -->') { line++; }
			line++;
		}
		if (lines[line]?.trim() !== '<!-- quick-note-md:comments -->') { return undefined; }
		const start = document.offsetAt(new vscode.Position(line, 0));
		let endLine = line;
		while (endLine < lines.length && lines[endLine]?.trim() !== '<!-- quick-note-md:end-comments -->') { endLine++; }
		if (endLine >= lines.length) { return undefined; }
		endLine++;
		return { start, end: document.offsetAt(new vscode.Position(endLine, 0)) };
	}

	async editTodoBody(ref: TodoRef, text: string): Promise<number> {
		return this.serial(ref.uri, async () => {
			const document = await this.todoDocument(ref);
			const actual = parseTodos(document.getText()).find(todo => todo.line === ref.line);
			if (!actual || actual.readOnly) { throw new Error(actual?.warning ?? '本文を安全に編集できません。'); }
			const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
			const indent = /^[ \t]*/.exec(ref.raw)?.[0] ?? '';
			const lines = document.getText().split(/\r\n|\n|\r/);
			let bodyLine = ref.line + 1;
			if (lines[bodyLine]?.trim().startsWith('<!-- quick-note-md:meta')) { bodyLine++; }
			if (lines[bodyLine]?.trim() === '<!-- quick-note-md:body -->') {
				let endLine = bodyLine;
				while (endLine < lines.length && lines[endLine]?.trim() !== '<!-- quick-note-md:end-body -->') { endLine++; }
				if (endLine >= lines.length) { throw new Error('本文境界を認識できないため編集できません。'); }
				const start = document.offsetAt(new vscode.Position(bodyLine, 0));
				const end = document.offsetAt(new vscode.Position(endLine + 1, 0));
				return this.editNow(document, ref.version, start, end, document.getText().slice(start, end), serializeTodoBody(text, eol, indent) + eol, false);
			}

			const insertAt = document.offsetAt(new vscode.Position(bodyLine, 0));
			const prefix = insertAt === document.getText().length && !document.getText().endsWith('\n') ? eol : '';
			return this.editNow(document, ref.version, insertAt, insertAt, '', prefix + serializeTodoBody(text, eol, indent) + eol, false);
		});
	}

	async editTodoTitle(ref: TodoRef, title: string): Promise<number> {
		validateInput(title);
		return this.serial(ref.uri, async () => {
			const document = await this.todoDocument(ref);
			const close = ref.markerStart + 2;
			const prefix = ref.raw.slice(0, close + 1);
			const spacing = /^[ \t]*/.exec(ref.raw.slice(close + 1))?.[0] || ' ';
			const replacement = `${prefix}${spacing}${title}`;
			const line = document.lineAt(ref.line);
			return this.editNow(document, ref.version, document.offsetAt(line.range.start), document.offsetAt(line.range.end),
				ref.raw, replacement, false);
		});
	}

	async addTodoComment(ref: TodoRef, text: string): Promise<number> {
		if (!text.trim()) { throw new Error('コメントを入力してください。'); }
		return this.serial(ref.uri, async () => {
			const document = await this.todoDocument(ref);
			const { comments } = this.todoComments(document, ref);
			const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
			const indent = /^[ \t]*/.exec(ref.raw)?.[0] ?? '';
			const body = comments.comments.map(comment => comment.bodyMarkdown);
			body.push(text);
			const block = serializeComments(body, eol, indent);
			const existing = this.commentRange(document, comments);
			if (existing) {
				return this.editNow(document, ref.version, existing.start, existing.end, document.getText().slice(existing.start, existing.end), block + eol, false);
			}
			// No comments block yet: insert right after any existing meta/body blocks, not blindly after the Todo's own line.
			const insertionAt = this.metaBodyEndOffset(document, ref);
			const source = document.getText();
			const needsLeadingEol = insertionAt === source.length && !source.endsWith('\n');
			const insertion = (needsLeadingEol ? eol : '') + block + (insertionAt < source.length ? eol : '');
			return this.editNow(document, ref.version, insertionAt, insertionAt, '', insertion, false);
		});
	}

	async editTodoComment(ref: TodoRef, commentId: string, text: string): Promise<number> {
		if (!text.trim()) { throw new Error('コメントを入力してください。'); }
		return this.serial(ref.uri, async () => {
			const document = await this.todoDocument(ref);
			const { comments } = this.todoComments(document, ref);
			const comment = comments.comments.find(candidate => candidate.id === commentId);
			if (!comment) { throw new Error('コメントが見つかりません。'); }
			const range = this.commentRange(document, comments);
			if (!range || comment.start === undefined || comment.end === undefined) {
				throw new Error('コメント境界を認識できないため編集できません。');
			}

			const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
			const indent = /^[ \t]*/.exec(ref.raw)?.[0] ?? '';
			const bodies = comments.comments.map(candidate => candidate.id === commentId ? text : candidate.bodyMarkdown);
			return this.editNow(document, ref.version, range.start, range.end, document.getText().slice(range.start, range.end), serializeComments(bodies, eol, indent), false);
		});
	}

	async deleteTodoComment(ref: TodoRef, commentId: string): Promise<number> {
		return this.serial(ref.uri, async () => {
			const document = await this.todoDocument(ref);
			const { comments } = this.todoComments(document, ref);
			if (!comments.comments.some(comment => comment.id === commentId)) { throw new Error('コメントが見つかりません。'); }
			const range = this.commentRange(document, comments);
			if (!range) { throw new Error('コメント境界を認識できないため削除できません。'); }
			const remaining = comments.comments.filter(comment => comment.id !== commentId).map(comment => comment.bodyMarkdown);
			const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
			const indent = /^[ \t]*/.exec(ref.raw)?.[0] ?? '';
			const replacement = remaining.length ? serializeComments(remaining, eol, indent) + eol : '';
			return this.editNow(document, ref.version, range.start, range.end, document.getText().slice(range.start, range.end), replacement, false);
		});
	}

	async setTodoMetadata(ref: TodoRef, labels: readonly string[], dueDate?: string): Promise<number> {
		return this.serial(ref.uri, async () => {
			const document = await this.todoDocument(ref);
			const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
			const lines = document.getText().split(/\r\n|\n|\r/);
			const metadata = serializeTodoMetadata(labels, dueDate, eol, /^[ \t]*/.exec(ref.raw)?.[0] ?? '');
			const hasMetadata = lines[ref.line + 1]?.trim().startsWith('<!-- quick-note-md:meta');
			const startLine = ref.line + 1;
			const start = document.offsetAt(new vscode.Position(startLine, 0));
			if (hasMetadata) {
				const end = document.offsetAt(new vscode.Position(startLine + 1, 0));
				return this.editNow(document, ref.version, start, end, document.getText().slice(start, end), metadata, false);
			}
			const lineEnd = document.lineAt(ref.line).rangeIncludingLineBreak.end;
			const insertionAt = document.offsetAt(lineEnd);
			const leadingEol = insertionAt === document.getText().length && !document.getText().endsWith('\n') ? eol : '';
			return this.editNow(document, ref.version, insertionAt, insertionAt, '', leadingEol + metadata, false);
		});
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
			const comments = this.todoComments(document, ref).comments;
			const lineRange = document.lineAt(ref.line).rangeIncludingLineBreak;
			let start = document.offsetAt(lineRange.start);
			let end = document.offsetAt(lineRange.end);
			const block = this.extensionRange(document, ref);
			if (block) {
				end = block.end;
				if (document.getText()[end] === '\r') { end++; }
				if (document.getText()[end] === '\n') { end++; }
			}
			await this.editNow(document, ref.version, start, end, document.getText().slice(start, end), '', false);
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
