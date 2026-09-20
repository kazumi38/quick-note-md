import MarkdownIt = require('markdown-it');

export interface EditableSpan {
	id: string;
	start: number;
	end: number;
	text: string;
	kind: string;
}

export interface RenderedNote {
	html: string;
	spans: EditableSpan[];
	nodes: RenderedNode[];
}

export interface RenderedNode {
	tag?: string;
	text?: string;
	children?: RenderedNode[];
	blockId?: string;
	className?: string;
	start?: string;
}

export const maxEditLength = 65536;
const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });
const statuses: Record<string, string> = {
	' ': '未完了', x: '完了', X: '完了', n: 'Note（参考）', '-': 'Skip（対応不要）',
	'!': 'Warn（注意）', i: 'IMP（重要）'
};

export function escapeHtml(text: string): string {
	return markdown.utils.escapeHtml(text);
}

// Links remain readable, but cannot invoke commands or navigate the webview.
markdown.renderer.rules.link_open = () => '<span class="link">';
markdown.renderer.rules.link_close = () => '</span>';
markdown.renderer.rules.image = (tokens, index) =>
	`<span class="image">画像: ${escapeHtml(tokens[index].content)}</span>`;
markdown.renderer.rules.text = (tokens, index) => {
	const token = tokens[index];
	const span = token.meta as EditableSpan | null;
	if (!span) {
		return escapeHtml(token.content);
	}
	return `<span class="editable" contenteditable="plaintext-only" role="textbox" tabindex="0" spellcheck="false" aria-label="本文を編集" data-block-id="${span.id}">${escapeHtml(token.content)}</span>`;
};

function renderedNodes(tokens: ReturnType<typeof markdown.parse>): RenderedNode[] {
	const root: RenderedNode[] = [];
	const stack = [root];
	for (const token of tokens) {
		if (token.hidden) { continue; }
		const children = stack[stack.length - 1];
		if (token.type === 'inline') {
			children.push(...renderedNodes(token.children ?? []));
		} else if (token.type === 'text') {
			const span = token.meta as EditableSpan | null;
			children.push(span
				? { tag: 'span', blockId: span.id, children: [{ text: token.content }] }
				: { text: token.content });
		} else if (token.type === 'image') {
			children.push({ tag: 'span', className: 'image', children: [{ text: `画像: ${token.content}` }] });
		} else if (token.type === 'fence' || token.type === 'code_block') {
			children.push({ tag: 'pre', children: [{ tag: 'code', children: [{ text: token.content }] }] });
		} else if (token.type === 'code_inline') {
			children.push({ tag: 'code', children: [{ text: token.content }] });
		} else if (token.type === 'softbreak') {
			children.push({ text: '\n' });
		} else if (token.nesting === 1) {
			const node: RenderedNode = { tag: token.tag, children: [] };
			if (token.type === 'link_open') { node.tag = 'span'; node.className = 'link'; }
			const start = token.attrGet('start');
			if (token.tag === 'ol' && start) { node.start = start; }
			children.push(node);
			stack.push(node.children!);
		} else if (token.nesting === -1) {
			stack.pop();
		} else if (token.type === 'hardbreak' || token.type === 'hr') {
			children.push({ tag: token.tag });
		} else {
			children.push({ text: token.content });
		}
	}
	return root;
}

export function renderNote(source: string): RenderedNote {
	if (source === '') {
		const span: EditableSpan = { id: '0:0', start: 0, end: 0, text: '', kind: 'paragraph' };
		return {
			html: '<p><span class="editable" contenteditable="plaintext-only" role="textbox" tabindex="0" aria-label="本文を編集" data-block-id="0:0"></span></p>',
			spans: [span],
			nodes: [{ tag: 'p', children: [{ tag: 'span', blockId: span.id, children: [{ text: '' }] }] }]
		};
	}
	const tokens = markdown.parse(source, {});
	const lines = source.split('\n');
	const starts: number[] = [];
	let offset = 0;
	for (const line of lines) {
		starts.push(offset);
		offset += line.length + 1;
	}
	const spans: EditableSpan[] = [];
	const containers: string[] = [];
	const unsafeLists = new Set<number>();
	const listStack: number[] = [];
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
			if (listStack.length) {
				listStack.forEach(start => unsafeLists.add(start));
				unsafeLists.add(index);
			}
			listStack.push(index);
		} else if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
			listStack.pop();
		} else if (token.type === 'list_item_open' && token.map && token.map[1] - token.map[0] > 1) {
			// Blank separating lines are fine; continuation paragraphs are not.
			const extra = lines.slice(token.map[0] + 1, token.map[1]);
			if (extra.some(line => line.trim() !== '')) {
				listStack.forEach(start => unsafeLists.add(start));
			}
		}
	}
	listStack.length = 0;
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (token.nesting === 1) {
			containers.push(token.type);
			if (token.type.endsWith('_list_open')) {
				listStack.push(index);
			}
			continue;
		}
		if (token.nesting === -1) {
			containers.pop();
			if (token.type.endsWith('_list_close')) {
				listStack.pop();
			}
			continue;
		}
		if (token.type !== 'inline' || !token.map || token.map[1] !== token.map[0] + 1
			|| containers.some(type => !['paragraph_open', 'heading_open', 'bullet_list_open', 'ordered_list_open', 'list_item_open'].includes(type))
			|| listStack.some(start => unsafeLists.has(start))) {
			continue;
		}
		const lineNumber = token.map[0];
		const line = lines[lineNumber].replace(/\r$/, '');
		let prefix = '';
		let body = line;
		let kind = 'paragraph';
		let status: string | undefined;
		if (containers.includes('heading_open')) {
			const match = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+[ \t]*)?$/.exec(line);
			if (!match) { continue; }
			prefix = line.slice(0, line.indexOf(match[2], match[1].length));
			body = match[2];
			kind = `heading:${match[1].length}`;
		} else if (listStack.length) {
			const match = /^(?:[-+*]|\d{1,9}[.)])[ \t]+(.*)$/.exec(line);
			if (!match) { continue; }
			body = match[1];
			prefix = line.slice(0, line.length - body.length);
			kind = 'list';
			if (body.startsWith('[')) {
				const todo = /^\[([ xXn!i-])\](?:[ \t]+|$)/.exec(body);
				if (!todo) { continue; }
				status = statuses[todo[1]];
				prefix += todo[0];
				body = body.slice(todo[0].length);
				kind = `todo:${todo[1]}`;
			}
		} else if (containers.length !== 1 || /^[ \t]/.test(line)) {
			continue;
		}
		const children = markdown.parseInline(body, {})[0].children ?? [];
		let cursor = 0;
		let valid = true;
		const formatting: string[] = [];
		const candidates: EditableSpan[] = [];
		for (const child of children) {
			if (child.type === 'text') {
				if (body.slice(cursor, cursor + child.content.length) !== child.content
					|| /[*_`\\[\]<>&~|]/.test(child.content)) {
					valid = false;
					break;
				}
				if (child.content) {
					const span: EditableSpan = {
						id: `${lineNumber}:${candidates.length}`,
						start: starts[lineNumber] + prefix.length + cursor,
						end: starts[lineNumber] + prefix.length + cursor + child.content.length,
						text: child.content,
						kind: [kind, ...formatting].join('/')
					};
					child.meta = span;
					candidates.push(span);
				}
				cursor += child.content.length;
			} else if (['strong_open', 'strong_close', 'em_open', 'em_close'].includes(child.type)
				&& body.slice(cursor, cursor + child.markup.length) === child.markup) {
				cursor += child.markup.length;
				if (child.nesting === 1) {
					formatting.push(child.markup);
				} else {
					formatting.pop();
				}
			} else {
				valid = false;
				break;
			}
		}
		if (valid && cursor === body.length && candidates.length) {
			if (status) {
				children.unshift(...(markdown.parseInline(`${status} · `, {})[0].children ?? []));
			}
			token.children = children;
			spans.push(...candidates);
		}
	}
	return { html: markdown.renderer.render(tokens, markdown.options, {}), spans, nodes: renderedNodes(tokens) };
}

export function validateRenderedEdit(
	source: string, blockId: string, before: string, text: string
): EditableSpan {
	if (typeof blockId !== 'string' || typeof before !== 'string' || typeof text !== 'string'
		|| text.length > maxEditLength || before.length > maxEditLength
		|| /[\r\n\u0000-\u001f\u007f*_`\\[\]<>&~|]/.test(text)) {
		throw new Error('この入力は安全に編集できません。生 Markdown を使用してください。');
	}
	const previous = renderNote(source);
	const span = previous.spans.find(candidate => candidate.id === blockId && candidate.text === before);
	if (!span) {
		throw new Error('編集対象が変更されたか、直接編集に対応していません。再読み込みしてください。');
	}
	const next = renderNote(source.slice(0, span.start) + text + source.slice(span.end));
	const replacement = next.spans.find(candidate => candidate.id === blockId);
	if (!replacement || replacement.text !== text || replacement.kind !== span.kind
		|| next.spans.length !== previous.spans.length
		|| next.spans.some((candidate, index) => candidate.kind !== previous.spans[index].kind)) {
		throw new Error('Markdown の構造が変わる編集です。生 Markdown を使用してください。');
	}
	return span;
}
