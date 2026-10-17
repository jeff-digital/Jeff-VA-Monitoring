async function fetchWithTimeout(url, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'jeff-va-monitoring-tools' }, signal: controller.signal }); } finally { clearTimeout(timer); }
}

export async function onRequestGet({ caches, request }) {
  const url = new URL(request.url);
  const cacheKey = new Request(`${url.origin}/api/tools`);
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;
  const response = await fetchWithTimeout('https://api.github.com/search/repositories?q=topic:ai-tools+topic:productivity&sort=updated&order=desc&per_page=12');
  if (!response.ok) return new Response(JSON.stringify({ tools: [], error: `GitHub returned ${response.status}.` }), { status: 502, headers: { 'content-type': 'application/json' } });
  const payload = await response.json();
  const tools = (payload.items || []).map(repo => ({ name: repo.name, description: repo.description || 'Open-source AI or productivity project.', url: repo.html_url, image: repo.owner?.avatar_url || '', source: 'GitHub', updatedAt: repo.updated_at })).filter(tool => tool.url);
  const result = new Response(JSON.stringify({ tools, updatedAt: new Date().toISOString() }), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=1800, s-maxage=3600' } });
  await caches.default.put(cacheKey, result.clone());
  return result;
}
