'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { caroRoutes, rooms: caroRooms } = require('./games/caro/routes');
const { noiTuRoutes, wgRooms }         = require('./games/noi-tu/routes');
const { snakeRoutes }                  = require('./games/snake/routes');
const authRoutes                       = require('./lib/auth');

const PORT = 3000;

function localIP() {
  for (const nets of Object.values(os.networkInterfaces()))
    for (const n of nets)
      if (n.family === 'IPv4' && !n.internal) return n.address;
  return '127.0.0.1';
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p   = url.pathname;
  const m   = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (m === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (m === 'GET' && p === '/') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch { res.writeHead(500); res.end('Cannot read index.html'); }
    return;
  }

  if (m === 'GET' && p.startsWith('/public/')) {
    try {
      const file = fs.readFileSync(path.join(__dirname, p));
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(file);
    } catch { res.writeHead(404); res.end(); }
    return;
  }

  if (await caroRoutes(req, res))  return;
  if (await noiTuRoutes(req, res)) return;
  if (await snakeRoutes(req, res)) return;
  if (await authRoutes(req, res))  return;

  res.writeHead(404); res.end();
});

// Stale room GC (inactive > 2h, no connected clients)
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [k, r] of caroRooms)
    if (r.createdAt < cutoff && r.clients.size === 0) caroRooms.delete(k);
  for (const [k, r] of wgRooms) {
    if (r.createdAt < cutoff && r.clients.size === 0) {
      if (r.timerRef) clearTimeout(r.timerRef);
      wgRooms.delete(k);
    }
  }
}, 15 * 60 * 1000);

server.listen(PORT, '0.0.0.0', () => {
  const ip = localIP();
  console.log('\n🎮  Game Zone — Server đang chạy!\n');
  console.log(`   Máy bạn   →  http://localhost:${PORT}`);
  console.log(`   Mạng WiFi →  http://${ip}:${PORT}   ← chia sẻ cho đồng nghiệp!\n`);
});
