  let newsPage = 1;
  let newsArticles = [];
  let newsLoading = false;
  let newsRequest = 0;
  let newsLastLoaded = 0;
  let newsHasMore = false;

  const newsCategoryNames = { all: 'All news', 'business-markets': 'Business: UK, AU, US & Canada', 'va-philippines': 'VA Philippines', 'remote-work': 'Remote work', ai: 'Artificial intelligence', 'ai-tools': 'AI tools', 'virtual-assistants': 'Virtual assistants', automation: 'Automation', 'crm-business': 'CRM & business tools', web: 'Web development', marketing: 'Digital marketing' };
  const newsUrlKey = value => {
    try {
      const url = new URL(value);
      url.hash = '';
      [...url.searchParams.keys()].forEach(key => { if (/^(utm_.+|fbclid|gclid|dclid|mc_cid|mc_eid|ref|referrer|source)$/i.test(key)) url.searchParams.delete(key); });
      url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
      url.pathname = url.pathname.replace(/\/+$/, '') || '/';
      url.searchParams.sort();
      return url.toString();
    } catch { return String(value || '').toLowerCase(); }
  };
  const newsTitleKey = value => String(value || '').normalize('NFKD').toLowerCase().replace(/&(?:amp|#0*38);/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const uniqueNewsArticles = articles => {
    const urls = new Set();
    const titles = new Set();
    return articles.filter(article => {
      const urlKey = newsUrlKey(article.url);
      const titleKey = newsTitleKey(article.title);
      if ((urlKey && urls.has(urlKey)) || (titleKey && titles.has(titleKey))) return false;
      if (urlKey) urls.add(urlKey);
      if (titleKey) titles.add(titleKey);
      return true;
    });
  };
  const relativeNewsTime = date => {
    const time = Date.parse(date || '');
    if (!Number.isFinite(time)) return 'Date unavailable';
    const minutes = Math.max(1, Math.round((Date.now() - time) / 60000));
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
    return `${Math.round(minutes / 1440)}d ago`;
  };
  const newsDate = date => { const time = Date.parse(date || ''); return Number.isFinite(time) ? new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Publication date unavailable'; };
  const renderGnewsUsage = usage => {
    const indicator = $('#gnewsUsage');
    if (!indicator || !usage) return;
    indicator.classList.remove('is-warning', 'is-exhausted', 'is-unavailable');
    if (!usage.configured) {
      indicator.textContent = 'GNews not connected';
      indicator.title = 'Add GNEWS_API_KEY to the production Worker.';
      indicator.classList.add('is-unavailable');
      return;
    }
    const used = Math.max(0, Number(usage.used) || 0);
    const limit = Math.max(1, Number(usage.limit) || 100);
    const remaining = Math.max(0, limit - used);
    const resetTime = Date.parse(usage.resetAt || '');
    const resetLabel = Number.isFinite(resetTime) ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(resetTime) : '00:00 UTC';
    indicator.textContent = `GNews ${used} / ${limit}`;
    indicator.title = `App-tracked usage today · ${remaining} remaining · resets ${resetLabel}`;
    if (!remaining) indicator.classList.add('is-exhausted');
    else if (remaining <= Math.max(10, Math.ceil(limit * .1))) indicator.classList.add('is-warning');
  };
  const refreshGnewsUsage = async token => {
    if (!token) return;
    try {
      const response = await fetch('/api/news/usage', { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return;
      const payload = await response.json();
      renderGnewsUsage(payload.gnews);
    } catch {}
  };
  const newsFallback = category => `<span class="news-card-fallback"><i class="fa-solid ${category === 'automation' ? 'fa-gears' : category === 'web' ? 'fa-code' : 'fa-newspaper'}" aria-hidden="true"></i></span>`;
  const newsCard = (article, variant = '') => `<article class="news-card ${variant}"><a class="news-card-media" href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(article.title)} in a new tab">${article.image ? `<img src="${escapeHtml(article.image)}" alt="" loading="lazy" data-news-fallback="${escapeHtml(article.category)}" />` : newsFallback(article.category)}</a><div class="news-card-body"><div class="news-card-meta"><span class="news-card-source">${escapeHtml(article.source || 'News source')}</span><time datetime="${escapeHtml(article.publishedAt || '')}" title="${escapeHtml(newsDate(article.publishedAt))}">${escapeHtml(relativeNewsTime(article.publishedAt))}</time></div><h3><a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title || 'Untitled article')}</a></h3><p>${escapeHtml(article.description || 'Open the original article for full details.')}</p><span class="news-card-category">${escapeHtml(newsCategoryNames[article.category] || 'News')}</span><a class="news-card-link" href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">Read article <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a></div></article>`;

  function renderNewsCategoryLoading(category) {
    const grid = $('#newsLiveGrid');
    const status = $('#newsLiveStatus');
    const loadMore = $('#loadMoreNews');
    if (!grid) return;
    const label = newsCategoryNames[category] || 'news';
    grid.setAttribute('aria-busy', 'true');
    grid.innerHTML = `<div class="news-category-loader" role="status"><span class="news-category-loader-ring" aria-hidden="true"></span><h2>Loading ${escapeHtml(label)}</h2><p>Getting the latest published stories</p><span class="news-category-loader-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>`;
    if (status) status.textContent = '';
    if (loadMore) loadMore.hidden = true;
  }

  function renderNewsArticles() {
    const grid = $('#newsLiveGrid');
    const status = $('#newsLiveStatus');
    const loadMore = $('#loadMoreNews');
    if (!grid || !status) return;
    grid.setAttribute('aria-busy', 'false');
    if (!newsArticles.length) { grid.innerHTML = '<div class="news-empty"><i class="fa-regular fa-newspaper" aria-hidden="true"></i><h2>No news available</h2><p>Try another topic or check back later.</p></div>'; status.textContent = ''; loadMore.hidden = true; return; }
    const [featured, ...rest] = newsArticles;
    const sideStories = rest.slice(0, 3);
    const highlights = rest.slice(3, 5);
    const latest = rest.slice(5);
    grid.innerHTML = `<div class="news-lead-layout"><div class="news-featured-story">${newsCard(featured, 'news-card-featured')}</div>${sideStories.length ? `<div class="news-side-stories" aria-label="More headlines">${sideStories.map(article => newsCard(article, 'news-card-compact')).join('')}</div>` : ''}</div>${highlights.length ? `<div class="news-highlights" aria-label="Featured articles">${highlights.map(article => newsCard(article, 'news-card-highlight')).join('')}</div>` : ''}${latest.length ? `<div class="news-trending-heading"><h4>Latest articles</h4><span>Newest first</span></div><div class="news-trending-grid">${latest.map(article => newsCard(article, 'news-card-trending')).join('')}</div>` : ''}`;
    grid.querySelectorAll('[data-news-fallback]').forEach(image => { image.addEventListener('error', () => { image.replaceWith(document.createRange().createContextualFragment(newsFallback(image.dataset.newsFallback))); }, { once: true }); });
    status.textContent = `${newsArticles.length} published ${newsArticles.length === 1 ? 'story' : 'stories'} · ${newsCategoryNames[$('#newsCategory').value] || 'News'}`;
    loadMore.hidden = !newsHasMore;
  }

  async function loadNews({ reset = false } = {}) {
    if (!currentUser || !$('#newsLiveGrid')) return;
    if (newsLoading && !reset) return;
    const requestId = ++newsRequest;
    if (reset) {
      newsPage = 1;
      newsArticles = [];
      const category = $('#newsCategory').value;
      if (category !== 'all') renderNewsCategoryLoading(category);
      else renderNewsArticles();
    }
    newsLoading = true;
    const status = $('#newsLiveStatus');
    if (status) status.textContent = 'Loading published stories…';
    let token = '';
    try {
      const session = await supabaseClient.auth.getSession();
      token = session.data?.session?.access_token;
      if (!token) throw new Error('Sign in to view news.');
      const params = new URLSearchParams({ category: $('#newsCategory').value, q: $('#newsSearch').value.trim(), page: String(newsPage), pageSize: '10' });
      const response = await fetch(`/api/news?${params}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The news API is not running on this server. Use the Cloudflare deployment or Wrangler for live news.');
      const payload = await response.json();
      if (requestId !== newsRequest) return;
      if (!response.ok) throw new Error(payload.error || 'News could not be loaded.');
      newsArticles = uniqueNewsArticles([...newsArticles, ...(payload.articles || [])]);
      newsArticles.sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
      newsHasMore = Boolean(payload.hasMore);
      newsLastLoaded = Date.now();
      $('#newsUpdatedAt').textContent = payload.updatedAt ? `Updated ${relativeNewsTime(payload.updatedAt)}` : 'Updated just now';
      renderGnewsUsage(payload.usage?.gnews);
      if (payload.errors?.length && !newsArticles.length) throw new Error(payload.errors.join(' '));
      renderNewsArticles();
    } catch (error) {
      if (requestId !== newsRequest) return;
      if (newsArticles.length) renderNewsArticles();
      else {
        $('#newsLiveGrid').setAttribute('aria-busy', 'false');
        $('#newsLiveGrid').innerHTML = '<div class="news-empty"><i class="fa-regular fa-newspaper" aria-hidden="true"></i><h2>No news available</h2><p>Please try again later.</p></div>';
      }
      $('#newsLiveStatus').textContent = error.message || 'News could not be loaded.';
      $('#loadMoreNews').hidden = true;
    } finally {
      if (requestId === newsRequest) newsLoading = false;
      if (token) refreshGnewsUsage(token);
    }
  }

  $('#newsSearch')?.addEventListener('keydown', event => { if (event.key === 'Enter') loadNews({ reset: true }); });
  $('#newsCategory')?.addEventListener('change', () => loadNews({ reset: true }));
  $('#refreshNews')?.addEventListener('click', () => loadNews({ reset: true }));
  $('#loadMoreNews')?.addEventListener('click', () => { newsPage += 1; loadNews(); });
  setInterval(() => { if (activeView === "news" && currentUser && !document.hidden && !newsLoading && Date.now() - newsLastLoaded >= 3600000) loadNews({ reset: true }); }, 60000);
