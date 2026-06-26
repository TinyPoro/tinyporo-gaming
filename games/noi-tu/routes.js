'use strict';

const { wgRooms, makeWgRoom, wgSplitSyls, wgValidate, wgNextIdx, wgSetDeadline, wgEliminate } = require('./room');
const { uid, clamp, safeNick, mkCode, broadcast, parseBody } = require('../../lib/shared');
const wgWordSet = require('../../lib/dict');

async function noiTuRoutes(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p   = url.pathname;
  const m   = req.method;

  const json = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  let mx;

  // GET /api/wg/dict — serve word list for client caching
  if (p === '/api/wg/dict' && m === 'GET') {
    res.writeHead(200, {
      'Content-Type':  'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(Array.from(wgWordSet).join('\n'));
    return true;
  }

  // POST /api/wg/room — create room
  if (p === '/api/wg/room' && m === 'POST') {
    const body  = await parseBody(req);
    const max   = clamp(body.maxPlayers || 3, 2, 4);
    const nick  = safeNick(body.nickname) || 'Người chơi';
    const code  = mkCode();
    const token = uid();
    const room  = makeWgRoom(max);
    room.hostToken = token;
    room.players.push({ token, nick, alive: true });
    wgRooms.set(code, room);
    json(200, { code, token, playerIdx: 0 });
    return true;
  }

  // POST /api/wg/room/:code — join room
  if ((mx = p.match(/^\/api\/wg\/room\/([A-Z0-9]{4})$/)) && m === 'POST') {
    const code = mx[1];
    const room = wgRooms.get(code);
    if (!room) { json(404, { error: 'Không tìm thấy phòng' }); return true; }
    const body = await parseBody(req);

    if (body.token) {
      const idx = room.players.findIndex(q => q.token === body.token);
      if (idx !== -1) {
        json(200, {
          code, token: body.token, playerIdx: idx,
          players:  room.players.map(({ nick, alive }) => ({ nick, alive })),
          phase:    room.phase,
          currIdx:  room.currIdx,
          deadline: room.deadline,
          lastSyl:  room.lastSyl,
          words:    room.words.map(({ word, playerIdx }) => ({ word, playerIdx })),
        });
        return true;
      }
    }

    if (room.phase !== 'lobby')               { json(409, { error: 'Trò chơi đã bắt đầu' }); return true; }
    if (room.players.length >= room.maxPlayers) { json(409, { error: 'Phòng đã đầy' });        return true; }

    const token     = uid();
    const nick      = safeNick(body.nickname) || 'Người chơi';
    room.players.push({ token, nick, alive: true });
    const playerIdx = room.players.length - 1;
    const sanitised = room.players.map(({ nick, alive }) => ({ nick, alive }));
    broadcast(room, { type: 'wg:playerJoined', players: sanitised });
    json(200, { code, token, playerIdx, players: sanitised, phase: room.phase });
    return true;
  }

  // GET /api/wg/events/:code — SSE
  if ((mx = p.match(/^\/api\/wg\/events\/([A-Z0-9]{4})$/)) && m === 'GET') {
    const code = mx[1];
    const room = wgRooms.get(code);
    if (!room) { res.writeHead(404); res.end(); return true; }

    const cid = url.searchParams.get('token') || uid(4);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write('data: {"type":"wg:connected"}\n\n');
    room.clients.set(cid, res);
    req.on('close', () => room.clients.delete(cid));
    return true;
  }

  // POST /api/wg/start/:code — start game (host only)
  if ((mx = p.match(/^\/api\/wg\/start\/([A-Z0-9]{4})$/)) && m === 'POST') {
    const code = mx[1];
    const room = wgRooms.get(code);
    if (!room) { json(404, {}); return true; }
    const { token } = await parseBody(req);
    if (token !== room.hostToken)    { json(403, { error: 'Chỉ chủ phòng mới được bắt đầu' }); return true; }
    if (room.players.length < 2)     { json(400, { error: 'Cần ít nhất 2 người chơi' });        return true; }
    if (room.phase !== 'lobby')      { json(400, { error: 'Đã bắt đầu rồi' });                  return true; }

    room.phase   = 'playing';
    room.currIdx = 0;
    wgSetDeadline(room, code);
    broadcast(room, {
      type:    'wg:start',
      players: room.players.map(({ nick, alive }) => ({ nick, alive })),
      currIdx: 0,
      deadline: room.deadline,
    });
    json(200, { ok: true });
    return true;
  }

  // POST /api/wg/word/:code — submit word
  if ((mx = p.match(/^\/api\/wg\/word\/([A-Z0-9]{4})$/)) && m === 'POST') {
    const code = mx[1];
    const room = wgRooms.get(code);
    if (!room || room.phase !== 'playing') { json(400, {}); return true; }
    const { token, word } = await parseBody(req);
    const pIdx = room.players.findIndex(q => q.token === token);
    if (pIdx !== room.currIdx || !room.players[pIdx]?.alive) { json(400, { error: 'Chưa đến lượt bạn' }); return true; }
    if (room.deadline && Date.now() > room.deadline + 2000)  { json(400, { error: 'Hết giờ rồi!' });       return true; }

    const clean = wgSplitSyls(word).join(' ');
    const err   = wgValidate(room, clean);
    if (err) { json(400, { error: err }); return true; }

    const syls    = wgSplitSyls(clean);
    const lastSyl = syls[syls.length - 1];
    room.usedWords.add(clean);
    room.lastSyl = lastSyl;
    room.words.push({ word: clean, playerIdx: pIdx });

    const nextIdx = wgNextIdx(room, pIdx);
    room.currIdx  = nextIdx;
    wgSetDeadline(room, code);
    broadcast(room, { type: 'wg:word', word: clean, lastSyl, playerIdx: pIdx, currIdx: nextIdx, deadline: room.deadline });
    json(200, { ok: true });
    return true;
  }

  // POST /api/wg/pass/:code — forfeit turn (eliminates player)
  if ((mx = p.match(/^\/api\/wg\/pass\/([A-Z0-9]{4})$/)) && m === 'POST') {
    const code = mx[1];
    const room = wgRooms.get(code);
    if (!room || room.phase !== 'playing') { json(400, {}); return true; }
    const { token } = await parseBody(req);
    const pIdx = room.players.findIndex(q => q.token === token);
    if (pIdx !== room.currIdx) { json(400, {}); return true; }
    wgEliminate(room, code, pIdx, 'pass');
    json(200, { ok: true });
    return true;
  }

  return false;
}

module.exports = { noiTuRoutes, wgRooms };
