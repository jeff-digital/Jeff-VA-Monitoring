import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { WORKSPACE_FIELDS } from '../functions/api/workspace.js';
const copy = value => structuredClone(value);
const calls = [], writes = [];
const initial = { legacyRecords: { preserve: true }, applications: [{ id: 'a', role: 'VA' }, { id: 'b', role: 'Designer' }], dailyTasks: [{ id: 't', title: 'Before' }], emails: [{ id: 'e', body: 'private-message-'.repeat(10000) }] };
const saved = new Map([['owner', copy(initial)], ['other', { applications: [{ id: 'private-other' }] }]]);
let loseReply = false;
const normalize = data => Object.fromEntries(WORKSPACE_FIELDS.map(key => [key, data[key] ?? (['weeklyActivityGoal', 'emailTaskAiUsage'].includes(key) ? null : [])]));
const ctx = vm.createContext({ currentUser: { id: 'owner' }, TextEncoder, URLSearchParams, AbortSignal, Map, Set,
  normalizeSavedWorkspace: normalize, rememberLocalWriteStamp: () => {},
  requireSupabase: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: ctx.currentUser.id, user: ctx.currentUser } } }) } }),
  fetch: async (url, options) => {
    calls.push({ url, method: options.method, body: options.body });
    const owner = options.headers.authorization.slice(7);
    const data = saved.get(owner) || {};
    if (options.method === 'GET') {
      const query = new URL(url, 'https://app').searchParams;
      return Response.json(query.has('collection') ? { record: (data[query.get('collection')] || []).find(item => item.id === query.get('id')) || null } : { data });
    }
    if (options.method === 'DELETE') { saved.delete(owner); return Response.json({ cleared: true }); }
    const changes = JSON.parse(options.body).changes;
    assert.ok(changes.length <= 100);
    writes.push(changes);
    for (const change of changes) {
      if (change.type === 'set') { data[change.key] = change.value; continue; }
      const rows = data[change.key] || [], index = rows.findIndex(item => item.id === change.id);
      if (change.type === 'order') { const wanted = new Set(change.value); data[change.key] = [...change.value.map(id => rows.find(item => item.id === id)).filter(Boolean), ...rows.filter(item => !wanted.has(item.id))]; continue; }
      if (change.type === 'remove') data[change.key] = rows.filter(item => item.id !== change.id);
      else if (index >= 0) rows[index] = change.value;
      else { const anchor = rows.findIndex(item => item.id === change.beforeId); rows.splice(anchor >= 0 ? anchor : rows.length, 0, change.value); }
      if (change.type !== 'remove') data[change.key] = rows;
    }
    saved.set(owner, data);
    if (loseReply) { loseReply = false; throw new Error('Reply lost'); }
    return Response.json({ saved: true, revision: 'server-revision' });
  }
});
vm.runInContext(fs.readFileSync(new URL('../src/frontend/js/modules/01b-workspace-store.js', import.meta.url), 'utf8'), ctx);
const store = vm.runInContext('workspaceStore', ctx);
const pages = ['dashboard','daily-task','applications','to-apply','news','social-trends','hired','inbox','documents','subscriptions','wallet','account'];
for (const page of pages) assert.ok(Array.isArray(store.activatePage(page)), `Storage path missing for ${page}`);
assert.throws(() => store.activatePage('not-a-page'));
let data = await store.load();
for (const page of pages) {
  const [key] = store.activatePage(page);
  if (!key) continue;
  data[key].push({ id: `page-${page}`, title: `Test ${page}` });
  await store.save(data, 'owner');
  assert.ok(writes.at(-1).every(change => change.key === key), `${page} saves only its changed records`);
  data[key] = data[key].filter(item => item.id !== `page-${page}`);
  await store.save(data, 'owner');
}
writes.length = 0;
data.dailyTasks[0].title = 'After';
await store.save(data, 'owner');
assert.equal(writes[0].length, 1);
assert.equal(writes[0][0].key, 'dailyTasks');
assert.ok(!JSON.stringify(writes[0]).includes('private-message'), 'Task saves do not upload emails or the complete workspace');
const count = calls.length;
await store.save(data, 'owner');
assert.equal(calls.length, count, 'Unchanged page saves do not make network calls');
data.applications.unshift({ id: 'new-first', role: 'Writer' });
data.applications.push({ id: 'new-last', role: 'Editor' });
await store.save(data, 'owner');
assert.deepEqual(saved.get('owner').applications.map(item => item.id), ['new-first','a','b','new-last'], 'Record insertions preserve page order');
data.applications.reverse();
await store.save(data, 'owner');
assert.equal(writes.at(-1)[0].type, 'order');
assert.ok(!JSON.stringify(writes.at(-1)).includes('Designer'), 'Reordering sends IDs rather than full record contents');
data.applications.reverse();
await store.save(data, 'owner');
data.applications = data.applications.filter(item => item.id !== 'a');
await store.save(data, 'owner');
assert.ok(writes.at(-1).some(item => item.type === 'remove' && item.id === 'a'));
assert.equal((await store.record('applications','b')).role, 'Designer');
data.accountSignInHistory.push({ at: '2026-11-05', provider: 'Google' });
await store.save(data, 'owner');
assert.equal(writes.at(-1)[0].type, 'set', 'ID-less history is preserved as one small value');
data.dailyTasks[0].title = 'Retry me'; loseReply = true;
await assert.rejects(store.save(data, 'owner'), /Reply lost/);
await store.save(data, 'owner');
assert.equal(saved.get('owner').dailyTasks.length, 1, 'Repeating an uncertain save does not duplicate the record');
const backup = store.backup(data, 'owner');
assert.equal(backup.format, 'jeff-va-workspace');
assert.equal(backup.data.emails[0].body, initial.emails[0].body, 'Full records backup retains email bodies');
assert.equal(backup.attachedFilesIncluded, false);
assert.equal(backup.data.legacyRecords.preserve, true, 'Migration backup includes older fields not used by current page renderers');
assert.ok(!JSON.stringify(backup).includes('access_token'));
ctx.currentUser = { id: 'other' };
await assert.rejects(store.save(data, 'owner'), /Reload/);
assert.throws(() => store.backup(data, 'owner'));
data = await store.load();
assert.equal(data.applications[0].id, 'private-other');
await store.clear();
assert.ok(saved.has('owner'), 'Clearing one account never touches another account');
assert.ok(!saved.has('other'));
console.log('PASS page storage: every page registered, changed-record saves, no-op suppression, ordering, deletion, retries, account isolation and full-record export.');
