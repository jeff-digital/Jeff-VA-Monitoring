import assert from 'node:assert/strict';
import { FollowUpDelivery } from '../functions/api/follow-up-send.js';
import worker from '../src/backend/worker.mjs';
class Storage {
  values = new Map(); chain = Promise.resolve();
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { this.values.delete(key); }
  transaction(fn) { const run = this.chain.then(() => fn(this)); this.chain = run.catch(() => {}); return run; }
}
const spaces = new Map();
const env = { SUPABASE_URL: 'https://auth.test', SUPABASE_PUBLISHABLE_KEY: 'public', FOLLOW_UP_DELIVERIES: {
  idFromName: key => key,
  get: key => { if (!spaces.has(key)) spaces.set(key, new Storage()); return new FollowUpDelivery({ storage: spaces.get(key) }); }
} };
globalThis.fetch = async request => { assert.equal(new URL(request).hostname, 'auth.test'); return Response.json({ id: 'account-1' }); };
const call = (body, origin = 'https://live.test', signed = true) => worker.fetch(new Request(origin + '/api/backup/download', {
  method: 'POST', headers: signed ? { authorization: 'Bearer test' } : {}, body: JSON.stringify(body)
}), env, {});
assert.equal((await call({ action: 'claim', frequency: 'daily' }, undefined, false)).status, 401);
assert.equal((await call({ action: 'claim', frequency: 'bad' })).status, 400);
assert.equal((await call({ action: 'claim', frequency: 'daily', userId: 'other' })).status, 400);
const responses = await Promise.all([call({ action: 'claim', frequency: 'daily' }, 'http://localhost:8080'), call({ action: 'claim', frequency: 'daily' })]);
const claims = await Promise.all(responses.map(response => response.json()));
assert.deepEqual(claims.map(c => c.status).sort(), ['claimed', 'pending'], 'Only one origin may start a download');
const receipt = claims.find(c => c.status === 'claimed');
assert.equal((await call({ action: 'complete', frequency: 'daily', claimToken: 'wrong' })).status, 409);
assert.equal((await (await call({ action: 'complete', frequency: 'daily', claimToken: receipt.claimToken })).json()).status, 'downloaded');
assert.equal((await (await call({ action: 'claim', frequency: 'daily' })).json()).status, 'downloaded', 'Reloads cannot start another download');
assert.equal((await (await call({ action: 'claim', frequency: 'weekly' })).json()).status, 'downloaded', 'Changing frequency cannot duplicate the same day');
const storage = new Storage();
const internal = async (input) => (await new FollowUpDelivery({ storage }).fetch(new Request('https://backup.internal/backup', { method: 'POST', body: JSON.stringify(input) }))).json();
const monday = { action: 'claim', frequency: 'weekly', day: '2026-10-19', week: '2026-10-19' };
const weekly = await internal(monday);
assert.equal((await internal({ ...monday, day: '2026-10-20' })).status, 'pending', 'Uncertain downloads do not retry on another day');
await internal({ action: 'release', claimToken: weekly.claimToken });
const retry = await internal(monday);
assert.equal(retry.status, 'claimed', 'A failure before starting the download may retry');
await internal({ action: 'complete', claimToken: retry.claimToken });
assert.equal((await internal({ ...monday, day: '2026-10-21' })).status, 'downloaded');
assert.equal((await internal({ ...monday, day: '2026-10-26', week: '2026-10-26' })).status, 'claimed', 'Next period remains eligible');
assert.equal((await internal({ action: 'release', claimToken: retry.claimToken })).status, 'downloaded', 'A completed download cannot be released');
console.log('Backup shared reservations: authentication, concurrent origins, receipts, reloads, frequency switches, uncertain downloads, safe retry and next period passed.');
