const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '../src/frontend/js/modules', name), 'utf8');
const nodes = new Map();
const $ = key => { if (!nodes.has(key)) nodes.set(key, { dataset: {}, textContent: '', addEventListener() {} }); return nodes.get(key); };
const app = (extra = {}) => ({ id: 'app-1', clientName: 'Acme', role: 'Content Specialist', email: 'client@acme.example', status: 'Applied',
  appliedDate: new Date(Date.now() - 172800000).toISOString(), updatedAt: new Date(Date.now() - 86400000).toISOString(), ...extra });
const mail = (extra = {}) => ({ id: 'email-1', gmailId: 'gmail-1', from: 'client@acme.example', subject: 'Application update',
  body: 'We have filled this position.', bodyLoaded: true, date: new Date(Date.now() - 3600000).toISOString(), ...extra });
const storage = new Map();
let saveSucceeds = true, decision, calls = 0, fail = false, duringRequest, notice, openedEmail;
const context = vm.createContext({ $, console, AbortSignal, currentUser: { id: 'u1' }, navigator: { onLine: true },
  dataReady: true, supabaseDataLoaded: true, data: {}, document: { addEventListener() {} },
  localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  requireSupabase: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'session', user: { id: 'u1' } } } }) } }),
  fetch: async (url, options) => {
    const input = JSON.parse(options.body);
    assert.deepEqual(Object.keys(input).sort(), ['applicationId', 'emailId']);
    assert.equal(input.applicationId, 'app-1'); assert.equal(url, '/api/email/classify'); calls++;
    if (duringRequest) duringRequest();
    return { status: fail ? 503 : 200, ok: !fail, json: async () => fail ? { error: 'AI unavailable', retryAfter: 60 } : decision };
  },
  isSentEmail: email => email.direction === 'sent' || email.labelIds?.includes('SENT') || email.from === 'me@example.com',
  matchApplicationsForEmail: email => context.data.applications.filter(app => app.email === email.from),
  persist: async () => saveSucceeds, renderAlerts() {}, renderAll() {}, showActionResult(value) { notice = value; },
  showView() {}, openEmailDetail(id) { openedEmail = id; }
});
vm.runInContext(source('pages/10a-email-client-tasks.js'), context);
vm.runInContext(source('04a-email-outcomes.js'), context);
assert.equal(context.detectApplicationEmailOutcome, undefined, 'the phrase-based classifier must be removed');
assert.equal(context.applyApplicationEmailOutcomes, undefined, 'the old rejection process must be removed');
function reset() {
  context.currentUser = { id: 'u1' }; const record = app();
  context.data = { applications: [record], emails: [mail()], alerts: [], clientTasks: [] };
  storage.clear(); saveSucceeds = true; calls = 0; fail = false; duringRequest = null;
  decision = { outcome: 'position_filled', confidence: 0.98, matchesApplication: true, rejectApplication: true,
    evidence: 'We have filled this position.', reason: 'The recruiter confirms hiring is finished.' };
  return record;
}
const run = budget => context.applyAiApplicationOutcomes(context.data.emails, budget);
(async () => {
  let record = reset();
  const budget = { remaining: 1 };
  let result = await run(budget);
  assert.equal(budget.remaining, 0);
  assert.equal(result.changed.length, 1); assert.equal(record.status, 'Not selected');
  assert.equal(record.emailClosure.source, 'cloudflare-ai');
  assert.equal(record.emailClosure.analysis.outcome, 'position_filled');
  assert.equal(context.data.alerts[0].type, 'application-email-closed');
  assert.equal(context.data.alerts[0].unread, true); assert.ok(context.data.alerts[0].evidence);
  assert.equal(context.data.clientTasks.length, 0, 'application analysis cannot create tasks');
  assert.equal(context.data.emailTaskAiUsage.requests, 1, 'applications share the existing daily AI counter');
  context.showApplicationEmailOutcomeNotice(result.changed);
  assert.equal(notice.label, 'APPLICATION UPDATE');
  assert.match(notice.details[0].subject, /We have filled this position/);
  notice.onAction(); assert.equal(openedEmail, 'email-1');
  record.status = 'Applied'; await run();
  assert.equal(record.status, 'Applied', 'manually reopened applications must not be rejected again from the same email');
  assert.equal(calls, 1);

  for (const outcome of ['rejected', 'position_closed', 'position_filled', 'position_unavailable', 'application_expired']) {
    record = reset(); decision.outcome = outcome; assert.equal((await run()).changed.length, 1);
  }
  // The user's Frontline example must remain eligible after unrelated edits.
  record = reset();
  Object.assign(record, { clientName: 'Frontline Accounting', role: 'AU Administrative Assistant (Hybrid) - with 30K Signing Bonus!',
    email: 'sherilyn@frontlineaccounting.com', updatedAt: new Date().toISOString(), notes: 'Edited after email arrived' });
  Object.assign(context.data.emails[0], { from: 'sherilyn@frontlineaccounting.com', subject: 'Your Application at Frontline Accounting',
    body: 'Dear Jeffrey,\nThank you for your application for the position of AU Administrative Assistant (Hybrid) - with 30K Signing Bonus! with Frontline Accounting.\nWe truly appreciate the time and effort you put into your application. At this time, we would like to let you know that the role has been filled.\nWhile this position may not be the right match at the moment, we encourage you to explore other opportunities.' });
  decision = { ...decision, outcome: 'position_filled', evidence: 'At this time, we would like to let you know that the role has been filled.' };
  result = await run(); assert.equal(result.changed.length, 1); assert.equal(record.status, 'Not selected');
  assert.equal(record.emailClosure.reason, 'Position filled');
  record = reset(); record.manualStatusChangedAt = new Date().toISOString();
  result = await run(); assert.equal(calls, 0); assert.equal(record.status, 'Applied', 'a real manual stage change must remain protected');
  assert.match(context.applicationAiSkipReason(context.data.emails[0], record, context.data.emails), /manually changed/);
  record = reset(); decision = { ...decision, outcome: 'no_change', rejectApplication: false };
  await run(); await run(); assert.equal(record.status, 'Applied'); assert.equal(calls, 1, 'non-outcomes must be cached too');
  assert.equal(context.data.alerts.length, 0);
  for (const modification of [{ outcome: 'uncertain', rejectApplication: false }, { confidence: 0.8, outcome: 'uncertain', rejectApplication: false },
    { matchesApplication: false, outcome: 'uncertain', rejectApplication: false }]) {
    record = reset(); Object.assign(decision, modification); result = await run();
    assert.equal(record.status, 'Applied'); assert.equal(result.review.length, 1);
    context.showApplicationAiReviewNotice(result.review);
    assert.equal(notice.label, 'APPLICATION REVIEW'); assert.match(notice.message, /status is unchanged/);
    assert.equal(context.data.alerts[0].type, 'application-email-review'); await run(); assert.equal(context.data.alerts.length, 1);
  }
  for (const status of ['Active client', 'Offer', 'Not selected', 'Rejected', 'To Apply']) {
    record = reset(); record.status = status; await run(); assert.equal(record.status, status); assert.equal(calls, 0);
  }
  record = reset(); context.data.applications.push(app({ id: 'other' })); await run(); assert.equal(calls, 0);
  for (const extra of [{ direction: 'sent' }, { labelIds: ['SENT'] }, { from: 'me@example.com' },
    { date: new Date(Date.now() - 259200000).toISOString() }, { date: new Date(Date.now() + 3600000).toISOString() }]) {
    record = reset(); Object.assign(context.data.emails[0], extra); await run(); assert.equal(calls, 0); assert.equal(record.status, 'Applied');
  }
  record = reset(); context.data.emails.push(mail({ id: 'new', gmailId: 'new', body: 'You are invited to an interview.', date: new Date().toISOString() }));
  decision = { ...decision, outcome: 'no_change', rejectApplication: false }; await run();
  assert.equal(record.status, 'Applied'); assert.equal(context.data.emails[0].applicationAiAnalysis, undefined, 'old closure cannot override latest invitation');
  for (const change of [() => { context.data.applications[0].status = 'Interview'; },
    () => { context.data.emails[0].body = 'Edited'; }, () => { context.data.emails[0].date = new Date().toISOString(); },
    () => { context.data.emails.push(mail({ id: 'new', date: new Date().toISOString() })); }]) {
    record = reset(); duringRequest = change; result = await run(); assert.equal(result.changed.length, 0, 'in-flight edits invalidate the decision');
  }
  record = reset(); duringRequest = () => { context.currentUser = { id: 'other' }; };
  assert.equal((await run()).changed.length, 0); assert.equal(record.status, 'Applied');
  record = reset(); saveSucceeds = false; result = await run();
  assert.equal(result.failed, true); assert.equal(record.status, 'Applied'); assert.equal(context.data.alerts.length, 0);
  assert.equal(context.data.emails[0].applicationAiProcessedKey, undefined);
  saveSucceeds = true; result = await run(); assert.equal(result.changed.length, 1); assert.equal(calls, 1, 'failed saves reuse the cached AI response');
  record = reset(); fail = true; await run(); assert.equal(record.status, 'Applied'); assert.equal(context.data.alerts.length, 0);
  record = reset();
  const previousWeek = new Date(context.emailAiWeekRange().start - 1000).toISOString();
  record.appliedDate = new Date(Date.parse(previousWeek) - 86400000).toISOString(); record.updatedAt = record.appliedDate;
  context.data.emails[0].date = previousWeek;
  await run(); assert.equal(calls, 0, 'older matching applications must not be checked even when chronology is otherwise valid');
  assert.equal(record.status, 'Applied'); assert.equal(context.data.emails.length, 1); assert.equal(context.data.alerts.length, 0);
  record = reset(); await run({ remaining: 0 }); assert.equal(calls, 0, 'the per-sync budget is shared');
  record = reset(); context.data.emailTaskAiUsage = { day: new Date().toISOString().slice(0, 10), requests: 40 };
  await run(); assert.equal(calls, 0); assert.equal(record.status, 'Applied');
  record = reset(); decision = { broken: true }; await run(); assert.equal(record.status, 'Applied');
  console.log('AI application integration passed: outcomes, review, no tasks, shared limits, cache, chronology, direction, ambiguity, in-flight edits, account isolation, provider failures and save rollback.');
})().catch(error => { console.error(error); process.exitCode = 1; });
