import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker from '../src/backend/worker.mjs';

const env = { SUPABASE_URL: 'https://auth.example', SUPABASE_PUBLISHABLE_KEY: 'public',
  GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'server-secret' };
let calls = 0;
let revoked = false;
globalThis.fetch = async (url, options) => {
  if (url.startsWith(env.SUPABASE_URL)) return Response.json({ id: 'user-a' });
  assert.equal(url, 'https://oauth2.googleapis.com/token');
  assert.equal(options.body.get('client_secret'), env.GOOGLE_CLIENT_SECRET);
  assert.equal(options.body.get('refresh_token'), 'refresh');
  calls++;
  return revoked ? Response.json({ error: 'invalid_grant' }, { status: 400 })
    : Response.json({ access_token: 'renewed-access', expires_in: 3600, refresh_token: 'never-return' });
};
const request = (signedIn = true, body = { refreshToken: 'refresh' }, config = env) => worker.fetch(
  new Request('https://app.example/api/gmail/refresh', { method: 'POST',
    headers: { 'content-type': 'application/json', ...(signedIn ? { authorization: 'Bearer session' } : {}) },
    body: JSON.stringify(body) }), config, {});
assert.equal((await request(false)).status, 401);
assert.equal(calls, 0);
assert.equal((await request(true, {})).status, 400);
assert.equal((await request(true, undefined, { ...env, GOOGLE_CLIENT_SECRET: '' })).status, 503);
const response = await request();
assert.equal(response.headers.get('cache-control'), 'private, no-store');
assert.deepEqual(await response.json(), { access_token: 'renewed-access', expires_in: 3600 });
revoked = true;
const failure = await request();
assert.equal(failure.status, 403);
assert.equal((await failure.json()).reconnect, true);

const source = fs.readFileSync(new URL('../src/frontend/js/modules/04-gmail.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('  const GMAIL_CREDENTIALS_KEY'), source.indexOf('  async function renewGmailAccess'));
const persistent = new Map();
const storage = map => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) });
function browser() {
  const context = vm.createContext({ localStorage: storage(persistent), sessionStorage: storage(new Map()),
    currentUser: { id: 'user-a' }, gmailAccessToken: null, gmailReconnectRequired: false,
    GMAIL_TOKEN_SESSION_KEY: 'token', GMAIL_CONNECTED_KEY: 'connected', GMAIL_RECONNECT_REQUIRED_KEY: 'reconnect' });
  vm.runInContext(helpers, context);
  return context;
}
const first = browser();
first.saveGmailCredentials('user-a', 'fresh', 'offline-refresh');
const reopened = browser();
assert.equal(reopened.readGmailCredentials().refreshToken, 'offline-refresh', 'connection survives a new tab session');
assert.equal(reopened.readGmailCredentials('user-b'), null, 'credentials are isolated by dashboard user');
reopened.captureGoogleSession({ user: { id: 'user-a' }, provider_token: 'old-provider-token' });
assert.equal(reopened.gmailAccessToken, 'fresh', 'old Supabase provider tokens must not overwrite renewed Gmail tokens');
reopened.saveGmailCredentials('user-a', 'new-access', '', 3600);
assert.equal(reopened.readGmailCredentials().refreshToken, 'offline-refresh', 'renewal preserves offline permission');
persistent.delete('jeff-va-gmail-credentials-v2:user-a');
assert.equal(browser().readGmailCredentials(), null);
console.log('Gmail renewal authentication, expiry storage, account isolation, revoked permission, and secret handling passed.');
