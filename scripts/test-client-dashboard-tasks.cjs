const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/frontend/js/modules/pages/07a-dashboard-page.js', 'utf8');
const nodes = new Map();
const $ = key => { if (!nodes.has(key)) nodes.set(key, {}); return nodes.get(key); };
const context = vm.createContext({ $, data: {
  clientTasks: [
    { id: 'a', clientId: 'one', title: '<Upload video>', dueDate: '2026-10-26', status: 'in-progress' },
    { id: 'b', clientId: 'two', title: 'Send draft', dueDate: '2026-10-25' },
    { id: 'c', clientId: 'one', title: 'Already done', status: 'done' },
    { id: 'd', clientId: 'missing', title: 'Orphan task' }
  ], dailyTasks: [
    { id: 'e', relatedType: 'client', relatedId: 'one', title: 'No deadline' },
    { id: 'f', relatedType: 'client', relatedId: 'one', title: 'Completed daily', completedAt: '2026-10-25' },
    { id: 'g', title: 'Personal daily task', taskDate: '2026-10-26' }
  ]
}, today: () => '2026-10-26', dateKey: value => String(value || '').slice(0, 10), formatDate: value => value,
  plural: (count, label) => `${count} ${label}${count === 1 ? '' : 's'}`,
  escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
});
vm.runInContext(source.slice(source.indexOf('  function renderClientDashboardTasks('), source.indexOf('  function renderClientDashboardAttention(')), context);
context.renderClientDashboardTasks([{ id: 'one', clientName: 'Studio One' }, { id: 'two', clientName: 'Studio Two' }]);
const html = $('#clientDashboardTaskList').innerHTML;
assert.equal($('#clientDashboardTasksCount').textContent, '3 open tasks');
assert.ok(html.indexOf('Studio Two') < html.indexOf('Studio One'), 'Client groups with earlier deadlines come first');
assert.match(html, /Overdue · 2026-10-25/);
assert.match(html, /Today · 2026-10-26/);
assert.match(html, /No due date/);
assert.match(html, /In progress/);
assert.match(html, /&lt;Upload video&gt;/);
assert.doesNotMatch(html, /Already done|Orphan task|Completed daily|Personal daily task/);
assert.match(html, /data-client-dashboard-attention="client-task" data-client-id="one" data-item-id="a"/);
assert.match(html, /data-client-dashboard-attention="daily-task" data-client-id="one" data-item-id="e"/);
context.renderClientDashboardTasks([]);
assert.match($('#clientDashboardTaskList').innerHTML, /All caught up/);
console.log('Client dashboard tasks passed: client grouping, deadlines, completion actions, escaping, unrelated/completed task exclusion and empty state.');
