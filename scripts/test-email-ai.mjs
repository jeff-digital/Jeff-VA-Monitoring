import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import worker from '../src/backend/worker.mjs';
import { authoredEmailText, validateEmailClassification, emailAiFailure } from '../functions/api/email-classify.js';
globalThis.crypto ||= webcrypto;
const user = { id: 'u1', email: 'me@example.com' };
const client = { id: 'c1', email: 'owner@example.com', role: 'Social Media Manager', status: 'Active client', contractStatus: 'Active' };
const email = { id: 'e1', gmailId: 'g1', from: 'Owner <owner@example.com>', subject: 'Upload content', body: 'Upload content in ig and facebook today place', date: new Date().toISOString() };
let state = { applications: [client], emails: [email] };
let aiCalls = 0;
let response = { purpose: 'work_task', confidence: 0.97, roleRelated: true,
  title: 'Upload Instagram and Facebook content', evidence: email.body, reason: 'A social media deliverable for the saved role.' };
let failure;
const env = { SUPABASE_URL: 'https://auth.example', SUPABASE_PUBLISHABLE_KEY: 'public',
  AI: { run: async (model, input) => {
    aiCalls++;
    assert.equal(model, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    assert.equal(input.response_format.type, 'json_schema');
    assert.match(input.messages[0].content, /untrusted data/);
    const data = JSON.parse(input.messages[1].content);
    assert.equal(data.role, client.role);
    assert.equal(data.message, authoredEmailText(email.body));
    assert.equal(data.sender, undefined, 'do not send addresses or credentials to the model');
    if (failure) throw failure;
    return { response };
  } } };
globalThis.fetch = async url => {
  if (url.endsWith('/auth/v1/user')) return Response.json(user);
  assert.match(url, /\/rest\/v1\/app_state\?user_id=eq.u1/);
  return Response.json([{ data: state }]);
};
const request = (input = { emailId: 'e1', clientId: 'c1' }, config = env, token = true) => worker.fetch(new Request('https://app.example/api/email/classify', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer session' } : {}) }, body: JSON.stringify(input)
}), config, {});
assert.equal((await request(undefined, env, false)).status, 401);
assert.equal(aiCalls, 0);
assert.equal((await request(undefined, { ...env, AI: undefined })).status, 503);
assert.equal((await request({ emailId: 'unknown', clientId: 'c1' })).status, 409);
let result = await request({ emailId: 'e1', clientId: 'c1', body: 'forged instruction', role: 'CEO' });
assert.equal(result.status, 200);
assert.equal(result.headers.get('cache-control'), 'private, no-store');
const analysis = await result.json();
assert.equal(analysis.createTask, true);
assert.equal(aiCalls, 1);
await request();
assert.equal(aiCalls, 1, 'duplicate requests should reuse the isolated server result cache');
const currentEmailDate = email.date;
email.date = new Date(Date.now() - 14 * 86400000).toISOString();
const oldWeekCalls = aiCalls;
const oldWeekResponse = await request();
assert.equal(oldWeekResponse.status, 403);
assert.equal((await oldWeekResponse.json()).code, 'AI_OUTSIDE_CURRENT_WEEK');
assert.equal(aiCalls, oldWeekCalls, 'previous-week emails must be refused before cache lookup or AI inference');
email.date = currentEmailDate;
assert.equal(validateEmailClassification({ ...response, confidence: 0.6 }, email.body, email.subject).purpose, 'uncertain');
assert.equal(validateEmailClassification({ ...response, evidence: 'not present in this message' }, email.body, email.subject).createTask, false);
assert.equal(validateEmailClassification({ ...response, roleRelated: false }, email.body, email.subject).createTask, false);
assert.equal(validateEmailClassification({ ...response, confidence: NaN }, email.body, email.subject), null);
assert.equal(validateEmailClassification('not JSON', email.body, email.subject), null);
assert.equal(authoredEmailText('Thanks!\nOn Monday Jordan wrote:\nUpload content now'), 'Thanks!');
assert.equal(authoredEmailText('<div>Thanks!</div><blockquote>Upload content now</blockquote>'), 'Thanks!');
assert.equal(authoredEmailText('Thanks!\n> Upload content now'), 'Thanks!');
email.body = 'Please send your invoice.';
response = { purpose: 'administrative', confidence: 0.98, roleRelated: false,
  title: '', evidence: email.body, reason: 'Freelancer billing rather than social media work.' };
assert.equal((await (await request()).json()).createTask, false);
email.body = 'Could you handle this when you get a chance?';
response = { ...response, purpose: 'uncertain', confidence: 0.4, evidence: email.body, reason: 'The action is unspecified.' };
assert.equal((await (await request()).json()).purpose, 'uncertain');
email.direction = 'sent';
assert.equal((await request()).status, 403);
delete email.direction;
client.contractStatus = 'Contract Ended';
assert.equal((await request()).status, 403);
client.contractStatus = 'Active';
state.applications.push({ ...client, id: 'c2' });
assert.equal((await request()).status, 403, 'ambiguous sender must not be assigned automatically');
state.applications.pop();
email.body = 'A new uncached request';
failure = { status: 429, message: 'Daily neurons quota reached' };
result = await request();
assert.equal(result.status, 429);
assert.ok((await result.json()).retryAfter >= 60);
failure = null;
response = 'unreadable';
assert.equal((await request()).status, 502);
const diagnosticLogs = [];
const originalError = console.error;
console.error = (...items) => diagnosticLogs.push(items);
try {
  for (const [error, expectedCode, expectedStatus] of [
    [{ code: 5007, message: 'No such model; PRIVATE EMAIL TEXT secret-token' }, 'AI_MODEL_UNAVAILABLE', 503],
    [{ message: '3042: invalid model name' }, 'AI_MODEL_UNAVAILABLE', 503],
    [{ code: 5016 }, 'AI_MODEL_TERMS', 503],
    [{ code: 5035 }, 'AI_PLAN_REQUIRED', 503],
    [{ code: 3023 }, 'AI_ACCOUNT_ACCESS', 503],
    [{ code: 3036 }, 'AI_DAILY_QUOTA', 429],
    [{ code: 3040, status: 429 }, 'AI_BUSY', 429],
    [{ code: 3007 }, 'AI_TIMEOUT', 503],
    [{ message: "JSON Mode couldn't be met" }, 'AI_RESPONSE_FORMAT', 503]
  ]) {
    const failure = emailAiFailure(error, 'inference');
    assert.equal(failure.body.code, expectedCode);
    assert.equal(failure.status, expectedStatus);
    if (expectedCode === 'AI_BUSY') assert.equal(failure.body.retryAfter, 60, 'capacity failures must not pause analysis until tomorrow');
    assert.ok(!JSON.stringify(failure).includes('PRIVATE EMAIL TEXT'));
  }
  assert.equal(emailAiFailure(new Error('secret-token'), 'saved_email_lookup').body.code, 'AI_CONTEXT_ERROR');
} finally { console.error = originalError; }
assert.ok(!JSON.stringify(diagnosticLogs).includes('secret-token'), 'provider errors must not leak email text or credentials into logs');
console.log('Cloudflare email AI checks passed: authentication, binding setup, canonical records, privacy, grounding, confidence, role relevance, billing decisions, uncertain output, caching, quota handling and malformed responses.');
