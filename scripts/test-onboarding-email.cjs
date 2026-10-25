const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/frontend/js/modules/pages/09-active-clients-page.js', 'utf8');
const nodes = new Map();
const $ = key => { if (!nodes.has(key)) nodes.set(key, { value: '', disabled: false }); return nodes.get(key); };
const client = { id: 'client-one', clientName: 'Studio One', email: 'client@example.com' };
let issued = true, requests = 0, opened = 0, errors = 0, clean = 0;
const context = vm.createContext({ $, URL, TextEncoder, Uint8Array, crypto: require('node:crypto').webcrypto,
  data: { applications: [client] }, hiredEditingId: client.id, window: { location: { origin: 'https://app.test' } },
  console: { error() {} }, toast() {},
  requireSupabase: () => ({ rpc: async (name, input) => {
    requests++;
    assert.equal(name, 'issue_client_onboarding_invite');
    assert.equal(input.p_client_id, client.id);
    assert.match(input.p_token_hash, /^[a-f0-9]{64}$/);
    return { data: issued, error: null };
  } }),
  openPlainClientEmailComposer: item => { assert.equal(item.id, client.id); opened++; $('#composeTo').value = item.email; },
  markActiveClientDrawerFormClean: view => { assert.equal(view, 'email'); assert.match($('#composeBody').value, /https:\/\/app\.test\/onboarding\/#token=/); clean++; },
  showActionResult: () => { errors++; }
});
vm.runInContext(source.slice(source.indexOf('  async function sendClientOnboardingInvite('), source.indexOf('  function openDocumentEmailReminder(')), context);
const startMarker = "      } else if (actionRow.dataset.activeClientAction === 'onboarding') {";
const start = source.indexOf(startMarker) + startMarker.length;
const end = source.indexOf("      } else if (actionRow.dataset.activeClientAction === 'edit') {", start);
vm.runInContext('async function selectOnboardingEmail(actionRow) {' + source.slice(start, end) + '\n}', context);
(async () => {
  const button = { disabled: false };
  await context.selectOnboardingEmail(button);
  assert.equal(requests, 1);
  assert.equal(opened, 1, 'Selecting onboarding opens an email, not a link-only panel');
  assert.equal($('#composeTo').value, client.email);
  assert.match($('#composeSubject').value, /onboarding/i);
  assert.match($('#composeBody').value, /Hi Studio One/);
  const link = $('#composeBody').value.match(/\]\((https:\/\/[^)]+)\)/)[1];
  const token = new URL(link).hash.slice(7);
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.match($('#composeBody').value, /Hi Studio One Team,/);
  assert.match($('#composeBody').value, /Best regards,\n\*\*Jeff VA\*\*/);
  const gmailSource = fs.readFileSync('src/frontend/js/modules/04-gmail.js', 'utf8');
  vm.runInContext(gmailSource.slice(gmailSource.indexOf('  function escapeHtmlForEmail('), gmailSource.indexOf('  function buildRawEmailMessage(')), context);
  const html = context.htmlEmailBodyFromText($('#composeBody').value);
  assert.ok(html.includes(`href="${link}"`), 'The private link is a clickable HTML link');
  assert.match(html, />Complete Your Onboarding Form<\/a>/);
  assert.equal((html.match(/<li /g) || []).length, 5, 'All five reminders render as bullets');
  assert.match(html, /<strong>Private Access:<\/strong>/);
  const unsafe = context.htmlEmailBodyFromText('[Unsafe](javascript:alert(1)) <script>alert(1)</script>');
  assert.doesNotMatch(unsafe, /href="javascript:|<script>/);
  assert.equal(clean, 1, 'The prepared email is the initial clean form state');
  assert.equal(button.disabled, false);
  issued = false;
  await context.selectOnboardingEmail(button);
  assert.equal(opened, 1, 'Failed invitation creation does not open an unusable email');
  assert.equal(errors, 1);
  assert.equal(button.disabled, false);
  await context.sendClientOnboardingInvite({ ...client, email: '' }, button);
  assert.equal(requests, 2, 'A client email is required before issuing an invitation');
  assert.equal(errors, 2);
  console.log('Onboarding email passed: action routing, recipient, private link in email, safe failure, required client email and button recovery. No emails sent.');
})().catch(error => { console.error(error); process.exitCode = 1; });
