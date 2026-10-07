const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff'
};

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function getConfig(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new RequestError(503, 'Onboarding is not configured yet.');
  }
  return {
    baseUrl: env.SUPABASE_URL.replace(/\/+$/, ''),
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY
  };
}

async function parseBody(request) {
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > 12000) throw new RequestError(413, 'The submitted form is too large.');
  const text = await request.text();
  if (text.length > 12000) throw new RequestError(413, 'The submitted form is too large.');
  try {
    return JSON.parse(text);
  } catch {
    throw new RequestError(400, 'The request is not valid JSON.');
  }
}

function cleanField(value, name, maximum, required = false) {
  if (typeof value !== 'string') throw new RequestError(400, `Enter a valid ${name}.`);
  const cleaned = value.trim();
  if (cleaned.length > maximum || (required && !cleaned)) {
    throw new RequestError(400, `Enter a valid ${name}.`);
  }
  return cleaned;
}

async function tokenHash(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(token)) {
    throw new RequestError(404, 'This onboarding link is invalid or no longer available.');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function supabaseRequest(config, path, options = {}) {
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...options,
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  if (!response.ok) throw new RequestError(502, 'The secure onboarding service could not complete the request.');
  return response.status === 204 ? null : response.json();
}

async function authenticatedUser(request, config) {
  const authorization = request.headers.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new RequestError(401, 'Sign in to manage client onboarding.');
  const response = await fetch(`${config.baseUrl}/auth/v1/user`, {
    headers: { apikey: config.serviceKey, Authorization: `Bearer ${match[1]}` }
  });
  if (!response.ok) throw new RequestError(401, 'Sign in to manage client onboarding.');
  const user = await response.json();
  if (!user?.id || user.is_anonymous) throw new RequestError(401, 'Sign in to manage client onboarding.');
  return user;
}

function assertSameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) {
    throw new RequestError(403, 'This request is not allowed.');
  }
}

async function getClient(config, userId, clientId) {
  const query = new URLSearchParams({ select: 'data', user_id: `eq.${userId}` });
  const rows = await supabaseRequest(config, `/rest/v1/app_state?${query}`);
  const applications = rows?.[0]?.data?.applications;
  const client = Array.isArray(applications)
    ? applications.find(item => String(item.id) === clientId && item.status === 'Active client')
    : null;
  if (!client) throw new RequestError(404, 'The active client could not be found.');
  return client;
}

async function createInvite(request, body, config) {
  assertSameOrigin(request);
  const user = await authenticatedUser(request, config);
  const clientId = cleanField(body.clientId, 'client', 200, true);
  const client = await getClient(config, user.id, clientId);
  const clientEmail = cleanField(client.email, 'client email', 320, true);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
    throw new RequestError(400, 'Add a valid email address to this active client first.');
  }

  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...randomBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const hash = await tokenHash(token);
  const expiry = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const issued = await supabaseRequest(config, '/rest/v1/rpc/issue_client_onboarding_invite', {
    method: 'POST',
    body: JSON.stringify({
      p_user_id: user.id,
      p_client_id: clientId,
      p_client_name: String(client.clientName || 'Client').slice(0, 200),
      p_client_email: clientEmail,
      p_token_hash: hash,
      p_expires_at: expiry
    })
  });
  if (issued !== true) {
    throw new RequestError(409, 'This client has already submitted onboarding. A second submission is not allowed.');
  }

  const link = new URL('/onboarding/', request.url);
  link.hash = `token=${token}`;
  return jsonResponse({ url: link.href });
}

async function getSubmission(request, body, config) {
  assertSameOrigin(request);
  const user = await authenticatedUser(request, config);
  const clientId = cleanField(body.clientId, 'client', 200, true);
  await getClient(config, user.id, clientId);
  const query = new URLSearchParams({
    select: 'client_name,client_email,contact_name,phone,timezone,availability,tools,priorities,submitted_at',
    user_id: `eq.${user.id}`,
    client_id: `eq.${clientId}`
  });
  const rows = await supabaseRequest(config, `/rest/v1/client_onboarding_submissions?${query}`);
  return jsonResponse({ submission: rows?.[0] || null });
}

async function lookupInvite(body, config) {
  const hash = await tokenHash(body.token);
  const query = new URLSearchParams({
    select: 'client_name,client_email,expires_at,submitted_at,revoked_at',
    token_hash: `eq.${hash}`
  });
  const rows = await supabaseRequest(config, `/rest/v1/client_onboarding_invites?${query}`);
  const invite = rows?.[0];
  if (!invite || invite.submitted_at || invite.revoked_at || new Date(invite.expires_at) <= new Date()) {
    throw new RequestError(404, 'This onboarding link is invalid or no longer available.');
  }
  return jsonResponse({ clientName: invite.client_name, clientEmail: invite.client_email });
}

async function submitInvite(body, config) {
  const hash = await tokenHash(body.token);
  const fields = {
    p_token_hash: hash,
    p_contact_name: cleanField(body.contactName, 'name', 120, true),
    p_phone: cleanField(body.phone, 'phone number', 80),
    p_timezone: cleanField(body.timezone, 'time zone', 120, true),
    p_availability: cleanField(body.availability, 'availability', 2000, true),
    p_tools: cleanField(body.tools, 'tools', 2000),
    p_priorities: cleanField(body.priorities, 'first-week priorities', 2000, true)
  };
  const submitted = await supabaseRequest(config, '/rest/v1/rpc/submit_client_onboarding', {
    method: 'POST',
    body: JSON.stringify(fields)
  });
  if (submitted !== true) {
    throw new RequestError(409, 'This onboarding link has expired or has already been submitted.');
  }
  return jsonResponse({ submitted: true });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
      throw new RequestError(415, 'This request is not supported.');
    }
    const config = getConfig(env);
    const body = await parseBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new RequestError(400, 'The request is not valid.');
    }
    if (request.headers.has('Authorization')) {
      if (body.action === 'createInvite') return await createInvite(request, body, config);
      if (body.action === 'getSubmission') return await getSubmission(request, body, config);
      throw new RequestError(400, 'This request is not supported.');
    }
    if (body.action === 'lookup') return await lookupInvite(body, config);
    if (body.action === 'submit') return await submitInvite(body, config);
    throw new RequestError(400, 'This request is not supported.');
  } catch (error) {
    if (error instanceof RequestError) return jsonResponse({ error: error.message }, error.status);
    console.error('Client onboarding request failed.');
    return jsonResponse({ error: 'The onboarding service could not complete the request.' }, 500);
  }
}

export async function onRequestGet() {
  return jsonResponse({ error: 'This request is not supported.' }, 405);
}
