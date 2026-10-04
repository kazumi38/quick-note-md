'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('./server.cjs');
let server;
let base;

before(async () => {
  server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
const render = text => fetch(`${base}/render`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text })
});

test('mock serves local UI with restrictive CSP and no external assets', async () => {
  for (const asset of ['/', '/mock.css', '/mock.js', '/inline-editor.js', '/decorations.js']) {
    const response = await fetch(base + asset);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(response.headers.get('content-security-policy'), /img-src 'none'/);
    assert.doesNotMatch(await response.text(), /<script[^>]+https?:|<link[^>]+https?:/);
  }
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /id="input"[^>]+contenteditable="true"/);
  assert.doesNotMatch(html, /id="preview"|<textarea/);
});
test('existing renderer formats headings, emphasis, lists, code and tables', async () => {
  const response = await render('# 確認事項\n\n**重要**\n\n- A\n- B\n\n`code`\n\n| 項目 | 値 |\n| --- | --- |\n| A | B |');
  assert.equal(response.status, 200);
  const { html } = await response.json();
  for (const tag of ['h1', 'strong', 'ul', 'li', 'code', 'table']) {
    assert.match(html, new RegExp(`<${tag}>`));
  }
});
test('raw HTML, links and images remain inert using the existing safety rules', async () => {
  const response = await render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))\n\n[site](https://example.invalid)\n\n![image](https://example.invalid/a.png)');
  const { html } = await response.json();
  assert.doesNotMatch(html, /<(script|img|a)\b/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /class="image"/);
});
test('empty and incomplete Markdown remain renderable', async () => {
  assert.equal((await (await render('')).json()).html, '');
  assert.equal((await render('**未完成\n\n```')).status, 200);
});
test('invalid input and non-allowlisted paths report errors', async () => {
  assert.equal((await fetch(base + '/package.json')).status, 404);
  assert.equal((await fetch(base + '/render', { method: 'POST', body: 'x' })).status, 415);
  for (const body of ['{', '{"text":42}', 'null']) {
    const response = await fetch(base + '/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, 'string');
  }
});
