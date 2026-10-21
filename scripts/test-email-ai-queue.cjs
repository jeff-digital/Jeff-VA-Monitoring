const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '../src/frontend/js/modules', name), 'utf8');
const nodes = new Map(), storage = new Map();
const $ = key => { if (!nodes.has(key)) nodes.set(key, { textContent: '', dataset: {}, addEventListener() {} }); return nodes.get(key); };
let calls = 0, inFlight = 0, maxInFlight = 0, providerFails = false;
const observations = [];
const context = vm.createContext({ $, AbortSignal, document: { addEventListener() {} },
  currentUser: { id: 'u1' }, navigator: { onLine: true }, dataReady: true, supabaseDataLoaded: true, hiredEditingId: '', data: {},
  localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  requireSupabase: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'session' } } }) } }),
  isSentEmail: email => email.direction === 'sent',
  activeClientsMatchingSender: email => context.data.applications.filter(app => app.status === 'Active client' && app.email === email.from),
  matchApplicationsForEmail: email => context.data.applications.filter(app => app.email === email.from),
  persist: async () => true, renderAlerts() {}, renderClientTasks() {}, renderApplications() {}, emailContentText: text => text,
  fetch: async (url, options) => {
    calls++; inFlight++; maxInFlight = Math.max(inFlight, maxInFlight);
    const input = JSON.parse(options.body);
    observations.push($('#clientEmailAiStatus').textContent);
    await new Promise(resolve => setImmediate(resolve));
    inFlight--;
    if (providerFails) return { ok: false, status: 503, json: async () => ({ error: 'AI request timed out. Emails remain queued.', retryAfter: 60 }) };
    return { ok: true, status: 200, json: async () => input.applicationId ? {
      outcome: input.applicationId.endsWith('0') ? 'position_closed' : input.applicationId.endsWith('1') ? 'uncertain' : 'no_change',
      rejectApplication: input.applicationId.endsWith('0'), matchesApplication: true, confidence: 0.98,
      reason: 'Mocked application decision.', evidence: 'This position is closed.'
    } : { purpose: 'work_task', createTask: true, roleRelated: true, confidence: 0.98,
      title: 'Prepare weekly report', evidence: 'Please prepare the weekly report.', reason: 'A saved-role work request.' } };
  }
});
vm.runInContext(read('pages/10a-email-client-tasks.js'), context);
vm.runInContext(read('04a-email-outcomes.js'), context);
function reset() {
  storage.clear(); calls = 0; maxInFlight = 0; observations.length = 0; providerFails = false;
  const start = new Date(context.emailAiWeekRange().start).toISOString();
  const client = { id: 'client', email: 'owner@example.com', clientName: 'Acme', role: 'Content Specialist', status: 'Active client', activeAt: start };
  const applications = Array.from({ length: 4 }, (_, index) => ({ id: `app-${index}`, email: `recruiter-${index}@example.com`,
    role: 'Content Specialist', clientName: `Company ${index}`, status: 'Applied', appliedDate: start, updatedAt: start }));
  const date = new Date().toISOString();
  context.data = { applications: [client, ...applications], clientTasks: [], alerts: [], emails: [
    ...Array.from({ length: 5 }, (_, index) => ({ id: `task-email-${index}`, from: client.email, body: 'Please prepare the weekly report.', date, bodyLoaded: true })),
    ...applications.map(app => ({ id: `email-${app.id}`, from: app.email, body: 'This position is closed.', date, bodyLoaded: true })),
    { id: 'previous-week', from: client.email, body: 'Old work request.', date: new Date(Date.parse(start) - 1000).toISOString(), bodyLoaded: true }
  ] };
}
(async () => {
  reset();
  const first = context.checkAllEmailAiMessages(), duplicate = context.checkAllEmailAiMessages();
  const [result] = await Promise.all([first, duplicate]);
  assert.equal(calls, 9, 'one run must check all five tasks and four application messages');
  assert.equal(maxInFlight, 1, 'continuous checking must not flood the provider with simultaneous calls');
  assert.equal(result.automaticTasks.created.length, 5); assert.equal(result.applicationOutcomes.changed.length, 1);
  assert.equal(result.applicationOutcomes.review.length, 1);
  assert.equal(context.data.clientTasks.length, 5); assert.equal(context.data.alerts.filter(alert => alert.type === 'application-email-closed').length, 1);
  assert.equal(context.data.emailTaskAiUsage.requests, 9);
  assert.equal($('#clientEmailAiStatus').textContent, 'AI checked');
  assert.equal($('#emailAiStatusTrigger').ariaBusy, 'false'); assert.equal($('#emailAiQueueProgress').textContent, '9/9 this run');
  for (let index = 0; index < 9; index++) assert.match(observations[index], new RegExp(`AI checking ${index}/9`));
  await context.checkAllEmailAiMessages(); assert.equal(calls, 9, 'completed checks must not be repeated on the next sync');
  assert.equal($('#clientEmailAiStatus').textContent, 'AI checked');
  assert.equal(context.data.emails.some(email => email.id === 'previous-week'), true);

  reset(); context.data.emailTaskAiUsage = { day: new Date().toISOString().slice(0, 10), requests: 38 };
  let paused = await context.checkAllEmailAiMessages();
  assert.equal(calls, 2); assert.equal(context.data.clientTasks.length, 2);
  assert.equal(context.data.emailTaskAiUsage.requests, 40); assert.equal(paused.applicationOutcomes.changed.length, 0);
  assert.equal(context.pendingEmailAiChecks().length, 7); assert.equal($('#clientEmailAiStatus').textContent, 'AI needs attention');
  assert.equal($('#emailAiQueueProgress').textContent, '2/9 this run');
  await context.checkAllEmailAiMessages(); assert.equal(calls, 2, 'quota cooldown must not send more requests');
  storage.clear(); context.data.emailTaskAiUsage.requests = 0;
  await context.checkAllEmailAiMessages(); assert.equal(calls, 9); assert.equal(context.data.clientTasks.length, 5);
  assert.equal(context.pendingEmailAiChecks().length, 0);

  reset(); providerFails = true;
  paused = await context.checkAllEmailAiMessages(); assert.equal(calls, 1);
  assert.equal(context.data.clientTasks.length, 0); assert.equal(paused.applicationOutcomes.changed.length, 0);
  assert.equal(context.pendingEmailAiChecks().length, 9); assert.equal($('#emailAiStatusTrigger').ariaBusy, 'false');
  storage.clear(); providerFails = false;
  await context.checkAllEmailAiMessages(); assert.equal(calls, 10); assert.equal(context.pendingEmailAiChecks().length, 0);
  console.log('Continuous AI queue passed: all weekly client/application checks, live progress, single-flight execution, sequential requests, deduplication, daily-cap pause/resume and provider-error recovery.');
})().catch(error => { console.error(error); process.exitCode = 1; });
