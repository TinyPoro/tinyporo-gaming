// ══════════════════════════════════════════════════════════
//  CỜ CARO
// ══════════════════════════════════════════════════════════
const WIN_LEN = 5;

let SIZE    = 15;
let board   = [];
let current = 'X';
let over    = false;

let mpMode   = false;
let myRole   = null;
let myToken  = null;
let roomCode = null;
let evtSrc   = null;
let nicknames = { X: '', O: '' };

let boardEl, statusEl, cardX, cardO;

// ── Screen management ──────────────────────────────────────────────────────
function showScreen(id) {
  ['screen-mode', 'screen-lobby', 'caro-wrap'].forEach(s => {
    $( s).classList.toggle('active', s === id);
  });
}

function handleBack() {
  const active = document.querySelector('.ov-screen.active');
  const id = active ? active.id : null;
  if (id === 'screen-mode' || !id) closeGame();
  else showModeScreen();
}

// ── Overlay open / close ───────────────────────────────────────────────────
function openGame() {
  $('game-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  showScreen('screen-mode');
}

function closeGame() {
  $('game-overlay').classList.remove('open');
  document.body.style.overflow = '';
  closeMPConn();
}

// ── Mode selection ─────────────────────────────────────────────────────────
function showModeScreen() {
  closeMPConn();
  showScreen('screen-mode');
  $('overlay-title').textContent = 'Cờ Caro';
}

function startLocal() {
  mpMode = false; myRole = null;
  ensureDOMRefs();
  $('role-badge').style.display = 'none';
  $('name-x').textContent = 'Người chơi X';
  $('name-o').textContent = 'Người chơi O';
  showScreen('caro-wrap');
  localReset();
}

function showLobby() {
  showScreen('screen-lobby');
  $('lobby-forms').style.display   = 'block';
  $('lobby-waiting').style.display = 'none';
  $('lobby-error').style.display   = 'none';
  $('code-input').value = '';
  $('overlay-title').textContent = 'Phòng chơi — WiFi';
  prefillNicknames();
  setTimeout(() => $('nick-input').focus(), 80);
}

// ── Multiplayer: lobby ─────────────────────────────────────────────────────
async function createRoom() {
  hideLobbyError();
  const myNick = ($('nick-input').value || '').trim();
  try {
    const res = await fetch('/api/room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ size: SIZE, nickname: myNick }),
    });
    if (!res.ok) throw new Error();
    const data = await res.json();

    roomCode = data.code; myToken = data.token; myRole = 'X';
    nicknames.X = myNick;
    sessionStorage.setItem('gz-token-' + roomCode, myToken);

    $('room-code-display').textContent = roomCode;
    $('lobby-forms').style.display   = 'none';
    $('lobby-waiting').style.display = 'block';
    setupSSE();
  } catch {
    showLobbyError('Không thể kết nối server. Hãy chạy: node server.js');
  }
}

async function joinRoomAction() {
  hideLobbyError();
  const code = ($('code-input').value || '').trim().toUpperCase();
  if (code.length !== 4) { showLobbyError('Mã phòng phải đủ 4 ký tự'); return; }

  const myNick = ($('nick-input').value || '').trim();
  const saved  = sessionStorage.getItem('gz-token-' + code);
  try {
    const res = await fetch('/api/room/' + code, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: saved || undefined, nickname: myNick }),
    });
    if (res.status === 404) { showLobbyError('Không tìm thấy phòng. Kiểm tra lại mã!'); return; }
    if (!res.ok) throw new Error();
    const data = await res.json();

    roomCode = code; myToken = data.token; myRole = data.role;
    if (myToken) sessionStorage.setItem('gz-token-' + roomCode, myToken);

    if (data.nicknames) nicknames = { ...data.nicknames };
    if (myRole === 'O') nicknames.O = myNick;

    SIZE    = data.size;
    board   = Array.from({ length: SIZE }, (_, r) =>
                Array.from({ length: SIZE }, (_, c) => data.board[r * SIZE + c]));
    current = data.current;
    over    = data.over;

    syncSizeUI();
    setupSSE();

    if (myRole !== 'X' || data.oReady) enterMPGame();
    else {
      $('room-code-display').textContent = roomCode;
      $('lobby-forms').style.display   = 'none';
      $('lobby-waiting').style.display = 'block';
    }
  } catch {
    showLobbyError('Lỗi kết nối. Kiểm tra server đang chạy!');
  }
}

function showLobbyError(msg) {
  const el = $('lobby-error'); el.textContent = msg; el.style.display = 'block';
}
function hideLobbyError() { $('lobby-error').style.display = 'none'; }

function copyCode() {
  const text = roomCode;
  const btn  = $('copy-btn');
  const done = () => { btn.textContent = '✅'; setTimeout(() => { btn.textContent = '📋'; }, 2000); };
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand('copy'); done(); } catch {}
    document.body.removeChild(ta);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(fallback);
  } else { fallback(); }
}

// ── Multiplayer: SSE ───────────────────────────────────────────────────────
function setupSSE() {
  if (evtSrc) evtSrc.close();
  evtSrc = new EventSource('/api/events/' + roomCode + '?token=' + (myToken || 'spec'));
  evtSrc.onmessage = e => handleServerEvent(JSON.parse(e.data));
}

function closeMPConn() {
  if (evtSrc) { evtSrc.close(); evtSrc = null; }
  mpMode = false; myRole = null; myToken = null; roomCode = null;
  nicknames = { X: '', O: '' };
}

function handleServerEvent(data) {
  if (data.type === 'connected') return;

  if (data.type === 'playerJoined') {
    if (data.oNickname !== undefined) nicknames.O = data.oNickname;
    if (myRole === 'X') enterMPGame();
    return;
  }

  if (data.type === 'move') {
    ensureDOMRefs();
    const { row, col, player, winLine, over: isOver, current: next } = data;
    board[row][col] = player;
    const el = getCellEl(row, col);
    el.textContent = player;
    el.classList.add('c' + player.toLowerCase(), 'taken', 'pop');

    if (isOver) {
      over = true;
      if (winLine) {
        winLine.forEach(([wr, wc]) => getCellEl(wr, wc).classList.add('win'));
        const col2    = player === 'X' ? '#ff6b9d' : '#00d4ff';
        const winName = nicknames[player] || player;
        statusEl.innerHTML = `<span style="color:${col2}">${winName}</span> thắng! 🎉`;
      } else {
        statusEl.textContent = 'Hòa! 🤝';
      }
    } else {
      current = next;
      updateStatus();
    }
    return;
  }

  if (data.type === 'reset') {
    SIZE    = data.size;
    board   = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    current = 'X';
    over    = false;
    syncSizeUI();
    if ($('overlay-title')) $('overlay-title').textContent = `Cờ Caro — Bàn ${SIZE}×${SIZE}`;
    buildGrid();
    updateStatus();
  }
}

function enterMPGame() {
  mpMode = true;
  ensureDOMRefs();

  const badge  = $('role-badge');
  const colors = { X: '#ff6b9d', O: '#00d4ff', spectator: '#888' };
  badge.style.display = 'block';

  if (myRole === 'spectator') {
    badge.innerHTML = '<span style="color:#888">👁️ Khán giả</span>';
  } else {
    const myName = nicknames[myRole];
    badge.innerHTML = `Bạn là <span style="color:${colors[myRole]};font-weight:900">${myRole}</span>`
      + (myName ? ` <span style="color:var(--muted);font-size:.82em">(${myName})</span>` : '');
  }

  const xLabel = nicknames.X || 'Người chơi X';
  const oLabel = nicknames.O || 'Người chơi O';
  $('name-x').textContent = myRole === 'X' ? `${xLabel} (bạn)` : xLabel;
  $('name-o').textContent = myRole === 'O' ? `${oLabel} (bạn)` : oLabel;

  showScreen('caro-wrap');
  $('overlay-title').textContent = `Cờ Caro — Bàn ${SIZE}×${SIZE}`;
  buildGrid();

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = board[r][c];
      if (v) {
        const el = getCellEl(r, c);
        el.textContent = v;
        el.classList.add('c' + v.toLowerCase(), 'taken');
      }
    }
  }
  updateStatus();
}

// ── Game logic ─────────────────────────────────────────────────────────────
function ensureDOMRefs() {
  if (!boardEl) {
    boardEl  = $('caro-board');
    statusEl = $('status-msg');
    cardX    = $('card-x');
    cardO    = $('card-o');
  }
}

function localReset() {
  board   = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  current = 'X';
  over    = false;
  if ($('overlay-title')) $('overlay-title').textContent = `Cờ Caro — Bàn ${SIZE}×${SIZE}`;
  buildGrid();
  updateStatus();
}

function resetGame() {
  if (mpMode) {
    fetch('/api/reset/' + roomCode, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: myToken, size: SIZE }),
    }).catch(() => {});
    return;
  }
  localReset();
}

function buildGrid() {
  ensureDOMRefs();
  const px = calcCellSize();
  boardEl.style.gridTemplateColumns = `repeat(${SIZE}, ${px}px)`;
  boardEl.innerHTML = '';
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = document.createElement('div');
      cell.className = 'cc';
      cell.style.width    = px + 'px';
      cell.style.height   = px + 'px';
      cell.style.fontSize = Math.max(9, px * 0.5) + 'px';
      cell.dataset.r = r; cell.dataset.c = c;
      cell.addEventListener('click', onCellClick);
      boardEl.appendChild(cell);
    }
  }
}

function calcCellSize() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const availW = vw < 680 ? vw - 24 : vw - 260 - 80;
  const availH = vh - 58 - 80;
  return Math.max(22, Math.min(42, Math.floor(Math.min(availW, availH) / SIZE)));
}

function onCellClick(e) {
  if (over) return;
  const r = +e.currentTarget.dataset.r;
  const c = +e.currentTarget.dataset.c;
  if (board[r][c]) return;

  if (mpMode) {
    if (myRole !== current || myRole === 'spectator') return;
    fetch('/api/move/' + roomCode, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: myToken, row: r, col: c }),
    }).catch(() => {});
    return;
  }

  board[r][c] = current;
  const el = e.currentTarget;
  el.textContent = current;
  el.classList.add('c' + current.toLowerCase(), 'taken', 'pop');

  const winLine = checkWin(r, c);
  if (winLine) {
    over = true;
    winLine.forEach(([wr, wc]) => getCellEl(wr, wc).classList.add('win'));
    const col     = current === 'X' ? '#ff6b9d' : '#00d4ff';
    const winName = nicknames[current] || current;
    statusEl.innerHTML = `<span style="color:${col}">${winName}</span> thắng! 🎉`;
    return;
  }
  if (isDraw()) { over = true; statusEl.textContent = 'Hòa! 🤝'; return; }
  current = current === 'X' ? 'O' : 'X';
  updateStatus();
}

function getCellEl(r, c) {
  return boardEl ? boardEl.querySelector(`[data-r="${r}"][data-c="${c}"]`) : null;
}

function checkWin(r, c) {
  const p = board[r][c];
  for (const [dr, dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
    const line = collect(r, c, dr, dc, p).concat(collect(r, c, -dr, -dc, p).slice(1));
    if (line.length >= WIN_LEN) return line.slice(0, WIN_LEN);
  }
  return null;
}

function collect(r, c, dr, dc, p) {
  const cells = [];
  for (let i = 0; i < WIN_LEN; i++) {
    const nr = r + dr * i, nc = c + dc * i;
    if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) break;
    if (board[nr][nc] !== p) break;
    cells.push([nr, nc]);
  }
  return cells;
}

function isDraw() { return board.every(row => row.every(v => v !== null)); }

function updateStatus() {
  ensureDOMRefs();
  const col         = current === 'X' ? '#ff6b9d' : '#00d4ff';
  const currentName = nicknames[current] || current;

  if (mpMode && myRole !== 'spectator') {
    const mine = current === myRole;
    statusEl.innerHTML = mine
      ? `<span style="color:${col}">Lượt của bạn!</span>`
      : `<span style="color:${col}">Chờ ${currentName}...</span>`;
  } else {
    statusEl.innerHTML = `Lượt của <span style="color:${col};font-weight:900">${currentName}</span>`;
  }

  if (cardX) cardX.className = 'player-card' + (current === 'X' ? ' active-x' : '');
  if (cardO) cardO.className = 'player-card' + (current === 'O' ? ' active-o' : '');
}

// ── Size control ───────────────────────────────────────────────────────────
function syncSizeUI() {
  $('size-val').textContent = `${SIZE}×${SIZE}`;
  $('size-slider').value    = String(SIZE);
  document.querySelectorAll('.size-preset').forEach(btn => {
    btn.classList.toggle('active', +btn.dataset.size === SIZE);
  });
}

function onSizeSlide(n) { SIZE = n; syncSizeUI(); resetGame(); }
function setSize(n)     { SIZE = n; syncSizeUI(); resetGame(); }

// ── Resize handler ─────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  if (!$('game-overlay').classList.contains('open')) return;
  if (!boardEl) return;
  const px = calcCellSize();
  boardEl.style.gridTemplateColumns = `repeat(${SIZE}, ${px}px)`;
  boardEl.querySelectorAll('.cc').forEach(el => {
    el.style.width    = px + 'px';
    el.style.height   = px + 'px';
    el.style.fontSize = Math.max(9, px * 0.5) + 'px';
  });
});
