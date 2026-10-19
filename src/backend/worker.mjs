import { onRequestGet as news, onRequestGetUsage as newsUsage } from '../../functions/api/news.js';
import { onRequestGet as tools } from '../../functions/api/tools.js';
import { refreshGmail } from '../../functions/api/gmail-refresh.js';

const reply = (error, status) => Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } });

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    const handler = path === '/api/news' ? news : path === '/api/news/usage' ? newsUsage : path === '/api/tools' ? tools : null;
    const isGmailRefresh = path === '/api/gmail/refresh';
    if (!handler && !isGmailRefresh) return reply('Endpoint not found.', 404);
    if (request.method !== (isGmailRefresh ? 'POST' : 'GET')) return reply('Method not allowed.', 405);
    const authorization = request.headers.get('authorization') || '';
    if (!/^Bearer \S+$/.test(authorization)) return reply('Sign in to view news.', 401);
    try {
      const auth = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: { authorization, apikey: env.SUPABASE_PUBLISHABLE_KEY },
        signal: AbortSignal.timeout(8000)
      });
      if (!auth.ok) return reply('Your session could not be verified. Sign in again.', auth.status === 401 || auth.status === 403 ? 401 : 503);
      const user = await auth.json();
      if (!user.id) return reply('Sign in to view news.', 401);
      if (isGmailRefresh) return refreshGmail(request, env);
      const response = await handler({ request, env, caches: globalThis.caches, waitUntil: promise => ctx.waitUntil(promise) });
      // Internal provider caching is shared only after authentication; browsers must revalidate.
      const headers = new Headers(response.headers);
      headers.set('cache-control', 'private, no-store');
      headers.set('x-content-type-options', 'nosniff');
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return reply('News is temporarily unavailable. Please try again later.', 503);
    }
  }
};
