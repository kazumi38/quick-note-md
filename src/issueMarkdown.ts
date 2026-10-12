import { IssueComment, IssueMetadata, IssueRecord, isTimestamp, validateMetadata } from './issueMetadata';

const issuePrefix = '<!-- quick-note-md:issue:v1 ';
const commentsStart = '<!-- quick-note-md:comments:v1 -->';
const commentsEnd = '<!-- quick-note-md:end-comments -->';
const commentPrefix = '<!-- quick-note-md:comment:v1 ';
const commentEnd = '<!-- quick-note-md:end-comment -->';
const reservedMarkers = [issuePrefix, commentsStart, commentsEnd, commentPrefix, commentEnd];

export interface ParsedIssue extends IssueMetadata {
	bodyMarkdown: string;
	comments: IssueComment[];
}

function markerJson(line: string, prefix: string, suffix: string): unknown {
	if (!line.startsWith(prefix) || !line.endsWith(suffix)) {
		throw new Error('Issue Markdown structure marker is invalid.');
	}
	return JSON.parse(line.slice(prefix.length, -suffix.length).trim()) as unknown;
}

function serializeMarker(prefix: string, value: unknown): string {
	const json = JSON.stringify(value).replace(/-/g, '\\u002d').replace(/>/g, '\\u003e');
	return `${prefix}${json} -->`;
}

function containsReservedMarker(text: string): boolean {
	return reservedMarkers.some(marker => text.includes(marker));
}

function normalizeEol(text: string, eol: string): string {
	return text.replace(/\r\n|\r|\n/g, eol);
}

export function parseIssueMarkdown(source: string, expectedId?: number): ParsedIssue {
	const lines = source.split(/\r?\n/);
	const eol = source.includes('\r\n') ? '\r\n' : '\n';
	if (!lines[0]?.startsWith(issuePrefix)) {
		throw new Error('Issue metadata marker is missing or unsupported.');
	}
	if (lines[1] !== '') {
		throw new Error('Issue metadata marker must be followed by a blank line.');
	}
	const metadata = validateMetadata(markerJson(lines[0], issuePrefix, ' -->'));
	if (expectedId !== undefined && metadata.id !== expectedId) {
		throw new Error('Issue ID does not match its filename.');
	}

	const startIndex = lines.indexOf(commentsStart, 1);
	const endIndex = lines.indexOf(commentsEnd, 1);
	if (endIndex >= 0 && (startIndex < 0 || endIndex < startIndex || lines.indexOf(commentsEnd, endIndex + 1) >= 0)) {
		throw new Error('Issue comments boundary is invalid.');
	}
	if (startIndex < 0 && endIndex >= 0) {
		throw new Error('Issue comments boundary is invalid.');
	}

	let bodyEnd = startIndex < 0 ? lines.length : startIndex;
	if (startIndex >= 0 && lines[bodyEnd - 1] === '') { bodyEnd--; }
	const bodyMarkdown = lines.slice(2, bodyEnd).join(eol);
	if (containsReservedMarker(bodyMarkdown)) {
		throw new Error('Issue body contains a reserved structure marker.');
	}
	if (startIndex < 0) {
		if (lines.slice(1).some(line => line.includes(commentPrefix) || line === commentEnd)) {
			throw new Error('Comment marker exists outside the comments block.');
		}
		return { ...metadata, bodyMarkdown, comments: [] };
	}
	if (endIndex < 0) {
		throw new Error('Issue comments block is not closed.');
	}

	const comments: IssueComment[] = [];
	const ids = new Set<string>();
	let index = startIndex + 1;
	while (index < endIndex) {
		const startLine = lines[index];
		if (!startLine?.startsWith(commentPrefix)) {
			throw new Error('Comment start marker is missing.');
		}
		const raw = markerJson(startLine, commentPrefix, ' -->');
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
			throw new Error('Comment metadata is invalid.');
		}
		const value = raw as Record<string, unknown>;
		if (typeof value.id !== 'string' || !value.id || ids.has(value.id)
			|| !isTimestamp(value.createdAt)) {
			throw new Error('Comment metadata is invalid or duplicated.');
		}
		const closeIndex = lines.indexOf(commentEnd, index + 1);
		if (closeIndex < 0 || closeIndex >= endIndex) {
			throw new Error('Comment block is not closed.');
		}
		const bodyMarkdown = lines.slice(index + 1, closeIndex).join(eol);
		if (!bodyMarkdown.trim() || containsReservedMarker(bodyMarkdown)) {
			throw new Error('Comment body is empty or contains a reserved structure marker.');
		}
		ids.add(value.id);
		comments.push({ id: value.id, createdAt: value.createdAt, bodyMarkdown });
		index = closeIndex + 1;
	}
	if (comments.some((comment, index) => index > 0
		&& Date.parse(comment.createdAt) < Date.parse(comments[index - 1].createdAt))) {
		throw new Error('Comment order is invalid; comments must be stored oldest first.');
	}
	if (lines.slice(endIndex + 1).some(line => line.trim())) {
		throw new Error('Unexpected content follows the comments block.');
	}
	return { ...metadata, bodyMarkdown, comments };
}

export function serializeIssueMarkdown(issue: Omit<IssueRecord, 'revision'> | ParsedIssue, eol = '\n'): string {
	const metadata = validateMetadata(issue);
	const lines = [
		serializeMarker(issuePrefix, metadata),
		'',
		normalizeEol(issue.bodyMarkdown, eol),
	];
	if (issue.comments.length) {
		lines.push('', commentsStart);
		for (const comment of issue.comments) {
			if (!comment.id || !isTimestamp(comment.createdAt) || !comment.bodyMarkdown.trim()) {
				throw new Error('Comment metadata or body is invalid.');
			}
			lines.push(
				serializeMarker(commentPrefix, { id: comment.id, createdAt: comment.createdAt }),
				normalizeEol(comment.bodyMarkdown, eol),
				commentEnd,
			);
		}
		lines.push(commentsEnd);
	}
	const output = lines.join(eol);
	const reparsed = parseIssueMarkdown(output, metadata.id);
	if (reparsed.comments.length !== issue.comments.length) {
		throw new Error('Serialized Issue Markdown did not preserve all comments.');
	}
	return output;
}

export function issueFromParsed(issue: ParsedIssue, revision: number): IssueRecord {
	return { ...issue, revision };
}

export type { IssueComment, IssueMetadata, IssueRecord };
