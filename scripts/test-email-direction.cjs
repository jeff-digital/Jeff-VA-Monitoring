const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { readModules, moduleGroups } = require('./lib/read-modules.cjs');
const read = name => moduleGroups[name] ? readModules(moduleGroups[name]) : fs.readFileSync(path.join(__dirname, '../src/frontend/js/modules', name), 'utf8');
function fn(source, name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  const rest = source.slice(start);
  const end = rest.indexOf('\n  function ', 12);
  return end < 0 ? rest : rest.slice(0, end);
}
const app = { id: 'client', email: 'client@example.com' };
const context = vm.createContext({ currentUser: { email: 'me@example.com', identities: [{ identity_data: { email: 'alias@example.com' } }] },
  data: { applications: [app], emails: [], deletedGmailIds: [] },
  applicationEmailMatchesCache: new WeakMap(),
  buildApplicationMatchIndex: () => [{ application: app, email: app.email, role: '', clientName: '', contact: '' }],
  platformKeyForName: () => '', platformNameForSender: () => '',
  normalizeApplicationMatchEvidence: value => value || '', emailExplicitlyNamesDifferentRole: () => false,
  applicationLinkTokens: () => [], PLATFORM_SENDER_EMAIL_SET: new Set(['support@onlinejobs.ph']),
  isActiveContract: item => item.status === 'Active client' && item.contractStatus !== 'Contract Ended' });
const core = read('01-core.js');
const matcher = read('02-email-matching.js');
vm.runInContext(fn(read('02a-email-match-rules.js'), 'applicationEmployerEvidenceText'), context);
for (const name of ['extractEmailAddress', 'isEmailAddress', 'extractSenderName', 'containsWholeWord', 'isDirectClientApplication']) vm.runInContext(fn(matcher, name), context);
for (const name of ['isSentEmail', 'receivedEmails', 'manualApplicationStatusTimestamp']) vm.runInContext(fn(core, name), context);
const stageTime = '2026-10-21T12:00:00Z';
assert.equal(context.manualApplicationStatusTimestamp({ status: 'Applied', notes: 'Edited notes' }, 'Applied', stageTime), '');
assert.equal(context.manualApplicationStatusTimestamp({ status: 'Applied' }, 'Interview', stageTime), stageTime);
assert.equal(context.manualApplicationStatusTimestamp({ status: 'Interview', manualStatusChangedAt: stageTime }, 'Interview', 'later'), stageTime);
assert.equal(context.manualApplicationStatusTimestamp(undefined, 'Applied', stageTime), '');
for (const name of ['isEmailTaskActiveClient', 'activeClientsMatchingSender', 'activeClientsForTaskEmail', 'matchApplicationsForEmail', 'applicationsRelatedToEmail']) vm.runInContext(fn(matcher, name), context);
const outgoing = [
  { from: app.email, to: app.email, direction: 'sent' },
  { from: app.email, to: app.email, source: 'sent' },
  { from: app.email, to: app.email, labelIds: ['INBOX', 'SENT'] },
  { from: 'Me <me@example.com>', to: app.email, direction: 'received' },
  { from: 'Alias <alias@example.com>', to: app.email }
];
for (const email of outgoing) {
  context.applicationEmailMatchesCache.set(email, [app]);
  assert.equal(context.matchApplicationsForEmail(email).length, 0, 'sent mail cannot count as a client response even when cached');
  assert.equal(context.applicationsRelatedToEmail(email).length, 0, 'sent mail has no application matches, even with a saved recipient');
  assert.equal(context.applicationsRelatedToEmail({ ...email, applicationId: app.id }).length, 0, 'saved application links must not turn outgoing mail into a match');
}
const incoming = { from: 'Client <client@example.com>', to: 'me@example.com', direction: 'received' };
assert.equal(context.matchApplicationsForEmail(incoming)[0].id, app.id, 'real received reply must still match');
context.data.emails = [...outgoing, incoming];
assert.equal(context.receivedEmails().length, 1, 'received count must exclude sent, self-sent, and legacy outgoing mail');
assert.equal(context.receivedEmails()[0], incoming);
app.status = 'Active client';
context.emailExplicitlyNamesDifferentRole = () => true;
const workEmail = { from: app.email, subject: 'Website updates for the graphic designer', body: 'Let’s have a meeting.' };
assert.equal(context.matchApplicationsForEmail(workEmail)[0].id, app.id, 'active client work emails must not require the original application role');
assert.equal(context.activeClientsForTaskEmail(workEmail).length, 1);
const second = { ...app, id: 'client-2' };
context.data.applications.push(second);
assert.equal(context.activeClientsForTaskEmail(workEmail).length, 2, 'shared sender must preserve both choices rather than guess a task client');
second.contractStatus = 'Contract Ended';
assert.equal(context.activeClientsForTaskEmail(workEmail).length, 1, 'ended clients cannot receive tasks');
app.activePendingEmail = true;
assert.equal(context.isEmailTaskActiveClient(app), false);
app.activePendingEmail = false;
assert.equal(context.activeClientsForTaskEmail({ ...workEmail, direction: 'sent' }).length, 0);
assert.equal(context.activeClientsMatchingSender({ from: 'support@onlinejobs.ph' }).length, 0, 'shared platform sender must not bypass role disambiguation');
assert.equal(context.activeClientsForTaskEmail(undefined).length, 0);
// Exercise both inbox tabs with the actual renderer: Sent remains visible but
// has no matching badges, including previously linked and unlinked messages.
const nodes = new Map();
const node = key => {
  if (!nodes.has(key)) nodes.set(key, { value: '', textContent: '', innerHTML: '', dataset: {}, showModal() {} });
  return nodes.get(key);
};
Object.assign(context, { $: node, $$: () => [], renderGmailSyncStatus() {}, renderEmailTaskAiStatus() {},
  emailDateSort: 'all', emailDateFilter: '', emailViewFilter: 'sent', emailSelectionMode: false,
  emailWeekOptions: () => '', sortByDate: items => items, escapeHtml: value => String(value || ''),
  emailContentText: value => String(value || ''), emailDate: value => value || '', emailTime: () => '',
  dateKey: value => value, weeklyRangeLabel: () => '', weekRange: () => null });
const linkedSent = { id: 'linked-sent', from: 'me@example.com', to: app.email, direction: 'sent', applicationId: app.id,
  subject: 'My follow up', body: 'Hello', applicationAiAnalysis: { outcome: 'rejected', reason: 'Stale analysis' } };
const unlinkedSent = { id: 'unlinked-sent', from: 'me@example.com', to: 'stranger@example.com', direction: 'sent', subject: 'My email', body: 'Hi' };
const received = { ...incoming, id: 'received', subject: 'Client reply', body: 'Thanks' };
context.data.emails = [linkedSent, unlinkedSent, received];
vm.runInContext(fn(matcher, 'renderEmails'), context);
context.renderEmails();
assert.equal(node('#emailSentCount').textContent, 2);
assert.equal(node('#emailReceivedCount').textContent, 1);
assert.match(node('#emailList').innerHTML, /data-email-detail="linked-sent"/);
assert.match(node('#emailList').innerHTML, /data-email-detail="unlinked-sent"/);
assert.ok(!node('#emailList').innerHTML.includes('client-match-tag'), 'Sent must not render an application-match badge');
context.emailViewFilter = 'client'; context.renderEmails();
assert.match(node('#emailList').innerHTML, /data-email-detail="received"/);
assert.match(node('#emailList').innerHTML, /client-match-tag/);
assert.ok(!node('#emailList').innerHTML.includes('linked-sent'));
vm.runInContext(fn(read('04-gmail.js'), 'openEmailDetail'), context);
context.openEmailDetail(linkedSent.id);
assert.equal(node('#emailDetailAiStatus').hidden, true, 'Sent details must not display stale AI analysis');
assert.equal(node('#emailDetailAiStatus').textContent, '');
context.isEmailInAiWeek = () => true; context.emailAiRetryState = () => null;
context.emailExplicitlyNamesDifferentRole = () => false;
vm.runInContext(read('04a-email-outcomes.js'), context);
app.status = 'Applied'; app.appliedDate = new Date(Date.now() - 86400000).toISOString();
app.manualStatusChangedAt = new Date().toISOString(); received.date = new Date(Date.now() - 3600000).toISOString();
context.openEmailDetail(received.id);
assert.equal(node('#emailDetailAiStatus').hidden, false);
assert.match(node('#emailDetailAiStatus').textContent, /manually changed/);
delete app.manualStatusChangedAt;
context.openEmailDetail(received.id);
assert.match(node('#emailDetailAiStatus').textContent, /waiting for AI analysis/);
received.applicationAiAnalysis = { applicationId: app.id, outcome: 'position_filled', rejectApplication: true,
  reason: 'The role has been filled.', evidence: 'The role has been filled.' };
context.openEmailDetail(received.id);
assert.match(node('#emailDetailAiStatus').textContent, /automatic status update pending/);
app.status = 'Not selected'; app.emailClosure = { emailId: received.id, emailRecordId: received.id };
context.openEmailDetail(received.id);
assert.match(node('#emailDetailAiStatus').textContent, /Automatically marked Rejected/);
const unmatched = { id: 'unknown', from: 'unknown@example.com', body: 'An unmatched email', date: new Date().toISOString() };
context.data.emails.push(unmatched); context.openEmailDetail(unmatched.id);
assert.match(node('#emailDetailAiStatus').textContent, /no saved application or active client is matched/);
console.log('Email direction checks passed: outgoing exclusion, cached matches, Gmail labels, own addresses, linked sent messages excluded, and real received replies.');
