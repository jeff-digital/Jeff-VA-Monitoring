import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { FollowUpDelivery } from '../functions/api/follow-up-send.js';
const NativeDate = Date;
let clock = '2026-10-23T01:00:00Z';
globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return NativeDate.parse(clock); } };

const gmailSource = fs.readFileSync(new URL('../src/frontend/js/modules/04-gmail.js', import.meta.url), 'utf8');
const code = gmailSource.slice(gmailSource.indexOf('  async function requestFollowUpReservation('), gmailSource.indexOf('  async function sendGmailRaw('));
assert.equal((gmailSource.match(/async function sendAutomaticFollowUpOnce\(/g) || []).length, 1);
assert.doesNotMatch(code, /gmailToken|JSON\.stringify\([^\n]*(?:raw|body|subject)/, 'Shared coordinator must not receive Gmail credentials or email contents');
const app = { id: 'app', email: 'client@example.com' };
const date = '2026-10-23', subject = 'Follow-up: Company';
function fixture({ uncertain = false, rejected = false, completeFails = false, existing = false, existingSubject = subject, existingBody = 'I wanted to follow up on my application.', notSent = false } = {}) {
  const values = new Map();
  let chain = Promise.resolve();
  const storage = { get: async key => values.get(key), put: async (key, value) => values.set(key, value), delete: async key => values.delete(key),
    transaction: callback => { const run = chain.then(() => callback(storage)); chain = run.catch(() => {}); return run; } };
  const coordinator = new FollowUpDelivery({ storage });
  let calls = 0, attempts = 0;
  const history = existing ? [{ id: 'existing', internalDate: String(Date.parse('2026-10-23T00:02:00Z')), payload: { headers: [{ name: 'To', value: app.email }, { name: 'Subject', value: existingSubject }], text: existingBody } }] : [];
  const tab = () => {
    const context = vm.createContext({ Date: globalThis.Date, URLSearchParams, AbortSignal, console: { error() {} },
      currentUser: { id: 'u1' }, ensureGmailAccessToken: async () => {},
      requireSupabase: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'dashboard-session', user: { id: 'u1' } } } }) } }),
      extractEmailAddress: value => value.toLowerCase(), encodeBase64Url: value => value,
      buildRawEmailMessage: value => value,
      gmailMessageBody: payload => payload.text || '',
      fetchGmailJson: async url => {
        if (new URL(url).searchParams.has('q')) return { messages: history.map(email => ({ id: email.id })) };
        return history.find(email => url.includes(`/${email.id}?`));
      },
      fetch: async (url, options) => {
        assert.equal(url, '/api/follow-up/delivery');
        assert.equal(options.headers.authorization, 'Bearer dashboard-session');
        const body = JSON.parse(options.body);
        assert.ok(Object.keys(body).every(key => ['applicationId', 'scheduledDate', 'action', 'claimToken', 'sentAt', 'gmailId', 'manual'].includes(key)), 'Coordinator receives identifiers/receipts only');
        if (completeFails && body.action === 'complete') throw new Error('Receipt network failure');
        return coordinator.fetch(new Request('https://coordinator', { method: 'POST', body: JSON.stringify({ ...body, eligible: true }) }));
      },
      sendGmailRaw: async () => {
        attempts++;
        if (uncertain) throw new Error('Connection lost after POST');
        if (notSent && attempts === 1) throw Object.assign(new Error('Gmail renewal failed before send'), { gmailNotSent: true });
        if (rejected && attempts === 1) throw Object.assign(new Error('Rejected'), { gmailRejected: true });
        calls++;
        history.push({ id: 'sent-1', internalDate: String(Date.now()), payload: { headers: [{ name: 'To', value: app.email }, { name: 'Subject', value: subject }] } });
        return { id: 'sent-1' };
      }
    });
    vm.runInContext(fs.readFileSync('src/frontend/js/modules/02ac-follow-up-calendar.js','utf8'), context);
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

const beforePostFailure = fixture({ notSent: true });
await assert.rejects(beforePostFailure.tab().sendAutomaticFollowUpOnce(app, date, subject, 'Body'), error => error.followUpDeliveryState === 'retry');
assert.equal(beforePostFailure.values.has('delivery'), false, 'A confirmed pre-send failure releases the reservation');
await beforePostFailure.tab().sendAutomaticFollowUpOnce(app, date, subject, 'Body');
assert.equal(beforePostFailure.calls(), 1, 'Automatic retry after a confirmed pre-send failure sends exactly once');

const savedReceiptFailed = fixture({ completeFails: true });
await savedReceiptFailed.tab().sendAutomaticFollowUpOnce(app, date, subject, 'Body');
assert.equal(savedReceiptFailed.values.get('delivery').status, 'pending');
await savedReceiptFailed.tab().sendAutomaticFollowUpOnce(app, date, subject, 'Body');
assert.equal(savedReceiptFailed.calls(), 1, 'Receipt failure cannot cause a duplicate');

const alreadySent = fixture({ existing: true });
await alreadySent.tab().sendAutomaticFollowUpOnce(app, date, subject, 'Body');
assert.equal(alreadySent.attempts(), 0, 'Existing Gmail sent mail is checked before any send');
assert.equal(alreadySent.values.get('delivery').status, 'sent', 'Recovered Gmail delivery is recorded durably');
alreadySent.history.length = 0;
await alreadySent.tab().sendAutomaticFollowUpOnce(app, date, 'Changed follow-up subject', 'Body');
assert.equal(alreadySent.attempts(), 0, 'Missing Gmail history or edited subject cannot bypass a recovered receipt');

const roleHistory = fixture({ existing: true, existingSubject: 'Graphic Designer' });
assert.equal((await roleHistory.tab().findGmailSentFollowUp(app, date, 'Graphic Designer')).gmailId, 'existing', 'Role-only follow-ups are recovered from Gmail using their message content');
const prefixedHistory = fixture({ existing: true, existingSubject: 'Application for Graphic Designer' });
assert.equal((await prefixedHistory.tab().findGmailSentFollowUp({ ...app, role: 'Graphic Designer' }, date, 'Application for Graphic Designer')).gmailId, 'existing');
assert.equal((await roleHistory.tab().findGmailSentFollowUp({ ...app, role: 'Graphic Designer' }, date, 'Application for Graphic Designer')).gmailId, 'existing', 'Earlier role-only subjects remain recognized');
const originalApplication = fixture({ existing: true, existingSubject: 'Graphic Designer', existingBody: 'Please consider my application for this position.' });
assert.equal(await originalApplication.tab().findGmailSentFollowUp(app, date, 'Graphic Designer'), null, 'An original application with the same subject is not a completed follow-up');
const legacyHistory = fixture({ existing: true });
assert.equal((await legacyHistory.tab().findGmailSentFollowUp({ ...app, clientName: 'Company' }, date, 'Graphic Designer')).gmailId, 'existing', 'Legacy company subjects remain protected after the subject change');

const manualRace = fixture();
const manualTab = manualRace.tab();
const nodes = new Map();
const node = selector => {
  if (!nodes.has(selector)) nodes.set(selector, { value: '', open: false, close() {} });
  return nodes.get(selector);
};
node('#composeTo').value = app.email;
node('#composeSubject').value = 'Graphic Designer';
node('#composeBody').value = 'I wanted to follow up on my application.';
Object.assign(manualTab, {
  $: node, data: { applications: [{ ...app, followUpDate: date, automaticFollowUp: true }], emails: [] },
  composeClientId: app.id, composeContractEmailMode: false, composeDocumentUpdateClientId: null,
  composeAttachment: null, composeAttachmentFile: null, composeRequiresConfirmation: false,
  composeInvoiceDraft: null, composeActivationClientId: null, editingId: '', contractEmailSendPending: false,
  today: () => date, isEmailAddress: () => true, uid: () => 'id',
  setEmailComposeStatus() {}, setButtonLoading() {}, renderAll() {}, showEmailActionResult() {},
  isActiveClientDrawerOpen: () => false, persist: async () => {}, reconcileSentFollowUpAlerts() {}
});
vm.runInContext(gmailSource.slice(gmailSource.indexOf('  let composeEmailSendPending ='), gmailSource.indexOf('  function gmailConfigured(')), manualTab);
await Promise.allSettled([
  manualTab.sendComposedEmail(), manualTab.sendComposedEmail(),
  manualRace.tab().sendAutomaticFollowUpOnce(app, date, subject, 'Body')
]);
assert.equal(manualRace.calls(), 1, 'Composer double-click and automatic sender share one delivery reservation');
manualTab.composeClientId = app.id; // Reopen the same client's composer.
await manualTab.sendComposedEmail();
assert.equal(manualRace.calls(), 1, 'Repeated manual follow-up does not send again');
console.log('Passed browser/shared-coordinator integration: stale tabs, Gmail recovery, uncertain sends, explicit rejection, failed receipt saves and metadata-only coordination.');
const weekend = fixture();
clock = '2026-10-24T01:00:00Z';
await assert.rejects(weekend.tab().sendAutomaticFollowUpOnce(app, date, subject, 'Body'), /Monday–Friday/);
assert.equal(weekend.attempts(),0,'Weekend does not contact Gmail to send');
assert.equal(weekend.values.size,0,'Weekend does not claim a delivery');
clock = '2026-10-26T01:00:00Z';
await weekend.tab().sendAutomaticFollowUpOnce(app,date,subject,'Body');
assert.equal(weekend.calls(),1,'Original schedule can send on Monday');
globalThis.Date = NativeDate;
