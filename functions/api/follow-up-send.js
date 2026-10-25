import { coordinateBackup } from './backup-download.js';
import { coordinateResearchUsage } from './research-usage.js';
import { isFollowUpSendTime, followUpLocalDate } from './follow-up-calendar.js';
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

export function savedFollowUpDelivery(state, app, scheduledDate) {
  const address = value => String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || '';
  const recipient = address(app.email);
  const uniqueRecipient = recipient && state.applications.filter(item => address(item.email) === recipient).length === 1;
  const subjectFor = item => ('Follow-up application: ' + (String(item.role || '').trim() || 'position') + (String(item.platform || '').trim() ? ' — ' + item.platform.trim() : '')).toLowerCase();
  const uniqueSubject = state.applications.filter(item => address(item.email) === recipient && subjectFor(item) === subjectFor(app)).length === 1;
  const after = Date.parse(app.appliedDate || '') || 0;
  const evidence = [
    { sentAt: app.followUpSentAt, gmailId: app.followUpGmailId || '' },
    ...(state.emails || []).filter(email => {
      if (!(email.direction === 'sent' || email.source === 'sent' || email.labelIds?.includes('SENT'))) return false;
      const subject = String(email.subject || '').trim().replace(/^(?:(?:re|fw|fwd):\s*)+/i, '');
      const roleOnlyFollowUp = [String(app.role || '').trim() || 'position', 'Application for ' + (String(app.role || '').trim() || 'position')].some(value => value.toLowerCase() === subject.toLowerCase())
        && /I wanted to follow up on my application/i.test(email.body || '');
      if (email.emailType !== 'follow-up' && !/^follow(?:ing)?[\s-]*up\b/i.test(subject) && !roleOnlyFollowUp) return false;
      if (email.applicationId) return email.applicationId === app.id;
      return recipient && address(email.to) === recipient && (uniqueRecipient
        || (app.clientName && subject.toLowerCase() === `follow-up: ${app.clientName.trim()}`.toLowerCase())
        || (uniqueSubject && subject.toLowerCase() === subjectFor(app))
        || (roleOnlyFollowUp && state.applications.filter(item => address(item.email) === recipient && String(item.role || '').trim().toLowerCase() === String(app.role || '').trim().toLowerCase()).length === 1));
    }).map(email => ({ sentAt: email.date, gmailId: email.gmailId || '' }))
  ].filter(record => Number.isFinite(Date.parse(record.sentAt)) && Date.parse(record.sentAt) >= after
    && (followUpLocalDate(app, new Date(record.sentAt)) || String(record.sentAt).slice(0, 10)) >= scheduledDate);
  return evidence.sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt))[0] || null;
}

// This endpoint receives identifiers and delivery receipts only. Gmail tokens,
// recipients, subjects and message contents never pass through the coordinator.
export async function sendFollowUp(request, env, user) {
  if (!env.FOLLOW_UP_DELIVERIES) return reply({ error: 'Follow-up protection is unavailable. No email was sent.' }, 503);
  let input;
  try { input = await request.json(); } catch { return reply({ error: 'Invalid delivery request.' }, 400); }
  if (typeof input.applicationId !== 'string' || !input.applicationId || input.applicationId.length > 200
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledDate || '')
    || !['claim', 'complete', 'release'].includes(input.action)
    || (input.manual !== undefined && typeof input.manual !== 'boolean')
    || Object.keys(input).some(key => !['applicationId', 'scheduledDate', 'action', 'claimToken', 'sentAt', 'gmailId', 'manual'].includes(key))) {
    return reply({ error: 'Invalid delivery request.' }, 400);
  }
  if (input.action !== 'claim' && (typeof input.claimToken !== 'string' || input.claimToken.length > 100)) return reply({ error: 'Invalid delivery receipt.' }, 400);
  if (input.action === 'complete' && (!Number.isFinite(Date.parse(input.sentAt)) || typeof input.gmailId !== 'string' || input.gmailId.length > 200)) return reply({ error: 'Invalid delivery receipt.' }, 400);
  const saved = await fetch(`${env.SUPABASE_URL}/rest/v1/app_state?user_id=eq.${encodeURIComponent(user.id)}&select=data&limit=1`, {
    headers: { authorization: request.headers.get('authorization'), apikey: env.SUPABASE_PUBLISHABLE_KEY }, signal: AbortSignal.timeout(8000)
  });
  if (!saved.ok) return reply({ error: 'Could not verify the saved follow-up. No email was sent.' }, 503);
  const state = (await saved.json())?.[0]?.data;
  const app = state?.applications?.find(item => item.id === input.applicationId);
  if (!app) return reply({ error: 'The application no longer exists. No email was sent.' }, 409);
  const today = followUpLocalDate(app);
  const eligible = isFollowUpSendTime(app, input.scheduledDate) && !['Active client', 'Not selected'].includes(app.status) && (input.manual
    ? input.scheduledDate === (app.followUpDate || today)
    : app.automaticFollowUp === true && app.followUpDate === input.scheduledDate && input.scheduledDate <= today);
  const id = env.FOLLOW_UP_DELIVERIES.idFromName(JSON.stringify([user.id, app.id, input.scheduledDate]));
  return env.FOLLOW_UP_DELIVERIES.get(id).fetch(new Request('https://follow-up.internal/delivery', {
    method: 'POST', body: JSON.stringify({ ...input, eligible, ineligibleReason: !isFollowUpSendTime(app, input.scheduledDate) ? 'Follow-ups send Monday–Friday, 8:00 AM–5:00 PM in the client timezone. The schedule is kept for the next available sending window.' : '', savedDelivery: savedFollowUpDelivery(state, app, input.scheduledDate) })
  }));
}

// A durable reservation per account/application/date survives tabs, devices,
// reloads, cloud state overwrites and uncertain Gmail delivery. It never expires
// automatically: expiring a reservation could send a second accepted email.
export class FollowUpDelivery {
  constructor(ctx) { this.storage = ctx.storage; }
  async fetch(request) {
    const input = await request.json();
    if (new URL(request.url).pathname === '/backup') return coordinateBackup(this.storage, input);
    if (new URL(request.url).pathname === '/research-usage') return coordinateResearchUsage(this.storage, input);
    return this.storage.transaction(async txn => {
      const existing = await txn.get('delivery');
      if (existing?.status === 'sent') return reply(existing);
      // Saved delivery evidence also protects sends made before this reservation
      // existed, or recovered from Gmail after a receipt-save failure.
      if (input.savedDelivery) {
        const result = { status: 'sent', ...input.savedDelivery };
        await txn.put('delivery', result);
        return reply(result);
      }
      if (input.action === 'claim') {
        if (existing) return reply({ status: 'pending', startedAt: existing.startedAt, error: 'This follow-up is already sending or needs delivery review. Automatic resending is blocked.' });
        if (!input.eligible) return reply({ error: input.ineligibleReason || 'This follow-up is no longer scheduled for automatic sending.' }, 409);
        const record = { status: 'pending', claimToken: crypto.randomUUID(), startedAt: new Date().toISOString() };
        await txn.put('delivery', record);
        return reply({ status: 'claimed', claimToken: record.claimToken });
      }
      if (!existing || !input.claimToken || existing.claimToken !== input.claimToken) return reply({ error: 'Delivery reservation did not match.' }, 409);
      if (input.action === 'complete') {
        const result = { status: 'sent', sentAt: input.sentAt, gmailId: input.gmailId };
        await txn.put('delivery', result);
        return reply(result);
      }
      // Used only for an explicit Gmail rejection. A network timeout or lost
      // response never releases the reservation and never permits a retry.
      if (input.action === 'release') { await txn.delete('delivery'); return reply({ status: 'released' }); }
      return reply({ error: 'Invalid delivery action.' }, 400);
    });
  }
}
