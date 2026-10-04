'use strict';

const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createServer } = require('./server.cjs');

async function main() {
  const executable = process.env.MOCK_BROWSER;
  if (!executable) { throw new Error('Set MOCK_BROWSER to a Chromium-based browser executable (Edge/Chrome).'); }
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'quick-note-mock-'));
  const server = createServer();
  let browser;
  let socket;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const endpoint = await new Promise((resolve, reject) => {
      let stderr = '';
      const timer = setTimeout(() => reject(new Error(`Browser startup timed out: ${stderr}`)), 20000);
      browser.stderr.on('data', data => {
        stderr += data.toString();
        const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      browser.once('error', error => { clearTimeout(timer); reject(error); });
      browser.once('exit', code => { clearTimeout(timer); reject(new Error(`Browser exited early: ${code}`)); });
    });
    socket = new WebSocket(endpoint);
    await once(socket, 'open');
    let sequence = 0;
    const pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const task = pending.get(message.id);
      if (!task) { return; }
      pending.delete(message.id);
      clearTimeout(task.timer);
      if (message.error) { task.reject(new Error(message.error.message)); }
      else { task.resolve(message.result); }
    });
    const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await call('Target.createTarget', { url: base });
    const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
    const evaluate = async expression => {
      const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (result.exceptionDetails) { throw new Error(JSON.stringify(result.exceptionDetails)); }
      return result.result.value;
    };
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate('document.querySelector("#input") !== null && typeof selectChat === "function"')) { break; }
      if (attempt === 99) { throw new Error('Mock did not load.'); }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const result = await evaluate(`(async () => {
      const e = id => document.getElementById(id);
      const wait = async predicate => {
        for (let n = 0; n < 100; n++) {
          if (predicate()) return;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw new Error('UI did not update in time: ' + e('editor-state').textContent + ' / ' + e('input').innerHTML);
      };
      const type = text => { e('input').textContent = text; e('input').dispatchEvent(new Event('input', { bubbles: true })); };
      type('# 確認事項\\n\\n**確認しました**\\n\\n- A\\n- B');
      await wait(() => e('input').querySelector('strong')?.textContent === '確認しました');
      const liveBeforeSend = e('messages').querySelectorAll('article').length === 2 && e('input').querySelectorAll('li').length === 2 && !e('preview');
      e('composer').requestSubmit();
      await wait(() => e('messages').querySelectorAll('article').length === 3);
      type('ログインの下書き');
      await wait(() => e('input').querySelector('p')?.textContent.includes('ログインの下書き'));
      document.querySelectorAll('.chat')[1].click();
      type('APIの下書き');
      document.querySelectorAll('.chat')[0].click();
      const draftRetained = editor.source === 'ログインの下書き';
      e('dirty').click();
      const blocked = e('send').disabled && e('source-state').textContent.includes('未保存');
      e('dirty').click();
      e('failure').click();
      e('composer').requestSubmit();
      const failureRetained = editor.source === 'ログインの下書き' && e('status').textContent.includes('失敗');
      e('failure').click();
      e('new-chat').click();
      e('title-input').value = '新規確認';
      type('**新しい本文**');
      e('composer').requestSubmit();
      await wait(() => e('messages').querySelectorAll('article').length === 1 && e('messages').textContent.includes('新しい本文'));
      const created = document.querySelectorAll('.chat').length === 4;
      document.querySelectorAll('.chat')[2].click();
      type('長い日本語'.repeat(40) + '\\n\\nhttps://example.invalid/' + 'a'.repeat(200) + '\\n\\n\\\`\\\`\\\`js\\nconst longName = "' + 'a'.repeat(200) + '";\\n\\\`\\\`\\\`\\n\\n| 項目 | 確認 |\\n| --- | --- |\\n| 長い表の項目 | ' + 'B'.repeat(100) + ' |');
      await wait(() => e('input').querySelector('table') !== null);
      return { liveBeforeSend, draftRetained, blocked, failureRetained, created };
    })()`);
    for (const [name, passed] of Object.entries(result)) { assert.equal(passed, true, name); }
    const settle = () => evaluate(`(async () => {
      for (let n = 0; n < 100; n++) {
        if (document.getElementById('editor-state').textContent === 'この入力欄で整形中・未送信') return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('Inline editor did not settle: ' + document.getElementById('editor-state').textContent);
    })()`);
    const startTyping = async () => {
      await evaluate(`editor.set(''); document.getElementById('input').focus()`);
      await settle();
      await evaluate(`(() => { const r = document.createRange(); r.selectNodeContents(editor.root); r.collapse(false); window.getSelection().removeAllRanges(); window.getSelection().addRange(r); })()`);
    };
    await startTyping();
    for (const character of '**確認**') {
      await call('Input.insertText', { text: character }, sessionId);
      await settle();
    }
    assert.equal(await evaluate(`editor.root.querySelector('strong')?.textContent`), '確認', 'Real typing formats in the input itself');
    assert.equal(await evaluate(`document.activeElement === editor.root && editor.root.contains(window.getSelection().anchorNode)`), true, 'Caret remains inside editor');
    await evaluate(`(() => { const node = editor.root.querySelector('strong').firstChild; const r = document.createRange(); r.setStart(node, 1); r.collapse(true); window.getSelection().removeAllRanges(); window.getSelection().addRange(r); })()`);
    await call('Input.insertText', { text: '追' }, sessionId);
    await settle();
    assert.equal(await evaluate(`editor.root.querySelector('strong')?.textContent`), '確追認', 'Middle edits preserve formatting and position');
    await evaluate(`editor.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }))`);
    await settle();
    assert.equal(await evaluate(`editor.root.querySelector('strong')?.textContent`), '確認', 'Undo survives render');
    await evaluate(`editor.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))`);
    await settle();
    assert.equal(await evaluate(`editor.root.querySelector('strong')?.textContent`), '確追認', 'Redo survives render');
    await evaluate(`(() => {
      const node = editor.root.querySelector('strong').firstChild;
      const range = document.createRange();
      range.setStart(node, 1); range.setEnd(node, 2);
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    })()`);
    await call('Input.insertText', { text: '替' }, sessionId);
    await settle();
    assert.equal(await evaluate(`editor.root.querySelector('strong')?.textContent`), '確替認', 'Selection replacement stays in formatted input');
    await startTyping();
    for (const character of '# 確認') {
      await call('Input.insertText', { text: character }, sessionId);
      await settle();
    }
    assert.equal(await evaluate(`editor.root.querySelector('h1')?.textContent`), '確認', 'Heading formats while typing without Enter');
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, sessionId);
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, sessionId);
    await settle();
    await call('Input.insertText', { text: '次の段落' }, sessionId);
    await settle();
    assert.equal(await evaluate(`editor.root.textContent.includes('次の段落') && !editor.root.textContent.includes('caret-')`), true, 'Enter and following text remain editable');
    await evaluate(`editor.root.dispatchEvent(new CompositionEvent('compositionstart')); editor.root.append(document.createTextNode('変換中')); editor.root.dispatchEvent(new InputEvent('input', { isComposing: true, bubbles: true }))`);
    assert.equal(await evaluate(`editor.composing && editor.root.textContent.includes('変換中')`), true, 'Composition does not replace DOM');
    await evaluate(`editor.root.dispatchEvent(new CompositionEvent('compositionend'))`);
    await settle();
    await startTyping();
    await evaluate(`(() => {
      const transfer = new DataTransfer();
      transfer.setData('text/plain', '# 貼り付け\\n\\n**強調**\\n\\n- A\\n- B');
      editor.root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    })()`);
    await settle();
    assert.equal(await evaluate(`editor.root.querySelector('h1')?.textContent === '貼り付け' && editor.root.querySelectorAll('li').length === 2`), true, 'Markdown paste renders in the editable surface');
    const key = async (name, code) => {
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code }, sessionId);
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code }, sessionId);
      await settle();
    };
    const at = async (selector, end = false) => {
      await evaluate(`(() => {
        const node = editor.root.querySelector(${JSON.stringify(selector)});
        editor.root.focus();
        const range = document.createRange();
        range.selectNodeContents(node); range.collapse(${!end});
        window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
      })()`);
    };
    await evaluate(`editor.set('# 見出し\\n\\n- [ ] 未完了\\n- [x] 完了\\n- [i] 重要\\n- [!] 注意\\n- [n] 参考\\n- [-] スキップ\\n\\n> [!INFO]\\n> 補足\\n\\n> [!WARN]\\n> 危険')`);
    await settle();
    const decorated = await evaluate(`({
      boxes: editor.root.querySelectorAll('[role="checkbox"]').length,
      calls: editor.root.querySelectorAll('.callout').length,
      statuses: editor.root.querySelectorAll('.status-badge').length,
      sizes: parseFloat(getComputedStyle(editor.root.querySelector('h1')).fontSize) > parseFloat(getComputedStyle(editor.root.querySelector('li')).fontSize),
      source: editor.serialize(editor.root)
    })`);
    assert.equal(decorated.boxes, 2, 'Visible open and completed checkboxes');
    assert.equal(decorated.calls, 2, 'INFO and WARN callouts visible');
    assert.equal(decorated.statuses, 6, 'All existing status markers visible');
    assert.equal(decorated.sizes, true, 'Heading and task text have different sizes');
    assert.match(decorated.source, /- \[ \] 未完了/);
    assert.match(decorated.source, /> \[!INFO\]/);
    await at('h1');
    await key('Backspace', 8);
    assert.equal(await evaluate(`!editor.root.querySelector('h1') && editor.root.querySelector('p').textContent === '見出し'`), true, 'Backspace at heading start removes heading formatting');
    await evaluate(`editor.set('**消す**')`);
    await settle();
    await at('strong', true);
    await key('Backspace', 8);
    assert.equal(await evaluate(`editor.root.querySelector('strong').textContent`), '消', 'Backspace deletes inside strong');
    await key('Backspace', 8);
    assert.equal(await evaluate(`editor.source.trim()`), '', 'Deleting last strong character does not create a rule');
    await call('Input.insertText', { text: '続ける' }, sessionId);
    await settle();
    assert.equal(await evaluate(`editor.root.textContent`), '続ける', 'Typing continues after deleting last character');
    await evaluate(`editor.set('- [ ] 項目\\n- [x] 次')`);
    await settle();
    await at('li');
    await key('Backspace', 8);
    assert.equal(await evaluate(`editor.root.querySelectorAll('[role="checkbox"]').length`), 1, 'Backspace removes only current task marker');
    await key('Backspace', 8);
    assert.equal(await evaluate(`editor.root.querySelector('p').textContent === '項目' && editor.root.querySelectorAll('li').length === 1`), true, 'Backspace exits list without dropping next item');
    await evaluate(`editor.set('前の段落\\n\\n後の段落')`);
    await settle();
    await at('p:last-child');
    await key('Backspace', 8);
    assert.equal(await evaluate(`editor.root.querySelectorAll('p').length === 1 && editor.root.textContent === '前の段落後の段落'`), true, 'Backspace joins paragraphs without losing text');
    await evaluate(`editor.set('> [!WARN]\\n> 注意')`);
    await settle();
    await at('blockquote p');
    await key('Backspace', 8);
    assert.equal(await evaluate(`!editor.root.querySelector('blockquote') && editor.root.textContent === '注意'`), true, 'Backspace exits callout preserving body');
    await startTyping();
    for (const character of '- [ ] 確認') {
      await call('Input.insertText', { text: character }, sessionId);
      await settle();
    }
    assert.equal(await evaluate(`editor.root.querySelectorAll('[role="checkbox"]').length`), 1, 'Task checkbox appears with real sequential typing');
    await startTyping();
    for (const character of '> [!INFO]') {
      await call('Input.insertText', { text: character }, sessionId);
      await settle();
    }
    assert.equal(await evaluate(`editor.root.querySelector('.callout-label')?.textContent`), 'INFO', 'INFO callout appears with real sequential typing');
    await call('Input.insertText', { text: '補足' }, sessionId);
    await settle();
    assert.match(await evaluate(`editor.source`), /\[!INFO\]/);
    await evaluate(`editor.set('**連続削除**'); editor.root.focus()`);
    await settle();
    await at('strong', true);
    for (let index = 0; index < 4; index++) {
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }, sessionId);
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }, sessionId);
    }
    await settle();
    assert.equal(await evaluate(`editor.source`), '', 'Rapid Backspace never resurrects old content');
    await evaluate(`editor.set('# 全削除\\n\\n- [ ] 項目\\n\\n> [!WARN]\\n> 注意')`);
    await settle();
    await evaluate(`(() => {
      editor.root.focus(); const range = document.createRange(); range.selectNodeContents(editor.root);
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    })()`);
    await key('Backspace', 8);
    assert.equal(await evaluate(`editor.source`), '', 'Select-all Backspace clears formatted structures');
    await evaluate(`editor.set('長い日本語'.repeat(40) + '\\n\\nhttps://example.invalid/' + 'a'.repeat(200) + '\\n\\n\\\`\\\`\\\`js\\nconst longName = "' + 'a'.repeat(200) + '";\\n\\\`\\\`\\\`\\n\\n| 項目 | 確認 |\\n| --- | --- |\\n| 長い表の項目 | ' + 'B'.repeat(100) + ' |')`);
    await settle();
    const screenshots = path.join(__dirname, 'screenshots');
    await fs.mkdir(screenshots, { recursive: true });
    await call('Emulation.setDeviceMetricsOverride', { width: 900, height: 2000, deviceScaleFactor: 1, mobile: false }, sessionId);
    for (const width of [280, 400, 800]) {
      await evaluate(`document.getElementById('width').value = '${width}'; document.getElementById('width').dispatchEvent(new Event('change'))`);
      const fits = await evaluate(`(() => {
        const panel = document.getElementById('panel');
        return panel.scrollWidth <= panel.clientWidth && document.documentElement.scrollWidth <= document.documentElement.clientWidth;
      })()`);
      assert.equal(fits, true, `No panel overflow at ${width}px`);
      const image = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId);
      await fs.writeFile(path.join(screenshots, `chat-${width}.png`), Buffer.from(image.data, 'base64'));
    }
    await evaluate(`(async () => {
      selectChat('login');
      document.getElementById('width').value = '400';
      document.getElementById('width').dispatchEvent(new Event('change'));
      document.getElementById('input').textContent = '# 確認事項\\n\\n**ログイン画面**について確認してください。\\n\\n- デザイン\\n- API\\n- エラー処理';
      document.getElementById('input').dispatchEvent(new Event('input', { bubbles: true }));
      for (let n = 0; n < 100; n++) {
        if (document.querySelector('#input strong')?.textContent === 'ログイン画面'
            && document.querySelector('#input h1')?.textContent === '確認事項'
            && document.querySelectorAll('#messages article').length === 3) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('Primary screenshot did not settle');
    })()`);
    await call('Emulation.setDeviceMetricsOverride', { width: 900, height: 1700, deviceScaleFactor: 1, mobile: false }, sessionId);
    const primary = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId);
    await fs.writeFile(path.join(screenshots, 'chat-input.png'), Buffer.from(primary.data, 'base64'));
    await evaluate(`editor.set('# 確認事項\\n\\n## チェック項目\\n\\n- [ ] デザイン確認\\n- [x] API確認済み\\n- [i] 重要な確認\\n- [!] エラー処理に注意\\n- [n] 参考情報\\n- [-] 対応不要\\n\\n> [!INFO]\\n> 追加の情報をここに入力します。\\n\\n> [!WARN]\\n> 保存前に確認してください。')`);
    await settle();
    const states = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId);
    await fs.writeFile(path.join(screenshots, 'chat-states.png'), Buffer.from(states.data, 'base64'));
    console.log('Mock UI smoke passed: inline edits, headings, tasks/statuses, INFO/WARN callouts, Backspace boundaries/rapid deletion, history, composition events, send, drafts, widths 280/400/800.');
    console.log(`Screenshots: ${screenshots}`);
  } finally {
    socket?.close();
    if (browser && browser.exitCode === null) {
      const exited = once(browser, 'exit');
      browser.kill();
      await exited;
    }
    await new Promise(resolve => server.close(resolve));
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
