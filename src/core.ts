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

export interface ParsedTodo {
	line: number;
	text: string;
	status: TodoStatus;
	raw: string;
	markerStart: number;
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
		todos.push({
			line,
			raw,
			markerStart,
			status: valid ? markers.get(valid[1])! : 'unknown',
			text: valid ? (valid[2] ?? '') : prefix[2],
		});
	}
	return todos;
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
