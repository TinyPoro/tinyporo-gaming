'use strict';

const crypto = require('crypto');

const uid   = (n = 8) => crypto.randomBytes(n).toString('hex');
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, +n || lo));
const safeNick = s => String(s || '').trim().slice(0, 20);

function mkCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const buf = crypto.randomBytes(4);
  for (let i = 0; i < 4; i++) s += chars[buf[i] % chars.length];
  return s;
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

module.exports = { uid, clamp, safeNick, mkCode, broadcast, parseBody };
