const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '../src/frontend/js/modules', file), 'utf8');
const nodes = new Map();
const $ = key => { if (!nodes.has(key)) nodes.set(key, { value: '', textContent: '', innerHTML: '', hidden: false }); return nodes.get(key); };
const buttons = ['week', 'applied'].map(filter => ({ dataset: { applicationQuickFilter: filter }, attrs: {},
  classList: { toggle() {} }, setAttribute(name, value) { this.attrs[name] = value; },
  addEventListener(type, callback) { this[type] = callback; } }));
const context = vm.createContext({ $, document: { querySelectorAll: () => buttons },
  applicationDateSort: '0', applicationDateFilter: '', escapeHtml: value => String(value), emailDate: value => value,
  updateWeekNavigationCounts() {} });
const matcher = read('02-email-matching.js');
const start = matcher.indexOf('    const filterChips = [');
const end = matcher.indexOf("    $$('[data-application-view]')", start);
assert.ok(start >= 0 && end > start);
vm.runInContext(`function renderApplications() {
  const query = $('#applicationSearch').value, dateFilter = applicationDateFilter;
  const status = $('#statusFilter').value, platform = $('#platformFilter').value;
  ${matcher.slice(start, end)}
}`, context);
const page = read('pages/07-applications-page.js');
const eventStart = page.indexOf("  document.querySelectorAll('[data-application-quick-filter]')");
const eventEnd = page.indexOf("  document.addEventListener('click'", eventStart);
assert.ok(eventStart >= 0 && eventEnd > eventStart);
vm.runInContext(page.slice(eventStart, eventEnd), context);
$('#statusFilter').value = 'Applied'; context.renderApplications();
assert.equal(buttons[0].attrs['aria-pressed'], 'true'); assert.equal(buttons[1].attrs['aria-pressed'], 'true');
assert.ok(!$('#applicationFilterChips').innerHTML.includes('Stage: Applied'), 'Applied must have one selected indicator');
assert.equal($('#clearApplicationFilters').hidden, false);
buttons[0].click();
assert.equal(context.applicationDateSort, 'all'); assert.equal($('#applicationDateSort').value, 'all');
assert.equal($('#statusFilter').value, 'Applied'); assert.equal(buttons[0].attrs['aria-pressed'], 'false');
buttons[1].click();
assert.equal($('#statusFilter').value, ''); assert.equal(buttons[1].attrs['aria-pressed'], 'false');
assert.equal($('#clearApplicationFilters').hidden, true);
context.applicationDateFilter = '2026-10-21'; $('#applicationDateFilter').value = context.applicationDateFilter;
buttons[0].click();
assert.equal(context.applicationDateSort, '0'); assert.equal(context.applicationDateFilter, '');
assert.equal($('#applicationDateFilter').value, ''); assert.equal($('#clearApplicationFilters').hidden, false);
$('#statusFilter').value = 'Interview'; context.renderApplications();
assert.match($('#applicationFilterChips').innerHTML, /Stage: Interview/); assert.equal(buttons[1].attrs['aria-pressed'], 'false');
$('#platformFilter').value = 'Direct client'; $('#applicationSearch').value = 'Acme';
buttons[1].click();
assert.equal($('#statusFilter').value, 'Applied'); assert.equal(context.applicationDateSort, '0');
assert.match($('#applicationFilterChips').innerHTML, /Source: Direct client/);
assert.match($('#applicationFilterChips').innerHTML, /Search: Acme/);
assert.ok(!$('#applicationFilterChips').innerHTML.includes('Stage: Applied'));
console.log('Application quick filters passed: independent toggles, selected states, no duplicate Applied chip, date reset, other filters retained and Clear all visibility.');
