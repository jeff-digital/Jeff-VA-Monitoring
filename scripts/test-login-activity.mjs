import assert from 'node:assert/strict';
import worker from '../src/backend/worker.mjs';
import { FollowUpDelivery } from '../functions/api/follow-up-send.js';
import { MemoryStorage } from './lib/memory-durable.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
class AlarmStorage extends MemoryStorage {
  async setAlarm(at) { this.alarmAt = at; }
  transaction(callback) { return super.transaction(tx => callback({ get: tx.get.bind(tx), put: tx.put.bind(tx), delete: tx.delete.bind(tx) })); }
}
const stores = new Map();
const binding = { idFromName: name => name, get(name) {
  if (!stores.has(name)) stores.set(name, new AlarmStorage());
  return new FollowUpDelivery({ storage: stores.get(name) });
} };
const env = { SUPABASE_URL: 'https://auth.example', SUPABASE_PUBLISHABLE_KEY: 'public', FOLLOW_UP_DELIVERIES: binding };
const realFetch = globalThis.fetch;
let calls = 0, mode = 'failed';
const user = { id: 'owner', email: 'owner@example.com', email_confirmed_at: '2026-01-01T00:00:00Z', last_sign_in_at: new Date().toISOString(), app_metadata: { provider: 'email' } };
globalThis.fetch = async (url, options) => {
  calls++;
  if (String(url).includes('/auth/v1/user')) {
    const token = options.headers.authorization;
    if (token === 'Bearer other') return Response.json({ ...user, id: 'other', email: 'other@example.com' });
    if (token !== 'Bearer owner') return Response.json({}, { status: 401 });
    return Response.json(user);
  }
  assert.equal(String(url), 'https://auth.example/auth/v1/token?grant_type=password');
  assert.equal(options.headers.apikey, 'public');
  assert.deepEqual(JSON.parse(options.body), { email: user.email, password: 'test-password' });
  if (mode === 'network') throw new Error('Offline');
  if (mode === 'service') return Response.json({ message: 'service failure' }, { status: 503 });
  if (mode === 'success') return Response.json({ access_token: 'test-access', refresh_token: 'test-refresh', user });
  return Response.json({ error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, { status: 400 });
};
const login = (ip = '203.0.113.1', override = {}, targetEnv = env) => worker.fetch(new Request('https://app.example/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://app.example', 'CF-Connecting-IP': ip, 'user-agent': '<script>device</script>' },
  body: JSON.stringify({ email: ' OWNER@example.com ', password: 'test-password', ...override })
}), targetEnv, {});
const activity = (token, method = 'GET', query = '') => worker.fetch(new Request('https://app.example/api/auth/activity' + query, {
  method, headers: token ? { authorization: `Bearer ${token}`, 'CF-Connecting-IP': '203.0.113.1' } : {}
}), env, {});
try {
  assert.equal((await activity()).status, 401);
  assert.equal((await activity('invalid')).status, 401);
  assert.equal((await login()).status, 400);
  let result = await (await activity('owner')).json();
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].result, 'failed');
  assert.equal(result.events[0].ip, '203.0.113.1');
  assert.equal(result.events[0].device, '<script>device</script>');
  assert.equal((await (await activity('other', 'GET', '?email=owner@example.com')).json()).events.length, 0, 'Caller cannot choose another account');
  mode = 'success';
  assert.equal((await login()).status, 200);
  assert.equal((await activity('owner', 'POST')).status, 200);
  result = await (await activity('owner')).json();
  assert.equal(result.events.filter(e => e.result === 'successful').length, 1, 'Verified callback deduplicates gateway success');
  const privateState = JSON.stringify([...stores.values()].flatMap(s => [...s.values.entries()]));
  for (const secret of ['test-password', 'test-access', 'test-refresh', 'owner@example.com']) assert.ok(!privateState.includes(secret), 'Storage must not retain credentials or raw account email');
  mode = 'network';
  assert.equal((await login()).status, 503);
  result = await (await activity('owner')).json();
  assert.ok(result.events.some(e => e.result === 'interrupted'), 'Lost upstream responses remain visible as interrupted attempts');
  mode = 'service';
  assert.equal((await login()).status, 503);
  assert.equal((await login('203.0.113.1', { provider: 'google' })).status, 400, 'Untrusted event fields are rejected');
  const previous = calls;
  assert.equal((await login('203.0.113.1', {}, { ...env, FOLLOW_UP_DELIVERIES: null })).status, 503);
  assert.equal(calls, previous, 'Missing activity storage never bypasses the gateway');
  mode = 'failed';
  for (let i = 0; i < 20; i++) assert.equal((await login('203.0.113.2')).status, 400);
  const rateCalls = calls;
  assert.equal((await login('203.0.113.2')).status, 429);
  assert.equal(calls, rateCalls, 'Rate-limited attempts never hit Supabase');
  assert.ok((await (await activity('owner')).json()).events.some(e => e.result === 'rate_limited'));
  const foreign = new Request('https://app.example/api/auth/login', { method: 'POST', headers: { origin: 'https://foreign.example' }, body: '{}' });
  assert.equal((await worker.fetch(foreign, env, {})).status, 403);
  const storage = new AlarmStorage();
  const instance = new FollowUpDelivery({ storage });
  await storage.put('login-events', [{ id: 'old', at: new Date(Date.now() - 31 * 86400000).toISOString() }]);
  await storage.put('delivery', { status: 'sent' });
  await storage.put('login-rate', [1]);
  await instance.alarm();
  assert.equal(await storage.get('login-events'), undefined);
  assert.equal(await storage.get('login-rate'), undefined);
  assert.equal((await storage.get('delivery')).status, 'sent', 'Expiry must not affect follow-up receipts');
  class Element {
    children = []; textContent = ''; disabled = false;
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    addEventListener() {}
  }
  const elements = new Map();
  const ui = vm.createContext({ Map, Date, AbortSignal,
    currentUser: { id: 'owner' },
    $: id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
    document: { createElement: () => new Element() },
    formatAccountTimestamp: at => at,
    requireSupabase: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'owner' } } }) } }),
    fetch: async () => Response.json({ events: [{ at: user.last_sign_in_at, result: 'failed', provider: 'Email and password', ip: '203.0.113.1', device: '<script>unsafe</script>' }] })
  });
  vm.runInContext(fs.readFileSync(new URL('../src/frontend/js/modules/01a-login-activity.js', import.meta.url), 'utf8'), ui);
  await vm.runInContext('loadLoginActivity(true)', ui);
  assert.equal(elements.get('#accountLoginActivity').children[0].children[4].textContent, '<script>unsafe</script>', 'Device metadata must be rendered as plain text');
  ui.currentUser = { id: 'other' };
  let rejectRequest;
  ui.fetch = () => new Promise((_, reject) => { rejectRequest = reject; });
  const switching = vm.runInContext('loadLoginActivity(true)', ui);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.get('#accountLoginActivity').children.length, 0, 'Changing accounts clears the previous account before fetching');
  rejectRequest(new Error('Unavailable'));
  await switching;
  assert.match(elements.get('#accountLoginActivityStatus').textContent, /unavailable/);
  console.log('PASS login activity: authenticated account isolation, real outcomes, deduplication, IP metadata, credential exclusion, rate limits, fail-closed behavior, and retention.');
} finally { globalThis.fetch = realFetch; }
