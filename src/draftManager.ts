import { DraftKind, DraftSnapshot, DraftStore } from './drafts';
import { TodoRef } from './documents';

export interface DraftTarget {
	filePath: string;
	originalText: string;
	kind: DraftKind;
	replyId?: string;
}

export function draftBackupKey(target: DraftTarget): string {
	return [target.filePath, target.originalText, target.kind, target.replyId ?? ''].join('\u0000');
}

/** The on-disk text a draft must still match to be considered safely restorable. */
export function currentBaseSource(todo: TodoRef, kind: DraftKind, replyId?: string): string {
	if (kind === 'body') { return todo.bodyMarkdown ?? ''; }
	if (kind === 'attributes') {
		return JSON.stringify({ labels: [...(todo.labels ?? [])].sort(), dueDate: todo.dueDate ?? '' });
	}
	return todo.comments?.comments.find(candidate => candidate.id === replyId)?.bodyMarkdown ?? '';
}

export interface ReconciledDraft {
	todoKey: string | undefined;
	snapshot: DraftSnapshot;
	state: 'dirty' | 'conflict';
}

/**
 * Matches persisted draft backups against the current Todo list. A draft restores only when its
 * file/original-text identity resolves to exactly one current Todo and the on-disk block content
 * still equals the text recorded when the draft was saved; anything else is reported as a conflict
 * and never applied automatically (FR-712, FR-713).
 */
export function reconcileDrafts(
	snapshots: readonly DraftSnapshot[],
	todos: readonly TodoRef[],
	todoKey: (todo: TodoRef) => string,
): ReconciledDraft[] {
	return snapshots.map(snapshot => {
		const matches = todos.filter(todo =>
			todo.uri.fsPath === snapshot.todoIdentity.filePath && todo.raw === snapshot.todoIdentity.originalText);
		if (matches.length !== 1) { return { todoKey: undefined, snapshot, state: 'conflict' }; }
		const [todo] = matches;
		const current = currentBaseSource(todo, snapshot.kind, snapshot.replyId);
		return { todoKey: todoKey(todo), snapshot, state: current === snapshot.baseSource ? 'dirty' : 'conflict' };
	});
}

export class DraftManager {
	constructor(private readonly store: DraftStore) {}

	async reconcile(todos: readonly TodoRef[], todoKey: (todo: TodoRef) => string): Promise<ReconciledDraft[]> {
		return reconcileDrafts(await this.store.list(), todos, todoKey);
	}

	async change(
		todo: TodoRef, kind: DraftKind,
		value: { text?: string; labels?: string[]; dueDate?: string },
		replyId?: string,
	): Promise<void> {
		const target: DraftTarget = { filePath: todo.uri.fsPath, originalText: todo.raw, kind, replyId };
		const snapshot: DraftSnapshot = {
			kind, backupKey: draftBackupKey(target), replyId,
			todoIdentity: { filePath: todo.uri.fsPath, originalText: todo.raw },
			text: value.text, labels: value.labels, dueDate: value.dueDate,
			baseSource: currentBaseSource(todo, kind, replyId), state: 'dirty',
		};
		await this.store.save(snapshot);
	}

	async clear(todo: TodoRef, kind: DraftKind, replyId?: string): Promise<void> {
		await this.store.remove(draftBackupKey({ filePath: todo.uri.fsPath, originalText: todo.raw, kind, replyId }));
	}
}
