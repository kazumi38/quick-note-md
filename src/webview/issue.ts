export {};

interface WebviewIssue {
	id: number;
	title: string;
	state: 'open' | 'closed';
	labels: string[];
	createdAt: string;
	updatedAt: string;
	revision: number;
	commentCount: number;
}

interface WebviewComment {
	id: string;
	bodyMarkdown: string;
	createdAt: string;
}

interface WebviewSelectedIssue extends WebviewIssue {
	bodyMarkdown: string;
	comments: WebviewComment[];
	bodyHtml: string;
	commentHtml: string[];
}

interface WebviewDraft {
	draftId: string;
	issueId?: number;
	field: 'title' | 'body' | 'labels' | 'comment' | 'state';
	value: string | string[];
	baseRevision: number;
	status: 'dirty' | 'conflict';
	title?: string;
	bodyMarkdown?: string;
	commentId?: string;
}

interface Snapshot {
	kind: 'snapshot';
	revision: number;
	state: 'loading' | 'ready' | 'error';
	issues: WebviewIssue[];
	invalid: Array<{ issueId: number; error: string }>;
	openCount: number;
	closedCount: number;
	query: string;
	stateFilter: 'all' | 'open' | 'closed';
	selectedIssueId?: number;
	selectedIssue?: WebviewSelectedIssue;
	draft?: WebviewDraft;
	error?: string;
}

interface IssueApi {
	postMessage(message: Record<string, unknown>): void;
}

interface ComposerInstance {
	destroy(): void;
}

declare function acquireVsCodeApi(): IssueApi;

const api = acquireVsCodeApi();
const root = document.getElementById('app')!;
let snapshot: Snapshot | undefined;
let editingTitle = false;
let editingBody = false;
let editingCommentId: string | undefined;
let searchTimer: number | undefined;
let submitting = false;
const editDraftIds = new Map<string, string>();
const composerInstances: ComposerInstance[] = [];
const composerValues = new Map<string, string>();
const pendingFieldOperations = new Map<string, {
	field: 'title' | 'body' | 'labels' | 'comment' | 'state';
	commentId?: string;
}>();

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, char => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	}[char]!));
}

function post(message: Record<string, unknown>): void {
	api.postMessage(message);
}

function operationId(): string {
	return crypto.randomUUID();
}

function listView(): string {
	const data = snapshot!;
	const filters = `<label class="sr-only" for="issue-search">Issueを検索</label><input id="issue-search" type="search" value="${escapeHtml(data.query)}" placeholder="Issueを検索" aria-label="Issueを検索">
		<label class="sr-only" for="issue-filter">状態</label><select id="issue-filter" aria-label="状態で絞り込む">
			<option value="all" ${data.stateFilter === 'all' ? 'selected' : ''}>すべて (${data.openCount + data.closedCount})</option>
			<option value="open" ${data.stateFilter === 'open' ? 'selected' : ''}>Open (${data.openCount})</option>
			<option value="closed" ${data.stateFilter === 'closed' ? 'selected' : ''}>Closed (${data.closedCount})</option>
		</select>`;
	const rows = data.issues.map(issue => `<button class="issue-list-row" data-action="select" data-id="${issue.id}" data-revision="${data.revision}" aria-label="Issue #${issue.id} ${escapeHtml(issue.title)}を開く">
		<strong>${escapeHtml(issue.title)}</strong><span class="issue-list-meta">#${issue.id} · ${issue.state === 'open' ? 'Open' : 'Closed'} · コメント ${issue.commentCount}</span>
		<span class="issue-label-list">${issue.labels.map(label => `<span class="label-chip">${escapeHtml(label)}</span>`).join('')}</span>
	</button>`).join('');
	const noResults = data.issues.length ? '' : `<p class="issue-empty">${data.query ? '検索結果がありません。' : 'Issueはまだありません。'}</p>`;
	const invalid = data.invalid.map(item => `<p class="warning" role="alert">Issue #${item.issueId} は読み取り専用です: ${escapeHtml(item.error)}</p>`).join('');
	const draftNotice = data.draft?.issueId
		? `<button class="issue-draft-notice" data-action="select" data-id="${data.draft.issueId}" data-revision="${data.revision}">Issue #${data.draft.issueId} に未保存の下書きがあります。再開</button>` : '';
	return `<header class="issue-toolbar"><h1>Issues</h1><button class="issue-primary" data-action="create">新規Issue</button></header>${draftNotice}
		<section class="issue-list-tools">${filters}</section>${invalid}<section class="issue-list" aria-label="Issue一覧">${rows}${noResults}</section>`;
}

function markdownArea(value: string, action: string, label: string): string {
	return `<div class="issue-composer" data-composer="${action}" data-initial="${escapeHtml(value)}">
		<div class="issue-toolbar" role="toolbar" aria-label="${label} 書式設定"></div>
		<div class="issue-editor" aria-label="${label}"></div>
		</div><div class="issue-markdown-preview" data-preview="${action}" hidden></div>
		<div class="issue-edit-actions"><button type="button" data-action="preview" data-field="${action}">プレビュー</button></div>`;
}

function creationView(): string {
	const draft = snapshot!.draft;
	const title = draft?.title ?? '';
	const body = draft?.bodyMarkdown ?? '';
	return `<header class="issue-toolbar"><button data-action="back">一覧へ戻る</button><h1>新規Issue</h1></header>
		<form id="create-form" class="issue-card">
			<label>タイトル<input type="text" data-field="create-title" value="${escapeHtml(title)}" maxlength="1000" required aria-label="Issueタイトル"></label>
			<label>本文（Markdown）${markdownArea(body, 'create-body', 'Issue本文（Markdown）')}</label>
			<div class="issue-panel-actions"><button type="button" data-action="cancel-create">キャンセル</button><button class="issue-primary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? '作成中…' : 'Issueを作成'}</button></div>
			<p class="issue-error" role="alert"></p>
		</form>`;
}

function selectedView(): string {
	const issue = snapshot!.selectedIssue!;
	const draft = snapshot!.draft?.issueId === issue.id ? snapshot!.draft : undefined;
	if (draft?.field === 'title') { editingTitle = true; }
	if (draft?.field === 'body') { editingBody = true; }
	if (draft?.field === 'comment') { editingCommentId = draft.commentId; }
	const stateText = issue.state === 'open' ? 'Open' : 'Closed';
	const title = editingTitle
		? `<input type="text" data-field="edit-title" value="${escapeHtml(draft?.field === 'title' && typeof draft.value === 'string' ? draft.value : issue.title)}" aria-label="Issueタイトルを編集">`
		: `<h1>${escapeHtml(issue.title)}</h1>`;
	const body = editingBody
		? markdownArea(draft?.field === 'body' && typeof draft.value === 'string' ? draft.value : issue.bodyMarkdown, 'edit-body', 'Issue本文を編集')
		: `<div class="issue-markdown-rendered">${issue.bodyHtml}</div>`;
	const comments = issue.comments.map((comment, index) => {
		const html = issue.commentHtml[index] ?? '';
		const content = editingCommentId === comment.id
			? markdownArea(draft?.field === 'comment' && draft.commentId === comment.id && typeof draft.value === 'string'
				? draft.value : comment.bodyMarkdown, 'edit-comment', 'コメントを編集')
			: `<div class="issue-markdown-rendered">${html}</div>`;
		return `<article class="issue-comment"><header><strong>コメント ${index + 1}</strong><time>${escapeHtml(new Date(comment.createdAt).toLocaleString())}</time>
			<button data-action="edit-comment" data-id="${escapeHtml(comment.id)}">編集</button></header>${content}
			${editingCommentId === comment.id ? `<div class="issue-edit-actions"><button data-action="save-comment" data-id="${escapeHtml(comment.id)}">保存</button><button data-action="cancel-comment">キャンセル</button></div>` : ''}</article>`;
	}).join('');
	const conflict = draft && (draft.status === 'conflict' || draft.baseRevision !== issue.revision)
		? `<p class="issue-error" role="alert">保存開始後にIssueが変更されました。未保存の入力は保持されています。<button data-action="discard-issue-draft">下書きを破棄して最新を表示</button></p>` : '';
	return `<header class="issue-toolbar"><button data-action="back">一覧へ戻る</button><button data-action="refresh">再読み込み</button></header>${conflict}
		<article class="issue-detail">
			<div class="issue-heading"><div class="issue-title-row">${title}</div><p class="issue-context">#${issue.id} · ${stateText}</p></div>
			<div class="issue-status-row"><label>状態 <select data-field="state" aria-label="Issue状態"><option value="open" ${issue.state === 'open' ? 'selected' : ''}>Open</option><option value="closed" ${issue.state === 'closed' ? 'selected' : ''}>Closed</option></select></label></div>
			<div class="issue-label-list">${issue.labels.map(label => `<span class="label-chip">${escapeHtml(label)}<button data-action="remove-label" data-label="${escapeHtml(label)}" aria-label="${escapeHtml(label)}ラベルを削除">×</button></span>`).join('')}</div>
			<form id="label-form" class="issue-label-editor"><label>ラベルを追加<input type="text" data-field="new-label" aria-label="追加するラベル"></label><button type="submit">追加</button></form>
			<section class="detail-head"><div class="issue-body-heading"><h2>説明</h2>${!editingBody ? '<button data-action="edit-body">編集</button>' : ''}</div>
				${body}${editingBody ? '<div class="issue-edit-actions"><button data-action="save-body">保存</button><button data-action="cancel-body">キャンセル</button></div>' : ''}
			</section>
			<section class="issue-timeline"><h2>コメント ${issue.comments.length}</h2>${comments || '<p class="issue-empty">コメントはありません。</p>'}
				<form id="comment-form" class="issue-new-comment"><label>コメントを書く${markdownArea(draft?.field === 'comment' && !draft.commentId && typeof draft.value === 'string' ? draft.value : '', 'new-comment', 'コメントをMarkdownで入力')}</label><button class="issue-primary" type="submit">コメントする</button></form>
			</section><p class="issue-error" role="alert"></p>
			${editingTitle ? '<div class="issue-edit-actions"><button data-action="save-title">保存</button><button data-action="cancel-title">キャンセル</button></div>' : '<button data-action="edit-title">タイトルを編集</button>'}
		</article>`;
}

function render(preservedValues?: { composers: Map<string, string>; newLabel?: string }): void {
	if (!snapshot) { return; }
	while (composerInstances.length) { composerInstances.pop()?.destroy(); }
	if (snapshot.state === 'loading') { root.innerHTML = '<p class="issue-loading" role="status">読み込み中…</p>'; return; }
	if (snapshot.state === 'error') {
		root.innerHTML = `<section class="issue-error" role="alert">${escapeHtml(snapshot.error ?? 'Issueを読み込めませんでした。')}<button data-action="refresh">再試行</button></section>`;
		return;
	}
	if (snapshot.draft && snapshot.draft.issueId === undefined) { root.innerHTML = creationView(); }
	else if (snapshot.selectedIssue) { root.innerHTML = selectedView(); }
	else { root.innerHTML = listView(); }
	mountComposers(preservedValues?.composers);
	const labelInput = root.querySelector<HTMLInputElement>('[data-field="new-label"]');
	if (labelInput && preservedValues?.newLabel !== undefined) { labelInput.value = preservedValues.newLabel; }
}

function mountComposers(preservedValues?: Map<string, string>): void {
	for (const container of root.querySelectorAll<HTMLElement>('[data-composer]')) {
		const field = container.dataset.composer!;
		const toolbar = container.querySelector<HTMLElement>('.issue-toolbar');
		const editor = container.querySelector<HTMLElement>('.issue-editor');
		if (!toolbar || !editor || !window.quickNoteIssueComposer) { continue; }
		const initial = preservedValues?.get(field) ?? container.dataset.initial ?? '';
		composerValues.set(field, initial);
		composerInstances.push(window.quickNoteIssueComposer.create(
			editor,
			toolbar,
			initial,
			editor.getAttribute('aria-label') ?? 'Markdown',
			markdown => {
				composerValues.set(field, markdown);
				if (field === 'create-body') { activeDraftValue('body', markdown); }
				if (field === 'edit-body') { activeDraftValue('body', markdown); }
				if (field === 'new-comment') { activeDraftValue('comment', markdown); }
				if (field === 'edit-comment' && editingCommentId) { activeDraftValue('comment', markdown, editingCommentId); }
			},
			message => {
				const error = root.querySelector<HTMLElement>('.issue-error');
				if (error) { error.textContent = message; }
			},
		));
	}
}

function activeDraftValue(field: 'title' | 'body' | 'labels' | 'comment' | 'state', value: string | string[], commentId?: string): void {
	const draft = snapshot?.draft;
	if (draft && draft.issueId === undefined) {
		post({
			kind: 'draftChanged', draftId: draft.draftId, revision: draft.baseRevision,
			field, value,
		});
		return;
	}
	const issue = snapshot?.selectedIssue;
	if (!issue) { return; }
	const key = `${issue.id}:${field}:${commentId ?? ''}`;
	let draftId = editDraftIds.get(key);
	if (!draftId) { draftId = crypto.randomUUID(); editDraftIds.set(key, draftId); }
	post({
		kind: 'draftChanged', draftId, revision: issue.revision,
		field, value, issueId: issue.id, commentId,
	});
}

function cancelEditDraft(field: string, commentId?: string): void {
	const issue = snapshot?.selectedIssue;
	if (!issue) { return; }
	const key = `${issue.id}:${field}:${commentId ?? ''}`;
	const draftId = editDraftIds.get(key);
	if (draftId) {
		post({ kind: 'cancelDraft', draftId, revision: issue.revision });
		editDraftIds.delete(key);
	}
}

function saveField(field: string, value: string | string[], commentId?: string): void {
	const issue = snapshot?.selectedIssue;
	if (!issue) { return; }
	const draft = snapshot?.draft?.issueId === issue.id
		&& snapshot.draft.field === field && snapshot.draft.commentId === commentId ? snapshot.draft : undefined;
	const id = operationId();
	if (field === 'title' || field === 'body' || field === 'labels' || field === 'comment' || field === 'state') {
		pendingFieldOperations.set(id, { field, commentId });
	}
	post({
		kind: 'saveField', operationId: id, issueId: issue.id, field, value,
		baseRevision: draft?.baseRevision ?? issue.revision, commentId,
	});
}

function currentValue(field: string): string {
	return composerValues.get(field) ?? root.querySelector<HTMLTextAreaElement>(`textarea[data-field="${field}"]`)?.value ?? '';
}

root.addEventListener('input', event => {
	const target = event.target;
	if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) { return; }
	if (target.dataset.field === 'create-title') { activeDraftValue('title', target.value); }
if (target.dataset.field === 'edit-title') { activeDraftValue('title', target.value); }
});

root.addEventListener('change', event => {
	const target = event.target;
	if (!(target instanceof HTMLSelectElement)) { return; }
	if (target.id === 'issue-filter') {
		post({ kind: 'setFilter', query: snapshot?.query ?? '', stateFilter: target.value });
	}
	if (target.dataset.field === 'state') { saveField('state', target.value); }
});

root.addEventListener('submit', event => {
	event.preventDefault();
	const form = event.target;
	if (!(form instanceof HTMLFormElement)) { return; }
	if (form.id === 'create-form') {
		const title = form.querySelector<HTMLInputElement>('[data-field="create-title"]')?.value ?? '';
		const bodyMarkdown = currentValue('create-body');
		const draft = snapshot?.draft;
		if (!draft || submitting) { return; }
		submitting = true;
		const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
		if (submit) { submit.disabled = true; submit.textContent = '作成中…'; }
		post({ kind: 'createIssue', operationId: operationId(), draftId: draft.draftId, revision: draft.baseRevision, title, bodyMarkdown });
		return;
	}
	if (form.id === 'label-form') {
		const input = form.querySelector<HTMLInputElement>('[data-field="new-label"]');
		const issue = snapshot?.selectedIssue;
		if (!input || !issue || !input.value.trim()) { return; }
		saveField('labels', [...issue.labels, input.value.trim()]);
		return;
	}
	if (form.id === 'comment-form') {
		const value = currentValue('new-comment');
		if (value.trim()) { saveField('comment', value); }
	}
});

root.addEventListener('click', event => {
	const target = event.target;
	if (!(target instanceof Element)) { return; }
	const button = target.closest<HTMLElement>('[data-action]');
	if (!button || !snapshot) { return; }
	switch (button.dataset.action) {
		case 'select':
			post({ kind: 'selectIssue', issueId: Number(button.dataset.id), snapshotRevision: Number(button.dataset.revision) });
			break;
		case 'create':
			post({ kind: 'startCreate' });
			break;
		case 'refresh':
			post({ kind: 'refresh' });
			break;
		case 'back':
			editingTitle = false;
			editingBody = false;
			editingCommentId = undefined;
			post({ kind: 'backToList' });
			break;
		case 'cancel-create':
			if (snapshot.draft) { post({ kind: 'cancelDraft', draftId: snapshot.draft.draftId, revision: snapshot.draft.baseRevision }); }
			snapshot.draft = undefined;
			render();
			break;
		case 'edit-title':
			editingTitle = true; render(); break;
		case 'cancel-title':
			cancelEditDraft('title'); editingTitle = false; render(); break;
		case 'save-title': {
			const value = root.querySelector<HTMLInputElement>('[data-field="edit-title"]')?.value ?? '';
			saveField('title', value); break;
		}
		case 'edit-body':
			editingBody = true; render(); break;
		case 'cancel-body':
			cancelEditDraft('body'); editingBody = false; render(); break;
		case 'save-body':
			saveField('body', currentValue('edit-body')); break;
		case 'edit-comment':
			editingCommentId = button.dataset.id; render(); break;
		case 'cancel-comment':
			cancelEditDraft('comment', editingCommentId); editingCommentId = undefined; render(); break;
		case 'discard-issue-draft':
			if (snapshot.draft?.issueId !== undefined) {
				post({ kind: 'cancelDraft', draftId: snapshot.draft.draftId, revision: snapshot.draft.baseRevision });
				editDraftIds.delete(`${snapshot.draft.issueId}:${snapshot.draft.field}:${snapshot.draft.commentId ?? ''}`);
				snapshot.draft = undefined;
				editingTitle = false;
				editingBody = false;
				editingCommentId = undefined;
				render();
				post({ kind: 'refresh' });
			}
			break;
		case 'save-comment':
			activeDraftValue('comment', currentValue('edit-comment'), button.dataset.id);
			saveField('comment', currentValue('edit-comment'), button.dataset.id); break;
		case 'remove-label': {
			const value = button.dataset.label;
			if (value !== undefined) { saveField('labels', snapshot.selectedIssue!.labels.filter(label => label !== value)); }
			break;
		}
		case 'preview': {
			const field = button.dataset.field ?? '';
			const preview = root.querySelector<HTMLElement>(`[data-preview="${field}"]`);
			if (!preview) { break; }
			preview.hidden = !preview.hidden;
			if (preview.hidden) { break; }
			const sourceMarkdown = currentValue(field);
			const draft = snapshot.draft;
			post({
				kind: 'preview',
				draftId: draft?.draftId ?? `preview-${snapshot.revision}`,
				revision: draft?.baseRevision ?? snapshot.revision,
				sourceMarkdown,
			});
			break;
		}
	}
});

root.addEventListener('input', event => {
	const target = event.target;
	if (target instanceof HTMLInputElement && target.id === 'issue-search') {
		if (searchTimer !== undefined) { clearTimeout(searchTimer); }
		searchTimer = window.setTimeout(() => post({
			kind: 'setFilter', query: target.value, stateFilter: snapshot?.stateFilter ?? 'all',
		}), 150);
	}
});

window.addEventListener('message', event => {
	const message = event.data as Record<string, unknown>;
	if (message.kind === 'snapshot') {
		const next = message as unknown as Snapshot;
		if (snapshot && next.revision < snapshot.revision) { return; }
		const previous = snapshot;
		const unchangedDetail = previous?.state === 'ready' && next.state === 'ready'
			&& previous.selectedIssueId !== undefined
			&& previous.selectedIssueId === next.selectedIssueId
			&& previous.selectedIssue?.revision === next.selectedIssue?.revision
			&& JSON.stringify(previous.draft ?? null) === JSON.stringify(next.draft ?? null);
		const previousDraft = previous?.draft;
		if (!previous || previous.selectedIssueId !== next.selectedIssueId) {
			editingTitle = false;
			editingBody = false;
			editingCommentId = undefined;
		} else if (previousDraft && previousDraft.issueId === next.selectedIssueId &&
			previousDraft.draftId !== next.draft?.draftId) {
			if (previousDraft.field === 'title') { editingTitle = false; }
			if (previousDraft.field === 'body') { editingBody = false; }
			if (previousDraft.field === 'comment') { editingCommentId = undefined; }
		}
		const preservedValues = previous && previous.selectedIssueId !== undefined
			&& previous.selectedIssueId === next.selectedIssueId
			? {
				composers: new Map(composerValues),
				newLabel: root.querySelector<HTMLInputElement>('[data-field="new-label"]')?.value,
			}
			: undefined;
		snapshot = next;
		if (!unchangedDetail) { render(preservedValues); }
	} else if (message.kind === 'preview' && typeof message.safeHtml === 'string') {
		const field = root.querySelector<HTMLElement>('.issue-markdown-preview:not([hidden])');
		if (field) { field.innerHTML = message.safeHtml; }
	} else if (message.kind === 'operationResult' && message.ok === false) {
		submitting = false;
		if (typeof message.operationId === 'string') { pendingFieldOperations.delete(message.operationId); }
		const error = root.querySelector<HTMLElement>('.issue-error');
		if (error) { error.textContent = String(message.message ?? '保存に失敗しました。'); }
		const submit = root.querySelector<HTMLButtonElement>('#create-form button[type="submit"]');
		if (submit) { submit.disabled = false; submit.textContent = 'Issueを作成'; }
	} else if (message.kind === 'operationResult' && message.ok === true) {
		submitting = false;
		if (typeof message.operationId === 'string') {
			const pending = pendingFieldOperations.get(message.operationId);
			if (pending?.field === 'title') { editingTitle = false; }
			if (pending?.field === 'body') { editingBody = false; }
			if (pending?.field === 'comment' && editingCommentId === pending.commentId) {
				editingCommentId = undefined;
			}
			if (pending?.field === 'body') { composerValues.delete('edit-body'); }
			if (pending?.field === 'comment') {
				composerValues.delete(pending.commentId ? 'edit-comment' : 'new-comment');
			}
			if (pending?.field === 'labels') {
				const labelInput = root.querySelector<HTMLInputElement>('[data-field="new-label"]');
				if (labelInput) { labelInput.value = ''; }
			}
			pendingFieldOperations.delete(message.operationId);
		}
		if (typeof message.issueId === 'number') {
			for (const key of [...editDraftIds.keys()]) {
				if (key.startsWith(`${message.issueId}:`)) { editDraftIds.delete(key); }
			}
		}
	} else if (message.kind === 'notice') {
		const notice = document.createElement('p');
		notice.className = 'warning';
		notice.setAttribute('role', 'alert');
		notice.textContent = String(message.message ?? '操作を完了できませんでした。');
		root.prepend(notice);
	}
});

post({ kind: 'ready' });
