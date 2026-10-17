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
    assert.equal(url.searchParams.get('max'), '10');
    if (providerFails) throw new Error('timeout');
    return Response.json({ totalArticles: 1, articles: [{ title: 'Provider fixture', url: 'https://publisher.example/article', image: 'https://publisher.example/image.jpg', publishedAt: '2026-10-17T01:00:00Z', source: { name: 'Publisher' } }] });
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
assert.equal(payload.articles[0].url, 'https://publisher.example/article');
assert.equal(payload.articles[0].image, 'https://publisher.example/image.jpg');
assert.equal(payload.hasMore, false);
assert.ok(payload.errors.length, 'one failed provider must not discard working results');
assert.ok(!JSON.stringify(payload).includes('test-only'), 'secret must not appear in response');
await get('/api/news');
assert.equal(newsRequests, 1, 'cached requests must not use provider quota');
providerFails = true;
const unavailable = await (await get('/api/news?category=web')).json();
assert.equal(unavailable.articles.length, 0);
assert.ok(unavailable.errors.length);
assert.ok(!cache.has('https://dashboard.example/api/news?category=web&q=&page=1&pageSize=10'), 'failure must not be cached');
providerFails = false;
await get('/api/news?category=philippine-business');
await get('/api/news?category=va-philippines');
await get('/api/news?category=remote-work');
assert.ok(providerQueries.some(query => query.includes('MSME')), 'Philippine business query must include local business coverage');
assert.ok(providerQueries.some(query => query.includes('virtual assistant') && query.includes('Filipino')), 'VA Philippines query must target Filipino virtual assistants');
assert.ok(providerQueries.some(query => query.includes('remote work') && query.includes('Philippines')), 'remote work query must target the Philippines');
console.log('News routing, authentication, images, partial failures, caching, and secret handling passed.');
