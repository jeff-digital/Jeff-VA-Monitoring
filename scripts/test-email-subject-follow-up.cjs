const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { readModules, moduleGroups } = require('./lib/read-modules.cjs');
const read = name => moduleGroups[name] ? readModules(moduleGroups[name]) : fs.readFileSync(path.join(__dirname, '../src/frontend/js/modules', name), 'utf8');
const matching = read('02-email-matching.js');
const nodes = new Map();
const noop = () => {};
const context = vm.createContext({
  Date: class extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-23T01:00:00Z'])); } },
  console: { error: noop },
  $: selector => {
    if (!nodes.has(selector)) nodes.set(selector, { value: '', innerHTML: '', textContent: '' });
    return nodes.get(selector);
  },
  $$: () => [],
  today: () => '2026-10-23',
  dateKey: value => String(value || '').slice(0, 10),
  emailDate: value => value,
  escapeHtml: value => String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
  data: { applications: [], emails: [], alerts: [] },
  emailDateSort: 'all', emailDateFilter: '', emailViewFilter: 'client', emailSelectionMode: false,
  renderGmailSyncStatus: noop, renderEmailTaskAiStatus: noop, emailWeekOptions: () => '',
  receivedEmails: () => context.data.emails.filter(item => item.direction !== 'sent'),
  isSentEmail: item => item.direction === 'sent', sortByDate: items => items,
  applicationsRelatedToEmail: () => [], platformNameForSender: sender => sender.includes('indeed') ? 'Indeed' : '',
  emailContentText: value => String(value || ''), extractEmailAddress: value => value,
  isEmailAddress: value => value.includes('@'), emailTime: () => '8:00 AM',
  gmailAccessToken: 'test-token', editingId: '', activeView: 'applications',
  currentUser: { id: 'test-user' },
  sendAutomaticFollowUpOnce: async () => {
    await context.sendGmailRaw();
    return { sentAt: new Date().toISOString(), gmailId: 'gmail-confirmed' };
  },
  buildDocumentEmailTemplate: () => ({ subject: 'Follow-up', body: 'Following up.' }),
  buildRawEmailMessage: value => value, uid: () => 'sent-follow-up',
  limitAlertHistory: noop, persist: noop, renderApplications: noop, renderAlerts: noop,
  showActionResult: noop, plural: (count, word) => `${count} ${word}`
});
vm.runInContext(read('02ac-follow-up-calendar.js'),context);
vm.runInContext(matching.slice(matching.indexOf('  function confirmedApplicationFollowUpSentAt('), matching.indexOf('  function renderApplications(')), context);
vm.runInContext(matching.slice(matching.indexOf('  function renderEmails('), matching.indexOf('  function hiredClients(')), context);
const documents = read('03-documents.js');
vm.runInContext(documents.slice(documents.indexOf('  async function processDueFollowUps('), documents.indexOf('  function markAlertsRead(')), context);

const due = { id: 'app', followUpDate: '2026-10-23', status: 'Applied', email: 'client@example.com', automaticFollowUp: true };
assert.equal(context.applicationFollowUpState(due), 'due');
assert.match(context.applicationFollowUpMarkup(due), /Due today/);
assert.equal(context.applicationFollowUpState({ ...due, followUpProcessedAt: '2026-10-23T08:00:00Z' }), 'due', 'A processed reminder does not prove successful sending');
for (const date of ['', '2026-10-22', '2026-10-24']) assert.equal(context.applicationFollowUpState({ ...due, followUpDate: date }), '');
for (const status of ['Active client', 'Not selected']) assert.equal(context.applicationFollowUpState({ ...due, status }), '');
assert.equal(context.applicationFollowUpState({ ...due, followUpDate: '2026-10-24', followUpSentAt: '2026-10-22T08:00:00Z' }), '', 'Earlier follow-up cannot mark a new schedule sent');

for (const from of ['alerts@indeed.com', 'client@example.com']) {
  context.data.emails = [{ id: 'email', from, subject: 'Interview <invitation>', body: 'Please reply.', date: '2026-10-23' }];
  context.renderEmails();
  assert.match(nodes.get('#emailList').innerHTML, /class="email-subject">Interview &lt;invitation>/, 'Both platform and direct emails display escaped subjects');
}
context.data.emails[0].subject = '';
context.renderEmails();
assert.match(nodes.get('#emailList').innerHTML, /\(No subject\)/);

const sentFollowUp = { id: 'manual', applicationId: due.id, direction: 'sent', to: due.email, subject: 'Follow-up: Acme', date: '2026-10-23T08:00:00Z' };
context.data.applications = [due];
context.data.emails = [sentFollowUp];
assert.equal(context.applicationFollowUpState(due), 'sent', 'Saved sent follow-up completes the indicator without followUpSentAt');
assert.match(context.applicationFollowUpMarkup(due), /follow-up-check/);
assert.doesNotMatch(context.applicationFollowUpMarkup(due), /Due today/);
for (const extra of [
  { direction: 'received' }, { applicationId: 'another-application' },
  { date: '2026-10-22T08:00:00Z' }, { subject: 'Invoice for services' }, { date: 'invalid' }
]) {
  context.data.emails = [{ ...sentFollowUp, ...extra }];
  assert.equal(context.applicationFollowUpState(due), 'due', 'Incoming, unrelated, earlier and invalid messages cannot mark follow-up sent');
}
const named = { ...due, clientName: 'Acme' };
context.data.applications = [named];
context.data.emails = [{ ...sentFollowUp, applicationId: '', subject: 'Re: Following up on my application' }];
assert.equal(context.applicationFollowUpState(named), 'sent', 'Gmail-synced sent follow-up can match a unique recipient');
context.data.applications.push({ ...named, id: 'other', clientName: 'Other company' });
assert.equal(context.applicationFollowUpState(named), 'due', 'Shared recruiter address alone cannot complete multiple applications');
context.data.emails[0].subject = 'Follow-up: Acme';
assert.equal(context.applicationFollowUpState(named), 'sent', 'Company-specific follow-up disambiguates a shared address');
assert.equal(context.applicationFollowUpState(context.data.applications[1]), 'due');

(async () => {
  context.data.applications = [{ ...due }];
  context.data.emails = [sentFollowUp];
  let sends = 0;
  context.sendGmailRaw = async () => { sends++; };
  await context.processDueFollowUps();
  assert.equal(sends, 0, 'Automatic follow-up must not resend a confirmed sent follow-up');
  context.data.applications = [{ ...due }];
  context.data.emails = [];
  context.sendGmailRaw = async () => { throw new Error('Network failed'); };
  await context.processDueFollowUps();
  const item = context.data.applications[0];
  assert.equal(context.applicationFollowUpState(item), 'due', 'Failed Gmail send retains due highlight');
  assert.equal(context.data.alerts.find(alert => alert.id === 'follow-up|app|2026-10-23').deliveryStatus, 'retry', 'A pre-send failure automatically retries rather than requiring approval');
  assert.match(context.data.alerts.find(alert => alert.id === 'follow-up|app|2026-10-23').deliveryReason, /Network failed/);
  context.sendGmailRaw = async () => {};
  await context.processDueFollowUps();
  assert.equal(item.followUpDate, '', 'Existing successful-send cleanup is preserved');
  assert.equal(context.applicationFollowUpState(item), 'sent');
  assert.match(context.applicationFollowUpMarkup(item), /is-sent/);
  assert.match(context.applicationFollowUpMarkup(item), /✓/);
  context.data.applications = [{ ...due }];
  context.data.emails = [];
  sends = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  context.sendGmailRaw = async () => { sends++; await pending; };
  const firstRun = context.processDueFollowUps();
  const secondRun = context.processDueFollowUps();
  await Promise.resolve();
  assert.equal(sends, 1, 'Overlapping calls within a tab share one processing run');
  release();
  await Promise.all([firstRun, secondRun]);
  assert.equal(sends, 1);
  context.data.applications = [{ ...due }];
  context.data.emails = [sentFollowUp];
  context.data.alerts = [{ id: `follow-up|${due.id}|${due.followUpDate}`, subject: 'Follow-up needed', unread: false }];
  await context.processDueFollowUps();
  assert.equal(sends, 1, 'A synced manual delivery does not trigger an automatic send');
  assert.equal(context.data.alerts[0].deliveryStatus, 'sent', 'Stale due alert reconciles with sent history');
  assert.match(context.data.alerts[0].subject, /Follow-up sent:/);
  assert.match(context.applicationFollowUpMarkup(context.data.applications[0]), /✓/);
  context.data.alerts[0].unread = false;
  await context.processDueFollowUps();
  assert.equal(context.data.alerts[0].unread, false, 'Repeated checks do not rearm a completed alert');

  context.data.applications = [{ ...due }];
  context.data.emails = [];
  context.sendGmailRaw = async () => {
    context.data.applications = [{ ...due, clientName: 'Refreshed while sending' }];
  };
  await context.processDueFollowUps();
  assert.equal(context.data.applications[0].followUpDate, '', 'Delivery receipt updates the current record after realtime replacement');
  assert.ok(context.data.applications[0].followUpSentAt);
  context.data.applications = [{ ...due, followUpProcessedAt: '2026-10-23T01:00:00Z', followUpSentAt: '2026-10-22T01:00:00Z' }];
  context.data.emails = [];
  context.gmailAccessToken = null;
  context.readGmailCredentials = () => ({ refreshToken: 'saved-connection' });
  context.gmailReconnectRequired = true;
  sends = 0;
  context.sendGmailRaw = async () => { sends++; };
  await context.processDueFollowUps();
  assert.equal(sends, 0, 'A connection requiring user authorization cannot trigger background consent');
  context.gmailReconnectRequired = false;
  await context.processDueFollowUps();
  assert.equal(sends, 1, 'Saved renewable Gmail connection retries a previously processed due follow-up even without an in-memory token');
  await context.processDueFollowUps();
  assert.equal(sends, 1, 'The retry is still sent only once');
  console.log('Passed: platform subjects, missing subject, pending/failed/successful follow-ups, and rescheduling.');
})().catch(error => { console.error(error); process.exitCode = 1; });
