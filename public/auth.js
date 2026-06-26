// ══════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════
let authUser   = null;
let authTabVal = 'login';
const AUTH_KEY = 'gz-auth-token';

async function authInit() {
  const token = localStorage.getItem(AUTH_KEY);
  if (!token) { renderAuthNav(); return; }
  const res = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } }).catch(() => null);
  if (res?.ok) { authUser = (await res.json()).username; }
  else         { localStorage.removeItem(AUTH_KEY); }
  renderAuthNav();
}

function renderAuthNav() {
  const el = $('auth-nav'); if (!el) return;
  if (authUser) {
    el.innerHTML =
      `<span class="auth-nav-user">Xin chào, <strong>${authUser}</strong></span>` +
      `<button class="nav-logout-btn" onclick="authLogout()">Đăng xuất</button>`;
  } else {
    el.innerHTML = `<button class="nav-auth-btn" onclick="openAuthOverlay()">Đăng nhập</button>`;
  }
}

function openAuthOverlay() {
  authSwitchTab('login');
  $('auth-err').style.display = 'none';
  $('auth-username').value = '';
  $('auth-password').value = '';
  $('auth-overlay').classList.add('open');
  setTimeout(() => $('auth-username').focus(), 80);
}

function closeAuthOverlay() {
  $('auth-overlay').classList.remove('open');
}

function authSwitchTab(tab) {
  authTabVal = tab;
  const isLogin = tab === 'login';
  $('tab-login').classList.toggle('active', isLogin);
  $('tab-register').classList.toggle('active', !isLogin);
  $('auth-title').textContent      = isLogin ? 'Đăng nhập' : 'Đăng ký tài khoản';
  $('auth-submit-btn').textContent = isLogin ? 'Đăng nhập' : 'Tạo tài khoản';
  $('auth-err').style.display = 'none';
}

async function authSubmit() {
  const username = ($('auth-username').value || '').trim();
  const password = ($('auth-password').value || '');
  $('auth-err').style.display = 'none';

  const endpoint = authTabVal === 'login' ? '/api/auth/login' : '/api/auth/register';
  let res, data;
  try {
    res  = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    data = await res.json();
  } catch {
    return authShowErr('Không thể kết nối server');
  }
  if (!res.ok) return authShowErr(data.error || 'Có lỗi xảy ra');

  localStorage.setItem(AUTH_KEY, data.token);
  authUser = data.username;
  renderAuthNav();
  closeAuthOverlay();
  prefillNicknames();
}

function authShowErr(msg) {
  const e = $('auth-err'); e.textContent = msg; e.style.display = 'block';
}

async function authLogout() {
  const token = localStorage.getItem(AUTH_KEY);
  if (token) fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
  localStorage.removeItem(AUTH_KEY); authUser = null; renderAuthNav();
}

function prefillNicknames() {
  if (!authUser) return;
  const ni = $('nick-input'); if (ni && !ni.value) ni.value = authUser;
  const wn = $('wg-nick');    if (wn && !wn.value) wn.value = authUser;
}

document.addEventListener('DOMContentLoaded', () => {
  authInit().then(prefillNicknames);
  $('auth-overlay').addEventListener('click', e => { if (e.target === $('auth-overlay')) closeAuthOverlay(); });
});
