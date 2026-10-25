const clip = (value, max) => String(value || '').trim().slice(0, max);

export async function tavilySources(env, query) {
  if (!env.TAVILY_API_KEY) throw new Error('Live search is not connected. Add the Tavily server secret first.');
  const headers = { authorization: 'Bearer ' + env.TAVILY_API_KEY, 'content-type': 'application/json' };
  // Verify the no-overage account configuration before issuing a billable search.
  const usage = await fetch('https://api.tavily.com/usage', { headers, redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!usage.ok) throw new Error('Tavily free usage could not be verified. Live search is paused.');
  const { account, key } = await usage.json().catch(() => { throw new Error('Tavily free usage could not be verified. Live search is paused.'); });
  const free = /^(?:researcher|free)$/i.test(account?.current_plan || '')
    && Number.isFinite(account?.plan_limit) && account.plan_limit > 0 && account.plan_limit <= 1000
    && account.paygo_limit === 0 && account.paygo_usage === 0;
  if (!free) throw new Error('Live search requires a verified Tavily Free plan with paid usage disabled.');
  if (!Number.isFinite(account.plan_usage) || account.plan_usage < 0) throw new Error('Tavily free usage could not be verified. Live search is paused.');
  if (account.plan_usage >= account.plan_limit || (Number.isFinite(key?.limit) && key.limit > 0 && key.usage >= key.limit)) {
    throw new Error('Tavily’s free search allowance is used up. Live search will resume after the allowance resets.');
  }
  const response = await fetch('https://api.tavily.com/search', { method: 'POST', headers, redirect: 'error',
    body: JSON.stringify({ query: clip(query, 200), search_depth: 'basic', auto_parameters: false, max_results: 5,
      topic: 'general', include_answer: false, include_raw_content: false, include_images: false,
      include_published_date: true, include_usage: true }), signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error([429, 432, 433].includes(response.status)
    ? 'Tavily’s search limit was reached. No paid fallback was used.' : 'Tavily live search is temporarily unavailable.');
  const payload = await response.json().catch(() => { throw new Error('Tavily live search is temporarily unavailable.'); });
  return (Array.isArray(payload.results) ? payload.results : []).slice(0, 5).filter(result => {
    try { return new URL(result.url).protocol === 'https:' && typeof result.content === 'string' && result.content.trim(); } catch { return false; }
  }).map(result => ({ title: clip(result.title, 200), url: result.url, text: clip(result.content, 1800),
    publishedAt: clip(result.published_date, 100), provider: 'Tavily · ' + new URL(result.url).hostname }));
}
