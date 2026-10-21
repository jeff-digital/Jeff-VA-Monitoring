const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const nodes = new Map();
const $ = key => {
  if (!nodes.has(key)) nodes.set(key, { value: '', dataset: {}, hidden: false, open: false, innerHTML: '',
    addEventListener(type, handler) { this[type] = handler; }, setAttribute() {}, reset() {}, focus() {},
    showModal() { this.open = true; }, close() { this.open = false; }, reportValidity() { return true; } });
  return nodes.get(key);
};
let saveResult = true, renderCount = 0;
const context = vm.createContext({ $, Intl, Date, URL, console,
  data: { subscriptions: [], alerts: [] }, currentUser: { id: 'owner' },
  uid: () => 'sub-1', persist: async () => saveResult, renderAll: () => renderCount++, toast() {},
  appConfirm: async () => true, formatDate: value => value,
  plural: (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`, escapeHtml: value => String(value).replaceAll('<', '&lt;') });
vm.runInContext(read('src/frontend/js/modules/pages/17-subscriptions-page.js'), context);
const run = code => vm.runInContext(code, context);
assert.equal(run("subscriptionStatus({expiryDate:'2026-10-30'}, '2026-10-22').key"), 'active');
assert.equal(run("subscriptionStatus({expiryDate:'2026-10-29'}, '2026-10-22').key"), 'soon');
assert.equal(run("subscriptionStatus({expiryDate:'2026-10-22'}, '2026-10-22').label"), 'Expires today');
assert.equal(run("subscriptionStatus({expiryDate:'2026-10-21'}, '2026-10-22').key"), 'expired');
assert.equal(run("subscriptionStatus({expiryDate:'2026-10-21',tracking:'cancelled'}, '2026-10-22').key"), 'cancelled');
assert.equal(run("subscriptionStatus(null).key"), 'date-needed');
assert.equal(run("subscriptionNextDate({expiryDate:'2028-01-31',cycle:'monthly'}, '2028-01-01')"), '2028-02-29');
assert.equal(run("subscriptionNextDate({expiryDate:'2028-02-29',cycle:'yearly'}, '2028-01-01')"), '2029-02-28');
assert.equal(run("subscriptionNextDate({expiryDate:'2026-01-01',cycle:'monthly'}, '2026-10-22')"), '2026-11-22');
assert.equal(run("subscriptionNextDate({cycle:'custom'})"), '');
assert.equal(run("Number.isNaN(subscriptionDateValue('2026-02-30'))"), true);
for (const url of ['javascript:alert(1)', 'https://user:password@example.com', 'data:text/html,test', 'file:///etc/passwd']) {
  context.testURL = url; assert.equal(run('subscriptionWebsite(testURL)'), null);
}
assert.equal(run("subscriptionWebsite('canva.com/billing')"), 'https://canva.com/billing');
context.draft = { name: 'Canva', account: 'me@example.com', cost: '12.50', currency: 'USD', cycle: 'monthly', expiryDate: '2026-11-22', decision: 'undecided', tracking: 'active' };
assert.equal(run('validateSubscriptionDraft(draft).value.cents'), 1250);
for (const cost of ['0', '-1', '1.001', 'Infinity']) {
  context.badCost = cost; assert.ok(run('validateSubscriptionDraft({...draft,cost:badCost}).error'));
}
assert.ok(run("validateSubscriptionDraft(draft,[{...draft,id:'existing',name:' CANVA '}]).error"));
assert.ok(run("validateSubscriptionDraft(draft,[{...draft,id:'existing'}],'existing').value"));
assert.ok(run("validateSubscriptionDraft(draft,[{...draft,id:'existing',account:'other@example.com'}]).value"));
function fill(input) {
  for (const [key, value] of Object.entries(input)) {
    const field = key === 'expiryDate' ? 'Expiry' : key[0].toUpperCase() + key.slice(1);
    $('#subscription' + field).value = value;
  }
}
async function submit() { await $('#subscriptionForm').submit({ preventDefault() {}, currentTarget: $('#subscriptionForm') }); }
(async () => {
  context.data.subscriptions = [];
  run('openSubscriptionEditor()'); fill(context.draft);
  $('#subscriptionId').value = ''; $('#subscriptionWebsite').value = ''; $('#subscriptionPlan').value = ''; $('#subscriptionNotes').value = '';
  await submit();
  assert.equal(context.data.subscriptions.length, 1); assert.equal(context.data.subscriptions[0].cents, 1250);
  assert.ok(context.data.subscriptions[0].createdAt); assert.equal($('#subscriptionEditor').open, false);
  run("openSubscriptionEditor('sub-1')"); $('#subscriptionCost').value = '20'; saveResult = false;
  await submit(); assert.equal(context.data.subscriptions[0].cents, 1250); assert.equal($('#subscriptionEditor').open, true);
  assert.equal($('#subscriptionFormError').hidden, false);
  saveResult = true; await submit(); assert.equal(context.data.subscriptions[0].cents, 2000);
  run("openSubscriptionEditor('sub-1')");
  assert.equal($('#subscriptionPanelActions').hidden, false);
  await $('#subscriptionRecordRenewal').click();
  assert.equal($('#subscriptionForm').dataset.mode, 'renewal');
  assert.equal($('#subscriptionPanelActions').hidden, true);
  $('#subscriptionExpiry').value = '2030-01-01'; await submit();
  assert.equal(context.data.subscriptions[0].expiryDate, '2030-01-01'); assert.ok(context.data.subscriptions[0].lastRenewedAt);
  run("openSubscriptionEditor('sub-1')"); saveResult = false; await $('#deleteSubscription').click();
  assert.equal(context.data.subscriptions.length, 1);
  saveResult = true; await $('#deleteSubscription').click(); assert.equal(context.data.subscriptions.length, 0);
  run('openSubscriptionEditor()'); fill(context.draft); context.currentUser = { id: 'other' }; await submit();
  assert.equal(context.data.subscriptions.length, 0, 'Old account form cannot write into another account');
  assert.ok(renderCount >= 4);
  // Exercise generated alerts, deduplication, and clearing after a renewal/cancellation.
  const notifications = read('src/frontend/js/modules/03-documents.js');
  const start = notifications.indexOf('  const generatedNotificationTypes');
  const end = notifications.indexOf('  function visibleNotificationAlerts', start);
  Object.assign(context, { dataReady: true, supabaseDataLoaded: true, today: () => '2026-10-22', dateKey: value => value });
  vm.runInContext(notifications.slice(start, end), context);
  run("subscriptionToday = () => '2026-10-22'");
  context.data = { subscriptions: [
    { id: 'soon', name: 'Soon', expiryDate: '2026-10-29' },
    { id: 'today', name: 'Today', expiryDate: '2026-10-22' },
    { id: 'expired', name: 'Expired', expiryDate: '2026-10-21' },
    { id: 'future', expiryDate: '2026-11-01' },
    { id: 'cancelled', expiryDate: '2026-10-21', tracking: 'cancelled' }, null ], alerts: [] };
  run('refreshGeneratedNotifications()'); assert.equal(context.data.alerts.length, 3);
  assert.deepEqual(Array.from(context.data.alerts, item => item.type).sort(), ['subscription-due-soon', 'subscription-due-today', 'subscription-expired']);
  context.data.alerts[0].unread = false; run('refreshGeneratedNotifications()');
  assert.equal(context.data.alerts.length, 3); assert.equal(context.data.alerts[0].unread, false);
  context.data.subscriptions[0].expiryDate = '2026-12-01';
  context.data.subscriptions[1].tracking = 'cancelled';
  context.data.subscriptions = context.data.subscriptions.filter(item => item?.id !== 'expired');
  run('refreshGeneratedNotifications()'); assert.equal(context.data.alerts.length, 0);
  console.log('Subscription dates, validation, save/rollback, renewal, delete, account isolation, and expiry reminders passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
