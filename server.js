'use strict';
/*
 * Интернет-сервер для игры «Дурак».
 * 1) Раздаёт веб-версию игры из ./public (для iPhone и браузеров).
 * 2) WebSocket-ретранслятор на /lan - тот же протокол, что у LanPeer (lan-peer.js)
 *    и у Wi-Fi сервера внутри Android-приложения. Сервер ничего не знает об игре:
 *    состояние партии держит телефон создателя стола, сервер только пересылает сообщения.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_MESSAGE_BYTES = 256 * 1024; // состояние партии - несколько КБ, с запасом
const MAX_CLIENTS = Number(process.env.MAX_CLIENTS) || 500;
const PING_INTERVAL_MS = 25000; // держит соединение живым за прокси хостинга и ловит «мёртвые» телефоны
const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ ok: true, clients: clients.size }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end(); return;
  }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch (_) { res.writeHead(400); res.end(); return; }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
    const ext = path.extname(file).toLowerCase();
    const noCache = ext === '.html' || path.basename(file) === 'sw.js' || path.basename(file) === 'app-config.js';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
});

/** id игрока/стола -> WebSocket */
const clients = new Map();

function send(ws, message) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

const wss = new WebSocketServer({ server, path: '/lan', maxPayload: MAX_MESSAGE_BYTES });

wss.on('connection', ws => {
  if (clients.size >= MAX_CLIENTS) {
    send(ws, { type: 'error', errorType: 'server-full', message: 'Сервер переполнен, попробуйте позже' });
    ws.close();
    return;
  }
  ws.peerId = null;
  ws.alive = true;
  ws.links = new Map(); // connectionId -> id собеседника
  ws.on('pong', () => { ws.alive = true; });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'register') {
      if (ws.peerId) return;
      const id = String(msg.id || '');
      if (!ID_RE.test(id)) {
        send(ws, { type: 'error', errorType: 'invalid-id', message: 'Некорректный идентификатор' });
        return;
      }
      const existing = clients.get(id);
      if (existing && existing.readyState === existing.OPEN) {
        send(ws, { type: 'error', errorType: 'unavailable-id', message: 'Такой стол уже существует, создайте новый' });
        return;
      }
      ws.peerId = id;
      clients.set(id, ws);
      send(ws, { type: 'registered', id });
      return;
    }

    if (!ws.peerId) return;
    const connectionId = String(msg.connectionId || '');
    if (!ID_RE.test(connectionId)) return;

    if (msg.type === 'connect') {
      const target = clients.get(String(msg.target || ''));
      if (!target || target === ws || target.readyState !== target.OPEN) {
        send(ws, { type: 'error', errorType: 'peer-unavailable', connectionId, message: 'Стол не найден или уже закрыт' });
        return;
      }
      ws.links.set(connectionId, target.peerId);
      target.links.set(connectionId, ws.peerId);
      send(target, { type: 'connection', peer: ws.peerId, connectionId });
      send(ws, { type: 'connected', connectionId });
      return;
    }

    const otherId = ws.links.get(connectionId);
    if (!otherId) return; // пересылаем только внутри установленного соединения
    const other = clients.get(otherId);

    if (msg.type === 'data') {
      send(other, { type: 'data', connectionId, data: msg.data });
    } else if (msg.type === 'close') {
      ws.links.delete(connectionId);
      if (other) other.links.delete(connectionId);
      send(other, { type: 'close', connectionId });
    }
  });

  ws.on('close', () => {
    for (const [connectionId, otherId] of ws.links) {
      const other = clients.get(otherId);
      if (other) { other.links.delete(connectionId); send(other, { type: 'close', connectionId }); }
    }
    ws.links.clear();
    if (ws.peerId && clients.get(ws.peerId) === ws) clients.delete(ws.peerId);
  });
  ws.on('error', () => {});
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    try { ws.ping(); } catch (_) {}
  }
}, PING_INTERVAL_MS);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => console.log(`Durak server: http://localhost:${PORT}`));
