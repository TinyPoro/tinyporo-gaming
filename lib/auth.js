'use strict';

const db = require('../db');
const { parseBody } = require('./shared');

const bearerToken = r => {
  const h = r.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
};

const validUsername = s => /^[a-zA-Z0-9_]{1,20}$/.test(s);

async function authRoutes(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p   = url.pathname;
  const m   = req.method;

  const json = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  if (p === '/api/auth/register' && m === 'POST') {
    const { username = '', password = '' } = await parseBody(req);
    if (!validUsername(username)) {
      json(400, { error: 'Tên đăng nhập chỉ gồm chữ, số, gạch dưới (1–20 ký tự)' }); return true;
    }
    if (password.length < 6 || password.length > 100) {
      json(400, { error: 'Mật khẩu phải từ 6 ký tự trở lên' }); return true;
    }
    if (db.findUserByUsername(username)) {
      json(409, { error: 'Tên đăng nhập đã tồn tại' }); return true;
    }
    const { salt, hash } = await db.hashPassword(password);
    const user  = db.createUser(username, salt, hash);
    const token = db.createSession(user.id);
    json(200, { token, username: user.username });
    return true;
  }

  if (p === '/api/auth/login' && m === 'POST') {
    const { username = '', password = '' } = await parseBody(req);
    const user = db.findUserByUsername(username);
    if (!user) { json(401, { error: 'Tên đăng nhập hoặc mật khẩu không đúng' }); return true; }
    const ok = await db.verifyPassword(password, user.salt, user.password_hash);
    if (!ok)   { json(401, { error: 'Tên đăng nhập hoặc mật khẩu không đúng' }); return true; }
    const token = db.createSession(user.id);
    json(200, { token, username: user.username });
    return true;
  }

  if (p === '/api/auth/logout' && m === 'POST') {
    const token = bearerToken(req);
    if (token) db.deleteSession(token);
    json(200, { ok: true });
    return true;
  }

  if (p === '/api/auth/me' && m === 'GET') {
    const token = bearerToken(req);
    if (!token) { json(401, { error: 'Chưa đăng nhập' }); return true; }
    const user = db.findSession(token);
    if (!user)  { json(401, { error: 'Phiên đăng nhập hết hạn' }); return true; }
    json(200, { username: user.username });
    return true;
  }

  return false;
}

module.exports = authRoutes;
