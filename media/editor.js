(() => {
	'use strict';
	const vscode = acquireVsCodeApi();
	const note = document.getElementById('note');
	const status = document.getElementById('status');
	const recovery = document.getElementById('recovery');
	const pending = document.getElementById('pending');
	const maxLength = 65536;
	let snapshot;
	let dirty;
	let inFlight;
	let composing = false;
	let conflicted = false;
	let reloadRequested = false;
	let readonlyReason;
	let requestId = 0;
	let timer;
	const restored = vscode.getState();
	let recovered = typeof restored?.pending === 'string';
	if (recovered) {
		pending.value = restored.pending.slice(0, maxLength);
		recovery.hidden = false;
	}

	function message(text, warning = false) {
		status.textContent = text;
		status.classList.toggle('warning', warning);
	}
	function savedMessage() {
		if (readonlyReason) { message(readonlyReason, true); return; }
		message(snapshot?.isDirty
			? '本文に反映しました。既存の未保存変更は生 Markdown で確認して保存してください。'
			: '保存済み。', Boolean(snapshot?.isDirty));
	}
	function persist(text) {
		vscode.setState(text === null ? {} : { pending: text });
		vscode.postMessage({ kind: 'pending', text });
	}
	function preserve() {
		if (dirty) {
			pending.value = dirty.element.textContent.slice(0, maxLength);
			persist(pending.value);
			recovery.hidden = false;
		}
	}
	function conflict(text) {
		conflicted = true;
		clearTimeout(timer);
		preserve();
		message(text, true);
	}
	function renderNodes(nodes) {
		const allowed = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'strong',
			'em', 's', 'span', 'pre', 'code', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br', 'hr']);
		function copy(node) {
			if (typeof node.text === 'string') { return document.createTextNode(node.text); }
			if (!allowed.has(node.tag)) {
				return document.createTextNode('');
			}
			const element = document.createElement(node.tag);
			if (node.tag === 'span') {
				const id = node.blockId;
				if (/^\d+:\d+$/.test(id || '')) {
					element.className = 'editable';
					element.dataset.blockId = id;
					element.setAttribute('contenteditable', 'plaintext-only');
					element.setAttribute('role', 'textbox');
					element.setAttribute('aria-label', '本文を編集');
					element.setAttribute('tabindex', '0');
					element.setAttribute('spellcheck', 'false');
				} else if (['link', 'image'].includes(node.className)) {
					element.className = node.className;
				}
			}
			if (node.tag === 'ol' && /^\d+$/.test(node.start || '')) {
				element.setAttribute('start', node.start);
			}
			for (const child of node.children || []) { element.appendChild(copy(child)); }
			return element;
		}
		note.replaceChildren(...nodes.map(copy));
	}
	function applySnapshot(next) {
		snapshot = next;
		renderNodes(next.nodes);
		if (recovered) {
			message('前の未保存入力を復元しました。コピーして保管してください。', true);
		} else {
			savedMessage();
		}
	}
	function matchesAcknowledgement(next, saved) {
		if (next.spans.length !== snapshot.spans.length) { return false; }
		const leaves = Array.from(note.querySelectorAll('[data-block-id]'));
		if (leaves.length !== next.spans.length) { return false; }
		for (let index = 0; index < next.spans.length; index++) {
			const span = next.spans[index];
			const previous = snapshot.spans[index];
			if (span.id !== previous.id || span.kind !== previous.kind) { return false; }
			const element = leaves.find(leaf => leaf.dataset.blockId === span.id);
			if (!element || (span.id === dirty.id ? span.text !== saved : element.textContent !== span.text)) {
				return false;
			}
		}
		const normalize = node => ({
			...node,
			children: node.blockId === dirty.id ? [{ text: '' }] : node.children?.map(normalize)
		});
		return JSON.stringify(snapshot.nodes.map(normalize)) === JSON.stringify(next.nodes.map(normalize));
	}
	function commit() {
		clearTimeout(timer);
		if (!dirty || inFlight || composing || conflicted) { return; }
		const text = dirty.element.textContent;
		if (text === dirty.before) {
			dirty = undefined;
			persist(null);
			savedMessage();
			return;
		}
		if (text.length > maxLength) {
			conflict('入力が長すぎます。生 Markdown を使用してください。');
			return;
		}
		inFlight = { id: ++requestId, text };
		vscode.postMessage({
			kind: 'edit', requestId, version: snapshot.version,
			blockId: dirty.id, before: dirty.before, text
		});
		message('保存中…');
	}
	function input(element) {
		if (!snapshot || !element || !element.matches('.editable')) { return; }
		if (dirty && dirty.element !== element) {
			commit();
			dirty.element.focus();
			message('前の本文を保存してから、次の本文を編集してください。', true);
			return;
		}
		if (!dirty) {
			const span = snapshot.spans.find(item => item.id === element.dataset.blockId);
			if (!span) { return; }
			dirty = { id: span.id, before: span.text, element };
		}
		persist(element.textContent.slice(0, maxLength));
		if (conflicted) { preserve(); return; }
		message('未保存の入力があります。');
		clearTimeout(timer);
		timer = setTimeout(commit, 450);
	}
	note.addEventListener('beforeinput', event => {
		const element = event.target.closest('.editable');
		if (!element) { event.preventDefault(); return; }
		const selection = window.getSelection();
		if (selection.rangeCount && (!element.contains(selection.anchorNode) || !element.contains(selection.focusNode))) {
			event.preventDefault();
			message('一度に一つの本文だけ編集できます。構造の編集には生 Markdown を使用してください。', true);
			return;
		}
		if (recovered) {
			event.preventDefault();
			message('復元した入力をコピーしてから、破棄して再読み込みしてください。', true);
			return;
		}
		if (dirty && dirty.element !== element) {
			event.preventDefault();
			commit();
			dirty.element.focus();
			return;
		}
		if (['insertFromDrop', 'historyUndo', 'historyRedo'].includes(event.inputType)) {
			event.preventDefault();
			if (event.inputType.startsWith('history')) {
				history(event.inputType === 'historyUndo' ? 'undo' : 'redo');
			} else {
				message('ドロップ編集には「生 Markdown を表示」を使用してください。', true);
			}
		} else if (element.textContent.length + (event.data?.length || 0) > maxLength) {
			event.preventDefault();
			message('入力が長すぎます。生 Markdown を使用してください。', true);
		}
	});
	note.addEventListener('input', event => input(event.target.closest('.editable')));
	note.addEventListener('compositionstart', () => { composing = true; clearTimeout(timer); });
	note.addEventListener('compositionend', event => {
		composing = false;
		input(event.target.closest('.editable'));
	});
	note.addEventListener('focusout', () => { if (!composing) { commit(); } });
	note.addEventListener('paste', event => {
		event.preventDefault();
		const element = event.target.closest('.editable');
		const text = event.clipboardData.getData('text/plain');
		if (!element || recovered || (dirty && dirty.element !== element)) { return; }
		if (element.textContent.length + text.length > maxLength) {
			message('入力が長すぎます。生 Markdown を使用してください。', true);
			return;
		}
		const selection = window.getSelection();
		if (!selection.rangeCount || !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) { return; }
		const range = selection.getRangeAt(0);
		range.deleteContents();
		const inserted = document.createTextNode(text);
		range.insertNode(inserted);
		range.setStartAfter(inserted);
		range.collapse(true);
		selection.removeAllRanges();
		selection.addRange(range);
		input(element);
	});
	function history(kind) {
		if (dirty || inFlight || composing || conflicted) {
			commit();
			message('保存完了後にもう一度、元に戻す／やり直しを実行してください。', true);
			return;
		}
		vscode.postMessage({ kind });
	}
	document.addEventListener('keydown', event => {
		if (!(event.ctrlKey || event.metaKey) || event.altKey) { return; }
		const key = event.key.toLowerCase();
		if (key === 's') {
			event.preventDefault();
			commit();
		} else if (key === 'z' || key === 'y') {
			event.preventDefault();
			history(key === 'y' || event.shiftKey ? 'redo' : 'undo');
		}
	});
	document.getElementById('source').addEventListener('click', () => {
		if (dirty || inFlight || composing || recovered) {
			commit();
			preserve();
			message('未保存の入力を保持しています。保存を待つか入力をコピーしてください。', true);
		}
		vscode.postMessage({ kind: 'showSource' });
	});
	document.getElementById('reload').addEventListener('click', () => {
		if (dirty || inFlight || composing) {
			preserve();
			message('未保存の入力があります。コピーするか、明示的に破棄してください。', true);
		} else {
			conflicted = false;
			reloadRequested = true;
			vscode.postMessage({ kind: 'reload' });
		}
	});
	document.getElementById('discard').addEventListener('click', () => {
		if (inFlight || composing) {
			message('保存または文字変換が終わるまでお待ちください。', true);
			return;
		}
		dirty = undefined;
		conflicted = false;
		recovered = false;
		recovery.hidden = true;
		pending.value = '';
		persist(null);
		reloadRequested = true;
		vscode.postMessage({ kind: 'reload' });
	});
	window.addEventListener('message', event => {
		const next = event.data;
		if (next.kind === 'recovery' && typeof next.text === 'string' && !dirty) {
			recovered = true;
			pending.value = next.text.slice(0, maxLength);
			recovery.hidden = false;
			vscode.setState({ pending: pending.value });
			message('前の未保存入力を復元しました。コピーして保管してください。', true);
		} else if (next.kind === 'notice') {
			readonlyReason = next.message;
			message(next.message, true);
		} else if (next.kind === 'snapshot') {
			if (dirty || inFlight || composing) {
				if (snapshot && next.version !== snapshot.version) {
					conflict('別の操作で内容が変わりました。入力を保持しています。コピーしてから再読み込みしてください。');
				}
				return;
			}
			// Keep the focused leaf and caret when an unchanged snapshot arrives.
			if (snapshot && snapshot.version === next.version && !reloadRequested) {
				snapshot = next;
				if (!recovered) { savedMessage(); }
				return;
			}
			reloadRequested = false;
			applySnapshot(next);
		} else if (next.kind === 'ack' && inFlight && next.requestId === inFlight.id) {
			const saved = inFlight.text;
			inFlight = undefined;
			if (conflicted) { return; }
			if (!matchesAcknowledgement(next, saved)) {
				conflict('保存中に表示対象が変更されました。入力を保持しています。コピーしてから再読み込みしてください。');
				return;
			}
			snapshot = next;
			dirty.before = saved;
			if (dirty.element.textContent !== saved || composing) {
				if (!composing) { timer = setTimeout(commit, 450); }
				return;
			}
			const focused = note.contains(document.activeElement);
			dirty = undefined;
			recovery.hidden = true;
			pending.value = '';
			persist(null);
			if (!focused) { applySnapshot(next); }
			savedMessage();
		} else if (next.kind === 'conflict' && inFlight && next.requestId === inFlight.id) {
			inFlight = undefined;
			conflict(next.message);
		}
	});
	vscode.postMessage({ kind: 'ready' });
})();
