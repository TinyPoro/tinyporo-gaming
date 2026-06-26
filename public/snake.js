// ══════════════════════════════════════════════
//  SNAKE GAME (Rắn Săn Mồi)
// ══════════════════════════════════════════════

const SNAKE_GRID = 20; // 20×20 grid

let snakePhase       = 'idle';   // 'idle' | 'playing' | 'gameover'
let snakeBoard       = null;     // canvas element
let snakeCtx         = null;     // 2d context
let snakeCellSize    = 20;       // pixels per cell, recalculated on resize
let snakeBody        = [];       // [{x,y}], head is index 0
let snakeDir         = { x: 1, y: 0 };
let snakeDirNext     = { x: 1, y: 0 }; // buffered direction change
let snakeFood        = { x: 0, y: 0 };
let snakeScore       = 0;
let snakeInterval    = null;
let snakeSpeed       = 150;      // ms between ticks
let snakeLeaderboard = [];

// ── Keyboard handler ──────────────────────────────────────────
function snakeKeyHandler(e) {
  const map = {
    ArrowUp:    { x: 0,  y: -1 },
    w:          { x: 0,  y: -1 },
    W:          { x: 0,  y: -1 },
    ArrowDown:  { x: 0,  y: 1  },
    s:          { x: 0,  y: 1  },
    S:          { x: 0,  y: 1  },
    ArrowLeft:  { x: -1, y: 0  },
    a:          { x: -1, y: 0  },
    A:          { x: -1, y: 0  },
    ArrowRight: { x: 1,  y: 0  },
    d:          { x: 1,  y: 0  },
    D:          { x: 1,  y: 0  },
  };
  const nd = map[e.key];
  if (!nd) return;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
  // Prevent 180-degree reverse
  if (nd.x === -snakeDir.x && nd.y === -snakeDir.y) return;
  snakeDirNext = nd;
}

// ── D-pad for mobile ──────────────────────────────────────────
function snakeDpad(dir) {
  const map = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
  const nd = map[dir]; if (!nd) return;
  if (nd.x === -snakeDir.x && nd.y === -snakeDir.y) return;
  snakeDirNext = nd;
}

// ── Open / close overlay ──────────────────────────────────────
function openSnake() {
  const overlay = $('snake-overlay');
  if (!overlay) return;
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';

  snakeBoard = $('snake-canvas');
  snakeCtx   = snakeBoard ? snakeBoard.getContext('2d') : null;

  snakeResize();
  snakeNewGame();
  snakeFetchLB();
  document.addEventListener('keydown', snakeKeyHandler);
}

function closeSnake() {
  clearInterval(snakeInterval);
  snakeInterval = null;
  document.removeEventListener('keydown', snakeKeyHandler);
  const overlay = $('snake-overlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
  snakePhase = 'idle';
}

// ── Leaderboard ───────────────────────────────────────────────
async function snakeFetchLB() {
  try {
    const res = await fetch('/api/snake/leaderboard');
    if (!res.ok) throw new Error();
    const data = await res.json();
    snakeLeaderboard = data.scores || [];
    snakeRenderLB();
  } catch {
    // silently ignore — server may not have the endpoint yet
  }
}

function snakeRenderLB() {
  const el = $('snake-lb-list'); if (!el) return;
  if (!snakeLeaderboard.length) {
    el.innerHTML = '<p style="font-size:.8rem;color:var(--muted)">Chưa có điểm nào.</p>';
    return;
  }
  el.innerHTML = snakeLeaderboard.map((s, i) => {
    const medal = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
    return `<div class="snake-lb-row ${medal}">
      <span class="snake-lb-rank">${i + 1}</span>
      <span class="snake-lb-name">${s.player_name}</span>
      <span class="snake-lb-score">${s.score}</span>
    </div>`;
  }).join('');
}

// ── New game ──────────────────────────────────────────────────
function snakeNewGame() {
  clearInterval(snakeInterval);
  snakeInterval = null;

  snakeBody    = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
  snakeDir     = { x: 1, y: 0 };
  snakeDirNext = { x: 1, y: 0 };
  snakeScore   = 0;
  snakeSpeed   = 150;
  snakePhase   = 'playing';

  snakePlaceFood();

  // Clear gameover panel
  const goPanel = $('snake-gameover-panel');
  if (goPanel) { goPanel.style.display = 'none'; goPanel.innerHTML = ''; }

  // Update score display
  snakeUpdateScore();

  snakeInterval = setInterval(snakeTick, snakeSpeed);
  snakeDraw();
}

// ── Place food not on snake ───────────────────────────────────
function snakePlaceFood() {
  const occupied = new Set(snakeBody.map(s => s.x + ',' + s.y));
  let x, y;
  do {
    x = Math.floor(Math.random() * SNAKE_GRID);
    y = Math.floor(Math.random() * SNAKE_GRID);
  } while (occupied.has(x + ',' + y));
  snakeFood = { x, y };
}

// ── Score display ─────────────────────────────────────────────
function snakeUpdateScore() {
  const el = $('snake-score-display');
  if (el) el.textContent = 'Điểm: ' + snakeScore;
}

// ── Game tick ─────────────────────────────────────────────────
function snakeTick() {
  if (snakePhase !== 'playing') return;

  // Update direction
  snakeDir = snakeDirNext;

  const head = snakeBody[0];
  const newHead = { x: head.x + snakeDir.x, y: head.y + snakeDir.y };

  // Wall collision → game over
  if (newHead.x < 0 || newHead.x >= SNAKE_GRID || newHead.y < 0 || newHead.y >= SNAKE_GRID) {
    snakeGameOver();
    return;
  }

  // Self collision
  for (const seg of snakeBody) {
    if (seg.x === newHead.x && seg.y === newHead.y) {
      snakeGameOver();
      return;
    }
  }

  const ateFood = newHead.x === snakeFood.x && newHead.y === snakeFood.y;

  snakeBody.unshift(newHead);

  if (ateFood) {
    snakeScore++;
    snakeUpdateScore();
    snakePlaceFood();

    // Speed up every 5 points
    const newSpeed = Math.max(70, 150 - Math.floor(snakeScore / 5) * 5);
    if (newSpeed !== snakeSpeed) {
      snakeSpeed = newSpeed;
      clearInterval(snakeInterval);
      snakeInterval = setInterval(snakeTick, snakeSpeed);
    }
  } else {
    snakeBody.pop();
  }

  snakeDraw();
}

// ── Draw ──────────────────────────────────────────────────────
function snakeDraw() {
  if (!snakeCtx || !snakeBoard) return;

  const ctx  = snakeCtx;
  const size = snakeCellSize;
  const W    = snakeBoard.width;
  const H    = snakeBoard.height;

  // Background
  ctx.fillStyle = '#0d0e1f';
  ctx.fillRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= SNAKE_GRID; i++) {
    ctx.beginPath();
    ctx.moveTo(i * size, 0);
    ctx.lineTo(i * size, H);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * size);
    ctx.lineTo(W, i * size);
    ctx.stroke();
  }

  // Food
  const fx = snakeFood.x * size + size / 2;
  const fy = snakeFood.y * size + size / 2;
  ctx.save();
  ctx.shadowBlur   = 8;
  ctx.shadowColor  = '#ff6b9d';
  ctx.fillStyle    = '#ff6b9d';
  ctx.beginPath();
  ctx.arc(fx, fy, size * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Snake segments
  snakeBody.forEach((seg, idx) => {
    const x = seg.x * size;
    const y = seg.y * size;
    const r = 3; // corner radius
    const pad = 1;

    ctx.fillStyle = idx === 0 ? '#7c6fff' : 'rgba(124,111,255,0.75)';

    // Rounded rect using arc corners
    const x1 = x + pad, y1 = y + pad;
    const w1 = size - pad * 2, h1 = size - pad * 2;

    ctx.beginPath();
    ctx.moveTo(x1 + r, y1);
    ctx.lineTo(x1 + w1 - r, y1);
    ctx.arcTo(x1 + w1, y1, x1 + w1, y1 + r, r);
    ctx.lineTo(x1 + w1, y1 + h1 - r);
    ctx.arcTo(x1 + w1, y1 + h1, x1 + w1 - r, y1 + h1, r);
    ctx.lineTo(x1 + r, y1 + h1);
    ctx.arcTo(x1, y1 + h1, x1, y1 + h1 - r, r);
    ctx.lineTo(x1, y1 + r);
    ctx.arcTo(x1, y1, x1 + r, y1, r);
    ctx.closePath();
    ctx.fill();
  });

  // Score inside canvas (top-left)
  ctx.font      = 'bold 14px system-ui';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('Điểm: ' + snakeScore, 8, 20);
}

// ── Game over ─────────────────────────────────────────────────
function snakeGameOver() {
  clearInterval(snakeInterval);
  snakeInterval = null;
  snakePhase = 'gameover';

  const goPanel = $('snake-gameover-panel');
  if (!goPanel) return;

  goPanel.innerHTML = `<div class="snake-go-box">
    <div class="snake-go-title">💀 Game Over</div>
    <div class="snake-go-score">${snakeScore} điểm</div>
    <input id="snake-go-name" class="nick-input" placeholder="Tên của bạn..." maxlength="20" value="${(typeof authUser !== 'undefined' && authUser) ? authUser : ''}">
    <button class="lobby-create-btn" onclick="snakeSaveScore()">💾 Lưu điểm</button>
    <button class="join-btn" style="margin-top:.25rem" onclick="snakeNewGame()">↺ Chơi lại</button>
    <div id="snake-go-err" style="display:none;color:var(--pink);font-size:.82rem;"></div>
  </div>`;

  goPanel.style.display = 'flex';
}

// ── Save score ────────────────────────────────────────────────
async function snakeSaveScore() {
  const nameEl = $('snake-go-name');
  const errEl  = $('snake-go-err');
  if (!nameEl || !errEl) return;

  const name = (nameEl.value || '').trim();
  if (!name) {
    errEl.textContent  = 'Hãy nhập tên của bạn';
    errEl.style.display = 'block';
    return;
  }

  errEl.style.display = 'none';

  try {
    const res = await fetch('/api/snake/score', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, score: snakeScore }),
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    snakeLeaderboard = data.scores || [];
    snakeRenderLB();

    // Update gameover panel to show saved state
    const goPanel = $('snake-gameover-panel');
    if (goPanel) {
      const box = goPanel.querySelector('.snake-go-box');
      if (box) {
        const saveBtn = box.querySelector('.lobby-create-btn');
        if (saveBtn) { saveBtn.textContent = '✅ Đã lưu!'; saveBtn.disabled = true; }
        nameEl.disabled = true;
      }
    }
  } catch {
    errEl.textContent  = 'Không thể lưu điểm. Vui lòng thử lại.';
    errEl.style.display = 'block';
  }
}

// ── Canvas resize ─────────────────────────────────────────────
function snakeResize() {
  const overlay = $('snake-overlay');
  if (!overlay?.classList.contains('open')) return;
  const col   = $('snake-canvas-col');
  const avail = Math.min(col?.clientWidth || 400, window.innerHeight - 200, 500);
  snakeCellSize = Math.floor(avail / SNAKE_GRID);
  const size    = snakeCellSize * SNAKE_GRID;
  if (snakeBoard) {
    snakeBoard.width  = size;
    snakeBoard.height = size;
  }
  snakeDraw();
}

window.addEventListener('resize', snakeResize);
