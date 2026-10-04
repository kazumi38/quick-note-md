'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { renderSafeMarkdown } = require(path.resolve(__dirname, '..', '..', '..', 'out', 'rendering.js'));

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/mock.js', ['mock.js', 'text/javascript; charset=utf-8']],
  ['/inline-editor.js', ['inline-editor.js', 'text/javascript; charset=utf-8']],
  ['/decorations.js', ['decorations.js', 'text/javascript; charset=utf-8']],
  ['/mock.css', ['mock.css', 'text/css; charset=utf-8']]
]);

function createServer() {
  return http.createServer(async (request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    const json = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(value));
    };
    try {
      if (request.method === 'GET' && assets.has(request.url)) {
        const [name, type] = assets.get(request.url);
        const body = await fs.readFile(path.join(__dirname, name));
        response.writeHead(200, { 'Content-Type': type });
        response.end(body);
        return;
      }
      if (request.method !== 'POST' || request.url !== '/render') {
        json(404, { error: '指定したモック操作はありません。' });
        return;
      }
      if (request.headers['content-type'] !== 'application/json') {
        json(415, { error: 'JSON 形式で送信してください。' });
        return;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 1048576) {
          json(413, { error: 'モックの入力上限（1MB）を超えています。' });
          return;
        }
        chunks.push(chunk);
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { json(400, { error: 'JSON を読み取れません。' }); return; }
      if (!data || typeof data.text !== 'string') {
        json(400, { error: '描画する文字列を指定してください。' });
        return;
      }
      json(200, { html: renderSafeMarkdown(data.text) });
    } catch (error) {
      console.error('Mock request failed:', error);
      if (!response.headersSent) { json(500, { error: 'モック処理に失敗しました。起動端末のログを確認してください。' }); }
      else { response.destroy(error); }
    }
  });
}

if (require.main === module) {
  const argument = process.argv.find(value => value.startsWith('--port='));
  const port = argument ? Number(argument.slice(7)) : 4319;
  if (!Number.isInteger(port) || port < 1 || port > 65535) { throw new Error('Port must be between 1 and 65535.'); }
  const server = createServer();
  server.on('error', error => { console.error('Mock server failed:', error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Task 009 mock: http://127.0.0.1:${port} (no file persistence)`));
}

module.exports = { createServer };
