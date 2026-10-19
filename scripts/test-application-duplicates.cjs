const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/frontend/js/modules/02-email-matching.js'), 'utf8');
const helpers = source.slice(source.indexOf('  function normalizeApplicationIdentity('), source.indexOf('  async function saveClient('));
const nodes = {
  '#clientForm': { reportValidity: () => true }, '#automaticFollowUp': { checked: false },
  '#clientPlatform': { value: 'OnlineJobs.ph' }, '#clientName': { value: '  ACME   Studio ' },
  '#clientRole': { value: 'Social Media Manager' }, '#hiredWebsite': { value: '' }
};
nodes['#applicationDuplicateNotice'] = { hidden: true, textContent: '', dataset: {} };
let notice;
const context = vm.createContext({ URL, data: { applications: [] }, editingId: null,
  $: selector => nodes[selector], isActiveClientDrawerView: () => false,
  STATUS_LABELS: { 'Not selected': 'Rejected' }, formatDate: value => value,
  viewingClientDetails: false, showActionResult: result => { notice = result; } });
vm.runInContext(helpers, context);
const existing = { id: 'existing', clientName: 'Acme Studio', role: 'Social Media Manager', website: 'https://www.example.com/jobs/42/?utm_source=email', status: 'Rejected' };
const candidate = { clientName: ' ACME   Studio ', role: ' social media manager ', website: '' };
for (const status of ['Applied', 'Rejected', 'Not selected', 'Ghosted', 'Active client']) {
  assert.equal(context.findDuplicateApplication(candidate, [{ ...existing, status }]).id, existing.id);
}
assert.equal(context.findDuplicateApplication({ ...candidate, id: existing.id }, [existing]), undefined, 'editing the same record is allowed');
assert.equal(context.findDuplicateApplication({ ...candidate, role: 'Graphic Designer' }, [existing]), undefined, 'a different role at the company is allowed');
assert.equal(context.findDuplicateApplication({ clientName: 'Renamed', role: 'Renamed', website: 'http://example.com/jobs/42?utm_campaign=test#apply' }, [existing]).id, existing.id, 'same posting with tracking variations is blocked');
assert.equal(context.findDuplicateApplication({ clientName: 'Other', role: 'Other', website: 'https://example.com/jobs/43' }, [existing]), undefined, 'different posting is allowed');
assert.equal(context.findDuplicateApplication({ clientName: 'Other', role: 'Other', website: 'https://example.com/' }, [{ ...existing, website: 'https://example.com/' }]), undefined, 'a shared homepage is insufficient');
const start = source.indexOf('  async function saveClient(');
const rest = source.slice(start);
const next = rest.slice(12).search(/\n  (?:async )?function /);
vm.runInContext(next < 0 ? rest : rest.slice(0, next + 12), context);
(async () => {
  context.data.applications = [{ ...existing, status: 'Not selected', appliedDate: '2026-09-01' }];
  let prevented = false;
  await context.saveClient({ preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.equal(context.data.applications.length, 1, 'duplicate submit never inserts a record');
  assert.equal(notice.title, 'Application already exists');
  assert.match(notice.message, /Rejected/);
  assert.match(notice.message, /2026-09-01/);
  assert.equal(nodes['#clientName'].value, '  ACME   Studio ', 'draft is preserved');
  context.updateApplicationDuplicateNotice();
  const inline = nodes['#applicationDuplicateNotice'];
  assert.equal(inline.hidden, false);
  assert.equal(inline.dataset.kind, 'duplicate');
  assert.match(inline.textContent, /Rejected/);
  nodes['#clientRole'].value = 'Designer';
  context.updateApplicationDuplicateNotice();
  assert.equal(inline.dataset.kind, 'company', 'company match is shown before a duplicate role is entered');
  nodes['#clientName'].value = 'New Company';
  context.updateApplicationDuplicateNotice();
  assert.equal(inline.hidden, true, 'notice clears when the identifying fields change');
  context.viewingClientDetails = true;
  nodes['#clientName'].value = 'Acme Studio';
  context.updateApplicationDuplicateNotice();
  assert.equal(inline.hidden, true, 'read-only details do not show an editing warning');
  const sortingStart = source.indexOf('  function sortApplicationList(');
  vm.runInContext(source.slice(sortingStart, source.indexOf('  function renderApplications(', sortingStart)), context);
  context.applicationAppliedDate = item => item.appliedDate || item.createdAt;
  const records = [
    { id: 'early', appliedDate: '2026-10-19', createdAt: '2026-10-19T01:00:00Z' },
    { id: 'late', appliedDate: '2026-10-19', createdAt: '2026-10-19T02:00:00Z' },
    { id: 'older', appliedDate: '2026-10-18' }
  ];
  assert.equal(context.sortApplicationList(records, 'newest').map(item => item.id).join(','), 'late,early,older');
  assert.equal(context.sortApplicationList(records, 'oldest').map(item => item.id).join(','), 'older,early,late');
  assert.equal(records[0].id, 'early', 'sorting must not mutate stored applications');
  console.log('Application duplicate checks passed: all statuses, edits, roles, posting URLs, and blocked save.');
})().catch(error => { console.error(error); process.exitCode = 1; });
