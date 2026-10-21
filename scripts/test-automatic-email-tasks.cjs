const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '../src/frontend/js/modules', file), 'utf8');
const nodes = new Map();
const $ = key => {
  if (!nodes.has(key)) nodes.set(key, { addEventListener() {}, value: '', dataset: {} });
  return nodes.get(key);
};
const client = { id: 'client-1', email: 'owner@example.com', contact: 'Jordan', clientName: 'Acme', role: 'Social Media Manager', status: 'Active client', activeAt: new Date(Date.now() - 86400000).toISOString() };
const messages = new Map();
let liveIds = [];
let historyIds = [];
let saving = true;
let notices = [];
let closed = true;
const localValues = new Map();
let classificationCalls = 0;
let providerStatus = 200;
let purposeOverride = '';
const context = vm.createContext({ $, console, URLSearchParams, AbortSignal, currentUser: { id: 'u1' },
  localStorage: { getItem: key => localValues.get(key), setItem: (key, value) => localValues.set(key, value) },
  requireSupabase: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'session' } } }) } }),
  // Provider fixtures test app decisions, not the model's semantic accuracy.
  fetch: async (url, options) => {
    assert.equal(url, '/api/email/classify');
    const input = JSON.parse(options.body);
    assert.deepEqual(Object.keys(input).sort(), ['clientId', 'emailId'], 'email text must be loaded from saved records on the server');
    classificationCalls++;
    if (providerStatus !== 200) return { ok: false, status: providerStatus,
      json: async () => ({ error: 'Cloudflare AI allowance reached. Emails remain queued.', retryAfter: 3600 }) };
    const email = context.data.emails.find(item => item.id === input.emailId);
    const ignored = ['gmail-thanks', 'gmail-newsletter'].includes(email.id);
    const purpose = purposeOverride || (ignored ? 'informational' : 'work_task');
    return { ok: true, json: async () => ({ purpose,
      createTask: purpose === 'work_task', confidence: purpose === 'uncertain' ? 0.4 : 0.96, roleRelated: purpose === 'work_task', reason: ignored ? 'Acknowledgement, not outstanding work.' : 'Client requests a role-related deliverable.',
      evidence: email.body.slice(0, 300), title: 'Prepare client content', inputKey: `digest-${email.id}`, version: 1 }) };
  },
  dataReady: true, supabaseDataLoaded: true, hiredEditingId: '', gmailSyncInFlight: false,
  gmailAccessToken: 'token', gmailReconnectRequired: false, navigator: { onLine: true },
  sentHistoryAddressSignature: '', sentHistoryPageToken: '', sentHistoryQueue: [], sentHistoryLoaded: true,
  inboxHistoryPageToken: '', inboxHistoryQueue: [], inboxHistoryLoaded: false,
  data: { applications: [client], clientTasks: [], emails: [], alerts: [], deletedGmailIds: [] },
  document: { addEventListener() {} }, sessionStorage: { setItem() {} }, GMAIL_CONNECTED_KEY: 'connected',
  isSentEmail: email => email.direction === 'sent' || email.labelIds?.includes('SENT') || email.from === 'me@example.com',
  activeClientsMatchingSender: email => context.isSentEmail(email) ? [] : context.data.applications.filter(app =>
    app.status === 'Active client' && app.contractStatus !== 'Contract Ended' && email.from === app.email),
  isEmailTaskActiveClient: app => app.status === 'Active client' && app.contractStatus !== 'Contract Ended',
  matchApplicationsForEmail: email => context.activeClientsMatchingSender(email),
  isDirectClientApplication: () => false, extractEmailAddress: value => value, isEmailAddress: value => value.includes('@'),
  emailContentText: value => value.trim(), gmailMessageBody: payload => payload.body,
  persist: async () => saving, renderAll() {}, renderClientTasks() {}, renderAlerts() {},
  dedupeEmails: emails => [...new Map(emails.map(email => [email.id, email])).values()],
  alertPortfolioSubmissionEmails: () => false,
  applyAiApplicationOutcomes: async () => ({ changed: closed ? [{ email: { id: 'other-email' } }] : [], review: [], failed: false }),
  showApplicationAiReviewNotice() {},
  showApplicationEmailOutcomeNotice: results => { if (results.length) notices.push({ title: 'Application closed' }); },
  updateGmailConnectionUI() {}, setGmailSyncDisplay() {}, recordGmailSyncSuccess() {}, setGmailStatus() {},
  showActionResult: notice => notices.push(notice), plural: (count, word) => `${count} ${word}`,
  isInterviewEmail: () => true, interviewDateFromEmail: () => '', limitAlertHistory() {},
  fetchGmailJson: async url => {
    const parsed = new URL(url);
    if (parsed.pathname.includes('/messages/')) return messages.get(parsed.pathname.split('/').pop());
    if (parsed.searchParams.get('q') || parsed.searchParams.get('labelIds') === 'SENT') return { messages: [] };
    return { messages: (parsed.searchParams.get('maxResults') === '500' ? historyIds : liveIds).map(id => ({ id })) };
  }
});
vm.runInContext(read('pages/10a-email-client-tasks.js'), context);
context.renderEmailTaskAiStatus('Email tasks: active-client messages checked.');
assert.equal($('#accountEmailAiStatus').textContent, 'Messages checked');
assert.match($('#accountEmailAiDetails').textContent, /0\/40 checks today.*Shared by application outcomes and active-client tasks/);
context.navigator.onLine = false;
context.renderEmailTaskAiStatus();
assert.equal($('#accountEmailAiStatus').textContent, 'Offline');
context.navigator.onLine = true;
const documents = read('03-documents.js');
vm.runInContext(documents.slice(documents.indexOf('  function alertNewMatches('), documents.indexOf('  const generatedNotificationTypes')), context);
const gmail = read('04-gmail.js');
vm.runInContext(gmail.slice(gmail.indexOf('  async function syncGmail('), gmail.indexOf('  // perf: debounce visibility')), context);
const addEmail = (id, body, extra = {}) => {
  liveIds = [id];
  messages.set(id, { payload: { body, headers: [
    { name: 'From', value: extra.from || client.email }, { name: 'To', value: 'me@example.com' },
    { name: 'Subject', value: 'Campaign update' }, { name: 'Date', value: new Date().toISOString() },
    ...(extra.headers || [])
  ] }, labelIds: extra.labelIds || ['INBOX'] });
};
(async () => {
  // The browser delegates meaning to the authenticated AI endpoint; it does not
  // gate messages using a list of request words.
  const originalScan = context.clientEmailTaskScanKey({ subject: 'Update', body: 'Thanks' }, [client]);
  assert.notEqual(context.clientEmailTaskScanKey({ subject: 'Update', body: 'Upload content to Facebook' }, [client]), originalScan);

  // Full silent sync: a client modal must appear even alongside an application closure.
  addEmail('work', 'Please prepare the weekly campaign report.');
  await context.syncGmail(true);
  assert.equal(context.data.clientTasks.length, 1);
  const task = context.data.clientTasks[0];
  assert.equal(classificationCalls, 1);
  assert.equal(task.automaticallyCreated, true);
  assert.equal(task.sourceEmailId, 'gmail-work');
  assert.equal(task.clientId, client.id);
  assert.equal(task.repeat.frequency, 'none');
  assert.equal(task.dueDate, '', 'never invent a deadline');
  assert.ok(task.createdAt);
  const modal = notices.find(notice => notice.label === 'CLIENT EMAIL ALERT');
  assert.ok(modal, 'background sync must show the client email modal');
  assert.match(modal.title, /Jordan sent you an email/);
  assert.match(modal.message, /created automatically/);
  assert.equal(modal.details[0].taskCreated, true);
  assert.ok(notices.some(notice => notice.title === 'Application closed'), 'both notices must be delivered');
  assert.equal(context.data.alerts[0].taskId, task.id);
  assert.equal(client.interviewPriority, undefined);
  notices = [];
  closed = false;
  await context.syncGmail(true);
  assert.equal(context.data.clientTasks.length, 1, 'repeat sync must not create duplicate tasks');
  assert.equal(classificationCalls, 1, 'unchanged messages must reuse their saved AI analysis');
  assert.equal(notices.length, 0, 'repeat sync must not repeat the modal');

  // Recheck older saved mail, including messages rejected by the previous rules.
  const earlierEmail = { id: 'earlier', gmailId: 'earlier', from: client.email,
    subject: 'Upload content', body: 'Upload content in ig and facebook today place',
    date: new Date(Date.now() - 3600000).toISOString(), direction: 'received', bodyLoaded: true,
    autoTaskPending: false, autoTaskProcessedAt: new Date().toISOString() };
  context.data.emails.push(earlierEmail);
  await context.syncGmail(true);
  assert.equal(context.data.clientTasks.length, 2, 'previously imported and processed mail must be rescanned under the new rules');
  assert.ok(context.data.clientTasks.some(task => task.sourceEmailId === 'earlier'));
  assert.ok(notices.some(notice => notice.label === 'EMAIL TO TASK'), 'historical task creation needs its own notification');
  assert.ok(earlierEmail.autoTaskScanKey.startsWith('ai-v2:'));
  notices = [];
  await context.syncGmail(true);
  assert.equal(context.data.clientTasks.length, 2, 'rescans must not duplicate tasks');
  assert.equal(notices.length, 0);
  context.data.clientTasks = context.data.clientTasks.filter(task => task.sourceEmailId !== 'earlier');
  await context.syncGmail(true);
  assert.equal(context.data.clientTasks.length, 1, 'deleting a processed task must not recreate it every sync');

  addEmail('thanks', 'Thanks for your help!\nOn Monday Jordan wrote:\nPlease update our homepage.');
  await context.syncGmail(true);
  assert.equal(context.data.clientTasks.length, 1);
  assert.ok(notices.some(notice => /sent you an email/.test(notice.title)), 'ordinary client replies still deserve a modal');
  addEmail('newsletter', 'Please review our new offers.', { headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsubscribe>' }] });
  await context.syncGmail(true);
  assert.equal(context.data.clientTasks.length, 1, 'newsletters must not create tasks');
  addEmail('sent', 'Please prepare the campaign.', { from: 'me@example.com', labelIds: ['SENT'] });
  await context.syncGmail(true);
  assert.equal(context.data.clientTasks.length, 1, 'outgoing mail cannot create client tasks');

  // Fail, retry, and ensure only one task survives.
  addEmail('retry', 'Please draft our social media calendar.');
  saving = false;
  await context.syncGmail(true);
  assert.equal(context.data.clientTasks.length, 1);
  assert.equal(context.data.emails.find(email => email.gmailId === 'retry').autoTaskPending, true);
  saving = true;
  await context.syncGmail(true);
  assert.equal(context.data.clientTasks.length, 2);
  assert.equal(context.data.emails.find(email => email.gmailId === 'retry').autoTaskPending, false);
  await context.syncGmail(true);
  assert.equal(context.data.clientTasks.length, 2);

  addEmail('history', 'Please prepare the old campaign.');
  liveIds = [];
  historyIds = [...Array(30).fill('already-listed'), 'history'];
  context.inboxHistoryLoaded = false;
  context.inboxHistoryPageToken = '';
  await context.syncGmail(true);
  assert.equal(context.data.clientTasks.length, 3, 'older inbox pages must also be checked for client work requests');
  assert.ok(context.data.clientTasks.some(task => task.sourceGmailId === 'history'));
  context.data.clientTasks = context.data.clientTasks.filter(task => task.sourceGmailId !== 'history');
  historyIds = [];

  context.data.clientTasks.push({ id: 'manual-task', clientId: client.id, sourceGmailId: 'manual' });
  addEmail('manual', 'Please prepare a campaign.');
  await context.syncGmail(true);
  assert.equal(context.data.clientTasks.length, 3, 'a manually created email task must not be recreated automatically');
  context.data.clientTasks = context.data.clientTasks.filter(task => task.id !== 'manual-task');
  addEmail('unknown', 'Please create a video.', { from: 'stranger@example.com' });
  await context.syncGmail(true);
  assert.equal(context.data.clientTasks.length, 2, 'unknown senders must not receive automatic tasks');
  client.status = 'Applied';
  addEmail('prospect', 'Please send your portfolio.');
  await context.syncGmail(true);
  assert.equal(context.data.clientTasks.length, 2, 'applications are excluded from task automation');
  client.status = 'Active client';

  client.contractStatus = 'Contract Ended';
  addEmail('ended', 'Please publish the new campaign.');
  await context.syncGmail(true);
  assert.equal(context.data.clientTasks.length, 2, 'ended clients must not receive automatic tasks');
  client.contractStatus = 'Active';
  context.data.applications.push({ ...client, id: 'second-client' });
  addEmail('ambiguous', 'Please review the campaign.');
  await context.syncGmail(true);
  assert.equal(context.data.clientTasks.length, 2, 'shared sender must require a manual client choice');
  context.data.applications.pop();
  // Leave previously ambiguous/prospect mail out of these isolated scenarios.
  context.data.emails = [];
  const beforePurposes = context.data.clientTasks.length;
  purposeOverride = 'administrative';
  addEmail('billing', 'Please send your invoice.');
  await context.syncGmail(true);
  assert.equal(context.data.clientTasks.length, beforePurposes, 'AI administrative decisions must never create a task');
  purposeOverride = 'uncertain';
  addEmail('unclear', 'Can you handle that?');
  await context.syncGmail(true);
  assert.equal(context.data.clientTasks.length, beforePurposes);
  assert.ok(context.data.alerts.some(alert => alert.type === 'active-client-email-review'));
  assert.ok(notices.some(notice => notice.label === 'EMAIL REVIEW'));
  purposeOverride = 'work_task';
  addEmail('indirect', 'The launch is tomorrow and our Instagram feed is empty. It needs attention before noon.');
  await context.syncGmail(true);
  assert.equal(context.data.clientTasks.length, beforePurposes + 1, 'a role-related AI decision must not require request keywords');
  addEmail('quota', 'Please upload new content.');
  providerStatus = 429;
  await context.syncGmail(true);
  assert.equal(context.data.clientTasks.length, beforePurposes + 1, 'provider failure must not fall back to keyword-created tasks');
  const stoppedCalls = classificationCalls;
  await context.syncGmail(true);
  assert.equal(classificationCalls, stoppedCalls, 'backoff must prevent repeated provider requests');
  localValues.delete('email-task-ai-retry-v3:u1');
  providerStatus = 200;
  await context.syncGmail(true);
  assert.equal(context.data.clientTasks.length, beforePurposes + 2, 'queued work must resume when AI becomes available');
  for (let index = 0; index < 5; index++) context.data.emails.push({
    id: `queued-${index}`, from: client.email, subject: 'Content request', body: 'New client deliverable',
    date: new Date().toISOString(), direction: 'received', bodyLoaded: true
  });
  const batchCalls = classificationCalls;
  await context.syncGmail(true);
  assert.equal(classificationCalls - batchCalls, 5, 'one sync must continue through the entire eligible queue');
  await context.syncGmail(true);
  assert.equal(classificationCalls - batchCalls, 5);
  const oldWeekEmail = { id: 'last-week', from: client.email, subject: 'Old request', body: 'Please upload content.',
    date: new Date(context.emailAiWeekRange().start - 1000).toISOString(), bodyLoaded: true, autoTaskPending: true };
  context.data.emails.push(oldWeekEmail);
  const weeklyCalls = classificationCalls, weeklyTasks = context.data.clientTasks.length;
  await context.syncGmail(true);
  assert.equal(classificationCalls, weeklyCalls, 'previous-week pending messages must not use an AI request');
  assert.equal(context.data.clientTasks.length, weeklyTasks);
  assert.equal(oldWeekEmail.autoTaskProcessedAt, undefined, 'older emails stay unchanged and visible');
  context.data.emailTaskAiUsage = { day: new Date().toISOString().slice(0, 10), requests: 40 };
  addEmail('daily-cap', 'Please upload new content.');
  const cappedCalls = classificationCalls;
  await context.syncGmail(true);
  assert.equal(classificationCalls, cappedCalls, 'daily app cap must queue additional analysis without contacting the provider');
  console.log('Automatic email task integration passed: fresh work requests, quoted history, bulk/outgoing mail, active-only matching, ambiguity, saved task metadata, deduplication, retry and client modals alongside closure notices.');
})().catch(error => { console.error(error); process.exitCode = 1; });
