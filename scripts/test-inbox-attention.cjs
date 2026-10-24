const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readModules, moduleGroups } = require('./lib/read-modules.cjs');
const source = readModules(moduleGroups['02-email-matching.js']);
const code = source.slice(source.indexOf('  const inboxSeenEmailIds ='), source.indexOf('  function renderAll('));
const storage = new Map();
const dot = { hidden: true };
const context = vm.createContext({
  $: () => dot, currentUser: { id: 'alice' }, dataReady: false, supabaseDataLoaded: false,
  activeView: 'dashboard', emails: [{ id: 'old' }],
  receivedEmails: () => context.emails.filter(item => item.direction !== 'sent'),
  localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }
});
vm.runInContext(code, context);
context.updateInboxAttention();
assert.equal(storage.size, 0, 'Loading must not establish an empty baseline');
context.dataReady = context.supabaseDataLoaded = true;
context.updateInboxAttention();
assert.equal(dot.hidden, true, 'Existing emails are the initial baseline');
context.emails.push({ id: 'sent', direction: 'sent' });
context.updateInboxAttention();
assert.equal(dot.hidden, true, 'Sending an email does not set the dot');
context.emails.push({ id: 'new-local-id', gmailId: 'new-gmail-id' });
context.updateInboxAttention();
assert.equal(dot.hidden, false, 'New received email sets the dot');
vm.runInContext('inboxSeenEmailIds.clear()', context);
context.updateInboxAttention();
assert.equal(dot.hidden, false, 'Pending indicator survives reload via stored baseline');
context.emails[2].id = 'different-local-id';
context.updateInboxAttention();
assert.equal(dot.hidden, false, 'Gmail ID is stable across record replacements');
context.activeView = 'inbox';
context.updateInboxAttention();
assert.equal(dot.hidden, true, 'Opening inbox clears the dot');
context.emails.push({ id: 'while-open' });
context.updateInboxAttention();
assert.equal(dot.hidden, true, 'Messages arriving in an open inbox are acknowledged');
context.activeView = 'applications';
context.emails.push({ id: 'next' });
context.updateInboxAttention();
assert.equal(dot.hidden, false);
context.currentUser = { id: 'bob' };
context.updateInboxAttention();
assert.equal(dot.hidden, true, 'Accounts have separate seen baselines');
context.currentUser = { id: 'alice' };
context.updateInboxAttention();
assert.equal(dot.hidden, false, 'Switching accounts does not clear another account indicator');
context.currentUser = null;
context.updateInboxAttention();
assert.equal(dot.hidden, true, 'No indication leaks after logout');
console.log('Passed inbox dot: initial load, incoming/sent, refresh, acknowledgement, stable IDs, and account isolation.');
