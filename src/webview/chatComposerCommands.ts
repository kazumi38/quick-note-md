import { EditorState, Transaction } from 'prosemirror-state';
import {
	chainCommands, createParagraphNear, deleteSelection, exitCode, joinBackward,
	liftEmptyBlock, newlineInCode, selectNodeBackward, splitBlock
} from 'prosemirror-commands';
import { splitListItem } from 'prosemirror-schema-list';
import { composerSchema } from './chatComposerModel';

export function splitOnEnter(state: EditorState, dispatch?: (transaction: Transaction) => void): boolean {
	if (!dispatch) { return false; }
	const $from = state.selection.$from;
	for (let depth = $from.depth; depth > 0; depth--) {
		const listItem = $from.node(depth);
		if (listItem.type.name !== 'list_item') { continue; }
		const task = ['open', 'done'].includes(listItem.attrs.taskStatus);
		return splitListItem(listItem.type, task ? { taskStatus: 'open', checked: false } : undefined)(state, dispatch);
	}
	return chainCommands(exitCode, newlineInCode, createParagraphNear, liftEmptyBlock, splitBlock)(state, dispatch);
}

export function softBreak(state: EditorState, dispatch?: (transaction: Transaction) => void): boolean {
	if (!dispatch) { return false; }
	const breakNode = composerSchema.nodes.hard_break.create();
	dispatch(state.tr.replaceSelectionWith(breakNode).scrollIntoView());
	return true;
}

export function backspace(state: EditorState, dispatch?: (transaction: Transaction) => void): boolean {
	if (!state.selection.empty) {
		return deleteSelection(state, dispatch);
	}
	const { $from } = state.selection;
	if ($from.parentOffset === 0) {
		for (let depth = $from.depth; depth > 0; depth--) {
			const node = $from.node(depth);
			if (node.type.name === 'heading') {
				if (!dispatch) { return true; }
				dispatch(state.tr.setBlockType($from.before(depth), $from.after(depth), composerSchema.nodes.paragraph)
					.scrollIntoView());
				return true;
			}
			if (node.type.name === 'list_item' && node.attrs.taskStatus) {
				if (!dispatch) { return true; }
				dispatch(state.tr.setNodeMarkup($from.before(depth), undefined, {
					...node.attrs, taskStatus: null, checked: null
				}).scrollIntoView());
				return true;
			}
			if (node.type.name === 'blockquote' && node.attrs.callout) {
				if (!dispatch) { return true; }
				dispatch(state.tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, callout: null })
					.scrollIntoView());
				return true;
			}
		}
	}
	return chainCommands(deleteSelection, joinBackward, selectNodeBackward)(state, dispatch);
}
