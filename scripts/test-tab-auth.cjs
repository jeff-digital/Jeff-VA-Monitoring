const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/frontend/js/modules/01-core.js'), 'utf8');
const helper = source.slice(source.indexOf('  function createRememberedAuthStorage('), source.indexOf('  function requireSupabase('));
const permanent = new Map([
  ['sb-project-auth-token', 'old-permanent-login'],
  ['jeff-va-gmail-credentials-v2:user', 'gmail-grant'], ['saved-preference', 'unchanged']
]);
const store = map => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) });
function tab(session = new Map(), project = 'project') {
  const context = vm.createContext({ URL,
    window: { SUPABASE_URL: `https://${project}.supabase.co`, localStorage: store(permanent), sessionStorage: store(session) } });
  vm.runInContext(helper, context);
  return { context, session, auth: context.createRememberedAuthStorage() };
}
const first = tab();
assert.equal(permanent.has('sb-project-auth-token'), false, 'obsolete SDK session is retired');
assert.equal(permanent.get('jeff-va-gmail-credentials-v2:user'), 'gmail-grant');
assert.equal(permanent.get('saved-preference'), 'unchanged');
first.auth.storage.setItem(first.auth.storageKey, 'signed-in-session');
assert.equal(permanent.get(first.auth.storageKey), 'signed-in-session');
const reopened = tab();
assert.equal(reopened.auth.storageKey, first.auth.storageKey);
assert.equal(reopened.auth.storage.getItem(reopened.auth.storageKey), 'signed-in-session', 'reopened browser restores login');
const other = tab(new Map(), 'other-project');
assert.equal(other.auth.storage.getItem(other.auth.storageKey), null, 'projects remain isolated');
reopened.auth.storage.removeItem(reopened.auth.storageKey);
assert.equal(first.auth.storage.getItem(first.auth.storageKey), null, 'another tab cannot read a stale memory copy after logout');
assert.equal(tab().auth.storage.getItem(first.auth.storageKey), null, 'logout persists on reopen');
const legacy = new Map([['jeff-va-auth-tab-id-v1', 'old-tab'], ['jeff-va-auth-old-tab', 'current-tab-session']]);
const migrated = tab(legacy);
assert.equal(migrated.auth.storage.getItem(migrated.auth.storageKey), 'current-tab-session');
assert.equal(legacy.has('jeff-va-auth-old-tab'), false);
assert.equal(legacy.has('jeff-va-auth-tab-id-v1'), false);
migrated.auth.storage.removeItem(migrated.auth.storageKey);
assert.equal(tab(legacy).auth.storage.getItem(migrated.auth.storageKey), null, 'legacy session cannot resurrect after logout');
first.auth.storage.setItem(first.auth.storageKey, 'newer-session');
assert.equal(tab(new Map([['jeff-va-auth-tab-id-v1', 'older'], ['jeff-va-auth-older', 'stale-session']])).auth.storage.getItem(first.auth.storageKey), 'newer-session', 'migration does not overwrite an existing session');
const blocked = tab();
blocked.context.window.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
blocked.context.window.sessionStorage = blocked.context.window.localStorage;
const fallback = blocked.context.createRememberedAuthStorage();
fallback.storage.setItem('session', 'memory-only');
assert.equal(fallback.storage.getItem('session'), 'memory-only');
fallback.storage.removeItem('session');
assert.equal(fallback.storage.getItem('session'), null);
console.log('Remembered login checks passed: reopen, project isolation, logout, migration, and blocked-storage fallback.');

// A remembered login must land on the dashboard even when reopened at
// /applications. Recovery remains on its dedicated password flow.
const restoreSource = source.slice(source.indexOf('  async function restoreSupabaseSession('), source.indexOf('  async function clearSupabaseData('));
async function checkLanding({ recovery = false, callback = false, fallback = false } = {}) {
  let authListener;
  const initializations = [];
  let recoveryOpened = false;
  const session = { user: { id: 'remembered-user' } };
  const sdk = {
    getSession: async () => ({ data: { session: fallback ? null : session } }),
    exchangeCodeForSession: async () => ({ data: { session } }),
    onAuthStateChange: listener => { authListener = listener; }
  };
  const context = vm.createContext({
    URLSearchParams, console,
    AUTH_TAB_READY_KEY: 'tab-ready', AUTH_PROVIDER_SESSION_KEY: 'provider',
    sessionStorage: store(new Map()),
    document: { title: 'Jeff VA' },
    window: {
      location: { pathname: '/applications', search: recovery ? '?type=recovery' : callback ? '?code=oauth-code' : '', hash: '' },
      history: { replaceState() {} }, setTimeout: handler => handler()
    },
    supabaseConfigured: () => true, requireSupabase: () => ({ auth: sdk }),
    appViewPath: view => `/${view}`, captureGoogleSession() {},
    resolveAuthProvider: () => 'google', showView() {},
    currentUser: null, initializingUserId: null,
    initializeSupabaseForUser: async (user, options) => initializations.push({ user, options }),
    openPasswordPage: () => { recoveryOpened = true; }
  });
  vm.runInContext(restoreSource, context);
  await context.restoreSupabaseSession();
  if (fallback) authListener('SIGNED_IN', session);
  assert.equal(initializations.length, 1);
  assert.equal(initializations[0].options.showOverview, !recovery, 'ordinary login must explicitly select dashboard instead of retaining the Applications URL');
  assert.equal(recoveryOpened, recovery);
}
(async () => {
  await checkLanding();
  await checkLanding({ callback: true });
  await checkLanding({ fallback: true });
  await checkLanding({ recovery: true });
  console.log('Dashboard landing checks passed: saved session, Google callback, auth event fallback, and password recovery.');
})().catch(error => { console.error(error); process.exitCode = 1; });
