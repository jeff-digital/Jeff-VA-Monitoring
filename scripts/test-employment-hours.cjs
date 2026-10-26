const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/frontend/js/modules/pages/07-applications-page.js', 'utf8');
const nodes = {};
for (const id of ['employmentType', 'salaryType', 'salaryCurrency', 'salaryAmount', 'salaryHoursPerWeek', 'salaryMonthlyEstimatePreview', 'salaryMonthlyEstimatePhp']) {
  const hidden = new Set();
  nodes[`#${id}`] = { value: '', textContent: '', closest: () => ({ classList: {
    toggle(name, enabled) { enabled ? hidden.add(name) : hidden.delete(name); }
  } }), hidden };
}
const context = vm.createContext({ $: selector => nodes[selector] });
for (const name of ['updateSalaryFields', 'updateEmploymentHours']) {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf('\n  }', start) + 4;
  vm.runInContext(source.slice(start, end), context);
}
const hours = nodes['#salaryHoursPerWeek'];
nodes['#salaryCurrency'].value = 'USD';
nodes['#salaryAmount'].value = '800';
nodes['#salaryType'].value = 'monthly';
nodes['#employmentType'].value = 'Part time';
context.updateEmploymentHours();
assert.equal(hours.value, '20');
assert.equal(hours.hidden.has('hidden'), false, 'Monthly salaries show weekly hours');
assert.equal(nodes['#salaryMonthlyEstimatePreview'].textContent, '$800', 'Monthly pay is not multiplied by weekly hours');
nodes['#employmentType'].value = 'Full time';
context.updateEmploymentHours();
assert.equal(hours.value, '40');
hours.value = '32';
context.updateSalaryFields();
assert.equal(hours.value, '32', 'Rendering and amount changes preserve custom or saved hours');
nodes['#employmentType'].value = 'Gig';
context.updateEmploymentHours();
assert.equal(hours.value, '32', 'Gigs do not receive a full-time default');
nodes['#salaryType'].value = 'hourly';
nodes['#salaryAmount'].value = '5';
nodes['#employmentType'].value = 'Part time';
context.updateEmploymentHours();
assert.equal(nodes['#salaryMonthlyEstimatePreview'].textContent, '$400', 'Hourly monthly estimates use the automatic hours');
nodes['#salaryType'].value = '';
context.updateSalaryFields();
assert.equal(hours.hidden.has('hidden'), true, 'Unset salaries keep their salary fields hidden');
assert.match(source, /\$\('#employmentType'\)\.addEventListener\('change', updateEmploymentHours\)/);
console.log('Employment hours and monthly/hourly salary checks passed.');
