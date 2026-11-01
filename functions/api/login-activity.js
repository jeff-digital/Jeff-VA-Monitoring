const DAY = 86400000;
const json = (body, status = 200) => Response.json(body, { status, headers: {
  'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff'
} });
const normalize = email => String(email || '').trim().toLowerCase();
const recent = (items, now) => (items || []).filter(item => Date.parse(item.at) > now - 30 * DAY).slice(0, 100);
async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function coordinator(env, key, body) {
  if (!env.FOLLOW_UP_DELIVERIES) throw new Error('Activity storage unavailable');
  const id = env.FOLLOW_UP_DELIVERIES.idFromName('login-activity:' + await digest(key));
  return env.FOLLOW_UP_DELIVERIES.get(id).fetch(new Request('https://internal/login-activity', {
    method: 'POST', body: JSON.stringify(body)
  }));
}
function context(request) {
  return { ip: (request.headers.get('CF-Connecting-IP') || '').slice(0, 64),
    device: (request.headers.get('user-agent') || 'Unknown device').slice(0, 300) };
}
export async function passwordLogin(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Origin not allowed.' }, 403);
  try {
    if (!request.body) return json({ error: 'Invalid sign-in request.' }, 400);
    const reader = request.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 8000) { await reader.cancel(); return json({ error: 'Invalid sign-in request.' }, 400); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const raw = new TextDecoder().decode(bytes);
    let input;
    try { input = JSON.parse(raw); } catch { return json({ error: 'Invalid sign-in request.' }, 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ error: 'Invalid sign-in request.' }, 400);
    const email = normalize(input.email);
    if (!email || email.length > 320 || !email.includes('@') || typeof input.password !== 'string'
      || !input.password || input.password.length > 4096 || Object.keys(input).some(key => !['email', 'password'].includes(key))) {
      return json({ error: 'Enter your email and password.' }, 400);
    }
    const metadata = context(request);
    const event = { id: crypto.randomUUID(), at: new Date().toISOString(), result: 'interrupted', provider: 'Email and password', ...metadata };
    // Cloudflare sets this header. Never trust browser-supplied X-Forwarded-For.
    const limit = await coordinator(env, 'rate:' + (metadata.ip || 'unknown'), { action: 'rate' });
    if (!limit.ok) {
      event.result = 'rate_limited';
      if (!(await coordinator(env, 'email:' + email, { action: 'record', event })).ok) throw new Error('Activity storage unavailable');
      return json({ error: 'Too many sign-in attempts. Try again in five minutes.' }, 429);
    }
    if (!(await coordinator(env, 'email:' + email, { action: 'record', event })).ok) throw new Error('Activity storage unavailable');
    let upstream, session;
    try {
      upstream = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: input.password }), signal: AbortSignal.timeout(15000)
      });
      session = await upstream.json();
    } catch { return json({ error: 'Sign-in is temporarily unavailable. Please try again.' }, 503); }
    const success = upstream.ok && Boolean(session.access_token && session.refresh_token && session.user?.id);
    event.result = success ? 'successful' : session.error_code === 'invalid_credentials' ? 'failed' : 'not_completed';
    if (success && session.user.last_sign_in_at) event.signInId = `${session.user.id}:${session.user.last_sign_in_at}`;
    if (!(await coordinator(env, 'email:' + email, { action: 'record', event })).ok) throw new Error('Activity storage unavailable');
    if (success) return json(session);
    return json({ error: upstream.status === 429 ? 'Too many sign-in attempts. Please try again later.'
      : upstream.status >= 500 ? 'Sign-in is temporarily unavailable. Please try again.'
        : 'Sign-in could not be completed. Check your email and password, and confirm your account if needed.' }, upstream.status === 429 ? 429 : upstream.status >= 500 ? 503 : 400);
  } catch { return json({ error: 'Secure sign-in tracking is unavailable. Please try again shortly.' }, 503); }
}
export async function loginActivity(request, env, user) {
  if (!user.email || !user.email_confirmed_at) return json({ error: 'A verified account email is required.' }, 403);
  try {
    const key = 'email:' + normalize(user.email);
    if (request.method === 'POST') {
      // Only a server-verified, recent Supabase sign-in can create a success event.
      const at = Date.parse(user.last_sign_in_at);
      if (!Number.isFinite(at) || Math.abs(Date.now() - at) > 5 * 60000) return json({ recorded: false });
      const event = { id: crypto.randomUUID(), signInId: `${user.id}:${user.last_sign_in_at}`, at: user.last_sign_in_at,
        result: 'successful', provider: user.app_metadata?.provider === 'google' ? 'Google' : 'Email and password', ...context(request) };
      const result = await coordinator(env, key, { action: 'record', event });
      if (!result.ok) throw new Error('Activity storage unavailable');
      return json({ recorded: true });
    }
    const response = await coordinator(env, key, { action: 'list' });
    if (!response.ok) throw new Error('Activity storage unavailable');
    return json(await response.json());
  } catch { return json({ error: 'Login activity is temporarily unavailable.' }, 503); }
}
export async function coordinateLoginActivity(storage, input) {
  return storage.transaction(async tx => {
    const now = Date.now();
    if (input.action === 'rate') {
      const times = ((await tx.get('login-rate')) || []).filter(t => t > now - 5 * 60000);
      if (times.length >= 20) return json({ allowed: false }, 429);
      await tx.put('login-rate', [...times, now]);
      await storage.setAlarm(now + 5 * 60000);
      return json({ allowed: true });
    }
    let events = recent(await tx.get('login-events'), now);
    if (input.action === 'record') {
      const event = input.event;
      if (event.signInId && events.some(e => e.signInId === event.signInId && e.id !== event.id)) return json({ recorded: false });
      events = [event, ...events.filter(e => e.id !== event.id)].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 100);
    }
    await tx.put('login-events', events);
    if (events.length) await storage.setAlarm(Math.min(...events.map(e => Date.parse(e.at))) + 30 * DAY + 1000);
    return json({ events });
  });
}
export async function expireLoginActivity(storage) {
  const events = recent(await storage.get('login-events'), Date.now());
  await storage.delete('login-rate');
  if (!events.length) { await storage.delete('login-events'); return; }
  await storage.put('login-events', events);
  await storage.setAlarm(Math.min(...events.map(e => Date.parse(e.at))) + 30 * DAY + 1000);
}
