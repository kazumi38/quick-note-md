import MarkdownIt = require('markdown-it');
import { randomBytes } from 'crypto';

export type ChatParseState = 'valid' | 'legacy' | 'unsupported';
export type ChatTaskStatus = 'open' | 'done' | 'info' | 'warn' | 'note' | 'skip';

export interface ChatTask {
	id: string;
	checked: boolean;
	status: ChatTaskStatus;
	start: number;
	end: number;
}

export interface ChatMessage {
	id?: string;
	timestamp: string;
	bodyMarkdown: string;
	sourceRange: { start: number; end: number };
	tasks: ChatTask[];
}

export interface ChatSection {
	id: string;
	name: string;
	messages: ChatMessage[];
	sourceRange: { start: number; end: number };
}

export interface ChatThread {
	title: string;
	sections: ChatSection[];
	parseState: ChatParseState;
	source: string;
}

export interface ChatParseResult {
	state: ChatParseState;
	thread?: ChatThread;
	issue?: string;
}

interface SourceLine {
	text: string;
	start: number;
	end: number;
	next: number;
}

interface Marker {
	id: string;
	kind: 'start' | 'end';
	line: number;
}

const markdown = new MarkdownIt({ html: true, linkify: false, typographer: false });
const markerPattern = /^<!-- quick-note-md:message ([0-9a-f]{32}):(start|end) -->$/;
const reservedMarkerLinePattern = /^\s*<!--\s*quick-note-md:message\b/;
const timestampPattern = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;
const taskPattern = /^\s*(?:[-+*]|\d+[.)])\s+\[([ xX!in-])\](?:\s+|$)/;

function sourceLines(source: string): SourceLine[] {
	const result: SourceLine[] = [];
	const expression = /[^\r\n]*(?:\r\n|\n|\r|$)/g;
	let match: RegExpExecArray | null;
	while ((match = expression.exec(source)) && match[0]) {
		const full = match[0];
		const newline = /\r\n|\n|\r$/.exec(full)?.[0] ?? '';
		result.push({
			text: full.slice(0, full.length - newline.length),
			start: match.index,
			end: match.index + full.length - newline.length,
			next: match.index + full.length
		});
	}
	return result;
}

function codeLines(source: string, lines: readonly SourceLine[]): Set<number> {
	const hidden = new Set<number>();
	for (const token of markdown.parse(source, {})) {
		if ((token.type === 'fence' || token.type === 'code_block') && token.map) {
			for (let line = token.map[0]; line < token.map[1]; line++) { hidden.add(line); }
		}
	}
	return hidden;
}

function hasReservedMarkerLine(source: string): boolean {
	const lines = sourceLines(source);
	const hidden = codeLines(source, lines);
	return lines.some((line, index) => !hidden.has(index) && reservedMarkerLinePattern.test(line.text));
}

function validTimestamp(value: string): boolean {
	const match = timestampPattern.exec(value);
	if (!match) { return false; }
	const [, year, month, day, hour, minute] = match.map(Number);
	const date = new Date(year, month - 1, day, hour, minute);
	return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
		&& date.getHours() === hour && date.getMinutes() === minute;
}

function parseTasks(body: string, sourceOffset: number, messageId: string): ChatTask[] {
	const lines = sourceLines(body);
	const hidden = codeLines(body, lines);
	const tasks: ChatTask[] = [];
	for (let index = 0; index < lines.length; index++) {
		if (hidden.has(index)) { continue; }
		const line = lines[index];
		const match = taskPattern.exec(line.text);
		if (!match) { continue; }
		const marker = match[1];
		const start = sourceOffset + line.start + match.index + match[0].indexOf('[');
		tasks.push({
			id: `${messageId}:${start}`,
			checked: marker.toLowerCase() === 'x',
			status: marker === ' ' ? 'open' : marker.toLowerCase() === 'x' ? 'done'
				: marker === 'i' ? 'info' : marker === '!' ? 'warn' : marker === 'n' ? 'note' : 'skip',
			start,
			end: start + 3
		});
	}
	return tasks;
}

function unsupported(issue: string): ChatParseResult {
	return { state: 'unsupported', issue };
}

export function parseChatMarkdown(source: string): ChatParseResult {
	if (typeof source !== 'string' || !source.trim()) { return unsupported('チャットのタイトルがありません。'); }
	const lines = sourceLines(source);
	const hidden = codeLines(source, lines);
	const headings = lines.map((line, index) => {
		const match = /^(#{1,6})[ \t]+(.+?)\s*#*\s*$/.exec(line.text);
		return match && !hidden.has(index) ? { level: match[1].length, text: match[2], line: index } : undefined;
	}).filter((heading): heading is { level: number; text: string; line: number } => Boolean(heading));
	if (!headings.some(heading => heading.level === 1 && heading.line === 0)) {
		return unsupported('先頭にタイトル見出しを1つだけ指定してください。');
	}

	const markers: Marker[] = [];
	for (let index = 0; index < lines.length; index++) {
		if (hidden.has(index)) { continue; }
		const match = markerPattern.exec(lines[index].text);
		if (match) { markers.push({ id: match[1], kind: match[2] as Marker['kind'], line: index }); }
		else if (reservedMarkerLinePattern.test(lines[index].text)) {
			return unsupported('メッセージ境界マーカーの形式が不正です。');
		}
	}

	const sectionHeadings = headings.filter(heading => heading.level === 2);
	if (!sectionHeadings.length) { return unsupported('チャットにセクションがありません。'); }
	if (markers.length) {
		const seen = new Set<string>();
		let open: Marker | undefined;
		const pairs = new Map<string, { start: number; end: number }>();
		for (const marker of markers) {
			if (marker.kind === 'start') {
				if (open || seen.has(marker.id)) { return unsupported('メッセージ境界が入れ子または重複しています。'); }
				seen.add(marker.id);
				open = marker;
			} else {
				if (!open || open.id !== marker.id) { return unsupported('メッセージ境界マーカーが対応していません。'); }
				pairs.set(marker.id, { start: open.line, end: marker.line });
				open = undefined;
			}
		}
		if (open) { return unsupported('メッセージ終了マーカーがありません。'); }

		const structuralHeadings = headings.filter(heading =>
			!Array.from(pairs.values()).some(pair => heading.line > pair.start && heading.line < pair.end));
		const titleHeadings = structuralHeadings.filter(heading => heading.level === 1);
		if (titleHeadings.length !== 1 || titleHeadings[0].line !== 0) {
			return unsupported('先頭にタイトル見出しを1つだけ指定してください。');
		}
		const structuralSections = structuralHeadings.filter(heading => heading.level === 2);
		const sections: ChatSection[] = [];
		const usedMessages = new Set<string>();
		for (let index = 0; index < structuralSections.length; index++) {
			const heading = structuralSections[index];
			const sectionStart = lines[heading.line].start;
			const sectionEnd = index + 1 < structuralSections.length
				? lines[structuralSections[index + 1].line].start : source.length;
			const messages: ChatMessage[] = [];
			for (const candidate of structuralHeadings) {
				if (candidate.level !== 3 || candidate.line <= heading.line ||
					(index + 1 < structuralSections.length && candidate.line >= structuralSections[index + 1].line)) { continue; }
				const timestamp = candidate.text;
				if (!validTimestamp(timestamp)) { return unsupported('メッセージ日時の形式が不正です。'); }
				const marker = markers.find(item => item.kind === 'start' && item.line === candidate.line + 1);
				if (!marker) { return unsupported('メッセージ見出しの開始マーカーがありません。'); }
				const pair = pairs.get(marker.id);
				if (!pair) { return unsupported('メッセージ境界マーカーが対応していません。'); }
				usedMessages.add(marker.id);
				const bodyStart = lines[pair.start].next;
				const bodyEnd = lines[pair.end].start;
				const body = source.slice(bodyStart, bodyEnd).replace(/(?:\r\n|\n|\r)$/, '');
				messages.push({
					id: marker.id,
					timestamp,
					bodyMarkdown: body,
					sourceRange: { start: bodyStart, end: bodyEnd },
					tasks: parseTasks(body, bodyStart, marker.id)
				});
			}
			sections.push({
				id: `section-${index}`,
				name: heading.text,
				messages,
				sourceRange: { start: sectionStart, end: sectionEnd }
			});
		}
		if (usedMessages.size !== pairs.size) {
			return unsupported('メッセージ境界が日時見出しまたはセクションに対応していません。');
		}
		return { state: 'valid', thread: { title: titleHeadings[0].text, sections, parseState: 'valid', source } };
	}

	const titleHeadings = headings.filter(heading => heading.level === 1);
	if (titleHeadings.length !== 1 || titleHeadings[0].line !== 0) {
		return unsupported('先頭にタイトル見出しを1つだけ指定してください。');
	}
	const messagesBySection: ChatSection[] = [];
	const allTimestampHeadings = headings.filter(heading => heading.level === 3);
	for (let index = 0; index < sectionHeadings.length; index++) {
		const heading = sectionHeadings[index];
		const nextSectionLine = sectionHeadings[index + 1]?.line ?? lines.length;
		const messageHeadings = allTimestampHeadings.filter(candidate =>
			candidate.line > heading.line && candidate.line < nextSectionLine);
		const messages: ChatMessage[] = [];
		for (let messageIndex = 0; messageIndex < messageHeadings.length; messageIndex++) {
			const messageHeading = messageHeadings[messageIndex];
			if (!validTimestamp(messageHeading.text)) { return unsupported('旧形式のメッセージ日時を判別できません。'); }
			const start = lines[messageHeading.line].next;
			const end = messageHeadings[messageIndex + 1]
				? lines[messageHeadings[messageIndex + 1].line].start
				: nextSectionLine < lines.length ? lines[nextSectionLine].start : source.length;
			const body = source.slice(start, end).replace(/(?:\r\n|\n|\r)+$/, '');
			messages.push({
				timestamp: messageHeading.text,
				bodyMarkdown: body,
				sourceRange: { start, end },
				tasks: parseTasks(body, start, `legacy-${messageHeading.line}`)
			});
		}
		const sectionStart = lines[heading.line].start;
		const sectionEnd = nextSectionLine < lines.length ? lines[nextSectionLine].start : source.length;
		messagesBySection.push({
			id: `section-${index}`,
			name: heading.text,
			messages,
			sourceRange: { start: sectionStart, end: sectionEnd }
		});
	}
	return {
		state: 'legacy',
		thread: { title: titleHeadings[0].text, sections: messagesBySection, parseState: 'legacy', source }
	};
}

export function serializeChatMessage(timestamp: string, bodyMarkdown: string, id: string): string {
	if (!validTimestamp(timestamp) || !/^[0-9a-f]{32}$/.test(id)) {
		throw new Error('日時またはメッセージ ID が不正です。');
	}
	if (hasReservedMarkerLine(bodyMarkdown)) {
		throw new Error('本文に予約済みメッセージ境界マーカーを含めることはできません。');
	}
	return `### ${timestamp}\n<!-- quick-note-md:message ${id}:start -->\n${bodyMarkdown}\n<!-- quick-note-md:message ${id}:end -->`;
}

export function createChatMessageId(): string {
	return randomBytes(16).toString('hex');
}

export function serializeChatThread(thread: ChatThread): string {
	if (thread.parseState !== 'valid' || !thread.title.trim() || /[\r\n]/.test(thread.title) ||
		!thread.sections.length || thread.sections.some(section => !section.name.trim() || /[\r\n]/.test(section.name))) {
		throw new Error('チャットのタイトル、セクション、形式を確認してください。');
	}
	const sections = thread.sections.map(section => {
		const messages = section.messages.map(message =>
			serializeChatMessage(message.timestamp, message.bodyMarkdown, message.id ?? createChatMessageId()));
		return `## ${section.name}${messages.length ? `\n\n${messages.join('\n\n')}` : ''}`;
	});
	return `# ${thread.title}\n\n${sections.join('\n\n')}\n`;
}
