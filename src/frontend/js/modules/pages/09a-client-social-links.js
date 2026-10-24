  let activeClientDetailsModalEdit = false;
  const CLIENT_SOCIAL_PLATFORM_LABELS = Object.freeze({
    facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', twitter: 'X / Twitter',
    linkedin: 'LinkedIn', youtube: 'YouTube', pinterest: 'Pinterest', website: 'Website', other: 'Other'
  });

  function inferClientSocialPlatform(url = '') {
    const value = String(url).toLowerCase();
    if (value.includes('facebook.com') || value.includes('fb.com')) return 'facebook';
    if (value.includes('instagram.com')) return 'instagram';
    if (value.includes('tiktok.com')) return 'tiktok';
    if (value.includes('twitter.com') || value.includes('x.com')) return 'twitter';
    if (value.includes('linkedin.com')) return 'linkedin';
    if (value.includes('youtube.com') || value.includes('youtu.be')) return 'youtube';
    if (value.includes('pinterest.com') || value.includes('pin.it')) return 'pinterest';
    return 'website';
  }

  function normalizeClientSocialLinks(item = {}) {
    const source = Array.isArray(item.socialLinks) ? item.socialLinks : [];
    const links = source.map(link => {
      const url = String(link?.url || '').trim();
      const platform = Object.prototype.hasOwnProperty.call(CLIENT_SOCIAL_PLATFORM_LABELS, link?.platform)
        ? link.platform
        : inferClientSocialPlatform(url);
      return { platform, url };
    }).filter(link => link.url);
    if (!links.length && String(item.socialMedia || '').trim()) {
      const url = String(item.socialMedia).trim();
      links.push({ platform: inferClientSocialPlatform(url), url });
    }
    const seen = new Set();
    return links.filter(link => {
      const key = link.url.toLowerCase().replace(/\/$/, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function clientSocialPlatformOptions(selected = 'website') {
    return Object.entries(CLIENT_SOCIAL_PLATFORM_LABELS).map(([value, label]) =>
      `<option value="${value}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
  }

  function clientSocialHref(link) {
    const value = String(link?.url || '').trim();
    if (!value.startsWith('@')) return normalizeUrl(value);
    const handle = value.slice(1);
    const platformRoots = {
      facebook: 'https://facebook.com/', instagram: 'https://instagram.com/', tiktok: 'https://tiktok.com/@',
      twitter: 'https://x.com/', linkedin: 'https://linkedin.com/in/', youtube: 'https://youtube.com/@',
      pinterest: 'https://pinterest.com/'
    };
    return `${platformRoots[link.platform] || 'https://'}${handle}`;
  }

  function clientSocialDisplay(link) {
    const label = CLIENT_SOCIAL_PLATFORM_LABELS[link.platform] || 'Link';
    const value = String(link.url || '').trim();
    if (value.startsWith('@')) return `${label} · ${value}`;
    try {
      const parsed = new URL(normalizeUrl(value));
      const account = parsed.pathname.split('/').filter(Boolean).pop()
        || parsed.hostname.replace(/^www\./, '');
      return `${label} · ${decodeURIComponent(account)}`;
    } catch {
      return label;
    }
  }

  function updateClientSocialEditorControls(viewOnly = viewingClientDetails) {
    const rows = $$('#clientSocialLinksList .client-social-link-row');
    const addButton = $('#addClientSocialLink');
    if (addButton) {
      addButton.hidden = viewOnly;
      addButton.disabled = viewOnly || rows.length >= 12;
    }
    rows.forEach(row => {
      const removeButton = row.querySelector('[data-remove-client-social-link]');
      if (removeButton) removeButton.hidden = viewOnly;
    });
  }

  function renderClientSocialLinkEditor(links = [], viewOnly = false) {
    const target = $('#clientSocialLinksList');
    if (!target) return;
    const entries = links.length ? links : [{ platform: 'website', url: '' }];
    target.innerHTML = entries.slice(0, 12).map((link, index) => {
      const platform = Object.prototype.hasOwnProperty.call(CLIENT_SOCIAL_PLATFORM_LABELS, link?.platform) ? link.platform : inferClientSocialPlatform(link?.url);
      return `<div class="client-social-link-row">
        <label><span class="sr-only">Platform ${index + 1}</span><select data-client-social-platform aria-label="Social platform ${index + 1}">${clientSocialPlatformOptions(platform)}</select></label>
        <label><span class="sr-only">Profile URL or handle ${index + 1}</span><input data-client-social-url type="text" inputmode="url" maxlength="500" value="${escapeHtml(String(link?.url || ''))}" placeholder="Profile URL or @handle" aria-label="Profile URL or handle ${index + 1}" /></label>
        <button class="client-social-remove" type="button" data-remove-client-social-link aria-label="Remove ${escapeHtml(CLIENT_SOCIAL_PLATFORM_LABELS[platform])} account" title="Remove account"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>
      </div>`;
    }).join('');
    updateClientSocialEditorControls(viewOnly);
  }

  function readClientSocialLinks({ includeEmpty = false } = {}) {
    const seen = new Set();
    return $$('#clientSocialLinksList .client-social-link-row').map(row => ({
      platform: row.querySelector('[data-client-social-platform]')?.value || 'website',
      url: row.querySelector('[data-client-social-url]')?.value.trim() || ''
    })).filter(link => {
      if (includeEmpty && !link.url) return true;
      if (!link.url) return false;
      const key = link.url.toLowerCase().replace(/\/$/, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function clientSocialLinksMarkup(item) {
    const links = normalizeClientSocialLinks(item);
    if (!links.length) return '';
    return `<span class="client-social-detail-links">${links.map(link => `<a href="${escapeHtml(clientSocialHref(link))}" target="_blank" rel="noopener" title="${escapeHtml(link.url)}"><span>${escapeHtml(clientSocialDisplay(link))}</span><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>`).join('')}</span>`;
  }

  $('#addClientSocialLink')?.addEventListener('click', () => {
    const links = readClientSocialLinks({ includeEmpty: true });
    if (links.length >= 12) return;
    links.push({ platform: 'website', url: '' });
    renderClientSocialLinkEditor(links);
    $('#clientSocialLinksList .client-social-link-row:last-child [data-client-social-platform]')?.focus();
  });
  $('#clientSocialLinksList')?.addEventListener('click', event => {
    const removeButton = event.target.closest('[data-remove-client-social-link]');
    if (!removeButton) return;
    removeButton.closest('.client-social-link-row')?.remove();
    if (!$('#clientSocialLinksList .client-social-link-row')) renderClientSocialLinkEditor();
    updateClientSocialEditorControls(false);
  });

