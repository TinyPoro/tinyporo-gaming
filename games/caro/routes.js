'use strict';

const { rooms, makeRoom, checkWin }               = require('./room');
const { uid, clamp, safeNick, mkCode, broadcast, parseBody } = require('../../lib/shared');

async function caroRoutes(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p   = url.pathname;
  const m   = req.method;

  const json = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  let mx;

  // POST /api/room → create room
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
    return true;
  }

  // POST /api/room/:code → join room
  if ((mx = p.match(/^\/api\/room\/([A-Z0-9]{4})$/)) && m === 'POST') {
    const code = mx[1];
    const room = rooms.get(code);
    if (!room) { json(404, { error: 'Room not found' }); return true; }
    const body = await parseBody(req);

    const snap = () => ({ board: room.board, size: room.size, current: room.current, over: room.over, nicknames: room.nicknames });

    if (body.token) {
      if (body.token === room.players.X) {
        json(200, { code, token: body.token, role: 'X', oReady: !!room.players.O, ...snap() });
        return true;
      }
      if (body.token === room.players.O) {
        json(200, { code, token: body.token, role: 'O', oReady: true, ...snap() });
        return true;
      }
    }

    if (!room.players.O) {
      const token = uid();
      room.players.O   = token;
      room.nicknames.O = safeNick(body.nickname);
      broadcast(room, { type: 'playerJoined', oNickname: room.nicknames.O });
      json(200, { code, token, role: 'O', oReady: true, ...snap() });
      return true;
    }

    json(200, { code, token: null, role: 'spectator', oReady: true, ...snap() });
    return true;
  }

  // GET /api/events/:code → SSE stream
  if ((mx = p.match(/^\/api\/events\/([A-Z0-9]{4})$/)) && m === 'GET') {
    const code = mx[1];
    const room = rooms.get(code);
    if (!room) { res.writeHead(404); res.end(); return true; }

    const cid = url.searchParams.get('token') || uid(4);
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    });
    res.write('data: {"type":"connected"}\n\n');
    room.clients.set(cid, res);
    req.on('close', () => room.clients.delete(cid));
    return true;
  }

  // POST /api/move/:code → make a move
  if ((mx = p.match(/^\/api\/move\/([A-Z0-9]{4})$/)) && m === 'POST') {
    const code = mx[1];
    const room = rooms.get(code);
    if (!room) { json(404, {}); return true; }

    const { token, row, col } = await parseBody(req);
    const role = token === room.players.X ? 'X' : token === room.players.O ? 'O' : null;

    if (!role || role !== room.current || room.over) { json(400, { error: 'Not your turn' }); return true; }
    if (row < 0 || row >= room.size || col < 0 || col >= room.size) { json(400, { error: 'Out of bounds' }); return true; }
    const idx = row * room.size + col;
    if (room.board[idx] !== null) { json(400, { error: 'Cell taken' }); return true; }

    room.board[idx] = role;
    const winLine   = checkWin(room.board, row, col, role, room.size);

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
    return true;
  }

  // POST /api/reset/:code → reset / resize
  if ((mx = p.match(/^\/api\/reset\/([A-Z0-9]{4})$/)) && m === 'POST') {
    const code = mx[1];
    const room = rooms.get(code);
    if (!room) { json(404, {}); return true; }

    const { token, size } = await parseBody(req);
    if (token !== room.players.X && token !== room.players.O) { json(403, {}); return true; }

    const newSize    = clamp(size || room.size, 8, 25);
    room.board   = Array(newSize * newSize).fill(null);
    room.size    = newSize;
    room.current = 'X';
    room.over    = false;
    broadcast(room, { type: 'reset', size: newSize });
    json(200, { ok: true });
    return true;
  }

  return false;
}

module.exports = { caroRoutes, rooms };
