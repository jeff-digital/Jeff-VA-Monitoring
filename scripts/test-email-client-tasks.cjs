const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '../src/frontend/js/modules', name), 'utf8');
const nodes = new Map();
const node = selector => {
  if (!nodes.has(selector)) nodes.set(selector, { value: '', dataset: {}, disabled: false, hidden: false, textContent: '',
    addEventListener() {}, reportValidity: () => true, reset() {}, focus() {}, close() { this.open = false; }, showModal() { this.open = true; } });
  return nodes.get(selector);
};
let saveSucceeds = true;
let saveCount = 0;
let active = true;
let result;
const email = { id: 'email-1', gmailId: 'g1', from: 'client@example.com', subject: 'Re: Launch campaign', body: 'Please prepare our campaign.' };
const context = vm.createContext({ $, Date, console,
  currentUser: { id: 'user-1' }, hiredEditingId: '', data: { emails: [email], clientTasks: [], applications: [{ id: 'client-1', clientName: 'Acme' }] },
  document: { addEventListener() {} },
  activeClientsForTaskEmail: item => item && active ? context.data.applications : [],
  escapeHtml: String, emailContentText: String, uid: () => `task-${saveCount + 1}`,
  persist: async () => { saveCount++; return saveSucceeds; }, renderClientTasks() {}, renderAlerts() {},
  showActionResult: value => { result = value; }
});
function $(selector) { return node(selector); }
vm.runInContext(read('pages/10a-email-client-tasks.js'), context);
const event = { preventDefault() {} };
function draft() {
  context.openEmailTaskComposer(email.id);
  node('#emailTaskClient').value = 'client-1';
  node('#emailTaskDueDate').value = '2026-10-25'; // A Sunday is valid for a one-time task.
  node('#emailTaskEstimate').value = '45';
  node('#emailTaskCategory').value = 'Social Media';
  node('#emailTaskPriority').value = 'High';
}
// Editing an email task must retain its deadline and estimate instead of
// turning it into the client's default Monday–Friday overnight schedule.
const tasksSource = read('pages/13-client-tasks-page.js');
const extractTaskFunction = name => {
  const start = tasksSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const end = tasksSource.indexOf('\nfunction ', start + 10);
  return tasksSource.slice(start, end < 0 ? undefined : end);
};
const scheduleInputs = Array.from({ length: 4 }, () => ({ disabled: false }));
node('#clientTaskScheduleSection').querySelectorAll = () => scheduleInputs;
node('#clientTaskWeekdays').querySelectorAll = () => [];
node('#clientTaskDueDate').setCustomValidity = () => {};
node('#clientTaskManualEnd').setCustomValidity = () => {};
const editorContext = vm.createContext({ $: node, hiredEditingId: 'client-1',
  data: context.data, today: () => '2026-10-20',
  clientTaskSelectedWeekdays: () => [1, 2, 3, 4, 5], renderClientTaskEntries() {}, clientTaskFormSnapshot: () => '{}' });
vm.runInContext(tasksSource.slice(0, tasksSource.indexOf('function getClientTasks('))
  + '\nlet clientTaskOneOffMode = false;\n'
  + ['clientTaskTimeEntries', 'clientTaskRepeatValue', 'updateClientTaskSchedule', 'updateClientTaskRepeatFields', 'fillClientTaskDrawer'].map(extractTaskFunction).join('\n'), editorContext);
editorContext.fillClientTaskDrawer({ id: 'one-off', title: 'Review campaign', category: 'Social Media',
  dueDate: '2026-10-25', estimateMinutes: 45, repeat: { frequency: 'none' }, sourceEmailId: email.id });
assert.equal(node('#clientTaskDueDate').value, '2026-10-25');
assert.equal(node('#clientTaskEstimate').value, 45);
assert.equal(node('#clientTaskScheduleSection').hidden, true);
assert.equal(node('#clientTaskOneOffFields').hidden, false);
assert.equal(scheduleInputs.every(input => input.disabled), true, 'hidden required schedule inputs must not block a one-time task');
assert.equal(editorContext.clientTaskRepeatValue().frequency, 'none');
(async () => {
  draft();
  assert.equal(node('#emailTaskName').value, 'Launch campaign');
  assert.equal(node('#emailTaskNotes').value, email.body);
  assert.equal(context.data.clientTasks.length, 0, 'opening a draft must not create a task');
  await context.submitEmailTask(event);
  assert.equal(saveCount, 1);
  assert.equal(result.title, 'Task created');
  const task = context.data.clientTasks[0];
  assert.equal(task.sourceEmailId, email.id);
  assert.equal(task.sourceGmailId, email.gmailId);
  assert.equal(task.repeat.frequency, 'none');
  assert.equal(task.dueDate, '2026-10-25');
  assert.equal(task.estimateMinutes, 45);
  draft();
  await context.submitEmailTask(event);
  assert.equal(saveCount, 1, 'repeated submission must not persist a duplicate task');
  assert.equal(result.title, 'Task already exists');
  context.data.clientTasks = [];
  draft();
  active = false;
  await context.submitEmailTask(event);
  assert.equal(saveCount, 1, 'client eligibility must be rechecked on submit');
  active = true;
  draft();
  saveSucceeds = false;
  await context.submitEmailTask(event);
  assert.equal(context.data.clientTasks.length, 0, 'failed cloud save must roll back the task');
  assert.match(node('#emailTaskError').textContent, /could not be saved/);
  assert.equal(node('#emailTaskModal').open, true, 'failed save keeps draft available');
  saveSucceeds = true;
  await context.submitEmailTask(event);
  assert.equal(context.data.clientTasks.length, 1, 'failed saves can be retried');
  context.data.clientTasks = [];
  draft();
  context.currentUser = { id: 'other-user' };
  await context.submitEmailTask(event);
  assert.equal(context.data.clientTasks.length, 0, 'a draft cannot cross signed-in accounts');
  console.log('Email task checks passed: review, one-time deadline, source link, deduplication, active-client restriction, account isolation, rollback and retry.');
})().catch(error => { console.error(error); process.exitCode = 1; });
