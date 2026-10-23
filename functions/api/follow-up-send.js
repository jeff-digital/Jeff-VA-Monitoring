const reply = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

// This endpoint receives identifiers and delivery receipts only. Gmail tokens,
// recipients, subjects and message contents never pass through the coordinator.
export async function sendFollowUp(request, env, user) {
  if (!env.FOLLOW_UP_DELIVERIES) return reply({ error: 'Follow-up protection is unavailable. No email was sent.' }, 503);
  let input;
  try { input = await request.json(); } catch { return reply({ error: 'Invalid delivery request.' }, 400); }
  if (typeof input.applicationId !== 'string' || !input.applicationId || input.applicationId.length > 200
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledDate || '')
    || !['claim', 'complete', 'release'].includes(input.action)
    || Object.keys(input).some(key => !['applicationId', 'scheduledDate', 'action', 'claimToken', 'sentAt', 'gmailId'].includes(key))) {
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
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const eligible = app.automaticFollowUp === true && app.followUpDate === input.scheduledDate
    && input.scheduledDate <= today && !['Active client', 'Not selected'].includes(app.status);
  const id = env.FOLLOW_UP_DELIVERIES.idFromName(JSON.stringify([user.id, app.id, input.scheduledDate]));
  return env.FOLLOW_UP_DELIVERIES.get(id).fetch(new Request('https://follow-up.internal/delivery', {
    method: 'POST', body: JSON.stringify({ ...input, eligible })
  }));
}

// A durable reservation per account/application/date survives tabs, devices,
// reloads, cloud state overwrites and uncertain Gmail delivery. It never expires
// automatically: expiring a reservation could send a second accepted email.
export class FollowUpDelivery {
  constructor(ctx) { this.storage = ctx.storage; }
  async fetch(request) {
    const input = await request.json();
    return this.storage.transaction(async txn => {
      const existing = await txn.get('delivery');
      if (existing?.status === 'sent') return reply(existing);
      if (input.action === 'claim') {
        if (existing) return reply({ status: 'pending', error: 'This follow-up is already sending or needs delivery review. Automatic resending is blocked.' });
        if (!input.eligible) return reply({ error: 'This follow-up is no longer scheduled for automatic sending.' }, 409);
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
