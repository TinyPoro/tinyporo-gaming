// ══════════════════════════════════════════════════════════
//  NỐI TỪ (Word Chain)
// ══════════════════════════════════════════════════════════
const WG_COLORS = ['#7c6fff', '#ff6b9d', '#00d4ff', '#43e97b'];
const WG_CIRC   = 2 * Math.PI * 34; // ≈ 213.6

// ── Vietnamese syllable validator ──────────────────────────────────────────
const _WG_VI_SYL = new RegExp(
  '^(?:ngh|nh|ng|ph|th|tr|ch|gh|gi|qu|kh|b|c|d|đ|g|h|k|l|m|n|p|r|s|t|v|x)?' +
  '[aàáảãạăằắẳẵặâầấẩẫậeèéẻẽẹêềếểễệiìíỉĩịoòóỏõọôồốổỗộơờớởỡợuùúủũụưừứửữựyỳýỷỹỵ]+' +
  '(?:ng|nh|ch|[cmnpt])?$'
);
const wgIsViSyl  = s => _WG_VI_SYL.test(s);
const wgIsViWord = w => { const s = w.split(/\s+/).filter(Boolean); return s.length > 0 && s.every(wgIsViSyl); };

// ── State ──────────────────────────────────────────────────────────────────
let wgDict     = null;
let wgMode     = null;
let wgPlayers  = [];
let wgCurrIdx  = 0;
let wgLastWord = null;
let wgLastSyl  = null;
let wgUsed     = new Set();
let wgDeadline = null;
let wgRafId    = null;
let wgPhase    = 'idle';
let wgMyIdx    = -1;
let wgIsHost   = false;
let wgRoomCode = null;
let wgMyToken  = null;
let wgEvtSrc   = null;
let wgMaxP     = 3;
let wgLocalCnt = 2;

// ── Dictionary loader ──────────────────────────────────────────────────────
async function wgLoadDict() {
  if (wgDict !== null) return;
  try {
    const res  = await fetch('/api/wg/dict');
    if (!res.ok) throw new Error();
    const text = await res.text();
    wgDict = new Set(text.split('\n').filter(Boolean));
  } catch {
    wgDict = new Set();
  }
}

// ── Overlay ────────────────────────────────────────────────────────────────
function openWG() {
  $('wg-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  showWGScreen('wg-screen-mode');
  wgLoadDict();
}
function closeWG() {
  $('wg-overlay').classList.remove('open');
  document.body.style.overflow = '';
  wgCleanup();
}
function wgHandleBack() {
  const active = $('wg-overlay').querySelector('.ov-screen.active');
  const id = active?.id;
  if (!id || id === 'wg-screen-mode') closeWG();
  else if (id === 'wg-screen-game' && wgPhase === 'playing') {
    if (confirm('Rời khỏi trò chơi đang diễn ra?')) closeWG();
  } else showWGScreen('wg-screen-mode');
}
function showWGScreen(id) {
  ['wg-screen-mode', 'wg-screen-local', 'wg-screen-lobby', 'wg-screen-game'].forEach(s => {
    const el = $(s); if (el) el.classList.toggle('active', s === id);
  });
}

// ── Local setup ────────────────────────────────────────────────────────────
function wgShowLocalSetup() {
  wgLocalCnt = 2;
  showWGScreen('wg-screen-local');
  wgSyncCountBtns('wg-screen-local', 2);
  wgRenderLocalNames(2);
}
function wgSelectCount(n) {
  wgLocalCnt = n;
  wgSyncCountBtns('wg-screen-local', n);
  wgRenderLocalNames(n);
}
function wgSyncCountBtns(screenId, val) {
  $(screenId).querySelectorAll('.wg-count-btn').forEach(b => {
    b.classList.toggle('active', +b.dataset.val === val);
  });
}
function wgRenderLocalNames(n) {
  const wrap = $('wg-local-names'); wrap.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.innerHTML = `<label class="nick-label">Người chơi ${i + 1}</label>
      <input id="wg-lp${i}" class="nick-input" placeholder="Nhập tên..." maxlength="20"
             onkeydown="if(event.key==='Enter')wgStartLocal()">`;
    wrap.appendChild(d);
  }
  $('wg-lp0')?.focus();
}
function wgStartLocal() {
  const players = [];
  for (let i = 0; i < wgLocalCnt; i++) {
    const nick = ($(`wg-lp${i}`)?.value || '').trim() || `Người ${i + 1}`;
    players.push({ nick, alive: true });
  }
  const names = players.map(p => p.nick);
  if (new Set(names).size < names.length) {
    const el = $('wg-local-err'); el.textContent = 'Tên không được trùng nhau!'; el.style.display = 'block'; return;
  }
  $('wg-local-err').style.display = 'none';
  wgMode = 'local'; wgPlayers = players; wgMyIdx = -1;
  wgInitGame();
}

// ── Online lobby ───────────────────────────────────────────────────────────
function wgShowOnlineLobby() {
  showWGScreen('wg-screen-lobby');
  $('wg-lobby-forms').style.display = 'block';
  $('wg-lobby-wait').style.display  = 'none';
  $('wg-lobby-err').style.display   = 'none';
  $('wg-code-in').value = '';
  prefillNicknames();
  setTimeout(() => $('wg-nick')?.focus(), 80);
}
function wgSetMax(n) {
  wgMaxP = n;
  wgSyncCountBtns('wg-screen-lobby', n);
}

async function wgCreateRoom() {
  wgHideLobbyErr();
  const nick = ($('wg-nick')?.value || '').trim();
  try {
    const res  = await fetch('/api/wg/room', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: nick, maxPlayers: wgMaxP }),
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    wgMode = 'online'; wgMyIdx = 0; wgIsHost = true;
    wgMyToken = data.token; wgRoomCode = data.code;
    wgPlayers = [{ nick: nick || 'Người chơi', alive: true }];
    sessionStorage.setItem('wg-t-' + data.code, data.token);
    $('wg-code-disp').textContent = data.code;
    $('wg-lobby-forms').style.display = 'none';
    $('wg-lobby-wait').style.display  = 'block';
    $('wg-start-btn').style.display   = 'none';
    wgRenderLobbyList();
    wgSetupSSE();
  } catch { wgShowLobbyErr('Không thể kết nối server. Hãy chạy: node server.js'); }
}

async function wgJoinRoom() {
  wgHideLobbyErr();
  const code = ($('wg-code-in')?.value || '').trim().toUpperCase();
  if (code.length !== 4) { wgShowLobbyErr('Mã phòng phải đủ 4 ký tự'); return; }
  const nick  = ($('wg-nick')?.value || '').trim();
  const saved = sessionStorage.getItem('wg-t-' + code);
  try {
    const res = await fetch('/api/wg/room/' + code, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: nick, token: saved || undefined }),
    });
    if (res.status === 404) { wgShowLobbyErr('Không tìm thấy phòng. Kiểm tra lại mã!'); return; }
    if (!res.ok) { const e = await res.json().catch(() => ({})); wgShowLobbyErr(e.error || 'Không thể vào phòng'); return; }
    const data = await res.json();
    wgMode = 'online'; wgMyIdx = data.playerIdx; wgIsHost = (data.playerIdx === 0);
    wgMyToken = data.token; wgRoomCode = code;
    wgPlayers = (data.players || []).map(p => ({ nick: p.nick, alive: p.alive }));
    if (data.token) sessionStorage.setItem('wg-t-' + code, data.token);
    $('wg-code-disp').textContent = code;
    $('wg-lobby-forms').style.display = 'none';
    $('wg-lobby-wait').style.display  = 'block';
    wgRenderLobbyList();
    wgSetupSSE();
    if (data.phase === 'playing') {
      wgLastSyl  = data.lastSyl || null;
      wgLastWord = data.words?.slice(-1)[0]?.word || null;
      wgCurrIdx  = data.currIdx ?? 0;
      wgDeadline = data.deadline;
      wgUsed     = new Set((data.words || []).map(w => w.word));
      wgPhase    = 'playing';
      showWGScreen('wg-screen-game');
      wgInitGameUI();
      (data.words || []).forEach(w => wgPushHistory(w.playerIdx, w.word, false));
      wgRenderPlayers(); wgStartCountdown();
    } else if (wgIsHost && wgPlayers.length >= 2) {
      $('wg-start-btn').style.display = 'block';
      $('wg-wait-anim').style.display = 'none';
    }
  } catch { wgShowLobbyErr('Lỗi kết nối. Kiểm tra server đang chạy!'); }
}

function wgShowLobbyErr(msg) { const e = $('wg-lobby-err'); e.textContent = msg; e.style.display = 'block'; }
function wgHideLobbyErr()    { $('wg-lobby-err').style.display = 'none'; }

function wgCopyCode() {
  const text = wgRoomCode, btn = $('wg-copy-btn');
  const done = () => { btn.textContent = '✅'; setTimeout(() => { btn.textContent = '📋'; }, 2000); };
  const fb   = () => { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;opacity:0'; document.body.appendChild(ta); ta.focus(); ta.select(); try { document.execCommand('copy'); done(); } catch {} document.body.removeChild(ta); };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(fb); else fb();
}

function wgRenderLobbyList() {
  const wrap = $('wg-lobby-plist'); if (!wrap) return;
  wrap.innerHTML = '';
  wgPlayers.forEach((p, i) => {
    const d = document.createElement('div'); d.className = 'wg-lp';
    d.innerHTML = `<span class="wg-dot" style="background:${WG_COLORS[i]}"></span>
      <span>${p.nick}</span>${i === 0 ? '<span class="wg-host-lbl">chủ phòng</span>' : ''}`;
    wrap.appendChild(d);
  });
  const ready = wgIsHost && wgPlayers.length >= 2;
  $('wg-start-btn').style.display = ready ? 'block' : 'none';
  $('wg-wait-anim').style.display = ready ? 'none'  : 'flex';
}

async function wgStartOnline() {
  try {
    const res = await fetch('/api/wg/start/' + wgRoomCode, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: wgMyToken }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); wgShowLobbyErr(e.error || 'Không thể bắt đầu'); }
  } catch { wgShowLobbyErr('Lỗi kết nối!'); }
}

// ── SSE ────────────────────────────────────────────────────────────────────
function wgSetupSSE() {
  if (wgEvtSrc) wgEvtSrc.close();
  wgEvtSrc = new EventSource('/api/wg/events/' + wgRoomCode + '?token=' + (wgMyToken || 'spec'));
  wgEvtSrc.onmessage = e => wgHandleSSE(JSON.parse(e.data));
}

function wgHandleSSE(data) {
  if (data.type === 'wg:playerJoined') {
    wgPlayers = (data.players || []).map(p => ({ nick: p.nick, alive: p.alive }));
    wgRenderLobbyList(); return;
  }
  if (data.type === 'wg:start') {
    wgPlayers  = (data.players || []).map(p => ({ nick: p.nick, alive: p.alive }));
    wgCurrIdx  = data.currIdx; wgDeadline = data.deadline;
    wgLastWord = null; wgLastSyl = null; wgUsed = new Set(); wgPhase = 'playing';
    showWGScreen('wg-screen-game'); wgInitGameUI(); wgStartCountdown(); return;
  }
  if (data.type === 'wg:word') {
    wgLastWord = data.word; wgLastSyl = data.lastSyl;
    wgUsed.add(data.word); wgCurrIdx = data.currIdx; wgDeadline = data.deadline;
    wgUpdateChainBar(); wgPushHistory(data.playerIdx, data.word, true);
    wgRenderPlayers(); wgStartCountdown(); return;
  }
  if (data.type === 'wg:eliminated') {
    if (data.playerIdx >= 0) wgPlayers[data.playerIdx].alive = false;
    wgPushHistoryElim(data.playerIdx, data.reason);
    if (data.gameOver) {
      wgPhase = 'finished'; wgStopCountdown();
      wgRenderPlayers(); wgShowGameOver(data.winnerIdx, data.winnerNick);
    } else {
      wgCurrIdx = data.currIdx; wgDeadline = data.deadline;
      wgRenderPlayers(); wgStartCountdown();
    }
  }
}

// ── Game init ──────────────────────────────────────────────────────────────
function wgInitGame() {
  wgCurrIdx = 0; wgLastWord = null; wgLastSyl = null; wgUsed = new Set();
  wgPhase = 'playing'; wgDeadline = Date.now() + 30_000;
  showWGScreen('wg-screen-game');
  wgInitGameUI(); wgStartCountdown();
}
function wgInitGameUI() {
  const h = $('wg-hist'); if (h) h.innerHTML = '';
  document.querySelectorAll('.wg-gameover,.wg-replay-btn').forEach(e => e.remove());
  const err = $('wg-err'); if (err) err.style.display = 'none';
  wgUpdateChainBar(); wgRenderPlayers(); wgSetInput(true);
  $('wg-word-in')?.focus();
}

// ── Players UI ─────────────────────────────────────────────────────────────
function wgRenderPlayers() {
  const bar = $('wg-players-bar'); if (!bar) return;
  bar.innerHTML = '';
  wgPlayers.forEach((p, i) => {
    const c = document.createElement('div');
    c.className = 'wg-pc' + (i === wgCurrIdx && p.alive ? ' cur' : '') + (p.alive ? '' : ' dead');
    c.style.setProperty('--pc-col', WG_COLORS[i]);
    c.innerHTML = `<span class="wg-dot" style="background:${WG_COLORS[i]}"></span>${p.nick}`;
    bar.appendChild(c);
  });
  const info = $('wg-turn-info'); if (!info) return;
  if (wgPhase === 'finished') { info.textContent = ''; return; }
  const cur = wgPlayers[wgCurrIdx]; if (!cur) return;
  const myTurn = wgMode === 'local' || wgCurrIdx === wgMyIdx;
  info.innerHTML = myTurn
    ? `<span style="color:${WG_COLORS[wgCurrIdx]};font-weight:800">Đến lượt bạn!</span>`
    : `<span style="color:${WG_COLORS[wgCurrIdx]}">Chờ ${cur.nick}...</span>`;
  wgSetInput(myTurn && wgPhase === 'playing');
}

function wgSetInput(on) {
  const inp = $('wg-word-in'), btn = $('wg-send-btn');
  if (inp) { inp.disabled = !on; if (on) inp.focus(); }
  if (btn) btn.disabled = !on;
}

// ── Chain bar ──────────────────────────────────────────────────────────────
function wgUpdateChainBar() {
  const lw = $('wg-last-word'), rs = $('wg-req-syl'); if (!lw || !rs) return;
  if (wgLastWord) {
    lw.textContent = wgLastWord; rs.textContent = wgLastSyl || '?'; rs.className = 'wg-syl-chip';
  } else {
    lw.textContent = '—'; rs.textContent = 'Từ đầu tiên'; rs.className = 'wg-syl-chip fresh';
  }
}

// ── Timer ──────────────────────────────────────────────────────────────────
function wgStartCountdown() {
  wgStopCountdown();
  const ring = $('wg-ring-fg'), num = $('wg-timer-num');
  const tick = () => {
    const s = Math.max(0, (wgDeadline - Date.now()) / 1000);
    if (ring) ring.style.strokeDashoffset = String(WG_CIRC * (1 - s / 30));
    if (num)  num.textContent = String(Math.ceil(s));
    const col = s > 15 ? '#43e97b' : s > 8 ? '#ffd700' : '#ff6b9d';
    if (ring) ring.style.stroke = col;
    if (num)  num.style.color = s <= 8 ? '#ff6b9d' : '';
    if (s <= 0) { if (wgMode === 'local') wgLocalTimeout(); return; }
    wgRafId = requestAnimationFrame(tick);
  };
  wgRafId = requestAnimationFrame(tick);
}
function wgStopCountdown() { if (wgRafId) { cancelAnimationFrame(wgRafId); wgRafId = null; } }

// ── Local timeout ──────────────────────────────────────────────────────────
function wgLocalTimeout() {
  if (wgPhase !== 'playing') return;
  const idx = wgCurrIdx; wgPlayers[idx].alive = false;
  wgPushHistoryElim(idx, 'timeout');
  const alive = wgPlayers.filter(p => p.alive);
  if (alive.length <= 1) { wgLocalEnd(alive[0] ? wgPlayers.indexOf(alive[0]) : -1); return; }
  wgCurrIdx = wgNextAlive(idx); wgDeadline = Date.now() + 30_000;
  wgRenderPlayers(); wgStartCountdown();
}
function wgNextAlive(from) {
  const n = wgPlayers.length;
  for (let i = 1; i <= n; i++) { const idx = (from + i) % n; if (wgPlayers[idx].alive) return idx; }
  return -1;
}
function wgLocalEnd(winnerIdx) { wgPhase = 'finished'; wgStopCountdown(); wgRenderPlayers(); wgShowGameOver(winnerIdx, wgPlayers[winnerIdx]?.nick || null); }

// ── Submit / pass ──────────────────────────────────────────────────────────
async function wgSubmit() {
  if (wgPhase !== 'playing') return;
  const inp  = $('wg-word-in');
  const raw  = (inp?.value || '').trim();
  if (!raw) return;
  const word = raw.normalize('NFC').toLowerCase().split(/\s+/).filter(Boolean).join(' ');

  if (wgMode === 'local') {
    const err = wgValidateLocal(word);
    if (err) { wgShowErr(err); return; }
    wgApplyWordLocal(word); inp.value = ''; inp.focus();
  } else {
    if (wgCurrIdx !== wgMyIdx) return;
    try {
      const res = await fetch('/api/wg/word/' + wgRoomCode, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: wgMyToken, word }),
      });
      if (res.ok) { inp.value = ''; }
      else { const d = await res.json().catch(() => ({})); wgShowErr(d.error || 'Từ không hợp lệ'); }
    } catch { wgShowErr('Lỗi kết nối!'); }
  }
}

async function wgPass() {
  if (wgPhase !== 'playing') return;
  if (!confirm('Bỏ qua lượt sẽ bị loại khỏi trò chơi. Tiếp tục?')) return;
  if (wgMode === 'local') { wgLocalTimeout(); return; }
  if (wgCurrIdx !== wgMyIdx) return;
  fetch('/api/wg/pass/' + wgRoomCode, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: wgMyToken }) }).catch(() => {});
}

function wgValidateLocal(word) {
  const syls = word.split(/\s+/).filter(Boolean);
  if (!syls.length)    return 'Từ không hợp lệ';
  if (syls.length !== 2) return 'Từ phải có đúng 2 tiếng (VD: "học sinh", "bạn bè")';
  if (wgDict && wgDict.size > 0) {
    if (!wgDict.has(word)) return 'Từ không có trong từ điển tiếng Việt';
  } else if (!wgIsViWord(word)) {
    return 'Không phải từ tiếng Việt hợp lệ';
  }
  if (wgLastSyl && syls[0] !== wgLastSyl) return `Phải bắt đầu bằng "${wgLastSyl}"`;
  if (wgUsed.has(word))                   return 'Từ này đã được dùng rồi!';
  return null;
}

function wgApplyWordLocal(word) {
  const syls = word.split(/\s+/).filter(Boolean);
  wgUsed.add(word); wgPushHistory(wgCurrIdx, word, true);
  wgLastWord = word; wgLastSyl = syls[syls.length - 1];
  wgUpdateChainBar(); wgHideErr();
  wgCurrIdx = wgNextAlive(wgCurrIdx); wgDeadline = Date.now() + 30_000;
  wgRenderPlayers(); wgStartCountdown();
}

// ── History ────────────────────────────────────────────────────────────────
function wgPushHistory(pIdx, word, scroll) {
  const h = $('wg-hist'); if (!h) return;
  const col  = WG_COLORS[pIdx] || '#888', p = wgPlayers[pIdx];
  const syls = word.split(/\s+/).filter(Boolean);
  const last = syls.pop(); const rest = syls.length ? syls.join(' ') + ' ' : '';
  const d = document.createElement('div'); d.className = 'wg-he';
  d.innerHTML = `<span class="wg-he-nick" style="color:${col}">${p?.nick || '?'}</span>
    <span class="wg-he-word">${rest}<strong>${last}</strong></span>`;
  h.appendChild(d); if (scroll) h.scrollTop = h.scrollHeight;
}
function wgPushHistoryElim(pIdx, reason) {
  const h = $('wg-hist'); if (!h) return;
  const col = WG_COLORS[pIdx] || '#888', p = wgPlayers[pIdx];
  const msg = reason === 'timeout' ? 'hết giờ ⏱️' : 'bỏ qua 🏳️';
  const d = document.createElement('div'); d.className = 'wg-he wg-he-elim';
  d.innerHTML = `<span class="wg-he-nick" style="color:${col}">${p?.nick || '?'}</span><span>bị loại (${msg})</span>`;
  h.appendChild(d); h.scrollTop = h.scrollHeight;
}

// ── Error ──────────────────────────────────────────────────────────────────
function wgShowErr(msg) {
  const e = $('wg-err'); if (!e) return; e.textContent = msg; e.style.display = 'block';
  clearTimeout(wgShowErr._t); wgShowErr._t = setTimeout(wgHideErr, 3000);
}
function wgHideErr() { const e = $('wg-err'); if (e) e.style.display = 'none'; }

// ── Game over ──────────────────────────────────────────────────────────────
function wgShowGameOver(winnerIdx, winnerNick) {
  wgSetInput(false);
  const h = $('wg-hist'); if (!h) return;
  const ov = document.createElement('div'); ov.className = 'wg-gameover';
  if (winnerIdx >= 0 && winnerNick) {
    const col = WG_COLORS[winnerIdx] || '#888';
    ov.innerHTML = `<h3>🏆 <span style="color:${col}">${winnerNick}</span> thắng!</h3>
      <p>Đã nối được ${wgUsed.size} từ trong ván này.</p>`;
  } else {
    ov.innerHTML = `<h3>🤝 Hòa!</h3><p>Đã nối được ${wgUsed.size} từ.</p>`;
  }
  h.appendChild(ov);
  const btn = document.createElement('button'); btn.className = 'wg-replay-btn'; btn.textContent = '↺ Chơi lại';
  btn.onclick = () => { if (wgMode === 'local') wgShowLocalSetup(); else { wgCleanup(); wgShowOnlineLobby(); } };
  h.appendChild(btn); h.scrollTop = h.scrollHeight;
}

// ── Cleanup ────────────────────────────────────────────────────────────────
function wgCleanup() {
  wgStopCountdown();
  if (wgEvtSrc) { wgEvtSrc.close(); wgEvtSrc = null; }
  wgMode = null; wgPlayers = []; wgMyIdx = -1; wgIsHost = false;
  wgRoomCode = null; wgMyToken = null; wgLastWord = null; wgLastSyl = null;
  wgUsed = new Set(); wgPhase = 'idle'; wgDeadline = null;
}

// ── Global keyboard shortcut ───────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeGame(); closeWG(); }
});
