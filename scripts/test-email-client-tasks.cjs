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
const context = { data: { applications: [{ id: 'client-1', clientName: 'Acme' }] } };
const email = { id: 'email-1' };
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
console.log('Email task editor checks passed: one-time deadline and estimate retained, hidden required schedule disabled, recurrence unchanged.');
