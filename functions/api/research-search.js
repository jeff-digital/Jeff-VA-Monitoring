const clip = (value, max) => String(value || '').trim().slice(0, max);

export class TavilySearchError extends Error {
  constructor(message, code, stage = 'configuration', httpStatus) {
    super(message); this.code = code; this.stage = stage; this.httpStatus = httpStatus;
  }
}

async function tavilyRequest(path, options) {
  const stage = path === 'usage' ? 'usage check' : 'live search';
  let response;
  try {
    // Workers rejects redirect: 'error'. Manual mode preserves the same
    // no-forwarding policy; redirect responses are rejected below.
    response = await fetch('https://api.tavily.com/' + path, { ...options, redirect: 'manual',
      signal: AbortSignal.timeout(path === 'usage' ? 8000 : 20000) });
  } catch (error) {
    const timeout = ['TimeoutError', 'AbortError'].includes(error.name);
    throw new TavilySearchError('Tavily ' + stage + (timeout ? ' timed out. Please try again.' : ' could not connect. Please try again.'),
      timeout ? 'TAVILY_TIMEOUT' : 'TAVILY_CONNECTION', path);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new TavilySearchError('Tavily ' + stage + ' returned a redirect. It was blocked to protect the API key.', 'TAVILY_REDIRECT_BLOCKED', path, response.status);
  }
  if (!response.ok) {
    const status = response.status;
    const reason = status === 401 ? 'The server API key was rejected. Check the Tavily secret in Cloudflare.'
      : status === 403 ? 'Access was denied. Check this API key’s search permissions in Tavily.'
      : [400, 422].includes(status) ? 'The search request was rejected. Check the search configuration.'
      : status === 429 ? 'The request rate limit was reached. Wait a moment and retry.'
      : [432, 433].includes(status) ? 'The search allowance or configured limit was reached. No paid fallback was used.'
      : status >= 500 ? 'The search provider returned a server error. Please try again later.' : 'The provider returned an unexpected response.';
    // Provider bodies may repeat credentials or private queries; never expose them.
    throw new TavilySearchError('Tavily ' + stage + ' failed (HTTP ' + status + '). ' + reason, 'TAVILY_HTTP_' + status, path, status);
  }
  return response.json().catch(() => { throw new TavilySearchError('Tavily ' + stage + ' returned unreadable data. Please try again.', 'TAVILY_INVALID_RESPONSE', path); });
}

export async function tavilySources(env, query) {
  if (!env.TAVILY_API_KEY) throw new TavilySearchError('Live search is not connected. Add the Tavily server secret first.', 'TAVILY_NOT_CONFIGURED');
  const headers = { authorization: 'Bearer ' + env.TAVILY_API_KEY.trim(), 'content-type': 'application/json' };
  const { account, key } = await tavilyRequest('usage', { headers });
  const free = /^(?:researcher|free)$/i.test(account?.current_plan || '')
    && Number.isFinite(account?.plan_limit) && account.plan_limit > 0 && account.plan_limit <= 1000
    && account.paygo_limit === 0 && account.paygo_usage === 0;
  if (!free) throw new TavilySearchError('Live search requires a verified Tavily Free plan with paid usage disabled.', 'TAVILY_FREE_PLAN_REQUIRED', 'usage');
  if (!Number.isFinite(account.plan_usage) || account.plan_usage < 0) throw new TavilySearchError('Tavily free usage could not be verified. Live search is paused.', 'TAVILY_UNKNOWN_USAGE', 'usage');
  if (account.plan_usage >= account.plan_limit || (Number.isFinite(key?.limit) && key.limit > 0 && key.usage >= key.limit)) {
    throw new TavilySearchError('Tavily’s free search allowance is used up. Live search will resume after the allowance resets.', 'TAVILY_FREE_LIMIT', 'usage');
  }
  // Use the basic parameters supported across Tavily API versions.
  const payload = await tavilyRequest('search', { method: 'POST', headers,
    body: JSON.stringify({ query: clip(query, 200), search_depth: 'basic', auto_parameters: false, max_results: 5,
      topic: 'general', include_answer: false, include_raw_content: false }) });
  return (Array.isArray(payload.results) ? payload.results : []).slice(0, 5).filter(result => {
    try { const url = new URL(result.url); return url.protocol === 'https:' && !url.username && !url.password && typeof result.content === 'string' && result.content.trim(); } catch { return false; }
  }).map(result => ({ title: clip(result.title, 200), url: result.url, text: clip(result.content, 1800),
    publishedAt: clip(result.published_date, 100), provider: 'Tavily · ' + new URL(result.url).hostname }));
}
