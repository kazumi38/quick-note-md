import { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import { wrapInList } from 'prosemirror-schema-list';
import { createChatComposer } from './chatComposer';
import { composerSchema } from './chatComposerModel';

export interface IssueComposer {
	destroy(): void;
}

function button(toolbar: HTMLElement, view: EditorView, label: string, action: (view: EditorView) => void): void {
	const control = document.createElement('button');
	control.type = 'button';
	const symbols: Record<string, string> = {
		'太字': 'B', '斜体': 'I', '引用': '❞', 'コード': '</>', 'リンク': '↗',
		'箇条書き': '☷', '番号付きリスト': '1.', 'チェックリスト': '☑',
		'元に戻す': '↶', 'やり直す': '↷',
	};
	control.textContent = symbols[label] ?? label;
	control.className = 'issue-tool';
	control.dataset.command = label;
	control.title = label;
	control.setAttribute('aria-label', label);
	control.addEventListener('mousedown', event => event.preventDefault());
	control.addEventListener('click', () => {
		action(view);
		view.focus();
	});
	toolbar.append(control);
}

function separator(toolbar: HTMLElement): void {
	const divider = document.createElement('span');
	divider.setAttribute('role', 'separator');
	divider.setAttribute('aria-orientation', 'vertical');
	toolbar.append(divider);
}

function applyMark(view: EditorView, markName: 'strong' | 'em' | 'code' | 'link', placeholder: string, attrs?: Record<string, string>): void {
	const mark = composerSchema.marks[markName];
	if (!mark) { return; }
	if (!view.state.selection.empty) {
		toggleMark(mark, attrs)(view.state, transaction => view.dispatch(transaction));
		return;
	}
	const position = view.state.selection.from;
	const transaction = view.state.tr.insert(position, composerSchema.text(placeholder, [mark.create(attrs)]));
	transaction.setSelection(TextSelection.create(transaction.doc, position, position + placeholder.length));
	view.dispatch(transaction.scrollIntoView());
}

function listCommand(view: EditorView, ordered: boolean, checklist: boolean): void {
	const listType = ordered ? composerSchema.nodes.ordered_list : composerSchema.nodes.bullet_list;
	const command = wrapInList(listType);
	if (!checklist) {
		command(view.state, transaction => view.dispatch(transaction));
		return;
	}
	command(view.state, transaction => {
		const { from, to } = transaction.selection;
		const selectedItems: number[] = [];
		transaction.doc.descendants((node, pos) => {
			if (node.type.name !== 'list_item') { return; }
			const end = pos + node.nodeSize;
			if (from === to ? pos <= from && from <= end : end > from && pos < to) {
				selectedItems.push(pos);
			}
		});
		for (const pos of selectedItems) {
			const node = transaction.doc.nodeAt(pos);
			if (node) { transaction.setNodeMarkup(pos, undefined, { ...node.attrs, taskStatus: 'open', checked: false }); }
		}
		view.dispatch(transaction);
	});
}

export function createIssueComposer(
	parent: HTMLElement,
	toolbar: HTMLElement,
	initialMarkdown: string,
	ariaLabel: string,
	onChange: (markdown: string) => void,
	onError: (message: string) => void,
): IssueComposer {
	parent.classList.add('issue-composer-root');
	const composer = createChatComposer(parent, initialMarkdown, onChange, onError);
	const view = composer.view;
	view.dom.setAttribute('aria-label', ariaLabel);

	const heading = document.createElement('select');
	heading.className = 'issue-tool';
	heading.setAttribute('aria-label', '見出しレベル');
	heading.title = '見出しレベル';
	heading.append(new Option('H', ''));
	for (let level = 1; level <= 6; level++) { heading.append(new Option(`見出し ${level}`, String(level))); }
	heading.addEventListener('change', () => {
		const level = Number(heading.value);
		if (level) { setBlockType(composerSchema.nodes.heading, { level })(view.state, transaction => view.dispatch(transaction)); }
		view.focus();
		heading.value = '';
	});
	toolbar.append(heading);
	button(toolbar, view, '太字', editor => applyMark(editor, 'strong', '太字'));
	button(toolbar, view, '斜体', editor => applyMark(editor, 'em', '斜体'));
	button(toolbar, view, '引用', editor => wrapIn(composerSchema.nodes.blockquote)(editor.state, transaction => editor.dispatch(transaction)));
	button(toolbar, view, 'コード', editor => {
		const selectionText = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n');
		if (selectionText.includes('\n')) {
			setBlockType(composerSchema.nodes.code_block)(editor.state, transaction => editor.dispatch(transaction));
		} else {
			applyMark(editor, 'code', 'コード');
		}
	});
	button(toolbar, view, 'リンク', editor => applyMark(editor, 'link', 'リンクテキスト', { href: 'https://' }));
	separator(toolbar);
	button(toolbar, view, '箇条書き', editor => listCommand(editor, false, false));
	button(toolbar, view, '番号付きリスト', editor => listCommand(editor, true, false));
	button(toolbar, view, 'チェックリスト', editor => listCommand(editor, false, true));
	separator(toolbar);
	button(toolbar, view, '元に戻す', editor => { undo(editor.state, transaction => editor.dispatch(transaction)); });
	button(toolbar, view, 'やり直す', editor => { redo(editor.state, transaction => editor.dispatch(transaction)); });

	return { destroy: composer.destroy };
}

declare global {
	interface Window {
		quickNoteIssueComposer: {
			create(
				parent: HTMLElement, toolbar: HTMLElement, initialMarkdown: string, ariaLabel: string,
				onChange: (markdown: string) => void, onError: (message: string) => void
			): IssueComposer;
		};
	}
}

window.quickNoteIssueComposer = {
	create: (parent, toolbar, initialMarkdown, ariaLabel, onChange, onError) =>
		createIssueComposer(parent, toolbar, initialMarkdown, ariaLabel, onChange, onError),
};
