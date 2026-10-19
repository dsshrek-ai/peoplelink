// PeopleLink shared helpers: config, login, API calls, navigation, and the
// small formatting functions every page uses.

const APP_VERSION = '0.2.0';

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

// tab: shown in the phone tab bar; everything else lives under "More".
const NAV = [
  { href: 'index.html', label: 'Dashboard', icon: '🏠', tab: true },
  { href: 'people.html', label: 'People', icon: '👤', tab: true },
  { href: 'groups.html', label: 'Groups', icon: '👥', tab: true },
  { href: 'activities.html', label: 'Activities', icon: '📅', tab: true },
  { href: 'journal.html', label: 'Journal', icon: '📝' },
  { href: 'reminders.html', label: 'Reminders', icon: '⏰' },
  { href: 'reports.html', label: 'Reports', icon: '📊' },
  { href: 'help.html', label: 'Help', icon: '❓' },
  { href: 'about.html', label: 'About', icon: 'ⓘ' },
];
const MORE_PAGES = ['more.html', 'journal.html', 'reminders.html', 'reports.html', 'backup.html', 'help.html', 'about.html', 'invitations.html'];

// Fills <header class="site-header"> and adds the phone-size tab bar.
function renderNav(current) {
  const header = document.querySelector('header.site-header');
  const link = (n, on) => `<a href="${n.href}"${on ? ' aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${n.icon}</span><span>${n.label}</span></a>`;
  header.innerHTML = `
    <div class="topbar">
      <a class="brand" href="index.html"><span aria-hidden="true">🤝</span> PeopleLink</a>
      <nav class="top-nav" aria-label="Main">${NAV.map(n => link(n, n.href === current)).join('')}</nav>
    </div>`;
  const tabs = document.createElement('nav');
  tabs.className = 'tab-bar';
  tabs.setAttribute('aria-label', 'Main');
  tabs.innerHTML = NAV.filter(n => n.tab).map(n => link(n, n.href === current)).join('')
    + link({ href: 'more.html', label: 'More', icon: '☰' }, MORE_PAGES.includes(current));
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

// ---- Dates as 'YYYY-MM-DD' (local) ----

function ymdOf(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayYmd() {
  return ymdOf(new Date());
}

function addDaysYmd(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return ymdOf(new Date(y, m - 1, d + n));
}

function daysFromToday(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = todayParts();
  return Math.round((new Date(y, m - 1, d) - new Date(t.Year, t.Month - 1, t.Day)) / 86400000);
}

function fmtYmd(ymd, withYear) {
  const [y, m, d] = ymd.split('-').map(Number);
  const showYear = withYear || y !== todayParts().Year;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(showYear ? { year: 'numeric' } : {}) });
}

function fmtTime(hm) {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function agoText(ymd) {
  const n = -daysFromToday(ymd);
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 60) return `${n} days ago`;
  if (n < 730) return `${Math.round(n / 30)} months ago`;
  return `${Math.round(n / 365)} years ago`;
}

// ---- Stay in touch ----

const INTERVALS = [
  { days: 7, label: 'Every week' }, { days: 14, label: 'Every 2 weeks' }, { days: 30, label: 'Every month' },
  { days: 42, label: 'Every 6 weeks' }, { days: 91, label: 'Every 3 months' }, { days: 182, label: 'Every 6 months' },
  { days: 365, label: 'Every year' },
];

function intervalLabel(days) {
  if (!days) return 'N/A';
  const known = INTERVALS.find(i => i.days === days);
  return known ? known.label : `Every ${days} days`;
}

// When to get in touch next: the earlier of the follow-up date and
// last contact + interval (never contacted = due now). null = no reminder.
function nextContact(p) {
  const dates = [];
  if (p.FollowUpDate) dates.push({ date: p.FollowUpDate, why: 'follow-up' });
  if (p.ContactIntervalDays) {
    dates.push(p.LastContact
      ? { date: addDaysYmd(p.LastContact, p.ContactIntervalDays), why: 'interval' }
      : { date: todayYmd(), why: 'never' });
  }
  if (!dates.length) return null;
  dates.sort((a, b) => a.date.localeCompare(b.date));
  return dates[0];
}

// 'overdue' | 'soon' (within 7 days) | 'later' | null (no reminder / not active)
function contactStatus(p) {
  if (p.Status !== 'active') return null;
  const n = nextContact(p);
  if (!n) return null;
  const d = daysFromToday(n.date);
  return d < 0 ? 'overdue' : d <= 7 ? 'soon' : 'later';
}

function dueText(p) {
  const n = nextContact(p);
  if (!n) return '';
  const d = daysFromToday(n.date);
  const when = d < 0 ? `${-d} day${d === -1 ? '' : 's'} overdue` : d === 0 ? 'due today' : d === 1 ? 'due tomorrow' : `due in ${d} days`;
  if (n.why === 'never') return `${intervalLabel(p.ContactIntervalDays).toLowerCase()} · no contact logged yet`;
  if (n.why === 'follow-up') return `follow-up ${when}`;
  return `${intervalLabel(p.ContactIntervalDays).toLowerCase()} · ${when}`;
}

// ---- Journal / relationships ----

const JOURNAL_KINDS = [
  { v: 'call', label: 'Call', icon: '📞' }, { v: 'text', label: 'Text', icon: '💬' }, { v: 'email', label: 'Email', icon: '✉️' },
  { v: 'visit', label: 'Visit', icon: '🏠' }, { v: 'activity', label: 'Activity', icon: '🎉' }, { v: 'other', label: 'Other', icon: '📝' },
];
function kindInfo(v) {
  return JOURNAL_KINDS.find(k => k.v === v) || JOURNAL_KINDS[5];
}

const RELATIONSHIP_KINDS = [
  ['spouse', 'Spouse'], ['partner', 'Partner'], ['parent', 'Parent'], ['child', 'Child'], ['sibling', 'Sibling'],
  ['grandparent', 'Grandparent'], ['grandchild', 'Grandchild'], ['friend', 'Friend'], ['other', 'Other'],
];
function relLabel(r) {
  if (r.Kind === 'other') return r.Label || 'Related';
  const k = RELATIONSHIP_KINDS.find(x => x[0] === r.Kind);
  return k ? k[1] : 'Related';
}

// ---- Group email / text links (sent from your own phone or email app) ----

const GROUP_TEXT_LIMIT = 20;

function mobileNumber(p) {
  const m = p.Phones.find(x => x.Label === 'mobile') || p.Phones[0];
  return m ? dialable(m.Value) : '';
}

function primaryEmail(p) {
  return p.Emails[0] ? p.Emails[0].Value : '';
}

function isApple() {
  return /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
}

// iPhone/Mac: sms:/open?addresses=a,b ; Android and others: sms:a,b
function groupSmsUrl(numbers) {
  return isApple() ? `sms:/open?addresses=${numbers.join(',')}` : `sms:${numbers.join(',')}`;
}

function groupMailUrl(emails, useBcc) {
  const list = emails.map(encodeURIComponent).join(',');
  return useBcc ? `mailto:?bcc=${list}` : `mailto:${list}`;
}

// ---- Photos (journal) ----

function resizeImage(file, maxSide, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not process that image.'))), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image file.')); };
    img.src = url;
  });
}

async function uploadJournalPhoto(entryId, file) {
  const [full, thumb] = await Promise.all([resizeImage(file, 1600, 0.85), resizeImage(file, 400, 0.8)]);
  const fd = new FormData();
  fd.set('entryId', String(entryId));
  fd.set('full', full, 'full.jpg');
  fd.set('thumb', thumb, 'thumb.jpg');
  return postForm('addJournalPhoto', fd);
}
