import assert from 'node:assert/strict';
import worker from '../src/backend/worker.mjs';
const originalFetch = globalThis.fetch;
const env = { SUPABASE_URL: 'https://auth.test', SUPABASE_PUBLISHABLE_KEY: 'public' };
const calls = [];
let conflict = false;
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url, options });
  if (String(url).endsWith('/auth/v1/user')) return Response.json(options.headers.authorization === 'Bearer owner' ? { id: 'owner' } : {}, { status: options.headers.authorization === 'Bearer owner' ? 200 : 401 });
  if (String(url).endsWith('/rpc/lookup_client_onboarding_invite')) {
    assert.equal(options.headers.authorization, undefined, 'Public onboarding never receives an account bearer or service-role token');
    return Response.json({ client_name: 'Acme' });
  }
  assert.equal(options.headers.authorization, 'Bearer owner');
  if (String(url).endsWith('/rpc/apply_workspace_changes')) return conflict ? Response.json({ code: '40001' }, { status: 409 }) : Response.json({ saved: true, revision: 'server-time' });
  if (String(url).endsWith('/rpc/get_workspace_record')) {
    assert.deepEqual(JSON.parse(options.body), { p_collection: 'applications', p_id: 'app' });
    return Response.json({ id: 'app' });
  }
  if (String(url).endsWith('/rpc/issue_client_onboarding_invite')) return Response.json(true);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('user_id'), 'eq.owner', 'The server derives identity from the verified session');
  if (options.method === 'DELETE') return new Response(null, { status: 204 });
  const select = parsed.searchParams.get('select');
  return Response.json(select.startsWith('applications:') ? [{ applications: [{ id: 'app' }], updated_at: 'time' }] : [{ data: { applications: [] }, updated_at: 'time' }]);
};
const request = (method, body, query = '', token = 'owner', origin = 'https://app.test') => worker.fetch(new Request('https://app.test/api/workspace' + query, {
  method, headers: { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {})
}), env, {});
try {
  assert.equal((await request('GET', null, '', 'invalid')).status, 401);
  assert.equal((await request('POST', {})).status, 405);
  const loaded = await (await request('GET', null, '?user_id=other')).json();
  assert.ok(loaded.data);
  assert.equal((await (await request('GET', null, '?collection=applications&id=app')).json()).record.id, 'app');
  assert.equal((await request('GET', null, '?collection=invalid')).status, 400);
  const changes = [{ key: 'dailyTasks', type: 'put', id: 'task', base: null, value: { id: 'task', title: 'Work' } }];
  assert.equal((await request('PATCH', { changes })).status, 200);
  const rpc = calls.find(item => String(item.url).endsWith('/rpc/apply_workspace_changes'));
  assert.deepEqual(JSON.parse(rpc.options.body), { p_changes: changes });
  assert.equal((await request('PATCH', { changes, user_id: 'other' })).status, 400);
  assert.equal((await request('PATCH', { changes: [{ ...changes[0], key: '__proto__' }] })).status, 400);
  assert.equal((await request('PATCH', { changes }, '', 'owner', 'https://outside.test')).status, 403);
  conflict = true;
  assert.equal((await request('PATCH', { changes })).status, 409);
  assert.equal((await request('DELETE')).status, 200);
  const onboarding = (path, body, signed = false) => worker.fetch(new Request('https://app.test' + path, { method: 'POST', headers: { origin: 'https://app.test', ...(signed ? { authorization: 'Bearer owner' } : {}) }, body: JSON.stringify(body) }), env, {});
  const tokenHash = 'a'.repeat(64);
  assert.equal((await (await onboarding('/api/onboarding', { action: 'lookup_client_onboarding_invite', parameters: { p_token_hash: tokenHash } })).json()).data.client_name, 'Acme');
  assert.equal((await onboarding('/api/onboarding', { action: 'lookup_client_onboarding_invite', parameters: { p_token_hash: tokenHash, p_user_id: 'other' } })).status, 400);
  assert.equal((await onboarding('/api/onboarding', { action: 'issue_client_onboarding_invite', parameters: {} })).status, 400);
  assert.equal((await onboarding('/api/workspace/onboarding', { action: 'issue_client_onboarding_invite', parameters: { p_client_id: 'client', p_token_hash: tokenHash } }, true)).status, 200);
  assert.equal((await onboarding('/api/workspace/onboarding', { action: 'issue_client_onboarding_invite', parameters: { p_client_id: 'client', p_token_hash: tokenHash } })).status, 401);
  console.log('PASS workspace API: authentication, fixed account scoping, collection reads, patch validation, origin checks, conflicts and deletion.');
} finally { globalThis.fetch = originalFetch; }
