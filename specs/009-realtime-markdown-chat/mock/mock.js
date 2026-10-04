'use strict';

const element = id => document.getElementById(id);
const chats = [
  { id: 'login', title: 'ログイン画面について', messages: [
    { section: '本文', date: '2026-10-04 06:30', text: 'ログイン画面について確認したいです。\n\n**現在の仕様について教えてください。**' },
    { section: '返信', date: '2026-10-04 06:35', text: '現在の仕様は以下です。\n\n- A\n- B\n- C' }
  ] },
  { id: 'api', title: 'API仕様について', messages: [
    { section: '本文', date: '2026-10-04 06:40', text: '| 項目 | 確認 |\n| --- | --- |\n| API | エラー処理 |\n\n```js\nconst endpoint = "https://example.invalid/very/long/path/for/layout/review";\n```' }
  ] },
  { id: 'release', title: 'リリース前確認', messages: [
    { section: '本文', date: '2026-10-04 06:45', text: '> 最終確認をお願いします。\n\n- デザイン\n- 日本語入力\n- 保存失敗の案内' }
  ] }
];
const drafts = new Map();
const dirtyChats = new Set();
let selected = 'login';
let threadVersion = 0;
let submitting = false;
const editor = new InlineEditor(element('input'), element('editor-state'), render, () => remember());

async function render(text) {
  const response = await fetch('/render', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text })
  });
  const result = await response.json();
  if (!response.ok) { throw new Error(result.error || '描画に失敗しました。'); }
  return result.html;
}

function showHtml(target, html) {
  target.innerHTML = html;
  decorateMarkdown(target);
  for (const table of target.querySelectorAll('table')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'table-scroll';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', '表（横スクロール可能）');
    table.replaceWith(wrapper);
    wrapper.append(table);
  }
}

function remember() {
  drafts.set(selected, { text: editor.source, title: element('title-input').value });
}

function updateSendState() {
  const dirty = dirtyChats.has(selected);
  element('dirty').checked = dirty;
  element('source-state').textContent = dirty ? '原文に未保存の変更あり（疑似状態）。送信は停止しています。' : '';
  element('send').disabled = dirty || submitting;
}

function drawList() {
  element('chat-list').replaceChildren();
  for (const chat of chats) {
    const button = document.createElement('button');
    button.className = 'chat';
    button.textContent = chat.title;
    button.setAttribute('aria-current', String(selected === chat.id));
    button.addEventListener('click', () => selectChat(chat.id));
    element('chat-list').append(button);
  }
}

async function drawThread() {
  const version = ++threadVersion;
  const chat = chats.find(item => item.id === selected);
  const container = element('messages');
  container.replaceChildren();
  if (!chat) { return; }
  container.textContent = '会話を読み込み中…';
  try {
    const html = await Promise.all(chat.messages.map(message => render(message.text)));
    if (version !== threadVersion) { return; }
    container.replaceChildren();
    let section;
    chat.messages.forEach((message, index) => {
      if (section !== message.section) {
        section = message.section;
        const heading = document.createElement('h3');
        heading.textContent = section;
        container.append(heading);
      }
      const card = document.createElement('article');
      card.className = 'message';
      const date = document.createElement('time');
      date.textContent = message.date;
      const body = document.createElement('div');
      body.className = 'markdown';
      showHtml(body, html[index]);
      card.append(date, body);
      container.append(card);
    });
  } catch (error) {
    if (version === threadVersion) { container.textContent = `会話の描画に失敗しました: ${error.message} ページを再読込して再試行してください。`; }
  }
}

function selectChat(id) {
  remember();
  selected = id;
  const chat = chats.find(item => item.id === id);
  const draft = drafts.get(id) || { text: '', title: '' };
  editor.set(draft.text);
  element('title-input').value = draft.title;
  element('title-field').hidden = Boolean(chat);
  element('thread-title').textContent = chat ? chat.title : '新しいチャット';
  element('composer-title').textContent = chat ? '新しい返信' : '最初の本文';
  element('status').textContent = '';
  drawList();
  updateSendState();
  void drawThread();
}

element('title-input').addEventListener('input', remember);
element('new-chat').addEventListener('click', () => {
  selectChat('new');
  element('title-input').focus();
});
element('dirty').addEventListener('change', () => {
  if (element('dirty').checked) { dirtyChats.add(selected); } else { dirtyChats.delete(selected); }
  updateSendState();
});
element('width').addEventListener('change', () => {
  element('panel').style.width = `${element('width').value}px`;
});
element('composer').addEventListener('submit', event => {
  event.preventDefault();
  if (submitting || dirtyChats.has(selected)) { return; }
  const text = editor.source;
  let chat = chats.find(item => item.id === selected);
  const title = element('title-input').value.trim();
  if (!text.trim() || (!chat && !title)) {
    element('status').textContent = 'タイトルと本文、または返信を空白以外で入力してください。';
    return;
  }
  if (element('failure').checked) {
    element('status').textContent = '保存失敗（疑似）。入力は保持しています。失敗設定を解除して再試行してください。';
    return;
  }
  submitting = true;
  const date = new Date();
  const pad = number => String(number).padStart(2, '0');
  const timestamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const section = chat ? '返信' : '本文';
  if (!chat) {
    chat = { id: `mock-${chats.length}`, title, messages: [] };
    chats.unshift(chat);
    drafts.delete('new');
    dirtyChats.delete('new');
    selected = chat.id;
  }
  chat.messages.push({ section, date: timestamp, text });
  drafts.delete(selected);
  editor.set('');
  element('title-input').value = '';
  submitting = false;
  selectChat(selected);
  element('status').textContent = '会話へ追加しました（疑似）。ファイルには保存していません。';
});
element('source-example').textContent = '# ログイン画面について\n\n## 本文\n\n### 2026-10-04 06:30\n\nログイン画面について確認したいです。\n\n**現在の仕様について教えてください。**\n\n## 返信\n\n### 2026-10-04 06:35\n\n現在の仕様は以下です。\n\n- A\n- B\n- C\n';
selectChat('login');
