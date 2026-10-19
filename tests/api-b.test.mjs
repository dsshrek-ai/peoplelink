// PeopleLink API acceptance tests (Milestone B: import engine + sharing).
// Same fresh-database setup as api.test.mjs:
//   node tests/api-b.test.mjs http://127.0.0.1:8098/api/api.php path/to/small.jpg
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
const login = async u => (await post(null, 'login', { username: u, password: 'pw' })).data.token;
const alice = await login('alice');
const bob = await login('bob');
const people = async t => (await get(t, 'people')).data;
const byName = (list, first) => list.People.find(p => p.FirstName === first);

// ---------- import engine ----------
const existing = (await post(alice, 'savePerson', {
  firstName: 'Aaron', lastName: 'Senior', notes: 'keep my notes', phones: [{ label: 'mobile', value: '801-261-2586' }],
  emails: [{ label: 'home', value: 'aaronsenior51@gmail.com' }], birthday: { month: 1, day: 2, year: 1960 },
})).data.Id;

let r = await post(alice, 'importPeople', { items: [
  { action: 'merge', personId: existing, record: {
    firstName: 'Aaron', lastName: 'Senior', middleName: 'Q', notes: 'imported note', pinned: true,
    birthday: { year: 1999, month: 5, day: 5 },
    phones: [{ label: 'home', value: '(801) 261-2586' }, { label: 'work', value: '(801) 555-0000' }],
    emails: [{ label: 'home', value: 'AaronSenior51@gmail.com' }, { label: 'work', value: 'aaron@work.com' }],
    addresses: [{ label: 'home', street: '1 A St' }], groupNames: ['SOS'] } },
  { action: 'create', record: { firstName: 'Anna', lastName: 'Heath', organization: 'SOS', jobTitle: 'Soprano - 1st', notes: "5'4\"",
    phones: [{ label: '* bogus', value: '(801) 787-9749' }], emails: [{ value: 'not-an-email' }],
    birthday: { month: 2, day: 31 }, anniversary: { month: 6, day: 1, year: 1990 },
    addresses: [{ street: '4669 Hemlock Dr' }], groupNames: ['SOS', 'Imported on 8/30 1'] } },
  { action: 'skip', record: { firstName: 'Skip', lastName: 'Me' } },
  { action: 'create', record: { emails: [{ value: 'x@y.z' }] } },
  { action: 'merge', personId: 999999, record: { firstName: 'Ghost' } },
] });
ok(r.data.Created === 1 && r.data.Merged === 1 && r.data.Skipped === 1 && r.data.Problems.length === 2, 'import counts ' + JSON.stringify(r.data));
ok(!('Ids' in r.data), 'internal ids not returned');
let a = (await get(alice, 'person', { id: existing })).data.Person;
ok(a.Notes === 'keep my notes', 'merge keeps notes');
ok(a.Birthday.Year === 1960 && a.Birthday.Month === 1, 'merge keeps birthday');
ok(a.MiddleName === 'Q', 'merge fills empty middle name');
ok(a.Pinned === true, 'merge pins starred');
ok(a.Phones.length === 2 && a.Phones.some(p => p.Value === '(801) 555-0000'), 'merge adds only new phone ' + JSON.stringify(a.Phones));
ok(a.Emails.length === 2, 'merge dedupes email case-insensitively');
ok(a.Addresses.length === 1, 'merge adds address');
let list = await people(alice);
const anna = byName(list, 'Anna');
ok(anna && anna.Phones[0].Label === 'other' && anna.Emails.length === 0, 'lenient labels and bad email dropped');
ok(anna.Birthday === null && anna.Anniversary.Year === 1990, 'bad birthday dropped, anniversary kept');
ok((await get(alice, 'person', { id: anna.Id })).data.Person.Notes === "5'4\"", 'notes imported on create');
const sos = list.Groups.find(g => g.Name === 'SOS');
ok(sos && list.Groups.some(g => g.Name === 'Imported on 8/30 1'), 'groups created from names');
ok(anna.GroupIds.includes(sos.Id) && a.GroupIds.includes(sos.Id), 'existing group reused for merge and create');
ok((await post(alice, 'importPeople', { items: Array(501).fill({ action: 'skip' }) })).status === 400, 'batch limit');
// bob can't merge into alice's people
r = await post(bob, 'importPeople', { items: [{ action: 'merge', personId: existing, record: { firstName: 'Evil', notes: 'x' } }] });
ok(r.data.Merged === 0 && r.data.Problems.length === 1, 'cannot merge into another user\'s person');

// ---------- sharing ----------
// give one SOS member a photo
const fd = new FormData();
fd.set('action', 'setPhoto'); fd.set('id', String(anna.Id));
fd.set('full', new Blob([JPEG]), 'f.jpg'); fd.set('thumb', new Blob([JPEG]), 't.jpg');
const annaKey = (await (await fetch(API, { method: 'POST', headers: { Authorization: `Bearer ${alice}` }, body: fd })).json()).PhotoKey;
await post(alice, 'setStatus', { ids: [byName(list, 'Aaron').Id], status: 'active' });

ok((await post(alice, 'createShare', { groupId: sos.Id, username: 'alice' })).status === 400, 'cannot share with self');
ok((await post(alice, 'createShare', { groupId: sos.Id, username: 'nobody' })).status === 404, 'unknown user');
ok((await post(alice, 'createShare', { groupId: sos.Id, username: 'carol' })).status === 400, 'recipient without access');
ok((await post(bob, 'createShare', { groupId: sos.Id, username: 'alice' })).status === 404, 'cannot share someone else\'s group');
r = await post(alice, 'createShare', { groupId: sos.Id, username: 'bob', includePhotos: true });
ok(r.data.ok && r.data.Count === 2 && r.data.To === 'Bob', 'share created ' + JSON.stringify(r.data));
const inv1 = r.data.Id;

let boot = (await get(bob, 'bootstrap')).data;
ok(boot.PendingInvitations === 1, 'bob sees pending count');
ok((await get(alice, 'invitation', { id: inv1 })).status === 404, 'sender cannot open recipient view');
let inv = (await get(bob, 'invitation', { id: inv1 })).data.Invitation;
ok(inv.From === 'Alice' && inv.People.length === 2, 'bob opens invitation');
const payloadKeys = inv.People.flatMap(Object.keys);
ok(!payloadKeys.some(k => /notes|birthday|anniversary|organization|jobTitle|pinned|group/i.test(k)), 'payload has only basic fields: ' + [...new Set(payloadKeys)]);
const sharedPhoto = inv.People.find(c => c.photoKey).photoKey;
ok(sharedPhoto && sharedPhoto !== annaKey, 'photo copied under a new key');

// bob already has Anna (by email? no -- by name) -> merge; Aaron -> create
const bobAnna = (await post(bob, 'savePerson', { firstName: 'Anna', lastName: 'Heath', notes: 'bob note' })).data.Id;
const fam = (await post(bob, 'saveGroup', { name: 'SOS' })).data.Id;
r = await post(bob, 'acceptShare', { id: inv1, groupMode: 'new', groupName: 'SOS' });
ok(r.status === 400 && /already have/.test(r.data.error), 'new group name clash refused');
const annaIdx = inv.People.findIndex(c => c.firstName === 'Anna');
r = await post(bob, 'acceptShare', { id: inv1, groupMode: 'existing', groupId: fam,
  decisions: inv.People.map((c, index) => index === annaIdx ? { index, action: 'merge', personId: bobAnna } : { index, action: 'create' }) });
ok(r.data.ok && r.data.Created === 1 && r.data.Merged === 1 && r.data.GroupId === fam, 'accept ' + JSON.stringify(r.data));
const bl = await people(bob);
const bAnna = byName(bl, 'Anna');
ok(bAnna.Id === bobAnna && bAnna.GroupIds.includes(fam) && bAnna.Phones.length === 1, 'merged into bob\'s Anna, in group');
ok((await get(bob, 'person', { id: bobAnna })).data.Person.Notes === 'bob note', 'bob notes kept, alice notes not copied');
ok(bAnna.PhotoKey === sharedPhoto, 'photo attached to merged person without photo');
ok(byName(bl, 'Aaron').GroupIds.includes(fam), 'created person in destination group');
ok((await post(bob, 'acceptShare', { id: inv1, groupMode: 'existing', groupId: fam })).status === 400, 'cannot accept twice');
// independence: alice edits her copy, bob's doesn't change
await post(alice, 'savePerson', { id: anna.Id, firstName: 'Annabelle', lastName: 'Heath' });
ok(byName(await people(bob), 'Anna') !== undefined, 'copy not synced');
let outgoing = (await get(alice, 'invitations')).data.Outgoing;
ok(outgoing[0].Status === 'accepted' && /1 added, 1 merged/.test(outgoing[0].Summary), 'sender sees result');

// decline + cancel clean up photo copies
r = await post(alice, 'createShare', { groupId: sos.Id, username: 'bob', includePhotos: true });
const inv2 = r.data.Id;
const key2 = (await get(bob, 'invitation', { id: inv2 })).data.Invitation.People.find(c => c.photoKey).photoKey;
ok((await fetch(`${API}?action=photo&k=${key2}`)).status === 200, 'pending share photo exists');
ok((await post(alice, 'declineShare', { id: inv2 })).status === 404, 'sender cannot decline');
await post(bob, 'declineShare', { id: inv2 });
ok((await fetch(`${API}?action=photo&k=${key2}`)).status === 404, 'decline deletes photo copy');
ok((await post(bob, 'acceptShare', { id: inv2 })).status === 400, 'cannot accept declined');

r = await post(alice, 'createShare', { groupId: sos.Id, username: 'bob', includePhotos: true });
const inv3 = r.data.Id;
const key3 = (await get(bob, 'invitation', { id: inv3 })).data.Invitation.People.find(c => c.photoKey).photoKey;
ok((await post(bob, 'cancelShare', { id: inv3 })).status === 404, 'recipient cannot cancel');
await post(alice, 'cancelShare', { id: inv3 });
ok((await fetch(`${API}?action=photo&k=${key3}`)).status === 404, 'cancel deletes photo copy');
ok((await get(alice, 'person', { id: anna.Id })).data.Person.PhotoKey === annaKey, 'sender photo untouched');
ok((await fetch(`${API}?action=photo&k=${annaKey}`)).status === 200, 'sender photo file still there');

// without photos nothing is copied
r = await post(alice, 'createShare', { groupId: sos.Id, username: 'bob' });
ok((await get(bob, 'invitation', { id: r.data.Id })).data.Invitation.People.every(c => !c.photoKey), 'no photos unless asked');

console.log(`${pass} passed, ${failCount} failed`);
process.exit(failCount ? 1 : 0);
