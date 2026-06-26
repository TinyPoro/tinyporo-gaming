'use strict';

const { broadcast } = require('../../lib/shared');
const wgWordSet     = require('../../lib/dict');

const wgRooms    = new Map();
const WG_TURN_MS = 30_000;

function makeWgRoom(maxPlayers) {
  return {
    phase:      'lobby',
    maxPlayers,
    players:    [],
    hostToken:  null,
    usedWords:  new Set(),
    words:      [],
    lastSyl:    null,
    currIdx:    0,
    timerRef:   null,
    deadline:   null,
    clients:    new Map(),
    createdAt:  Date.now(),
  };
}

const wgSplitSyls = w => w.trim().toLowerCase().normalize('NFC').split(/\s+/).filter(Boolean);

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
  if (!syls.length)      return 'Từ không hợp lệ';
  if (syls.length !== 2) return 'Từ phải có đúng 2 tiếng (VD: "học sinh", "bạn bè")';
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

module.exports = { wgRooms, WG_TURN_MS, makeWgRoom, wgSplitSyls, wgValidate, wgNextIdx, wgSetDeadline, wgEliminate };
