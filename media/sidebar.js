(function () {
  const app = document.getElementById('app');
  const vscode = acquireVsCodeApi();
  const state = Object.assign({ expandedFiles: {}, expandedGroups: {}, expandedTodos: {}, editingBody: {}, editingAttrs: {}, editingReply: {},
    selectedIssue: '', issueCreate: undefined, issueDrafts: {}, issueTitleEdit: undefined, issueBodyEdit: '', issueCommentEdit: undefined, issueLabelsEdit: undefined, issueMenu: '' },
    vscode.getState() || {});
  const STATUS_ORDER = ['important', 'warn', 'open', 'note', 'skip', 'done', 'unknown'];
  const STATUS_LABELS = { important: 'IMP（重要）', warn: 'Warn（注意）', open: '未完了', note: 'Note（参考）', skip: 'Skip（対応不要）', done: '完了', unknown: '認識できない Todo（読み取り専用）' };
  // Values typed but not yet saved/discarded; kept outside vscode.setState so a snapshot refresh
  // triggered by an unrelated file change never wipes out what the user is mid-typing.
  const live = { body: {}, attrs: {}, reply: {}, bodyHtml: {}, replyHtml: {} };
  const timers = {};
  const pending = {};
  let issueComposers = [];
  let snapshot = { state: 'loading', files: [], todos: [], orphans: [], labelPalette: [] };

  function persist() { vscode.setState(state); }

  function debounce(key, delay, fn) {
    clearTimeout(timers[key]);
    timers[key] = setTimeout(fn, delay);
  }

  function submitDraft(field, key, payload) {
    const timerKey = `${field === 'attributes' ? 'attrs' : field}:${key}`;
    clearTimeout(timers[timerKey]);
    delete timers[timerKey];
    if (pending[timerKey]) return;
    pending[timerKey] = true;
    vscode.postMessage(payload);
    render();
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
    for (const composer of issueComposers) composer.destroy();
    issueComposers = [];
    app.replaceChildren();
    if (Array.isArray(snapshot.issues)) {
      renderIssueView();
      return;
    }
    if (snapshot.orphans.length) app.append(renderOrphans());
    if (snapshot.state === 'loading') {
      app.append(el('p', { className: 'notice', role: 'status' }, ['メモと Todo を読み込んでいます…']));
      return;
    }
    if (snapshot.state === 'unavailable') {
      app.append(el('p', { className: 'warning', role: 'status' }, [snapshot.error || 'ワークスペース フォルダーを開いてください。']));
      return;
    }
    if (snapshot.state === 'empty') {
      app.append(el('section', { className: 'empty-state', role: 'status', 'aria-label': 'メモと Todo はありません' }, [
        el('p', {}, ['メモも Todo もまだありません。ここから作成できます。']),
        el('div', { className: 'empty-actions' }, [
          el('button', {
            type: 'button', 'aria-label': '新規メモを作成',
            onclick: () => vscode.postMessage({ kind: 'newMemo' }),
          }, ['新規メモ']),
          el('button', {
            type: 'button', 'aria-label': '新規 Todo を作成',
            onclick: () => vscode.postMessage({ kind: 'newTodo' }),
          }, ['新規 Todo']),
        ]),
      ]));
      return;
    }
    if (snapshot.state === 'error') {
      app.append(el('section', { className: 'load-error', role: 'alert' }, [
        el('p', {}, [snapshot.error || '一覧を読み込めませんでした。']),
        el('button', {
          type: 'button', 'aria-label': '一覧を更新',
          onclick: () => vscode.postMessage({ kind: 'refresh' }),
        }, ['一覧を更新']),
      ]));
      if (!snapshot.files.length) return;
    }
    for (const file of snapshot.files) app.append(renderFile(file));
    if (focused) {
      const restored = app.querySelector(`[data-focus-key="${CSS.escape(focused)}"]`);
      if (restored) restored.focus();
    }
  }

  function issueDraftKey(itemId, field, commentId) { return `${itemId}::${field}::${commentId || ''}`; }

  function openCreatePanel(itemKind) {
    state.issueCreate = state.issueCreate && state.issueCreate.kind === itemKind
      ? state.issueCreate : { kind: itemKind, title: '', body: '' };
    persist();
    render();
  }

  function submitIssue(item, field, value, commentId) {
    const requestId = `issue-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const draftKey = issueDraftKey(item ? item.id : 'create', field, commentId);
    state.issueDrafts[draftKey] = value;
    state.issuePending = requestId;
    state.issuePendingInfo = { requestId, itemId: item ? item.id : '', field, commentId, create: !item };
    state.issueError = '';
    persist();
    vscode.postMessage(item
      ? { kind: 'saveIssue', requestId, itemId: item.id, field, value, commentId }
      : { kind: 'createIssue', requestId, itemKind: state.issueCreate.kind, title: state.issueCreate.title, bodyMarkdown: state.issueCreate.body });
  }

  function deleteIssueComment(item, commentId) {
    const requestId = `issue-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    state.issuePending = requestId;
    state.issuePendingInfo = { requestId, itemId: item.id, field: 'deleteComment', commentId };
    state.issueError = '';
    persist();
    vscode.postMessage({ kind: 'deleteIssueComment', requestId, itemId: item.id, commentId });
  }

  function renderIssueView() {
    if (snapshot.state === 'loading') {
      app.append(el('p', { className: 'notice', role: 'status' }, ['メモと Todo を読み込んでいます…']));
      return;
    }
    if (snapshot.state === 'unavailable') {
      app.append(el('p', { className: 'warning', role: 'status' }, [snapshot.error || 'ワークスペース フォルダーを開いてください。']));
      return;
    }
    const issues = snapshot.issues || [];
    if (!issues.some(item => item.id === state.selectedIssue)) {
      const retained = issues.find(item => item.selectionKey === state.selectedIssueKey);
      if (retained) {
        state.selectedIssue = retained.id;
        state.issueSelectionPending = false;
      } else if (!state.issueSelectionPending) {
        state.selectedIssue = issues[0] ? issues[0].id : '';
      }
    }
    const selected = issues.find(item => item.id === state.selectedIssue);
    if (selected) { state.selectedIssueKey = selected.selectionKey; }
    const selector = el('select', {
      className: 'issue-selector', 'aria-label': '表示する項目',
      onchange: event => {
        state.selectedIssue = event.target.value;
        state.selectedIssueKey = issues.find(item => item.id === state.selectedIssue)?.selectionKey;
        state.issueSelectionPending = false;
        state.issueError = ''; persist(); render();
      },
    }, issues.map(item => el('option', { value: item.id, selected: item.id === state.selectedIssue }, [
      `${item.kind === 'memo' ? 'メモ' : item.statusLabel} · ${item.title}`,
    ])));
    const toolbar = el('div', { className: 'issue-actions', role: 'toolbar', 'aria-label': '項目の操作' }, [
      el('button', { type: 'button', onclick: () => openCreatePanel('memo') }, ['新規メモ']),
      el('button', { type: 'button', onclick: () => openCreatePanel('todo') }, ['新規 Todo']),
      el('button', { type: 'button', onclick: () => vscode.postMessage({ kind: 'refresh' }) }, ['更新']),
    ]);
    const navigation = el('header', { className: 'issue-appbar' }, [
      el('div', { className: 'issue-breadcrumb' }, [
        el('strong', {}, ['Quick Note']),
        el('span', { 'aria-hidden': 'true' }, ['/']),
        el('span', {}, ['メモ・Todo']),
      ]),
      issues.length ? selector : undefined,
      toolbar,
    ]);
    const detail = selected ? renderIssueDetail(selected) : el('main', { className: 'issue-empty', role: 'status' }, [
      el('h1', {}, ['メモと Todo']),
      el('p', {}, ['既存の項目を選択するか、新しい項目を作成します。']),
    ]);
    app.append(el('div', { className: `issue-workspace${state.issueCreate ? ' panel-open' : ''}` }, [
      el('div', { className: 'issue-page' }, [navigation, detail]),
      state.issueCreate ? renderCreatePanel() : undefined,
    ]));
    if (state.issueError) {
      app.append(el('p', { className: 'warning', role: 'alert' }, [state.issueError]));
    }
    if (snapshot.state === 'error' && snapshot.error) {
      app.append(el('p', { className: 'warning', role: 'alert' }, [snapshot.error]));
    }
  }

  function renderCreatePanel() {
    const draft = state.issueCreate;
    const title = el('input', { type: 'text', maxlength: '220', 'aria-label': 'タイトル（必須）', value: draft.title });
    title.value = draft.title;
    const create = el('button', { type: 'button', className: 'issue-primary', disabled: !draft.title.trim() || Boolean(state.issuePending),
      onclick: () => submitIssue(undefined, 'create', draft.title) }, ['作成']);
    title.addEventListener('input', () => {
      draft.title = title.value;
      create.disabled = !draft.title.trim() || Boolean(state.issuePending);
      persist();
    });
    const bodyHolder = el('div', { className: 'issue-composer' });
    const editor = createIssueEditor(bodyHolder, draft.body, '説明（Markdown）', text => {
      draft.body = text;
      state.issueDrafts[issueDraftKey(undefined, 'body')] = text;
      persist();
    });
    issueComposers.push(editor);
    const cancel = () => { state.issueCreate = undefined; state.issueError = ''; persist(); render(); };
    const panel = el('section', { className: 'issue-create-panel', role: 'region', 'aria-label': draft.kind === 'memo' ? 'メモを作成' : 'Todoを作成' }, [
      el('header', { className: 'issue-panel-titlebar' }, [
        el('h2', {}, [draft.kind === 'memo' ? '新規メモ' : '新規 Todo']),
        el('button', { type: 'button', className: 'issue-close', 'aria-label': '作成パネルを閉じる',
          disabled: Boolean(state.issuePending), onclick: cancel }, ['×']),
      ]),
      el('div', { className: 'issue-form-content' }, [
        el('label', {}, ['タイトル', title]),
        el('label', {}, ['説明 ', el('span', { className: 'issue-hint' }, ['（任意）'])]),
        bodyHolder,
      ]),
      el('div', { className: 'issue-panel-actions' }, [
        el('button', { type: 'button', disabled: Boolean(state.issuePending),
          onclick: cancel }, ['キャンセル']),
        create,
      ]),
    ]);
    if (window.innerWidth < 480) { panel.classList.add('wide'); }
    return panel;
  }

  function createIssueEditor(parent, initial, label, onChange) {
    const toolbar = el('div', { className: 'issue-toolbar', role: 'toolbar', 'aria-label': `${label} 書式設定` });
    const editor = el('div', { className: 'issue-editor' });
    parent.append(toolbar, editor);
    const api = window.quickNoteIssueComposer;
    if (!api) {
      parent.append(el('p', { className: 'warning', role: 'alert' }, ['Markdown エディターを読み込めませんでした。']));
      return { destroy() {} };
    }
    return api.create(editor, toolbar, initial, label, onChange, message => { state.issueError = message; });
  }

  function renderIssueDetail(item) {
    const readOnly = Boolean(item.readOnly);
    const titleEditing = state.issueTitleEdit && state.issueTitleEdit.id === item.id;
    const title = titleEditing
      ? (() => {
        const input = el('input', { type: 'text', maxlength: '220', 'aria-label': 'タイトルを編集' });
        input.value = state.issueTitleEdit.value;
        input.addEventListener('input', () => { state.issueTitleEdit.value = input.value; persist(); });
        return el('div', { className: 'issue-title-row' }, [
          input,
          el('button', { type: 'button', className: 'issue-primary', onclick: () => submitIssue(item, 'title', input.value) }, ['保存']),
          el('button', { type: 'button', onclick: () => { state.issueTitleEdit = undefined; persist(); render(); } }, ['キャンセル']),
        ]);
      })()
      : el('div', { className: 'issue-title-row' }, [
        el('h1', {}, [item.title]),
        renderEllipsis(item, 'title', 'タイトルの操作', readOnly ? [] : [
          ['タイトルを編集', () => { state.issueTitleEdit = { id: item.id, value: item.title }; state.issueMenu = ''; persist(); render(); }],
        ]),
      ]);
    return el('main', { className: 'issue-detail', 'aria-label': `${item.title} の詳細` }, [
      el('header', { className: 'issue-heading' }, [
        el('div', {}, [
          title,
          el('p', { className: 'issue-context' }, [`${item.kind === 'memo' ? 'メモ' : 'Todo'} ・ ${item.fileTitle}`]),
        ]),
      ]),
      renderIssueLabels(item),
      item.warning ? el('p', { className: 'warning', role: 'alert' }, [item.warning]) : undefined,
      el('div', { className: 'issue-timeline' }, [
        renderTimelineCard(renderIssueBody(item), item.kind === 'memo' ? 'M' : 'T'),
        el('section', { className: 'issue-comments', 'aria-label': 'コメント履歴' }, [
          el('h2', {}, [`コメント (${item.comments.length})`]),
          ...item.comments.map(comment => renderTimelineCard(renderIssueComment(item, comment), 'C')),
          readOnly ? undefined : renderNewIssueComment(item),
        ]),
      ]),
    ]);
  }

  function renderTimelineCard(card, icon) {
    return el('div', { className: 'issue-timeline-item' }, [
      el('span', { className: 'issue-avatar', 'aria-hidden': 'true' }, [icon]),
      card,
    ]);
  }

  function renderEllipsis(item, menuKey, label, actions) {
    if (!actions.length) return undefined;
    const key = `${item.id}:${menuKey}`;
    const open = state.issueMenu === key;
    return el('div', { className: 'issue-menu-wrap' }, [
      el('button', { type: 'button', className: 'issue-menu', 'aria-label': label, 'aria-expanded': String(open),
        onclick: () => { state.issueMenu = open ? '' : key; persist(); render(); } }, ['…']),
      open ? el('div', { className: 'issue-menu-popover', role: 'menu' }, actions.map(([name, action]) =>
        el('button', { type: 'button', role: 'menuitem', onclick: action }, [name]))) : undefined,
    ]);
  }

  function renderIssueLabels(item) {
    const editing = state.issueLabelsEdit && state.issueLabelsEdit.id === item.id;
    const labels = editing ? state.issueLabelsEdit.labels : item.labels;
    const chips = labels.map((label, index) => el('span', { className: `label-chip ${colorClass(label.color || labelColorFor(label.name))}` }, [
      label.name,
      editing ? el('button', { type: 'button', 'aria-label': `${label.name} を取り外す`, onclick: () => {
        state.issueLabelsEdit.labels.splice(index, 1); persist(); render();
      } }, ['×']) : undefined,
    ]));
    const status = item.kind === 'todo'
      ? el('select', { className: `issue-status${item.status === 'done' ? ' closed' : ''}`, 'aria-label': 'Todo の状態',
          disabled: item.readOnly, onchange: event => submitIssue(item, 'status', event.target.value) },
        STATUS_ORDER.filter(value => value !== 'unknown').map(value => el('option', { value, selected: value === item.status },
          [value === 'open' ? '● Open — 対応中' : value === 'done' ? '● Closed — 完了' : STATUS_LABELS[value]])))
      : undefined;
    const menu = renderEllipsis(item, 'labels', 'ラベルの操作', item.readOnly ? [] : [
      ['ラベルを追加', () => { state.issueLabelsEdit = { id: item.id, labels: item.labels.map(label => ({ ...label })) }; state.issueMenu = ''; persist(); render(); }],
      ['ラベルを編集', () => { state.issueLabelsEdit = { id: item.id, labels: item.labels.map(label => ({ ...label })) }; state.issueMenu = ''; persist(); render(); }],
    ]);
    const row = el('div', { className: 'issue-status-row issue-label-row', 'aria-label': '状態とラベル' }, [
      status, ...chips, menu,
    ]);
    if (!editing) return row;
    const input = el('input', { type: 'text', 'aria-label': '新しいラベル名' });
    input.value = state.issueLabelInput || '';
    input.addEventListener('input', () => { state.issueLabelInput = input.value; persist(); });
    const error = el('p', { className: 'warning', role: 'alert' }, [state.issueLabelError || '']);
    return el('section', { className: 'issue-label-editor', 'aria-label': 'ラベルを編集' }, [
      row, error,
      el('div', { className: 'issue-actions' }, [
        input,
        el('button', { type: 'button', onclick: () => {
          const name = state.issueLabelInput.trim();
          if (!name) { state.issueLabelError = 'ラベル名を入力してください。'; persist(); render(); return; }
          if (state.issueLabelsEdit.labels.some(label => label.name === name)) { state.issueLabelError = '同じ名前のラベルは追加できません。'; persist(); render(); return; }
          state.issueLabelsEdit.labels.push({ name, color: labelColorFor(name) }); state.issueLabelError = ''; state.issueLabelInput = ''; persist(); render();
        } }, ['追加']),
        el('button', { type: 'button', className: 'issue-primary', onclick: () => submitIssue(item, 'labels', state.issueLabelsEdit.labels.map(label => label.name)) }, ['適用']),
        el('button', { type: 'button', onclick: () => { state.issueLabelsEdit = undefined; state.issueLabelError = ''; persist(); render(); } }, ['キャンセル']),
      ]),
    ]);
  }

  function renderIssueBody(item) {
    const editing = state.issueBodyEdit === item.id;
    const key = issueDraftKey(item.id, 'body');
    const body = state.issueDrafts[key] !== undefined ? state.issueDrafts[key] : item.bodyMarkdown;
    if (!editing) {
      return el('article', { className: 'issue-card', 'aria-label': '説明' }, [
        el('header', {}, [
          el('strong', {}, ['説明']),
          renderEllipsis(item, 'body', '説明の操作', item.readOnly ? [] : [
            ['説明を編集', () => { state.issueBodyEdit = item.id; persist(); render(); }],
          ]),
        ]),
        el('div', { className: 'preview', innerHTML: item.bodyHtml || '<p class=\"empty\">本文はまだありません。</p>' }),
      ]);
    }
    const editorHolder = el('div', { className: 'issue-composer' });
    const composer = createIssueEditor(editorHolder, body, '説明（Markdown）', text => {
      state.issueDrafts[key] = text; persist();
    });
    issueComposers.push(composer);
    return el('article', { className: 'issue-card', 'aria-label': '説明を編集中' }, [
      el('header', {}, [el('strong', {}, ['説明を編集'])]), editorHolder,
      el('div', { className: 'issue-actions' }, [
        el('button', { type: 'button', className: 'issue-primary', onclick: () => submitIssue(item, 'body', state.issueDrafts[key] ?? body) }, ['保存']),
        el('button', { type: 'button', onclick: () => { delete state.issueDrafts[key]; state.issueBodyEdit = ''; persist(); render(); } }, ['キャンセル']),
      ]),
    ]);
  }

  function renderIssueComment(item, comment) {
    const editing = state.issueCommentEdit && state.issueCommentEdit.itemId === item.id && state.issueCommentEdit.commentId === comment.id;
    const key = issueDraftKey(item.id, 'comment', comment.id);
    const body = state.issueDrafts[key] !== undefined ? state.issueDrafts[key] : comment.text;
    if (!editing) {
      return el('article', { className: 'issue-card issue-comment', 'aria-label': `コメント ${comment.id}` }, [
        el('header', {}, [
          el('strong', {}, ['コメント']),
          renderEllipsis(item, `comment-${comment.id}`, 'コメントの操作', item.readOnly ? [] : [
            ['コメントを編集', () => { state.issueCommentEdit = { itemId: item.id, commentId: comment.id }; persist(); render(); }],
            ['コメントを削除', () => deleteIssueComment(item, comment.id)],
          ]),
        ]),
        el('div', { className: 'preview', innerHTML: comment.html }),
      ]);
    }
    const editorHolder = el('div', { className: 'issue-composer' });
    const composer = createIssueEditor(editorHolder, body, 'コメント（Markdown）', text => {
      state.issueDrafts[key] = text; persist();
    });
    issueComposers.push(composer);
    return el('article', { className: 'issue-card issue-comment', 'aria-label': 'コメントを編集中' }, [
      el('header', {}, [el('strong', {}, ['コメントを編集'])]), editorHolder,
      el('div', { className: 'issue-actions' }, [
        el('button', { type: 'button', className: 'issue-primary', onclick: () => submitIssue(item, 'comment', state.issueDrafts[key] ?? body, comment.id) }, ['保存']),
        el('button', { type: 'button', onclick: () => { delete state.issueDrafts[key]; state.issueCommentEdit = undefined; persist(); render(); } }, ['キャンセル']),
      ]),
    ]);
  }

  function renderNewIssueComment(item) {
    const key = issueDraftKey(item.id, 'comment');
    const body = state.issueDrafts[key] || '';
    const holder = el('div', { className: 'issue-composer' });
    const add = el('button', { type: 'button', className: 'issue-primary', disabled: !body.trim() }, ['コメントを追加']);
    const composer = createIssueEditor(holder, body, 'コメント（Markdown）', text => {
      state.issueDrafts[key] = text; persist();
      add.disabled = !text.trim();
    });
    issueComposers.push(composer);
    add.addEventListener('click', () => submitIssue(item, 'comment', state.issueDrafts[key] || ''));
    return el('article', { className: 'issue-card issue-new-comment', 'aria-label': 'コメントを追加' }, [
      el('strong', {}, ['コメントを追加']),
      holder,
      el('div', { className: 'issue-comment-footer' }, [
        el('span', { className: 'issue-hint' }, ['Markdownに対応']),
        add,
      ]),
    ]);
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
      type: 'date', value: current.dueDate || '', disabled: pending[`attrs:${key}`], 'aria-label': '対応日', 'data-focus-key': `attrs-due:${key}`,
      oninput: event => { current.dueDate = event.target.value; pushDraft(); },
    });
    const save = el('button', {
      type: 'button', disabled: Boolean(conflict) || pending[`attrs:${key}`],
      onclick: () => submitDraft('attributes', key,
        { kind: 'saveAttributes', id: todo.id, labels: current.labels, dueDate: current.dueDate || undefined }),
    }, ['保存']);
    const discard = el('button', {
      type: 'button', disabled: pending[`attrs:${key}`],
      onclick: () => submitDraft('attributes', key, { kind: 'discardAttributes', id: todo.id }),
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
        vscode.postMessage({ kind: 'previewBody', id: todo.id, text: live.body[key] });
        live.bodyHtml[key] = escapeForPreview(live.body[key]);
      } else {
        live.bodyHtml[key] = todo.bodyHtml || escapeForPreview(live.body[key]);
      }
    }
    const previewKey = `body:${key}`;
    const preview = el('div', { className: 'preview live', 'data-preview-key': previewKey, innerHTML: live.bodyHtml[key] });
    const textarea = el('textarea', {
      'aria-label': '本文（Markdown）', rows: '4', disabled: pending[`body:${key}`], 'data-focus-key': `body:${key}`,
      oninput: event => {
        live.body[key] = event.target.value;
        live.bodyHtml[key] = escapeForPreview(event.target.value);
        preview.innerHTML = live.bodyHtml[key];
        debounce(`body:${key}`, 300, () => vscode.postMessage({ kind: 'draftBody', id: todo.id, text: live.body[key] }));
      },
    }, []);
    textarea.value = live.body[key];
    const save = el('button', {
      type: 'button', disabled: Boolean(conflict) || pending[`body:${key}`],
      onclick: () => submitDraft('body', key, { kind: 'saveBody', id: todo.id, text: live.body[key] }),
    }, ['保存']);
    const discard = el('button', {
      type: 'button', disabled: pending[`body:${key}`],
      onclick: () => submitDraft('body', key, { kind: 'discardBody', id: todo.id }),
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
          vscode.postMessage({ kind: 'previewReply', id: todo.id, text: live.reply[newKey] });
        }
        live.replyHtml[newKey] = escapeForPreview(live.reply[newKey]);
      }
      const conflict = todo.newReplyDraft && todo.newReplyDraft.state === 'conflict';
      const preview = el('div', { className: 'preview live', 'data-preview-key': `reply:${newKey}`, innerHTML: live.replyHtml[newKey] });
      const textarea = el('textarea', {
        'aria-label': '新しいリプライ（Markdown）', rows: '2', disabled: pending[`reply:${newKey}`], 'data-focus-key': `reply:${newKey}`,
        oninput: event => {
          live.reply[newKey] = event.target.value;
          live.replyHtml[newKey] = escapeForPreview(event.target.value);
          preview.innerHTML = live.replyHtml[newKey];
          debounce(`reply:${newKey}`, 300, () => vscode.postMessage({ kind: 'draftReply', id: todo.id, text: live.reply[newKey] }));
        },
      }, []);
      textarea.value = live.reply[newKey];
      addSection = el('div', { className: 'reply editing' }, [
        conflict ? el('p', { className: 'warning', role: 'alert' }, ['外部変更を検出したため復元できません。']) : undefined,
        textarea, preview,
        el('div', { className: 'row' }, [
          el('button', {
            type: 'button', disabled: Boolean(conflict) || pending[`reply:${newKey}`],
            onclick: () => submitDraft('reply', newKey,
              { kind: 'saveReply', id: todo.id, text: live.reply[newKey] }),
          }, ['追加']),
          el('button', {
            type: 'button', disabled: pending[`reply:${newKey}`],
            onclick: () => submitDraft('reply', newKey, { kind: 'discardReply', id: todo.id }),
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
        vscode.postMessage({ kind: 'previewReply', id: todo.id, replyId: reply.id, text: live.reply[key] });
        live.replyHtml[key] = escapeForPreview(live.reply[key]);
      } else {
        live.replyHtml[key] = reply.html || escapeForPreview(live.reply[key]);
      }
    }
    const preview = el('div', { className: 'preview live', 'data-preview-key': `reply:${key}`, innerHTML: live.replyHtml[key] });
    const textarea = el('textarea', {
      'aria-label': `リプライ ${reply.id} を編集`, rows: '2', disabled: pending[`reply:${key}`], 'data-focus-key': `reply:${key}`,
      oninput: event => {
        live.reply[key] = event.target.value;
        live.replyHtml[key] = escapeForPreview(event.target.value);
        preview.innerHTML = live.replyHtml[key];
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
          type: 'button', disabled: Boolean(conflict) || pending[`reply:${key}`],
          onclick: () => submitDraft('reply', key,
            { kind: 'saveReply', id: todo.id, replyId: reply.id, text: live.reply[key] }),
        }, ['保存']),
        el('button', {
          type: 'button', disabled: pending[`reply:${key}`],
          onclick: () => submitDraft('reply', key,
            { kind: 'discardReply', id: todo.id, replyId: reply.id }),
        }, ['破棄']),
      ]),
    ]);
  }

  window.addEventListener('message', event => {
    const data = event.data;
    if (!data) return;
    if (data.kind === 'snapshot') { snapshot = data; render(); return; }
    if (data.kind === 'openCreatePanel') { openCreatePanel(data.itemKind); return; }
    if (data.kind === 'issueResult') {
      const pendingInfo = state.issuePendingInfo;
      if (!pendingInfo || pendingInfo.requestId !== data.requestId) return;
      state.issuePending = '';
      state.issuePendingInfo = undefined;
      if (data.success) {
        if (typeof data.selectionKey === 'string') {
          state.selectedIssueKey = data.selectionKey;
          state.selectedIssue = '';
          state.issueSelectionPending = true;
        }
        if (pendingInfo.create) {
          state.issueCreate = undefined;
          delete state.issueDrafts[issueDraftKey(undefined, 'body')];
        } else {
          delete state.issueDrafts[issueDraftKey(pendingInfo.itemId, pendingInfo.field, pendingInfo.commentId)];
          if (pendingInfo.field === 'title') state.issueTitleEdit = undefined;
          if (pendingInfo.field === 'body') state.issueBodyEdit = '';
          if (pendingInfo.field === 'comment' && pendingInfo.commentId) state.issueCommentEdit = undefined;
          if (pendingInfo.field === 'labels') { state.issueLabelsEdit = undefined; state.issueLabelInput = ''; }
        }
        state.issueError = '';
      } else {
        state.issueError = data.error || '保存できませんでした。入力を保持しています。';
      }
      persist();
      render();
      return;
    }
    if (data.kind === 'draftResult') {
      const key = data.field === 'reply' ? `${data.id}:${data.replyId || 'new'}` : data.id;
      const field = data.field === 'attributes' ? 'attrs' : data.field;
      delete pending[`${field}:${key}`];
      if (data.success) {
        delete live[field][key];
        if (field === 'body' || field === 'reply') delete live[`${field}Html`][key];
        const editing = field === 'attrs' ? state.editingAttrs : field === 'body' ? state.editingBody : state.editingReply;
        editing[key] = false;
        persist();
      }
      render();
      return;
    }
    if (data.kind === 'preview') {
      const key = `${data.id}:${data.replyId || 'new'}`;
      const previewKey = data.field === 'body' ? `body:${data.id}` : `reply:${key}`;
      const text = data.field === 'body' ? live.body[data.id] : live.reply[key];
      if (text === undefined || text !== data.text) return;
      if (data.field === 'body') { live.bodyHtml[data.id] = data.html; }
      else { live.replyHtml[key] = data.html; }
      const node = app.querySelector(`[data-preview-key="${CSS.escape(previewKey)}"]`);
      if (node) { node.innerHTML = data.html; }
    }
  });
  vscode.postMessage({ kind: 'ready' });
}());
