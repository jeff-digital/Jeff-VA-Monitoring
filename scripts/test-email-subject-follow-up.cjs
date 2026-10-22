const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '../src/frontend/js/modules', name), 'utf8');
const matching = read('02-email-matching.js');
const nodes = new Map();
const noop = () => {};
const context = vm.createContext({
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
  buildDocumentEmailTemplate: () => ({ subject: 'Follow-up', body: 'Following up.' }),
  buildRawEmailMessage: value => value, uid: () => 'sent-follow-up',
  limitAlertHistory: noop, persist: noop, renderApplications: noop, renderAlerts: noop,
  showActionResult: noop, plural: (count, word) => `${count} ${word}`
});
vm.runInContext(matching.slice(matching.indexOf('  function applicationFollowUpState('), matching.indexOf('  function renderApplications(')), context);
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

(async () => {
  context.data.applications = [{ ...due }];
  context.data.emails = [];
  context.sendGmailRaw = async () => { throw new Error('Network failed'); };
  await context.processDueFollowUps();
  const item = context.data.applications[0];
  assert.equal(context.applicationFollowUpState(item), 'due', 'Failed Gmail send retains due highlight');
  context.sendGmailRaw = async () => {};
  await context.processDueFollowUps();
  assert.equal(item.followUpDate, '', 'Existing successful-send cleanup is preserved');
  assert.equal(context.applicationFollowUpState(item), 'sent');
  assert.match(context.applicationFollowUpMarkup(item), /is-sent/);
  assert.match(context.applicationFollowUpMarkup(item), /✓/);
  console.log('Passed: platform subjects, missing subject, pending/failed/successful follow-ups, and rescheduling.');
})().catch(error => { console.error(error); process.exitCode = 1; });
