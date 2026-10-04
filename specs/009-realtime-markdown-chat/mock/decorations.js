'use strict';

const messageStatuses = {
  ' ': ['未完了', 'open'],
  x: ['完了', 'done'], X: ['完了', 'done'],
  n: ['Note（参考）', 'note'], '-': ['Skip（対応不要）', 'skip'],
  '!': ['WARN（注意）', 'warn'], i: ['IMP（重要）', 'important']
};

function decorateMarkdown(root) {
  for (const item of root.querySelectorAll('li')) {
    const paragraph = item.firstElementChild?.tagName === 'P' ? item.firstElementChild : item;
    const text = paragraph.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) { continue; }
    const match = /^\[([ xXn!i-])\](?:[ \t]+|$)/.exec(text.data);
    if (!match) { continue; }
    const marker = match[1];
    const [label, kind] = messageStatuses[marker];
    text.deleteData(0, match[0].length);
    item.dataset.statusMarker = marker;
    item.classList.add('status-item');
    const badge = document.createElement('span');
    badge.contentEditable = 'false';
    badge.className = `status-badge status-${kind}`;
    badge.dataset.decoration = 'status';
    if (kind === 'open' || kind === 'done') {
      badge.textContent = kind === 'done' ? '☑' : '☐';
      badge.setAttribute('role', 'checkbox');
      badge.setAttribute('aria-checked', String(kind === 'done'));
      badge.setAttribute('aria-label', label);
      badge.title = label;
    } else {
      badge.textContent = label;
    }
    paragraph.insertBefore(badge, text);
  }
  for (const quote of root.querySelectorAll('blockquote')) {
    const paragraph = quote.firstElementChild;
    const text = paragraph?.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) { continue; }
    const match = /^\[!(INFO|WARN|WARNING|NOTE|IMPORTANT|TIP|CAUTION)\][ \t]*(?:\n|$|(?=\uE000))/i.exec(text.data);
    if (!match) { continue; }
    const type = match[1].toUpperCase();
    text.deleteData(0, match[0].length);
    quote.dataset.callout = type;
    quote.classList.add('callout');
    quote.classList.add(['WARN', 'WARNING', 'CAUTION'].includes(type) ? 'callout-warn' : 'callout-info');
    const title = document.createElement('span');
    title.className = 'callout-label';
    title.dataset.decoration = 'callout';
    title.contentEditable = 'false';
    title.textContent = type;
    quote.insertBefore(title, paragraph);
  }
}
