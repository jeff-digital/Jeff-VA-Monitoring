const DAILY_LIMIT = 20;
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

export async function researchUsage(env, userId, action = 'status') {
  if (!env.FOLLOW_UP_DELIVERIES) throw new Error('Usage protection is unavailable');
  const day = new Date().toISOString().slice(0, 10);
  const id = env.FOLLOW_UP_DELIVERIES.idFromName(JSON.stringify(['research-usage', userId]));
  const response = await env.FOLLOW_UP_DELIVERIES.get(id).fetch(new Request('https://research.internal/research-usage', {
    method: 'POST', body: JSON.stringify({ action, day, limit: DAILY_LIMIT })
  }));
  if (!response.ok) throw new Error('Usage protection is unavailable');
  return response.json();
}

export async function getResearchUsage(request, env, user) {
  try { return reply(await researchUsage(env, user.id)); }
  catch { return reply({ error: 'Assistant usage could not be checked. No AI request was started.' }, 503); }
}

export async function coordinateResearchUsage(storage, input) {
  return storage.transaction(async txn => {
    const existing = await txn.get('research-usage');
    const state = existing?.day === input.day ? existing : { day: input.day, used: 0 };
    const allowed = state.used < input.limit;
    if (input.action === 'reserve' && allowed) {
      state.used++;
      await txn.put('research-usage', state);
    }
    return reply({ day: input.day, used: state.used, limit: input.limit,
      remaining: Math.max(0, input.limit - state.used), allowed: input.action === 'reserve' ? allowed : state.used < input.limit,
      resetsAt: new Date(Date.parse(input.day + 'T00:00:00Z') + 86400000).toISOString(), scope: 'assistant-requests' });
  });
}
