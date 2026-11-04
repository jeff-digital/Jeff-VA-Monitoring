import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../src/frontend/js/modules/01-core.js', import.meta.url), 'utf8');
const load = source.slice(source.indexOf('  async function loadDataFromSupabase('), source.indexOf('  function rememberLocalWriteStamp('));
const subscribe = source.slice(source.indexOf('  function subscribeToAppState('), source.indexOf('  async function restoreSupabaseSession('));
const timers = new Map(), channels = [];
let timerId = 0, reads = 0, renders = 0, pendingRead = null;
const stored = { applications: [{ id: 'fresh' }], emails: [{ id: 'email' }], dailyTasks: [{ id: 'task' }] };
const client = {
  removeChannel() {},
  channel() {
    const channel = { on(_event, config, callback) { this.config = config; this.callback = callback; return this; }, subscribe() { return this; } };
    channels.push(channel); return channel;
  },
  from(table) {
    assert.equal(table, 'app_state');
    return { select: column => { assert.equal(column, 'data'); return { eq: (key, value) => {
      assert.equal(key, 'user_id'); assert.equal(value, 'owner');
      return { maybeSingle: () => { reads++; return pendingRead || Promise.resolve({ data: { data: stored } }); } };
    } }; } };
  }
};
const ctx = vm.createContext({ currentUser: { id: 'owner' }, supabaseClient: client, appStateChannel: null, dataReady: true, persistWritePending: false,
  data: {}, lastLocalWriteStamps: new Set(['local-write']), console,
  requireSupabase: () => client, renderAll: () => renders++, dedupeEmails: items => items,
  normalizeWeeklyActivityGoal: () => 5, weeklyActivityGoalStorageKey: () => 'goal', localStorage: { getItem: () => null }, emptyData: () => ({}),
  setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id)
});
vm.runInContext(load + subscribe, ctx);
vm.runInContext("subscribeToAppState('owner')", ctx);
const channel = channels[0];
assert.deepEqual([...channel.config.select], ['user_id', 'updated_at'], 'Realtime subscriptions request small acknowledgements rather than the workspace');
assert.equal(channel.config.filter, 'user_id=eq.owner');
channel.callback({ new: { user_id: 'owner', updated_at: 'local-write' } });
assert.equal(timers.size, 0, 'Own write acknowledgements do not download the workspace');
channel.callback({ new: { user_id: 'other', updated_at: 'foreign-write' } });
assert.equal(timers.size, 0, 'Unrelated account events never trigger a download');
channel.callback({ new: { user_id: 'owner', updated_at: 'remote-write', data: stored } });
assert.equal(reads, 0, 'A full-row event from an older server is reused without a second download');
assert.equal(ctx.data.dailyTasks[0].id, 'task');
for (let i = 0; i < 5; i++) channel.callback({ new: { user_id: 'owner', updated_at: `remote-${i}` } });
assert.equal(timers.size, 1, 'Bursts of cross-device updates are coalesced');
const flush = async () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve)); };
await flush();
assert.equal(reads, 1);
assert.equal(ctx.data.applications[0].id, 'fresh');
const before = renders;
let finish;
pendingRead = new Promise(resolve => { finish = resolve; });
channel.callback({ new: { user_id: 'owner', updated_at: 'delayed' } });
await flush();
ctx.currentUser = { id: 'other' }; ctx.data = { applications: [{ id: 'other-account' }] };
finish({ data: { data: stored } });
await new Promise(resolve => setImmediate(resolve));
assert.equal(ctx.data.applications[0].id, 'other-account', 'A pending old-account load cannot replace a new account');
assert.equal(renders, before);
ctx.currentUser = { id: 'owner' };
vm.runInContext("subscribeToAppState('owner')", ctx);
const beforeOld = renders;
channel.callback({ new: { user_id: 'owner', data: stored } });
assert.equal(renders, beforeOld, 'Retired channels cannot update current workspace data');
console.log('PASS workspace egress: metadata-only events, local echo suppression, full-row reuse, burst coalescing, account switching and retired-channel protection.');
