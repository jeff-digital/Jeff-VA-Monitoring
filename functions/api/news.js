const CATEGORY_QUERIES = {
  all: '(business AND ("United Kingdom" OR Australia OR "United States" OR Canada)) OR ("virtual assistant" AND (Philippines OR Filipino)) OR "remote work" OR "artificial intelligence" OR automation',
  'business-markets': 'business AND ("United Kingdom" OR Australia OR "United States" OR Canada)',
  'va-philippines': '("virtual assistant" OR freelancing OR BPO) AND (Philippines OR Filipino)',
  'remote-work': '("remote work" OR "work from home" OR "digital jobs") AND (Philippines OR Filipino)',
  ai: 'artificial intelligence OR ChatGPT OR Claude OR Gemini',
  'ai-tools': 'AI tools productivity writing coding design',
  'virtual-assistants': 'virtual assistant remote work administrative productivity',
  automation: 'n8n OR Zapier OR Make workflow automation',
  'crm-business': 'HubSpot OR Salesforce OR Notion OR Airtable productivity',
  web: 'JavaScript frontend web development developer tools',
  marketing: 'SEO social media content marketing technology'
};

const NEWS_CACHE_VERSION = '2';
const DEFAULT_GNEWS_DAILY_LIMIT = 100;

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600, s-maxage=3600', ...extra } });
}

function clean(value, limit) { return String(value || '').trim().slice(0, limit); }

function gnewsUsageWindow(env, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const reset = new Date(`${date}T00:00:00.000Z`);
  reset.setUTCDate(reset.getUTCDate() + 1);
  const configuredLimit = Number(env.GNEWS_DAILY_LIMIT);
  const limit = Number.isFinite(configuredLimit) && configuredLimit > 0 ? Math.floor(configuredLimit) : DEFAULT_GNEWS_DAILY_LIMIT;
  return { date, resetAt: reset.toISOString(), limit };
}

async function readGnewsUsage(caches, origin, env) {
  const window = gnewsUsageWindow(env);
  const key = new Request(`${origin}/__internal/gnews-usage/${window.date}`);
  try {
    const cached = await caches.default.match(key);
    const payload = cached ? await cached.json() : null;
    const used = Math.max(0, Math.min(window.limit, Math.floor(Number(payload?.used) || 0)));
    return { ...window, key, used };
  } catch {
    return { ...window, key, used: 0 };
  }
}

async function recordGnewsRequest(caches, origin, env, exhausted = false) {
  const usage = await readGnewsUsage(caches, origin, env);
  const used = exhausted ? usage.limit : Math.min(usage.limit, usage.used + 1);
  try {
    await caches.default.put(usage.key, json({ used }, 200, { 'cache-control': 'public, max-age=86400' }));
  } catch {}
  return { used, limit: usage.limit, remaining: Math.max(0, usage.limit - used), resetAt: usage.resetAt, trackedByApp: true };
}

async function currentGnewsUsage(caches, origin, env) {
  const usage = await readGnewsUsage(caches, origin, env);
  return { used: usage.used, limit: usage.limit, remaining: Math.max(0, usage.limit - usage.used), resetAt: usage.resetAt, trackedByApp: true };
}

function normalizeArticle(article, category = 'all') {
  const url = clean(article.url, 1200);
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const image = clean(article.image, 1200);
  return { id: url, title: clean(article.title, 240), description: clean(article.description, 600), url, image: /^https:\/\//i.test(image) ? image : '', publishedAt: article.publishedAt || null, source: clean(article.source?.name || article.source, 120), category };
}

async function fetchWithTimeout(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...options, signal: controller.signal }); } finally { clearTimeout(timer); }
}

async function gnews(env, query, page, pageSize) {
  if (!env.GNEWS_API_KEY) return { articles: [], error: 'GNews is not configured. Add GNEWS_API_KEY as a Cloudflare secret to enable live news.', requested: false };
  const params = new URLSearchParams({ q: query, lang: 'en', max: String(pageSize), page: String(page), sortby: 'publishedAt', apikey: env.GNEWS_API_KEY });
  const response = await fetchWithTimeout(`https://gnews.io/api/v4/search?${params}`);
  if (!response.ok) return { articles: [], error: `GNews returned ${response.status}.`, requested: true, status: response.status };
  const payload = await response.json();
  return { articles: (payload.articles || []).map(article => normalizeArticle(article)).filter(Boolean), total: Number(payload.totalArticles) || 0, error: null, requested: true, status: response.status };
}

async function githubReleases(pageSize) {
  const response = await fetchWithTimeout(`https://api.github.com/repos/n8n-io/n8n/releases?per_page=${Math.min(pageSize, 20)}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'jeff-va-monitoring-news' } });
  if (!response.ok) return { articles: [], error: `GitHub returned ${response.status}.` };
  const releases = await response.json();
  return { articles: releases.filter(release => !release.draft && !release.prerelease).map(release => normalizeArticle({ title: `n8n ${release.name || release.tag_name}`, description: release.body, url: release.html_url, publishedAt: release.published_at, source: { name: 'GitHub Releases' } }, 'automation')).filter(Boolean), error: null };
}

async function youtubeVideos(env, query, pageSize) {
  if (!env.YOUTUBE_API_KEY) return { articles: [], error: 'YouTube is not configured.' };
  const params = new URLSearchParams({ part: 'snippet', type: 'video', q: query, maxResults: String(Math.min(pageSize, 25)), key: env.YOUTUBE_API_KEY });
  const response = await fetchWithTimeout(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!response.ok) return { articles: [], error: `YouTube returned ${response.status}.` };
  const payload = await response.json();
  return { articles: (payload.items || []).map(item => normalizeArticle({ title: item.snippet?.title, description: item.snippet?.description, url: item.id?.videoId ? `https://www.youtube.com/watch?v=${item.id.videoId}` : '', image: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url, publishedAt: item.snippet?.publishedAt, source: { name: 'YouTube' } }, 'virtual-assistants')).filter(Boolean), error: null };
}

async function productHunt(env, pageSize) {
  if (!env.PRODUCT_HUNT_TOKEN) return { articles: [], error: 'Product Hunt is not configured.' };
  const response = await fetchWithTimeout('https://api.producthunt.com/v2/api/graphql', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.PRODUCT_HUNT_TOKEN}` }, body: JSON.stringify({ query: `query { posts(first: ${Math.min(pageSize, 20)}, order: NEWEST) { edges { node { name tagline url thumbnail { url } createdAt } } } }` }) });
  if (!response.ok) return { articles: [], error: `Product Hunt returned ${response.status}.` };
  const payload = await response.json();
  return { articles: (payload.data?.posts?.edges || []).map(({ node }) => normalizeArticle({ title: node.name, description: node.tagline, url: node.url, image: node.thumbnail?.url, publishedAt: node.createdAt, source: { name: 'Product Hunt' } }, 'ai-tools')).filter(Boolean), error: null };
}

export async function onRequestGet({ request, env, caches = globalThis.caches }) {
  const url = new URL(request.url);
  const category = clean(url.searchParams.get('category') || 'all', 24).toLowerCase();
  const query = clean(url.searchParams.get('q'), 120);
  const page = Math.max(1, Math.min(Math.floor(Number(url.searchParams.get('page') || 1) || 1), 10));
  const pageSize = Math.max(1, Math.min(Math.floor(Number(url.searchParams.get('pageSize') || 10) || 10), 10));
  if (!Object.hasOwn(CATEGORY_QUERIES, category)) return json({ articles: [], error: 'Unsupported news category.' }, 400);
  const cacheKey = new Request(`${url.origin}/api/news?v=${NEWS_CACHE_VERSION}&category=${encodeURIComponent(category)}&q=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}`);
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;
  const topicQuery = CATEGORY_QUERIES[category];
  const userQuery = query.replace(/["()]/g, ' ').replace(/\s+/g, ' ').trim();
  const availableUserLength = Math.max(1, 190 - topicQuery.length - 9);
  const selectedQuery = userQuery
    ? (category === 'all' ? userQuery : `(${topicQuery}) AND (${userQuery.slice(0, availableUserLength)})`)
    : topicQuery;
  const safeProvider = promise => promise.catch(() => ({ articles: [], error: 'A news provider is temporarily unavailable.' }));
  const skip = () => Promise.resolve({ articles: [], error: null });
  const [gnewsResult, githubResult, youtubeResult, productHuntResult] = await Promise.all([
    gnews(env, selectedQuery, page, pageSize).catch(() => ({ articles: [], error: 'GNews is temporarily unavailable.', requested: Boolean(env.GNEWS_API_KEY) })),
    page === 1 && !query && (category === 'all' || category === 'automation') ? safeProvider(githubReleases(pageSize)) : skip(),
    page === 1 && env.YOUTUBE_API_KEY && (category === 'all' || category === 'virtual-assistants') ? safeProvider(youtubeVideos(env, query || 'virtual assistant tutorial', pageSize)) : skip(),
    page === 1 && !query && env.PRODUCT_HUNT_TOKEN && (category === 'all' || category === 'ai-tools') ? safeProvider(productHunt(env, pageSize)) : skip()
  ]);
  const usage = gnewsResult.requested ? await recordGnewsRequest(caches, url.origin, env, gnewsResult.status === 403) : await currentGnewsUsage(caches, url.origin, env);
  gnewsResult.articles.forEach(article => { article.category = category; });
  const articles = [...gnewsResult.articles, ...githubResult.articles, ...youtubeResult.articles, ...productHuntResult.articles].filter((item, index, list) => list.findIndex(other => other.url === item.url) === index).sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
  const response = json({ articles, page, pageSize, hasMore: page < 10 && gnewsResult.articles.length === pageSize && gnewsResult.total > page * pageSize, updatedAt: new Date().toISOString(), usage: { gnews: { ...usage, configured: Boolean(env.GNEWS_API_KEY) } }, errors: [gnewsResult.error, githubResult.error, youtubeResult.error, productHuntResult.error].filter(Boolean) });
  if (articles.length) await caches.default.put(cacheKey, response.clone());
  return response;
}

export async function onRequestGetUsage({ request, env, caches = globalThis.caches }) {
  const usage = await currentGnewsUsage(caches, new URL(request.url).origin, env);
  return json({ gnews: { ...usage, configured: Boolean(env.GNEWS_API_KEY) } }, 200, { 'cache-control': 'private, no-store' });
}
