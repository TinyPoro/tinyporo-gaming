'use strict';

const rooms = new Map();
const WIN   = 5;

function makeRoom(size) {
  return {
    board:     Array(size * size).fill(null),
    size,
    current:   'X',
    over:      false,
    players:   { X: null, O: null },
    nicknames: { X: '', O: '' },
    clients:   new Map(),
    createdAt: Date.now(),
  };
}

function checkWin(board, row, col, player, size) {
  for (const [dr, dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
    const fwd  = gather(board, row, col,  dr,  dc, player, size);
    const bwd  = gather(board, row, col, -dr, -dc, player, size);
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

module.exports = { rooms, makeRoom, checkWin };
