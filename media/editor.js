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
	function preserve() {
		if (dirty) {
			pending.value = dirty.element.textContent.slice(0, maxLength);
			vscode.setState({ pending: pending.value });
			recovery.hidden = false;
		}
	}
	function conflict(text) {
		conflicted = true;
		clearTimeout(timer);
		preserve();
		message(text, true);
	}
	function applySnapshot(next) {
		snapshot = next;
		note.innerHTML = next.html;
		message(recovered ? '前の未保存入力を復元しました。コピーして保管してください。'
			: '保存済み。本文をクリック、または Tab キーで編集できます。', recovered);
	}
	function commit() {
		clearTimeout(timer);
		if (!dirty || inFlight || composing || conflicted) { return; }
		const text = dirty.element.textContent;
		if (text === dirty.before) {
			dirty = undefined;
			vscode.setState({});
			message('保存済み。');
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
		vscode.setState({ pending: element.textContent.slice(0, maxLength) });
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
		if (['insertParagraph', 'insertLineBreak', 'insertFromDrop', 'historyUndo', 'historyRedo'].includes(event.inputType)) {
			event.preventDefault();
			if (event.inputType.startsWith('history')) {
				history(event.inputType === 'historyUndo' ? 'undo' : 'redo');
			} else {
				message('改行や構造の編集には「生 Markdown を表示」を使用してください。', true);
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
		if (/[\r\n]/.test(text) || element.textContent.length + text.length > maxLength) {
			message('一行の本文のみ貼り付けできます。生 Markdown を使用してください。', true);
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
		vscode.setState({});
		vscode.postMessage({ kind: 'reload' });
	});
	window.addEventListener('message', event => {
		const next = event.data;
		if (next.kind === 'snapshot') {
			if (dirty || inFlight || composing) {
				if (snapshot && next.version !== snapshot.version) {
					conflict('別の操作で内容が変わりました。入力を保持しています。コピーしてから再読み込みしてください。');
				}
				return;
			}
			// Keep the focused leaf and caret when an unchanged snapshot arrives.
			if (snapshot && snapshot.version === next.version) { return; }
			applySnapshot(next);
		} else if (next.kind === 'ack' && inFlight && next.requestId === inFlight.id) {
			const saved = inFlight.text;
			inFlight = undefined;
			if (conflicted) { return; }
			snapshot = next;
			dirty.before = saved;
			if (dirty.element.textContent !== saved || composing) {
				if (!composing) { timer = setTimeout(commit, 450); }
				return;
			}
			const focused = document.activeElement === dirty.element;
			dirty = undefined;
			recovery.hidden = true;
			pending.value = '';
			vscode.setState({});
			if (!focused) { applySnapshot(next); }
			message('保存済み。');
		} else if (next.kind === 'conflict' && inFlight && next.requestId === inFlight.id) {
			inFlight = undefined;
			conflict(next.message);
		}
	});
	vscode.postMessage({ kind: 'ready' });
})();
