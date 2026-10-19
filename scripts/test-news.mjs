import assert from 'node:assert/strict';
import worker from '../src/backend/worker.mjs';

const cache = new Map();
globalThis.caches = { default: {
  match: async request => cache.get(request.url)?.clone(),
  put: async (request, response) => cache.set(request.url, response.clone())
} };
const env = { SUPABASE_URL: 'https://auth.example', SUPABASE_PUBLISHABLE_KEY: 'public-test', GNEWS_API_KEY: 'test-only', ASSETS: { fetch: async () => new Response('assets') } };
const ctx = { waitUntil() {} };
const get = (path, signedIn = true) => worker.fetch(new Request(`https://dashboard.example${path}`, { headers: signedIn ? { authorization: 'Bearer test-session' } : {} }), env, ctx);
let newsRequests = 0;
let providerFails = false;
const providerQueries = [];
globalThis.fetch = async input => {
  const url = new URL(input);
  if (url.hostname === 'auth.example') return Response.json({ id: 'signed-in-user' });
  if (url.hostname === 'gnews.io') {
    newsRequests++;
    providerQueries.push(url.searchParams.get('q'));
    assert.ok(url.searchParams.get('q').length <= 200, 'GNews queries must stay within the provider limit');
    assert.equal(url.searchParams.get('max'), '10');
    if (providerFails) throw new Error('timeout');
    return Response.json({ totalArticles: 4, articles: [
      { title: 'Provider fixture', url: 'https://www.publisher.example/article?utm_source=newsletter', image: 'https://publisher.example/image.jpg', publishedAt: '2026-10-17T01:00:00Z', source: { name: 'Publisher' } },
      { title: 'Provider mirror headline', url: 'https://publisher.example/article?fbclid=tracking', publishedAt: '2026-10-17T00:59:00Z', source: { name: 'Publisher duplicate' } },
      { title: 'PROVIDER FIXTURE!', url: 'https://syndication.example/copy', publishedAt: '2026-10-17T00:58:00Z', source: { name: 'Syndication duplicate' } },
      { title: 'A different story', url: 'https://publisher.example/different', publishedAt: '2026-10-17T00:57:00Z', source: { name: 'Publisher' } }
    ] });
  }
  if (url.hostname === 'api.github.com') throw new Error('unavailable');
  throw new Error('Unexpected upstream');
};

assert.equal((await get('/api/news', false)).status, 401);
assert.equal(newsRequests, 0, 'anonymous requests must not use provider quota');
assert.equal((await get('/api/unknown')).status, 404);
assert.equal((await get('/api/news?category=invalid')).status, 400);
assert.equal(await (await get('/')).text(), 'assets');
const response = await get('/api/news');
assert.equal(response.headers.get('cache-control'), 'private, no-store');
const payload = await response.json();
assert.equal(payload.articles[0].url, 'https://www.publisher.example/article?utm_source=newsletter');
assert.equal(payload.articles[0].image, 'https://publisher.example/image.jpg');
assert.equal(payload.articles.length, 2, 'tracking-link and repeated-headline variants must be removed');
assert.equal(payload.hasMore, false);
assert.ok(payload.errors.length, 'one failed provider must not discard working results');
assert.ok(!JSON.stringify(payload).includes('test-only'), 'secret must not appear in response');
assert.equal(payload.usage.gnews.used, 1, 'an upstream GNews request must increment daily usage');
assert.equal(payload.usage.gnews.limit, 100);
assert.ok(['United Kingdom', 'Australia', 'United States', 'Canada', 'Philippines', 'virtual assistant', 'artificial intelligence'].every(term => providerQueries[0].includes(term)), 'All news must cover the selected business markets and Philippine VA topics');
await get('/api/news');
assert.equal(newsRequests, 1, 'cached requests must not use provider quota');
const usage = await (await get('/api/news/usage')).json();
assert.equal(usage.gnews.used, 1, 'cached news and usage checks must not increment GNews usage');
assert.equal(usage.gnews.remaining, 99);
providerFails = true;
const unavailable = await (await get('/api/news?category=web')).json();
assert.equal(unavailable.articles.length, 0);
assert.ok(unavailable.errors.length);
assert.ok(!cache.has('https://dashboard.example/api/news?v=5&category=web&q=&page=1&pageSize=10'), 'failure must not be cached');
providerFails = false;
await get('/api/news?category=business-markets');
assert.ok(['business', 'United Kingdom', 'United States', 'Canada', 'Australia', 'staffing', 'hiring', 'workload', 'productivity', 'customer service', 'growth', 'challenges', 'costs'].every(term => providerQueries.at(-1).includes(term)), 'business stories must focus on owner challenges and opportunities for VA support in target countries');
await get('/api/news?category=va-philippines');
await get('/api/news?category=remote-work');
assert.ok(providerQueries.some(query => ['United Kingdom', 'Australia', 'United States', 'Canada'].every(country => query.includes(country))), 'Business markets must cover the UK, Australia, US, and Canada');
assert.ok(providerQueries.some(query => query.includes('virtual assistant') && query.includes('Filipino')), 'VA Philippines query must target Filipino virtual assistants');
assert.ok(providerQueries.some(query => query.includes('remote work') && query.includes('Philippines')), 'remote work query must target the Philippines');
await get('/api/news?category=all&q=Philippine%20small%20business');
assert.equal(providerQueries.at(-1), 'Philippine small business', 'All news text search must search the requested phrase without an oversized topic prefix');
await get(`/api/news?category=business-markets&q=${'a'.repeat(120)}`);
assert.ok(providerQueries.at(-1).length <= 190, 'topic searches must stay within the GNews query limit');
const beforeTrends = newsRequests;
const trends = await (await get('/api/news?category=social-trends')).json();
assert.equal(newsRequests, beforeTrends + 1, 'social trends uses one request with the existing GNews key');
assert.ok(['marketing', 'campaign', 'product', 'social media', 'TikTok', 'Instagram', 'Facebook', 'YouTube', 'Twitter', 'Reddit', 'LinkedIn', 'Snapchat', 'Pinterest', 'Threads', 'Bluesky'].every(term => providerQueries.at(-1).includes(term)), 'social trends must focus on marketing, campaigns and products across platforms');
assert.ok(trends.articles.length);
assert.ok(trends.articles.every(article => article.category === 'social-trends'));
assert.equal(trends.articles[0].image, 'https://publisher.example/image.jpg');
assert.equal(trends.errors.length, 0, 'social trends does not depend on GitHub, YouTube or Product Hunt credentials');
await get('/api/news?category=social-trends');
assert.equal(newsRequests, beforeTrends + 1, 'repeat social trends requests must use the cache');
await get('/api/news?category=social-trends&q=brand%20campaign');
assert.ok(providerQueries.at(-1).includes('brand campaign'), 'topic searches must include business content terms');
const longSearch = 'customer service staffing challenges marketing operations business owners';
await get(`/api/news?category=business-markets&q=${encodeURIComponent(longSearch)}`);
assert.ok(providerQueries.at(-1).includes(longSearch), 'business searches must preserve the full meaningful phrase');
assert.ok(providerQueries.at(-1).includes('Canada'));
await get(`/api/news?category=social-trends&q=${encodeURIComponent(longSearch)}`);
assert.ok(providerQueries.at(-1).includes(longSearch), 'social searches must not be truncated by the list of platform names');
assert.ok(providerQueries[0].includes('viral'), 'All news must include viral coverage');
console.log('News routing, authentication, images, partial failures, caching, and secret handling passed.');
