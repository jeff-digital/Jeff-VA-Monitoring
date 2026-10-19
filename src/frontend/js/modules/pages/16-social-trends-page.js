  const SOCIAL_TREND_PLATFORMS = ['TikTok', 'Instagram', 'YouTube', 'Facebook', 'Other'];
  let socialTrendDrawerOpen = false;
  let socialTrendDrawerReturnFocus = null;

  function socialTrendItems() {
    data.socialTrends = Array.isArray(data.socialTrends) ? data.socialTrends : [];
    return data.socialTrends;
  }

  function socialTrendNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
  }

  function socialTrendMetric(value) {
    return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(socialTrendNumber(value));
  }

  function socialTrendPlatformClass(platform) {
    return String(platform || 'Other').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  function socialTrendPlatformIcon(platform) {
    if (platform === 'TikTok') return 'fa-brands fa-tiktok';
    if (platform === 'Instagram') return 'fa-brands fa-instagram';
    if (platform === 'YouTube') return 'fa-brands fa-youtube';
    if (platform === 'Facebook') return 'fa-brands fa-facebook-f';
    return 'fa-solid fa-hashtag';
  }

  function socialTrendSafeUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function socialTrendFilteredItems() {
    const query = ($('#socialTrendSearch')?.value || '').trim().toLowerCase();
    const platform = $('#socialTrendPlatformFilter')?.value || 'all';
    return socialTrendItems().filter(item => {
      const searchable = `${item.name || ''} ${item.platform || ''} ${item.notes || ''}`.toLowerCase();
      return (platform === 'all' || item.platform === platform) && (!query || searchable.includes(query));
    }).sort((a, b) => String(b.observedAt || b.updatedAt || '').localeCompare(String(a.observedAt || a.updatedAt || '')));
  }

  function renderSocialTrends() {
    const items = socialTrendItems();
    const visible = socialTrendFilteredItems();
    const totalViews = items.reduce((sum, item) => sum + socialTrendNumber(item.views), 0);
    const totalUses = items.reduce((sum, item) => sum + socialTrendNumber(item.uses), 0);
    const platformCounts = items.reduce((counts, item) => {
      const platform = SOCIAL_TREND_PLATFORMS.includes(item.platform) ? item.platform : 'Other';
      counts[platform] = (counts[platform] || 0) + 1;
      return counts;
    }, {});
    const topPlatform = Object.entries(platformCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
    $('#socialTrendCount').textContent = String(items.length);
    $('#socialTrendViews').textContent = socialTrendMetric(totalViews);
    $('#socialTrendViews').title = totalViews.toLocaleString();
    $('#socialTrendUses').textContent = socialTrendMetric(totalUses);
    $('#socialTrendUses').title = totalUses.toLocaleString();
    $('#socialTrendTopPlatform').textContent = topPlatform;

    const grid = $('#socialTrendGrid');
    if (!visible.length) {
      const hasItems = items.length > 0;
      grid.innerHTML = `<div class="social-trend-empty"><span><i class="fa-solid ${hasItems ? 'fa-filter' : 'fa-arrow-trend-up'}" aria-hidden="true"></i></span><h3>${hasItems ? 'No trends match these filters' : 'No trends tracked yet'}</h3><p>${hasItems ? 'Try another search or platform.' : 'Add a trend to track its views and how many videos or posts are using it.'}</p>${hasItems ? '' : '<button class="button button-primary" type="button" data-social-trend-add>Add trend</button>'}</div>`;
      return;
    }

    grid.innerHTML = visible.map(item => {
      const platform = SOCIAL_TREND_PLATFORMS.includes(item.platform) ? item.platform : 'Other';
      const scopeLabel = item.scope === 'sample' ? 'Observed sample' : 'Exact total';
      return `<article class="social-trend-card">
        <header><span class="social-trend-platform platform-${escapeHtml(socialTrendPlatformClass(platform))}"><i class="${socialTrendPlatformIcon(platform)}" aria-hidden="true"></i>${escapeHtml(platform)}</span><span class="social-trend-scope${item.scope === 'sample' ? ' is-sample' : ''}">${scopeLabel}</span></header>
        <div class="social-trend-card-copy"><h3>${escapeHtml(item.name || 'Untitled trend')}</h3>${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : '<p>No notes added.</p>'}</div>
        <div class="social-trend-metrics"><div><span>Video views</span><strong title="${socialTrendNumber(item.views).toLocaleString()}">${socialTrendMetric(item.views)}</strong></div><div><span>Videos / posts using it</span><strong title="${socialTrendNumber(item.uses).toLocaleString()}">${socialTrendMetric(item.uses)}</strong></div></div>
        <footer><span>Checked ${escapeHtml(item.observedAt ? formatDate(item.observedAt) : '—')}</span><div>${socialTrendSafeUrl(item.url) ? `<a class="button button-secondary" href="${escapeHtml(socialTrendSafeUrl(item.url))}" target="_blank" rel="noopener noreferrer">Open source <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>` : ''}<button class="icon-button" type="button" data-social-trend-edit="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.name || 'trend')}"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button></div></footer>
      </article>`;
    }).join('');
  }

  function fillSocialTrendForm(item = null) {
    const form = $('#socialTrendForm');
    form.reset();
    $('#socialTrendId').value = item?.id || '';
    $('#socialTrendDrawerTitle').textContent = item ? 'Edit trend' : 'Add trend';
    $('#socialTrendName').value = item?.name || '';
    $('#socialTrendPlatform').value = SOCIAL_TREND_PLATFORMS.includes(item?.platform) ? item.platform : 'TikTok';
    $('#socialTrendUrl').value = item?.url || '';
    $('#socialTrendViewCount').value = item ? socialTrendNumber(item.views) : '';
    $('#socialTrendUseCount').value = item ? socialTrendNumber(item.uses) : '';
    $('#socialTrendScope').value = item?.scope === 'sample' ? 'sample' : 'exact';
    $('#socialTrendObservedAt').value = item?.observedAt || today();
    $('#socialTrendNotes').value = item?.notes || '';
    $('#deleteSocialTrend').hidden = !item;
  }

  function openSocialTrendDrawer(item = null, trigger = $('#addSocialTrend')) {
    socialTrendDrawerReturnFocus = trigger;
    fillSocialTrendForm(item);
    const layer = $('#socialTrendDrawerLayer');
    layer.hidden = false;
    layer.setAttribute('aria-hidden', 'false');
    socialTrendDrawerOpen = true;
    document.body.classList.add('client-task-drawer-open');
    requestAnimationFrame(() => {
      layer.classList.add('is-open');
      $('#socialTrendName').focus();
    });
  }

  function closeSocialTrendDrawer() {
    if (!socialTrendDrawerOpen) return;
    const layer = $('#socialTrendDrawerLayer');
    socialTrendDrawerOpen = false;
    layer.classList.remove('is-open');
    layer.classList.add('is-closing');
    const finish = () => {
      layer.hidden = true;
      layer.setAttribute('aria-hidden', 'true');
      layer.classList.remove('is-closing');
      document.body.classList.remove('client-task-drawer-open');
      socialTrendDrawerReturnFocus?.focus();
      socialTrendDrawerReturnFocus = null;
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else setTimeout(finish, 270);
  }

  $('#addSocialTrend')?.addEventListener('click', event => openSocialTrendDrawer(null, event.currentTarget));
  $('#socialTrendDrawerBackdrop')?.addEventListener('click', closeSocialTrendDrawer);
  $('#cancelSocialTrend')?.addEventListener('click', closeSocialTrendDrawer);
  $('#deleteSocialTrend')?.addEventListener('click', async () => {
    const id = $('#socialTrendId').value;
    const item = socialTrendItems().find(trend => trend.id === id);
    if (!item || !(await appConfirm(`Delete “${item.name}”?`, { title: 'Delete social trend', confirmLabel: 'Delete trend', danger: true, showCloseButton: false }))) return;
    data.socialTrends = data.socialTrends.filter(trend => trend.id !== id);
    persist();
    renderSocialTrends();
    closeSocialTrendDrawer();
  });
  $('#socialTrendSearch')?.addEventListener('input', renderSocialTrends);
  $('#socialTrendPlatformFilter')?.addEventListener('change', renderSocialTrends);
  $('#socialTrendUrl')?.addEventListener('input', event => event.currentTarget.setCustomValidity(''));

  $('#socialTrendForm')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const urlField = $('#socialTrendUrl');
    const safeUrl = socialTrendSafeUrl(urlField.value.trim());
    urlField.setCustomValidity(safeUrl ? '' : 'Enter a complete http or https source link.');
    if (!form.reportValidity()) return;
    const id = $('#socialTrendId').value;
    const existing = socialTrendItems().find(item => item.id === id);
    const now = new Date().toISOString();
    const next = {
      id: existing?.id || uid(),
      name: $('#socialTrendName').value.trim(),
      platform: $('#socialTrendPlatform').value,
      url: safeUrl,
      views: socialTrendNumber($('#socialTrendViewCount').value),
      uses: socialTrendNumber($('#socialTrendUseCount').value),
      scope: $('#socialTrendScope').value === 'sample' ? 'sample' : 'exact',
      observedAt: $('#socialTrendObservedAt').value,
      notes: $('#socialTrendNotes').value.trim(),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    if (existing) Object.assign(existing, next);
    else data.socialTrends.push(next);
    persist();
    renderSocialTrends();
    closeSocialTrendDrawer();
    showActionResult({ title: existing ? 'Trend updated' : 'Trend added', message: `${next.name} is now included in Social Trends.` });
  });

  document.addEventListener('click', async event => {
    const addButton = event.target.closest('[data-social-trend-add]');
    if (addButton) {
      openSocialTrendDrawer(null, addButton);
      return;
    }
    const editButton = event.target.closest('[data-social-trend-edit]');
    if (!editButton) return;
    const item = socialTrendItems().find(trend => trend.id === editButton.dataset.socialTrendEdit);
    if (!item) return;
    openSocialTrendDrawer(item, editButton);
  });

  document.addEventListener('keydown', event => {
    if (!socialTrendDrawerOpen || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeSocialTrendDrawer();
  }, true);

