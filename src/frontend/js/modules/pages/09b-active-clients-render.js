  function hiredClients() {
    return sortedApplications().filter(item => item.status === 'Active client' && !item.activePendingDocument && !item.activePendingEmail);
  }

  function normalizeUrl(value) {
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  }

  function clientInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return parts.length > 1
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
      : (parts[0]?.slice(0, 2) || '?').toUpperCase();
  }

  function clientAvatarHue(name) {
    return [...String(name || '')].reduce((hue, character) => hue + character.charCodeAt(0), 0) % 6;
  }

  const hiredClientAvatarUrls = new Map();
  const hiredClientAvatarLoads = new Map();

  function cacheHiredClientAvatar(clientId, storagePath, blob) {
    const current = hiredClientAvatarUrls.get(clientId);
    if (current) URL.revokeObjectURL(current.url);
    const url = URL.createObjectURL(blob);
    hiredClientAvatarUrls.set(clientId, { storagePath, url });
  }

  function clearHiredClientAvatar(clientId) {
    const current = hiredClientAvatarUrls.get(clientId);
    if (current) URL.revokeObjectURL(current.url);
    hiredClientAvatarUrls.delete(clientId);
  }

  function renderHiredClientAvatars() {
    $$('[data-client-avatar-path]').forEach(async image => {
      const clientId = image.dataset.clientAvatarId;
      const storagePath = image.dataset.clientAvatarPath;
      const cached = hiredClientAvatarUrls.get(clientId);
      if (cached?.storagePath === storagePath) {
        image.src = cached.url;
        image.hidden = false;
        return;
      }
      try {
        const loadKey = `${clientId}:${storagePath}`;
        let load = hiredClientAvatarLoads.get(loadKey);
        if (!load) {
          load = getDocumentBlob(storagePath).then(blob => {
            const item = data.applications.find(application => application.id === clientId);
            if (!item || item.profileImage?.storagePath !== storagePath) return '';
            cacheHiredClientAvatar(clientId, storagePath, blob);
            return hiredClientAvatarUrls.get(clientId).url;
          }).finally(() => hiredClientAvatarLoads.delete(loadKey));
          hiredClientAvatarLoads.set(loadKey, load);
        }
        const url = await load;
        if (!url || !image.isConnected || image.dataset.clientAvatarPath !== storagePath) return;
        image.src = url;
        image.hidden = false;
      } catch (error) {
        console.error('Could not load client profile photo:', error);
        showActionResult({
          title: 'Profile photo could not be loaded',
          message: 'The client photo is unavailable. The initials avatar will remain visible.',
          status: 'error'
        });
      }
    });
  }

  function formatFileSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function isContractEnded(item) {
    return String(item.contractStatus || '').trim().toLowerCase() === 'contract ended'
      || Boolean(item.contractEndDate && dateKey(item.contractEndDate) < today());
  }

  function isActiveContract(item) {
    return item.status === 'Active client'
      && !isContractEnded(item)
      && String(item.contractStatus || 'Active').trim().toLowerCase() === 'active';
  }

  function contractEndingLabel(item) {
    if (!item.contractEndDate || isContractEnded(item)) return '';
    const endDate = new Date(`${dateKey(item.contractEndDate)}T12:00:00`);
    const currentDate = new Date(`${today()}T12:00:00`);
    const daysRemaining = Math.round((endDate - currentDate) / 86400000);
    if (daysRemaining < 0 || daysRemaining > 7) return '';
    if (daysRemaining === 0) return 'Ends today';
    return `Ends in ${plural(daysRemaining, 'day')}`;
  }

  function clientOnlineStatus(item, now = new Date()) {
    const timeZone = clientTimeZones.get(item.id);
    if (!timeZone) return { className: 'unknown', text: 'Time zone not set', localTime: '', utcOffset: '', country: '' };
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
        hourCycle: 'h23'
      }).formatToParts(now);
      const part = type => parts.find(value => value.type === type)?.value;
      const weekday = part('weekday');
      const hour = Number(part('hour'));
      if (!weekday || !Number.isInteger(hour)) return { className: 'unknown', text: 'Time zone not set', localTime: '', utcOffset: '', country: '' };
      const localTime = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: 'numeric',
        minute: '2-digit'
      }).format(now);
      const offsetLabel = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'longOffset'
      }).formatToParts(now).find(value => value.type === 'timeZoneName')?.value || 'GMT';
      const utcOffset = offsetLabel === 'GMT' || offsetLabel === 'UTC'
        ? 'UTC+00:00'
        : offsetLabel.replace(/^GMT/, 'UTC');
      const availabilityMatch = String(item.clientAvailability || '').match(/^\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*[–-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*$/i);
      const validAvailability = availabilityMatch
        && [1, 4].every(index => Number(availabilityMatch[index]) >= 1 && Number(availabilityMatch[index]) <= 12)
        && [2, 5].every(index => !availabilityMatch[index] || Number(availabilityMatch[index]) <= 59);
      const availabilityMinutes = validAvailability ? availabilityMatch.slice(1).map(Number) : null;
      const toMinutes = (hours, minutes, meridiem) => ((hours % 12) + (meridiem.toUpperCase() === 'PM' ? 12 : 0)) * 60 + minutes;
      const parsedStartMinutes = availabilityMinutes
        ? toMinutes(availabilityMinutes[0], availabilityMinutes[1] || 0, availabilityMatch[3])
        : 9 * 60;
      const parsedEndMinutes = availabilityMinutes
        ? toMinutes(availabilityMinutes[3], availabilityMinutes[4] || 0, availabilityMatch[6])
        : 17 * 60;
      const hasAvailability = Boolean(availabilityMinutes && parsedEndMinutes > parsedStartMinutes);
      const startMinutes = hasAvailability ? parsedStartMinutes : 9 * 60;
      const endMinutes = hasAvailability ? parsedEndMinutes : 17 * 60;
      const availability = hasAvailability ? item.clientAvailability : '';
      const localMinutes = hour * 60 + Number(part('minute'));
      const isOnline = !['Sat', 'Sun'].includes(weekday) && localMinutes >= startMinutes && localMinutes < endMinutes;
      const country = String(item.location || '').trim();
      return {
        className: isOnline ? 'online' : 'offline',
        text: `${isOnline ? 'Online now' : 'Offline'} · ${localTime} · ${utcOffset}${country ? ` · ${country}` : ''}${availability ? ` · ${availability}` : ''}`,
        localTime,
        utcOffset,
        country,
        availability
      };
    } catch (error) {
      if (error instanceof RangeError) return { className: 'unknown', text: 'Time zone not set', localTime: '', utcOffset: '', country: '' };
      throw error;
    }
  }

  function clientOnlineStatusTitle(status) {
    return `Estimated from weekdays and the client's submitted work hours${status.availability ? ` (${status.availability})` : ' (9 AM–5 PM default)'}`;
  }

  function renderClientOnlineStatus(item, includeLabel = true) {
    const status = clientOnlineStatus(item);
    return `<span class="client-online-status ${status.className}${includeLabel ? '' : ' status-dot-only'}" title="${includeLabel ? escapeHtml(clientOnlineStatusTitle(status)) : escapeHtml(status.text)}" aria-label="${escapeHtml(status.text)}" data-client-online-status="${escapeHtml(item.id)}" data-status-dot-only="${!includeLabel}">${includeLabel ? escapeHtml(status.text) : ''}</span>`;
  }

  function updateClientOnlineIndicators() {
    document.querySelectorAll('[data-client-online-status]').forEach(indicator => {
      const item = data.applications.find(application => application.id === indicator.dataset.clientOnlineStatus);
      if (!item) return;
      const status = clientOnlineStatus(item);
      indicator.className = `client-online-status ${status.className}${indicator.dataset.statusDotOnly === 'true' ? ' status-dot-only' : ''}`;
      if (indicator.classList.contains('status-dot-only')) {
        indicator.textContent = '';
        indicator.title = status.text;
        indicator.setAttribute('aria-label', status.text);
        const timeZoneText = indicator.closest('.hired-card-timezone')?.querySelector('[data-client-timezone-text]');
        if (timeZoneText && status.localTime) timeZoneText.textContent = `${status.localTime} (${status.utcOffset})${status.country ? ` · ${status.country}` : ''}${status.availability ? ` · ${status.availability}` : ''}`;
      } else {
        indicator.textContent = status.text;
        indicator.title = clientOnlineStatusTitle(status);
      }
    });
    const detailIndicator = $('#hiredDetailOnlineStatus');
    const detailClient = data.applications.find(application => application.id === hiredEditingId);
    if (detailIndicator && detailClient) {
      const status = clientOnlineStatus(detailClient);
      detailIndicator.className = `client-online-status ${status.className}`;
      detailIndicator.textContent = status.text;
      detailIndicator.title = clientOnlineStatusTitle(status);
    }
  }

  setInterval(updateClientOnlineIndicators, 60000);
  window.addEventListener('focus', updateClientOnlineIndicators);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateClientOnlineIndicators();
  });

  let showingHiredClientList = false;

  function renderHired() {
    const allHired = sortByDate(hiredClients(), activeSinceDate, hiredDateSort);
    const query = $('#hiredSearch').value.trim().toLowerCase();
    const filter = $('#hiredStatusFilter').value;
    const clients = allHired.filter(item => {
      const contractStatus = isContractEnded(item) ? 'Contract Ended' : (item.contractStatus || 'Active');
      const searchableText = [
        item.clientName, item.email, item.phone, item.website, item.socialMedia,
        ...normalizeClientSocialLinks(item).flatMap(link => [link.platform, CLIENT_SOCIAL_PLATFORM_LABELS[link.platform], link.url]), item.location,
        item.companyName, item.company, item.role, contractStatus
      ].join(' ').toLowerCase();
      return (filter === 'all' || contractStatus === filter)
        && (!query || searchableText.includes(query));
    });
    const nonEndedClients = clients.filter(item => !isContractEnded(item));
    const endedClients = clients.filter(isContractEnded);
    const target = $('#hiredList');
    const detailPanel = $('#hiredDetailPanel');
    const hiredView = $('#hiredView');
    const panel = target.closest('.hired-panel');
    const allActiveClients = allHired.filter(isActiveContract);
    const allEndedClients = allHired.filter(isContractEnded);
    $('#hiredCountLabel').textContent = `${allHired.length} ${allHired.length === 1 ? 'client' : 'clients'}`;
    $('#hiredActiveSummary').textContent = String(allActiveClients.length);
    $('#hiredEndedSummary').textContent = String(allEndedClients.length);
    const selected = allHired.find(item => item.id === hiredEditingId)
      || allActiveClients[0];
    if (!selected && allHired.length) showingHiredClientList = true;

    if (showingHiredClientList) {
      hiredView.classList.remove('client-focused');
      $('#hiredCountLabel').hidden = false;
      $('#hiredHeaderSummary').hidden = false;
      detailPanel.classList.add('hidden');
      detailPanel.dataset.clientId = '';
      panel.hidden = false;
      target.innerHTML = clients.length
        ? [
          ...nonEndedClients.map(renderActiveClientCard),
          ...(endedClients.length ? ['<h3 class="hired-ended-heading">Ended</h3>', ...endedClients.map(renderActiveClientCard)] : [])
        ].join('')
        : `<div class="application-empty"><h3>${allHired.length ? 'No matching clients' : 'No clients yet'}</h3><p>${allHired.length ? 'Try changing your search or filters.' : 'Clients marked as active in your tracker will appear here.'}</p></div>`;
      renderHiredClientAvatars();
      return;
    }
    if (selected) {
      renderHiredDetail(selected, false);
      return;
    }
    hiredView.classList.remove('client-focused');
    $('#hiredCountLabel').hidden = false;
    $('#hiredHeaderSummary').hidden = false;
    target.innerHTML = '<div class="application-empty"><h3>No active clients yet</h3><p>Clients with an active contract will appear here.</p></div>';
    panel.hidden = false;
    detailPanel.classList.add('hidden');
    detailPanel.dataset.clientId = '';
  }

  function renderActiveClientCard(item) {
    const docs = item.documents || [];
    const contractEnded = isContractEnded(item);
    const contractStatus = contractEnded ? 'Contract Ended' : (item.contractStatus || 'Active');
    const endingLabel = contractEnded ? 'Contract ended' : contractEndingLabel(item);
    const statusLabel = endingLabel || (contractStatus === 'Not active' ? 'Not active' : 'Active');
    const statusPillClass = contractEnded ? 'contract-ended'
      : (endingLabel ? 'contract-ending-soon' : (contractStatus === 'Not active' ? 'not-active' : 'contract-active'));
    const contractDetails = [
      item.employmentType,
      activeSinceDate(item) ? `Since ${emailDate(activeSinceDate(item))}` : ''
    ].filter(Boolean).map(escapeHtml).join(' · ');
    const initials = clientInitials(item.clientName);
    const avatarTone = clientAvatarHue(item.clientName);
    const emailMarkup = item.email ? `<span class="hired-card-email" title="${escapeHtml(item.email)}">${escapeHtml(item.email)}</span>` : '';
    const websiteMarkup = item.website ? `<a class="hired-card-website" href="${escapeHtml(normalizeUrl(item.website))}" target="_blank" rel="noopener"><i class="fa-solid fa-globe" aria-hidden="true"></i><span>${escapeHtml(item.website)}</span></a>` : '';
    const companyMarkup = item.companyName || item.company
      ? `<span class="hired-card-company">${escapeHtml(item.companyName || item.company)}</span>`
      : websiteMarkup;
    const matchCount = matchingEmailsForApplication(item)
      .filter(emailItem => !isSentEmail(emailItem)).length;
    const matchMarkup = matchCount
      ? `<span class="hired-card-match"><i class="fa-regular fa-envelope" title="Emails" aria-label="Emails"></i>${matchBadge(item).replace('title="View matching application emails"', `title="${matchCount} matching incoming emails"`)}</span>`
      : '';
    const timeZone = clientTimeZones.has(item.id) ? clientOnlineStatus(item) : null;
    const timeZoneMarkup = timeZone?.localTime
      ? `<span class="hired-card-timezone">${!contractEnded ? renderClientOnlineStatus(item, false) : ''}<span class="hired-card-timezone-separator" aria-hidden="true">·</span><span data-client-timezone-text>${escapeHtml(`${timeZone.localTime} (${timeZone.utcOffset})${timeZone.country ? ` · ${timeZone.country}` : ''}`)}</span></span>`
      : '';
    const avatarPath = item.profileImage?.storagePath || '';
    const clientDisplayName = [item.contact, item.companyName || item.company || item.clientName]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .join(' | ') || 'Active client';
    return `<article class="hired-card${contractEnded ? ' contract-ended-card' : ''}" data-hired-select="${escapeHtml(item.id)}" tabindex="0" role="button">
      <span class="hired-card-heading"><span class="hired-card-profile"><span class="hired-card-avatar" style="--avatar-tone:${avatarTone}"><span aria-hidden="true">${escapeHtml(initials)}</span>${avatarPath ? `<img class="hired-card-avatar-image" data-client-avatar-id="${escapeHtml(item.id)}" data-client-avatar-path="${escapeHtml(avatarPath)}" alt="${escapeHtml(item.clientName)} profile photo" hidden />` : ''}</span><span class="hired-card-identity"><strong class="client-card-title hired-client-contact-name" title="${escapeHtml(clientDisplayName)}">${escapeHtml(clientDisplayName)}</strong>${item.role ? `<span class="client-card-subtitle">${escapeHtml(item.role)}</span>` : ''}</span></span><span class="client-contract-status ${statusPillClass}">${escapeHtml(statusLabel)}</span></span>
      ${emailMarkup ? `<span class="hired-card-email-line">${emailMarkup}</span>` : ''}
      ${companyMarkup || timeZoneMarkup ? `<span class="hired-card-contact">${companyMarkup}${timeZoneMarkup}</span>` : ''}
      ${contractDetails ? `<span class="hired-card-contract"><i class="fa-regular fa-calendar" aria-hidden="true"></i>${contractDetails}</span>` : ''}
      <span class="hired-card-footer">${docs.length ? `<span class="hired-card-files" title="${escapeHtml(plural(docs.length, 'file'))}"><i class="fa-regular fa-file" aria-hidden="true"></i>${escapeHtml(plural(docs.length, 'file'))}</span>` : ''}${matchMarkup}<span class="view-details-label">View Details <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></span></span>
    </article>`;
  }

  $('#backToHiredList').addEventListener('click', () => {
    showingHiredClientList = true;
    renderHired();
  });
  $('#hiredSearch').addEventListener('input', renderHired);
  $('#hiredDateSort').addEventListener('change', event => {
    hiredDateSort = event.target.value;
    renderHired();
  });
  $('#hiredStatusFilter').addEventListener('change', renderHired);

  function renderHiredDetail(item, scroll = true) {
    if (!item) return;
    showingHiredClientList = false;
    $('#hiredCountLabel').hidden = true;
    $('#hiredHeaderSummary').hidden = true;
    hiredEditingId = item.id;
    $('#hiredView').classList.add('client-focused');
    $('#hiredList').innerHTML = '';
    $('#hiredList').closest('.hired-panel').hidden = true;
    const detailPanel = $('#hiredDetailPanel');
    detailPanel.classList.remove('hidden');
    if (detailPanel.dataset.clientId !== item.id) {
      detailPanel.dataset.clientId = item.id;
      selectClientDetailTab('overview');
    }
    const contractEnded = isContractEnded(item);
    const contractStatus = contractEnded ? 'Contract Ended' : (item.contractStatus || 'Active');
    const contractStatusClass = contractEnded ? 'contract-ended' : (contractStatus === 'Not active' ? 'not-active' : 'contract-active');
    const salaryLabel = item.salaryType === 'monthly' && Number(item.salaryAmount) > 0
      ? `${salaryCurrencySymbol(item.salaryCurrency)}${Number(item.salaryAmount).toLocaleString()} / month`
      : item.salaryType === 'hourly' && Number(item.salaryAmount) > 0 && Number(item.hoursPerWeek) > 0
        ? `${salaryCurrencySymbol(item.salaryCurrency)}${Math.round(Number(item.salaryAmount) * Number(item.hoursPerWeek) * 4).toLocaleString()} / month (estimated)`
        : item.salaryType === 'hourly' && Number(item.salaryAmount) > 0
          ? `${salaryCurrencySymbol(item.salaryCurrency)}${Number(item.salaryAmount).toLocaleString()} / hour`
          : '';
    $('#hiredDetailTitle').textContent = 'Client details';
    $('#hiredDetailSubtitle').textContent = item.role || 'Client workspace';
    $('#hiredDetailStatus').className = `status-pill ${contractStatusClass}`;
    $('#hiredDetailStatus').textContent = contractStatus;
    const onlineStatus = $('#hiredDetailOnlineStatus');
    onlineStatus.dataset.clientOnlineStatus = item.id;
    const clientStatus = clientOnlineStatus(item);
    onlineStatus.className = `client-online-status ${clientStatus.className}`;
    onlineStatus.textContent = clientStatus.text;
    onlineStatus.title = clientOnlineStatusTitle(clientStatus);
    const contactDetails = [
      item.email ? `<a href="mailto:${escapeHtml(item.email)}">${escapeHtml(item.email)}</a>` : '',
      item.phone ? `<a href="tel:${escapeHtml(item.phone)}">${escapeHtml(item.phone)}</a>` : ''
    ].filter(Boolean);
    $('#hiredDetailContact').innerHTML = contactDetails.length
      ? `<span class="hired-detail-contact-separator" aria-hidden="true">·</span>${contactDetails.join('<span class="hired-detail-contact-separator" aria-hidden="true">·</span>')}`
      : '';
    const invoices = (data.invoices || []).filter(invoice => invoice.clientId === item.id).sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
    const sentEmails = sentEmailsForApplication(item);
    const latestInvoice = invoices[0];
    const latestEmail = sentEmails[0];
    const profileImagePath = item.profileImage?.storagePath || '';
    const clientDetailName = [item.contact, item.companyName || item.company || item.clientName]
      .map(value => String(value || '').trim()).filter(Boolean).join(' | ') || 'Active client';
    $('#clientOverviewProfile').innerHTML = `
      <article class="client-overview-profile-card">
        <div class="client-overview-profile-main">
          <span class="client-overview-profile-photo" data-client-avatar-control>
            <span class="client-overview-profile-avatar"><span aria-hidden="true">${escapeHtml(clientInitials(item.clientName))}</span>${profileImagePath ? `<img class="client-overview-profile-image" data-client-avatar-id="${escapeHtml(item.id)}" data-client-avatar-path="${escapeHtml(profileImagePath)}" alt="${escapeHtml(item.clientName)} profile photo" hidden />` : ''}</span>
            <button class="client-overview-profile-upload" type="button" data-client-avatar-upload="${escapeHtml(item.id)}" aria-label="${profileImagePath ? 'Change' : 'Upload'} profile photo for ${escapeHtml(item.clientName)}" title="${profileImagePath ? 'Change profile photo' : 'Upload profile photo'}"><i class="fa-solid fa-camera" aria-hidden="true"></i></button>
            <input type="file" accept=".jpg,.jpeg,.jpe,.png,.webp,image/jpeg,image/jpg,image/pjpeg,image/png,image/x-png,image/webp" data-client-avatar-input="${escapeHtml(item.id)}" aria-label="Choose a profile photo for ${escapeHtml(item.clientName)}" hidden />
          </span>
          <div class="client-overview-profile-identity"><span>CLIENT PROFILE</span><div class="client-overview-profile-name"><h3 title="${escapeHtml(clientDetailName)}">${escapeHtml(clientDetailName)}</h3><span class="status-pill ${contractStatusClass}">${escapeHtml(contractStatus)}</span></div><p>${escapeHtml(item.role || 'Client workspace')}</p></div>
        </div>
        <div class="client-overview-profile-facts">
          ${item.email ? `<a href="mailto:${escapeHtml(item.email)}"><i class="fa-regular fa-envelope" aria-hidden="true"></i><span>${escapeHtml(item.email)}</span></a>` : ''}
          ${item.phone ? `<a href="tel:${escapeHtml(item.phone)}"><i class="fa-solid fa-phone" aria-hidden="true"></i><span>${escapeHtml(item.phone)}</span></a>` : ''}
          <span><i class="fa-regular fa-calendar" aria-hidden="true"></i><span>${item.contractEndDate ? `Ends ${escapeHtml(formatDate(item.contractEndDate))}` : 'No end date set'}</span></span>
          ${salaryLabel ? `<span><i class="fa-solid fa-coins" aria-hidden="true"></i><span>${escapeHtml(salaryLabel)}</span></span>` : ''}
        </div>
      </article>`;
    renderHiredClientAvatars();
    $('#clientOverviewSummary').innerHTML = `
      <div class="client-overview-summary-item"><span>Active since</span><strong>${escapeHtml(emailDate(activeSinceDate(item)))}</strong><small>${escapeHtml(contractStatus)} engagement</small></div>
      <div class="client-overview-summary-item"><span>Onboarding</span><strong id="clientOverviewOnboardingStatus">Checking status</strong><small>Client form response</small></div>
      <div class="client-overview-summary-item"><span>Invoices</span><strong>${escapeHtml(plural(invoices.length, 'invoice'))}</strong><small>${latestInvoice ? `Last sent ${escapeHtml(emailDate(latestInvoice.sentAt))}` : 'No invoices sent yet'}</small></div>
      <div class="client-overview-summary-item"><span>Email History</span><strong>${escapeHtml(plural(sentEmails.length, 'email'))}</strong><small>${latestEmail ? `Last sent ${escapeHtml(emailDate(latestEmail.date))}` : 'No emails sent yet'}</small></div>`;
    const detailsMarkup = fields => fields.filter(([, value]) => value).map(([label, value]) => `
      <div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`).join('');
    const contactFields = detailsMarkup([
      ['Contact', item.contact && escapeHtml(item.contact)],
      ['Email', item.email && `<a href="mailto:${escapeHtml(item.email)}">${escapeHtml(item.email)}</a>`],
      ['Phone', item.phone && `<a href="tel:${escapeHtml(item.phone)}">${escapeHtml(item.phone)}</a>`],
      ['Application Link', item.website && `<a href="${escapeHtml(normalizeUrl(item.website))}" target="_blank" rel="noopener">${escapeHtml(item.website)}</a>`],
      ['Social media & websites', clientSocialLinksMarkup(item)],
      ['Location', item.location && escapeHtml(item.location)]
    ]);
    const workFields = detailsMarkup([
      ['Position', item.role && escapeHtml(item.role)],
      ['Platform', item.platform && escapeHtml(item.platform)],
      ['Employment type', item.employmentType && escapeHtml(item.employmentType)],
      ['Compensation', salaryLabel && escapeHtml(salaryLabel)],
      ['Hours per week', Number(item.hoursPerWeek) > 0 && escapeHtml(String(item.hoursPerWeek))]
    ]);
    $('#hiredDetailGrid').innerHTML = `
      <section class="hired-detail-info-group">
        <h4>Contact Information</h4>
        ${contactFields ? `<dl>${contactFields}</dl>` : '<p class="client-detail-empty-copy">No contact information has been added.</p>'}
      </section>
      <section class="hired-detail-info-group">
        <h4>Work Information</h4>
        ${workFields ? `<dl>${workFields}</dl>` : '<p class="client-detail-empty-copy">No work information has been added.</p>'}
      </section>
      <section class="hired-detail-info-group hired-detail-timeline">
        <h4>Client History</h4>
        <dl>${detailsMarkup([
          ['Applied', item.appliedDate && escapeHtml(emailDate(item.appliedDate))],
          ['Added', escapeHtml(emailDate(applicationAddedDate(item)))],
          ['Active since', escapeHtml(emailDate(activeSinceDate(item)))]
        ])}</dl>
      </section>
      ${item.notes ? `<section class="hired-detail-info-group hired-detail-notes"><h4>Notes</h4><p>${escapeHtml(item.notes)}</p></section>` : ''}`;
    $('#clientContractSummary').innerHTML = `
      <dl class="client-contract-facts">
        <div><dt>Status</dt><dd><span class="status-pill ${contractStatusClass}">${escapeHtml(contractStatus)}</span></dd></div>
        <div><dt>Active since</dt><dd>${escapeHtml(emailDate(activeSinceDate(item)))}</dd></div>
        <div><dt>End date</dt><dd>${item.contractEndDate ? escapeHtml(formatDate(item.contractEndDate)) : 'No end date set'}</dd></div>
        ${item.contractEndDate && contractDuration(item) ? `<div><dt>Duration</dt><dd>${escapeHtml(contractDuration(item))}</dd></div>` : ''}
        ${contractEnded ? `<div><dt>Contract ended email</dt><dd><span class="status-pill ${item.contractEndedEmailSentAt ? 'contract-active' : 'not-active'}">${item.contractEndedEmailSentAt ? 'Sent' : 'Not sent'}</span></dd></div>` : ''}
      </dl>`;
    $('#clientInvoiceWorkspace').innerHTML = `
      <section class="invoice-send-panel client-invoice-panel${contractEnded ? ' contract-ended-readonly' : ''}" aria-labelledby="clientInvoicesTitle">
        <div class="invoice-send-heading"><div><p class="eyebrow">BILLING</p><h3 id="clientInvoicesTitle">Invoices</h3></div><div class="client-invoice-heading-actions"><span class="invoice-sent-count">${escapeHtml(plural(invoices.length, 'invoice'))}</span></div></div>
        ${contractEnded ? '<div class="client-invoice-actions"><p class="client-invoice-notice">Invoice sending is unavailable while this contract is ended.</p></div>' : ''}
        ${invoices.length ? `${invoicePaymentSummary(invoices)}<div class="client-invoice-list" role="list">${invoices.map(invoice => {
          const status = invoicePaymentStatus(invoice);
          const paid = status === 'Paid';
          const dueDate = parseInvoiceDate(invoice.dueDate);
          const invoiceNumber = invoice.invoiceNumber || 'Invoice';
          const displayedStatus = paid ? 'Paid' : status === 'Overdue' ? 'Overdue' : 'Unpaid';
          const dueDays = dueDate ? Math.round((new Date(`${dueDate}T00:00:00Z`) - new Date(`${today()}T00:00:00Z`)) / 86400000) : null;
          const dueCopy = dueDays === null ? '' : dueDays < 0 ? `overdue by ${plural(Math.abs(dueDays), 'day')}` : dueDays === 0 ? 'due today' : `in ${plural(dueDays, 'day')}`;
          const paidDate = parseInvoiceDate(invoice.paidAt);
          const paidAmount = invoice.amountReceived === '' || invoice.amountReceived == null ? '' : Number(invoice.amountReceived);
          const paidInfo = [Number.isFinite(paidAmount) ? `${paidAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}${invoice.paymentCurrency ? ` ${String(invoice.paymentCurrency).toUpperCase()}` : ''}` : '', invoice.paymentMethod || ''].filter(Boolean).join(' · ');
          return `
          <article class="client-invoice-item" role="listitem">
            <div class="client-invoice-main"><div class="client-invoice-title"><strong>${escapeHtml(invoiceNumber)}</strong><span class="status-pill ${paid ? 'contract-active' : status === 'Overdue' ? 'not-active' : 'applied'}">${escapeHtml(displayedStatus)}</span></div><span class="client-invoice-file" title="${escapeHtml(invoice.fileName || 'Invoice document')}">${escapeHtml(invoice.fileName || 'Invoice document')}</span></div>
            <div class="client-invoice-meta">
              ${invoice.service ? `<div class="client-invoice-meta-item"><span>Service</span><strong title="${escapeHtml(invoice.service)}">${escapeHtml(invoice.service)}</strong></div>` : ''}
              ${invoice.billingPeriod ? `<div class="client-invoice-meta-item"><span>Period</span><strong>${escapeHtml(invoice.billingPeriod)}</strong></div>` : ''}
              ${invoice.sentAt ? `<div class="client-invoice-meta-item"><span>Sent</span><strong>${escapeHtml(emailDate(invoice.sentAt))}</strong></div>` : ''}
              ${dueDate && !paid ? `<div class="client-invoice-meta-item"><span>Due</span><strong>${escapeHtml(formatDate(dueDate))}${dueCopy ? ` · <span class="${dueDays < 0 ? 'client-invoice-overdue-copy' : ''}">${escapeHtml(dueCopy)}</span>` : ''}</strong></div>` : ''}
            </div>
            <div class="client-invoice-date">${paid ? `<strong class="client-invoice-paid-date">Paid on ${escapeHtml(paidDate ? formatDate(paidDate) : emailDate(invoice.paidAt))}</strong>${paidInfo ? `<span class="client-invoice-paid-detail">${escapeHtml(paidInfo)}</span>` : ''}` : ''}<div class="client-invoice-payment-actions">${paid ? `<button class="button button-secondary" type="button" data-invoice-edit-payment="${escapeHtml(invoice.id)}" aria-label="Edit payment for invoice ${escapeHtml(invoiceNumber)}">Edit payment</button><button class="client-invoice-unpaid-action" type="button" data-invoice-mark-unpaid="${escapeHtml(invoice.id)}" aria-label="Mark invoice ${escapeHtml(invoiceNumber)} as unpaid">Mark as unpaid</button>` : `<button class="button button-secondary" type="button" data-invoice-mark-paid="${escapeHtml(invoice.id)}" aria-label="Mark invoice ${escapeHtml(invoiceNumber)} as paid">Mark as paid</button>`}</div></div>
          </article>`;
        }).join('')}</div>` : `<div class="client-section-empty client-invoice-empty"><h4>No invoices yet</h4><p>${contractEnded ? 'No invoices have been sent to this client.' : 'Send an invoice to keep billing history together.'}</p></div>`}
      </section>`;
    $('#clientEmailHistoryWorkspace').innerHTML = renderHiredEmailHistory(item);
    $('#clientDocumentActions').innerHTML = contractEnded
      ? '<span class="details-readonly-label">Read only</span>'
      : '<input id="hiredDetailDocumentInput" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden />';
    $('#clientDocumentBox').classList.toggle('contract-ended-readonly', contractEnded);
    $('#documentsFolderStatus').textContent = 'Files are stored securely in your account.';
    renderHiredDocumentWorkspace(item);
    loadClientOnboardingSubmission(item);
    renderClientTasks(item.id);
    if (scroll) $('#hiredDetailPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateHiredClientPhoneDisplay(item) {
    const contactDetails = [
      item.email ? `<a href="mailto:${escapeHtml(item.email)}">${escapeHtml(item.email)}</a>` : '',
      item.phone ? `<a href="tel:${escapeHtml(item.phone)}">${escapeHtml(item.phone)}</a>` : ''
    ].filter(Boolean);
    $('#hiredDetailContact').innerHTML = contactDetails.length
      ? `<span class="hired-detail-contact-separator" aria-hidden="true">·</span>${contactDetails.join('<span class="hired-detail-contact-separator" aria-hidden="true">·</span>')}`
      : '';

    const contactSection = $('#hiredDetailGrid .hired-detail-info-group');
    if (!contactSection) return;
    let details = contactSection.querySelector('dl');
    const phoneRow = [...(details?.children || [])].find(row => row.querySelector('dt')?.textContent === 'Phone');
    if (!item.phone) {
      phoneRow?.remove();
      return;
    }
    if (!details) {
      contactSection.querySelector('.client-detail-empty-copy')?.remove();
      details = document.createElement('dl');
      contactSection.append(details);
    }
    const row = phoneRow || document.createElement('div');
    if (!phoneRow) {
      const term = document.createElement('dt');
      term.textContent = 'Phone';
      row.append(term, document.createElement('dd'));
      details.append(row);
    }
    const phoneLink = document.createElement('a');
    phoneLink.href = `tel:${item.phone.replace(/[^+\d]/g, '')}`;
    phoneLink.textContent = item.phone;
    row.querySelector('dd').replaceChildren(phoneLink);
  }

  async function loadClientOnboardingSubmission(item) {
    const target = $('#activeOnboardingResponse');
    if (!target) return;
    target.dataset.clientId = item.id;
    updateClientOnboardingStatus('Checking status', 'pending');
    target.innerHTML = '<p class="client-onboarding-loading">Loading onboarding details…</p>';
    try {
      const { data: submission, error } = await requireSupabase().rpc('get_client_onboarding_submission', {
        p_client_id: item.id
      });
      if (error) throw error;
      if (target.dataset.clientId !== item.id || hiredEditingId !== item.id) return;
      if (!submission) {
        clientTimeZones.delete(item.id);
        updateClientOnlineIndicators();
        updateClientOnboardingStatus('Not submitted', 'empty');
        target.innerHTML = '<div class="client-section-empty"><h4>No onboarding submission yet</h4><p>Use Actions → Send onboarding form to invite this client.</p></div>';
        return;
      }
      const submissionTimestamp = String(submission.submitted_at || '');
      let onboardingDetailsChanged = false;
      const submittedContactName = String(submission.contact_name || '').trim();
      if (submittedContactName && submissionTimestamp && item.onboardingContactSubmissionAppliedAt !== submissionTimestamp) {
        item.contact = submittedContactName;
        item.onboardingContactSubmissionAppliedAt = submissionTimestamp;
        onboardingDetailsChanged = true;
      }
      const submittedPhone = String(submission.phone || '').trim();
      if (submittedPhone && submissionTimestamp && item.onboardingPhoneSubmissionAppliedAt !== submissionTimestamp) {
        item.phone = submittedPhone;
        item.onboardingPhoneSubmissionAppliedAt = submissionTimestamp;
        onboardingDetailsChanged = true;
      }
      const submittedAvailability = String(submission.availability || '').trim();
      if (submittedAvailability && submissionTimestamp && item.onboardingAvailabilitySubmissionAppliedAt !== submissionTimestamp) {
        item.clientAvailability = submittedAvailability;
        item.onboardingAvailabilitySubmissionAppliedAt = submissionTimestamp;
        onboardingDetailsChanged = true;
      }
      if (onboardingDetailsChanged) {
        item.updatedAt = new Date().toISOString();
        const profileName = $('#clientOverviewProfile .client-overview-profile-name h3');
        if (profileName) {
          profileName.textContent = [item.contact, item.companyName || item.company || item.clientName]
            .map(value => String(value || '').trim()).filter(Boolean).join(' | ') || 'Active client';
          profileName.title = profileName.textContent;
        }
        if (submittedPhone) updateHiredClientPhoneDisplay(item);
        await persist();
      }
      if (submission.timezone) clientTimeZones.set(item.id, submission.timezone);
      else clientTimeZones.delete(item.id);
      updateClientOnlineIndicators();
      const onboardingParts = [
        {
          title: 'Part 1: About you',
          details: [
            ['Client contact', submission.contact_name],
            ['Email', submission.client_email],
            ['Phone', submission.phone],
            ['Company or business name', submission.details?.companyName],
            ['Role or title', submission.details?.role]
          ]
        },
        {
          title: 'Part 2: Services and communication',
          details: [
            ['Services needed', Array.isArray(submission.details?.services) ? submission.details.services.join(', ') : ''],
            ['Expected hours per week', submission.details?.hoursPerWeek],
            ['Desired start date', submission.details?.startDate],
            ['Communication channel', submission.details?.preferredChannel],
            ['Expected response time', submission.details?.responseTime]
          ]
        },
        {
          title: 'Part 3: Schedule',
          details: [
            ['Time zone', submission.timezone],
            ['Availability and preferred working hours', submission.availability],
            ['Holidays or blackout dates', submission.details?.blackoutDates]
          ]
        },
        {
          title: 'Part 4: Tools and contacts',
          details: [
            ['Tools or platforms', submission.tools],
            ['First-week priorities', submission.priorities],
            ['Access sharing method', submission.details?.accessMethod],
            ['Backup contact name', submission.details?.backupName],
            ['Backup contact email', submission.details?.backupEmail],
            ['Backup contact phone', submission.details?.backupPhone],
            ['Approval preferences', submission.details?.approval],
            ['Confidentiality and terms agreement', submission.details?.agreement ? 'Agreed' : '']
          ]
        }
      ];
      target.replaceChildren();
      updateClientOnboardingStatus('Submitted', 'complete');
      const submittedAt = document.createElement('p');
      submittedAt.className = 'active-client-onboarding-submitted';
      submittedAt.textContent = `Submitted ${new Date(submission.submitted_at).toLocaleString()}`;
      const parts = document.createElement('div');
      parts.className = 'active-client-onboarding-parts';
      onboardingParts.forEach(part => {
        const section = document.createElement('section');
        section.className = 'active-client-onboarding-part';
        const heading = document.createElement('h4');
        heading.textContent = part.title;
        const list = document.createElement('dl');
        list.className = 'active-client-onboarding-details';
        part.details.forEach(([label, value]) => {
          const wrapper = document.createElement('div');
          const term = document.createElement('dt');
          const description = document.createElement('dd');
          term.textContent = label;
          description.textContent = value || 'Not provided';
          wrapper.append(term, description);
          list.append(wrapper);
        });
        section.append(heading, list);
        parts.append(section);
      });
      target.append(submittedAt, parts);
    } catch (error) {
      console.error('Could not load client onboarding response:', error);
      if (target.dataset.clientId === item.id && hiredEditingId === item.id) {
        updateClientOnboardingStatus('Unavailable', 'error');
        target.innerHTML = '<div class="client-section-empty"><h4>Onboarding could not be loaded</h4><p>Check your connection and try again.</p></div>';
      }
    }
  }

  function updateClientOnboardingStatus(label, state) {
    ['#clientOverviewOnboardingStatus', '#clientOnboardingStatus'].forEach(selector => {
      const status = $(selector);
      if (!status) return;
      status.className = `client-onboarding-status ${state}`;
      status.textContent = label;
    });
  }

  function selectClientDetailTab(tabName, focus = false) {
    const detailPanel = $('#hiredDetailPanel');
    if (!detailPanel) return;
    detailPanel.querySelectorAll('[data-client-detail-tab]').forEach(tab => {
      const isSelected = tab.dataset.clientDetailTab === tabName;
      tab.classList.toggle('active', isSelected);
      tab.setAttribute('aria-selected', String(isSelected));
      tab.tabIndex = isSelected ? 0 : -1;
      if (isSelected && focus) tab.focus();
    });
    detailPanel.querySelectorAll('[data-client-detail-panel]').forEach(panel => {
      panel.hidden = panel.dataset.clientDetailPanel !== tabName;
    });
    if (tabName === 'tasks') renderClientTasks(hiredEditingId);
  }

  function closeHiredDetail(render = true) {
    hiredEditingId = null;
    $('#hiredView').classList.remove('client-focused');
    $('#hiredDetailPanel').classList.add('hidden');
    $('#hiredDetailPanel').dataset.clientId = '';
    if (render) renderHired();
  }

