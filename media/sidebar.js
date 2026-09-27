(function () {
  const app = document.getElementById('app');
  const vscode = acquireVsCodeApi();
  const state = Object.assign({ expandedFiles: {}, expandedGroups: {}, expandedTodos: {}, editingBody: {}, editingAttrs: {}, editingReply: {} },
    vscode.getState() || {});
  const STATUS_ORDER = ['important', 'warn', 'open', 'note', 'skip', 'done', 'unknown'];
  const STATUS_LABELS = { important: 'IMP（重要）', warn: 'Warn（注意）', open: '未完了', note: 'Note（参考）', skip: 'Skip（対応不要）', done: '完了', unknown: '認識できない Todo（読み取り専用）' };
  // Values typed but not yet saved/discarded; kept outside vscode.setState so a snapshot refresh
  // triggered by an unrelated file change never wipes out what the user is mid-typing.
  const live = { body: {}, attrs: {}, reply: {}, bodyHtml: {}, replyHtml: {} };
  const timers = {};
  let snapshot = { files: [], todos: [], orphans: [], labelPalette: [] };

  function persist() { vscode.setState(state); }

  function debounce(key, delay, fn) {
    clearTimeout(timers[key]);
    timers[key] = setTimeout(fn, delay);
  }

  // Safe interim display while the host renders real Markdown; replaced by sanitized HTML from the extension.
  function escapeForPreview(text) {
    const escaped = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return escaped.split('\n').map(line => `<p>${line || '&nbsp;'}</p>`).join('');
  }

  function todosForFile(fileUri) { return snapshot.todos.filter(todo => todo.fileUri === fileUri); }
  // VS Code theme color ids contain dots (e.g. "charts.red"); CSS classes cannot, so they are
  // exposed as "color-charts-red" and matched by fixed rules in sidebar.css.
  function colorClass(color) { return `color-${String(color).replace(/\./g, '-')}`; }

  function el(tag, props, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (key === 'className') node.className = value;
      else if (key === 'innerHTML') node.innerHTML = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key === 'disabled') { if (value) node.disabled = true; }
      else if (value !== undefined && value !== null) node.setAttribute(key, value);
    }
    for (const child of children || []) {
      if (child === undefined || child === null) continue;
      if (typeof child === 'string') node.append(document.createTextNode(child));
      else node.append(child);
    }
    return node;
  }

  function render() {
    const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.focusKey : undefined;
    app.replaceChildren();
    if (snapshot.orphans.length) app.append(renderOrphans());
    if (!snapshot.files.length) {
      app.append(el('p', {}, ['管理対象の Markdown メモがまだありません。「新規メモ」コマンドから作成できます。']));
      return;
    }
    for (const file of snapshot.files) app.append(renderFile(file));
    if (focused) {
      const restored = app.querySelector(`[data-focus-key="${CSS.escape(focused)}"]`);
      if (restored) restored.focus();
    }
  }

  function renderOrphans() {
    const rows = snapshot.orphans.map(orphan => el('div', { className: 'orphan' }, [
      el('pre', {}, [orphan.text || `ラベル: ${(orphan.labels || []).join(', ')} / 対応日: ${orphan.dueDate || '未設定'}`]),
      el('button', { type: 'button', onclick: () => vscode.postMessage({ kind: 'discardOrphan', backupKey: orphan.backupKey }) }, ['破棄']),
    ]));
    return el('section', { className: 'orphans', role: 'status', 'aria-label': '未反映の下書き' }, [
      el('h2', {}, [`未反映の下書き (${snapshot.orphans.length})`]),
      el('p', {}, ['元の Todo と一致しなくなったため復元できませんでした。内容を確認し破棄してください。']),
      ...rows,
    ]);
  }

  function renderFile(file) {
    const todos = todosForFile(file.uri);
    const expanded = state.expandedFiles[file.uri] !== false;
    const toggle = el('button', {
      type: 'button', className: 'file-title', 'aria-expanded': String(expanded),
      onclick: () => { state.expandedFiles[file.uri] = !expanded; persist(); render(); },
    }, [`${file.title} (${todos.length})`]);
    const open = el('button', {
      type: 'button', className: 'file-open', 'aria-label': `${file.title} を開く`,
      onclick: () => vscode.postMessage({ kind: 'openFile', fileUri: file.uri }),
    }, ['開く']);
    const body = [];
    if (expanded) {
      for (const status of STATUS_ORDER) {
        const items = todos.filter(todo => todo.status === status);
        if (items.length) body.push(renderStatusGroup(file.uri, status, items));
      }
      if (!todos.length) body.push(el('p', { className: 'empty' }, ['このメモに Todo はありません。']));
    }
    return el('section', { className: 'file-group' }, [el('div', { className: 'file-header' }, [toggle, open]), ...body]);
  }

  function renderStatusGroup(fileUri, status, items) {
    const key = `${fileUri}::${status}`;
    const defaultExpanded = status !== 'done';
    const expanded = key in state.expandedGroups ? state.expandedGroups[key] : defaultExpanded;
    const toggle = el('button', {
      type: 'button', className: 'status-title', 'aria-expanded': String(expanded),
      onclick: () => { state.expandedGroups[key] = !expanded; persist(); render(); },
    }, [`${STATUS_LABELS[status]} (${items.length})`]);
    const list = expanded ? el('div', { role: 'list' }, items.map(todo => renderTodo(todo))) : undefined;
    return el('div', { className: 'status-group' }, [toggle, list]);
  }

  function renderTodo(todo) {
    const expanded = Boolean(state.expandedTodos[todo.id]);
    const labelText = todo.labels.length ? ` [${todo.labels.map(label => label.name).join(', ')}]` : '';
    const dueText = todo.dueDate
      ? ` 対応日:${todo.dueDate}${todo.dueState === 'overdue' ? '（期限切れ）' : todo.dueState === 'upcoming' ? '（近日）' : ''}`
      : '';
    const dirty = todo.bodyDraft || todo.attributesDraft || todo.newReplyDraft || todo.replies.some(reply => reply.draft);
    const header = el('button', {
      type: 'button', className: 'todo-title', 'aria-expanded': String(expanded),
      onclick: () => { state.expandedTodos[todo.id] = !expanded; persist(); render(); },
    }, [`${todo.title}${labelText}${dueText}${dirty ? ' ●未保存の下書きあり' : ''}`]);
    const warning = todo.warning ? el('p', { className: 'warning', role: 'alert' }, [todo.warning]) : undefined;
    return el('article', { className: 'todo' }, [header, warning, expanded ? renderDetail(todo) : undefined]);
  }

  function renderDetail(todo) {
    const actions = el('div', { className: 'todo-actions' }, [
      el('button', { type: 'button', onclick: () => vscode.postMessage({ kind: 'source', id: todo.id }) }, ['生 Markdown を表示']),
      todo.readOnly ? undefined : el('button', {
        type: 'button', className: 'danger',
        onclick: () => vscode.postMessage({ kind: 'deleteTodo', id: todo.id }),
      }, ['Todo を削除']),
    ]);
    return el('section', { className: 'todo-detail', 'aria-label': `${todo.title} の詳細` }, [
      renderAttributes(todo), renderBody(todo), renderReplies(todo), actions,
    ]);
  }

  function renderAttributes(todo) {
    const key = todo.id;
    const editing = Boolean(state.editingAttrs[key]) || Boolean(todo.attributesDraft);
    if (!editing) {
      const chips = todo.labels.map(label => el('span', { className: `label-chip ${colorClass(label.color)}` }, [label.name]));
      return el('div', { className: 'attributes' }, [
        ...chips,
        todo.dueDate ? el('span', { className: `due due-${todo.dueState}` }, [`対応日: ${todo.dueDate}`]) : undefined,
        todo.readOnly ? undefined : el('button', {
          type: 'button', onclick: () => { state.editingAttrs[key] = true; persist(); render(); },
        }, ['ラベル・対応日を編集']),
      ]);
    }
    const conflict = todo.attributesDraft && todo.attributesDraft.state === 'conflict';
    const current = live.attrs[key] || {
      labels: (todo.attributesDraft ? todo.attributesDraft.labels : todo.labels.map(label => label.name)) || [],
      dueDate: (todo.attributesDraft ? todo.attributesDraft.dueDate : todo.dueDate) || '',
    };
    live.attrs[key] = current;
    const pushDraft = () => debounce(`attrs:${key}`, 300, () =>
      vscode.postMessage({ kind: 'draftAttributes', id: todo.id, labels: current.labels, dueDate: current.dueDate || undefined }));
    const chips = current.labels.map((name, index) => el('span', { className: 'label-chip-edit' }, [
      el('span', { className: `label-chip ${colorClass(labelColorFor(name))}` }, [name]),
      el('div', { className: 'palette' }, snapshot.labelPalette.map(color => el('button', {
        type: 'button', className: `swatch ${colorClass(color)}`, 'aria-label': `${name} を ${color} にする`,
        onclick: () => vscode.postMessage({ kind: 'setLabelColor', label: name, color }),
      }, []))),
      el('button', {
        type: 'button', 'aria-label': `${name} を削除`,
        onclick: () => { current.labels = current.labels.filter((_, position) => position !== index); pushDraft(); render(); },
      }, ['×']),
    ]));
    const addInput = el('input', { type: 'text', 'aria-label': '新しいラベル名', 'data-focus-key': `attrs-add:${key}` });
    const add = el('button', {
      type: 'button',
      onclick: () => {
        const value = addInput.value.trim();
        if (value && !current.labels.includes(value)) { current.labels = [...current.labels, value]; pushDraft(); render(); }
      },
    }, ['ラベル追加']);
    const dueInput = el('input', {
      type: 'date', value: current.dueDate || '', 'aria-label': '対応日', 'data-focus-key': `attrs-due:${key}`,
      oninput: event => { current.dueDate = event.target.value; pushDraft(); },
    });
    const save = el('button', {
      type: 'button', disabled: Boolean(conflict),
      onclick: () => {
        vscode.postMessage({ kind: 'saveAttributes', id: todo.id, labels: current.labels, dueDate: current.dueDate || undefined });
        delete live.attrs[key]; state.editingAttrs[key] = false; persist();
      },
    }, ['保存']);
    const discard = el('button', {
      type: 'button',
      onclick: () => {
        vscode.postMessage({ kind: 'discardAttributes', id: todo.id });
        delete live.attrs[key]; state.editingAttrs[key] = false; persist(); render();
      },
    }, ['破棄']);
    return el('div', { className: 'attributes editing' }, [
      conflict ? el('p', { className: 'warning', role: 'alert' }, ['この Todo は外部で変更されました。下書きは復元できません。内容を確認して破棄してください。']) : undefined,
      el('div', { className: 'chips' }, chips),
      el('div', { className: 'add-label' }, [addInput, add]),
      el('label', {}, ['対応日: ', dueInput]),
      el('div', { className: 'row' }, [save, discard]),
    ]);
  }

  function labelColorFor(name) {
    for (const todo of snapshot.todos) {
      const match = todo.labels.find(label => label.name === name);
      if (match) return match.color;
    }
    return snapshot.labelPalette[0];
  }

  function renderBody(todo) {
    const key = todo.id;
    const editing = Boolean(state.editingBody[key]) || Boolean(todo.bodyDraft);
    if (!editing) {
      return el('div', { className: 'body' }, [
        todo.bodyMarkdown ? el('div', { className: 'preview', innerHTML: todo.bodyHtml }) : el('p', { className: 'empty' }, ['本文はまだありません。']),
        todo.readOnly ? undefined : el('button', {
          type: 'button', onclick: () => { state.editingBody[key] = true; persist(); render(); },
        }, ['本文を編集']),
      ]);
    }
    const conflict = todo.bodyDraft && todo.bodyDraft.state === 'conflict';
    if (live.body[key] === undefined) { live.body[key] = todo.bodyDraft ? todo.bodyDraft.text : (todo.bodyMarkdown || ''); }
    if (live.bodyHtml[key] === undefined) {
      if (todo.bodyDraft) {
        // A restored draft's text differs from the last saved bodyHtml; ask the host to render it.
        vscode.postMessage({ kind: 'draftBody', id: todo.id, text: live.body[key] });
        live.bodyHtml[key] = escapeForPreview(live.body[key]);
      } else {
        live.bodyHtml[key] = todo.bodyHtml || escapeForPreview(live.body[key]);
      }
    }
    const previewKey = `body:${key}`;
    const preview = el('div', { className: 'preview live', 'data-preview-key': previewKey, innerHTML: live.bodyHtml[key] });
    const textarea = el('textarea', {
      'aria-label': '本文（Markdown）', rows: '4', 'data-focus-key': `body:${key}`,
      oninput: event => {
        live.body[key] = event.target.value;
        preview.innerHTML = escapeForPreview(event.target.value);
        debounce(`body:${key}`, 300, () => vscode.postMessage({ kind: 'draftBody', id: todo.id, text: live.body[key] }));
      },
    }, []);
    textarea.value = live.body[key];
    const save = el('button', {
      type: 'button', disabled: Boolean(conflict),
      onclick: () => {
        vscode.postMessage({ kind: 'saveBody', id: todo.id, text: live.body[key] });
        delete live.body[key]; delete live.bodyHtml[key]; state.editingBody[key] = false; persist();
      },
    }, ['保存']);
    const discard = el('button', {
      type: 'button',
      onclick: () => {
        vscode.postMessage({ kind: 'discardBody', id: todo.id });
        delete live.body[key]; delete live.bodyHtml[key]; state.editingBody[key] = false; persist(); render();
      },
    }, ['破棄']);
    return el('div', { className: 'body editing' }, [
      conflict ? el('p', { className: 'warning', role: 'alert' }, ['この Todo は外部で変更されました。下書きは復元できません。内容を確認して破棄してください。']) : undefined,
      todo.bodyDraft ? el('p', { className: 'notice' }, ['未保存の下書きを復元しました。']) : undefined,
      textarea, el('p', { className: 'preview-label' }, ['プレビュー（保存前の Markdown 整形結果）']), preview,
      el('div', { className: 'row' }, [save, discard]),
    ]);
  }

  function renderReplies(todo) {
    const items = todo.replies.map(reply => renderReply(todo, reply));
    const newKey = `${todo.id}:new`;
    const newEditing = Boolean(state.editingReply[newKey]) || Boolean(todo.newReplyDraft);
    let addSection;
    if (todo.readOnly) {
      addSection = undefined;
    } else if (!newEditing) {
      addSection = el('button', { type: 'button', onclick: () => { state.editingReply[newKey] = true; persist(); render(); } }, ['リプライを追加']);
    } else {
      if (live.reply[newKey] === undefined) { live.reply[newKey] = todo.newReplyDraft ? todo.newReplyDraft.text : ''; }
      if (live.replyHtml[newKey] === undefined) {
        if (todo.newReplyDraft) {
          vscode.postMessage({ kind: 'draftReply', id: todo.id, text: live.reply[newKey] });
        }
        live.replyHtml[newKey] = escapeForPreview(live.reply[newKey]);
      }
      const conflict = todo.newReplyDraft && todo.newReplyDraft.state === 'conflict';
      const preview = el('div', { className: 'preview live', 'data-preview-key': `reply:${newKey}`, innerHTML: live.replyHtml[newKey] });
      const textarea = el('textarea', {
        'aria-label': '新しいリプライ（Markdown）', rows: '2', 'data-focus-key': `reply:${newKey}`,
        oninput: event => {
          live.reply[newKey] = event.target.value;
          preview.innerHTML = escapeForPreview(event.target.value);
          debounce(`reply:${newKey}`, 300, () => vscode.postMessage({ kind: 'draftReply', id: todo.id, text: live.reply[newKey] }));
        },
      }, []);
      textarea.value = live.reply[newKey];
      addSection = el('div', { className: 'reply editing' }, [
        conflict ? el('p', { className: 'warning', role: 'alert' }, ['外部変更を検出したため復元できません。']) : undefined,
        textarea, preview,
        el('div', { className: 'row' }, [
          el('button', {
            type: 'button', disabled: Boolean(conflict),
            onclick: () => {
              vscode.postMessage({ kind: 'saveReply', id: todo.id, text: live.reply[newKey] });
              delete live.reply[newKey]; delete live.replyHtml[newKey]; state.editingReply[newKey] = false; persist();
            },
          }, ['追加']),
          el('button', {
            type: 'button',
            onclick: () => {
              vscode.postMessage({ kind: 'discardReply', id: todo.id });
              delete live.reply[newKey]; delete live.replyHtml[newKey]; state.editingReply[newKey] = false; persist(); render();
            },
          }, ['破棄']),
        ]),
      ]);
    }
    return el('div', { className: 'replies', 'aria-label': 'リプライ' }, [...items, addSection]);
  }

  function renderReply(todo, reply) {
    const key = `${todo.id}:${reply.id}`;
    const editing = Boolean(state.editingReply[key]) || Boolean(reply.draft);
    if (!editing) {
      return el('div', { className: 'reply' }, [
        el('div', { className: 'preview', innerHTML: reply.html }),
        todo.readOnly ? undefined : el('div', { className: 'row' }, [
          el('button', { type: 'button', onclick: () => { state.editingReply[key] = true; persist(); render(); } }, ['編集']),
          el('button', { type: 'button', className: 'danger', onclick: () => vscode.postMessage({ kind: 'deleteReply', id: todo.id, replyId: reply.id }) }, ['削除']),
        ]),
      ]);
    }
    const conflict = reply.draft && reply.draft.state === 'conflict';
    if (live.reply[key] === undefined) { live.reply[key] = reply.draft ? reply.draft.text : reply.text; }
    if (live.replyHtml[key] === undefined) {
      if (reply.draft) {
        vscode.postMessage({ kind: 'draftReply', id: todo.id, replyId: reply.id, text: live.reply[key] });
        live.replyHtml[key] = escapeForPreview(live.reply[key]);
      } else {
        live.replyHtml[key] = reply.html || escapeForPreview(live.reply[key]);
      }
    }
    const preview = el('div', { className: 'preview live', 'data-preview-key': `reply:${key}`, innerHTML: live.replyHtml[key] });
    const textarea = el('textarea', {
      'aria-label': `リプライ ${reply.id} を編集`, rows: '2', 'data-focus-key': `reply:${key}`,
      oninput: event => {
        live.reply[key] = event.target.value;
        preview.innerHTML = escapeForPreview(event.target.value);
        debounce(`reply:${key}`, 300, () => vscode.postMessage({ kind: 'draftReply', id: todo.id, replyId: reply.id, text: live.reply[key] }));
      },
    }, []);
    textarea.value = live.reply[key];
    return el('div', { className: 'reply editing' }, [
      conflict ? el('p', { className: 'warning', role: 'alert' }, ['外部変更を検出したため復元できません。']) : undefined,
      reply.draft && !conflict ? el('p', { className: 'notice' }, ['未保存の下書きを復元しました。']) : undefined,
      textarea, preview,
      el('div', { className: 'row' }, [
        el('button', {
          type: 'button', disabled: Boolean(conflict),
          onclick: () => {
            vscode.postMessage({ kind: 'saveReply', id: todo.id, replyId: reply.id, text: live.reply[key] });
            delete live.reply[key]; delete live.replyHtml[key]; state.editingReply[key] = false; persist();
          },
        }, ['保存']),
        el('button', {
          type: 'button',
          onclick: () => {
            vscode.postMessage({ kind: 'discardReply', id: todo.id, replyId: reply.id });
            delete live.reply[key]; delete live.replyHtml[key]; state.editingReply[key] = false; persist(); render();
          },
        }, ['破棄']),
      ]),
    ]);
  }

  window.addEventListener('message', event => {
    const data = event.data;
    if (!data) return;
    if (data.kind === 'snapshot') { snapshot = data; render(); return; }
    if (data.kind === 'preview') {
      const key = `${data.id}:${data.replyId || 'new'}`;
      const previewKey = data.field === 'body' ? `body:${data.id}` : `reply:${key}`;
      if (data.field === 'body') { live.bodyHtml[data.id] = data.html; }
      else { live.replyHtml[key] = data.html; }
      const node = app.querySelector(`[data-preview-key="${CSS.escape(previewKey)}"]`);
      if (node) { node.innerHTML = data.html; }
    }
  });
  vscode.postMessage({ kind: 'ready' });
}());
