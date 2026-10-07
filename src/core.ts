import MarkdownIt from 'markdown-it';

export type TodoStatus = 'open' | 'done' | 'note' | 'skip' | 'warn' | 'important' | 'unknown';

export const statusInfo: Record<TodoStatus, { label: string; marker: string; icon: string }> = {
	open: { label: '未完了', marker: ' ', icon: 'circle-outline' },
	done: { label: '完了', marker: 'x', icon: 'check' },
	note: { label: 'Note（参考）', marker: 'n', icon: 'note' },
	skip: { label: 'Skip（対応不要）', marker: '-', icon: 'debug-step-over' },
	warn: { label: 'Warn（注意）', marker: '!', icon: 'warning' },
	important: { label: 'IMP（重要）', marker: 'i', icon: 'star-full' },
	unknown: { label: '認識できない Todo（読み取り専用）', marker: '?', icon: 'question' },
};

export const statusOrder: TodoStatus[] = ['important', 'warn', 'open', 'note', 'skip', 'done', 'unknown'];

export interface TodoIdentity {
	filePath: string;
	lineNumber: number;
	originalText: string;
}

function parseTodoBody(source: string, todoLine: number): { value?: string; readOnly: boolean; warning?: string } {
	const lines = source.split(/\r\n|\n|\r/);
	const ownerIndent = todoListIndent(lines[todoLine]);
	let cursor = todoLine + 1;
	if (metadataPattern.test(lines[cursor]?.trim() ?? '')) { cursor++; }
	if (lines[cursor]?.trim() !== bodyStart) {
		return lines[cursor]?.trim().startsWith('<!-- quick-note-md:body')
			? { readOnly: true, warning: '本文境界を認識できないため、読み取り専用です。' }
			: { readOnly: false };
	}
	cursor++;
	const start = cursor;
	while (cursor < lines.length && lines[cursor].trim() !== bodyEnd) {
		if (ownerIndent !== undefined && todoListIndent(lines[cursor]) === ownerIndent) {
			return { readOnly: true, warning: '本文境界が後続 Todo と交差するため、読み取り専用です。' };
		}
		cursor++;
	}
	return cursor < lines.length
		? { value: lines.slice(start, cursor).join('\n'), readOnly: false }
		: { readOnly: true, warning: '本文の終了境界がないため、読み取り専用です。' };
}

function todoListIndent(line: string | undefined): string | undefined {
	if (line === undefined) { return undefined; }
	const match = /^([ \t]*)(?:[-+*]|\d+[.)])[ \t]+\[[^\]]*\](?:[ \t]+.*|$)$/.exec(line);
	return match?.[1];
}

export interface TodoComment {
	id: string;
	todoId: TodoIdentity;
	order: number;
	bodyMarkdown: string;
	createdAt?: string;
	updatedAt?: string;
	/** Source offsets, intentionally not serialized. */
	start?: number;
	end?: number;
}

export type TodoReply = TodoComment;

export interface TodoCommentSet {
	todoId: TodoIdentity;
	comments: TodoComment[];
	sourceText: string;
	readOnly: boolean;
	warning?: string;
}

export interface TodoEntry {
	id: TodoIdentity;
	title: string;
	status: TodoStatus;
	comments: TodoComment[];
}

export interface DraftInput {
	todoId: TodoIdentity;
	commentId?: string;
	text: string;
	mode: 'new' | 'edit';
	dirty: boolean;
	lastSavedVersion: number;
}

export interface ParsedTodo {
	line: number;
	text: string;
	status: TodoStatus;
	raw: string;
	markerStart: number;
	comments?: TodoCommentSet;
	/** Optional metadata introduced by QuickNoteMD; old task rows remain valid. */
	labels?: string[];
	dueDate?: string;
	bodyMarkdown?: string;
	replies?: TodoReply[];
	readOnly?: boolean;
	warning?: string;
}

const markdown = new MarkdownIt({ html: false });
const markers = new Map<string, TodoStatus>(
	statusOrder.filter(status => status !== 'unknown').map(status => [statusInfo[status].marker, status]),
);
markers.set('X', 'done');

export function parseTodos(text: string): ParsedTodo[] {
	const lines = text.split(/\r\n|\n|\r/);
	const listLines = new Set<number>();
	const linkedLines = new Set<number>();
	const excluded = new Set<number>();
	let inComment = false;
	let inMemoExtension = false;
	let inMemoBody = false;
	for (let line = 0; line < lines.length; line++) {
		const trimmed = lines[line].trim();
		if (trimmed === memoBodyStart) { inMemoBody = true; }
		if (inMemoBody) {
			excluded.add(line);
			if (trimmed === memoBodyEnd) { inMemoBody = false; }
			continue;
		}
		if (trimmed === memoIssueStart) { inMemoExtension = true; }
		if (inMemoExtension) {
			excluded.add(line);
			if (trimmed === memoIssueEnd) { inMemoExtension = false; }
			continue;
		}
		if (trimmed === bodyStart || trimmed === '<!-- quick-note-md:comments -->' || trimmed === '<!-- quick-note-md:comment -->') {
			inComment = true;
			excluded.add(line);
		} else if (trimmed === bodyEnd || trimmed === '<!-- quick-note-md:end-comment -->' || trimmed === '<!-- quick-note-md:end-comments -->') {
			excluded.add(line);
			inComment = trimmed === '<!-- quick-note-md:end-comment -->';
		} else if (inComment) {
			excluded.add(line);
		}
	}
	for (const token of markdown.parse(text, {})) {
		if (!token.map) { continue; }
		if (token.type === 'list_item_open') { listLines.add(token.map[0]); }
		if (token.type === 'inline' && token.children?.[0]?.type === 'link_open') { linkedLines.add(token.map[0]); }
		if (token.type === 'fence' || token.type === 'code_block' || token.type === 'html_block') {
			for (let line = token.map[0]; line < token.map[1]; line++) { excluded.add(line); }
		}
	}
	const todos: ParsedTodo[] = [];
	for (let line = 0; line < lines.length; line++) {
		if (excluded.has(line)) { continue; }
		const raw = lines[line];
		// Source prefixes are deliberately conservative: quoted or lazy-continuation rows are not edited.
		const prefix = /^([ \t]*(?:[-+*]|\d+[.)])[ \t]*)(\[.*)$/.exec(raw);
		if (!prefix) { continue; }
		if (/^\[[^\]]*\](?:\(|\[|:)/.test(prefix[2])) { continue; }
		const markerStart = prefix[1].length;
		const valid = listLines.has(line) && /[ \t]$/.test(prefix[1])
			? /^\[([ xXn!i-])\](?:[ \t]+(.*)|$)$/.exec(prefix[2])
			: null;
		if (!valid && linkedLines.has(line)) { continue; }
		const metadata = lines[line + 1]?.trim().match(metadataPattern);
		const labels = metadata?.[1] ? metadata[1].split(',').map(label => label.trim()).filter(Boolean) : [];
		const dueDate = metadata?.[2] || undefined;
		const body = parseTodoBody(text, line);
		const parsed: ParsedTodo = {
			line,
			raw,
			markerStart,
			status: valid ? markers.get(valid[1])! : 'unknown',
			text: valid ? (valid[2] ?? '') : prefix[2],
			labels,
			dueDate,
			bodyMarkdown: body.value,
			readOnly: body.readOnly || (dueDate !== undefined && !isValidDueDate(dueDate)),
			warning: body.warning || (dueDate !== undefined && !isValidDueDate(dueDate) ? '対応日が無効なため、読み取り専用です。' : undefined),
		};
		todos.push(parsed);
	}
	for (const todo of todos) {
		const comments = parseTodoComments(text, todo);
		todo.replies = comments.comments;
		if (comments.readOnly) {
			todo.readOnly = true;
			todo.warning = comments.warning;
		}
	}
	return todos;
}

const commentsStart = '<!-- quick-note-md:comments -->';
const commentStart = '<!-- quick-note-md:comment -->';
const commentEnd = '<!-- quick-note-md:end-comment -->';
const commentsEnd = '<!-- quick-note-md:end-comments -->';
const memoIssueStart = '<!-- quick-note-md:issue -->';
const memoIssueEnd = '<!-- quick-note-md:end-issue -->';
const memoBodyStart = '<!-- quick-note-md:issue-body -->';
const memoBodyEnd = '<!-- quick-note-md:end-issue-body -->';
const metadataPattern = /^<!--\s*quick-note-md:meta(?:\s+labels="([^"]*)")?(?:\s+due="([^"]*)")?\s*-->$/;
const bodyStart = '<!-- quick-note-md:body -->';
const bodyEnd = '<!-- quick-note-md:end-body -->';

function lineOffsets(source: string): number[] {
	const offsets: number[] = [0];
	for (let index = 0; index < source.length; index++) {
		if (source[index] === '\n') { offsets.push(index + 1); }
	}
	return offsets;
}

export function isValidDueDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) { return false; }
	const [year, month, day] = value.split('-').map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function normalizeLabels(labels: readonly string[]): string[] {
	return labels.map(label => label.trim()).filter(Boolean)
		.filter((label, index, all) => all.indexOf(label) === index);
}

/** Parse only a comment block immediately following the Todo line. */
export function parseTodoComments(source: string, todo: ParsedTodo, filePath = ''): TodoCommentSet {
	const lines = source.split(/\r\n|\n|\r/);
	const offsets = lineOffsets(source);
	const id: TodoIdentity = { filePath, lineNumber: todo.line, originalText: todo.raw };
	const empty: TodoCommentSet = { todoId: id, comments: [], sourceText: '', readOnly: false };
	let first = todo.line + 1;
	if (metadataPattern.test(lines[first]?.trim() ?? '')) { first++; }
	if (lines[first]?.trim() === bodyStart) {
		while (first < lines.length && lines[first].trim() !== bodyEnd) { first++; }
		first++;
	}
	if (first >= lines.length || lines[first].trim() !== commentsStart) {
		const next = lines[first]?.trim() ?? '';
		if (next.startsWith('<!-- quick-note-md:') || next.startsWith('<!-- legacy-quick-note-md:')) {
			return { ...empty, sourceText: lines.slice(first).join('\n'), readOnly: true, warning: 'Todo の拡張ブロックを認識できないため、読み取り専用です。' };
		}
		return empty;
	}
	let cursor = first + 1;
	const comments: TodoComment[] = [];
	const indent = /^[ \t]*/.exec(lines[first])?.[0] ?? '';
	let valid = true;
	while (cursor < lines.length && lines[cursor].trim() !== commentsEnd) {
		if (lines[cursor].trim() !== commentStart) { valid = false; break; }
		const bodyStart = cursor + 1;
		cursor = bodyStart;
		while (cursor < lines.length && lines[cursor].trim() !== commentEnd && lines[cursor].trim() !== commentsEnd) { cursor++; }
		if (cursor >= lines.length || lines[cursor].trim() !== commentEnd) { valid = false; break; }
		const body = lines.slice(bodyStart, cursor)
			.map(line => line.startsWith(indent) ? line.slice(indent.length) : line)
			.join('\n');
		comments.push({
			id: `comment-${comments.length}`,
			todoId: id,
			order: comments.length,
			bodyMarkdown: body,
			start: offsets[bodyStart] ?? source.length,
			end: offsets[cursor] ?? source.length,
		});
		cursor++;
	}
	if (!valid || cursor >= lines.length || lines[cursor].trim() !== commentsEnd) {
		return { ...empty, sourceText: lines.slice(first).join('\n'), readOnly: true, warning: 'コメント境界を認識できないため、読み取り専用です。' };
	}
	const endLine = cursor + 1;
	return {
		todoId: id,
		comments,
		sourceText: source.slice(offsets[first], offsets[endLine] ?? source.length),
		readOnly: false,
	};
}

export function serializeComments(comments: readonly string[], eol = '\n', indent = ''): string {
	return [
		`${indent}${commentsStart}`,
		...comments.flatMap(body => [`${indent}${commentStart}`, ...body.replace(/\r\n|\r|\n/g, '\n').split('\n').map(line => `${indent}${line}`), `${indent}${commentEnd}`]),
		`${indent}${commentsEnd}`,
	].join(eol);
}

export interface ParsedMemoExtension {
	descriptionMarkdown: string;
	descriptionStoredLength: number;
	labels: string[];
	comments: string[];
	readOnly: boolean;
	warning?: string;
}

function unwrapMemoBody(source: string): { recognized: boolean; descriptionMarkdown: string } {
	if (!source.startsWith(memoBodyStart)) { return { recognized: false, descriptionMarkdown: source }; }
	const match = new RegExp(`^${memoBodyStart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\r\\n|\\n)([\\s\\S]*)\\1${memoBodyEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\1)?$`).exec(source);
	return match
		? { recognized: true, descriptionMarkdown: match[2] }
		: { recognized: true, descriptionMarkdown: source };
}

function invalidMemoExtension(source: string): ParsedMemoExtension {
	return {
		descriptionMarkdown: source, descriptionStoredLength: source.length, labels: [], comments: [], readOnly: true,
		warning: 'メモのラベル・コメント境界を認識できないため、読み取り専用です。',
	};
}

/** Reads only a complete QuickNoteMD issue extension at the end of a Memo. */
export function parseMemoExtension(source: string): ParsedMemoExtension {
	const lines = source.split(/\r\n|\n|\r/);
	const lastMatchingLine = (predicate: (line: string, index: number) => boolean, before = lines.length): number => {
		for (let index = Math.min(before, lines.length) - 1; index >= 0; index--) {
			if (predicate(lines[index], index)) { return index; }
		}
		return -1;
	};
	let endLine = lines.length - 1;
	while (endLine >= 0 && !lines[endLine].trim()) { endLine--; }
	if (endLine < 0 || lines[endLine].trim() !== memoIssueEnd) {
		const issueStartLine = lastMatchingLine(line => line.trim() === memoIssueStart);
		if (issueStartLine >= 0 && lines.slice(issueStartLine + 1).some(line =>
			[commentsStart, commentStart, commentsEnd, commentEnd].includes(line.trim()))) {
			return invalidMemoExtension(source);
		}
		const body = unwrapMemoBody(source);
		if (body.recognized && body.descriptionMarkdown === source) {
			return invalidMemoExtension(source);
		}
		return {
			descriptionMarkdown: body.descriptionMarkdown, descriptionStoredLength: source.length,
			labels: [], comments: [], readOnly: false,
		};
	}

	const startLine = lastMatchingLine(line => line.trim() === memoIssueStart, endLine);
	if (startLine < 0) { return invalidMemoExtension(source); }
	const lineStarts = lineOffsets(source);
	const extensionOffset = lineStarts[startLine];
	const eol = (['\r\n', '\n'] as const).find(candidate =>
		source.slice(extensionOffset - (2 * candidate.length), extensionOffset) === candidate + candidate);
	if (!eol) {
		return invalidMemoExtension(source);
	}
	const descriptionEnd = extensionOffset - (2 * eol.length);

	const content = lines.slice(startLine + 1, endLine);
	let cursor = 0;
	let labels: string[] = [];
	if (content[cursor]?.trim().startsWith('<!-- quick-note-md:meta')) {
		const match = /^<!--\s*quick-note-md:meta(?:\s+labels="([^"]*)")?\s*-->$/.exec(content[cursor].trim());
		if (!match) { return invalidMemoExtension(source); }
		labels = match[1] ? match[1].split(',').map(label => label.trim()) : [];
		if (labels.some(label => !label) || new Set(labels).size !== labels.length ||
			labels.some(label => /[,"\r\n\u0000]/.test(label))) { return invalidMemoExtension(source); }
		cursor++;
	}

	const comments: string[] = [];
	if (content[cursor]?.trim() === commentsStart) {
		cursor++;
		while (cursor < content.length && content[cursor].trim() !== commentsEnd) {
			if (content[cursor].trim() !== commentStart) { return invalidMemoExtension(source); }
			cursor++;
			const body: string[] = [];
			while (cursor < content.length && content[cursor].trim() !== commentEnd) {
				if ([memoIssueStart, memoIssueEnd, commentsStart, commentsEnd, commentStart].includes(content[cursor].trim())) {
					return invalidMemoExtension(source);
				}
				body.push(content[cursor++]);
			}
			if (cursor >= content.length || content[cursor].trim() !== commentEnd) { return invalidMemoExtension(source); }
			comments.push(body.join('\n'));
			cursor++;
		}
		if (cursor >= content.length || content[cursor].trim() !== commentsEnd) { return invalidMemoExtension(source); }
		cursor++;
	}
	if (cursor !== content.length) { return invalidMemoExtension(source); }
	const body = unwrapMemoBody(source.slice(0, descriptionEnd));
	if (body.recognized && body.descriptionMarkdown === source.slice(0, descriptionEnd)) { return invalidMemoExtension(source); }
	return {
		descriptionMarkdown: body.descriptionMarkdown,
		descriptionStoredLength: descriptionEnd,
		labels,
		comments,
		readOnly: false,
	};
}

/** Protects Markdown checklist items in Memo descriptions from being parsed as standalone Todos. */
export function serializeMemoBody(descriptionMarkdown: string, eol = '\n'): string {
	if (!['\n', '\r\n'].includes(eol)) { throw new Error('改行コードが不正です。'); }
	if (!/^[ \t]*(?:[-+*]|\d+[.)])[ \t]*\[[^\]]*\]/m.test(descriptionMarkdown)) { return descriptionMarkdown; }
	if (descriptionMarkdown.includes(memoBodyStart) || descriptionMarkdown.includes(memoBodyEnd)) {
		throw new Error('メモ本文に予約済みの境界文字列を含めることはできません。');
	}
	return `${memoBodyStart}${eol}${descriptionMarkdown}${eol}${memoBodyEnd}`;
}

/** Serializes an optional Memo footer while preserving the description byte-for-byte. */
export function serializeMemoExtension(
	descriptionMarkdown: string, labels: readonly string[], comments: readonly string[], eol = '\n',
): string {
	if (!['\n', '\r\n'].includes(eol)) { throw new Error('改行コードが不正です。'); }
	if (!labels.length && !comments.length) { return descriptionMarkdown; }
	const safeDescription = serializeMemoBody(descriptionMarkdown, eol);
	const normalized = labels.map(label => label.trim());
	if (normalized.some(label => !label) || new Set(normalized).size !== normalized.length ||
		normalized.some(label => /[,"\r\n\u0000]/.test(label))) {
		throw new Error('ラベルは空白・重複・カンマ・引用符・改行を含まない一意の名前にしてください。');
	}
	if (comments.some(comment => !comment.trim() || /<!--\s*quick-note-md:(?:issue|end-issue|issue-body|end-issue-body|meta|comments|comment|end-comment|end-comments)\b/i.test(comment))) {
		throw new Error('コメントが空か、拡張ブロックの境界文字列を含んでいます。');
	}
	const extension = [
		memoIssueStart,
		...(normalized.length ? [serializeTodoMetadata(normalized).trimEnd()] : []),
		...(comments.length ? [serializeComments(comments).replace(/\n/g, eol)] : []),
		memoIssueEnd,
	].join(eol);
	return `${safeDescription}${eol}${eol}${extension}${eol}`;
}

export function serializeTodoMetadata(labels: readonly string[] = [], dueDate?: string, eol = '\n', indent = ''): string {
	const safeLabels = normalizeLabels(labels);
	if (safeLabels.some(label => /[,"\r\n\u0000]/.test(label))) {
		throw new Error('ラベル名にカンマ、引用符、改行は使用できません。');
	}
	if (dueDate !== undefined && dueDate !== '' && !isValidDueDate(dueDate.trim())) {
		throw new Error('対応日は有効な YYYY-MM-DD 形式で指定してください。');
	}
	const attrs = [
		safeLabels.length ? ` labels="${safeLabels.join(',')}"` : '',
		dueDate?.trim() ? ` due="${dueDate.trim()}"` : '',
	].join('');
	return `${indent}<!-- quick-note-md:meta${attrs} -->${eol}`;
}

export function serializeTodoBody(body: string, eol = '\n', indent = ''): string {
	return [`${indent}${bodyStart}`, ...body.replace(/\r\n|\r|\n/g, '\n').split('\n').map(line => `${indent}${line}`), `${indent}${bodyEnd}`].join(eol);
}

export function safeFileName(title: string): string {
	const name = title.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '').trim().replace(/[. ]+$/g, '');
	if (!name || name === '.' || name === '..' || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) {
		throw new Error('使用できるファイル名を入力してください。');
	}
	if (Buffer.byteLength(name, 'utf8') > 220) {
		throw new Error('ファイル名が長すぎます。');
	}
	return name;
}

export function validateInput(input: string): void {
	if (!input.trim() || /[\r\n\u0000]/.test(input)) {
		throw new Error('空白以外を含む1行のテキストを入力してください。');
	}
}

/** Returns only the suffix to insert; existing content must never be rewritten. */
export function appendText(existing: string, input: string, eol?: string): string {
	validateInput(input);
	const newline = /\r\n|\n/.exec(existing)?.[0] ?? eol ?? '\n';
	if (newline !== '\n' && newline !== '\r\n') { throw new Error('改行コードが不正です。'); }
	return (existing && !existing.endsWith('\n') ? newline : '') + input + newline;
}
