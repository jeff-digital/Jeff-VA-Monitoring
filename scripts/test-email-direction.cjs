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
  applicationLinkTokens: () => [] });
const core = read('01-core.js');
const matcher = read('02-email-matching.js');
for (const name of ['extractEmailAddress', 'isEmailAddress', 'extractSenderName', 'containsWholeWord']) vm.runInContext(fn(matcher, name), context);
for (const name of ['isSentEmail', 'receivedEmails']) vm.runInContext(fn(core, name), context);
for (const name of ['matchApplicationsForEmail', 'applicationsRelatedToEmail']) vm.runInContext(fn(matcher, name), context);
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
console.log('Email direction checks passed: outgoing exclusion, cached matches, Gmail labels, own addresses, recipient linking, and real received replies.');
