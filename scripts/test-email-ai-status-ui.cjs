const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const nodes = new Map(), storage = new Map();
const node = key => {
  if (!nodes.has(key)) nodes.set(key, { dataset: {}, style: {}, events: {}, hidden: key === '#emailAiStatusDetails', textContent: '',
    addEventListener(type, handler) { (this.events[type] ||= []).push(handler); },
    contains(target) { return target === this || (key === '#emailAiStatusSummary' && ['#emailAiStatusTrigger', '#emailAiStatusDetails'].some(id => nodes.get(id) === target)); },
    closest() { return null; }, showPopover() { this.popoverOpen = true; }, hidePopover() { this.popoverOpen = false; },
    getBoundingClientRect: () => key === '#emailAiStatusTrigger' ? { right: 124, bottom: 90 } : { width: 320, height: 210 }
  });
  return nodes.get(key);
};
const document = { ...node('document'), activeElement: null };
const window = { ...node('window'), innerWidth: 400, innerHeight: 640 };
let requests = 0, release;
const context = vm.createContext({ $: node, document, window, setTimeout, clearTimeout, AbortSignal,
  currentUser: { id: 'u1' }, navigator: { onLine: true }, dataReady: true, supabaseDataLoaded: true,
  data: { emails: [], clientTasks: [] },
  localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  requireSupabase: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'session' } } }) } }),
  fetch: async () => { requests++; return new Promise(resolve => { release = resolve; }); }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/frontend/js/modules/pages/10a-email-client-tasks.js'), 'utf8'), context);
const dispatch = (target, type, event = {}) => target.events[type]?.forEach(handler => handler({ target, ...event }));
const summary = node('#emailAiStatusSummary'), trigger = node('#emailAiStatusTrigger'), details = node('#emailAiStatusDetails');
(async () => {
  context.renderEmailTaskAiStatus();
  assert.equal(summary.dataset.state, 'ready'); assert.equal(trigger.ariaBusy, 'false');
  assert.equal(node('#emailAiLastCheck').textContent, 'No successful check yet');
  dispatch(summary, 'mouseenter');
  assert.equal(details.hidden, false); assert.equal(details.popoverOpen, true); assert.equal(trigger.ariaExpanded, 'true');
  assert.equal(details.style.left, '16px', 'keep details inside a narrow viewport');
  assert.equal(requests, 0, 'hover must not run an AI request');
  dispatch(document, 'keydown', { key: 'Escape' });
  assert.equal(details.hidden, true); assert.equal(trigger.ariaExpanded, 'false');
  dispatch(summary, 'focusin'); assert.equal(details.hidden, false);
  dispatch(summary, 'focusout', { relatedTarget: node('outside') }); assert.equal(details.hidden, true);
  dispatch(trigger, 'click'); assert.equal(details.hidden, false);
  dispatch(document, 'click', { target: node('outside') }); assert.equal(details.hidden, true);
  assert.equal(requests, 0, 'focus and tap only open status details');

  const pending = context.analyzeClientEmail({ id: 'e1' }, { id: 'a1' }, 'scan', true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1); assert.equal(summary.dataset.state, 'processing');
  assert.equal(trigger.ariaBusy, 'true'); assert.equal(node('#clientEmailAiStatus').textContent, 'AI checking…');
  assert.match(node('#emailAiDetailsState').textContent, /outcome of application messages/);
  assert.equal(node('#emailAiLastCheck').textContent, 'No successful check yet', 'starting a check cannot claim success');
  release({ status: 200, ok: true, json: async () => ({ outcome: 'no_change', rejectApplication: false,
    confidence: 0.99, matchesApplication: true, reason: 'Interview invitation.', evidence: '' }) });
  const analysis = await pending;
  context.renderEmailTaskAiStatus('Email AI: application and active-client messages checked.');
  assert.equal(summary.dataset.state, 'ready'); assert.equal(trigger.ariaBusy, 'false');
  assert.equal(node('#clientEmailAiStatus').textContent, 'AI checked');
  assert.equal(node('#emailAiDetailsUsage').textContent, '1/40 checks');
  assert.equal(node('#emailAiLastCheck').textContent, new Date(analysis.analyzedAt).toLocaleString());
  const lastSuccess = node('#emailAiLastCheck').textContent;
  storage.set('email-task-ai-retry-v3:u1', JSON.stringify({ until: Date.now() + 60000, message: 'Cloudflare AI is busy. Will retry.' }));
  context.renderEmailTaskAiStatus();
  assert.equal(summary.dataset.state, 'attention'); assert.equal(trigger.ariaBusy, 'false');
  assert.equal(node('#clientEmailAiStatus').textContent, 'AI needs attention');
  assert.match(node('#emailAiDetailsState').textContent, /Cloudflare AI is busy/);
  assert.equal(node('#emailAiRetryRow').hidden, false); assert.ok(node('#emailAiRetryTime').textContent);
  assert.equal(node('#emailAiLastCheck').textContent, lastSuccess, 'errors must retain the last actual success');
  context.navigator.onLine = false; context.renderEmailTaskAiStatus();
  assert.equal(summary.dataset.state, 'offline'); assert.equal(node('#clientEmailAiStatus').textContent, 'AI offline');
  assert.equal(trigger.ariaBusy, 'false');
  context.navigator.onLine = true;
  context.currentUser = { id: 'u2' }; context.data = { emails: [], clientTasks: [] }; context.renderEmailTaskAiStatus();
  assert.equal(node('#emailAiLastCheck').textContent, 'No successful check yet');
  assert.equal(node('#emailAiDetailsUsage').textContent, '0/40 checks');
  assert.equal(details.hidden, true, 'account switches dismiss existing details');
  context.currentUser = null; context.renderEmailTaskAiStatus();
  assert.equal(summary.hidden, true); assert.equal(details.hidden, true);
  assert.equal(requests, 1);
  const css = fs.readFileSync(path.join(__dirname, '../src/frontend/css/styles.css'), 'utf8');
  assert.match(css, /data-state="processing"\] \.email-ai-spinner/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?\.email-ai-spinner \{ animation: none/);
  console.log('AI status UI passed: real in-flight loading, success timestamps, hover/focus/tap details without extra requests, dismissal, viewport positioning, errors, offline state and reduced motion.');
})().catch(error => { console.error(error); process.exitCode = 1; });
