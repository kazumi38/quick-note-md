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

function parseTodoBody(source: string, todoLine: number): string | undefined {
	const lines = source.split(/\r\n|\n|\r/);
	let cursor = todoLine + 1;
	if (metadataPattern.test(lines[cursor]?.trim() ?? '')) { cursor++; }
	if (lines[cursor]?.trim() !== bodyStart) { return undefined; }
	cursor++;
	const start = cursor;
	while (cursor < lines.length && lines[cursor].trim() !== bodyEnd) { cursor++; }
	return cursor < lines.length ? lines.slice(start, cursor).join('\n') : undefined;
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
	for (let line = 0; line < lines.length; line++) {
		const trimmed = lines[line].trim();
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
		todos.push({
			line,
			raw,
			markerStart,
			status: valid ? markers.get(valid[1])! : 'unknown',
			text: valid ? (valid[2] ?? '') : prefix[2],
			labels,
			dueDate,
			bodyMarkdown: parseTodoBody(text, line),
		});
	}
	return todos;
}

const commentsStart = '<!-- quick-note-md:comments -->';
const commentStart = '<!-- quick-note-md:comment -->';
const commentEnd = '<!-- quick-note-md:end-comment -->';
const commentsEnd = '<!-- quick-note-md:end-comments -->';
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

export function serializeTodoMetadata(labels: readonly string[] = [], dueDate?: string, eol = '\n', indent = ''): string {
	const safeLabels = labels.map(label => label.trim()).filter(Boolean).filter((label, index, all) => all.indexOf(label) === index);
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
