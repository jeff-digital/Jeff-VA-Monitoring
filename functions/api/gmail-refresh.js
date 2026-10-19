// Called only after the Worker has verified the dashboard bearer session.
export async function refreshGmail(request, env) {
  const headers = { 'cache-control': 'private, no-store' };
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return Response.json({ error: 'Automatic Gmail renewal needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Cloudflare.' }, { status: 503, headers });
  }
  let input;
  try { input = await request.json(); } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400, headers });
  }
  if (typeof input?.refreshToken !== 'string' || !input.refreshToken || input.refreshToken.length > 8192) {
    return Response.json({ error: 'Gmail authorization is required.' }, { status: 400, headers });
  }
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: input.refreshToken,
        client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET }),
      signal: AbortSignal.timeout(10000)
    });
    const token = await response.json();
    if (!response.ok || !token.access_token) {
      return Response.json({ error: token.error === 'invalid_grant' ? 'Google permission needs to be renewed.' : 'Gmail renewal is temporarily unavailable.', reconnect: token.error === 'invalid_grant' }, { status: token.error === 'invalid_grant' ? 403 : 502, headers });
    }
    return Response.json({ access_token: token.access_token, expires_in: token.expires_in }, { headers });
  } catch {
    return Response.json({ error: 'Gmail renewal is temporarily unavailable.' }, { status: 503, headers });
  }
}
