import * as vscode from 'vscode';
import { createHash, randomUUID } from 'crypto';
import { IssueDraft, IssueDraftField, IssueRecord } from './issueMetadata';
import { IssueDraftStore } from './issueDrafts';
import { IssueChanges, IssueStateFilter, IssueStore } from './issueStore';
import { migrateLegacyData } from './legacyMigration';
import { renderSafeMarkdown } from './rendering';

type ViewMessage =
	| { kind: 'ready' | 'refresh' | 'backToList' }
	| { kind: 'selectIssue'; issueId: number; snapshotRevision: number }
	| { kind: 'setFilter'; query: string; stateFilter: IssueStateFilter }
	| { kind: 'startCreate' }
	| { kind: 'draftChanged'; draftId: string; revision: number; field: IssueDraftField; value: string | string[]; issueId?: number; commentId?: string }
	| { kind: 'createIssue'; operationId: string; draftId: string; revision: number; title: string; bodyMarkdown: string }
	| { kind: 'saveField'; operationId: string; issueId: number; field: IssueDraftField; value: string | string[]; baseRevision: number; commentId?: string }
	| { kind: 'cancelDraft'; draftId: string; revision: number }
	| { kind: 'preview'; draftId: string; revision: number; sourceMarkdown: string };

interface IssueSummary extends Omit<IssueRecord, 'bodyMarkdown' | 'comments'> {
	commentCount: number;
}

interface ViewSnapshot {
	kind: 'snapshot';
	revision: number;
	state: 'loading' | 'ready' | 'error';
	issues: IssueSummary[];
	invalid: Array<{ issueId: number; error: string }>;
	openCount: number;
	closedCount: number;
	query: string;
	stateFilter: IssueStateFilter;
	selectedIssueId?: number;
	selectedIssue?: IssueRecord & { bodyHtml: string; commentHtml: string[] };
	draft?: IssueDraft & { title?: string; bodyMarkdown?: string };
	error?: string;
}

interface OperationResult {
	kind: 'operationResult';
	operationId: string;
	ok: boolean;
	issueId?: number;
	errorCode?: 'validation' | 'conflict' | 'storage';
	message?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(message: Record<string, unknown>, keys: string[]): boolean {
	return Object.keys(message).every(key => keys.includes(key));
}

export function issueDraftStoreUri(globalStorage: vscode.Uri, workspace: vscode.Uri): vscode.Uri {
	const workspaceKey = createHash('sha256').update(workspace.toString()).digest('hex');
	return vscode.Uri.joinPath(globalStorage, 'issue-drafts', workspaceKey);
}

function parseMessage(value: unknown): ViewMessage | undefined {
	if (!isObject(value) || typeof value.kind !== 'string') { return undefined; }
	const message = value;
	switch (message.kind) {
		case 'ready':
		case 'refresh':
		case 'startCreate':
		case 'backToList':
			return onlyKeys(message, ['kind']) ? { kind: message.kind } : undefined;
		case 'selectIssue':
			return onlyKeys(message, ['kind', 'issueId', 'snapshotRevision'])
				&& Number.isSafeInteger(message.issueId) && (message.issueId as number) > 0
				&& Number.isSafeInteger(message.snapshotRevision) && (message.snapshotRevision as number) >= 0
				? message as ViewMessage : undefined;
		case 'setFilter':
			return onlyKeys(message, ['kind', 'query', 'stateFilter'])
				&& typeof message.query === 'string' && message.query.length <= 1000
				&& ['all', 'open', 'closed'].includes(message.stateFilter as string)
				? message as ViewMessage : undefined;
		case 'draftChanged':
			return onlyKeys(message, ['kind', 'draftId', 'revision', 'field', 'value', 'issueId', 'commentId'])
				&& typeof message.draftId === 'string' && message.draftId.length <= 100
				&& Number.isSafeInteger(message.revision) && (message.revision as number) >= 0
				&& ['title', 'body', 'labels', 'comment', 'state'].includes(message.field as string)
				&& (typeof message.value === 'string' && message.value.length <= 262144
					|| Array.isArray(message.value) && message.value.length <= 100 && message.value.every(item => typeof item === 'string' && item.length <= 1000))
				&& (message.issueId === undefined || Number.isSafeInteger(message.issueId) && (message.issueId as number) > 0)
				&& (message.commentId === undefined || typeof message.commentId === 'string' && message.commentId.length <= 100)
				? message as ViewMessage : undefined;
		case 'createIssue':
			return onlyKeys(message, ['kind', 'operationId', 'draftId', 'revision', 'title', 'bodyMarkdown'])
				&& typeof message.operationId === 'string' && message.operationId.length <= 100
				&& typeof message.draftId === 'string' && message.draftId.length <= 100
				&& Number.isSafeInteger(message.revision) && (message.revision as number) >= 0
				&& typeof message.title === 'string' && message.title.length <= 1000
				&& typeof message.bodyMarkdown === 'string' && message.bodyMarkdown.length <= 262144
				? message as ViewMessage : undefined;
		case 'saveField':
			return onlyKeys(message, ['kind', 'operationId', 'issueId', 'field', 'value', 'baseRevision', 'commentId'])
				&& typeof message.operationId === 'string' && message.operationId.length <= 100
				&& Number.isSafeInteger(message.issueId) && (message.issueId as number) > 0
				&& ['title', 'body', 'labels', 'comment', 'state'].includes(message.field as string)
				&& (typeof message.value === 'string' && message.value.length <= 262144
					|| Array.isArray(message.value) && message.value.length <= 100 && message.value.every(item => typeof item === 'string' && item.length <= 1000))
				&& Number.isSafeInteger(message.baseRevision) && (message.baseRevision as number) >= 0
				&& (message.commentId === undefined || typeof message.commentId === 'string' && message.commentId.length <= 100)
				? message as ViewMessage : undefined;
		case 'cancelDraft':
			return onlyKeys(message, ['kind', 'draftId', 'revision'])
				&& typeof message.draftId === 'string'
				&& Number.isSafeInteger(message.revision) && (message.revision as number) >= 0
				? message as ViewMessage : undefined;
		case 'preview':
			return onlyKeys(message, ['kind', 'draftId', 'revision', 'sourceMarkdown'])
				&& typeof message.draftId === 'string'
				&& Number.isSafeInteger(message.revision) && (message.revision as number) >= 0
				&& typeof message.sourceMarkdown === 'string' && message.sourceMarkdown.length <= 262144
				? message as ViewMessage : undefined;
		default:
			return undefined;
	}
}

export function validateIssueViewMessage(value: unknown): ViewMessage | undefined {
	return parseMessage(value);
}

export class IssueView implements vscode.WebviewViewProvider, vscode.Disposable {
	private view: vscode.WebviewView | undefined;
	private store: IssueStore | undefined;
	private draftStore: IssueDraftStore | undefined;
	private initialized = false;
	private revision = 0;
	private query = '';
	private stateFilter: IssueStateFilter = 'all';
	private selectedIssueId: number | undefined;
	private activeDraft: IssueDraft | undefined;
	private readonly operations = new Map<string, OperationResult>();
	private messageQueue: Promise<void> = Promise.resolve();
	private initialization: Promise<void> | undefined;

	constructor(private readonly context: vscode.ExtensionContext) {}

	async startCreate(): Promise<void> {
		await this.initialize();
		this.activeDraft = {
			draftId: randomUUID(), field: 'body',
			value: JSON.stringify({ title: '', bodyMarkdown: '' }),
			baseRevision: 0, status: 'dirty',
		};
		await this.draftStore!.save(this.activeDraft);
		await this.refresh();
	}

	async refreshView(): Promise<void> {
		await this.refresh();
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
		};
		view.webview.html = this.html(view.webview);
		view.webview.onDidReceiveMessage(message => {
			this.messageQueue = this.messageQueue.then(() => this.handleMessage(message));
		}, undefined, this.context.subscriptions);
		void this.refresh(true);
	}

	private html(webview: vscode.Webview): string {
		const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
		const script = webview.asWebviewUri(vscode.Uri.joinPath(media, 'issue.js'));
		const composer = webview.asWebviewUri(vscode.Uri.joinPath(media, 'issueComposer.js'));
		const style = webview.asWebviewUri(vscode.Uri.joinPath(media, 'issue.css'));
		const nonce = randomUUID().replace(/-/g, '');
		return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} data:;"><link rel="stylesheet" href="${style}"></head><body class="issue-ui"><main id="app" aria-live="polite"></main><script nonce="${nonce}" src="${composer}"></script><script nonce="${nonce}" src="${script}"></script></body></html>`;
	}

	private async initialize(): Promise<void> {
		if (this.initialized) { return; }
		if (this.initialization) { return this.initialization; }
		this.initialization = (async () => {
			const workspace = vscode.workspace.workspaceFolders?.[0];
			if (!workspace) { throw new Error('Issueを利用するにはワークスペースフォルダーを開いてください。'); }
			await migrateLegacyData(this.context, workspace.uri);
			this.store = new IssueStore(workspace.uri);
			this.draftStore = new IssueDraftStore(issueDraftStoreUri(this.context.globalStorageUri, workspace.uri));
			this.initialized = true;
		})();
		try { await this.initialization; } finally { this.initialization = undefined; }
	}

	private post(message: ViewSnapshot | OperationResult | Record<string, unknown>): void {
		void this.view?.webview.postMessage(message);
	}

	private async refresh(initial = false): Promise<void> {
		try {
			if (initial) {
				this.post({
					kind: 'snapshot', revision: this.revision, state: 'loading', issues: [], invalid: [],
					openCount: 0, closedCount: 0, query: this.query, stateFilter: this.stateFilter,
				});
			}
			await this.initialize();
			const data = await this.store!.list({ query: this.query, state: this.stateFilter });
			const allIds = new Set(data.issues.map(issue => issue.id));
			if (this.selectedIssueId && !allIds.has(this.selectedIssueId)) { this.selectedIssueId = undefined; }
			const selected = this.selectedIssueId ? await this.store!.read(this.selectedIssueId) : undefined;
			const selectedIssue = selected?.issue ? {
				...selected.issue,
					bodyHtml: renderSafeMarkdown(selected.issue.bodyMarkdown),
					commentHtml: selected.issue.comments.map(comment => renderSafeMarkdown(comment.bodyMarkdown)),
			} : undefined;
			this.revision++;
			const savedDrafts = await this.draftStore!.list();
			const activeDraft = this.activeDraft
				? this.activeDraft.issueId === undefined || this.activeDraft.issueId === this.selectedIssueId
					? this.activeDraft
					: savedDrafts.find(draft => draft.issueId === this.selectedIssueId) ?? savedDrafts[0]
				: savedDrafts.find(draft => draft.issueId === this.selectedIssueId) ?? savedDrafts[0];
			if (activeDraft && !this.activeDraft) { this.activeDraft = activeDraft; }
			let draftPayload: ViewSnapshot['draft'];
			if (activeDraft) {
				draftPayload = { ...activeDraft };
				if (activeDraft.issueId === undefined && typeof activeDraft.value === 'string') {
					try {
						const createData = JSON.parse(activeDraft.value) as { title?: string; bodyMarkdown?: string };
						draftPayload.title = createData.title ?? '';
						draftPayload.bodyMarkdown = createData.bodyMarkdown ?? '';
					} catch {
						draftPayload.status = 'conflict';
					}
				}
				if (activeDraft.issueId !== undefined && selectedIssue?.revision !== undefined
					&& activeDraft.baseRevision !== selectedIssue.revision) {
					draftPayload.status = 'conflict';
				}
			}
			this.post({
				kind: 'snapshot',
				revision: this.revision,
				state: 'ready',
				issues: data.issues.map(({ comments, bodyMarkdown, ...issue }) => ({
					...issue,
					commentCount: comments.length,
				})),
				invalid: data.invalid.map(issue => ({ issueId: issue.issueId, error: issue.error ?? 'Invalid Issue.' })),
				openCount: data.openCount,
				closedCount: data.closedCount,
				query: this.query,
				stateFilter: this.stateFilter,
				selectedIssueId: this.selectedIssueId,
				selectedIssue,
				draft: draftPayload,
			});
		} catch (error) {
			this.initialized = false;
			this.post({
				kind: 'snapshot',
				revision: ++this.revision,
				state: 'error',
				issues: [],
				invalid: [],
				openCount: 0,
				closedCount: 0,
				query: this.query,
				stateFilter: this.stateFilter,
				error: error instanceof Error ? error.message : 'Issue一覧を読み込めませんでした。',
			});
			await vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Issueの初期化に失敗しました。');
		}
	}

	private async handleMessage(value: unknown): Promise<void> {
		const message = parseMessage(value);
		if (!message) { return; }
		try {
			switch (message.kind) {
				case 'ready':
				case 'refresh':
					await this.refresh();
					break;
				case 'backToList':
					this.selectedIssueId = undefined;
					await this.refresh();
					break;
				case 'selectIssue':
					if (message.snapshotRevision !== this.revision) { await this.refresh(); break; }
					this.selectedIssueId = message.issueId;
					if (this.activeDraft?.issueId !== undefined && this.activeDraft.issueId !== message.issueId) {
						this.activeDraft = undefined;
					}
					await this.refresh();
					break;
				case 'setFilter':
					this.query = message.query;
					this.stateFilter = message.stateFilter;
					await this.refresh();
					break;
				case 'startCreate':
					await this.startCreate();
					break;
				case 'draftChanged':
					await this.saveDraftChanged(message);
					break;
				case 'createIssue':
					await this.createIssue(message);
					break;
				case 'saveField':
					await this.saveField(message);
					break;
				case 'cancelDraft':
					await this.cancelDraft(message);
					break;
				case 'preview':
					this.post({
						kind: 'preview', draftId: message.draftId, revision: message.revision,
						sourceMarkdown: message.sourceMarkdown, safeHtml: renderSafeMarkdown(message.sourceMarkdown),
					});
					break;
			}
		} catch (error) {
			if (message.kind === 'createIssue' || message.kind === 'saveField') {
				this.result({
					kind: 'operationResult',
					operationId: message.operationId,
					ok: false,
					errorCode: /changed|revision|conflict/i.test(error instanceof Error ? error.message : '') ? 'conflict' : 'storage',
					message: error instanceof Error ? error.message : '操作を完了できませんでした。',
				});
			} else {
				this.post({ kind: 'notice', message: error instanceof Error ? error.message : '操作を完了できませんでした。' });
			}
		}
	}

	private async saveDraftChanged(message: Extract<ViewMessage, { kind: 'draftChanged' }>): Promise<void> {
		if (!this.draftStore) { await this.initialize(); }
		let value = message.value;
		const isNewIssueDraft = this.activeDraft?.draftId === message.draftId && this.activeDraft.issueId === undefined;
		if (isNewIssueDraft && typeof this.activeDraft?.value === 'string') {
			let aggregate: { title?: string; bodyMarkdown?: string } = {};
			try { aggregate = JSON.parse(this.activeDraft.value) as typeof aggregate; } catch (error) {
				throw new Error(`Issue draft is corrupt and was preserved: ${error instanceof Error ? error.message : String(error)}`);
			}
			if (message.field === 'title') { aggregate.title = String(value); }
			if (message.field === 'body') { aggregate.bodyMarkdown = String(value); }
			value = JSON.stringify(aggregate);
		}
		const draft: IssueDraft = {
			draftId: message.draftId,
			issueId: message.issueId,
			field: isNewIssueDraft ? 'body' : message.field,
			commentId: message.commentId,
			value,
			baseRevision: this.activeDraft?.baseRevision ?? message.revision,
			status: 'dirty',
		};
		this.activeDraft = draft;
		await this.draftStore!.save(draft);
	}

	private async createIssue(message: Extract<ViewMessage, { kind: 'createIssue' }>): Promise<void> {
		const previous = this.operations.get(message.operationId);
		if (previous) { this.post(previous); return; }
		const savedDraft = await this.draftStore!.load(message.draftId);
		if (!savedDraft || savedDraft.baseRevision !== message.revision) {
			throw new Error('Issue draft changed. Review the retained input before retrying.');
		}
		const issue = await this.store!.create({ title: message.title, bodyMarkdown: message.bodyMarkdown });
		await this.draftStore!.remove(message.draftId);
		this.activeDraft = undefined;
		this.selectedIssueId = issue.id;
		const result: OperationResult = { kind: 'operationResult', operationId: message.operationId, ok: true, issueId: issue.id };
		this.result(result);
		await this.refresh();
	}

	private async saveField(message: Extract<ViewMessage, { kind: 'saveField' }>): Promise<void> {
		const previous = this.operations.get(message.operationId);
		if (previous) { this.post(previous); return; }
		const changes: IssueChanges = {};
		switch (message.field) {
			case 'title':
				if (typeof message.value !== 'string') { throw new Error('Issue title input is invalid.'); }
				changes.title = message.value;
				break;
			case 'body':
				if (typeof message.value !== 'string') { throw new Error('Issue body input is invalid.'); }
				changes.bodyMarkdown = message.value;
				break;
			case 'state':
				if (message.value !== 'open' && message.value !== 'closed') { throw new Error('Issue state input is invalid.'); }
				changes.state = message.value;
				break;
			case 'labels':
				if (!Array.isArray(message.value)) { throw new Error('Issue labels input is invalid.'); }
				changes.labels = message.value;
				break;
			case 'comment':
				if (typeof message.value !== 'string') { throw new Error('Comment input is invalid.'); }
				changes.comment = { commentId: message.commentId, bodyMarkdown: message.value };
				break;
		}
		const issue = await this.store!.update(message.issueId, message.baseRevision, changes);
		const drafts = await this.draftStore!.list();
		for (const draft of drafts) {
			if (draft.issueId === message.issueId && draft.field === message.field
				&& draft.commentId === message.commentId) {
				await this.draftStore!.remove(draft.draftId);
			}
		}
		this.activeDraft = undefined;
		const result: OperationResult = { kind: 'operationResult', operationId: message.operationId, ok: true, issueId: issue.id };
		this.result(result);
		await this.refresh();
	}

	private async cancelDraft(message: Extract<ViewMessage, { kind: 'cancelDraft' }>): Promise<void> {
		const draft = await this.draftStore!.load(message.draftId);
		if (!draft || draft.baseRevision !== message.revision) { return; }
		await this.draftStore!.remove(message.draftId);
		if (this.activeDraft?.draftId === message.draftId) { this.activeDraft = undefined; }
		await this.refresh();
	}

	private result(result: OperationResult): void {
		if (result.ok) { this.operations.set(result.operationId, result); }
		this.post(result);
	}

	dispose(): void {
		this.view = undefined;
	}
}
