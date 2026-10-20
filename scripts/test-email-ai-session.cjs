const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/frontend/js/modules/pages/10a-email-client-tasks.js'), 'utf8');
function browser({ statuses = [401, 200], expiresAt, refreshError, switchUser = false, sdkRefreshed = false } = {}) {
  let token = 'old';
  let refreshes = 0;
  const tokensSent = [];
  const auth = {
    getSession: async () => ({ data: { session: { access_token: token, expires_at: expiresAt, user: { id: 'u1' } } } }),
    refreshSession: async () => {
      refreshes++;
      if (switchUser) context.currentUser = { id: 'u2' };
      if (refreshError) return { data: {}, error: refreshError };
      token = 'new';
      return { data: { session: { access_token: token, user: { id: 'u1' } } } };
    }
  };
  const context = vm.createContext({ currentUser: { id: 'u1' }, AbortSignal,
    document: { addEventListener() {} }, requireSupabase: () => ({ auth }),
    $: () => null, fetch: async (url, options) => {
      assert.equal(url, '/api/email/classify');
      tokensSent.push(options.headers.authorization);
      const status = statuses[Math.min(tokensSent.length - 1, statuses.length - 1)];
      if (status === 401 && sdkRefreshed) token = 'sdk-new';
      return { status, ok: status === 200, json: async () => ({ code: status === 401 ? 'SESSION_REFRESH_REQUIRED' : undefined }) };
    }
  });
  vm.runInContext(source, context);
  return { context, tokensSent, refreshes: () => refreshes };
}
(async () => {
  let test = browser();
  let result = await test.context.postClientEmailAi('e1', 'c1', 'u1');
  assert.equal(result.response.status, 200);
  assert.equal(test.refreshes(), 1);
  assert.deepEqual(test.tokensSent, ['Bearer old', 'Bearer new']);
  test = browser({ statuses: [200] });
  await test.context.postClientEmailAi('e1', 'c1', 'u1');
  assert.equal(test.refreshes(), 0, 'valid sessions should not be refreshed unnecessarily');
  test = browser({ sdkRefreshed: true });
  await test.context.postClientEmailAi('e1', 'c1', 'u1');
  assert.equal(test.refreshes(), 0, 'use an SDK-renewed token instead of rotating the refresh token twice');
  assert.deepEqual(test.tokensSent, ['Bearer old', 'Bearer sdk-new']);
  test = browser({ statuses: [200], expiresAt: Date.now() / 1000 + 10 });
  await test.context.postClientEmailAi('e1', 'c1', 'u1');
  assert.deepEqual(test.tokensSent, ['Bearer new'], 'renew a nearly expired token before sending AI requests');
  for (const status of [403, 429, 503]) {
    test = browser({ statuses: [status] });
    result = await test.context.postClientEmailAi('e1', 'c1', 'u1');
    assert.equal(result.response.status, status);
    assert.equal(test.refreshes(), 0, 'authorization/provider failures must not trigger session renewal');
    assert.equal(test.tokensSent.length, 1);
  }
  test = browser({ statuses: [401, 401] });
  await assert.rejects(test.context.postClientEmailAi('e1', 'c1', 'u1'), /Analysis remains queued/);
  assert.equal(test.tokensSent.length, 2, 'renewal must never enter an endless retry loop');
  assert.equal(test.refreshes(), 1);
  test = browser({ refreshError: { status: 503 } });
  await assert.rejects(test.context.postClientEmailAi('e1', 'c1', 'u1'), /temporarily unavailable/);
  test = browser({ refreshError: { code: 'refresh_token_not_found' } });
  await assert.rejects(test.context.postClientEmailAi('e1', 'c1', 'u1'), /session has expired/);
  test = browser({ switchUser: true });
  await assert.rejects(test.context.postClientEmailAi('e1', 'c1', 'u1'), /account changed/);
  assert.equal(test.tokensSent.length, 1, 'a renewed credential must not cross signed-in accounts');
  test = browser();
  let release;
  let sharedRefreshes = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const sharedAuth = { refreshSession: async () => {
    sharedRefreshes++;
    await gate;
    return { data: { session: { access_token: 'shared', user: { id: 'u1' } } } };
  } };
  const first = test.context.renewEmailAiSession(sharedAuth, 'u1');
  const second = test.context.renewEmailAiSession(sharedAuth, 'u1');
  assert.equal(sharedRefreshes, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(sharedRefreshes, 1, 'concurrent AI checks must share one token renewal');
  console.log('AI session recovery passed: expired-token retry, proactive renewal, valid session reuse, bounded retries, service failures, real expiry and account isolation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
