import * as assert from 'assert';
import { EditorState, TextSelection } from 'prosemirror-state';
import { history, redo, undo } from 'prosemirror-history';
import { backspace, softBreak, splitOnEnter } from '../webview/chatComposerCommands';
import { composerSchema, parseComposerMarkdown, serializeComposerDocument } from '../webview/chatComposerModel';

function stateWith(markdown: string, position?: number): EditorState {
	const doc = parseComposerMarkdown(markdown);
	return EditorState.create({
		schema: composerSchema,
		doc,
		selection: position === undefined ? TextSelection.atEnd(doc) : TextSelection.create(doc, position)
	});
}

function apply(state: EditorState, command: typeof splitOnEnter): EditorState {
	let transaction: import('prosemirror-state').Transaction | undefined;
	assert.strictEqual(command(state, next => { transaction = next; }), true);
	assert.ok(transaction);
	return state.apply(transaction);
}

function textblockStart(state: EditorState, type: string): number {
	let found: number | undefined;
	state.doc.descendants((node, position) => {
		if (found === undefined && node.type.name === type) { found = position + 1; }
	});
	assert.notStrictEqual(found, undefined, `expected ${type} in document`);
	return found!;
}

suite('Chat composer Markdown model', () => {
	test('round-trips headings, emphasis, lists, callouts, code, statuses, and tables', () => {
		const source = [
			'# Heading',
			'',
			'**strong** and *emphasis*',
			'',
			'- [ ] open',
			'- [x] done',
			'- [i] important',
			'- [!] warn',
			'- [n] note',
			'- [-] skip',
			'',
			'> [!INFO]',
			'> details',
			'',
			'> [!WARN]',
			'> caution',
			'',
			'```ts',
			'const value = 1;',
			'```',
			'',
			'| Name | Value |',
			'| --- | --- |',
			'| item | one |',
			'| **bold** | escaped\\|pipe |'
		].join('\n');
		const serialized = serializeComposerDocument(parseComposerMarkdown(source));
		assert.match(serialized, /# Heading/);
		assert.match(serialized, /\*\*strong\*\*/);
		assert.match(serialized, /- \[ \] open/);
		assert.match(serialized, /- \[x\] done/);
		assert.match(serialized, /- \[i\] important/);
		assert.match(serialized, /- \[!\] warn/);
		assert.match(serialized, /- \[n\] note/);
		assert.match(serialized, /- \[-\] skip/);
		assert.match(serialized, /> \[!INFO\]/);
		assert.match(serialized, /> \[!WARN\]/);
		assert.match(serialized, /const value = 1;/);
		assert.match(serialized, /\| Name \| Value \|/);
		assert.match(serialized, /\| item \| one \|/);
		assert.match(serialized, /\| \*\*bold\*\* \| escaped\\\|pipe \|/);
	});

	test('converts links and image references to inert text', () => {
		const document = parseComposerMarkdown('[unsafe](command:workbench.action.closeWindow) ![remote](https://example.invalid/a.png)');
		const serialized = serializeComposerDocument(document);
		assert.match(serialized, /unsafe/);
		assert.match(serialized, /remote/);
		assert.doesNotMatch(serialized, /command:|https:/);
	});

	test('handles pasted Markdown through the same inert, schema-backed parser', () => {
		const pasted = '# heading\n\n- [ ] task\n\n> [!WARN]\n> caution';
		const serialized = serializeComposerDocument(parseComposerMarkdown(pasted));
		assert.match(serialized, /# heading/);
		assert.match(serialized, /- \[ \] task/);
		assert.match(serialized, /> \[!WARN\]/);
		assert.match(serialized, /> caution$/);
	});

	test('Enter exits headings, continues tasks unchecked, and Shift+Enter stays in the block', () => {
		const heading = apply(stateWith('# heading'), splitOnEnter);
		assert.deepStrictEqual(heading.doc.content.content.map(node => node.type.name), ['heading', 'paragraph']);

		const taskState = stateWith('- [x] done');
		const task = apply(taskState, splitOnEnter);
		assert.match(serializeComposerDocument(task.doc), /- \[x\] done\n- \[ \]/);

		const calloutState = stateWith('> [!INFO]\n> body');
		const broken = apply(calloutState, softBreak);
		let hasHardBreak = false;
		broken.doc.descendants(node => { hasHardBreak ||= node.type.name === 'hard_break'; });
		assert.strictEqual(hasHardBreak, true);
	});

	test('Backspace removes heading and task status formatting at block start', () => {
		const headingState = stateWith('# heading', textblockStart(stateWith('# heading'), 'heading'));
		assert.match(serializeComposerDocument(apply(headingState, backspace).doc), /^heading$/);

		const taskState = stateWith('- [i] important');
		const unformatted = serializeComposerDocument(apply(
			stateWith('- [i] important', textblockStart(taskState, 'paragraph')), backspace
		).doc);
		assert.doesNotMatch(unformatted, /\[i\]/);
		assert.match(unformatted, /important/);
	});

	test('replaces a selected range, deletes all content, and supports undo and redo', () => {
		const initial = parseComposerMarkdown('before **selected** after');
		let selectedText = '';
		initial.descendants(node => {
			if (node.isText && node.text?.includes('selected')) { selectedText = node.text; }
		});
		assert.strictEqual(selectedText, 'selected');
		let textPosition: number | undefined;
		initial.descendants((node, position) => {
			if (node.isText && node.text?.includes(selectedText)) { textPosition = position; }
		});
		assert.notStrictEqual(textPosition, undefined);
		const state = EditorState.create({
			schema: composerSchema,
			doc: initial,
			selection: TextSelection.create(initial, textPosition!, textPosition! + selectedText.length),
			plugins: [history()]
		});
		const replace = state.tr.insertText('replacement');
		const replaced = state.apply(replace);
		assert.match(serializeComposerDocument(replaced.doc), /before \*\*replacement\*\* after/);

		let undoTransaction: import('prosemirror-state').Transaction | undefined;
		assert.strictEqual(undo(replaced, transaction => { undoTransaction = transaction; }), true);
		assert.ok(undoTransaction);
		const undone = replaced.apply(undoTransaction!);
		assert.match(serializeComposerDocument(undone.doc), /before \*\*selected\*\* after/);

		let redoTransaction: import('prosemirror-state').Transaction | undefined;
		assert.strictEqual(redo(undone, transaction => { redoTransaction = transaction; }), true);
		assert.ok(redoTransaction);
		const redone = undone.apply(redoTransaction!);
		assert.match(serializeComposerDocument(redone.doc), /before \*\*replacement\*\* after/);

		const all = stateWith('**delete everything**');
		const paragraph = all.doc.firstChild;
		assert.ok(paragraph);
		const selection = TextSelection.create(all.doc, 1, all.doc.content.size - 1);
		const emptied = all.apply(all.tr.setSelection(selection).deleteSelection());
		assert.strictEqual(serializeComposerDocument(emptied.doc), '');
	});

	test('handles 100 successive schema-backed edit and serialization operations', () => {
		let state = stateWith('');
		for (let index = 0; index < 100; index++) {
			const position = state.selection.from;
			state = state.apply(state.tr.insertText('x', position));
			const serialized = serializeComposerDocument(state.doc);
			assert.strictEqual(serialized.length, index + 1);
		}
		assert.strictEqual(serializeComposerDocument(state.doc), 'x'.repeat(100));
	});
});
