'use strict';

// This mock serializer demonstrates inline editing, not a production lossless Markdown codec.
class InlineEditor {
  constructor(root, state, renderer, changed) {
    this.root = root;
    this.state = state;
    this.renderer = renderer;
    this.changed = changed;
    this.source = '';
    this.version = 0;
    this.composing = false;
    this.undo = [];
    this.redo = [];
    this.markers = ['\uE000caret-start\uE001', '\uE000caret-end\uE001'];
    root.addEventListener('input', () => this.input());
    root.addEventListener('compositionstart', () => {
      this.composing = true;
      ++this.version;
    });
    root.addEventListener('compositionend', () => {
      this.composing = false;
      this.input();
    });
    root.addEventListener('paste', event => {
      event.preventDefault();
      const selection = window.getSelection();
      if (!selection.rangeCount || !root.contains(selection.anchorNode)) { return; }
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const text = document.createTextNode(event.clipboardData.getData('text/plain'));
      range.insertNode(text);
      range.setStartAfter(text);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      this.input();
    });
    const history = redo => {
      const from = redo ? this.redo : this.undo;
      const to = redo ? this.undo : this.redo;
      if (!from.length) { return; }
      to.push(this.source);
      this.source = from.pop();
      this.changed(this.source);
      void this.draw(this.source, true);
    };
    root.addEventListener('beforeinput', event => {
      if (!this.composing && event.inputType === 'deleteContentBackward' && this.backspace()) {
        event.preventDefault();
        this.input();
      }
      if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
        event.preventDefault();
        history(event.inputType === 'historyRedo');
      }
    });
    root.addEventListener('keydown', event => {
      if (this.composing || event.isComposing) { return; }
      if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        history(event.key.toLowerCase() === 'y' || event.shiftKey);
      }
    });
  }

  serialize(node) {
    if (node.nodeType === Node.TEXT_NODE) { return node.data.replace(/\u00a0/g, ' '); }
    const content = () => Array.from(node.childNodes, child => this.serialize(child)).join('');
    const tag = node.nodeName.toLowerCase();
    if (node.dataset?.decoration) { return ''; }
    if (node.dataset?.source) { return node.dataset.source; }
    if (tag === 'br') { return '\n'; }
    const formatted = delimiter => {
      const text = content();
      return this.withoutMarkers(text) ? `${delimiter}${text}${delimiter}` : text;
    };
    if (tag === 'strong' || tag === 'b') { return formatted('**'); }
    if (tag === 'em' || tag === 'i') { return formatted('*'); }
    if (tag === 's') { return formatted('~~'); }
    if (tag === 'pre') {
      const code = node.querySelector('code');
      const text = node.textContent.replace(/\n$/, '');
      const language = code?.className.match(/language-(\S+)/)?.[1] || '';
      const fence = '`'.repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), match => match[0].length + 1)));
      return `${fence}${language}\n${text}\n${fence}\n\n`;
    }
    if (tag === 'code') {
      const fence = '`'.repeat(Math.max(1, ...Array.from(node.textContent.matchAll(/`+/g), match => match[0].length + 1)));
      return `${fence} ${content()} ${fence}`;
    }
    if (tag === 'li' && node.dataset.statusMarker !== undefined) { return `[${node.dataset.statusMarker}] ${content()}`; }
    if (/^h[1-6]$/.test(tag)) { return `${'#'.repeat(Number(tag[1]))} ${content()}\n\n`; }
    if (tag === 'p' || tag === 'div' && node !== this.root && !node.classList.contains('table-scroll')) { return `${content()}\n\n`; }
    if (tag === 'ul' || tag === 'ol') {
      let index = Number(node.getAttribute('start') || 1);
      return Array.from(node.children, child => {
        const text = this.serialize(child).trimEnd();
        const marker = tag === 'ul' ? '- ' : `${index++}. `;
        return marker + text.replace(/\n/g, '\n  ');
      }).join('\n') + '\n\n';
    }
    if (tag === 'blockquote') {
      const text = content().trimEnd();
      return (node.dataset.callout ? `> [!${node.dataset.callout}]\n` : '') + text.replace(/^/gm, '> ') + '\n\n';
    }
    if (tag === 'table') {
      const rows = Array.from(node.rows, row => '| ' + Array.from(row.cells, cell => this.serialize(cell).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') + ' |');
      if (rows.length) { rows.splice(1, 0, '| ' + Array.from(node.rows[0].cells, () => '---').join(' | ') + ' |'); }
      return rows.join('\n') + '\n\n';
    }
    if (tag === 'hr') { return '---\n\n'; }
    return content();
  }

  annotated() {
    const selection = window.getSelection();
    if (!selection.rangeCount || !this.root.contains(selection.anchorNode) || !this.root.contains(selection.focusNode)) {
      return this.serialize(this.root).trimEnd();
    }
    const range = selection.getRangeAt(0);
    const clone = this.root.cloneNode(true);
    const equivalent = node => {
      const indices = [];
      while (node !== this.root) {
        indices.unshift(Array.prototype.indexOf.call(node.parentNode.childNodes, node));
        node = node.parentNode;
      }
      return indices.reduce((current, index) => current.childNodes[index], clone);
    };
    const copy = document.createRange();
    copy.setStart(equivalent(range.startContainer), range.startOffset);
    copy.setEnd(equivalent(range.endContainer), range.endOffset);
    const end = copy.cloneRange();
    end.collapse(false);
    end.insertNode(document.createTextNode(this.markers[1]));
    copy.collapse(true);
    copy.insertNode(document.createTextNode(this.markers[0]));
    const text = this.serialize(clone).trimEnd();
    // A caret at the start of raw Markdown must not hide a heading/list prefix from the parser.
    const markers = this.markers.map(marker => marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    return text
      .replace(new RegExp(`^((?:(?:${markers}))+)(#{1,6} |[-+*] |\\d+\\. )`, 'gm'), '$2$1')
      .replace(new RegExp(`^(\\s*(?:[-+*]|\\d+\\.) )((?:(?:${markers}))+)(\\[[ xXn!i-]\\] )`, 'gm'), '$1$3$2')
      .replace(new RegExp(`^(> )((?:(?:${markers}))+)(\\[![A-Za-z]+\\]\\n)`, 'gm'), '$1$3$2');
  }

  withoutMarkers(text) {
    return this.markers.reduce((result, marker) => result.replaceAll(marker, ''), text).trimEnd();
  }

  input() {
    ++this.version;
    const text = this.withoutMarkers(this.serialize(this.root));
    if (text !== this.source) {
      this.undo.push(this.source);
      this.redo.length = 0;
      this.source = text;
    }
    this.changed(text);
    if (!this.composing) { void this.draw(this.annotated()); }
  }

  backspace() {
      const selection = window.getSelection();
      if (!selection.rangeCount || !this.root.contains(selection.anchorNode) || !this.root.contains(selection.focusNode)) { return false; }
      const range = selection.getRangeAt(0);
      if (!selection.isCollapsed) {
        const before = document.createRange();
        before.selectNodeContents(this.root);
        before.setEnd(range.startContainer, range.startOffset);
        const after = document.createRange();
        after.selectNodeContents(this.root);
        after.setStart(range.endContainer, range.endOffset);
        if (before.toString() === '' && after.toString() === '') {
          this.root.replaceChildren();
          range.selectNodeContents(this.root);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          return true;
        }
        return false;
      }
      const anchor = selection.anchorNode.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode.parentElement;
      const block = anchor.closest('h1,h2,h3,h4,h5,h6,li,p,pre,blockquote');
      if (!block || !this.root.contains(block)) { return false; }
      const before = range.cloneRange();
      before.selectNodeContents(block);
      before.setEnd(range.startContainer, range.startOffset);
      const prefix = before.cloneContents();
      prefix.querySelectorAll('[data-decoration]').forEach(node => node.remove());
      if (prefix.textContent.length) { return false; }
      const caret = node => {
        const next = document.createRange();
        next.selectNodeContents(node);
        next.collapse(true);
        selection.removeAllRanges();
        selection.addRange(next);
      };
      if (/^H[1-6]$/.test(block.tagName)) {
        const paragraph = document.createElement('p');
        paragraph.append(...block.childNodes);
        block.replaceWith(paragraph);
        caret(paragraph);
        return true;
      }
      const item = block.closest('li');
      if (item) {
        if (item.dataset.statusMarker !== undefined) {
          delete item.dataset.statusMarker;
          item.querySelector('[data-decoration="status"]')?.remove();
          item.classList.remove('status-item');
          caret(item);
          return true;
        }
        const list = item.parentElement;
        const trailing = list.cloneNode(false);
        while (item.nextSibling) { trailing.append(item.nextSibling); }
        const paragraph = document.createElement('p');
        paragraph.append(...item.childNodes);
        list.after(paragraph);
        if (trailing.childNodes.length) { paragraph.after(trailing); }
        item.remove();
        if (!list.childNodes.length) { list.remove(); }
        caret(paragraph);
        return true;
      }
      const quote = block.closest('blockquote');
      if (quote && (quote.firstElementChild === block || quote.dataset.callout && block === quote.querySelector('p'))) {
        const paragraph = document.createElement('p');
        paragraph.append(...block.childNodes);
        quote.before(paragraph);
        block.remove();
        if (!quote.textContent.trim() || quote.children.length === 1 && quote.firstElementChild.dataset.decoration) { quote.remove(); }
        caret(paragraph);
        return true;
      }
      if (block.tagName === 'P' && block.parentElement === this.root) {
        const previous = block.previousElementSibling;
        if (!previous || !/^(P|H[1-6])$/.test(previous.tagName)) { return false; }
        const marker = document.createTextNode('');
        previous.append(marker, ...block.childNodes);
        block.remove();
        const next = document.createRange();
        next.setStartBefore(marker);
        next.collapse(true);
        selection.removeAllRanges();
        selection.addRange(next);
        return true;
      }
      return false;
    }
  set(text) {
    ++this.version;
    this.source = text;
    this.undo.length = 0;
    this.redo.length = 0;
    this.root.textContent = text;
    this.composing = false;
    void this.draw(text);
  }

  async draw(annotated, endCaret = false) {
    const version = ++this.version;
    this.state.textContent = '入力欄を整形中・未送信';
    try {
      const html = await this.renderer(annotated);
      if (version !== this.version || this.composing) { return; }
      if (annotated.includes(this.markers[0]) && this.annotated() !== annotated) {
        // Selection moved during the request: render the current bookmark, never the old one.
        void this.draw(this.annotated());
        return;
      }
      const fragment = document.createElement('div');
      fragment.innerHTML = html;
      for (const node of Array.from(fragment.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE && !node.data.trim()) { node.remove(); }
      }
      this.root.replaceChildren(...fragment.childNodes);
      decorateMarkdown(this.root);
      const points = [];
      for (const marker of this.markers) {
        const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const index = node.data.indexOf(marker);
          if (index < 0) { continue; }
          node.deleteData(index, marker.length);
          points.push([node, index]);
          break;
        }
      }
      if (points.length === 2 && document.activeElement === this.root) {
        for (const point of points) {
          if (point[0].data === '') {
            const parent = point[0].parentNode;
            if (!parent.querySelector('br') && parent.textContent === '') { parent.append(document.createElement('br')); }
            point[1] = Array.prototype.indexOf.call(parent.childNodes, point[0]);
            point[0] = parent;
          }
        }
        const range = document.createRange();
        range.setStart(...points[0]);
        range.setEnd(...points[1]);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      } else if (endCaret && document.activeElement === this.root) {
        const range = document.createRange();
        range.selectNodeContents(this.root);
        range.collapse(false);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
      }
      for (const table of this.root.querySelectorAll('table')) {
        const wrapper = document.createElement('div');
        wrapper.className = 'table-scroll';
        table.replaceWith(wrapper);
        wrapper.append(table);
      }
      const sourceSpans = this.root.querySelectorAll('.link, .image');
      if (sourceSpans.length) {
        this.state.textContent = 'リンク・画像を含む編集はモック対象外です。入力は保持しています。';
        this.root.textContent = this.source;
        return;
      }
      this.state.textContent = 'この入力欄で整形中・未送信';
    } catch (error) {
      if (version === this.version) { this.state.textContent = `整形失敗: ${error.message} 入力は保持しています。入力変更で再試行できます。`; }
    }
  }
}
