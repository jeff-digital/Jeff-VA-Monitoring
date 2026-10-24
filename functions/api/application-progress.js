import { applicationEmailCandidates } from './application-email-classify.js';
import { savedFollowUpDelivery } from './follow-up-send.js';

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const reviews = new Map();
const pending = new Map();
const attempts = new Map();
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });
const dayKey = value => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return value;
  const date = new Date(value || '');
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) : '';
};
const address = value => String(value || '').match(/<([^>]+)>/)?.[1]?.toLowerCase() || String(value || '').trim().toLowerCase();
const shift = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

export function applicationProgressMetrics(state, user, now = new Date()) {
  const today = dayKey(now);
  const elapsedDays = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7 + 1;
  const start = shift(today, 1 - elapsedDays);
  const previousStart = shift(start, -7), previousEnd = shift(today, -7);
  const applications = Array.isArray(state.applications) ? state.applications : [];
  const pipeline = applications.filter(app => app.status !== 'Active client');
  const own = new Set([user.email, ...(user.identities || []).map(item => item.identity_data?.email)].filter(Boolean).map(address));
  const sent = email => email.direction === 'sent' || email.source === 'sent' || email.labelIds?.includes('SENT') || own.has(address(email.from));
  const emails = [...new Map((state.emails || []).map(email => [email.gmailId || email.id, email])).values()];
  const replies = emails.filter(email => !sent(email) && !email.automatedMessage
    && !/\b(?:no[._-]?reply|donotreply)\b/i.test(address(email.from))
    && applicationEmailCandidates(pipeline, email).length === 1);
  const followUps = emails.filter(email => sent(email) && (email.emailType === 'follow-up' || /^follow(?:ing)?[\s-]*up\b/i.test(email.subject || ''))
    && (pipeline.some(app => app.id === email.applicationId) || pipeline.some(app => address(app.email) === address(email.to))));
  const within = (value, from, until) => { const key = dayKey(value); return key && key >= from && key <= until; };
  const period = (from, until) => ({
    applications: applications.filter(app => within(app.appliedDate, from, until)).length,
    matchedReplies: replies.filter(email => within(email.date, from, until)).length,
    interviews: applications.filter(app => within(app.interviewDate, from, until)).length,
    followUpsSent: followUps.filter(email => within(email.date, from, until)).length
  });
  const outstanding = pipeline.filter(app => !['Not selected', 'Rejected'].includes(app.status) && app.followUpDate && app.followUpDate <= today
    && !savedFollowUpDelivery({ ...state, applications, emails }, app, app.followUpDate));
  const goalValue = Number(state.weeklyActivityGoal);
  const weeklyGoal = Number.isInteger(goalValue) && goalValue >= 1 && goalValue <= 100 ? goalValue : null;
  return { timeZone: 'Asia/Manila', start, through: today, previousStart, previousThrough: previousEnd, elapsedDays,
    weeklyGoal, expectedGoalSoFar: weeklyGoal ? Math.ceil(weeklyGoal * elapsedDays / 7) : null,
    current: period(start, today), previous: period(previousStart, previousEnd),
    dueToday: outstanding.filter(app => app.followUpDate === today).length,
    overdue: outstanding.filter(app => app.followUpDate < today).length };
}

export function progressAssessment(metrics) {
  if (metrics.overdue > 0) return 'needs_attention';
  const sample = metrics.current.applications + metrics.previous.applications;
  if (sample < 5 && metrics.current.interviews === 0 && metrics.current.matchedReplies === 0) return 'insufficient_data';
  if (metrics.weeklyGoal && metrics.current.applications < metrics.expectedGoalSoFar) return 'needs_attention';
  if (metrics.previous.applications >= 5 && metrics.current.applications < metrics.previous.applications / 2) return 'needs_attention';
  if (metrics.weeklyGoal || metrics.current.interviews || metrics.current.matchedReplies) return 'on_track';
  return 'insufficient_data';
}

export function validateProgressReview(raw) {
  let result;
  try { result = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (!result || typeof result.summary !== 'string' || !result.summary.trim() || result.summary.length > 700
    || !Array.isArray(result.nextSteps) || result.nextSteps.length < 1 || result.nextSteps.length > 3
    || result.nextSteps.some(step => typeof step !== 'string' || !step.trim() || step.length > 240)) return null;
  return { summary: result.summary.trim(), nextSteps: result.nextSteps.map(step => step.trim()) };
}

// Read-only: server-derived counts are the only data provided to the model.
export async function reviewApplicationProgress(request, env, user) {
  let input;
  try { input = await request.json(); } catch { return reply({ error: 'Invalid review request.' }, 400); }
  if (!input || Array.isArray(input) || Object.keys(input).length) return reply({ error: 'The review uses your saved activity only.' }, 400);
  if (!env.AI?.run) return reply({ error: 'Progress AI is not available yet. Your tracker is unchanged.' }, 503);
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/app_state?user_id=eq.${encodeURIComponent(user.id)}&select=data&limit=1`, {
      headers: { authorization: request.headers.get('authorization'), apikey: env.SUPABASE_PUBLISHABLE_KEY }, signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return reply({ error: 'Saved activity could not be loaded. Please try again.' }, 503);
    const state = (await response.json())?.[0]?.data;
    if (!state) return reply({ error: 'Save some application activity before requesting a review.' }, 409);
    const metrics = applicationProgressMetrics(state, user);
    const status = progressAssessment(metrics);
    const signature = JSON.stringify(metrics);
    const cached = reviews.get(user.id);
    if (cached?.signature === signature && cached.expires > Date.now()) return reply({ ...cached.result, cached: true });
    if (pending.has(user.id)) return reply(await pending.get(user.id));
    if ((attempts.get(user.id) || 0) > Date.now() - 60000) return reply({ error: 'Please wait a minute before reviewing again.' }, 429);
    // Bound short-lived isolate caches; these do not consume the email check counter.
    for (const map of [reviews, attempts]) if (map.size >= 128) map.delete(map.keys().next().value);
    attempts.set(user.id, Date.now());
    const run = (async () => {
      const schema = { type: 'object', properties: { summary: { type: 'string' }, nextSteps: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 } }, required: ['summary', 'nextSteps'], additionalProperties: false };
      const model = await env.AI.run(MODEL, { temperature: 0, max_tokens: 500, response_format: { type: 'json_schema', json_schema: schema },
        messages: [{ role: 'system', content: 'Explain job-search activity using only the supplied aggregate counts. Return the required JSON. The status is an activity signal calculated by the app, not a hiring prediction. Explain the evidence for that status and give 1 to 3 practical next steps. Compare equivalent elapsed calendar days, Monday through the named day, in Philippine time; the current day can be incomplete. Matched replies exclude known automated and no-reply senders; they may not include every employer response. Interview counts are scheduled dates, not proof they took place. Weekly goals are the user\'s own targets. Never invent data, rates, employer intent, causes, guarantees or hiring probabilities. If status is insufficient_data, say evidence is too limited and suggest what to track. If needs_attention, be constructive and identify the measurable issue. Do not claim to change records or send emails.' },
        { role: 'user', content: JSON.stringify({ status, metrics }) }] });
      const review = validateProgressReview(model?.response);
      if (!review) throw new Error('invalid-output');
      const result = { ...review, status, metrics, reviewedAt: new Date().toISOString() };
      reviews.set(user.id, { signature, result, expires: Date.now() + 600000 });
      return result;
    })();
    pending.set(user.id, run);
    try { return reply(await run); }
    finally { if (pending.get(user.id) === run) pending.delete(user.id); }
  } catch {
    return reply({ error: 'AI progress review is temporarily unavailable. Please try again later. Your tracker is unchanged.' }, 503);
  }
}
