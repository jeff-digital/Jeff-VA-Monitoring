import assert from 'node:assert/strict';
import { applicationProgressMetrics, progressAssessment, reviewApplicationProgress, validateProgressReview } from '../functions/api/application-progress.js';
import worker from '../src/backend/worker.mjs';

const user = { id: 'progress-user', email: 'owner@example.com' };
const state = { weeklyActivityGoal: 14, applications: [
  { id: 'app', platform: 'Direct client', email: 'client@example.com', clientName: 'Private Company', role: 'Editor', appliedDate: '2026-10-19', followUpDate: '2026-10-20', status: 'Applied' },
  { id: 'old', appliedDate: '2026-10-12', interviewDate: '2026-10-20', status: 'Interview' }
], emails: [
  { id: 'reply', gmailId: 'g1', from: 'client@example.com', date: '2026-10-20T02:00:00Z', body: 'Private message content' },
  { id: 'reply-copy', gmailId: 'g1', from: 'client@example.com', date: '2026-10-20T02:00:00Z' },
  { id: 'sent', direction: 'sent', from: user.email, to: 'client@example.com', subject: 'Follow-up: Company', applicationId: 'app', date: '2026-10-20T03:00:00Z' },
  { id: 'newsletter', from: 'client@example.com', automatedMessage: true, date: '2026-10-20T03:00:00Z' },
  { id: 'future', from: 'client@example.com', date: '2026-11-02T03:00:00Z' }
] };
const frozen = JSON.stringify(state);
const metrics = applicationProgressMetrics(state, user, new Date('2026-10-21T04:00:00Z'));
assert.equal(metrics.start, '2026-10-19');
assert.equal(metrics.previousThrough, '2026-10-14');
assert.deepEqual(metrics.current, { applications: 1, matchedReplies: 1, interviews: 1, followUpsSent: 1 });
assert.equal(metrics.previous.applications, 1);
assert.equal(metrics.expectedGoalSoFar, 6);
assert.equal(metrics.overdue, 0, 'Confirmed sent follow-up is not overdue');
const importedOnly = structuredClone(state);
delete importedOnly.emails.find(email => email.id === 'sent').applicationId;
assert.equal(applicationProgressMetrics(importedOnly, user, new Date('2026-10-21T04:00:00Z')).overdue, 0, 'Imported sent evidence also excludes completed follow-ups');
assert.equal(progressAssessment(metrics), 'needs_attention', 'Behind the user-defined pace');
const empty = applicationProgressMetrics({}, user, new Date('2026-10-18T16:01:00Z'));
assert.equal(empty.start, '2026-10-19', 'Weeks use Philippine midnight, not the host timezone');
assert.equal(progressAssessment(empty), 'insufficient_data');
assert.equal(progressAssessment({ ...metrics, weeklyGoal: null, overdue: 0 }), 'on_track', 'Recorded interview/reply supplies positive evidence');
assert.equal(progressAssessment({ ...metrics, overdue: 1 }), 'needs_attention');
assert.equal(metrics.openWork.followUpNotScheduled, 0, 'An interview-stage application is not treated as an unanswered initial application');
const guidanceState = { applications: [], emails: [], toApply: [{ dueDate: '2026-10-01' }] };
for (let i = 0; i < 12; i++) guidanceState.applications.push({ id: `cohort-${i}`, clientName: `Private employer ${i}`, role: 'Editor', email: `employer${i}@example.com`, platform: i < 6 ? 'Direct client' : 'Indeed', status: 'Applied', appliedDate: i < 6 ? '2026-10-10' : '2026-09-26' });
for (const i of [0, 6, 7, 8]) guidanceState.emails.push({ id: `response-${i}`, from: `employer${i}@example.com`, date: i < 6 ? '2026-10-12' : '2026-09-28' });
guidanceState.emails.push({ id: 'late-response', from: 'employer1@example.com', date: '2026-10-20' });
guidanceState.applications.push({ id: 'unfinished', clientName: '', role: '', email: 'N/A', platform: 'Direct client', status: 'Applied', appliedDate: '2026-10-01', followUpDate: '2026-10-04' });
const guidance = applicationProgressMetrics(guidanceState, user, new Date('2026-10-25T04:00:00Z'));
assert.equal(guidance.responseAnalysis.recent.applications, 6);
assert.equal(guidance.responseAnalysis.recent.repliedApplications, 1, 'Late replies do not inflate a fixed first-seven-day response rate');
assert.equal(guidance.responseAnalysis.previous.repliedApplications, 3);
assert.equal(guidance.openWork.directClientEmailMissing, 1);
assert.equal(guidance.openWork.overdueToApplyReminders, 1);
assert.ok(guidance.openWork.followUpNotScheduled > 0);
assert.equal(guidance.applicationChecks[0].applicationId, 'unfinished', 'Overdue unfinished records are prioritized');
assert.ok(guidance.applicationChecks[0].issues.some(issue => issue.includes('email')));
assert.equal(progressAssessment(guidance), 'needs_attention');
assert.equal(JSON.stringify(state), frozen, 'Review does not mutate records');
assert.equal(validateProgressReview('not JSON'), null);
assert.equal(validateProgressReview({ summary: 'OK', nextSteps: [] }), null);

const originalFetch = globalThis.fetch;
let modelCalls = 0;
let hold;
let modelGate = Promise.resolve();
let malformed = false;
const env = { SUPABASE_URL: 'https://saved.test', SUPABASE_PUBLISHABLE_KEY: 'public', AI: { run: async (model, input) => {
  modelCalls++;
  const prompt = JSON.stringify(input.messages);
  for (const secret of ['Private Company', 'client@example.com', 'Private message content', 'progress-user']) assert.ok(!prompt.includes(secret), 'Model receives aggregates only');
  assert.ok(model.includes('llama-3.3'));
  await modelGate;
  assert.ok(prompt.includes('openWork') && prompt.includes('responseAnalysis'), 'AI receives response diagnostics and unfinished-work counts');
  assert.ok(!prompt.includes('applicationChecks'), 'Named application checks stay outside the AI prompt');
  return { response: malformed ? '{}' : { summary: 'Review your application pace and follow-ups.', findings: ['Your records show unfinished tracking details.'], possibleReasons: ['A possibility to test is whether a more specific opening helps; message quality has not been assessed.'], nextSteps: ['Keep application dates up to date.'] } };
} } };
globalThis.fetch = async (url, options) => {
  if (String(url).includes('/auth/v1/user')) return Response.json(user);
  assert.ok(String(url).includes(`user_id=eq.${user.id}`) || String(url).includes('user_id=eq.other') || String(url).includes('user_id=eq.invalid'));
  assert.equal(options.headers.authorization, 'Bearer session');
  return Response.json([{ data: state }]);
};
const request = body => new Request('https://app/api/application-progress', { method: 'POST', headers: { authorization: 'Bearer session' }, body: JSON.stringify(body) });
try {
  assert.equal((await worker.fetch(new Request('https://app/api/application-progress', { method: 'POST' }), env, {})).status, 401);
  assert.equal((await worker.fetch(new Request('https://app/api/application-progress'), env, {})).status, 405);
  assert.equal((await reviewApplicationProgress(request({ arbitraryMetrics: 999 }), env, user)).status, 400, 'Browser cannot supply its own metrics');
  modelGate = new Promise(resolve => { hold = resolve; });
  const concurrent = [reviewApplicationProgress(request({}), env, user), reviewApplicationProgress(request({}), env, user)];
  await new Promise(resolve => setTimeout(resolve, 0));
  hold();
  const results = await Promise.all(concurrent);
  assert.equal(modelCalls, 1, 'Concurrent requests share one inference');
  assert.equal(results[0].status, 200);
  assert.equal((await (await worker.fetch(request({}), env, {})).json()).cached, true);
  assert.equal(modelCalls, 1, 'Identical activity uses cached review');
  state.weeklyActivityGoal = 15;
  assert.equal((await reviewApplicationProgress(request({}), env, user)).status, 429, 'Changed activity still respects cooldown');
  assert.equal((await reviewApplicationProgress(request({}), env, { id: 'other' })).status, 200);
  assert.equal(modelCalls, 2, 'Accounts do not share cached results');
  malformed = true;
  assert.equal((await reviewApplicationProgress(request({}), env, { id: 'invalid' })).status, 503);
  assert.equal((await reviewApplicationProgress(request({}), { ...env, AI: undefined }, user)).status, 503);
} finally { globalThis.fetch = originalFetch; }
console.log('Progress review checks passed: metrics, comparison windows, privacy, read-only behavior, authentication, concurrency, caching, cooldown, account isolation and provider errors.');
