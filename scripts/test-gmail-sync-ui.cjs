const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '../src/frontend/js/modules', name), 'utf8');
const nodes = new Map();
const storage = new Map();
const node = id => {
  if (!nodes.has(id)) nodes.set(id, { dataset: {}, textContent: '', hidden: false });
  return nodes.get(id);
};
const context = vm.createContext({ $: node, currentUser: { id: 'u1' }, navigator: { onLine: true },
  gmailAccessToken: null, gmailReconnectRequired: false, readGmailCredentials: () => null,
  gmailConfigured: () => true, loginWithGoogle() {},
  localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } });
const source = read('04-gmail.js');
vm.runInContext(source.slice(source.indexOf('  let gmailSyncDisplay ='), source.indexOf('  function setGmailStatus(')), context);
context.renderGmailSyncStatus();
assert.equal(node('#gmailSyncSummary').dataset.state, 'permission');
assert.equal(node('#gmailSyncConnectButton').hidden, false);
context.gmailAccessToken = 'access';
context.setGmailSyncDisplay('syncing');
assert.match(node('#gmailSyncStatusText').textContent, /Gmail syncing/);
assert.equal(storage.size, 0, 'starting a sync must not claim it succeeded');
context.recordGmailSyncSuccess();
assert.equal(node('#gmailSyncStatusText').textContent, 'Gmail synced');
assert.equal(node('#accountGmailStatus').textContent, 'Connected');
assert.match(node('#accountGmailSyncDetails').textContent, /Gmail synced.*Last synced/);
assert.match(node('#gmailSyncSummary').title, /Last synced/);
assert.equal(node('#gmailSyncTime').hidden, false);
assert.equal(node('#gmailSyncTime').dateTime, storage.get(context.gmailLastSyncKey()));
assert.equal(storage.size, 1);
const successfulTime = storage.get(context.gmailLastSyncKey());
context.setGmailSyncDisplay('partial');
assert.equal(storage.get(context.gmailLastSyncKey()), successfulTime, 'partial sync must retain previous success timestamp');
context.setGmailSyncDisplay('paused');
assert.match(node('#gmailSyncSummary').title, /retrying automatically/);
context.navigator.onLine = false;
context.renderGmailSyncStatus();
assert.equal(node('#gmailSyncSummary').dataset.state, 'offline');
assert.equal(node('#accountGmailStatus').textContent, 'Offline');
context.navigator.onLine = true;
context.gmailReconnectRequired = true;
context.renderGmailSyncStatus();
assert.equal(node('#gmailSyncSummary').dataset.state, 'permission');
assert.equal(node('#accountGmailStatus').textContent, 'Permission required');
context.currentUser = { id: 'u2' };
context.renderGmailSyncStatus();
assert.match(node('#gmailSyncSummary').title, /No successful sync yet/);
assert.equal(node('#gmailSyncTime').hidden, true);
context.currentUser = null;
context.renderGmailSyncStatus();
assert.equal(node('#gmailSyncSummary').hidden, true);

// Exercise the real notification generator with an active-client work email.
const documents = read('03-documents.js');
const alertsContext = vm.createContext({
  data: { alerts: [] }, matchApplicationsForEmail: () => [alertsContext.client],
  client: { id: 'active', clientName: 'Acme', status: 'Active client' },
  isEmailTaskActiveClient: app => app.status === 'Active client',
  isInterviewEmail: () => true, interviewDateFromEmail: () => '', limitAlertHistory() {},
  persist() {}, renderAlerts() {}, plural: (count, word) => `${count} ${word}`,
  showActionResult: value => { alertsContext.notice = value; },
  showView: value => { alertsContext.view = value; }, openEmailDetail: value => { alertsContext.opened = value; }
});
vm.runInContext(documents.slice(documents.indexOf('  function alertNewMatches('), documents.indexOf('  const generatedNotificationTypes')), alertsContext);
const email = { id: 'e1', gmailId: 'g1', from: 'client@example.com', subject: 'Campaign meeting tomorrow' };
assert.equal(alertsContext.alertNewMatches([email]), true);
assert.equal(alertsContext.data.alerts[0].type, 'active-client-email');
assert.equal(alertsContext.data.alerts[0].emailId, 'e1');
assert.equal(alertsContext.data.alerts[0].applicationId, 'active');
assert.equal(alertsContext.client.interviewPriority, undefined, 'work meetings must not mark an active client as a job interview');
assert.equal(alertsContext.data.alerts[0].subject, email.subject);
alertsContext.notice.onAction();
assert.equal(alertsContext.view, 'inbox');
assert.equal(alertsContext.opened, 'e1');
assert.equal(alertsContext.alertNewMatches([email]), false, 'repeated sync must not repeat the notification');
assert.equal(alertsContext.data.alerts.length, 1);
console.log('Gmail status and notification checks passed: sync states, accurate timestamps, account isolation, active-client alerts, direct email navigation and deduplication.');
