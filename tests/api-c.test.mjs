// PeopleLink API acceptance tests (Milestone C: journal, reminders,
// relationships, households, activities). Fresh database, as api.test.mjs:
//   node tests/api-c.test.mjs http://127.0.0.1:8098/api/api.php path/to/small.jpg
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
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = ymd(new Date());
const daysAgo = n => ymd(new Date(Date.now() - n * 86400000));
const person = async (t, id) => (await get(t, 'person', { id })).data;

const mom = (await post(alice, 'savePerson', { firstName: 'Margaret', lastName: 'Senior' })).data.Id;
const tom = (await post(alice, 'savePerson', { firstName: 'Tom', lastName: 'Senior' })).data.Id;
const ann = (await post(alice, 'savePerson', { firstName: 'Ann', lastName: 'Lee' })).data.Id;
const bobsGuy = (await post(bob, 'savePerson', { firstName: 'Bobs', lastName: 'Friend' })).data.Id;

// ---------- contact plan ----------
let p = (await person(alice, mom)).Person;
ok(p.ContactIntervalDays === null && p.FollowUpDate === null && p.LastContact === null, 'defaults: N/A, no follow-up, never contacted');
ok((await post(alice, 'saveContactPlan', { id: mom, intervalDays: 0 })).status === 400, 'interval 0 refused');
ok((await post(alice, 'saveContactPlan', { id: mom, intervalDays: 30, followUpDate: '2026-02-30' })).status === 400, 'bad follow-up date refused');
ok((await post(alice, 'saveContactPlan', { id: mom, intervalDays: 30, followUpDate: daysAgo(-5) })).data.ok, 'save plan');
p = (await person(alice, mom)).Person;
ok(p.ContactIntervalDays === 30 && p.FollowUpDate === daysAgo(-5), 'plan saved');
ok((await post(bob, 'saveContactPlan', { id: mom, intervalDays: 7 })).status === 404, 'bob cannot change alice plan');

// ---------- journal ----------
// back-dated entry: does NOT clear the follow-up
let r = await post(alice, 'saveJournalEntry', { personId: mom, date: daysAgo(10), kind: 'call', body: 'Old call', today });
ok(r.data.ok, 'log back-dated');
p = (await person(alice, mom)).Person;
ok(p.FollowUpDate === daysAgo(-5) && p.LastContact === daysAgo(10), 'back-dated keeps follow-up; last contact set');
// today's entry clears it
const e1 = (await post(alice, 'saveJournalEntry', { personId: mom, date: today, kind: 'visit', body: 'Lunch', today })).data.Id;
p = (await person(alice, mom)).Person;
ok(p.FollowUpDate === null && p.LastContact === today, 'today clears follow-up, updates last contact');
// entry with its own follow-up sets the person's
await post(alice, 'saveJournalEntry', { personId: mom, date: today, kind: 'text', followUpDate: daysAgo(-3), today });
ok((await person(alice, mom)).Person.FollowUpDate === daysAgo(-3), 'entry follow-up becomes person follow-up');
ok((await post(alice, 'saveJournalEntry', { personId: mom, date: '', today })).status === 400, 'date required');
r = await post(alice, 'saveJournalEntry', { personId: mom, date: today, kind: 'nonsense', today });
ok(r.data.ok && (await person(alice, mom)).Journal.find(e => e.Id === r.data.Id).Kind === 'other', 'unknown kind -> other');
ok((await post(bob, 'saveJournalEntry', { personId: mom, date: today, today })).status === 404, 'bob cannot log for alice person');
ok((await post(bob, 'saveJournalEntry', { id: e1, date: today, today })).status === 404, 'bob cannot edit alice entry');
ok((await post(bob, 'deleteJournalEntry', { id: e1 })).status === 404, 'bob cannot delete alice entry');
// edit
await post(alice, 'saveJournalEntry', { id: e1, date: today, kind: 'visit', body: 'Lunch at Cafe Rio', today });
let data = await person(alice, mom);
ok(data.Journal.find(e => e.Id === e1).Body === 'Lunch at Cafe Rio', 'edit entry');
ok(data.Journal[0].Date >= data.Journal[data.Journal.length - 1].Date, 'person journal newest first');
// people list carries last contact, never notes
let list = (await get(alice, 'people')).data.People;
ok(list.find(x => x.Id === mom).LastContact === today && list.find(x => x.Id === tom).LastContact === null, 'people list LastContact');
// all-journal timeline is per user
ok((await get(alice, 'journal')).data.Entries.length === 4, 'alice journal timeline');
ok((await get(bob, 'journal')).data.Entries.length === 0, 'bob sees none of alice journal');

// photos
async function addPhoto(t, entryId) {
  const fd = new FormData();
  fd.set('action', 'addJournalPhoto'); fd.set('entryId', String(entryId));
  fd.set('full', new Blob([JPEG]), 'f.jpg'); fd.set('thumb', new Blob([JPEG]), 't.jpg');
  const res = await fetch(API, { method: 'POST', headers: { Authorization: `Bearer ${t}` }, body: fd });
  return { status: res.status, data: await res.json().catch(() => null) };
}
r = await addPhoto(alice, e1);
ok(r.data && r.data.Key, 'add journal photo');
const ph1 = r.data;
ok((await addPhoto(bob, e1)).status === 404, 'bob cannot add photo to alice entry');
ok((await fetch(`${API}?action=photo&k=${ph1.Key}&size=thumb`)).status === 200, 'journal photo served');
ok((await person(alice, mom)).Journal.find(e => e.Id === e1).Photos.length === 1, 'entry lists photo');
ok((await post(bob, 'removeJournalPhoto', { id: ph1.Id })).status === 404, 'bob cannot remove alice photo');
await post(alice, 'removeJournalPhoto', { id: ph1.Id });
ok((await fetch(`${API}?action=photo&k=${ph1.Key}`)).status === 404, 'removed photo file deleted');
const ph2 = (await addPhoto(alice, e1)).data;
await post(alice, 'deleteJournalEntry', { id: e1 });
ok((await fetch(`${API}?action=photo&k=${ph2.Key}`)).status === 404, 'deleting entry deletes its photos');

// ---------- relationships ----------
ok((await post(alice, 'saveRelationship', { personId: mom, relatedId: mom, kind: 'child' })).status === 400, 'self link refused');
ok((await post(alice, 'saveRelationship', { personId: mom, relatedId: tom, kind: 'boss' })).status === 400, 'bad kind refused');
ok((await post(alice, 'saveRelationship', { personId: mom, relatedId: bobsGuy, kind: 'friend' })).status === 404, 'cannot link to another user\'s person');
const rel = (await post(alice, 'saveRelationship', { personId: mom, relatedId: tom, kind: 'child' })).data.Id;
let mRels = (await person(alice, mom)).Relationships;
let tRels = (await person(alice, tom)).Relationships;
ok(mRels.length === 1 && mRels[0].PersonId === tom && mRels[0].Kind === 'child', 'mom sees tom as child');
ok(tRels.length === 1 && tRels[0].PersonId === mom && tRels[0].Kind === 'parent', 'tom sees mom as parent (inverse)');
// saving the pair again from the other side replaces, not duplicates
await post(alice, 'saveRelationship', { personId: tom, relatedId: mom, kind: 'parent' });
mRels = (await person(alice, mom)).Relationships;
ok(mRels.length === 1 && mRels[0].Kind === 'child', 'one link per pair');
await post(alice, 'saveRelationship', { personId: ann, relatedId: mom, kind: 'other', label: 'cousin' });
const annRel = (await person(alice, mom)).Relationships.find(x => x.PersonId === ann);
ok(annRel.Kind === 'other' && annRel.Label === 'cousin', 'other with label');
ok((await post(bob, 'deleteRelationship', { id: mRels[0].Id })).status === 404, 'bob cannot delete alice link');
await post(alice, 'deleteRelationship', { id: mRels[0].Id });
ok((await person(alice, tom)).Relationships.length === 0, 'delete link removes both views');

// ---------- households ----------
ok((await post(alice, 'saveHousehold', { name: '' })).status === 400, 'household needs name');
const hh = (await post(alice, 'saveHousehold', { name: 'The Seniors', street: '1 Main', city: 'Murray', addPersonId: mom })).data.Id;
await post(alice, 'setHousehold', { personId: tom, householdId: hh });
data = await person(alice, mom);
ok(data.Person.HouseholdId === hh && data.Households.find(h => h.Id === hh).MemberIds.sort().join() === [mom, tom].sort().join(), 'household members');
ok((await post(bob, 'setHousehold', { personId: bobsGuy, householdId: hh })).status === 404, 'bob cannot join alice household');
ok((await post(bob, 'saveHousehold', { id: hh, name: 'Hacked' })).status === 404, 'bob cannot edit alice household');
ok((await get(bob, 'households')).data.Households.length === 0, 'bob sees no households');
await post(alice, 'setHousehold', { personId: tom, householdId: 0 });
ok((await person(alice, tom)).Person.HouseholdId === null, 'leave household');
await post(alice, 'deleteHousehold', { id: hh });
ok((await person(alice, mom)).Person.HouseholdId === null, 'delete household frees members');

// ---------- activities ----------
ok((await post(alice, 'saveActivity', { title: '', date: today })).status === 400, 'activity needs title');
ok((await post(alice, 'saveActivity', { title: 'X', date: today, startTime: '25:00' })).status === 400, 'bad time refused');
r = await post(alice, 'saveActivity', { title: 'Family dinner', date: daysAgo(1), startTime: '18:00', endTime: '20:00', location: 'Home',
  participantIds: [mom, tom, bobsGuy] });
const act = r.data.Id;
let acts = (await get(alice, 'activities')).data.Activities;
let a = acts.find(x => x.Id === act);
ok(a && a.ParticipantIds.sort().join() === [mom, tom].sort().join() && a.StartTime === '18:00', 'activity saved, foreign participant dropped');
ok((await person(alice, tom)).Activities.length === 1, 'activity on participant page');
ok((await get(bob, 'activities')).data.Activities.length === 0, 'bob sees no activities');
ok((await post(bob, 'completeActivity', { id: act, logToJournal: true })).status === 404, 'bob cannot complete');
r = await post(alice, 'completeActivity', { id: act, logToJournal: true });
ok(r.data.JournalEntries === 2, 'complete logs to 2 journals');
r = await post(alice, 'completeActivity', { id: act, logToJournal: true });
ok(r.data.JournalEntries === 0, 'second complete does not log again');
const tomJournal = (await person(alice, tom)).Journal;
ok(tomJournal.length === 1 && tomJournal[0].Kind === 'activity' && tomJournal[0].ActivityId === act && tomJournal[0].Date === daysAgo(1), 'activity journal entry');
ok((await person(alice, tom)).Person.LastContact === daysAgo(1), 'activity counts as contact');
await post(alice, 'deleteActivity', { id: act });
const after = (await person(alice, tom)).Journal;
ok(after.length === 1 && after[0].ActivityId === null, 'deleting activity keeps journal entries');

// ---------- deleting a person cleans up ----------
const e2 = (await post(alice, 'saveJournalEntry', { personId: ann, date: today, today })).data.Id;
const ph3 = (await addPhoto(alice, e2)).data;
await post(alice, 'deletePeople', { ids: [ann] });
ok((await fetch(`${API}?action=photo&k=${ph3.Key}`)).status === 404, 'deleting person deletes journal photos');
ok(!(await person(alice, mom)).Relationships.some(x => x.PersonId === ann), 'deleting person removes links');

console.log(`${pass} passed, ${failCount} failed`);
process.exit(failCount ? 1 : 0);
