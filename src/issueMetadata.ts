export type IssueState = 'open' | 'closed';

export interface IssueMetadata {
	id: number;
	title: string;
	state: IssueState;
	labels: string[];
	createdAt: string;
	updatedAt: string;
}

export interface IssueComment {
	id: string;
	bodyMarkdown: string;
	createdAt: string;
}

export interface IssueRecord extends IssueMetadata {
	bodyMarkdown: string;
	comments: IssueComment[];
	revision: number;
}

export type IssueDraftField = 'title' | 'body' | 'labels' | 'comment' | 'state';

export interface IssueDraft {
	draftId: string;
	issueId?: number;
	field: IssueDraftField;
	commentId?: string;
	value: string | string[];
	baseRevision: number;
	status: 'dirty' | 'conflict';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isTimestamp(value: unknown): value is string {
	if (typeof value !== 'string') { return false; }
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
	if (!match) { return false; }
	const [, year, month, day, hour, minute, second, , , offsetHour, offsetMinute] = match;
	const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
	return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1
		&& date.getUTCDate() === Number(day) && Number(hour) <= 23 && Number(minute) <= 59
		&& Number(second) <= 59 && (!offsetHour || Number(offsetHour) <= 23 && Number(offsetMinute) <= 59)
		&& Number.isFinite(Date.parse(value));
}

export function validateMetadata(value: unknown): IssueMetadata {
	if (!isRecord(value)
		|| !Number.isSafeInteger(value.id) || (value.id as number) < 1
		|| typeof value.title !== 'string' || !value.title.trim()
		|| (value.state !== 'open' && value.state !== 'closed')
		|| !Array.isArray(value.labels)
		|| !value.labels.every(label => typeof label === 'string' && Boolean(label.trim()))
		|| new Set((value.labels as string[]).map(label => label.trim())).size !== value.labels.length
		|| !isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) {
		throw new Error('Issue metadata is invalid.');
	}
	return {
		id: value.id as number,
		title: (value.title as string).trim(),
		state: value.state,
		labels: (value.labels as string[]).map(label => label.trim()),
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function validateRevision(value: unknown): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new Error('Issue revision is invalid.');
	}
	return value as number;
}
