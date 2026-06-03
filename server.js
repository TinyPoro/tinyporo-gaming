'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const os     = require('os');

const PORT = 3000;
const rooms = new Map(); // code → room

// ── Load Vietnamese 2-syllable dictionary ─────────────────────────────────
const wgWordSet = new Set();
try {
  const dictPath = path.join(__dirname, 'data', 'Viet74K.txt');
  const lines = fs.readFileSync(dictPath, 'utf8').split('\n');
  for (const line of lines) {
    const w = line.trim().toLowerCase();
    const parts = w.split(' ');
    if (parts.length === 2 && !w.includes('-')) wgWordSet.add(w);
  }
  console.log(`📚 Loaded ${wgWordSet.size.toLocaleString()} Vietnamese words from dictionary`);
} catch (e) {
  console.warn('⚠️  Dictionary not found — word validation will use syllable rules only');
}

// ── Helpers ───────────────────────────────────────────────────────────────
const uid  = (n = 8) => crypto.randomBytes(n).toString('hex');
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, +n || lo));

function mkCode() {
  // 4-char alphanumeric, avoid confusing chars
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const buf = crypto.randomBytes(4);
  for (let i = 0; i < 4; i++) s += chars[buf[i] % chars.length];
  return s;
}

function makeRoom(size) {
  return {
    board:      Array(size * size).fill(null),
    size,
    current:    'X',
    over:       false,
    players:    { X: null,  O: null  },
    nicknames:  { X: '',    O: ''    },
    clients:    new Map(),
    createdAt:  Date.now(),
  };
}

const safeNick = s => String(s || '').trim().slice(0, 20);

// ══════════════════════════════════════════════════════════
//  WORD GAME (Nối Từ) — helpers
// ══════════════════════════════════════════════════════════
const wgRooms    = new Map();
const WG_TURN_MS = 30_000;

function makeWgRoom(maxPlayers) {
  return {
    phase:      'lobby',   // 'lobby' | 'playing' | 'finished'
    maxPlayers,
    players:    [],        // [{token, nick, alive}]
    hostToken:  null,
    usedWords:  new Set(),
    words:      [],        // [{word, playerIdx}]
    lastSyl:    null,
    currIdx:    0,
    timerRef:   null,
    deadline:   null,
    clients:    new Map(),
    createdAt:  Date.now(),
  };
}

const wgSplitSyls = w => w.trim().toLowerCase().normalize('NFC').split(/\s+/).filter(Boolean);

// ── Vietnamese syllable validator ──────────────────────────────────────────
// Cấu trúc: (phụ âm đầu)?(nguyên âm+)(phụ âm cuối)?
const _VI_SYL = new RegExp(
  '^(?:ngh|nh|ng|ph|th|tr|ch|gh|gi|qu|kh|b|c|d|đ|g|h|k|l|m|n|p|r|s|t|v|x)?' +
  '[a\xe0\xe1\xe3ảạăằắẳẵặ\xe2ầấẩẫậ' +
  'e\xe8\xe9ẻẽẹ\xeaềếểễệ' +
  'i\xec\xedỉĩị' +
  'o\xf2\xf3ỏ\xf5ọ\xf4ồốổỗộơởờỡớợ' +
  'u\xf9\xfaủũụưừứửữự' +
  'yỳ\xfdỷỹỵ]+' +
  '(?:ng|nh|ch|[cmnpt])?$'
);
const isViSyl  = s => _VI_SYL.test(s);
const isViWord = w => { const s = wgSplitSyls(w); return s.length > 0 && s.every(isViSyl); };

function wgValidate(room, word) {
  const syls = wgSplitSyls(word);
  if (!syls.length)    return 'Từ không hợp lệ';
  if (syls.length !== 2) return 'Từ phải có đúng 2 tiếng (VD: "học sinh", "bạn bè")';
  // Dictionary check (preferred) or syllable structure (fallback if dict not loaded)
  if (wgWordSet.size > 0) {
    if (!wgWordSet.has(word)) return 'Từ không có trong từ điển tiếng Việt';
  } else if (!isViWord(word)) {
    return 'Không phải từ tiếng Việt hợp lệ';
  }
  if (room.lastSyl && syls[0] !== room.lastSyl) return `Phải bắt đầu bằng "${room.lastSyl}"`;
  if (room.usedWords.has(word))                 return 'Từ này đã được dùng rồi!';
  return null;
}

function wgAlive(room) { return room.players.filter(p => p.alive); }

function wgNextIdx(room, from) {
  const n = room.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    if (room.players[idx].alive) return idx;
  }
  return -1;
}

function wgSetDeadline(room, code) {
  if (room.timerRef) clearTimeout(room.timerRef);
  room.deadline = Date.now() + WG_TURN_MS;
  room.timerRef = setTimeout(() => wgHandleTimeout(room, code), WG_TURN_MS + 1500);
}

function wgEliminate(room, code, pIdx, reason) {
  if (room.timerRef) { clearTimeout(room.timerRef); room.timerRef = null; }
  room.players[pIdx].alive = false;
  const alive = wgAlive(room);

  if (alive.length <= 1) {
    room.phase = 'finished';
    const winner    = alive[0] ?? null;
    const winnerIdx = winner ? room.players.indexOf(winner) : -1;
    broadcast(room, { type: 'wg:eliminated', playerIdx: pIdx, reason, gameOver: true, winnerIdx, winnerNick: winner?.nick ?? null });
  } else {
    const nextIdx = wgNextIdx(room, pIdx);
    room.currIdx  = nextIdx;
    wgSetDeadline(room, code);
    broadcast(room, { type: 'wg:eliminated', playerIdx: pIdx, reason, gameOver: false, currIdx: nextIdx, deadline: room.deadline });
  }
}

function wgHandleTimeout(room, code) {
  if (room.phase !== 'playing') return;
  wgEliminate(room, code, room.currIdx, 'timeout');
}

function broadcast(room, payload) {
  const msg = 'data: ' + JSON.stringify(payload) + '\n\n';
  for (const res of room.clients.values()) {
    try { res.write(msg); } catch {}
  }
}

async function parseBody(req) {
  return new Promise(resolve => {
    let raw = '';
    req.on('data', d => { raw += d; });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
}

// ── Win check (server-authoritative) ─────────────────────────────────────
const WIN = 5;

function checkWin(board, row, col, player, size) {
  for (const [dr, dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
    const fwd = gather(board, row, col,  dr,  dc, player, size);
    const bwd = gather(board, row, col, -dr, -dc, player, size);
    const line = fwd.concat(bwd.slice(1));
    if (line.length >= WIN) return line.slice(0, WIN);
  }
  return null;
}

function gather(board, r, c, dr, dc, p, size) {
  const cells = [];
  for (let i = 0; i < WIN; i++) {
    const nr = r + dr * i, nc = c + dc * i;
    if (nr < 0 || nr >= size || nc < 0 || nc >= size) break;
    if (board[nr * size + nc] !== p) break;
    cells.push([nr, nc]);
  }
  return cells;
}

// ── Local IP ──────────────────────────────────────────────────────────────
function localIP() {
  for (const nets of Object.values(os.networkInterfaces()))
    for (const n of nets)
      if (n.family === 'IPv4' && !n.internal) return n.address;
  return '127.0.0.1';
}

// ── HTTP server ───────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p   = url.pathname;
  const m   = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (m === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const json = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // ── GET / → serve index.html ──────────────────────────────────────────
  if (p === '/' && m === 'GET') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch { res.writeHead(500); res.end('Cannot read index.html'); }
    return;
  }

  // ── POST /api/room → create room ──────────────────────────────────────
  if (p === '/api/room' && m === 'POST') {
    const body  = await parseBody(req);
    const size  = clamp(body.size || 15, 8, 25);
    const token = uid();
    const code  = mkCode();
    const room  = makeRoom(size);
    room.players.X   = token;
    room.nicknames.X = safeNick(body.nickname);
    rooms.set(code, room);
    json(200, { code, token, role: 'X' });
    return;
  }

  // ── POST /api/room/:code → join room ──────────────────────────────────
  let mx;
  if ((mx = p.match(/^\/api\/room\/([A-Z0-9]{4})$/)) && m === 'POST') {
    const code = mx[1];
    const room = rooms.get(code);
    if (!room) { json(404, { error: 'Room not found' }); return; }
    const body = await parseBody(req);

    const snap = () => ({ board: room.board, size: room.size, current: room.current, over: room.over, nicknames: room.nicknames });

    // Rejoin with existing token
    if (body.token) {
      if (body.token === room.players.X) {
        json(200, { code, token: body.token, role: 'X', oReady: !!room.players.O, ...snap() });
        return;
      }
      if (body.token === room.players.O) {
        json(200, { code, token: body.token, role: 'O', oReady: true, ...snap() });
        return;
      }
    }

    // Assign O slot
    if (!room.players.O) {
      const token = uid();
      room.players.O   = token;
      room.nicknames.O = safeNick(body.nickname);
      broadcast(room, { type: 'playerJoined', oNickname: room.nicknames.O });
      json(200, { code, token, role: 'O', oReady: true, ...snap() });
      return;
    }

    // Spectator
    json(200, { code, token: null, role: 'spectator', oReady: true, ...snap() });
    return;
  }

  // ── GET /api/events/:code → SSE stream ───────────────────────────────
  if ((mx = p.match(/^\/api\/events\/([A-Z0-9]{4})$/)) && m === 'GET') {
    const code = mx[1];
    const room = rooms.get(code);
    if (!room) { res.writeHead(404); res.end(); return; }

    const cid = url.searchParams.get('token') || uid(4);
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    });
    res.write('data: {"type":"connected"}\n\n');
    room.clients.set(cid, res);
    req.on('close', () => room.clients.delete(cid));
    return;
  }

  // ── POST /api/move/:code → make a move ───────────────────────────────
  if ((mx = p.match(/^\/api\/move\/([A-Z0-9]{4})$/)) && m === 'POST') {
    const code = mx[1];
    const room = rooms.get(code);
    if (!room) { json(404, {}); return; }

    const { token, row, col } = await parseBody(req);
    const role = token === room.players.X ? 'X' : token === room.players.O ? 'O' : null;

    if (!role || role !== room.current || room.over) { json(400, { error: 'Not your turn' }); return; }
    if (row < 0 || row >= room.size || col < 0 || col >= room.size) { json(400, { error: 'Out of bounds' }); return; }
    const idx = row * room.size + col;
    if (room.board[idx] !== null) { json(400, { error: 'Cell taken' }); return; }

    room.board[idx] = role;
    const winLine = checkWin(room.board, row, col, role, room.size);

    if (winLine) {
      room.over = true;
      broadcast(room, { type: 'move', row, col, player: role, winLine, over: true, winner: role });
    } else if (room.board.every(v => v !== null)) {
      room.over = true;
      broadcast(room, { type: 'move', row, col, player: role, over: true, winner: null });
    } else {
      room.current = role === 'X' ? 'O' : 'X';
      broadcast(room, { type: 'move', row, col, player: role, current: room.current });
    }

    json(200, { ok: true });
    return;
  }

  // ── POST /api/reset/:code → reset / resize ───────────────────────────
  if ((mx = p.match(/^\/api\/reset\/([A-Z0-9]{4})$/)) && m === 'POST') {
    const code = mx[1];
    const room = rooms.get(code);
    if (!room) { json(404, {}); return; }

    const { token, size } = await parseBody(req);
    if (token !== room.players.X && token !== room.players.O) { json(403, {}); return; }

    const newSize    = clamp(size || room.size, 8, 25);
    room.board   = Array(newSize * newSize).fill(null);
    room.size    = newSize;
    room.current = 'X';
    room.over    = false;
    broadcast(room, { type: 'reset', size: newSize });
    json(200, { ok: true });
    return;
  }

  // ══════════════════════════════════════════════════════════
  //  WORD GAME routes  /api/wg/…
  // ══════════════════════════════════════════════════════════

  // GET /api/wg/dict — serve 2-syllable word list for client-side caching
  if (p === '/api/wg/dict' && m === 'GET') {
    res.writeHead(200, {
      'Content-Type':  'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(Array.from(wgWordSet).join('\n'));
    return;
  }

  // POST /api/wg/room — create room
  if (p === '/api/wg/room' && m === 'POST') {
    const body = await parseBody(req);
    const max  = clamp(body.maxPlayers || 3, 2, 4);
    const nick = safeNick(body.nickname) || 'Người chơi';
    const code = mkCode(); const token = uid();
    const room = makeWgRoom(max);
    room.hostToken = token;
    room.players.push({ token, nick, alive: true });
    wgRooms.set(code, room);
    json(200, { code, token, playerIdx: 0 });
    return;
  }

  // POST /api/wg/room/:code — join room
  if ((mx = p.match(/^\/api\/wg\/room\/([A-Z0-9]{4})$/)) && m === 'POST') {
    const code = mx[1]; const room = wgRooms.get(code);
    if (!room) { json(404, { error: 'Không tìm thấy phòng' }); return; }
    const body = await parseBody(req);

    // Rejoin
    if (body.token) {
      const idx = room.players.findIndex(q => q.token === body.token);
      if (idx !== -1) {
        json(200, { code, token: body.token, playerIdx: idx,
          players: room.players.map(({nick,alive}) => ({nick,alive})),
          phase: room.phase, currIdx: room.currIdx, deadline: room.deadline, lastSyl: room.lastSyl,
          words:  room.words.map(({word,playerIdx}) => ({word,playerIdx})) });
        return;
      }
    }

    if (room.phase !== 'lobby')              { json(409, { error: 'Trò chơi đã bắt đầu' }); return; }
    if (room.players.length >= room.maxPlayers) { json(409, { error: 'Phòng đã đầy' }); return; }

    const token = uid(); const nick = safeNick(body.nickname) || 'Người chơi';
    room.players.push({ token, nick, alive: true });
    const playerIdx = room.players.length - 1;
    const sanitised = room.players.map(({nick,alive}) => ({nick,alive}));
    broadcast(room, { type: 'wg:playerJoined', players: sanitised });
    json(200, { code, token, playerIdx, players: sanitised, phase: room.phase });
    return;
  }

  // GET /api/wg/events/:code — SSE
  if ((mx = p.match(/^\/api\/wg\/events\/([A-Z0-9]{4})$/)) && m === 'GET') {
    const code = mx[1]; const room = wgRooms.get(code);
    if (!room) { res.writeHead(404); res.end(); return; }
    const cid = url.searchParams.get('token') || uid(4);
    res.writeHead(200, { 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', 'Connection':'keep-alive' });
    res.write('data: {"type":"wg:connected"}\n\n');
    room.clients.set(cid, res);
    req.on('close', () => room.clients.delete(cid));
    return;
  }

  // POST /api/wg/start/:code — start game (host only)
  if ((mx = p.match(/^\/api\/wg\/start\/([A-Z0-9]{4})$/)) && m === 'POST') {
    const code = mx[1]; const room = wgRooms.get(code);
    if (!room) { json(404, {}); return; }
    const { token } = await parseBody(req);
    if (token !== room.hostToken)       { json(403, { error: 'Chỉ chủ phòng mới được bắt đầu' }); return; }
    if (room.players.length < 2)        { json(400, { error: 'Cần ít nhất 2 người chơi' }); return; }
    if (room.phase !== 'lobby')         { json(400, { error: 'Đã bắt đầu rồi' }); return; }

    room.phase   = 'playing';
    room.currIdx = 0;
    wgSetDeadline(room, code);
    broadcast(room, { type: 'wg:start',
      players:  room.players.map(({nick,alive}) => ({nick,alive})),
      currIdx:  0, deadline: room.deadline });
    json(200, { ok: true });
    return;
  }

  // POST /api/wg/word/:code — submit word
  if ((mx = p.match(/^\/api\/wg\/word\/([A-Z0-9]{4})$/)) && m === 'POST') {
    const code = mx[1]; const room = wgRooms.get(code);
    if (!room || room.phase !== 'playing') { json(400, {}); return; }
    const { token, word } = await parseBody(req);
    const pIdx = room.players.findIndex(q => q.token === token);
    if (pIdx !== room.currIdx || !room.players[pIdx]?.alive) { json(400, { error: 'Chưa đến lượt bạn' }); return; }
    if (room.deadline && Date.now() > room.deadline + 2000)  { json(400, { error: 'Hết giờ rồi!' }); return; }

    const clean = wgSplitSyls(word).join(' ');
    const err   = wgValidate(room, clean);
    if (err) { json(400, { error: err }); return; }

    const syls    = wgSplitSyls(clean);
    const lastSyl = syls[syls.length - 1];
    room.usedWords.add(clean);
    room.lastSyl = lastSyl;
    room.words.push({ word: clean, playerIdx: pIdx });

    // Advance turn
    const nextIdx = wgNextIdx(room, pIdx);
    room.currIdx  = nextIdx;
    wgSetDeadline(room, code);
    broadcast(room, { type: 'wg:word', word: clean, lastSyl, playerIdx: pIdx, currIdx: nextIdx, deadline: room.deadline });
    json(200, { ok: true });
    return;
  }

  // POST /api/wg/pass/:code — forfeit turn (eliminates player)
  if ((mx = p.match(/^\/api\/wg\/pass\/([A-Z0-9]{4})$/)) && m === 'POST') {
    const code = mx[1]; const room = wgRooms.get(code);
    if (!room || room.phase !== 'playing') { json(400, {}); return; }
    const { token } = await parseBody(req);
    const pIdx = room.players.findIndex(q => q.token === token);
    if (pIdx !== room.currIdx) { json(400, {}); return; }
    wgEliminate(room, code, pIdx, 'pass');
    json(200, { ok: true });
    return;
  }

  res.writeHead(404); res.end();
});

// ── Stale room GC (rooms inactive > 2h) ──────────────────────────────────
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [k, r] of rooms)
    if (r.createdAt < cutoff && r.clients.size === 0) rooms.delete(k);
  for (const [k, r] of wgRooms) {
    if (r.createdAt < cutoff && r.clients.size === 0) {
      if (r.timerRef) clearTimeout(r.timerRef);
      wgRooms.delete(k);
    }
  }
}, 15 * 60 * 1000);

// ── Start ─────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  const ip = localIP();
  console.log('\n🎮  Game Zone — Server đang chạy!\n');
  console.log(`   Máy bạn   →  http://localhost:${PORT}`);
  console.log(`   Mạng WiFi →  http://${ip}:${PORT}   ← chia sẻ cho đồng nghiệp!\n`);
});
