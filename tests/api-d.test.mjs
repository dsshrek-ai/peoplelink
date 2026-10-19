// PeopleLink API acceptance tests (Milestone D: merge, backup/restore, bulk
// stay-in-touch, contact summary). Fresh database, as api.test.mjs:
//   node tests/api-d.test.mjs http://127.0.0.1:8098/api/api.php path/to/small.jpg
const API = process.argv[2] || 'http://127.0.0.1:8098/api/api.php';
const JPEG = (await import('node:fs')).readFileSync(process.argv[3]);
let pass = 0;
let failCount = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { failCount++; console.log('FAIL:', msg); }
}
async function get(token, action, params = {}) {
  const res = await fetch(`${API}?${new URLSearchParams({ action, ...params })}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, data: await res.json().catch(() => null) };
}
async function post(token, action, body = {}) {
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action, ...body }) });
  return { status: res.status, data: await res.json().catch(() => null) };
}
async function setPhoto(t, id) {
  const fd = new FormData();
  fd.set('action', 'setPhoto'); fd.set('id', String(id));
  fd.set('full', new Blob([JPEG]), 'f.jpg'); fd.set('thumb', new Blob([JPEG]), 't.jpg');
  return (await (await fetch(API, { method: 'POST', headers: { Authorization: `Bearer ${t}` }, body: fd })).json()).PhotoKey;
}
async function journalPhoto(t, entryId) {
  const fd = new FormData();
  fd.set('action', 'addJournalPhoto'); fd.set('entryId', String(entryId));
  fd.set('full', new Blob([JPEG]), 'f.jpg'); fd.set('thumb', new Blob([JPEG]), 't.jpg');
  return (await (await fetch(API, { method: 'POST', headers: { Authorization: `Bearer ${t}` }, body: fd })).json()).Key;
}
const photoExists = async k => (await fetch(`${API}?action=photo&k=${k}`)).status === 200;
const login = async u => (await post(null, 'login', { username: u, password: 'pw' })).data.token;
const alice = await login('alice');
const bob = await login('bob');
const pad = n => String(n).padStart(2, '0');
const today = (d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)(new Date());
const person = async (t, id) => (await get(t, 'person', { id })).data;

// ---------- bulk stay in touch ----------
const a1 = (await post(alice, 'savePerson', { firstName: 'A1' })).data.Id;
const a2 = (await post(alice, 'savePerson', { firstName: 'A2' })).data.Id;
const b1 = (await post(bob, 'savePerson', { firstName: 'B1' })).data.Id;
let r = await post(alice, 'setContactInterval', { ids: [a1, a2, b1], intervalDays: 30 });
ok(r.data.Changed === 2, 'bulk interval only touches own people');
ok((await person(bob, b1)).Person.ContactIntervalDays === null, 'bob person untouched');
ok((await post(alice, 'setContactInterval', { ids: [a1], intervalDays: 0 })).status === 400, 'bad interval refused');
await post(alice, 'setContactInterval', { ids: [a2], intervalDays: null });
ok((await person(alice, a2)).Person.ContactIntervalDays === null, 'bulk back to N/A');

// ---------- merge ----------
const fam = (await post(alice, 'saveGroup', { name: 'Family' })).data.Id;
const choir = (await post(alice, 'saveGroup', { name: 'Choir' })).data.Id;
const keep = (await post(alice, 'savePerson', { firstName: 'Robert', lastName: 'Smith', notes: 'keep note',
  phones: [{ label: 'mobile', value: '801-555-1111' }], groupIds: [fam] })).data.Id;
const dupe = (await post(alice, 'savePerson', { firstName: 'Bob', lastName: 'Smith', nickname: 'Bobby', notes: 'dupe note',
  phones: [{ label: 'home', value: '(801) 555-1111' }, { label: 'work', value: '801-555-2222' }],
  emails: [{ label: 'home', value: 'bob@x.com' }], birthday: { month: 3, day: 4, year: 1970 },
  addresses: [{ label: 'home', street: '1 Elm' }], groupIds: [fam, choir] })).data.Id;
const friend = (await post(alice, 'savePerson', { firstName: 'Friend' })).data.Id;
await post(alice, 'setPinned', { id: dupe, pinned: true });
const dupePhoto = await setPhoto(alice, dupe);
await post(alice, 'saveJournalEntry', { personId: dupe, date: today, kind: 'call', body: 'dupe call', today });
// (after logging -- logging today's contact clears a follow-up date)
await post(alice, 'saveContactPlan', { id: dupe, intervalDays: 14, followUpDate: '2030-01-01' });
await post(alice, 'saveJournalEntry', { personId: keep, date: '2026-01-01', kind: 'visit', today });
const act = (await post(alice, 'saveActivity', { title: 'Party', date: today, participantIds: [keep, dupe] })).data.Id;
await post(alice, 'saveRelationship', { personId: dupe, relatedId: friend, kind: 'friend' });
await post(alice, 'saveRelationship', { personId: keep, relatedId: dupe, kind: 'sibling' });

ok((await post(bob, 'mergePeople', { keepId: keep, mergeId: dupe })).status === 404, 'bob cannot merge alice people');
ok((await post(alice, 'mergePeople', { keepId: keep, mergeId: keep })).status === 400, 'cannot merge with self');
ok((await post(alice, 'mergePeople', { keepId: keep, mergeId: b1 })).status === 404, 'cannot merge another user\'s person');
r = await post(alice, 'mergePeople', { keepId: keep, mergeId: dupe });
ok(r.data.ok, 'merge');
let d = await person(alice, keep);
let p = d.Person;
ok((await get(alice, 'person', { id: dupe })).status === 404, 'merged person gone');
ok(p.FirstName === 'Robert' && p.Nickname === 'Bobby', 'keeps name, fills blank nickname');
ok(p.Phones.length === 2 && p.Phones.some(x => x.Value === '(801) 555-2222'), 'phones combined without duplicate');
ok(p.Emails.length === 1 && p.Addresses.length === 1, 'email + address moved');
ok(p.Birthday && p.Birthday.Year === 1970, 'birthday filled');
ok(p.Notes === 'keep note\n\ndupe note', 'notes appended');
ok(p.ContactIntervalDays === 14 && p.FollowUpDate === '2030-01-01' && p.Pinned, 'interval, follow-up, pin carried over');
ok(p.PhotoKey === dupePhoto && await photoExists(dupePhoto), 'photo moved (keep had none)');
ok(p.GroupIds.sort().join() === [fam, choir].sort().join(), 'groups combined');
ok(d.Journal.length === 2 && p.LastContact === today, 'journal moved, last contact updated');
ok(d.Activities.length === 1 && d.Activities[0].ParticipantIds.filter(x => x === keep).length === 1, 'activity participant not duplicated');
ok(d.Relationships.length === 1 && d.Relationships[0].PersonId === friend, 'link to friend moved; self-link dropped');

// ---------- contact summary ----------
r = await get(alice, 'journalSummary', { from: '2026-01-01' });
ok(r.data.ByMonth.reduce((a, x) => a + x.Count, 0) === 2 && r.data.ByPerson[0].PersonId === keep && r.data.ByPerson[0].Count === 2, 'summary counts');
ok((await get(bob, 'journalSummary')).data.ByMonth.length === 0, 'bob summary empty');

// ---------- backup ----------
const hh = (await post(alice, 'saveHousehold', { name: 'The Smiths', street: '1 Elm', addPersonId: keep })).data.Id;
const entry = (await person(alice, keep)).Journal[0].Id;
const jKey = await journalPhoto(alice, entry);
let bk = (await get(alice, 'backup')).data;
ok(bk.App === 'PeopleLink' && bk.BackupVersion === 1, 'backup header');
ok(bk.People.length === 4 && bk.People.find(x => x.Id === keep).Notes === 'keep note\n\ndupe note', 'backup has people with notes');
ok(bk.Journal.length === 2 && bk.Activities.length === 1 && bk.Relationships.length === 1 && bk.Households.length === 1 && bk.Groups.length === 2, 'backup has everything');
ok(Object.keys(bk.Photos).length === 0, 'no photos unless asked');
const bkPhotos = (await get(alice, 'backup', { photos: '1' })).data;
ok(Object.keys(bkPhotos.Photos).length === 2 && bkPhotos.Photos[jKey].Full.length > 100, 'photos embedded when asked');
ok((await get(bob, 'backup')).data.People.length === 1, 'bob backup has only his');

// ---------- restore ----------
ok((await post(alice, 'restore', { data: bkPhotos })).status === 400, 'restore needs confirm');
ok((await post(alice, 'restore', { confirm: 'REPLACE', data: { App: 'Other' } })).status === 400, 'non-backup refused');
// change things after the backup
await post(alice, 'deletePeople', { ids: [keep] });
await post(alice, 'savePerson', { firstName: 'Added later' });
ok(!(await photoExists(dupePhoto)) && !(await photoExists(jKey)), 'photos gone after delete');
r = await post(alice, 'restore', { confirm: 'REPLACE', data: bkPhotos });
ok(r.data.ok && r.data.Restored.People === 4 && r.data.Restored.Journal === 2, 'restore counts ' + JSON.stringify(r.data));
let list = (await get(alice, 'people')).data;
ok(list.People.length === 4 && !list.People.some(x => x.FirstName === 'Added later'), 'restore replaced everything');
const rk = list.People.find(x => x.FirstName === 'Robert');
d = await person(alice, rk.Id);
ok(d.Person.Notes === 'keep note\n\ndupe note' && d.Person.ContactIntervalDays === 14 && d.Person.Pinned, 'details restored');
ok(d.Person.GroupIds.length === 2 && d.Journal.length === 2 && d.Activities.length === 1 && d.Relationships.length === 1, 'links restored');
ok(d.Households.length === 1 && d.Person.HouseholdId === d.Households[0].Id, 'household restored');
ok(d.Person.PhotoKey && d.Person.PhotoKey !== dupePhoto && await photoExists(d.Person.PhotoKey), 'profile photo restored from file');
const rjKey = d.Journal.flatMap(e => e.Photos)[0].Key;
ok(rjKey && await photoExists(rjKey), 'journal photo restored');
ok((await get(bob, 'people')).data.People.length === 1, 'bob untouched by alice restore');

// restore without photos keeps photos still on the server; old unused files cleaned
const bk2 = (await get(alice, 'backup')).data;
r = await post(alice, 'restore', { confirm: 'REPLACE', data: bk2 });
d = await person(alice, (await get(alice, 'people')).data.People.find(x => x.FirstName === 'Robert').Id);
ok(d.Person.PhotoKey === bk2.People.find(x => x.FirstName === 'Robert').PhotoKey && await photoExists(d.Person.PhotoKey), 'photo kept by key when file lacks photos');

console.log(`${pass} passed, ${failCount} failed`);
process.exit(failCount ? 1 : 0);
