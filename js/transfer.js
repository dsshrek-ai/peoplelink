// CSV import/export and duplicate matching. Needs js/app.js.
//
// Google Contacts CSV (as exported from contacts.google.com, Oct 2026):
// - fixed name/org columns, then numbered groups like "Phone 1 - Label",
//   "Phone 1 - Value", "Address 1 - Street", "Event 1 - Value" -- only as
//   many numbers as the busiest contact needs;
// - a cell can hold several values joined by " ::: ";
// - "Labels" lists groups joined by " ::: "; Google's own ones start with
//   "* " ("* myContacts", "* starred");
// - a "* " prefix on a phone/email label marks the primary one;
// - birthdays are "YYYY-MM-DD" or "--MM-DD";
// - phone numbers may contain non-breaking spaces.
// The standard PeopleLink CSV uses the same numbered column names so one
// reader handles both.

const GOOGLE_SPLIT = ' ::: ';
const GOOGLE_MAX_ROWS = 3000; // Google's limit per import file

// ---- reading ----

function readFileText(file) {
  const read = enc => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.readAsText(file, enc);
  });
  return read('utf-8').then(text => {
    // Not UTF-8 (e.g. saved from older Excel): fall back to Windows-1252.
    const bad = (text.match(/�/g) || []).length;
    return bad > 2 ? read('windows-1252') : text;
  }).then(text => text.replace(/^﻿/, ''));
}

// RFC 4180 CSV: quoted fields, "" escapes, newlines inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f !== '')) rows.push(row);
  return rows;
}

const clean = v => String(v ?? '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
const splitMulti = v => clean(v) ? String(v).split(GOOGLE_SPLIT).map(clean).filter(Boolean) : [];

function normLabel(raw, allowed) {
  const l = clean(raw).replace(/^\*\s*/, '').toLowerCase();
  if (allowed.includes(l)) return l;
  if (['cell', 'cellular', 'iphone', 'mobile phone'].includes(l)) return allowed.includes('mobile') ? 'mobile' : 'other';
  return 'other';
}

function parseCsvDate(v) {
  v = clean(v);
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  m = v.match(/^--(\d{1,2})-(\d{1,2})$/);
  if (m) return { year: null, month: Number(m[1]), day: Number(m[2]) };
  return null;
}

// Rows -> { records, labels: Map(name -> count), starred, ignored, invalid }.
// Each record keeps its raw label names in `labels`; the page decides which
// become groups.
function contactsFromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('That file has no contacts in it.');
  const head = rows[0].map(clean);
  const col = name => head.indexOf(name);
  const known = new Set();
  const get = (r, ...names) => {
    for (const n of names) {
      const i = col(n);
      if (i >= 0) { known.add(n); return clean(r[i]); }
    }
    return '';
  };
  const numbered = (prefix, field) => {
    const out = [];
    head.forEach((h, i) => {
      const m = h.match(new RegExp(`^${prefix} (\\d+) - ${field}$`));
      if (m) { out.push({ n: Number(m[1]), i }); known.add(h); }
    });
    return out.sort((a, b) => a.n - b.n);
  };
  const looksGoogle = head.includes('Labels') || head.includes('Organization Name');
  if (!head.includes('First Name') && !head.includes('Last Name') && !head.includes('Organization Name') && !head.includes('Organization')) {
    throw new Error('This doesn\'t look like a Google Contacts or PeopleLink CSV (no "First Name" column).');
  }

  const records = [];
  const invalid = [];
  const labels = new Map();
  rows.slice(1).forEach((r, idx) => {
    const rec = {
      row: idx + 2,
      firstName: get(r, 'First Name'), middleName: get(r, 'Middle Name'), lastName: get(r, 'Last Name'),
      nickname: get(r, 'Nickname'),
      organization: get(r, 'Organization Name', 'Organization'),
      jobTitle: get(r, 'Organization Title', 'Job Title'),
      notes: String(r[col('Notes')] ?? '').replace(/ /g, ' ').trim(),
      birthday: parseCsvDate(get(r, 'Birthday')),
      anniversary: parseCsvDate(get(r, 'Anniversary')),
      phones: [], emails: [], addresses: [], labels: [], starred: false,
    };
    if (col('Notes') >= 0) known.add('Notes');

    numbered('Phone', 'Value').forEach(({ n, i }) => {
      const label = normLabel(r[col(`Phone ${n} - Label`)], ['mobile', 'home', 'work', 'main', 'other']);
      // "Â " is a non-breaking space that went through Excel as Windows-1252.
      splitMulti(String(r[i] ?? '').replace(/Â(?=[  ])/g, '')).forEach(v => rec.phones.push({ label, value: v }));
    });
    numbered('E-mail', 'Value').forEach(({ n, i }) => {
      const label = normLabel(r[col(`E-mail ${n} - Label`)], ['home', 'work', 'other']);
      splitMulti(r[i]).forEach(v => rec.emails.push({ label, value: v }));
    });
    numbered('Phone', 'Label'); numbered('E-mail', 'Label');
    numbered('Event', 'Label'); numbered('Event', 'Value').forEach(({ n, i }) => {
      if (/anniversary/i.test(clean(r[col(`Event ${n} - Label`)]))) rec.anniversary = rec.anniversary || parseCsvDate(r[i]);
    });

    const addrNums = new Set();
    head.forEach(h => { const m = h.match(/^Address (\d+) - /); if (m) { addrNums.add(Number(m[1])); known.add(h); } });
    [...addrNums].sort((a, b) => a - b).forEach(n => {
      const f = name => clean(r[col(`Address ${n} - ${name}`)]);
      let street = [String(r[col(`Address ${n} - Street`)] ?? '').replace(/ /g, ' ').trim(), f('Extended Address'), f('PO Box') ? `PO Box ${f('PO Box').replace(/^PO Box\s*/i, '')}` : '']
        .filter(Boolean).join('\n');
      const a = { label: normLabel(f('Label'), ['home', 'work', 'other']), street, city: f('City'), region: f('Region'), postalCode: f('Postal Code'), country: f('Country') };
      // Only a formatted address (no parts): keep it as the street lines.
      if (!a.street && !a.city && !a.region && !a.postalCode && !a.country) a.street = String(r[col(`Address ${n} - Formatted`)] ?? '').replace(/ /g, ' ').trim();
      if (a.street || a.city || a.region || a.postalCode || a.country) rec.addresses.push(a);
    });

    const rawLabels = looksGoogle ? splitMulti(get(r, 'Labels')) : get(r, 'Groups').split(';').map(clean).filter(Boolean);
    rawLabels.forEach(l => {
      if (l === '* starred') { rec.starred = true; return; }
      if (l === '* myContacts') return;
      const name = l.replace(/^\*\s*/, '').slice(0, 100);
      if (!name) return;
      rec.labels.push(name);
      labels.set(name, (labels.get(name) || 0) + 1);
    });

    // The same number or email listed twice (e.g. Phone 1 and Phone 2) is kept once.
    const seen = new Set();
    rec.phones = rec.phones.filter(x => { const k = 'p' + phoneKey(x.value); return seen.has(k) ? false : seen.add(k); });
    rec.emails = rec.emails.filter(x => { const k = 'e' + x.value.toLowerCase(); return seen.has(k) ? false : seen.add(k); });

    if (!rec.firstName && !rec.lastName && !rec.nickname && !rec.organization) {
      // Google sometimes has a contact that is only an email or phone.
      const only = (rec.emails[0] || rec.phones[0] || {}).value;
      if (only) rec.firstName = only;
      else { invalid.push({ row: rec.row, reason: 'No name, organization, email or phone' }); return; }
    }
    records.push(rec);
  });

  const ignored = head.filter(h => h && !known.has(h) && !/^(Labels|Groups|Anniversary|Birthday|Notes)$/.test(h))
    .filter(h => rows.slice(1).some(r => clean(r[col(h)])));
  return { format: looksGoogle ? 'google' : 'standard', records, labels, invalid, ignored };
}

// "Imported on 8/30 1" style labels Google adds on every import.
function isGoogleImportLabel(name) {
  return /^Imported on /i.test(name);
}

// ---- duplicate matching ----
// Email first (strongest), then phone (last 10 digits), then same name.

function phoneKey(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

function nameKey(first, last, org) {
  const f = String(first || '').trim().toLowerCase();
  const l = String(last || '').trim().toLowerCase();
  if (f && l) return `${f}|${l}`;
  if (!f && !l && org) return `org|${String(org).trim().toLowerCase()}`;
  return '';
}

function buildMatcher(people) {
  const byEmail = new Map();
  const byPhone = new Map();
  const byName = new Map();
  people.forEach(p => {
    p.Emails.forEach(e => byEmail.set(e.Value.toLowerCase(), p));
    p.Phones.forEach(x => { const k = phoneKey(x.Value); if (k.length >= 7) byPhone.set(k, p); });
    [nameKey(p.FirstName, p.LastName, p.Organization), nameKey(p.Nickname, p.LastName, null)].forEach(k => { if (k) byName.set(k, p); });
  });
  return rec => {
    for (const e of rec.emails || []) { const p = byEmail.get(String(e.value).toLowerCase()); if (p) return { person: p, reason: 'same email' }; }
    for (const x of rec.phones || []) { const k = phoneKey(x.value); const p = k.length >= 7 && byPhone.get(k); if (p) return { person: p, reason: 'same phone' }; }
    const keys = [nameKey(rec.firstName, rec.lastName, rec.organization), nameKey(rec.nickname, rec.lastName, null)];
    for (const k of keys) { const p = k && byName.get(k); if (p) return { person: p, reason: 'same name' }; }
    return null;
  };
}

// ---- writing ----

function csvField(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  return rows.map(r => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

function csvDate(d) {
  if (!d) return '';
  const pad = n => String(n).padStart(2, '0');
  return d.Year ? `${d.Year}-${pad(d.Month)}-${pad(d.Day)}` : `--${pad(d.Month)}-${pad(d.Day)}`;
}

function maxOf(people, f) {
  return people.reduce((m, p) => Math.max(m, f(p).length), 0);
}

// labelsFor(p) -> group names to write for that person.
function googleCsv(people, labelsFor) {
  const nP = Math.max(1, maxOf(people, p => p.Phones));
  const nE = Math.max(1, maxOf(people, p => p.Emails));
  const nA = maxOf(people, p => p.Addresses);
  const nEv = people.some(p => p.Anniversary) ? 1 : 0;
  const head = ['First Name', 'Middle Name', 'Last Name', 'Phonetic First Name', 'Phonetic Middle Name', 'Phonetic Last Name',
    'Name Prefix', 'Name Suffix', 'Nickname', 'File As', 'Organization Name', 'Organization Title', 'Organization Department',
    'Birthday', 'Notes', 'Photo', 'Labels'];
  for (let i = 1; i <= nE; i++) head.push(`E-mail ${i} - Label`, `E-mail ${i} - Value`);
  for (let i = 1; i <= nP; i++) head.push(`Phone ${i} - Label`, `Phone ${i} - Value`);
  for (let i = 1; i <= nA; i++) head.push(`Address ${i} - Label`, `Address ${i} - Formatted`, `Address ${i} - Street`, `Address ${i} - City`,
    `Address ${i} - PO Box`, `Address ${i} - Region`, `Address ${i} - Postal Code`, `Address ${i} - Country`, `Address ${i} - Extended Address`);
  for (let i = 1; i <= nEv; i++) head.push(`Event ${i} - Label`, `Event ${i} - Value`);

  const rows = people.map(p => {
    // Notes are private and deliberately left out.
    const r = [p.FirstName, p.MiddleName, p.LastName, '', '', '', '', '', p.Nickname, '', p.Organization, p.JobTitle, '',
      csvDate(p.Birthday), '', '', ['* myContacts', ...labelsFor(p)].join(GOOGLE_SPLIT)];
    for (let i = 0; i < nE; i++) { const e = p.Emails[i]; r.push(e ? labelText(e.Label) : '', e ? e.Value : ''); }
    for (let i = 0; i < nP; i++) { const x = p.Phones[i]; r.push(x ? labelText(x.Label) : '', x ? x.Value : ''); }
    for (let i = 0; i < nA; i++) {
      const a = p.Addresses[i];
      r.push(...(a ? [labelText(a.Label), addressLines(a).join('\n'), a.Street, a.City, '', a.Region, a.PostalCode, a.Country, ''] : Array(9).fill('')));
    }
    if (nEv) r.push(p.Anniversary ? 'Anniversary' : '', csvDate(p.Anniversary));
    return r.map(v => v ?? '');
  });
  return toCsv([head, ...rows]);
}

function standardCsv(people, labelsFor) {
  const nP = Math.max(1, maxOf(people, p => p.Phones));
  const nE = Math.max(1, maxOf(people, p => p.Emails));
  const nA = maxOf(people, p => p.Addresses);
  const head = ['First Name', 'Middle Name', 'Last Name', 'Nickname', 'Organization', 'Job Title', 'Occupation', 'Birthday', 'Anniversary', 'Status', 'Groups'];
  for (let i = 1; i <= nP; i++) head.push(`Phone ${i} - Label`, `Phone ${i} - Value`);
  for (let i = 1; i <= nE; i++) head.push(`E-mail ${i} - Label`, `E-mail ${i} - Value`);
  for (let i = 1; i <= nA; i++) head.push(`Address ${i} - Label`, `Address ${i} - Street`, `Address ${i} - City`, `Address ${i} - Region`, `Address ${i} - Postal Code`, `Address ${i} - Country`);
  const rows = people.map(p => {
    const r = [p.FirstName, p.MiddleName, p.LastName, p.Nickname, p.Organization, p.JobTitle, p.Occupation,
      csvDate(p.Birthday), csvDate(p.Anniversary), p.Status, labelsFor(p).join('; ')];
    for (let i = 0; i < nP; i++) { const x = p.Phones[i]; r.push(x ? labelText(x.Label) : '', x ? x.Value : ''); }
    for (let i = 0; i < nE; i++) { const e = p.Emails[i]; r.push(e ? labelText(e.Label) : '', e ? e.Value : ''); }
    for (let i = 0; i < nA; i++) { const a = p.Addresses[i]; r.push(...(a ? [labelText(a.Label), a.Street, a.City, a.Region, a.PostalCode, a.Country] : Array(6).fill(''))); }
    return r.map(v => v ?? '');
  });
  // The byte-order mark makes Excel open the file as UTF-8 (accents etc.).
  return '﻿' + toCsv([head, ...rows]);
}

function downloadText(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
