const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/frontend/js/modules/pages/07a-dashboard-page.js', 'utf8');
const context = vm.createContext({ today: () => '2026-10-27' });
vm.runInContext(source.slice(source.indexOf('  function applicationWeeklyTrend('), source.indexOf('  function renderApplicationWeeklyTrend(')), context);
const result = values => JSON.parse(JSON.stringify(context.applicationWeeklyTrend(values)));
assert.deepEqual(result([]), []);
assert.deepEqual(result([{ appliedDate: 'bad' }, { appliedDate: '2026-02-30' }, { appliedDate: '2026-10-28' }]), []);
assert.deepEqual(result([
  { appliedDate: '2026-10-11', status: 'Not selected' },
  { appliedDate: '2026-10-05', status: 'Active client' },
  { appliedDate: '2026-10-26', status: 'Applied' },
  { appliedDate: '2026-10-27T02:00:00Z' }
]), [
  { week: '2026-10-05', count: 2 },
  { week: '2026-10-12', count: 0 },
  { week: '2026-10-19', count: 0 },
  { week: '2026-10-26', count: 2 }
]);
assert.deepEqual(result([{ appliedDate: '2026-10-27' }]), [{ week: '2026-10-26', count: 1 }]);
assert.equal(context.applicationWeeklyTrend([{ appliedDate: '2025-12-31' }], '2026-01-06')[0].week, '2025-12-29');
console.log('Weekly trend checks passed: Monday/Sunday boundaries, empty weeks, current week, year boundaries, all statuses and invalid/future dates.');
