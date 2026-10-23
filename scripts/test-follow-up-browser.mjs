import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { FollowUpDelivery } from '../functions/api/follow-up-send.js';

const gmailSource = fs.readFileSync(new URL('../src/frontend/js/modules/04-gmail.js', import.meta.url), 'utf8');
const code = gmailSource.slice(gmailSource.indexOf('  async function requestFollowUpReservation('), gmailSource.indexOf('  async function sendGmailRaw('));
assert.equal((gmailSource.match(/async function sendAutomaticFollowUpOnce\(/g) || []).length, 1);
assert.doesNotMatch(code, /gmailToken|JSON\.stringify\([^\n]*(?:raw|body|subject)/, 'Shared coordinator must not receive Gmail credentials or email contents');
const app = { id: 'app', email: 'client@example.com' };
const date = '2026-10-23', subject = 'Follow-up: Company';
function fixture({ uncertain = false, rejected = false, completeFails = false, existing = false } = {}) {
  const values = new Map();
  let chain = Promise.resolve();
  const storage = { get: async key => values.get(key), put: async (key, value) => values.set(key, value), delete: async key => values.delete(key),
    transaction: callback => { const run = chain.then(() => callback(storage)); chain = run.catch(() => {}); return run; } };
  const coordinator = new FollowUpDelivery({ storage });
  let calls = 0, attempts = 0;
  const history = existing ? [{ id: 'existing', internalDate: String(Date.parse('2026-10-23T00:02:00Z')), payload: { headers: [{ name: 'To', value: app.email }, { name: 'Subject', value: subject }] } }] : [];
  const tab = () => {
    const context = vm.createContext({ URLSearchParams, AbortSignal, console: { error() {} },
      currentUser: { id: 'u1' }, ensureGmailAccessToken: async () => {},
      requireSupabase: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'dashboard-session', user: { id: 'u1' } } } }) } }),
      extractEmailAddress: value => value.toLowerCase(), encodeBase64Url: value => value,
      buildRawEmailMessage: value => value,
      fetchGmailJson: async url => {
        if (new URL(url).searchParams.has('q')) return { messages: history.map(email => ({ id: email.id })) };
        return history.find(email => url.includes(`/${email.id}?`));
      },
      fetch: async (url, options) => {
        assert.equal(url, '/api/follow-up/delivery');
        assert.equal(options.headers.authorization, 'Bearer dashboard-session');
        const body = JSON.parse(options.body);
        assert.ok(Object.keys(body).every(key => ['applicationId', 'scheduledDate', 'action', 'claimToken', 'sentAt', 'gmailId'].includes(key)), 'Coordinator receives identifiers/receipts only');
        if (completeFails && body.action === 'complete') throw new Error('Receipt network failure');
        return coordinator.fetch(new Request('https://coordinator', { method: 'POST', body: JSON.stringify({ ...body, eligible: true }) }));
      },
      sendGmailRaw: async () => {
        attempts++;
        if (uncertain) throw new Error('Connection lost after POST');
        if (rejected && attempts === 1) throw Object.assign(new Error('Rejected'), { gmailRejected: true });
        calls++;
        history.push({ id: 'sent-1', internalDate: String(Date.now()), payload: { headers: [{ name: 'To', value: app.email }, { name: 'Subject', value: subject }] } });
        return { id: 'sent-1' };
      }
    });
    vm.runInContext(code, context);
    return context;
  };
  return { tab, calls: () => calls, attempts: () => attempts, values, history };
}
const simultaneous = fixture();
const tabs = [simultaneous.tab(), simultaneous.tab(), simultaneous.tab()];
await Promise.allSettled(tabs.map(tab => tab.sendAutomaticFollowUpOnce(app, date, subject, 'Body')));
assert.equal(simultaneous.calls(), 1, 'Separate stale tabs can send only one follow-up');
assert.equal(simultaneous.values.get('delivery').status, 'sent');
assert.equal((await simultaneous.tab().sendAutomaticFollowUpOnce(app, date, subject, 'Body')).gmailId, 'sent-1');
assert.equal(simultaneous.calls(), 1, 'Reload after success recovers Sent mail');

const pending = fixture({ uncertain: true });
await assert.rejects(pending.tab().sendAutomaticFollowUpOnce(app, date, subject, 'Body'), /uncertain/);
await assert.rejects(pending.tab().sendAutomaticFollowUpOnce(app, date, subject, 'Body'), /blocked/);
assert.equal(pending.attempts(), 1, 'Uncertain delivery never retries POST');

const refusal = fixture({ rejected: true });
await assert.rejects(refusal.tab().sendAutomaticFollowUpOnce(app, date, subject, 'Body'), /rejected/);
await refusal.tab().sendAutomaticFollowUpOnce(app, date, subject, 'Body');
assert.equal(refusal.attempts(), 2);
assert.equal(refusal.calls(), 1, 'Explicit Gmail rejection is safely retryable');

const savedReceiptFailed = fixture({ completeFails: true });
await savedReceiptFailed.tab().sendAutomaticFollowUpOnce(app, date, subject, 'Body');
assert.equal(savedReceiptFailed.values.get('delivery').status, 'pending');
await savedReceiptFailed.tab().sendAutomaticFollowUpOnce(app, date, subject, 'Body');
assert.equal(savedReceiptFailed.calls(), 1, 'Receipt failure cannot cause a duplicate');

const alreadySent = fixture({ existing: true });
await alreadySent.tab().sendAutomaticFollowUpOnce(app, date, subject, 'Body');
assert.equal(alreadySent.attempts(), 0, 'Existing Gmail sent mail is checked before any send');
assert.equal(alreadySent.values.size, 0);
console.log('Passed browser/shared-coordinator integration: stale tabs, Gmail recovery, uncertain sends, explicit rejection, failed receipt saves and metadata-only coordination.');
