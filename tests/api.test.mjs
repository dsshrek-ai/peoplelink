// PeopleLink API acceptance tests (Milestone A).
// Needs a FRESH test database with the Hub tables + api/schema.sql, users
// alice / bob (password "pw", both granted peoplelink) and carol (no grant).
//   node tests/api.test.mjs http://127.0.0.1:8098/api/api.php path/to/small.jpg
const API = process.argv[2] || 'http://127.0.0.1:8098/api/api.php';
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
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, ...body }),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
async function login(u) {
  return (await post(null, 'login', { username: u, password: 'pw' })).data.token;
}

// A small real JPEG so the server can decode it (path as the 2nd argument).
const JPEG = (await import('node:fs')).readFileSync(process.argv[3]);

const alice = await login('alice');
const bob = await login('bob');
const carol = await login('carol');
ok(alice && bob && carol, 'logins');
ok((await get(carol, 'bootstrap')).status === 403, 'carol (no grant) refused');
ok((await get(null, 'people')).status === 401, 'no token refused');

// --- create / read ---
let r = await post(alice, 'savePerson', { firstName: '' });
ok(r.status === 400 && /name/.test(r.data.error), 'nameless refused');
r = await post(alice, 'savePerson', { organization: 'Acme Plumbing' });
ok(r.data.ok, 'org-only person allowed');

r = await post(alice, 'saveGroup', { name: 'Family', color: '#0f766e', icon: '👪' });
const fam = r.data.Id;
ok(fam > 0, 'create group');
r = await post(alice, 'saveGroup', { name: 'Family' });
ok(r.status === 400 && /already/.test(r.data.error), 'duplicate group name refused');
const choir = (await post(alice, 'saveGroup', { name: 'Choir' })).data.Id;

r = await post(alice, 'savePerson', {
  firstName: 'Robert', lastName: 'Smith', nickname: 'Bob', middleName: 'James',
  phones: [{ label: 'mobile', value: '(801) 555-1234' }, { label: 'bogus', value: '+44 20 7946 0958' }, { label: 'home', value: '' }],
  emails: [{ label: 'work', value: 'bob@example.com' }],
  addresses: [{ label: 'home', street: '123 Main St\nApt 4', city: 'Murray', region: 'UT', postalCode: '84107', country: 'USA' }, { label: 'work' }],
  birthday: { month: 2, day: 29, year: '' },
  anniversary: { month: 6, day: 15, year: 1990 },
  notes: 'Likes fishing',
  groupIds: [fam, choir],
});
ok(r.data.ok, 'create full person ' + JSON.stringify(r.data));
const bobSmith = r.data.Id;
let p = (await get(alice, 'person', { id: bobSmith })).data.Person;
ok(p.Phones.length === 2 && p.Phones[1].Label === 'other' && p.Phones[0].Value === '(801) 555-1234', 'phones saved, bad label -> other, blank dropped');
ok(p.Addresses.length === 1 && p.Addresses[0].Street === '123 Main St\nApt 4', 'blank address dropped');
ok(p.Birthday.Month === 2 && p.Birthday.Day === 29 && p.Birthday.Year === null, 'Feb 29 without year');
ok(p.Anniversary.Year === 1990, 'anniversary year');
ok(p.Notes === 'Likes fishing', 'notes on person');
ok(p.GroupIds.sort().join() === [fam, choir].sort().join(), 'groups set');

r = await post(alice, 'savePerson', { firstName: 'X', birthday: { month: 2, day: 30 } });
ok(r.status === 400, 'Feb 30 refused');
r = await post(alice, 'savePerson', { firstName: 'X', birthday: { month: 5 } });
ok(r.status === 400, 'month without day refused');
r = await post(alice, 'savePerson', { firstName: 'X', emails: [{ value: 'nope' }] });
ok(r.status === 400, 'bad email refused');

// list excludes notes
let list = (await get(alice, 'people')).data;
ok(list.People.length === 2 && list.People.every(x => !('Notes' in x)), 'list has no notes');
ok(list.Groups.find(g => g.Id === fam).MemberCount === 1, 'member count');

// --- update replaces children; omitting groupIds keeps groups ---
r = await post(alice, 'savePerson', { id: bobSmith, firstName: 'Robert', lastName: 'Smith', phones: [{ label: 'work', value: '555-0000' }] });
p = (await get(alice, 'person', { id: bobSmith })).data.Person;
ok(p.Phones.length === 1 && p.Emails.length === 0 && p.Addresses.length === 0 && p.Birthday === null, 'update replaces');
ok(p.GroupIds.length === 2, 'groups kept when groupIds omitted');

// --- isolation: bob cannot see or touch alice's data ---
ok((await get(bob, 'person', { id: bobSmith })).status === 404, 'bob cannot read alice person');
ok((await get(bob, 'people')).data.People.length === 0, 'bob list empty');
ok((await post(bob, 'savePerson', { id: bobSmith, firstName: 'Hacked' })).status === 404, 'bob cannot edit');
ok((await post(bob, 'setPinned', { id: bobSmith, pinned: true })).status === 404, 'bob cannot pin');
r = await post(bob, 'setStatus', { ids: [bobSmith], status: 'archived' });
ok(r.data.Changed === 0, 'bob cannot archive alice person');
r = await post(bob, 'deletePeople', { ids: [bobSmith] });
ok(r.data.Deleted === 0, 'bob cannot delete');
ok((await post(bob, 'groupMembers', { groupId: fam, add: [] })).status === 404, 'bob cannot use alice group');
const bobGroup = (await post(bob, 'saveGroup', { name: 'Family' })).data.Id;
ok(bobGroup > 0, 'bob can have his own Family group');
await post(bob, 'groupMembers', { groupId: bobGroup, add: [bobSmith] });
ok((await get(alice, 'person', { id: bobSmith })).data.Person.GroupIds.length === 2, 'bob cannot add alice person to his group');
r = await post(bob, 'savePerson', { firstName: 'Mine', groupIds: [fam, bobGroup] });
const bobsPerson = r.data.Id;
ok((await get(bob, 'person', { id: bobsPerson })).data.Person.GroupIds.join() === String(bobGroup), 'foreign group ids dropped');
ok((await post(alice, 'savePerson', { id: bobSmith, firstName: 'R', groupIds: [bobGroup] })).data.ok, 'alice save with bob group id');
ok((await get(alice, 'person', { id: bobSmith })).data.Person.GroupIds.length === 0, 'foreign group dropped for alice too');

// --- pin / status / group membership ---
await post(alice, 'setPinned', { id: bobSmith, pinned: true });
ok((await get(alice, 'person', { id: bobSmith })).data.Person.Pinned === true, 'pin');
await post(alice, 'groupMembers', { groupId: fam, add: [bobSmith, bobSmith] });
await post(alice, 'groupMembers', { groupId: choir, add: [bobSmith] });
r = await post(alice, 'setStatus', { ids: [bobSmith], status: 'archived' });
ok(r.data.Changed === 1, 'archive');
list = (await get(alice, 'people')).data;
ok(list.Groups.find(g => g.Id === fam).MemberCount === 0, 'archived excluded from member count');
ok((await post(alice, 'setStatus', { ids: [bobSmith], status: 'gone' })).status === 400, 'bad status');
await post(alice, 'setStatus', { ids: [bobSmith], status: 'active' });
await post(alice, 'groupMembers', { groupId: choir, remove: [bobSmith] });
ok((await get(alice, 'person', { id: bobSmith })).data.Person.GroupIds.join() === String(fam), 'remove from group');

// --- groups: rename / archive / delete keeps people ---
ok((await post(alice, 'saveGroup', { id: choir, name: 'Ward Choir', color: 'red' })).status === 400, 'bad color');
ok((await post(alice, 'saveGroup', { id: choir, name: 'Ward Choir', color: '#123456' })).data.ok, 'rename group');
await post(alice, 'setGroupArchived', { id: choir, archived: true });
ok((await get(alice, 'bootstrap')).data.Groups.find(g => g.Id === choir).Archived, 'archive group');
await post(alice, 'deleteGroup', { id: fam });
ok((await get(alice, 'person', { id: bobSmith })).status === 200, 'person survives group delete');
ok((await get(alice, 'person', { id: bobSmith })).data.Person.GroupIds.length === 0, 'membership gone with group');

// --- photos ---
async function upload(token, id, full = JPEG, thumb = JPEG) {
  const fd = new FormData();
  fd.set('action', 'setPhoto');
  fd.set('id', String(id));
  fd.set('full', new Blob([full], { type: 'image/jpeg' }), 'full.jpg');
  fd.set('thumb', new Blob([thumb], { type: 'image/jpeg' }), 'thumb.jpg');
  const res = await fetch(API, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  return { status: res.status, data: await res.json().catch(() => null) };
}
r = await upload(alice, bobSmith);
ok(r.data && /^[0-9a-f]{32}$/.test(r.data.PhotoKey), 'photo upload ' + JSON.stringify(r.data));
const key1 = r.data.PhotoKey;
let img = await fetch(`${API}?action=photo&k=${key1}&size=thumb`);
ok(img.status === 200 && img.headers.get('content-type') === 'image/jpeg', 'photo served without login');
ok((await upload(bob, bobSmith)).status === 404, 'bob cannot set alice photo');
ok((await upload(alice, bobSmith, Buffer.from('<html>not an image</html>'))).status === 400, 'non-image refused');
r = await upload(alice, bobSmith);
const key2 = r.data.PhotoKey;
ok(key2 !== key1 && (await fetch(`${API}?action=photo&k=${key1}`)).status === 404, 'replacing photo deletes old files');
ok((await fetch(`${API}?action=photo&k=../api`)).status === 404, 'bad key refused');
await post(alice, 'removePhoto', { id: bobSmith });
ok((await fetch(`${API}?action=photo&k=${key2}`)).status === 404, 'remove photo deletes files');
r = await upload(alice, bobSmith);
const key3 = r.data.PhotoKey;
await post(alice, 'deletePeople', { ids: [bobSmith] });
ok((await get(alice, 'person', { id: bobSmith })).status === 404, 'delete person');
ok((await fetch(`${API}?action=photo&k=${key3}`)).status === 404, 'delete person deletes photo');

console.log(`${pass} passed, ${failCount} failed`);
process.exit(failCount ? 1 : 0);
