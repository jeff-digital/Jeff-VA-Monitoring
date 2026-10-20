const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '../src/frontend/js/modules', name), 'utf8');
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
for (const name of ['extractEmailAddress', 'isEmailAddress', 'extractSenderName', 'containsWholeWord']) vm.runInContext(fn(matcher, name), context);
for (const name of ['isSentEmail', 'receivedEmails']) vm.runInContext(fn(core, name), context);
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
  assert.equal(context.applicationsRelatedToEmail(email)[0].id, app.id, 'sent mail remains linked by recipient for sent history');
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
console.log('Email direction checks passed: outgoing exclusion, cached matches, Gmail labels, own addresses, recipient linking, and real received replies.');
