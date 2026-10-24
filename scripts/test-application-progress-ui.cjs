const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/frontend/js/modules/pages/07d-application-progress-ai.js', 'utf8');
const nodes = new Map();
const $ = selector => {
  if (!nodes.has(selector)) nodes.set(selector, { textContent: '', innerHTML: '', hidden: false, disabled: false, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } });
  return nodes.get(selector);
};
const metrics = { start: '2026-10-19', through: '2026-10-25', previousStart: '2026-10-12', previousThrough: '2026-10-18', current: { applications: 7, matchedReplies: 2, interviews: 1, followUpsSent: 2 }, previous: { applications: 5, matchedReplies: 1, interviews: 0, followUpsSent: 1 }, overdue: 0, weeklyGoal: 7 };
metrics.responseAnalysis = { recent: { start: '2026-10-04', end: '2026-10-17', applications: 6, repliedApplications: 1, replyRate: 17 }, previous: { start: '2026-09-20', end: '2026-10-03', applications: 6, repliedApplications: 3, replyRate: 50 }, minimumSample: 5, bySource: [{ source: 'Direct client', applications: 3, repliedApplications: 1, replyRate: 33 }] };
metrics.applicationChecks = [{ applicationId: 'review-app', company: '<img src=x>', role: 'Editor', issues: ['Record the role or missing posting details.'] }];
const opened = [];
let requests = 0, renewals = 0, respond = () => Response.json({ status: 'on_track', summary: '<script>unsafe</script>', nextSteps: ['<img src=x onerror=bad>'], metrics, reviewedAt: new Date().toISOString() });
const session = { access_token: 'session', user: { id: 'u1' } };
const context = vm.createContext({ $, currentUser: null, dataReady: false, AbortSignal,
  data: { applications: [{ id: 'review-app' }] }, showView: view => opened.push(view), openClientModal: id => opened.push(id),
  escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
  requireSupabase: () => ({ auth: { getSession: async () => ({ data: { session } }) } }),
  renewEmailAiSession: async () => { renewals++; return session; },
  fetch: async (url, options) => { requests++; assert.equal(url, '/api/application-progress'); assert.equal(options.body, '{}'); return respond(); }
});
vm.runInContext(source, context);
context.renderApplicationProgressAi();
assert.equal($('#reviewApplicationProgress').disabled, true, 'Signed-out rendering does not crash or request AI');
assert.equal(requests, 0);
(async () => {
  context.currentUser = { id: 'u1' }; context.dataReady = true;
  context.renderApplicationProgressAi();
  assert.equal($('#reviewApplicationProgress').disabled, false);
  let release;
  respond = () => new Promise(resolve => { release = () => resolve(Response.json({ status: 'on_track', summary: '<script>unsafe</script>', nextSteps: ['<img src=x onerror=bad>'], metrics, reviewedAt: new Date().toISOString() })); });
  const first = context.requestApplicationProgressReview();
  await Promise.resolve(); await Promise.resolve();
  await context.requestApplicationProgressReview();
  assert.equal(requests, 1, 'Repeated clicks cannot start overlapping requests');
  assert.equal($('#reviewApplicationProgress').disabled, true);
  release(); await first;
  assert.equal($('#applicationProgressAiResult').hidden, false);
  assert.match($('#applicationProgressAiResult').innerHTML, /&lt;script&gt;/);
  assert.doesNotMatch($('#applicationProgressAiResult').innerHTML, /<script>|<img/);
  assert.match($('#applicationProgressAiResult').innerHTML, /Are replies improving\?/);
  assert.match($('#applicationProgressAiResult').innerHTML, /small sample/);
  assert.match($('#applicationProgressAiResult').innerHTML, /Applications to review/);
  $('#applicationProgressAiResult').handlers.click({ target: { closest: () => ({ dataset: { progressApplication: 'review-app' } }) } });
  assert.deepEqual(opened, ['applications', 'review-app'], 'An explicit click opens the relevant application without changing it');
  let expired = true;
  respond = () => { if (expired) { expired = false; return Response.json({}, { status: 401 }); } return Response.json({ error: 'AI is unavailable' }, { status: 503 }); };
  await context.requestApplicationProgressReview();
  assert.equal(renewals, 1, 'Expired dashboard session is renewed once');
  assert.match($('#applicationProgressAiStatus').textContent, /AI is unavailable/);
  assert.equal($('#applicationProgressAiResult').hidden, false, 'Prior review remains visible if refresh fails');
  respond = () => { context.currentUser = { id: 'u2' }; return Response.json({ status: 'on_track', summary: 'Private old account result', nextSteps: ['Do something'], metrics }); };
  session.user.id = 'u1';
  await context.requestApplicationProgressReview();
  assert.equal($('#applicationProgressAiResult').innerHTML, '', 'An old account response is ignored after account switch');
  context.currentUser = null;
  context.renderApplicationProgressAi();
  assert.equal($('#applicationProgressAiResult').hidden, true);
  console.log('Progress UI checks passed: signed-out rendering, click locking, escaped output, auth renewal, failure recovery, and account changes.');
})().catch(error => { console.error(error); process.exitCode = 1; });
