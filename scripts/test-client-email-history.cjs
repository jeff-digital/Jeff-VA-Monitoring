const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/frontend/js/modules/pages/07c-application-form.js', 'utf8');
const context = vm.createContext({
  escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
  emailContentText: value => value.replace(/<[^>]*>/g, ''), emailDate: () => 'Oct 26, 2026', emailTime: () => '8:00 AM'
});
vm.runInContext(source.slice(source.indexOf('  function renderClientHistoryEmailRows('), source.indexOf('  function renderHiredEmailHistory(')), context);
const html = context.renderClientHistoryEmailRows([{ id: 'email-1', to: 'Studio One <hello@example.com>', subject: '<Project update>', body: '<p>Ready for review</p>', date: '2026-10-26T00:00:00Z' }]);
assert.match(html, /class="email-row sent"/);
assert.match(html, /class="email-from"[^>]*>Studio One<\/h3>/);
assert.match(html, /&lt;Project update&gt;/);
assert.doesNotMatch(html, /<Project update>/);
assert.match(html, /Ready for review/);
assert.match(html, /8:00 AM/);
assert.match(html, /class="sent-email-badge">SENT/);
assert.equal((html.match(/data-email-detail="email-1"/g) || []).length, 2, 'Row and keyboard-accessible View button open the same saved email');
assert.doesNotMatch(html, /data-email-action="delete"/, 'History redesign does not add destructive actions');
assert.match(context.renderClientHistoryEmailRows([{ id: 'empty' }]), /\(No subject\)/);
console.log('Client email history passed: inbox-style rows, recipient, safe previews, date/time and existing email-detail actions.');
