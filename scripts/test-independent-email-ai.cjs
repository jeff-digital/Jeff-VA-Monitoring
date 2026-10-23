const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/frontend/js/modules/pages/10a-email-client-tasks.js'), 'utf8');
const timeouts = new Map(), intervals = new Map(), notices = [];
let timerId = 0, pending = 1, runs = 0, release, cooldown = null;
const gate = () => new Promise(resolve => { release = resolve; });
let wait = gate();
const context = vm.createContext({ console, currentUser: { id: 'user' }, dataReady: true, supabaseDataLoaded: true,
  navigator: { onLine: true }, gmailAccessToken: null, gmailSyncInFlight: true,
  data: { alerts: [{ applicationId: 'client', emailId: 'email' }] },
  setTimeout: (callback, ms) => { assert.equal(ms, 300); const id = ++timerId; timeouts.set(id, callback); return id; },
  clearTimeout: id => timeouts.delete(id),
  setInterval: (callback, ms) => { assert.equal(ms, 15000); const id = ++timerId; intervals.set(id, callback); return id; },
  clearInterval: id => intervals.delete(id),
  emailAiRetryState: () => cooldown,
  pendingEmailAiChecks: () => Array(pending).fill('pending'),
  syncGmail: () => { throw new Error('AI must never need Gmail sync'); },
  checkAllEmailAiMessages: async () => {
    runs++; await wait; pending = 0;
    return { automaticTasks: { created: [{ id: 'task', clientId: 'client', sourceEmailId: 'email' }], review: [], failed: false },
      applicationOutcomes: { changed: [{ id: 'application' }], review: [], failed: false } };
  },
  persist: async () => true,
  showAutomaticEmailTasksNotice: tasks => notices.push(['tasks', tasks.length]),
  showEmailAiReviewNotice() {}, showApplicationAiReviewNotice() {},
  showApplicationEmailOutcomeNotice: changes => notices.push(['applications', changes.length]),
  showActionResult: result => notices.push(result),
  renderAll: () => context.scheduleSavedEmailAiCheck()
});
vm.runInContext(source.slice(source.indexOf('  let savedEmailAiTimer ='), source.indexOf('  async function checkAllEmailAiMessages(')), context);
const fireScheduled = () => {
  const [id, callback] = [...timeouts][0]; timeouts.delete(id); callback();
};
(async () => {
  context.startSavedEmailAiChecks();
  assert.equal(intervals.size, 1); assert.equal(timeouts.size, 1);
  fireScheduled();
  const joined = context.runSavedEmailAiChecks();
  assert.equal(runs, 1, 'AI starts with Gmail credentials absent and sync still in flight');
  context.scheduleSavedEmailAiCheck();
  assert.equal(timeouts.size, 0, 'Renders do not spawn duplicate jobs while AI is running');
  release(); await joined;
  assert.equal(context.data.alerts[0].taskId, 'task');
  assert.deepEqual(notices, [['tasks', 1], ['applications', 1]], 'Independent runs deliver task and application notices once');
  [...intervals.values()][0](); fireScheduled();
  await context.runSavedEmailAiChecks();
  assert.equal(runs, 1, 'Periodic scans do not analyze completed messages again');
  pending = 1; context.navigator.onLine = false;
  await context.runSavedEmailAiChecks(); assert.equal(runs, 1, 'Offline pauses provider requests');
  context.navigator.onLine = true; cooldown = { until: Date.now() + 60000 };
  await context.runSavedEmailAiChecks(); assert.equal(runs, 1, 'Provider cooldown is respected');
  cooldown = null; wait = gate();
  context.scheduleSavedEmailAiCheck(); fireScheduled();
  const next = context.runSavedEmailAiChecks();
  assert.equal(runs, 2, 'New saved eligible messages start the next independent analysis');
  context.currentUser = null; context.stopSavedEmailAiChecks();
  release(); await next;
  assert.equal(intervals.size, 0); assert.equal(timeouts.size, 0);
  assert.equal(notices.length, 2, 'No stale notices are emitted after logout');
  console.log('Independent AI passed: no Gmail token/sync dependency, immediate saved-message trigger, 15-second scanning, single-flight notices, completed-message skips, offline/cooldown and logout cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
