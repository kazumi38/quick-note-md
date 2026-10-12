import MarkdownIt = require('markdown-it');

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });

function escapeHtml(text: string): string {
	return markdown.utils.escapeHtml(text);
}

markdown.renderer.rules.link_open = () => '<span class="link">';
markdown.renderer.rules.link_close = () => '</span>';
markdown.renderer.rules.image = (tokens, index) =>
	`<span class="image">画像: ${escapeHtml(tokens[index].content)}</span>`;

export function renderSafeMarkdown(text: string): string {
	return markdown.render(text);
}
