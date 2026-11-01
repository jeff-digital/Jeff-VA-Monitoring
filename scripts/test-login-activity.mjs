import assert from 'node:assert/strict';
import worker from '../src/backend/worker.mjs';
import { FollowUpDelivery } from '../functions/api/follow-up-send.js';
import { MemoryStorage } from './lib/memory-durable.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import { coordinateLoginActivity } from '../functions/api/login-activity.js';
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
  assert.equal(JSON.parse(options.body).password, 'test-password');
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
  for (let i = 0; i < 4; i++) assert.equal((await login('203.0.113.2')).status, 400);
  assert.equal((await login('203.0.113.2')).status, 429, 'Fifth wrong password starts the block');
  const rateCalls = calls;
  assert.equal((await login('203.0.113.2')).status, 429);
  assert.equal(calls, rateCalls, 'Rate-limited attempts never hit Supabase');
  mode = 'success';
  assert.equal((await login('203.0.113.2')).status, 429, 'Correct credentials cannot bypass an active IP block');
  mode = 'failed';
  const beforeConcurrent = calls;
  const concurrent = await Promise.all(Array.from({ length: 12 }, () => login('203.0.113.4')));
  assert.equal(calls - beforeConcurrent, 5, 'Parallel requests reserve at most five password checks');
  assert.equal(concurrent.filter(r => r.status === 400).length, 4);
  assert.equal((await login('203.0.113.5', { email: 'random text with no account', password: '' })).status, 400);
  assert.equal((await login('203.0.113.5', { email: 'nonexistent@example.com' })).status, 400);
  assert.equal((await activity('owner', 'GET', '?scope=all')).status, 403);
  user.user_metadata = { login_activity_admin: true };
  assert.equal((await activity('owner', 'GET', '?scope=all')).status, 403, 'Editable user metadata cannot grant admin');
  user.app_metadata.login_activity_admin = true;
  const all = await (await activity('owner', 'GET', '?scope=all')).json();
  assert.equal(all.canViewAll, true);
  assert.ok(all.events.some(e => e.result === 'invalid_input'));
  assert.ok(all.events.every(e => e.accountRef));
  assert.ok(!JSON.stringify(all).includes('random text with no account'));
  delete user.app_metadata.login_activity_admin;
  for (let i = 0; i < 20; i++) assert.equal((await login('203.0.113.7', { email: 'nonsense' })).status, 400);
  assert.equal((await login('203.0.113.7', { email: 'nonsense' })).status, 429);
  const limitStorage = new AlarmStorage();
  for (let i = 0; i < 5; i++) {
    assert.equal((await coordinateLoginActivity(limitStorage, { action: 'password-reserve', id: String(i) })).status, 200);
    await coordinateLoginActivity(limitStorage, { action: 'password-complete', id: String(i), failed: true });
  }
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 5 * 60000 + 1;
    assert.equal((await coordinateLoginActivity(limitStorage, { action: 'password-reserve', id: 'after-expiry' })).status, 200);
  } finally { Date.now = originalNow; }
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
  let missingAdminOption = false;
  const ui = vm.createContext({ Map, Date, AbortSignal,
    currentUser: { id: 'owner' },
    $: id => {
      if (missingAdminOption && id === '#accountLoginActivityAll') return null;
      if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id);
    },
    document: { createElement: () => new Element() },
    formatAccountTimestamp: at => at,
    requireSupabase: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'owner' } } }) } }),
    fetch: async () => Response.json({ events: [{ at: user.last_sign_in_at, result: 'failed', provider: 'Email and password', ip: '203.0.113.1', device: '<script>unsafe</script>' }] })
  });
  vm.runInContext(fs.readFileSync(new URL('../src/frontend/js/modules/01a-login-activity.js', import.meta.url), 'utf8'), ui);
  await vm.runInContext('loadLoginActivity(true)', ui);
  assert.equal(elements.get('#accountLoginActivity').children[0].children[0].children[1].children[3].textContent, '<script>unsafe</script>', 'Device metadata must be rendered as plain text');
  missingAdminOption = true;
  ui.currentUser = { id: 'older-page' };
  await vm.runInContext('loadLoginActivity(true)', ui);
  assert.equal(elements.get('#accountLoginActivity').children.length, 1, 'A missing admin option must not stop account history from loading');
  ui.fetch = async () => Response.json({ events: [], canViewAll: true });
  await vm.runInContext('loadLoginActivity(true)', ui);
  const restoredOption = elements.get('#accountLoginActivityScope').children.at(-1);
  assert.equal(restoredOption.value, 'all', 'Authorized admins get a restored scope option on older pages');
  assert.equal(restoredOption.hidden, false);
  missingAdminOption = false;
  ui.currentUser = { id: 'other' };
  let rejectRequest;
  ui.fetch = () => new Promise((_, reject) => { rejectRequest = reject; });
  const switching = vm.runInContext('loadLoginActivity(true)', ui);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.get('#accountLoginActivity').children.length, 0, 'Changing accounts clears the previous account before fetching');
  rejectRequest(new Error('Unavailable'));
  await switching;
  assert.match(elements.get('#accountLoginActivityStatus').textContent, /unavailable/i);
  ui.currentUser = { id: 'owner' };
  let renewals = 0, requests = 0;
  ui.requireSupabase = () => ({ auth: {
    getSession: async () => ({ data: { session: { access_token: 'stale', user: { id: 'owner' } } } }),
    refreshSession: async () => { renewals++; return { data: { session: { access_token: 'renewed', user: { id: 'owner' } } } }; }
  } });
  ui.fetch = async (_url, options) => {
    requests++;
    return options.headers.authorization === 'Bearer stale'
      ? Response.json({ code: 'SESSION_REFRESH_REQUIRED' }, { status: 401 })
      : Response.json({ events: [], canViewAll: false });
  };
  await vm.runInContext('loadLoginActivity(true)', ui);
  assert.equal(renewals, 1, 'An expired server session is renewed once');
  assert.equal(requests, 2, 'Activity is retried with the renewed token');
  assert.match(elements.get('#accountLoginActivityStatus').textContent, /No tracked/);
  let oldTokenSent = false;
  ui.requireSupabase = () => ({ auth: {
    getSession: async () => ({ data: { session: { access_token: 'expired', expires_at: 1 } } }),
    refreshSession: async () => ({ data: { session: { access_token: 'renewed', user: { id: 'owner' } } } })
  } });
  ui.fetch = async (_url, options) => { oldTokenSent = options.headers.authorization === 'Bearer expired'; return Response.json({ events: [] }); };
  await vm.runInContext('loadLoginActivity(true)', ui);
  assert.equal(oldTokenSent, false, 'Known expired sessions are refreshed before making requests');
  ui.fetch = async () => Response.json({ error: 'Administrator access is required.' }, { status: 403 });
  await vm.runInContext('loadLoginActivity(true)', ui);
  assert.equal(elements.get('#accountLoginActivityStatus').textContent, 'Administrator access is required.');
  ui.fetch = async () => new Response('blocked', { status: 403 });
  await vm.runInContext('loadLoginActivity(true)', ui);
  assert.match(elements.get('#accountLoginActivityStatus').textContent, /Cloudflare blocked/);
  ui.fetch = async () => new Response('<html>not an API</html>', { headers: { 'content-type': 'text/html' } });
  await vm.runInContext('loadLoginActivity(true)', ui);
  assert.match(elements.get('#accountLoginActivityStatus').textContent, /not serving the login-activity API/);
  ui.fetch = async () => Response.json({ error: 'Login activity storage is not configured.' }, { status: 503 });
  await vm.runInContext('loadLoginActivity(true)', ui);
  assert.equal(elements.get('#accountLoginActivityStatus').textContent, 'Login activity storage is not configured.');
  console.log('PASS login activity: authenticated account isolation, real outcomes, deduplication, IP metadata, credential exclusion, rate limits, fail-closed behavior, and retention.');
} finally { globalThis.fetch = realFetch; }
