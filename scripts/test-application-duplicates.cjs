const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/frontend/js/modules/02-email-matching.js'), 'utf8');
const nodes = {
  '#clientForm': { reportValidity: () => true }, '#automaticFollowUp': { checked: false },
  '#clientPlatform': { value: 'OnlineJobs.ph' }, '#clientName': { value: '  ACME   Studio ' },
  '#contactName': { value: ' Jordan Smith ' }, '#hiredEmail': { value: 'JORDAN@example.com' },
  '#clientRole': { value: 'Social Media Manager' }, '#hiredWebsite': { value: 'N/A' },
  '#applicationDuplicateNotice': { hidden: true, textContent: '', dataset: {} }
};
let notice;
const context = vm.createContext({ data: { applications: [] }, editingId: null,
  $: selector => nodes[selector], isActiveClientDrawerView: () => false,
  STATUS_LABELS: { 'Not selected': 'Rejected' }, formatDate: value => value,
  viewingClientDetails: false, showActionResult: result => { notice = result; } });
vm.runInContext(source.slice(source.indexOf('  function normalizeApplicationIdentity('), source.indexOf('  async function saveClient(')), context);
const existing = { id: 'existing', clientName: 'Acme Studio', contact: 'Jordan Smith', email: 'jordan@example.com', role: 'Social Media Manager', website: 'N/A', status: 'Applied' };
const candidate = { clientName: ' ACME   Studio ', contact: ' jordan smith ', email: 'JORDAN@example.com', role: ' social media manager ', website: 'https://different.example/job/1' };
for (const status of ['Applied', 'Not selected', 'Ghosted', 'Active client']) {
  assert.equal(context.findDuplicateApplication(candidate, [{ ...existing, status }]).id, existing.id, 'All four identity fields match regardless of link or status');
}
for (const field of ['clientName', 'contact', 'email', 'role']) {
  assert.equal(context.findDuplicateApplication({ ...candidate, [field]: field === 'email' ? 'different@example.com' : 'Different' }, [existing]), undefined, `${field} must also match`);
  assert.equal(context.findDuplicateApplication({ ...candidate, [field]: '' }, [existing]), undefined, `Missing ${field} is not a confirmed duplicate`);
}
assert.equal(context.findDuplicateApplication({ ...candidate, id: existing.id }, [existing]), undefined, 'Own record is excluded');
const copies = [existing, { ...existing, id: 'legacy-copy' }];
assert.equal(context.findDuplicateApplication({ ...candidate, id: existing.id, notes: 'Updated' }, copies), undefined, 'Editing unrelated fields is allowed even with historical duplicates');
const other = { id: 'other', clientName: 'Other Company', contact: 'Jane', email: 'jane@example.com' };
assert.equal(context.findDuplicateApplication({ ...candidate, id: other.id }, [existing, other]), undefined, 'Edit mode skips duplicate checking even if all four fields match another record');
const saveStart = source.indexOf('  async function saveClient(');
vm.runInContext(source.slice(saveStart, source.indexOf('  async function deleteClient(', saveStart)), context);
(async () => {
  context.data.applications = [{ ...existing, status: 'Not selected', appliedDate: '2026-09-01' }];
  await context.saveClient({ preventDefault() {} });
  assert.equal(context.data.applications.length, 1);
  assert.equal(notice.title, 'Application already exists');
  assert.match(notice.message, /Rejected/);
  assert.match(notice.message, /jordan@example.com/);
  context.updateApplicationDuplicateNotice();
  const inline = nodes['#applicationDuplicateNotice'];
  assert.equal(inline.hidden, false);
  nodes['#clientRole'].value = 'Graphic Designer';
  context.updateApplicationDuplicateNotice();
  assert.equal(inline.hidden, true, 'Different roles at the same company/contact/email are allowed');
  nodes['#clientRole'].value = 'Social Media Manager';
  context.updateApplicationDuplicateNotice();
  assert.equal(inline.hidden, false, 'Restoring the matching role immediately shows the duplicate');
  nodes['#contactName'].value = 'Someone else';
  context.updateApplicationDuplicateNotice();
  assert.equal(inline.hidden, true, 'Contact changes immediately clear the warning');
  nodes['#contactName'].value = 'Jordan Smith';
  nodes['#hiredEmail'].value = 'other@example.com';
  context.updateApplicationDuplicateNotice();
  assert.equal(inline.hidden, true, 'A company/contact match alone is insufficient');
  nodes['#hiredEmail'].value = existing.email;
  context.updateApplicationDuplicateNotice();
  assert.equal(inline.hidden, false);
  context.editingId = existing.id;
  context.updateApplicationDuplicateNotice();
  assert.equal(inline.hidden, true, 'Editing own record remains clear');
  context.editingId = other.id;
  context.updateApplicationDuplicateNotice();
  assert.equal(inline.hidden, true, 'Editing another record to identical details never shows an add-only duplicate alert');
  context.viewingClientDetails = true;
  context.editingId = null;
  context.updateApplicationDuplicateNotice();
  assert.equal(inline.hidden, true, 'Read-only details do not show a warning');
  const page = fs.readFileSync(path.join(__dirname, '../src/frontend/js/modules/pages/07-applications-page.js'), 'utf8');
  assert.match(page, /\['clientName', 'contactName', 'hiredEmail', 'clientRole'\]\.includes\(event.target.id\)/, 'Live checks listen to all four identifying fields');
  console.log('Application duplicates passed: add-only checking, all four fields required, different roles allowed, edits exempt, live warnings and blocked duplicate creation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
