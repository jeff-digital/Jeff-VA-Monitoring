import assert from 'node:assert/strict';
import { FollowUpDelivery, sendFollowUp, savedFollowUpDelivery } from '../functions/api/follow-up-send.js';
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
let savedState = { applications: [{ id: 'app', followUpDate: '2026-10-23', automaticFollowUp: true, status: 'Applied' }] };
globalThis.fetch = async url => {
  if (String(url).includes('/auth/v1/user')) return Response.json({ id: 'u1' });
  assert.match(String(url), /user_id=eq\.u[12]/, 'State is scoped to the verified account');
  return Response.json([{ data: savedState }]);
};
const input = { applicationId: 'app', scheduledDate: '2026-10-23', action: 'claim' };
const apiRequest = body => new Request('https://app/api/follow-up/delivery', { method: 'POST', headers: { authorization: 'Bearer session' }, body: JSON.stringify(body) });
assert.equal((await worker.fetch(apiRequest(input), env, {})).status, 200, 'Worker authenticates and routes reservations');
assert.deepEqual(JSON.parse(lastKey), ['u1', 'app', '2026-10-23']);
assert.equal((await (await sendFollowUp(apiRequest(input), env, { id: 'u2' })).json()).status, 'claimed', 'Accounts have separate reservations');
assert.equal((await (await sendFollowUp(apiRequest({ ...input, scheduledDate: '2026-10-22' }), env, { id: 'u1' })).json()).error, 'This follow-up is no longer scheduled for automatic sending.');
assert.equal((await sendFollowUp(apiRequest({ ...input, gmailToken: 'not-allowed' }), env, { id: 'u1' })).status, 400, 'Credentials/content are rejected by the coordinator');
assert.equal((await sendFollowUp(apiRequest(input), {}, { id: 'u1' })).status, 503, 'Missing binding fails closed');

savedState = { applications: [{ id: 'historic', status: 'Applied', email: 'client@example.com', followUpDate: '2026-10-23', automaticFollowUp: true, followUpSentAt: '2026-10-23T00:02:00Z' }] };
const historic = { ...input, applicationId: 'historic' };
assert.equal((await (await sendFollowUp(apiRequest(historic), env, { id: 'u1' })).json()).status, 'sent', 'Saved sent timestamp blocks a new reservation even without an old ledger');
delete savedState.applications[0].followUpSentAt;
assert.equal((await (await sendFollowUp(apiRequest(historic), env, { id: 'u1' })).json()).status, 'sent', 'Recovered receipt survives a later cloud overwrite');
savedState = { applications: [{ id: 'manual-app', status: 'Applied', email: 'client@example.com', followUpDate: '2026-10-23', automaticFollowUp: false }], emails: [] };
const manualInput = { ...input, applicationId: 'manual-app', manual: true };
assert.equal((await (await sendFollowUp(apiRequest(manualInput), env, { id: 'u1' })).json()).status, 'claimed', 'Manual follow-ups also reserve shared delivery');
savedState.emails.push({ applicationId: 'manual-app', emailType: 'follow-up', direction: 'sent', date: '2026-10-23T00:03:00Z', gmailId: 'manual-mail' });
assert.equal((await (await sendFollowUp(apiRequest(manualInput), env, { id: 'u1' })).json()).gmailId, 'manual-mail', 'Saved manual send reconciles a pending reservation');
savedState.applications[0] = { ...savedState.applications[0], id: 'new-schedule', automaticFollowUp: true, followUpSentAt: '2026-10-22T00:00:00Z' };
assert.equal((await (await sendFollowUp(apiRequest({ ...input, applicationId: 'new-schedule' }), env, { id: 'u1' })).json()).status, 'claimed', 'Older and unrelated follow-ups do not block a new schedule');
globalThis.fetch = originalFetch;
console.log('Passed shared delivery reservations: concurrent tabs, restart, uncertain delivery, receipts, rejection, account/date isolation, Worker routing and fail-closed configuration.');

const roleApp = { id: 'role-app', role: 'Graphic Designer', email: 'shared@example.com', appliedDate: '2026-10-01' };
const roleState = { applications: [roleApp, { id: 'other-role', role: 'Editor', email: roleApp.email }], emails: [{ direction: 'sent', to: roleApp.email, subject: 'Graphic Designer', body: 'I wanted to follow up on my application, which I submitted on Oct 1, 2026 through OnlineJobs.ph.', date: '2026-10-23T01:00:00Z' }] };
assert.ok(savedFollowUpDelivery(roleState, roleApp, '2026-10-23'), 'Role-only follow-ups are recognized for shared recipients');
assert.equal(savedFollowUpDelivery(roleState, roleState.applications[1], '2026-10-23'), null, 'Other roles cannot inherit this follow-up');
roleState.emails[0].body = 'I am applying for this role.';
assert.equal(savedFollowUpDelivery(roleState, roleApp, '2026-10-23'), null, 'An ordinary application is not treated as sent follow-up');
