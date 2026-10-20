import assert from 'node:assert/strict';
import worker from '../src/backend/worker.mjs';
const env = { SUPABASE_URL: 'https://auth.example', SUPABASE_PUBLISHABLE_KEY: 'public' };
let authStatus = 401;
let networkFailure = false;
globalThis.fetch = async () => {
  if (networkFailure) throw new Error('verification service unavailable');
  return Response.json(authStatus === 200 ? { id: 'u1' } : {}, { status: authStatus });
};
const request = () => worker.fetch(new Request('https://app.example/api/email/classify', {
  method: 'POST', headers: { authorization: 'Bearer session', 'content-type': 'application/json' }, body: '{}'
}), env, {});
for (const status of [401, 403]) {
  authStatus = status;
  const response = await request();
  assert.equal(response.status, 401);
  const result = await response.json();
  assert.equal(result.code, 'SESSION_REFRESH_REQUIRED');
  assert.ok(!result.error.includes('Sign in again'));
}
for (const status of [429, 500, 503]) {
  authStatus = status;
  const response = await request();
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.equal(result.code, 'AUTH_VERIFICATION_UNAVAILABLE');
  assert.ok(!result.error.includes('Sign in again'));
}
networkFailure = true;
assert.equal((await (await request()).json()).code, 'AUTH_VERIFICATION_UNAVAILABLE');
networkFailure = false;
authStatus = 200;
assert.equal((await request()).status, 400, 'authenticated requests must still reach the real endpoint validation');
console.log('Worker session checks passed: expired sessions distinguished from temporary verification failures, short retry and endpoint validation preserved.');
