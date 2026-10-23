import assert from 'node:assert/strict';
import { FollowUpDelivery, sendFollowUp } from '../functions/api/follow-up-send.js';
import worker from '../src/backend/worker.mjs';

class MemoryStorage {
  values = new Map();
  chain = Promise.resolve();
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { this.values.delete(key); }
  transaction(callback) {
    const run = this.chain.then(() => callback(this));
    this.chain = run.catch(() => {});
    return run;
  }
}
const request = input => new Request('https://coordinator/delivery', { method: 'POST', body: JSON.stringify(input) });
const storage = new MemoryStorage();
const instance = new FollowUpDelivery({ storage });
const claimInput = { action: 'claim', eligible: true };
const replies = await Promise.all(Array.from({ length: 10 }, () => instance.fetch(request(claimInput)).then(response => response.json())));
assert.equal(replies.filter(value => value.status === 'claimed').length, 1, 'Only one of ten concurrent tabs receives permission');
assert.equal(replies.filter(value => value.status === 'pending').length, 9);
const claim = replies.find(value => value.status === 'claimed');
assert.equal((await (await new FollowUpDelivery({ storage }).fetch(request(claimInput))).json()).status, 'pending', 'Reloads/restarts retain pending claims');
assert.equal((await instance.fetch(request({ action: 'complete', claimToken: 'wrong', sentAt: new Date().toISOString(), gmailId: 'gmail-1' }))).status, 409);
const receipt = { action: 'complete', claimToken: claim.claimToken, sentAt: '2026-10-23T00:02:00Z', gmailId: 'gmail-1' };
await instance.fetch(request(receipt));
assert.equal((await (await new FollowUpDelivery({ storage }).fetch(request(claimInput))).json()).gmailId, 'gmail-1', 'A stored receipt survives stale application state and browser reload');
const other = new FollowUpDelivery({ storage: new MemoryStorage() });
const secondClaim = await (await other.fetch(request(claimInput))).json();
await other.fetch(request({ action: 'release', claimToken: secondClaim.claimToken }));
assert.equal((await (await other.fetch(request(claimInput))).json()).status, 'claimed', 'Explicit Gmail rejection can release a reservation');
assert.equal((await new FollowUpDelivery({ storage: new MemoryStorage() }).fetch(request({ action: 'claim', eligible: false }))).status, 409);

const originalFetch = globalThis.fetch;
const namespaces = new Map();
let lastKey;
const env = { SUPABASE_URL: 'https://auth.test', SUPABASE_PUBLISHABLE_KEY: 'public', FOLLOW_UP_DELIVERIES: {
  idFromName: key => { lastKey = key; return key; },
  get: key => {
    if (!namespaces.has(key)) namespaces.set(key, new FollowUpDelivery({ storage: new MemoryStorage() }));
    return namespaces.get(key);
  }
} };
globalThis.fetch = async url => {
  if (String(url).includes('/auth/v1/user')) return Response.json({ id: 'u1' });
  assert.match(String(url), /user_id=eq\.u[12]/, 'State is scoped to the verified account');
  return Response.json([{ data: { applications: [{ id: 'app', followUpDate: '2026-10-23', automaticFollowUp: true, status: 'Applied' }] } }]);
};
const input = { applicationId: 'app', scheduledDate: '2026-10-23', action: 'claim' };
const apiRequest = body => new Request('https://app/api/follow-up/delivery', { method: 'POST', headers: { authorization: 'Bearer session' }, body: JSON.stringify(body) });
assert.equal((await worker.fetch(apiRequest(input), env, {})).status, 200, 'Worker authenticates and routes reservations');
assert.deepEqual(JSON.parse(lastKey), ['u1', 'app', '2026-10-23']);
assert.equal((await (await sendFollowUp(apiRequest(input), env, { id: 'u2' })).json()).status, 'claimed', 'Accounts have separate reservations');
assert.equal((await (await sendFollowUp(apiRequest({ ...input, scheduledDate: '2026-10-22' }), env, { id: 'u1' })).json()).error, 'This follow-up is no longer scheduled for automatic sending.');
assert.equal((await sendFollowUp(apiRequest({ ...input, gmailToken: 'not-allowed' }), env, { id: 'u1' })).status, 400, 'Credentials/content are rejected by the coordinator');
assert.equal((await sendFollowUp(apiRequest(input), {}, { id: 'u1' })).status, 503, 'Missing binding fails closed');
globalThis.fetch = originalFetch;
console.log('Passed shared delivery reservations: concurrent tabs, restart, uncertain delivery, receipts, rejection, account/date isolation, Worker routing and fail-closed configuration.');
