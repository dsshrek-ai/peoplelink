// PeopleLink shared helpers: config, login, API calls, navigation, and the
// small formatting functions every page uses.

const APP_VERSION = '0.1.0 (Milestone B)';

const CONFIG = {
  API_URL: 'https://seniorfamily.org/peoplelink-api/api.php',
  APP_KEY: 'peoplelink',
};
// Local testing: served from localhost, the app talks to the local API.
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  CONFIG.API_URL = location.origin + '/api/api.php';
}

// ---- Login (My Apps Hub SSO token, or a manual fallback) ----

const TOKEN_KEY = 'plToken';
function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
function saveToken(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* private mode */ } }
function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// The Hub opens the app with ?token=...; keep it and tidy the address bar.
(function captureSso() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) return;
  params.delete('token');
  const rest = params.toString();
  window.history.replaceState({}, document.title, window.location.pathname + (rest ? '?' + rest : ''));
  saveToken(token);
})();

async function readJson(res) {
  if (res.status === 401 || res.status === 403) throw new Error('not-authorized');
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed: ${res.status}`);
    err.userMessage = data && data.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

async function fetchData(action, params) {
  const qs = new URLSearchParams({ action, ...(params || {}) });
  return readJson(await fetch(`${CONFIG.API_URL}?${qs}`, { headers: authHeaders() }));
}

async function postAction(action, payload) {
  return readJson(await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', ...authHeaders() },
    body: JSON.stringify({ action, ...(payload || {}) }),
  }));
}

async function postForm(action, formData) {
  formData.set('action', action);
  return readJson(await fetch(CONFIG.API_URL, { method: 'POST', headers: authHeaders(), body: formData }));
}

// ---- Page chrome ----

const NAV = [
  { href: 'index.html', label: 'Dashboard', icon: '🏠' },
  { href: 'people.html', label: 'People', icon: '👤' },
  { href: 'groups.html', label: 'Groups', icon: '👥' },
  { href: 'help.html', label: 'Help', icon: '❓' },
  { href: 'about.html', label: 'About', icon: 'ⓘ' },
];

// Fills <header class="site-header"> and adds the phone-size tab bar.
function renderNav(current) {
  const header = document.querySelector('header.site-header');
  const links = NAV.map(n =>
    `<a href="${n.href}"${n.href === current ? ' aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${n.icon}</span><span>${n.label}</span></a>`
  ).join('');
  header.innerHTML = `
    <div class="topbar">
      <a class="brand" href="index.html"><span aria-hidden="true">🤝</span> PeopleLink</a>
      <nav class="top-nav" aria-label="Main">${links}</nav>
    </div>`;
  const tabs = document.createElement('nav');
  tabs.className = 'tab-bar';
  tabs.setAttribute('aria-label', 'Main');
  tabs.innerHTML = links;
  document.body.appendChild(tabs);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderGate(container, reason) {
  if (reason === 'denied') {
    container.innerHTML = `<div class="card gate"><p class="note">Your login isn't set up for PeopleLink yet. Ask to be granted the app in My Apps Hub, or open it again from there.</p></div>`;
    return;
  }
  container.innerHTML = `
    <div class="card gate">
      <h2>Log In</h2>
      <p class="muted">Normally you won't see this — open PeopleLink from My Apps Hub and it logs you in automatically.</p>
      <label for="g-email">Email</label>
      <input type="email" id="g-email" autocomplete="username">
      <label for="g-pw">Password</label>
      <input type="password" id="g-pw" autocomplete="current-password">
      <p><button type="button" class="btn" id="g-btn">Log In</button></p>
      <div id="g-msg"></div>
    </div>`;
  const email = document.getElementById('g-email');
  const pw = document.getElementById('g-pw');
  const msg = document.getElementById('g-msg');
  const btn = document.getElementById('g-btn');
  async function attempt() {
    if (!email.value.trim() || !pw.value) return;
    btn.disabled = true;
    msg.innerHTML = '';
    try {
      const res = await fetch(CONFIG.API_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'login', username: email.value.trim(), password: pw.value }),
      });
      const data = await res.json();
      if (!res.ok || !data.token) {
        msg.innerHTML = `<p class="err">${escapeHtml(data.error || 'Incorrect email or password.')}</p>`;
        btn.disabled = false;
        return;
      }
      saveToken(data.token);
      window.location.reload();
    } catch (e) {
      msg.innerHTML = '<p class="err">Something went wrong. Please try again.</p>';
      btn.disabled = false;
    }
  }
  btn.addEventListener('click', attempt);
  pw.addEventListener('keydown', ev => { if (ev.key === 'Enter') attempt(); });
}

function handleError(container, err) {
  console.error(err);
  if (err && err.message === 'not-authorized') renderGate(container, getToken() ? 'denied' : 'no-token');
  else if (err && err.userMessage) container.innerHTML = `<p class="note">${escapeHtml(err.userMessage)}</p>`;
  else container.innerHTML = `<p class="note">Couldn't load right now — check your connection and refresh.</p>`;
}

function errorText(err, fallback) {
  if (err && err.message === 'not-authorized') return 'Your login has expired — open PeopleLink again from My Apps Hub.';
  return (err && err.userMessage) || fallback;
}

let _statusTimer = null;
function showStatus(msg, isError) {
  let el = document.getElementById('status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'status';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = msg || '';
  el.className = isError ? 'status error' : 'status';
  el.style.display = msg ? 'block' : 'none';
  clearTimeout(_statusTimer);
  if (msg && !isError) _statusTimer = setTimeout(() => { el.style.display = 'none'; }, 3500);
}

function qsParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// Calendar (and maps) follow the shared My Apps Hub preference.
if (window.MdwPrefs) {
  MdwPrefs.init({ appKey: CONFIG.APP_KEY, getToken });
  MdwPrefs.load();
}

// ---- People ----

function fullName(p) {
  const parts = [p.FirstName, p.MiddleName, p.LastName].filter(Boolean);
  return parts.length ? parts.join(' ') : (p.Nickname || p.Organization || 'Unnamed');
}

// What you'd call them: "Bob Smith" for Robert Smith with nickname Bob.
function displayName(p) {
  const first = p.Nickname || p.FirstName;
  const parts = [first, p.LastName].filter(Boolean);
  return parts.length ? parts.join(' ') : (p.Organization || 'Unnamed');
}

function sortKey(p, by) {
  const first = (p.Nickname || p.FirstName || '').toLowerCase();
  const last = (p.LastName || '').toLowerCase();
  const org = (p.Organization || '').toLowerCase();
  return by === 'last' ? `${last || first || org} ${first}` : `${first || last || org} ${last}`;
}

function initials(p) {
  const a = (p.Nickname || p.FirstName || p.Organization || '?').trim()[0] || '?';
  const b = (p.LastName || '').trim()[0] || '';
  return (a + b).toUpperCase();
}

const AVATAR_COLORS = ['#0f766e', '#2563a8', '#7c3aed', '#b45309', '#be123c', '#4d7c0f', '#0e7490', '#9d174d'];

function photoUrl(key, thumb) {
  return `${CONFIG.API_URL}?action=photo&k=${encodeURIComponent(key)}${thumb ? '&size=thumb' : ''}`;
}

// size: 'sm' (list rows), 'md', 'lg' (profile header)
function avatarHtml(p, size) {
  const cls = `avatar avatar-${size || 'sm'}`;
  if (p.PhotoKey) {
    return `<img class="${cls}" src="${escapeHtml(photoUrl(p.PhotoKey, size !== 'lg'))}" alt="">`;
  }
  const color = AVATAR_COLORS[p.Id % AVATAR_COLORS.length];
  return `<span class="${cls}" style="background:${color}" aria-hidden="true">${escapeHtml(initials(p))}</span>`;
}

function dialable(phone) {
  return String(phone || '').replace(/[^\d+]/g, '');
}

function addressLines(a) {
  const cityLine = [a.City, [a.Region, a.PostalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [a.Street, cityLine, a.Country].filter(Boolean);
}

function addressOneLine(a) {
  return addressLines(a).join(', ').replace(/\n/g, ', ');
}

function labelText(l) {
  return l ? l.charAt(0).toUpperCase() + l.slice(1) : '';
}

// ---- Dates ----

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function todayParts() {
  const d = new Date();
  return { Year: d.getFullYear(), Month: d.getMonth() + 1, Day: d.getDate() };
}

function fmtPartialDate(d) {
  if (!d) return '';
  return `${MONTHS[d.Month - 1]} ${d.Day}${d.Year ? ', ' + d.Year : ''}`;
}

// Days until the next occurrence of a month/day (0 = today). Feb 29 falls on
// Feb 28 in non-leap years.
function daysUntil(d) {
  const t = todayParts();
  const today = new Date(t.Year, t.Month - 1, t.Day);
  const next = year => {
    const leap = new Date(year, 1, 29).getMonth() === 1;
    const day = d.Month === 2 && d.Day === 29 && !leap ? 28 : d.Day;
    return new Date(year, d.Month - 1, day);
  };
  let n = next(t.Year);
  if (n < today) n = next(t.Year + 1);
  return Math.round((n - today) / 86400000);
}

// Age (or years married) they'll be on the next occurrence; null without a year.
function turning(d) {
  if (!d || !d.Year) return null;
  const t = todayParts();
  const passed = t.Month > d.Month || (t.Month === d.Month && t.Day > d.Day);
  return t.Year - d.Year + (passed ? 1 : 0);
}

function currentAge(d) {
  if (!d || !d.Year) return null;
  const t = todayParts();
  const had = t.Month > d.Month || (t.Month === d.Month && t.Day >= d.Day);
  return t.Year - d.Year - (had ? 0 : 1);
}

function whenLabel(days) {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

// ---- Groups ----

const GROUP_COLORS = ['#0f766e', '#2563a8', '#7c3aed', '#b45309', '#be123c', '#4d7c0f', '#0e7490', '#64748b'];

function groupChip(g, href) {
  const style = g.Color ? ` style="--chip:${escapeHtml(g.Color)}"` : '';
  const inner = `${g.Icon ? `<span aria-hidden="true">${escapeHtml(g.Icon)}</span> ` : ''}${escapeHtml(g.Name)}`;
  return href ? `<a class="chip" href="${href}"${style}>${inner}</a>` : `<span class="chip"${style}>${inner}</span>`;
}
