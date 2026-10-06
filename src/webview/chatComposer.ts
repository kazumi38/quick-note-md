import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { inputRules, InputRule, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import { baseKeymap } from 'prosemirror-commands';
import {
	composerSchema, composerParser, composerSerializer, serializeComposerDocument, tableEditing
} from './chatComposerModel';
import { backspace, softBreak, splitOnEnter } from './chatComposerCommands';

function composerInputRules() {
	const { nodes, marks } = composerSchema;
	const strong = new InputRule(/\*\*([^*]+)\*\*$/, (state, match, start, end) => {
		const textLength = match[1].length;
		return state.tr.delete(end - 2, end).delete(start, start + 2)
			.addMark(start, start + textLength, marks.strong.create());
	});
	const emphasis = new InputRule(/\*([^*]+)\*$/, (state, match, start, end) => {
		const textLength = match[1].length;
		return state.tr.delete(end - 1, end).delete(start, start + 1)
			.addMark(start, start + textLength, marks.em.create());
	});
	const callout = new InputRule(/^\[!(INFO|WARN)\]\s$/i, (state, match, start, end) => {
		const $from = state.selection.$from;
		for (let depth = $from.depth; depth > 0; depth--) {
			const node = $from.node(depth);
			if (node.type.name === 'blockquote') {
				return state.tr.setNodeMarkup($from.before(depth), undefined, {
					...node.attrs, callout: match[1].toLowerCase()
				}).delete(start, end);
			}
		}
		return null;
	});
	const taskStatus = new InputRule(/^\[([ xX!in-])\]\s$/, (state, match, start, end) => {
		const $from = state.selection.$from;
		for (let depth = $from.depth; depth > 0; depth--) {
			const node = $from.node(depth);
			if (node.type.name !== 'list_item') { continue; }
			const marker = match[1];
			return state.tr.setNodeMarkup($from.before(depth), undefined, {
				...node.attrs,
				taskStatus: marker === ' ' ? 'open' : marker.toLowerCase() === 'x' ? 'done'
					: marker === 'i' ? 'info' : marker === '!' ? 'warn' : marker === 'n' ? 'note' : 'skip',
				checked: marker.toLowerCase() === 'x'
			}).delete(start, end);
		}
		return null;
	});
	return [
		textblockTypeInputRule(/^(#{1,6})\s$/, nodes.heading, match => ({ level: match[1].length })),
		wrappingInputRule(/^\s*>\s$/, nodes.blockquote),
		wrappingInputRule(/^\s*([-+*])\s$/, nodes.bullet_list),
		wrappingInputRule(/^(\d+)[.)]\s$/, nodes.ordered_list, match => ({ order: Number(match[1]) })),
		callout,
		taskStatus,
		strong,
		emphasis
	];
}

export interface ChatComposer {
	view: EditorView;
	destroy(): void;
}

export function createChatComposer(
	parent: HTMLElement,
	initialMarkdown: string,
	onChange: (markdown: string) => void,
	onError: (message: string) => void
): ChatComposer {
	const document = composerParser.parse(initialMarkdown);
	const state = EditorState.create({
		doc: document,
		plugins: [
			inputRules({ rules: composerInputRules() }),
			history(),
			keymap({
				'Mod-z': undo,
				'Mod-y': redo,
				'Shift-Mod-z': redo,
				'Enter': splitOnEnter,
				'Shift-Enter': softBreak,
				'Backspace': backspace
			}),
			keymap(baseKeymap),
			tableEditing()
		]
	});
	const view = new EditorView(parent, {
		state,
		attributes: {
			class: 'chat-composer-editor',
			role: 'textbox',
			'aria-multiline': 'true',
			'aria-label': 'Markdown メッセージ本文',
			spellcheck: 'true'
		},
		handleDOMEvents: {
			click(editor, event) {
				const target = event.target;
				if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox' ||
					!target.closest('li[data-task-status]')) { return false; }
				const position = editor.posAtDOM(target, 0);
				const resolved = editor.state.doc.resolve(position);
				for (let depth = resolved.depth; depth > 0; depth--) {
					const node = resolved.node(depth);
					if (node.type.name !== 'list_item' || !node.attrs.taskStatus) { continue; }
					event.preventDefault();
					editor.dispatch(editor.state.tr.setNodeMarkup(resolved.before(depth), undefined, {
						...node.attrs, checked: !node.attrs.checked
					}));
					return true;
				}
				return false;
			}
		},
		handlePaste(editor, event) {
			const text = event.clipboardData?.getData('text/plain');
			if (!text) { return false; }
			try {
				const pasted = composerParser.parse(text);
				editor.dispatch(editor.state.tr.replaceSelection(pasted.slice(0, pasted.content.size)).scrollIntoView());
				event.preventDefault();
				return true;
			} catch (error) {
				onError(error instanceof Error ? error.message : '貼り付けた Markdown を読み込めません。');
				return true;
			}
		},
		dispatchTransaction(transaction) {
			const next = view.state.apply(transaction);
			view.updateState(next);
			if (!transaction.docChanged) { return; }
			try {
				onChange(serializeComposerDocument(next.doc));
			} catch (error) {
				onError(error instanceof Error ? error.message : '入力内容を Markdown に変換できません。');
			}
		}
	});
	return { view, destroy: () => view.destroy() };
}

export { composerSchema, composerParser, composerSerializer };
