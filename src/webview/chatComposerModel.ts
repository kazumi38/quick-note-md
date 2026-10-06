import MarkdownIt from 'markdown-it';
import { Schema } from 'prosemirror-model';
import { MarkdownParser, MarkdownSerializer, ParseSpec, defaultMarkdownParser, defaultMarkdownSerializer } from 'prosemirror-markdown';
import { tableEditing, tableNodes } from 'prosemirror-tables';

const tableSchema = tableNodes({ tableGroup: 'block', cellContent: 'block+', cellAttributes: {} });
const baseNodes = defaultMarkdownParser.schema.spec.nodes;
const listItem = baseNodes.get('list_item');
if (!listItem) { throw new Error('Markdown list item schema is unavailable.'); }

const nodes = baseNodes
	.update('blockquote', {
		...baseNodes.get('blockquote'),
		attrs: { callout: { default: null } },
		toDOM: node => ['blockquote', node.attrs.callout ? { 'data-callout': node.attrs.callout } : {}, 0]
	})
	.update('list_item', {
		...listItem,
		attrs: { taskStatus: { default: null }, checked: { default: null } },
		toDOM: node => {
			const status = node.attrs.taskStatus as string | null;
			if (!status) { return ['li', 0]; }
			const checked = Boolean(node.attrs.checked);
			const names: Record<string, string> = {
				open: '未完了', done: '完了', info: 'IMP（重要）',
				warn: 'WARN（注意）', note: 'Note（参考）', skip: 'Skip（対応不要）'
			};
			const label = status === 'open' || status === 'done'
				? ['label', { contenteditable: 'false' },
					['input', { type: 'checkbox', checked, 'aria-label': names[status] }],
					['span', { class: 'task-status' }, names[status]]]
				: ['span', { class: `task-status task-${status}`, contenteditable: 'false' }, names[status]];
			return ['li', { 'data-task-status': status }, label, ['div', { class: 'task-content' }, 0]];
		}
	});

export const composerSchema = new Schema({
	nodes: nodes.append(tableSchema),
	marks: defaultMarkdownParser.schema.spec.marks
});

const tokenizer = new MarkdownIt({ html: false, linkify: false, typographer: false });
function paragraphToken<T extends {
	type: string; tag: string; nesting: number; level: number; content: string;
	children: unknown; attrs: unknown; map: unknown; markup: string; info: string; block: boolean; hidden: boolean;
}>(reference: T, nesting: 1 | -1): T {
	const token = Object.assign(Object.create(Object.getPrototypeOf(reference)), reference);
	token.type = nesting === 1 ? 'paragraph_open' : 'paragraph_close';
	token.tag = 'p';
	token.nesting = nesting;
	token.level = reference.level + nesting;
	token.content = '';
	token.children = null;
	token.attrs = null;
	token.map = null;
	token.markup = '';
	token.info = '';
	token.block = true;
	token.hidden = false;
	return token;
}

tokenizer.core.ruler.after('inline', 'safe-markdown-input', state => {
	const tokens = state.tokens;
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		for (const child of token.children ?? []) {
			if (child.type === 'image') {
				child.type = 'text';
				child.content = child.content || child.attrGet('alt') || '画像';
				child.attrs = null;
				child.children = null;
			}
		}
		if (token.type === 'list_item_open') {
			const inline = tokens.slice(index + 1).find(candidate => candidate.type === 'inline');
			const task = inline && /^\[([ xX!in-])\](?:[ \t]+|$)/.exec(inline.content);
			if (inline && task && inline.children?.[0]?.type === 'text') {
				token.meta = { ...(token.meta ?? {}), taskStatus: task[1] };
				inline.content = inline.content.slice(task[0].length);
				inline.children[0].content = inline.children[0].content.slice(task[0].length);
			}
		}
		if (token.type === 'th_open' || token.type === 'td_open') {
			tokens.splice(index + 1, 0, paragraphToken(token, 1));
			index++;
		} else if (token.type === 'th_close' || token.type === 'td_close') {
			tokens.splice(index, 0, paragraphToken(token, -1));
			index++;
		}
	}
});

const parseRules: Record<string, ParseSpec> = {
	...defaultMarkdownParser.tokens,
	blockquote: {
		block: 'blockquote',
		getAttrs: (_token, tokens, index) => {
			const inline = tokens.slice(index + 1).find(candidate => candidate.type === 'inline');
			const callout = inline && /^\[!(INFO|WARN|WARNING|CAUTION|NOTE|IMPORTANT|TIP)\][ \t]*/i.exec(inline.content);
			if (!inline || !callout) { return null; }
			inline.content = inline.content.slice(callout[0].length);
			if (inline.content.startsWith('\r\n')) { inline.content = inline.content.slice(2); }
			else if (inline.content.startsWith('\n')) { inline.content = inline.content.slice(1); }
			const children = inline.children ?? [];
			const first = children[0];
			if (first?.type === 'text') {
				first.content = first.content.replace(/^\[!(?:INFO|WARN|WARNING|CAUTION|NOTE|IMPORTANT|TIP)\][ \t]*/i, '');
				if (!first.content) { children.shift(); }
			}
			if (children[0]?.type === 'softbreak') { children.shift(); }
			return { callout: callout[1].toLowerCase() };
		}
	},
	list_item: {
		block: 'list_item',
		getAttrs: token => {
			const marker = (token.meta as { taskStatus?: string } | null)?.taskStatus;
			if (marker === undefined) { return null; }
			return {
				taskStatus: marker === ' ' ? 'open' : marker.toLowerCase() === 'x' ? 'done'
					: marker === 'i' ? 'info' : marker === '!' ? 'warn' : marker === 'n' ? 'note' : 'skip',
				checked: marker.toLowerCase() === 'x'
			};
		}
	},
	table: { block: 'table' },
	thead: { ignore: true },
	tbody: { ignore: true },
	tr: { block: 'table_row' },
	th: { block: 'table_header' },
	td: { block: 'table_cell' },
	link: { ignore: true }
};

export const composerParser = new MarkdownParser(composerSchema, tokenizer, parseRules);

const serializerNodes = {
	...defaultMarkdownSerializer.nodes,
	bullet_list(state: Parameters<typeof defaultMarkdownSerializer.nodes.paragraph>[0], node: Parameters<typeof defaultMarkdownSerializer.nodes.paragraph>[1]) {
		state.renderList(node, '  ', () => '- ');
	},
	blockquote(state: Parameters<typeof defaultMarkdownSerializer.nodes.blockquote>[0], node: Parameters<typeof defaultMarkdownSerializer.nodes.blockquote>[1]) {
		const callout = node.attrs.callout as string | null;
		state.wrapBlock('> ', null, node, () => {
			if (callout) { state.write(`[!${callout.toUpperCase()}]\n`); }
			state.renderContent(node);
		});
	},
	list_item(state: Parameters<typeof defaultMarkdownSerializer.nodes.list_item>[0], node: Parameters<typeof defaultMarkdownSerializer.nodes.list_item>[1]) {
		const markers: Record<string, string> = {
			open: '[ ]', done: '[x]', info: '[i]', warn: '[!]', note: '[n]', skip: '[-]'
		};
		const status = node.attrs.taskStatus as string | null;
		if (status) { state.write(`${markers[status]} `); }
		state.renderContent(node);
	},
	table(state: Parameters<typeof defaultMarkdownSerializer.nodes.paragraph>[0], node: Parameters<typeof defaultMarkdownSerializer.nodes.paragraph>[1]) {
		const rows: string[] = [];
		node.forEach(row => {
			const cells: string[] = [];
			row.forEach(cell => cells.push(
				serializeComposerDocument(cell).replace(/\r?\n/g, '<br>').replace(/(?<!\\)\|/g, '\\|')
			));
			rows.push(`| ${cells.join(' | ')} |`);
		});
		if (!rows.length) { throw new Error('空の Markdown 表を直列化できません。'); }
		state.write(rows[0]);
		state.ensureNewLine();
		const width = node.firstChild?.childCount ?? 0;
		state.write(`| ${Array.from({ length: width }, () => '---').join(' | ')} |`);
		state.ensureNewLine();
		for (const row of rows.slice(1)) {
			state.write(row);
			state.ensureNewLine();
		}
		state.closeBlock(node);
	}
};

export const composerSerializer = new MarkdownSerializer(serializerNodes, defaultMarkdownSerializer.marks);

export function parseComposerMarkdown(markdown: string) {
	return composerParser.parse(markdown);
}

export function serializeComposerDocument(document: Parameters<typeof composerSerializer.serialize>[0]): string {
	return composerSerializer.serialize(document);
}

export { tableEditing };
