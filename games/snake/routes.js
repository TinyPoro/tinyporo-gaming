'use strict';
const db = require('../../db');
const { parseBody } = require('../../lib/shared');

async function snakeRoutes(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p   = url.pathname;
  const m   = req.method;

  const json = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // GET /api/snake/leaderboard
  if (p === '/api/snake/leaderboard' && m === 'GET') {
    json(200, { scores: db.getLeaderboard() });
    return true;
  }

  // POST /api/snake/score
  if (p === '/api/snake/score' && m === 'POST') {
    const { name, score } = await parseBody(req);
    const playerName = String(name || '').trim().slice(0, 20);
    const playerScore = parseInt(score, 10);
    if (!playerName || isNaN(playerScore) || playerScore < 0) {
      json(400, { error: 'Dữ liệu không hợp lệ' }); return true;
    }
    const scores = db.saveScore(playerName, playerScore);
    json(200, { scores });
    return true;
  }

  return false;
}

module.exports = { snakeRoutes };
