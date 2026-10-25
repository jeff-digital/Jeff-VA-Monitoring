import assert from 'node:assert/strict';
import { coordinateResearchUsage, researchUsage } from '../functions/api/research-usage.js';
import { FollowUpDelivery } from '../functions/api/follow-up-send.js';
import { MemoryStorage, memoryNamespace } from './lib/memory-durable.mjs';
import worker from '../src/backend/worker.mjs';

const storage = new MemoryStorage();
const input = { action: 'reserve', day: '2026-10-25', limit: 20 };
const attempts = await Promise.all(Array.from({ length: 30 }, async () => (await coordinateResearchUsage(storage, input)).json()));
assert.equal(attempts.filter(item => item.allowed).length, 20, 'Concurrent origins cannot exceed the daily cap');
const status = await (await coordinateResearchUsage(storage, { ...input, action: 'status' })).json();
assert.equal(status.used, 20); assert.equal(status.remaining, 0);
assert.equal(status.resetsAt, '2026-10-26T00:00:00.000Z', 'Reset is 8 AM Philippine time');
const tomorrow = await (await coordinateResearchUsage(storage, { ...input, action: 'status', day: '2026-10-26' })).json();
assert.equal(tomorrow.used, 0, 'Usage resets at the UTC day boundary');
assert.equal((await (await coordinateResearchUsage(storage, { ...input, day: '2026-10-26' })).json()).used, 1);

let calls = 0;
const env = { SUPABASE_URL: 'https://auth.example', SUPABASE_PUBLISHABLE_KEY: 'public', FOLLOW_UP_DELIVERIES: memoryNamespace(FollowUpDelivery),
  AI: { run: async () => { calls++; return { response: 'Answer' }; } } };
globalThis.fetch = async () => Response.json({ id: 'u1' });
const request = (path, method = 'GET', body, signed = true) => worker.fetch(new Request('https://app.example' + path, {
  method, headers: signed ? { authorization: 'Bearer session' } : {}, ...(body ? { body: JSON.stringify(body) } : {})
}), env, {});
assert.equal((await request('/api/research/usage', 'GET', null, false)).status, 401);
assert.equal((await request('/api/research/usage', 'POST', {})).status, 405);
assert.equal((await (await request('/api/research/usage')).json()).used, 0);
assert.equal(calls, 0, 'Reading the meter never calls AI');
for (let index = 0; index < 20; index++) assert.equal((await researchUsage(env, 'u1', 'reserve')).allowed, true);
const body = { mode: 'reasoning', effort: 'low', messages: [{ role: 'user', content: 'Hello' }] };
const blocked = await request('/api/research', 'POST', body);
assert.equal(blocked.status, 429);
assert.equal((await blocked.json()).usage.remaining, 0);
assert.equal(calls, 0, 'The model is never called after the cap');
assert.equal((await researchUsage(env, 'another-user')).used, 0, 'Accounts have separate request guards');
await assert.rejects(researchUsage({}, 'u1'));
const unavailable = { ...env, FOLLOW_UP_DELIVERIES: undefined };
const response = await worker.fetch(new Request('https://app.example/api/research', { method: 'POST', headers: { authorization: 'Bearer session' }, body: JSON.stringify(body) }), unavailable, {});
assert.equal(response.status, 503);
assert.equal(calls, 0, 'An unavailable usage check fails closed before AI');
console.log('Research usage passed: atomic daily cap, UTC reset, shared origins, account isolation, read-only meter, authenticated routing and fail-closed protection.');
