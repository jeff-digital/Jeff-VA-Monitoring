const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/frontend/js/modules/pages/06b-research-chat.js', 'utf8');
const nodes = new Map(), saved = new Map();
const $ = key => {
  if (!nodes.has(key)) nodes.set(key, { value: '', hidden: false, disabled: false, innerHTML: '', textContent: '', handlers: {},
    classList: { toggle() {} }, setAttribute() {}, focus() {}, close() {}, showModal() { this.open = true; }, addEventListener(type, handler) { this.handlers[type] = handler; } });
  return nodes.get(key);
};
let requests = 0, release, delayed = true, failed = false;
const session = { access_token: 'session', user: { id: 'u1' } };
const context = vm.createContext({ $, URL, AbortSignal, currentUser: { id: 'u1' }, dataReady: true,
  data: { applications: [{ id: 'app-1', clientName: 'Acme', role: 'Editor', email: 'workspace-secret' }], emails: [{ id: 'email-1', subject: 'Existing inbox message', from: 'client@example.com' }] }, sortByDate: items => items, requestAnimationFrame: fn => fn(),
  sessionStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) },
  escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
  requireSupabase: () => ({ auth: { getSession: async () => ({ data: { session } }) } }),
  renewEmailAiSession: async () => session,
  fetch: async (url, options) => {
    requests++;
    assert.equal(url, '/api/research');
    const body = JSON.parse(options.body);
    assert.equal(body.messages.at(-1).role, 'user');
    assert.ok(!options.body.includes('workspace-secret'));
    assert.ok(!options.body.includes('sources'));
    if (delayed) await new Promise(resolve => { release = resolve; });
    if (failed) return Response.json({ error: 'Model temporarily unavailable' }, { status: 503 });
    return Response.json({ answer: '<script>unsafe</script> Result [1]', sources: [{ id: 1, title: '<img>', url: 'https://example.com/source' }, { id: 2, title: 'Bad', url: 'javascript:alert(1)' }] });
  }
});
vm.runInContext(source, context);
(async () => {
  const shell = fs.readFileSync('src/frontend/js/modules/pages/06-shell-events.js', 'utf8');
  vm.runInContext(shell.slice(shell.indexOf('  const quickSearchPages ='), shell.indexOf("  $('#openQuickSearch').addEventListener")), context);
  context.openQuickSearch();
  assert.equal($('#quickAppSearchPanel').hidden, false, 'Search opens existing app search first');
  assert.equal($('#researchPanel').hidden, true);
  assert.equal($('#researchModelLabel').hidden, true);
  assert.match($('#quickSearchResults').innerHTML, /Acme/);
  assert.match($('#quickSearchResults').innerHTML, /Existing inbox message/);
  assert.match($('#quickSearchResults').innerHTML, /Dashboard/);
  assert.equal(requests, 0, 'Opening app search never requests AI');
  context.setQuickSearchMode('ai');
  assert.equal($('#quickAppSearchPanel').hidden, true);
  assert.equal($('#researchPanel').hidden, false);
  $('#researchPrompt').value = 'Help me compare options.';
  $('#researchSourceMode').value = 'reasoning'; $('#researchEffort').value = 'medium';
  const event = { preventDefault() {} };
  const pending = context.submitResearchQuestion(event);
  await Promise.resolve(); await Promise.resolve();
  await context.submitResearchQuestion(event);
  assert.equal(requests, 1, 'Double submissions share one in-flight request');
  release(); await pending; delayed = false;
  assert.match($('#researchMessages').innerHTML, /&lt;script&gt;/);
  assert.doesNotMatch($('#researchMessages').innerHTML, /<script>|javascript:/);
  assert.match($('#researchMessages').innerHTML, /https:\/\/example.com\/source/);
  context.setQuickSearchMode('app'); context.setQuickSearchMode('ai');
  assert.equal(requests, 1, 'Closing or switching modes does not rerun the chat');
  context.openQuickSearch();
  assert.equal($('#quickAppSearchPanel').hidden, false, 'Reopening after AI still starts in app search');
  assert.equal($('#researchModelLabel').hidden, true);
  context.setQuickSearchMode('ai');
  const reload = vm.createContext({ ...context }); vm.runInContext(source, reload);
  reload.renderResearchChat();
  assert.match($('#researchMessages').innerHTML, /Result/);
  assert.equal(requests, 1, 'Conversation restores from account-scoped tab storage');
  $('#researchPrompt').value = 'Private unsent draft';
  context.currentUser = { id: 'u2' }; context.renderResearchChat();
  assert.equal($('#researchPrompt').value, '', 'Account changes clear the previous draft');
  assert.doesNotMatch($('#researchMessages').innerHTML, /Result/);
  context.currentUser = { id: 'u1' }; context.renderResearchChat();
  failed = true; $('#researchPrompt').value = 'Retry this question';
  await context.submitResearchQuestion(event);
  assert.match($('#researchError').textContent, /temporarily unavailable/);
  assert.equal($('#researchPrompt').value, 'Retry this question', 'Failures preserve the question for retry');
  assert.equal($('#researchSend').disabled, false);
  context.currentUser = null; context.renderResearchChat();
  assert.equal($('#researchSend').disabled, true);
  assert.doesNotMatch($('#researchMessages').innerHTML, /Result/);
  console.log('Research UI passed: modal modes, duplicate prevention, saved chat, safe output and source links, account isolation, draft privacy and retry.');
})().catch(error => { console.error(error); process.exitCode = 1; });
