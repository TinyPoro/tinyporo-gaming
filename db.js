'use strict';

const Database = require('better-sqlite3');
const crypto   = require('crypto');
const path     = require('path');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const db = new Database(path.join(__dirname, 'game.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL COLLATE NOCASE,
    salt          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );
`);

// ── Password helpers ──────────────────────────────────────────────────────────

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const buf  = await scrypt(password, salt, 64);
  return { salt, hash: buf.toString('hex') };
}

async function verifyPassword(password, salt, storedHash) {
  const buf = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(storedHash, 'hex'), buf);
}

// ── DB helpers ────────────────────────────────────────────────────────────────

const stmts = {
  findByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  insertUser:     db.prepare(
    'INSERT INTO users (username, salt, password_hash, created_at) VALUES (?, ?, ?, ?) RETURNING *'
  ),
  insertSession:  db.prepare(
    'INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)'
  ),
  findSession:    db.prepare(
    'SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'
  ),
  deleteSession:  db.prepare('DELETE FROM sessions WHERE token = ?'),
};

function findUserByUsername(username) {
  return stmts.findByUsername.get(username);
}

function createUser(username, salt, hash) {
  return stmts.insertUser.get(username, salt, hash, Date.now());
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  stmts.insertSession.run(token, userId, Date.now());
  return token;
}

function findSession(token) {
  return stmts.findSession.get(token) ?? null;
}

function deleteSession(token) {
  stmts.deleteSession.run(token);
}

module.exports = { hashPassword, verifyPassword, findUserByUsername, createUser, createSession, findSession, deleteSession };
