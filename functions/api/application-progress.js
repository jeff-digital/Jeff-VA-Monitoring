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

const sourceCategory = value => {
  const name = String(value || '').trim().toLowerCase();
  const known = { 'direct client': 'Direct client', 'direct apply': 'Direct client', 'onlinejobs.ph': 'OnlineJobs.ph', indeed: 'Indeed', jobstreet: 'Jobstreet', 'remote work ph': 'Remote Work PH', '20four7va': '20four7VA', multiplymii: 'MultiplyMii', zirtual: 'Zirtual', linkedin: 'LinkedIn', upwork: 'Upwork' };
  return Object.hasOwn(known, name) ? known[name] : 'Other / unspecified';
};
const missing = value => !String(value || '').trim() || /^(?:n\/?a|not set|none|unknown)$/i.test(String(value).trim());

function applicationGuidance(state, applications, emails, replyLinks, today) {
  const within = (date, start, end) => dayKey(date) >= start && dayKey(date) <= end;
  // Equal cohorts with a complete first-seven-calendar-day observation window.
  const cohort = (start, end, selected = applications) => {
    const records = selected.filter(app => within(app.appliedDate, start, end));
    const repliedApplications = records.filter(app => replyLinks.some(({ email, applicationId }) => applicationId === app.id
      && dayKey(email.date) >= dayKey(app.appliedDate) && dayKey(email.date) < shift(dayKey(app.appliedDate), 7))).length;
    return { start, end, applications: records.length, repliedApplications, replyRate: records.length ? Math.round(repliedApplications / records.length * 100) : null };
  };
  const recentStart = shift(today, -21), recentEnd = shift(today, -8);
  const recent = cohort(recentStart, recentEnd), previous = cohort(shift(today, -35), shift(today, -22));
  const bySource = [...new Set(applications.filter(app => within(app.appliedDate, recentStart, recentEnd)).map(app => sourceCategory(app.platform)))].map(source => ({
    source, ...cohort(recentStart, recentEnd, applications.filter(app => sourceCategory(app.platform) === source))
  })).sort((a, b) => b.applications - a.applications);
  const openWork = { pendingApplications: 0, noReplyAfter7Days: 0, followUpNotScheduled: 0, missingRole: 0, missingCompany: 0, directClientEmailMissing: 0, missingJobLink: 0,
    overdueToApplyReminders: (state.toApply || []).filter(item => item.dueDate && item.dueDate < today && !item.completed).length,
    upcomingInterviews: applications.filter(app => within(app.interviewDate, today, shift(today, 7))).length };
  const checks = [];
  for (const app of applications) {
    if (['Active client', 'Not selected', 'Rejected'].includes(app.status)) continue;
    const applied = dayKey(app.appliedDate);
    if (applied && applied > today) continue;
    openWork.pendingApplications++;
    const issues = [];
    const hasReply = replyLinks.some(link => link.applicationId === app.id) || ['Interview', 'Offer', 'To Proceed', 'To Proceeding'].includes(app.status);
    const waiting = applied && applied <= shift(today, -7) && !hasReply;
    const sentFollowUp = applied && savedFollowUpDelivery({ ...state, applications, emails }, app, applied);
    if (app.followUpDate && app.followUpDate < today && !savedFollowUpDelivery({ ...state, applications, emails }, app, app.followUpDate)) issues.push('An unsent follow-up is overdue.');
    if (sourceCategory(app.platform) === 'Direct client' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(app.email || '').trim())) {
      openWork.directClientEmailMissing++; issues.push('Add or verify the client email before attempting email follow-ups.');
    }
    if (missing(app.role)) { openWork.missingRole++; issues.push('Record the role so you can review job fit and tailor your application.'); }
    if (missing(app.clientName)) { openWork.missingCompany++; issues.push('Add the company name to keep applications and replies identifiable.'); }
    if (waiting) openWork.noReplyAfter7Days++;
    if (waiting && !app.followUpDate && !sentFollowUp) {
      openWork.followUpNotScheduled++; issues.push('No matched reply after at least 7 days; review whether one appropriate follow-up should be scheduled.');
    }
    if (missing(app.website)) { openWork.missingJobLink++; issues.push('Save the job-posting link, if available, to review the employer requirements.'); }
    if (issues.length) checks.push({ applicationId: app.id, company: app.clientName || 'Unnamed application', role: app.role || 'Role not recorded', issues,
      priority: app.followUpDate && app.followUpDate < today ? 0 : waiting ? 1 : 2 });
  }
  return { responseAnalysis: { recent, previous, bySource, minimumSample: 5, definition: 'Applications receiving a uniquely matched non-automated reply in their first 7 calendar days. Both cohorts have had at least 8 days to mature.' },
    openWork, applicationChecks: checks.sort((a, b) => a.priority - b.priority).slice(0, 6).map(({ priority, ...check }) => check) };
}

export function applicationProgressMetrics(state, user, now = new Date()) {
  const today = dayKey(now);
  const elapsedDays = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7 + 1;
  const start = shift(today, 1 - elapsedDays);
  const previousStart = shift(start, -7), previousEnd = shift(today, -7);
  const applications = Array.isArray(state.applications) ? state.applications : [];
  const own = new Set([user.email, ...(user.identities || []).map(item => item.identity_data?.email)].filter(Boolean).map(address));
  const sent = email => email.direction === 'sent' || email.source === 'sent' || email.labelIds?.includes('SENT') || own.has(address(email.from));
  const emails = [...new Map((state.emails || []).map(email => [email.gmailId || email.id, email])).values()];
  const replyLinks = emails.filter(email => !sent(email) && !email.automatedMessage && dayKey(email.date) && dayKey(email.date) <= today
    && !/\b(?:no[._-]?reply|donotreply)\b/i.test(address(email.from))).flatMap(email => {
      const matches = applicationEmailCandidates(applications, email);
      return matches.length === 1 ? [{ email, applicationId: matches[0].id }] : [];
    });
  const replies = replyLinks.map(link => link.email);
  const followUps = emails.filter(email => sent(email) && (email.emailType === 'follow-up' || /^follow(?:ing)?[\s-]*up\b/i.test(email.subject || ''))
    && (applications.some(app => app.id === email.applicationId) || applications.some(app => address(app.email) === address(email.to))));
  const within = (value, from, until) => { const key = dayKey(value); return key && key >= from && key <= until; };
  const period = (from, until) => ({
    applications: applications.filter(app => within(app.appliedDate, from, until)).length,
    matchedReplies: replies.filter(email => within(email.date, from, until)).length,
    interviews: applications.filter(app => within(app.interviewDate, from, until)).length,
    followUpsSent: followUps.filter(email => within(email.date, from, until)).length
  });
  const outstanding = applications.filter(app => !['Active client', 'Not selected', 'Rejected'].includes(app.status) && app.followUpDate && app.followUpDate <= today
    && !savedFollowUpDelivery({ ...state, applications, emails }, app, app.followUpDate));
  const goalValue = Number(state.weeklyActivityGoal);
  const weeklyGoal = Number.isInteger(goalValue) && goalValue >= 1 && goalValue <= 100 ? goalValue : null;
  return { timeZone: 'Asia/Manila', start, through: today, previousStart, previousThrough: previousEnd, elapsedDays,
    weeklyGoal, expectedGoalSoFar: weeklyGoal ? Math.ceil(weeklyGoal * elapsedDays / 7) : null,
    current: period(start, today), previous: period(previousStart, previousEnd),
    dueToday: outstanding.filter(app => app.followUpDate === today).length,
    overdue: outstanding.filter(app => app.followUpDate < today).length,
    ...applicationGuidance(state, applications, emails, replyLinks, today) };
}

export function progressAssessment(metrics) {
  if (metrics.overdue > 0) return 'needs_attention';
  if (metrics.openWork?.directClientEmailMissing > 0 || metrics.openWork?.followUpNotScheduled > 0) return 'needs_attention';
  const response = metrics.responseAnalysis;
  if (response?.recent.applications >= 5 && (response.recent.repliedApplications === 0
    || (response.previous.applications >= 5 && response.recent.replyRate < response.previous.replyRate))) return 'needs_attention';
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
    || !Array.isArray(result.nextSteps) || result.nextSteps.length < 1 || result.nextSteps.length > 5
    || !Array.isArray(result.findings) || result.findings.length < 1 || result.findings.length > 4
    || !Array.isArray(result.possibleReasons) || result.possibleReasons.length > 3
    || [...result.nextSteps, ...result.findings, ...result.possibleReasons].some(step => typeof step !== 'string' || !step.trim() || step.length > 300)) return null;
  return { summary: result.summary.trim(), findings: result.findings.map(step => step.trim()), possibleReasons: result.possibleReasons.map(step => step.trim()), nextSteps: result.nextSteps.map(step => step.trim()) };
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
    const { applicationChecks, ...aggregateMetrics } = metrics;
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
      const list = (min, max) => ({ type: 'array', items: { type: 'string' }, minItems: min, maxItems: max });
      const schema = { type: 'object', properties: { summary: { type: 'string' }, findings: list(1, 4), possibleReasons: list(0, 3), nextSteps: list(1, 5) }, required: ['summary', 'findings', 'possibleReasons', 'nextSteps'], additionalProperties: false };
      const model = await env.AI.run(MODEL, { temperature: 0, max_tokens: 1400, response_format: { type: 'json_schema', json_schema: schema },
        messages: [{ role: 'system', content: `You are a practical job-application coach. Use only supplied aggregate evidence. Return the required JSON. In summary explain whether activity is improving and the highest priority. In findings give 1-4 concrete observations, including positive evidence when available, and unfinished work from openWork. In possibleReasons give 0-3 clearly tentative explanations or tests for low replies, explicitly marking them as possibilities, not proven causes. In nextSteps give 1-5 prioritized, specific changes to try and why, starting with overdue/unscheduled follow-ups and missing direct-client contact details when present. Do not recommend repeated follow-ups that are already confirmed sent. Suggest reviewing job fit, tailoring a relevant opening and concise proof of work, or testing a clearer call to action only as experiments; you have not read the resume, portfolio, posting or application message and cannot judge their quality. Missing tracker fields do not prove an application was incomplete or unsent. Never invent employer intent, deliverability problems, statistics, causes, market benchmarks or guarantees of more responses. No hiring probabilities.
Weekly activity compares the same elapsed calendar days, Monday through the named day in Philippine time; today can be incomplete. ResponseAnalysis compares two equal older application cohorts using replies in each application's first 7 calendar days; both cohorts have fully matured. Use those computed reply rates, not weekly replies divided by weekly submissions. Do not rank sources or conclude a decline is meaningful with fewer than minimumSample applications in each compared group. Small samples, missing synced mail, excluded automated/no-reply addresses and imperfect matching limit confidence. State when a lower reply rate cannot yet be established. A reply is not necessarily positive; an interview date is scheduled, not confirmed attended. The supplied status is an activity signal, not a prediction. If insufficient_data, explain the limit and recommend what to track. Do not claim to edit records, create tasks or send emails.` },
        { role: 'user', content: JSON.stringify({ status, metrics: aggregateMetrics }) }] });
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
