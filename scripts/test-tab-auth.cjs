const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/frontend/js/modules/01-core.js'), 'utf8');
const helper = source.slice(source.indexOf('  function createTabAuthStorage('), source.indexOf('  function requireSupabase('));
const permanent = new Map([
  ['sb-project-auth-token', 'old-permanent-login'],
  ['jeff-va-gmail-credentials-v2:user', 'gmail-grant'], ['saved-preference', 'unchanged']
]);
const store = map => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) });
function tab(session = new Map()) {
  const context = vm.createContext({ URL, crypto: require('node:crypto').webcrypto,
    window: { SUPABASE_URL: 'https://project.supabase.co', localStorage: store(permanent), sessionStorage: store(session) } });
  vm.runInContext(helper, context);
  return { context, session, auth: context.createTabAuthStorage() };
}
const first = tab();
assert.equal(first.auth.storage.getItem('sb-project-auth-token'), null, 'permanent dashboard login must not be restored');
assert.equal(permanent.has('sb-project-auth-token'), false, 'legacy permanent login is retired');
assert.equal(permanent.get('jeff-va-gmail-credentials-v2:user'), 'gmail-grant', 'Gmail permission is preserved');
assert.equal(permanent.get('saved-preference'), 'unchanged');
first.auth.storage.setItem(first.auth.storageKey, 'signed-in-session');
assert.equal(permanent.has(first.auth.storageKey), false, 'dashboard login must never be written to permanent storage');
const refreshed = tab(first.session);
assert.equal(refreshed.auth.storageKey, first.auth.storageKey, 'page refresh reuses the current tab session');
assert.equal(refreshed.auth.storage.getItem(refreshed.auth.storageKey), 'signed-in-session');
const reopened = tab();
assert.notEqual(reopened.auth.storageKey, first.auth.storageKey, 'new sessions use isolated SDK broadcast keys');
assert.equal(reopened.auth.storage.getItem(reopened.auth.storageKey), null, 'new sessions require explicit login');
refreshed.auth.storage.removeItem(refreshed.auth.storageKey);
assert.equal(tab(first.session).auth.storage.getItem(first.auth.storageKey), null, 'logout clears the tab login');
const blocked = tab();
blocked.context.window.sessionStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
const fallback = blocked.context.createTabAuthStorage();
fallback.storage.setItem('session', 'memory-only');
assert.equal(fallback.storage.getItem('session'), 'memory-only');
fallback.storage.removeItem('session');
assert.equal(fallback.storage.getItem('session'), null);
console.log('Tab login checks passed: no permanent auto-login, same-tab refresh, isolated sessions, logout, and blocked-storage fallback.');
