// MyDataWorld shared preferences + Maps/Calendar helpers.
//
// Canonical copy lives in my-apps-hub/shared/mdw-prefs.js. Apps include a
// copy (e.g. task-tap/js/mdw-prefs.js) -- when you change it, copy it back
// out to the apps that use it.
//
// Usage:
//   MdwPrefs.init({ appKey: 'task-tap', getToken: () => localStorage.getItem('ttToken') });
//   await MdwPrefs.load();                 // effective prefs for this app
//   MdwPrefs.navigate('1234 Example St, Murray, UT 84107');
//   MdwPrefs.addToCalendar({ title, date: '2026-10-14', startTime: '20:00', ... });
//
// Preferences are stored by the Hub API in the shared user_preferences table.
// Lookup order: this app's override -> global -> default. "Remember my
// choice" in the choosers saves to the GLOBAL scope, so every app benefits.
(function () {
  'use strict';

  const HUB_API = 'https://seniorfamily.org/my-apps-hub-api/api.php';
  let appKey = '';
  let getToken = () => '';
  let cache = null; // { global, appOverrides, effective }

  function authHeaders() {
    const t = getToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  async function hub(action, opts) {
    const res = await fetch(`${HUB_API}?action=${encodeURIComponent(action)}${opts && opts.query ? '&' + opts.query : ''}`, {
      method: opts && opts.body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'text/plain', ...authHeaders() },
      body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.error || `Hub request failed: ${res.status}`);
    return data;
  }

  function store(data) {
    cache = { global: data.global || {}, appOverrides: data.appOverrides || {}, effective: data.effective || {} };
    return cache;
  }

  // Loads (and caches) this user's preferences. Never throws: if the Hub is
  // unreachable, everything falls back to "ask", which always works.
  async function load() {
    try {
      return store(await hub('getPreferences', { query: 'app=' + encodeURIComponent(appKey) }));
    } catch (e) {
      return store({ effective: { 'maps.provider': 'ask', 'calendar.provider': 'ask', 'default.reminder': 'none' } });
    }
  }

  function get(key, fallback) {
    const v = cache && cache.effective ? cache.effective[key] : undefined;
    return v === undefined ? fallback : v;
  }

  // scope: 'global' or 'app' (this app). value '' removes the setting.
  async function set(scope, key, value) {
    const data = await hub('setPreference', { body: { scope: scope === 'app' ? appKey : 'global', key, value } });
    // setPreference echoes back the scope it wrote; reload so the effective
    // values for THIS app stay correct either way.
    if (scope !== 'app') await load(); else store(data);
    return cache;
  }

  // ---- chooser dialog ("Apple or Google?" + Remember my choice) ----

  let stylesAdded = false;
  function addStyles() {
    if (stylesAdded) return;
    stylesAdded = true;
    const css = `
      .mdw-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex;
        align-items: flex-end; justify-content: center; z-index: 1000; padding: 1rem; }
      @media (min-width: 600px) { .mdw-backdrop { align-items: center; } }
      .mdw-sheet { background: #fff; color: #1b2430; border-radius: 14px; width: 100%; max-width: 360px;
        padding: 1.1rem; font-family: inherit; box-shadow: 0 10px 30px rgba(0,0,0,0.25); }
      .mdw-sheet h3 { margin: 0 0 0.8rem; font-size: 1.1rem; }
      .mdw-sheet .mdw-opt { display: block; width: 100%; margin: 0 0 0.55rem; padding: 0.8rem; font: inherit;
        font-size: 1.05rem; font-weight: 600; border-radius: 10px; border: 1px solid #c9d3de; background: #f4f7fa;
        color: #1b2430; cursor: pointer; }
      .mdw-sheet .mdw-opt:hover { background: #e7eef5; }
      .mdw-sheet label { display: flex; align-items: center; gap: 0.5rem; margin: 0.4rem 0 0.8rem; font-size: 0.95rem; }
      .mdw-sheet .mdw-cancel { background: none; border: none; color: #566573; font: inherit; cursor: pointer;
        width: 100%; padding: 0.4rem; }`;
    const el = document.createElement('style');
    el.textContent = css;
    document.head.appendChild(el);
  }

  // Shows the options; resolves { value, remember } or null if cancelled.
  // onPick runs INSIDE the click handler so a window.open there counts as a
  // user gesture and isn't blocked as a pop-up.
  function choose(title, options, onPick) {
    addStyles();
    return new Promise(resolve => {
      const back = document.createElement('div');
      back.className = 'mdw-backdrop';
      back.innerHTML = `
        <div class="mdw-sheet" role="dialog" aria-modal="true" aria-label="${title}">
          <h3>${title}</h3>
          ${options.map(o => `<button type="button" class="mdw-opt" data-v="${o.value}">${o.label}</button>`).join('')}
          <label><input type="checkbox" class="mdw-remember"> Remember my choice</label>
          <button type="button" class="mdw-cancel">Cancel</button>
        </div>`;
      function close(result) { back.remove(); resolve(result); }
      back.addEventListener('click', ev => {
        if (ev.target === back || ev.target.classList.contains('mdw-cancel')) { close(null); return; }
        const btn = ev.target.closest('.mdw-opt');
        if (!btn) return;
        const result = { value: btn.dataset.v, remember: back.querySelector('.mdw-remember').checked };
        onPick(result.value);
        close(result);
      });
      document.body.appendChild(back);
      back.querySelector('.mdw-opt').focus();
    });
  }

  async function pickProvider(prefKey, title, options, run) {
    const current = get(prefKey, 'ask');
    if (current !== 'ask') { run(current); return current; }
    const choice = await choose(title, options, run);
    if (choice && choice.remember) {
      try { await set('global', prefKey, choice.value); } catch (e) { /* still opened; just not remembered */ }
    }
    return choice ? choice.value : null;
  }

  // ---- maps ----

  function mapUrl(provider, address) {
    const q = encodeURIComponent(address);
    return provider === 'apple'
      ? `https://maps.apple.com/?q=${q}`
      : `https://www.google.com/maps/search/?api=1&query=${q}`;
  }

  function navigate(address) {
    return pickProvider('maps.provider', 'Open directions in…',
      [{ value: 'apple', label: 'Apple Maps' }, { value: 'google', label: 'Google Maps' }],
      provider => window.open(mapUrl(provider, address), '_blank', 'noopener'));
  }

  // ---- calendar ----
  // ev: { title, notes, location, date: 'YYYY-MM-DD', startTime: 'HH:MM'|null,
  //       endTime: 'HH:MM'|null, reminderMinutes: number|null, uid }
  // No startTime = an all-day event. No endTime = one hour after start.

  const pad = n => String(n).padStart(2, '0');

  function eventTimes(ev) {
    const [y, m, d] = ev.date.split('-').map(Number);
    if (!ev.startTime) {
      const next = new Date(y, m - 1, d + 1);
      return { allDay: true, start: `${y}${pad(m)}${pad(d)}`,
               end: `${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}` };
    }
    const [sh, sm] = ev.startTime.split(':').map(Number);
    const start = new Date(y, m - 1, d, sh, sm);
    let end;
    if (ev.endTime) {
      const [eh, em] = ev.endTime.split(':').map(Number);
      end = new Date(y, m - 1, d, eh, em);
      if (end <= start) end = new Date(start.getTime() + 60 * 60000);
    } else {
      end = new Date(start.getTime() + 60 * 60000);
    }
    return { allDay: false, start, end };
  }

  const utcStamp = dt => `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00Z`;

  function icsEscape(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }

  function buildIcs(ev) {
    const t = eventTimes(ev);
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MyDataWorld//Task Tap//EN', 'BEGIN:VEVENT',
      `UID:${ev.uid || Date.now() + '@mydataworld'}`,
      `DTSTAMP:${utcStamp(new Date())}`,
      t.allDay ? `DTSTART;VALUE=DATE:${t.start}` : `DTSTART:${utcStamp(t.start)}`,
      t.allDay ? `DTEND;VALUE=DATE:${t.end}` : `DTEND:${utcStamp(t.end)}`,
      `SUMMARY:${icsEscape(ev.title)}`,
    ];
    if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
    if (ev.notes) lines.push(`DESCRIPTION:${icsEscape(ev.notes)}`);
    if (ev.reminderMinutes !== null && ev.reminderMinutes !== undefined) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(ev.title)}`,
        `TRIGGER:-PT${Math.max(0, Number(ev.reminderMinutes))}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.join('\r\n');
  }

  function googleCalendarUrl(ev) {
    const t = eventTimes(ev);
    const dates = t.allDay ? `${t.start}/${t.end}` : `${utcStamp(t.start)}/${utcStamp(t.end)}`;
    const p = new URLSearchParams({ action: 'TEMPLATE', text: ev.title || '', dates });
    if (ev.notes) p.set('details', ev.notes);
    if (ev.location) p.set('location', ev.location);
    return `https://calendar.google.com/calendar/render?${p}`;
  }

  // iPhone/iPad (newer iPads report themselves as a Mac with touch).
  function isAppleDevice() {
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }

  function openIcs(ev) {
    const ics = buildIcs(ev);
    if (isAppleDevice()) {
      // iPhone/iPad Safari hands a text/calendar page straight to Calendar.
      window.location.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
      return;
    }
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = (ev.title || 'event').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) + '.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // Resolves the provider used ('apple' | 'google') or null if cancelled.
  function addToCalendar(ev) {
    return pickProvider('calendar.provider', 'Add to which calendar?',
      [{ value: 'apple', label: 'Apple Calendar' }, { value: 'google', label: 'Google Calendar' }],
      provider => provider === 'apple' ? openIcs(ev) : window.open(googleCalendarUrl(ev), '_blank', 'noopener'));
  }

  window.MdwPrefs = {
    init(opts) { appKey = opts.appKey || ''; getToken = opts.getToken || getToken; },
    load, get, set, navigate, addToCalendar, mapUrl, buildIcs, googleCalendarUrl,
    get cache() { return cache; },
  };
})();
