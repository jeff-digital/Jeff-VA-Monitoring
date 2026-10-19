  // --- Application/email matching ---
  const PLATFORM_SENDER_EMAILS = Object.freeze({
    '20four7va': 'info@20four7va.com',
    indeed: 'donotreply@jobalert.indeed.com',
    jobstreet: 'noreply@e.jobstreet.com',
    multiplymii: 'info@multiplymii.com',
    'onlinejobs.ph': 'support@onlinejobs.ph',
    'remote work ph': 'support@remotework.ph',
    zirtual: 'noreply@candidates.workablemail.com'
  });
  const PLATFORM_DISPLAY_NAMES = Object.freeze({
    '20four7va': '20four7VA',
    indeed: 'Indeed',
    jobstreet: 'Jobstreet',
    multiplymii: 'MultiplyMii',
    'onlinejobs.ph': 'OnlineJobs.ph',
    'remote work ph': 'Remote Work PH',
    zirtual: 'Zirtual'
  });
  let applicationEmailMatchesCache = new WeakMap();
  let applicationEmailSummaryCache = null;
  let ambiguousEmailMatches = new WeakMap();
  const GENERIC_DISAMBIGUATION_ROLE_WORDS = new Set([
    'virtual', 'assistant', 'manager', 'specialist', 'marketing', 'digital', 'remote', 'wfh', 'wfo'
  ]);
  let applicationMatchIndex = [];
  let applicationMatchIndexSignature = '';
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

  function applicationMatchSignature(applications = data.applications || []) {
    return (applications || []).map(application => [
      application.id || '',
      application.updatedAt || '',
      application.email || '',
      application.contact || '',
      application.clientName || '',
      application.role || '',
      application.appliedDate || '',
      application.website || '',
      application.platform || ''
    ].join('|')).join('~');
  }

  // perf: precompute the application fields used by matching once per application snapshot instead of rescanning every row on each email.
  function buildApplicationMatchIndex(applications = data.applications || []) {
    const signature = applicationMatchSignature(applications);
    if (signature === applicationMatchIndexSignature && applicationMatchIndex.length === applications.length) return applicationMatchIndex;
    applicationMatchIndex = (applications || []).map(application => {
      const email = String(application.email || '').trim().toLowerCase();
      const contact = String(application.contact || '').trim().toLowerCase();
      const clientName = String(application.clientName || '').trim().toLowerCase();
      const role = String(application.role || '').trim().toLowerCase();
      const matchContact = normalizeMatchText(contact);
      const matchClientName = normalizeMatchText(clientName);
      const matchRole = normalizeMatchText(role);
      const roleNorm = normalizeApplicationMatchEvidence(role);
      const coreRoleNorm = roleNorm.replace(/\s+(?:wfh|wfo|remote|hybrid|on(?: site|site)?|work from (?:home|office))$/i, '');
      const contactNorm = normalizeApplicationMatchEvidence(contact);
      const roleWordCount = roleNorm.split(' ').length;
      const coreRoleWordCount = coreRoleNorm.split(' ').length;
      const platformKey = platformKeyForName(application.platform);
      return {
        application,
        email,
        emailIsPlatformSender: PLATFORM_SENDER_EMAIL_SET.has(email),
        contact,
        clientName,
        role,
        matchContact,
        matchClientName,
        matchRole,
        roleNorm,
        coreRoleNorm,
        roleIsMatchable: roleWordCount > 1 || (roleNorm.length >= 10 && !GENERIC_DISAMBIGUATION_ROLE_WORDS.has(roleNorm)),
        coreRoleIsMatchable: coreRoleWordCount > 1 || (coreRoleNorm.length >= 10 && !GENERIC_DISAMBIGUATION_ROLE_WORDS.has(coreRoleNorm)),
        roleLastWord: roleNorm.split(' ').pop(),
        coreRoleLastWord: coreRoleNorm.split(' ').pop(),
        appliedDate: application.appliedDate || '',
        appliedTime: new Date(application.appliedDate || '').getTime(),
        contactNorm,
        contactLastWord: contactNorm.split(' ').pop(),
        roleIsSpecific: isSpecificApplicationRole(matchRole),
        platformKey,
        jobLinkTokens: applicationLinkTokens(application.website),
        roleGroupKey: `${platformKey || 'unknown'}|${matchRole}`,
        roleGroupCount: 0
      };
    });
    const roleGroupCounts = new Map();
    for (const item of applicationMatchIndex) {
      if (item.roleIsSpecific) roleGroupCounts.set(item.roleGroupKey, (roleGroupCounts.get(item.roleGroupKey) || 0) + 1);
    }
    for (const item of applicationMatchIndex) item.roleGroupCount = roleGroupCounts.get(item.roleGroupKey) || 0;
    applicationMatchIndexSignature = signature;
    return applicationMatchIndex;
  }

  function invalidateApplicationMatchCaches(applications = data.applications || []) {
    const nextSignature = applicationMatchSignature(applications);
    if (nextSignature !== applicationMatchIndexSignature) {
      applicationEmailMatchesCache = new WeakMap();
      applicationEmailSummaryCache = null;
      ambiguousEmailMatches = new WeakMap();
      buildApplicationMatchIndex(applications);
    }
  }

  function platformSenderEmail(platform) {
    return PLATFORM_SENDER_EMAILS[String(platform || '').trim().toLowerCase()] || '';
  }

  function platformNameForSender(fromHeader) {
    const senderAddress = extractEmailAddress(fromHeader);
    const platform = Object.keys(PLATFORM_SENDER_EMAILS)
      .find(name => PLATFORM_SENDER_EMAILS[name] === senderAddress);
    return platform ? PLATFORM_DISPLAY_NAMES[platform] : '';
  }

  function extractEmailAddress(fromHeader) {
    const match = (fromHeader || '').match(/<([^>]+)>/);
    return (match ? match[1] : (fromHeader || '')).trim().toLowerCase();
  }

  function isEmailAddress(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '');
  }

  function extractSenderName(fromHeader) {
    return (fromHeader || '').split('<')[0].replace(/["']/g, '').trim().toLowerCase();
  }

  function isDirectClientApplication(application) {
    const platform = String(application.platform || '').trim().toLowerCase();
    return platform === 'direct client' || platform === 'direct apply';
  }

  function containsWholeWord(haystack, needle) {
    if (!needle) return false;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack || '');
  }

  function matchApplicationsForEmail(emailItem) {
    const cachedMatches = applicationEmailMatchesCache.get(emailItem);
    if (cachedMatches) return cachedMatches;
    const fromAddress = extractEmailAddress(emailItem.from);
    const senderName = extractSenderName(emailItem.from);
    const contentLower = `${emailItem.subject || ''} ${emailItem.body || ''}`.toLowerCase();
    const senderPlatformKey = platformKeyForName(platformNameForSender(fromAddress));
    const matches = [];
    if (senderPlatformKey) {
      const subjectText = normalizeMatchText(emailItem.subject);
      const bodySource = String(emailItem.body || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\bsent\s+via\s+[\w.-]+\s+contact\s+form\b/gi, ' ');
      const bodyText = normalizeMatchText(bodySource);
      const bodyLinkTokens = applicationLinkTokens(emailItem.body);
      const scoredMatches = [];
      const applicationIndex = buildApplicationMatchIndex(data.applications);
      for (const item of applicationIndex) {
        const score = platformApplicationMatchScore(item, senderPlatformKey, subjectText, bodyText, bodyLinkTokens);
        if (score !== null) scoredMatches.push({ item, score });
      }
      let topCandidates = [];
      if (scoredMatches.length) {
        const highestScore = Math.max(...scoredMatches.map(match => match.score));
        topCandidates = scoredMatches.filter(match => match.score === highestScore).map(match => match.item);
      }
      if (topCandidates.length > 1) {
        const roleSubjectText = normalizeApplicationMatchEvidence(emailItem.subject);
        const roleBodyText = normalizeApplicationMatchEvidence(bodySource);
        matches.push(...disambiguateApplicationMatches(
          topCandidates, emailItem, roleSubjectText, roleBodyText, bodyLinkTokens
        ));
      } else if (topCandidates.length === 1) {
        const roleSubjectText = normalizeApplicationMatchEvidence(emailItem.subject);
        const roleBodyText = normalizeApplicationMatchEvidence(bodySource);
        if (!emailExplicitlyNamesDifferentRole(topCandidates[0], roleSubjectText, roleBodyText)) {
          matches.push(topCandidates[0].application);
        }
      }
      applicationEmailMatchesCache.set(emailItem, matches);
      return matches;
    }
    const applicationIndex = buildApplicationMatchIndex(data.applications);
    const candidateItems = [];
    for (const item of applicationIndex) {
      const { application, email, contact, clientName, role } = item;
      const roleReferenced = role.length >= 3 && contentLower.includes(role);
      const companyReferenced = clientName.length >= 3 && containsWholeWord(contentLower, clientName);
      if (email && !item.emailIsPlatformSender && email === fromAddress) {
        matches.push(application);
        candidateItems.push(item);
        continue;
      }
      if (!roleReferenced && !companyReferenced) continue;
      if ([contact, clientName].filter(name => name.length >= 3).some(name => containsWholeWord(senderName, name))) {
        matches.push(application);
        candidateItems.push(item);
      }
    }
    if (candidateItems.length > 1) {
      const subjectText = normalizeApplicationMatchEvidence(emailItem.subject);
      const bodyText = normalizeApplicationMatchEvidence(emailItem.body);
      matches.splice(0, matches.length, ...disambiguateApplicationMatches(
        candidateItems, emailItem, subjectText, bodyText, applicationLinkTokens(emailItem.body)
      ));
    } else if (candidateItems.length === 1) {
      const subjectText = normalizeApplicationMatchEvidence(emailItem.subject);
      const bodyText = normalizeApplicationMatchEvidence(emailItem.body);
      if (emailExplicitlyNamesDifferentRole(candidateItems[0], subjectText, bodyText)) {
        matches.length = 0;
      }
    }
    applicationEmailMatchesCache.set(emailItem, matches);
    return matches;
  }

  function applicationsRelatedToEmail(emailItem) {
    if (emailItem.direction !== 'sent' && emailItem.source !== 'sent') return matchApplicationsForEmail(emailItem);
    const linkedApplication = data.applications.find(application => application.id === emailItem.applicationId);
    if (linkedApplication) return [linkedApplication];
    const recipient = extractEmailAddress(emailItem.to);
    return isEmailAddress(recipient)
      ? data.applications.filter(application => (application.email || '').trim().toLowerCase() === recipient)
      : [];
  }

  function buildApplicationEmailSummary() {
    const summary = new Map((data.applications || []).map(application => [application.id, []]));
    const seenIds = new Map((data.applications || []).map(application => [application.id, new Set()]));
    const seenGmailIds = new Map((data.applications || []).map(application => [application.id, new Set()]));
    for (const emailItem of data.emails || []) {
      for (const application of matchApplicationsForEmail(emailItem)) {
        const ids = seenIds.get(application.id);
        const gmailIds = seenGmailIds.get(application.id);
        if (!ids || !gmailIds) continue;
        const id = String(emailItem.id || '');
        const gmailId = String(emailItem.gmailId || '');
        const alreadySeen = (id && ids.has(id)) || (gmailId && gmailIds.has(gmailId));
        if (id) ids.add(id);
        if (gmailId) gmailIds.add(gmailId);
        if (!alreadySeen) summary.get(application.id)?.push(emailItem);
      }
    }
    return summary;
  }

  function matchingEmailsForApplication(application) {
    if (!applicationEmailSummaryCache) applicationEmailSummaryCache = buildApplicationEmailSummary();
    return applicationEmailSummaryCache.get(application.id) || [];
  }

  function openApplicationEmailsModal(applicationId) {
    const application = data.applications.find(item => item.id === applicationId);
    if (!application) return;
    const emails = matchingEmailsForApplication(application)
      .filter(emailItem => emailItem.direction !== 'sent' && emailItem.source !== 'sent')
      .sort((first, second) => new Date(second.date) - new Date(first.date));
    if (!emails.length) return;
    $('#applicationEmailsTitle').textContent = `${application.clientName} · Emails`;
    $('#applicationEmailsSummary').textContent = plural(emails.length, 'matching email');
    $('#applicationEmailsList').innerHTML = emails.map(emailItem => `
      <article class="application-email-message">
        <header class="application-email-message-heading">
          <div><h3>${escapeHtml(emailItem.subject || '(No subject)')}</h3><p>${escapeHtml(emailItem.from || 'Unknown sender')}</p>${(() => {
            const otherRoles = (ambiguousEmailMatches.get(emailItem) || [])
              .filter(other => other !== application)
              .map(other => other.role)
              .filter(Boolean);
            return otherRoles.length
              ? `<small class="field-help">Could also belong to: ${escapeHtml([...new Set(otherRoles)].join(', '))}</small>`
              : '';
          })()}</div>
          <time>${escapeHtml(emailDate(emailItem.date))}</time>
        </header>
        <div class="application-email-message-body">${escapeHtml(emailContentText(emailItem.body) || 'No message body available.')}</div>
      </article>`).join('');
    $('#applicationEmailsModal').showModal();
  }

  function interviewDateFromEmail(emailItem) {
    const source = `${emailItem.subject || ''} ${emailItem.body || ''}`;
    const match = source.match(/\b(\d{4}-\d{1,2}-\d{1,2}|[A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?|\d{1,2}\/\d{1,2}\/\d{2,4})\b/);
    if (!match) return '';
    const parsed = new Date(match[1]);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
  }

  function isInterviewEmail(emailItem) {
    const source = `${emailItem.subject || ''} ${emailItem.body || ''}`;
    return /\b(interview|meeting|video call|phone call|screening)\b/i.test(source);
  }

  function matchBadge(app) {
    const matches = matchingEmailsForApplication(app)
      .filter(emailItem => emailItem.direction !== 'sent' && emailItem.source !== 'sent');
    if (!matches.length) return '';
    return ` <button class="match-badge" type="button" data-application-emails="${escapeHtml(app.id)}" aria-label="View ${plural(matches.length, 'matching email')} for ${escapeHtml(app.clientName)}" title="View matching application emails">${matches.length}</button>`;
  }

  function renderDashboard() {
    const applications = data.applications;
    const pipelineCount = pipelineApplications().length;
    const appliedToday = pipelineApplications().filter(item => dateKey(item.appliedDate) === today()).length;
    const followUp = applications.filter(item => item.followUpDate && item.followUpDate <= today() && item.status !== 'Active client' && item.status !== 'Not selected').length;
    const interviewsToday = applications.filter(item => item.status === 'Interview' && dateKey(item.interviewDate) === today()).length;
    const toApplyToday = (data.toApply || []).filter(item => item.dueDate && item.dueDate <= today()).length;
    $('#totalApplications').textContent = pipelineCount;
    $('#conversationClients').textContent = appliedToday;
    $('#followUpClients').textContent = followUp;
    $('#applicationsDetail').textContent = pipelineCount ? `${plural(pipelineCount, 'application')} in your tracker` : 'No applications tracked yet';
    $('#conversationDetail').textContent = appliedToday ? `${plural(appliedToday, 'application')} submitted today` : 'Applications submitted today';
    $('#followUpDetail').textContent = followUp ? `${plural(followUp, 'application')} due for a follow-up` : 'Applications to revisit soon';
    $('#todayFollowUps').textContent = followUp;
    $('#todayInterviews').textContent = interviewsToday;
    $('#todayToApply').textContent = toApplyToday;
    const weeklyApplicationCount = weeklyReportData().applications.length;
    const weeklyGoal = normalizeWeeklyActivityGoal(data.weeklyActivityGoal) || 0;
    $('#dashboardWeeklyActivity').textContent = weeklyGoal
      ? `${weeklyApplicationCount} of ${weeklyGoal} ${weeklyGoal === 1 ? 'application' : 'applications'}`
      : plural(weeklyApplicationCount, 'application');
    $('#dashboardWeeklyGoalLabel').textContent = weeklyGoal ? 'Weekly application goal' : 'Weekly goal not set';
    const weeklyProgress = $('#dashboardWeeklyProgress');
    weeklyProgress.hidden = !weeklyGoal;
    weeklyProgress.max = weeklyGoal || 1;
    weeklyProgress.value = Math.min(weeklyApplicationCount, weeklyGoal || 1);
    weeklyProgress.setAttribute('aria-valuemin', '0');
    weeklyProgress.setAttribute('aria-valuemax', String(weeklyGoal || 1));
    weeklyProgress.setAttribute('aria-valuenow', String(Math.min(weeklyApplicationCount, weeklyGoal || 1)));
    $('#openWeeklyGoalDialog').textContent = weeklyGoal ? 'Edit goal' : 'Set goal';
    renderPlatformBreakdown(applications);
    renderStatusChart(applications);
    renderInterviewCalendar();
    renderRecentApplications();
  }

  let clientDashboardSort = 'name';
  let clientDashboardSortDirection = 'asc';
  let clientDashboardSelectedId = '';
  let clientDashboardAction = '';
  let clientDashboardDrawerReturnFocus = null;

  function clientDashboardDaysLeft(item) {
    if (!item.contractEndDate || isContractEnded(item)) return null;
    const end = new Date(`${dateKey(item.contractEndDate)}T12:00:00`);
    const current = new Date(`${today()}T12:00:00`);
    return Number.isNaN(end.getTime()) ? null : Math.round((end - current) / 86400000);
  }

  function clientDashboardStatus(item) {
    if (isContractEnded(item)) return { key: 'ended', label: 'Ended' };
    if (String(item.contractStatus || '').toLowerCase() === 'not active'
      || String(item.contractStatus || '').toLowerCase() === 'paused') return { key: 'paused', label: 'Paused' };
    const daysLeft = clientDashboardDaysLeft(item);
    if (isActiveContract(item) && daysLeft !== null && daysLeft <= 30) return { key: 'ending', label: 'Ending soon' };
    return { key: 'active', label: 'Active' };
  }

  function clientDashboardLastContact(item) {
    const emailAddress = String(item.email || '').trim().toLowerCase();
    const matching = (data.emails || []).filter(email => email.applicationId === item.id
      || (emailAddress && [email.to, email.from].some(address => String(address || '').trim().toLowerCase() === emailAddress)));
    return matching.reduce((latest, email) => {
      const date = email.date || '';
      return dateKey(date) && (!latest || new Date(date) > new Date(latest)) ? date : latest;
    }, '');
  }

  function clientDashboardRate(item) {
    const amount = Number(item.salaryAmount);
    if (!(amount > 0) || !['monthly', 'hourly'].includes(item.salaryType)) return '';
    const symbol = item.salaryCurrency === 'PHP' ? '₱' : '$';
    return `${symbol}${amount.toLocaleString()} / ${item.salaryType === 'monthly' ? 'month' : 'hour'}`;
  }

  function clientDashboardMonthlyAmount(item) {
    const amount = Number(item.salaryAmount);
    if (!(amount > 0)) return 0;
    if (item.salaryType === 'monthly') return amount;
    if (item.salaryType === 'hourly' && Number(item.hoursPerWeek) > 0) return amount * Number(item.hoursPerWeek) * 4;
    return 0;
  }

  function clientDashboardMoneyByCurrency(clients) {
    const totals = new Map();
    clients.filter(isActiveContract).forEach(item => {
      const amount = clientDashboardMonthlyAmount(item);
      if (!amount) return;
      const currency = item.salaryCurrency === 'PHP' ? 'PHP' : 'USD';
      totals.set(currency, (totals.get(currency) || 0) + amount);
    });
    return [...totals].map(([currency, amount]) => `${currency === 'PHP' ? '₱' : '$'}${Math.round(amount).toLocaleString()}`).join(' · ');
  }

  function clientDashboardMatchesStatus(item, filter) {
    return filter === 'all' || clientDashboardStatus(item).key === filter;
  }

  function clientDashboardTableValue(item, key) {
    const daysLeft = clientDashboardDaysLeft(item);
    switch (key) {
      case 'name': return String(item.clientName || '').toLowerCase();
      case 'status': return clientDashboardStatus(item).label;
      case 'start': return dateKey(item.activeAt || item.appliedDate) || '';
      case 'end': return dateKey(item.contractEndDate) || '';
      case 'days': return daysLeft ?? Number.POSITIVE_INFINITY;
      case 'rate': return Number(item.salaryAmount) || 0;
      case 'contact': return clientDashboardLastContact(item) || '';
      default: return '';
    }
  }

  function renderClientDashboardTable(clients) {
    const query = $('#clientDashboardSearch').value.trim().toLowerCase();
    const filter = $('#clientDashboardStatusFilter').value;
    const filtered = clients.filter(item => {
      const haystack = [item.clientName, item.contact, item.email, item.role, item.companyName, item.company].join(' ').toLowerCase();
      return (!query || haystack.includes(query)) && clientDashboardMatchesStatus(item, filter);
    });
    const multiplier = clientDashboardSortDirection === 'asc' ? 1 : -1;
    filtered.sort((first, second) => {
      const a = clientDashboardTableValue(first, clientDashboardSort);
      const b = clientDashboardTableValue(second, clientDashboardSort);
      return (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))) * multiplier;
    });
    $('#clientDashboardListCount').textContent = plural(filtered.length, 'client');
    $$('#clientDashboardPanel [data-client-sort]').forEach(button => {
      button.closest('th')?.setAttribute('aria-sort', button.dataset.clientSort === clientDashboardSort
        ? (clientDashboardSortDirection === 'asc' ? 'ascending' : 'descending')
        : 'none');
    });
    const tbody = $('#clientDashboardTableBody');
    const empty = $('#clientDashboardEmpty');
    empty.hidden = filtered.length > 0;
    if (!filtered.length) {
      const hasClients = clients.length > 0;
      $('#clientDashboardEmptyTitle').textContent = hasClients ? 'No matching clients' : 'No clients yet';
      $('#clientDashboardEmptyMessage').textContent = hasClients
        ? 'Try changing your search or status filter.'
        : 'Clients you add from Applications will appear here for tracking.';
      tbody.innerHTML = '';
      return;
    }
    tbody.innerHTML = filtered.map(item => {
      const status = clientDashboardStatus(item);
      const daysLeft = clientDashboardDaysLeft(item);
      const lastContact = clientDashboardLastContact(item);
      const startDate = item.activeAt || item.appliedDate;
      const initials = clientInitials(item.clientName);
      const rate = clientDashboardRate(item);
      return `<tr data-client-row="${escapeHtml(item.id)}" tabindex="0" aria-label="Open details for ${escapeHtml(item.clientName || 'client')}">
        <td data-label="Client name"><button class="client-dashboard-name" type="button" data-client-dashboard-open="${escapeHtml(item.id)}"><span class="client-dashboard-avatar" aria-hidden="true">${escapeHtml(initials)}</span><span>${escapeHtml(item.clientName || 'Untitled client')}<small>${escapeHtml(item.role || item.companyName || item.company || 'Client')}</small></span></button></td>
        <td data-label="Status"><span class="client-dashboard-status is-${status.key}">${status.label}</span></td>
        <td data-label="Contract start">${startDate ? escapeHtml(formatDate(startDate)) : '—'}</td>
        <td data-label="Contract end">${item.contractEndDate ? escapeHtml(formatDate(item.contractEndDate)) : '—'}</td>
        <td data-label="Days left">${daysLeft === null ? '—' : daysLeft < 0 ? 'Ended' : plural(daysLeft, 'day')}</td>
        <td data-label="Rate">${escapeHtml(rate || '—')}</td>
        <td data-label="Last contact">${lastContact ? escapeHtml(formatDate(lastContact)) : '—'}</td>
        <td data-label="Actions"><button class="client-dashboard-row-action" type="button" data-client-dashboard-open="${escapeHtml(item.id)}" aria-label="Open ${escapeHtml(item.clientName || 'client')} details"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i><span>View</span></button></td>
      </tr>`;
    }).join('');
  }

  function clientDashboardRecentActivity(clients) {
    const activity = [];
    const recentThreshold = new Date();
    recentThreshold.setMonth(recentThreshold.getMonth() - 6);
    const thresholdKey = localDateKey(recentThreshold);
    clients.forEach(item => {
      const addedAt = item.createdAt || item.activeAt;
      if (addedAt) activity.push({ date: addedAt, title: 'Client added', detail: item.clientName || 'Client', icon: 'fa-user-plus', tone: 'blue' });
      if (item.contractStatus === 'Contract Ended' || (item.contractEndDate && dateKey(item.contractEndDate) < today())) {
        activity.push({ date: item.contractEndDate || item.updatedAt || item.activeAt, title: 'Contract ended', detail: item.clientName || 'Client', icon: 'fa-circle-check', tone: 'gray' });
      }
      (item.dashboardActivity || []).forEach(entry => activity.push(entry));
    });
    (data.clientTasks || []).filter(task => task.status === 'done' && task.completedAt).forEach(task => {
      const client = clients.find(item => item.id === task.clientId);
      if (client) activity.push({ date: task.completedAt, title: 'Task completed', detail: `${client.clientName || 'Client'} · ${task.title || 'Task'}`, icon: 'fa-check', tone: 'green' });
    });
    (data.dailyTasks || []).filter(task => task.completedAt && task.relatedType === 'client').forEach(task => {
      const client = clients.find(item => item.id === task.relatedId);
      if (client) activity.push({ date: task.completedAt, title: 'Task completed', detail: `${client.clientName || 'Client'} · ${task.title || 'Task'}`, icon: 'fa-check', tone: 'green' });
    });
    return activity.filter(item => dateKey(item.date) >= thresholdKey)
      .sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8);
  }

  function renderClientDashboardActivity(clients) {
    const activity = clientDashboardRecentActivity(clients);
    $('#clientDashboardActivityList').innerHTML = activity.length
      ? activity.map(item => `<article class="client-dashboard-activity-item"><span class="client-dashboard-activity-icon is-${escapeHtml(item.tone || 'blue')}"><i class="fa-solid ${escapeHtml(item.icon || 'fa-bolt')}" aria-hidden="true"></i></span><span><strong>${escapeHtml(item.title || 'Client update')}</strong><small>${escapeHtml(item.detail || '')}</small></span><time>${escapeHtml(formatDate(item.date))}</time></article>`).join('')
      : '<p class="client-dashboard-inline-empty">Client updates and completed tasks will appear here.</p>';
  }

  function clientDashboardMonthKeys() {
    return Array.from({ length: 6 }, (_, index) => {
      const date = new Date();
      date.setDate(1);
      date.setMonth(date.getMonth() - (5 - index));
      return { key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, label: new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date) };
    });
  }

  function renderClientDashboardHours() {
    const months = clientDashboardMonthKeys();
    const totals = new Map(months.map(month => [month.key, 0]));
    (data.clientTasks || []).forEach(task => {
      (task.timeEntries || []).forEach(entry => {
        const date = dateKey(entry.start);
        if (!date) return;
        const key = date.slice(0, 7);
        if (!totals.has(key)) return;
        const start = new Date(entry.start || '').getTime();
        const end = new Date(entry.end || '').getTime();
        const duration = Number(entry.durationMs) || (Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0);
        totals.set(key, totals.get(key) + duration / 3600000);
      });
    });
    (data.applications || []).forEach(item => {
      (item.dashboardLoggedHours || []).forEach(entry => {
        const key = dateKey(entry.date).slice(0, 7);
        if (totals.has(key)) totals.set(key, totals.get(key) + (Number(entry.hours) || 0));
      });
    });
    const values = months.map(month => totals.get(month.key) || 0);
    const chart = $('#clientDashboardHoursChart');
    if (!values.some(value => value > 0)) {
      chart.innerHTML = '<text x="300" y="106" text-anchor="middle" class="client-dashboard-chart-empty">Logged client hours will appear here.</text>';
      return;
    }
    const max = Math.max(...values, 1);
    const points = values.map((value, index) => `${48 + index * 100},${160 - value / max * 112}`).join(' ');
    chart.innerHTML = `<line x1="34" y1="160" x2="566" y2="160" class="client-dashboard-chart-axis"></line><polyline points="${points}" class="client-dashboard-chart-line"></polyline>${values.map((value, index) => {
      const x = 48 + index * 100;
      const y = 160 - value / max * 112;
      return `<circle cx="${x}" cy="${y}" r="4" class="client-dashboard-chart-point"><title>${value.toFixed(1)} hours</title></circle><text x="${x}" y="190" text-anchor="middle" class="client-dashboard-chart-label">${months[index].label}</text><text x="${x}" y="${Math.max(y - 10, 20)}" text-anchor="middle" class="client-dashboard-chart-value">${value.toFixed(value % 1 ? 1 : 0)}</text>`;
    }).join('')}`;
  }

  function renderClientDashboardAttention(clients) {
    const entries = [];
    clients.forEach(item => {
      const daysLeft = clientDashboardDaysLeft(item);
      if (isActiveContract(item) && daysLeft !== null && daysLeft >= 0 && daysLeft <= 30) {
        entries.push({ id: item.id, type: 'renew', title: 'Contract ending soon', detail: `${item.clientName || 'Client'} · ${plural(daysLeft, 'day')} left`, action: 'Renew', tone: 'amber' });
      }
      const lastContact = clientDashboardLastContact(item);
      const followUpBasis = lastContact || item.activeAt || item.createdAt;
      if (isActiveContract(item) && followUpBasis && Math.floor((new Date(`${today()}T12:00:00`) - new Date(dateKey(followUpBasis) + 'T12:00:00')) / 86400000) >= 14) {
        entries.push({ id: item.id, type: 'message', title: 'Follow-up due', detail: `${item.clientName || 'Client'} · ${lastContact ? `Last contacted ${formatDate(lastContact)}` : 'No contact recorded'}`, action: 'Message', tone: 'blue' });
      }
    });
    (data.clientTasks || []).filter(task => task.status !== 'done' && task.dueDate && dateKey(task.dueDate) < today()).forEach(task => {
      const item = clients.find(client => client.id === task.clientId);
      if (item) entries.push({ id: task.id, clientId: item.id, type: 'client-task', title: 'Overdue client task', detail: `${item.clientName || 'Client'} · ${task.title || 'Task'}`, action: 'Mark done', tone: 'red' });
    });
    (data.dailyTasks || []).filter(task => !task.completedAt && task.taskDate < today() && task.relatedType === 'client').forEach(task => {
      const item = clients.find(client => client.id === task.relatedId);
      if (item) entries.push({ id: task.id, clientId: item.id, type: 'daily-task', title: 'Overdue task', detail: `${item.clientName || 'Client'} · ${task.title || 'Task'}`, action: 'Mark done', tone: 'red' });
    });
    $('#clientDashboardAttentionCount').textContent = entries.length ? plural(entries.length, 'item') : 'All caught up';
    $('#clientDashboardAttentionList').innerHTML = entries.length
      ? entries.slice(0, 8).map(entry => `<article class="client-dashboard-attention-item"><span class="client-dashboard-attention-dot is-${entry.tone}" aria-hidden="true"></span><span class="client-dashboard-attention-copy"><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(entry.detail)}</small></span><button class="button button-secondary" type="button" data-client-dashboard-attention="${entry.type}" data-client-id="${escapeHtml(entry.clientId || entry.id)}" data-item-id="${escapeHtml(entry.id)}">${entry.action}</button></article>`).join('')
      : '<p class="client-dashboard-inline-empty">No contracts, follow-ups, or tasks need attention.</p>';
  }

  function renderClientDashboardDrawer(client) {
    const content = $('#clientDashboardDrawerContent');
    if (!client || !content) return;
    const status = clientDashboardStatus(client);
    const tasks = [
      ...(data.clientTasks || []).filter(task => task.clientId === client.id),
      ...(data.dailyTasks || []).filter(task => task.relatedType === 'client' && task.relatedId === client.id)
    ].sort((a, b) => new Date(a.dueDate || a.taskDate || 0) - new Date(b.dueDate || b.taskDate || 0)).slice(0, 5);
    const startDate = client.activeAt || client.appliedDate;
    const salary = clientDashboardRate(client);
    content.innerHTML = `
      <div class="client-dashboard-drawer-profile"><span class="client-dashboard-avatar is-large" aria-hidden="true">${escapeHtml(clientInitials(client.clientName))}</span><div><h3>${escapeHtml(client.clientName || 'Untitled client')}</h3><span class="client-dashboard-status is-${status.key}">${status.label}</span></div></div>
      <section class="client-dashboard-drawer-section"><h3>Contract information</h3><dl><div><dt>Position</dt><dd>${escapeHtml(client.role || 'Not set')}</dd></div><div><dt>Start date</dt><dd>${startDate ? escapeHtml(formatDate(startDate)) : 'Not set'}</dd></div><div><dt>End date</dt><dd>${client.contractEndDate ? escapeHtml(formatDate(client.contractEndDate)) : 'Not set'}</dd></div><div><dt>Rate</dt><dd>${escapeHtml(salary || 'Not set')}</dd></div><div><dt>Contact</dt><dd>${escapeHtml(client.contact || 'Not set')}</dd></div>${client.email ? `<div><dt>Email</dt><dd><a href="mailto:${escapeHtml(client.email)}">${escapeHtml(client.email)}</a></dd></div>` : ''}${client.phone ? `<div><dt>Phone</dt><dd><a href="tel:${escapeHtml(client.phone)}">${escapeHtml(client.phone)}</a></dd></div>` : ''}${client.companyName || client.company ? `<div><dt>Company</dt><dd>${escapeHtml(client.companyName || client.company)}</dd></div>` : ''}</dl></section>
      <section class="client-dashboard-drawer-section"><h3>Notes</h3><p class="client-dashboard-drawer-notes">${escapeHtml(client.notes || 'No notes yet.')}</p></section>
      <section class="client-dashboard-drawer-section"><h3>Linked tasks <span>${tasks.length}</span></h3>${tasks.length ? `<ul class="client-dashboard-drawer-tasks">${tasks.map(task => `<li><span>${escapeHtml(task.title || 'Untitled task')}</span><small>${escapeHtml(task.status === 'done' || task.completedAt ? 'Done' : (task.dueDate || task.taskDate) ? formatDate(task.dueDate || task.taskDate) : 'No due date')}</small></li>`).join('')}</ul>` : '<p class="client-dashboard-inline-empty">No tasks linked to this client yet.</p>'}</section>
      <div class="client-dashboard-drawer-actions"><button class="button button-secondary" type="button" data-client-dashboard-drawer-action="message"><i class="fa-regular fa-envelope" aria-hidden="true"></i> Message</button><button class="button button-primary" type="button" data-client-dashboard-edit="${escapeHtml(client.id)}"><i class="fa-solid fa-pen" aria-hidden="true"></i> Edit details</button></div>`;
  }

  function renderClientDashboard() {
    const clients = hiredClients();
    const loading = !dataReady;
    $('#clientDashboardLoading').hidden = !loading;
    $('#clientDashboardContent').hidden = loading;
    if (loading) {
      $('#clientDashboardCount').textContent = '—';
      $('#clientDashboardDetail').textContent = 'Loading clients…';
      return;
    }
    const activeClients = clients.filter(isActiveContract).length;
    const endingSoon = clients.filter(item => isActiveContract(item) && clientDashboardDaysLeft(item) !== null && clientDashboardDaysLeft(item) >= 0 && clientDashboardDaysLeft(item) <= 30).length;
    const endedContracts = clients.filter(isContractEnded).length;
    const income = clientDashboardMoneyByCurrency(clients);
    $('#clientDashboardCount').textContent = Number.isFinite(activeClients) ? String(activeClients) : '—';
    $('#clientDashboardDetail').textContent = activeClients ? plural(activeClients, 'client') : 'No active contracts';
    $('#clientDashboardEndingCount').textContent = String(endingSoon);
    $('#clientDashboardEndedCount').textContent = String(endedContracts);
    $('#clientDashboardEndedDetail').textContent = endedContracts ? plural(endedContracts, 'contract') : 'No ended contracts';
    $('#clientDashboardIncomeCard').hidden = !income;
    $('#clientDashboardIncome').textContent = income || '—';
    $('#clientDashboardPanel .client-dashboard-stat-grid').classList.toggle('has-income', Boolean(income));
    $('#clientDashboardActionClient').innerHTML = clients.length
      ? clients.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.clientName || 'Untitled client')}</option>`).join('')
      : '<option value="">Add a client to get started</option>';
    $$('#clientDashboardQuickActions [data-client-dashboard-action]').forEach(button => { button.disabled = !clients.length; });
    renderClientDashboardTable(clients);
    renderClientDashboardAttention(clients);
    renderClientDashboardActivity(clients);
    renderClientDashboardHours();
    if (clientDashboardSelectedId) {
      const selected = clients.find(item => item.id === clientDashboardSelectedId);
      if (selected && !$('#clientDashboardDrawer').hidden) renderClientDashboardDrawer(selected);
      else closeClientDashboardDrawer();
    }
  }

  function closeClientDashboardDrawer() {
    const drawer = $('#clientDashboardDrawer');
    if (!drawer || drawer.hidden) return;
    drawer.hidden = true;
    drawer.setAttribute('aria-hidden', 'true');
    $('#clientDashboardBackdrop').hidden = true;
    document.body.classList.remove('client-dashboard-drawer-open');
    clientDashboardSelectedId = '';
    clientDashboardDrawerReturnFocus?.focus();
    clientDashboardDrawerReturnFocus = null;
  }

  function openClientDashboardDrawer(clientId, trigger) {
    const client = hiredClients().find(item => item.id === clientId);
    if (!client) return;
    clientDashboardSelectedId = client.id;
    clientDashboardDrawerReturnFocus = trigger;
    $('#clientDashboardDrawerTitle').textContent = client.clientName || 'Client';
    renderClientDashboardDrawer(client);
    const drawer = $('#clientDashboardDrawer');
    drawer.hidden = false;
    drawer.setAttribute('aria-hidden', 'false');
    $('#clientDashboardBackdrop').hidden = false;
    document.body.classList.add('client-dashboard-drawer-open');
    requestAnimationFrame(() => drawer.querySelector('button, a, input, select, textarea')?.focus());
  }

  function renderClientDashboardEditForm(client) {
    const status = client.contractStatus === 'Contract Ended' ? 'Contract Ended' : client.contractStatus === 'Not active' ? 'Not active' : 'Active';
    $('#clientDashboardDrawerContent').innerHTML = `<form class="client-dashboard-edit-form" data-client-dashboard-save="${escapeHtml(client.id)}">
      <label class="form-field">Client name<input name="clientName" required maxlength="180" value="${escapeHtml(client.clientName || '')}" /></label>
      <label class="form-field">Position<input name="role" maxlength="180" value="${escapeHtml(client.role || '')}" /></label>
      <label class="form-field">Contact name<input name="contact" maxlength="180" value="${escapeHtml(client.contact || '')}" /></label>
      <label class="form-field">Contract status<select name="contractStatus"><option${status === 'Active' ? ' selected' : ''}>Active</option><option${status === 'Not active' ? ' selected' : ''}>Not active</option><option${status === 'Contract Ended' ? ' selected' : ''}>Contract Ended</option></select></label>
      <label class="form-field">Contract start<input name="activeAt" type="date" value="${escapeHtml(dateKey(client.activeAt || client.appliedDate))}" /></label>
      <label class="form-field">Contract end<input name="contractEndDate" type="date" value="${escapeHtml(dateKey(client.contractEndDate))}" /></label>
      <label class="form-field">Rate amount<input name="salaryAmount" type="number" min="0" step="0.01" value="${escapeHtml(client.salaryAmount ?? '')}" /></label>
      <label class="form-field">Rate type<select name="salaryType"><option value="">Not set</option><option value="hourly"${client.salaryType === 'hourly' ? ' selected' : ''}>Hourly</option><option value="monthly"${client.salaryType === 'monthly' ? ' selected' : ''}>Monthly</option></select></label>
      <label class="form-field">Currency<select name="salaryCurrency"><option value="USD"${client.salaryCurrency !== 'PHP' ? ' selected' : ''}>USD ($)</option><option value="PHP"${client.salaryCurrency === 'PHP' ? ' selected' : ''}>PHP (₱)</option></select></label>
      <label class="form-field">Hours per week<input name="hoursPerWeek" type="number" min="0" step="0.5" value="${escapeHtml(client.hoursPerWeek ?? '')}" /></label>
      <label class="form-field">Contact email<input name="email" type="email" value="${escapeHtml(client.email || '')}" /></label>
      <label class="form-field">Phone<input name="phone" type="tel" maxlength="80" value="${escapeHtml(client.phone || '')}" /></label>
      <label class="form-field client-dashboard-edit-notes">Notes<textarea name="notes" rows="5" maxlength="4000">${escapeHtml(client.notes || '')}</textarea></label>
      <div class="client-dashboard-drawer-actions"><button class="button button-secondary" type="button" data-client-dashboard-cancel-edit>Cancel</button><button class="button button-primary" type="submit">Save changes</button></div>
    </form>`;
    $('#clientDashboardDrawerContent').querySelector('input')?.focus();
  }

  function openClientDashboardAction(action) {
    const client = hiredClients().find(item => item.id === $('#clientDashboardActionClient').value);
    if (!client) return;
    if (action === 'message') {
      openPlainClientEmailComposer(client);
      return;
    }
    clientDashboardAction = action;
    const title = action === 'hours' ? 'Log client hours' : action === 'task' ? 'Add a client task' : 'Add a client note';
    $('#clientDashboardActionTitle').textContent = `${title} · ${client.clientName || 'Client'}`;
    $('#clientDashboardActionFields').innerHTML = action === 'hours'
      ? '<label class="form-field">Hours worked<input name="hours" type="number" min="0.25" step="0.25" required autofocus /></label><label class="form-field">Date<input name="date" type="date" required /></label>'
      : action === 'task'
        ? '<label class="form-field">Task title<input name="title" maxlength="180" required autofocus /></label><label class="form-field">Due date<input name="date" type="date" /></label>'
        : '<label class="form-field">Note<textarea name="note" rows="5" maxlength="2000" required autofocus placeholder="Add a note for this client"></textarea></label>';
    const dateInput = $('#clientDashboardActionFields [name="date"]');
    if (dateInput) dateInput.value = today();
    $('#clientDashboardActionDialog').showModal();
    requestAnimationFrame(() => $('#clientDashboardActionFields').querySelector('input, textarea')?.focus());
  }

  async function saveClientDashboardAction(event) {
    event.preventDefault();
    const client = hiredClients().find(item => item.id === $('#clientDashboardActionClient').value);
    if (!client) return;
    const formData = new FormData(event.currentTarget);
    const now = new Date().toISOString();
    if (clientDashboardAction === 'hours') {
      client.dashboardLoggedHours = Array.isArray(client.dashboardLoggedHours) ? client.dashboardLoggedHours : [];
      client.dashboardLoggedHours.push({ id: uid(), hours: Number(formData.get('hours')), date: String(formData.get('date') || today()), createdAt: now });
      client.dashboardActivity = [...(client.dashboardActivity || []), { date: now, title: 'Hours logged', detail: `${client.clientName || 'Client'} · ${Number(formData.get('hours'))} hours`, icon: 'fa-clock', tone: 'blue' }].slice(-100);
    } else if (clientDashboardAction === 'task') {
      data.dailyTasks = Array.isArray(data.dailyTasks) ? data.dailyTasks : [];
      data.dailyTasks.push({
        id: uid(),
        title: String(formData.get('title') || '').trim(),
        type: 'task',
        taskDate: String(formData.get('date') || today()),
        relatedType: 'client',
        relatedId: client.id,
        relatedName: client.clientName || '',
        destination: '',
        notes: '',
        checklist: [],
        createdAt: now,
        completedAt: ''
      });
      client.dashboardActivity = [...(client.dashboardActivity || []), { date: now, title: 'Task added', detail: `${client.clientName || 'Client'} · ${String(formData.get('title') || '').trim()}`, icon: 'fa-list-check', tone: 'blue' }].slice(-100);
    } else {
      const note = String(formData.get('note') || '').trim();
      client.notes = [client.notes, note].filter(Boolean).join('\n\n');
      client.dashboardActivity = [...(client.dashboardActivity || []), { date: now, title: 'Note added', detail: client.clientName || 'Client', icon: 'fa-note-sticky', tone: 'gray' }].slice(-100);
    }
    const action = clientDashboardAction;
    try {
      if (!(await persist())) throw new Error('Cloud save failed.');
    } catch (error) {
      console.error('Could not save client dashboard action:', error);
      showActionResult({ title: 'Could not save client update', message: error.message || 'Check your connection and try again.', status: 'error' });
      return;
    }
    $('#clientDashboardActionDialog').close();
    renderAll();
    if (action === 'task') showView('daily-task');
    else if (clientDashboardSelectedId) openClientDashboardDrawer(client.id, clientDashboardDrawerReturnFocus);
    toast(action === 'hours' ? 'Client hours saved.' : action === 'task' ? 'Task added to Daily Tasks.' : 'Client note saved.');
  }

  $('#clientDashboardSearch').addEventListener('input', () => renderClientDashboardTable(hiredClients()));
  $('#clientDashboardStatusFilter').addEventListener('change', () => renderClientDashboardTable(hiredClients()));
  $('#clientDashboardActionForm').addEventListener('submit', saveClientDashboardAction);
  $('#clientDashboardClients').addEventListener('click', event => {
    const sortButton = event.target.closest('[data-client-sort]');
    if (sortButton) {
      if (clientDashboardSort === sortButton.dataset.clientSort) clientDashboardSortDirection = clientDashboardSortDirection === 'asc' ? 'desc' : 'asc';
      else {
        clientDashboardSort = sortButton.dataset.clientSort;
        clientDashboardSortDirection = 'asc';
      }
      renderClientDashboardTable(hiredClients());
      return;
    }
    const openButton = event.target.closest('[data-client-dashboard-open]');
    if (openButton) openClientDashboardDrawer(openButton.dataset.clientDashboardOpen, openButton);
    else {
      const row = event.target.closest('[data-client-row]');
      if (row && !event.target.closest('button, a, input, select, textarea')) {
        openClientDashboardDrawer(row.dataset.clientRow, row);
      }
    }
  });
  $('#clientDashboardPanel').addEventListener('click', event => {
    const actionButton = event.target.closest('[data-client-dashboard-action]');
    const closeButton = event.target.closest('[data-client-dashboard-close], [data-client-dashboard-action-close]');
    const drawerMessage = event.target.closest('[data-client-dashboard-drawer-action="message"]');
    const editButton = event.target.closest('[data-client-dashboard-edit]');
    const cancelEditButton = event.target.closest('[data-client-dashboard-cancel-edit]');
    const attentionButton = event.target.closest('[data-client-dashboard-attention]');
    if (actionButton) {
      openClientDashboardAction(actionButton.dataset.clientDashboardAction);
    } else if (closeButton) {
      if (closeButton.closest('#clientDashboardActionDialog')) $('#clientDashboardActionDialog').close();
      else closeClientDashboardDrawer();
    } else if (drawerMessage) {
      const client = hiredClients().find(item => item.id === clientDashboardSelectedId);
      if (client) openPlainClientEmailComposer(client);
    } else if (editButton) {
      const client = hiredClients().find(item => item.id === editButton.dataset.clientDashboardEdit);
      if (client) renderClientDashboardEditForm(client);
    } else if (cancelEditButton) {
      const client = hiredClients().find(item => item.id === clientDashboardSelectedId);
      if (client) renderClientDashboardDrawer(client);
    } else if (attentionButton) {
      const client = hiredClients().find(item => item.id === attentionButton.dataset.clientId);
      if (attentionButton.dataset.clientDashboardAttention === 'renew' && client) {
        openClientModal(client.id, false, true, false, true);
      } else if (attentionButton.dataset.clientDashboardAttention === 'message' && client) {
        openPlainClientEmailComposer(client);
      } else if (attentionButton.dataset.clientDashboardAttention === 'client-task') {
        const task = (data.clientTasks || []).find(item => item.id === attentionButton.dataset.itemId);
        if (task) {
          const now = new Date();
          if (task.timerStartedAt) {
            const start = new Date(task.timerStartedAt);
            const durationMs = Math.max(0, now.getTime() - start.getTime());
            task.timeEntries = Array.isArray(task.timeEntries) ? task.timeEntries : [];
            if (durationMs) task.timeEntries.push({ id: uid(), start: start.toISOString(), end: now.toISOString(), durationMs });
            task.timerStartedAt = '';
          }
          Object.assign(task, { status: 'done', completedAt: now.toISOString(), updatedAt: now.toISOString() });
        }
        persist().catch(error => {
          console.error('Could not complete overdue client task:', error);
          showActionResult({ title: 'Could not update task', message: error.message || 'Check your connection and try again.', status: 'error' });
        });
        renderAll();
      } else if (attentionButton.dataset.clientDashboardAttention === 'daily-task') {
        const task = (data.dailyTasks || []).find(item => item.id === attentionButton.dataset.itemId);
        if (task) task.completedAt = new Date().toISOString();
        persist().catch(error => {
          console.error('Could not complete overdue daily task:', error);
          showActionResult({ title: 'Could not update task', message: error.message || 'Check your connection and try again.', status: 'error' });
        });
        renderAll();
      }
    }
  });
  $('#clientDashboardPanel').addEventListener('submit', async event => {
    const form = event.target.closest('[data-client-dashboard-save]');
    if (!form) return;
    event.preventDefault();
    const client = hiredClients().find(item => item.id === form.dataset.clientDashboardSave);
    if (!client) return;
    const previousClient = JSON.parse(JSON.stringify(client));
    const fields = new FormData(form);
    Object.assign(client, {
      clientName: String(fields.get('clientName') || '').trim(),
      role: String(fields.get('role') || '').trim(),
      contact: String(fields.get('contact') || '').trim(),
      contractStatus: String(fields.get('contractStatus') || 'Active'),
      activeAt: String(fields.get('activeAt') || ''),
      contractEndDate: String(fields.get('contractEndDate') || ''),
      salaryAmount: fields.get('salaryAmount') === '' ? '' : Number(fields.get('salaryAmount')),
      salaryType: String(fields.get('salaryType') || ''),
      salaryCurrency: String(fields.get('salaryCurrency') || 'USD'),
      hoursPerWeek: fields.get('hoursPerWeek') === '' ? '' : Number(fields.get('hoursPerWeek')),
      email: String(fields.get('email') || '').trim(),
      phone: String(fields.get('phone') || '').trim(),
      notes: String(fields.get('notes') || '').trim(),
      updatedAt: new Date().toISOString()
    });
    try {
      if (!(await persist())) {
        Object.assign(client, previousClient);
        throw new Error('Cloud save failed.');
      }
      renderClientDashboard();
      toast('Client details saved.');
    } catch (error) {
      console.error('Could not save client dashboard details:', error);
      showActionResult({ title: 'Could not save client details', message: error.message || 'Check your connection and try again.', status: 'error' });
    }
  });
  $('#clientDashboardBackdrop').addEventListener('click', closeClientDashboardDrawer);
  $('#clientDashboardDrawer').addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeClientDashboardDrawer();
    } else if (event.key === 'Tab') {
      const focusable = [...event.currentTarget.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])')];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
  $('#clientDashboardActionDialog').addEventListener('click', event => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  $('#clientDashboardActionDialog').addEventListener('close', () => { clientDashboardAction = ''; });
  $('#clientDashboardPanel').addEventListener('keydown', event => {
    const sortButton = event.target.closest('[data-client-sort]');
    if (sortButton && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      sortButton.click();
      return;
    }
    const row = event.target.closest('[data-client-row]');
    if (row && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openClientDashboardDrawer(row.dataset.clientRow, row);
    }
  });
  renderClientDashboard();

  function renderInterviewCalendar() {
    const target = $('#interviewCalendar');
    const monthLabel = $('#interviewCalendarMonth');
    if (!target || !monthLabel) return;
    const year = interviewCalendarMonth.getFullYear();
    const month = interviewCalendarMonth.getMonth();
    monthLabel.textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(interviewCalendarMonth);
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const interviews = data.applications.filter(item => item.status === 'Interview' && item.interviewDate);
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const cells = weekdays.map(day => `<div class="calendar-weekday">${day}</div>`);
    for (let index = 0; index < 42; index += 1) {
      const dayOffset = index - firstDay;
      const date = new Date(year, month, dayOffset + 1);
      const inMonth = dayOffset >= 0 && dayOffset < daysInMonth;
      const dateValue = localDateKey(date);
      const dayInterviews = interviews.filter(item => dateKey(item.interviewDate) === dateValue);
      cells.push(`<div class="calendar-day${inMonth ? '' : ' other-month'}${dateValue === today() ? ' today' : ''}"><span class="calendar-day-number">${date.getDate()}</span><div class="calendar-interviews">${dayInterviews.map(item => `<button class="calendar-interview" type="button" data-calendar-client="${escapeHtml(item.id)}" title="${escapeHtml(item.clientName)}">${escapeHtml(item.clientName)}</button>`).join('')}</div></div>`);
    }
    target.innerHTML = cells.join('');
  }

  function renderPlatformBreakdown(applications) {
    const target = $('#platformBreakdown');
    const counts = applications.reduce((result, item) => {
      const key = item.platform || 'Not specified';
      result[key] = (result[key] || 0) + 1;
      return result;
    }, {});
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (!entries.length) {
      target.innerHTML = '<div class="empty-chart">Add an application to see your platform mix.</div>';
      return;
    }
    const maximum = Math.max(...entries.map(([, count]) => count));
    target.innerHTML = entries.map(([name, count]) => `
      <div class="platform-row"><span class="platform-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span><span class="platform-track"><i style="width:${(count / maximum) * 100}%"></i></span><strong>${count}</strong></div>
    `).join('');
  }

  function renderStatusChart(applications) {
    const target = $('#statusLegend');
    const statusEntries = Object.entries(STATUS_COLORS).map(([status, color]) => [status, applications.filter(item => item.status === status).length, color]).filter(([, count]) => count > 0);
    $('#donutValue').textContent = applications.length;
    if (!statusEntries.length) {
      $('#statusDonut').style.background = 'conic-gradient(#eff0ec 0 100%)';
      target.innerHTML = '<span class="empty-chart" style="padding:13px 8px">Status mix will appear here.</span>';
      return;
    }
    let total = 0;
    const stops = statusEntries.map(([, count, color]) => {
      const from = total;
      total += (count / applications.length) * 100;
      return `${color} ${from}% ${total}%`;
    });
    $('#statusDonut').style.background = `conic-gradient(${stops.join(',')})`;
    target.innerHTML = statusEntries.map(([status, count, color]) => `
      <span class="legend-item"><i class="legend-dot" style="background:${color}"></i><span>${escapeHtml(STATUS_LABELS[status] || status)}</span><strong>${count}</strong></span>
    `).join('');
  }

  function renderRecentApplications() {
    const target = $('#recentApplications');
    const applications = sortedPipelineApplications().slice(0, 5);
    if (!applications.length) {
      target.innerHTML = '<tr><td colspan="5"><div class="application-empty"><h3>Your tracker is ready</h3><p>Add your first client or application from the Applications tab and Jeff VA will organize the rest.</p><button class="button button-primary" type="button" data-go-to="applications">Go to applications</button></div></td></tr>';
      return;
    }
    target.innerHTML = applications.map(item => `
      <tr>
        <td><div class="table-client">${escapeHtml(item.clientName)}<small>${escapeHtml(item.role || item.contact || 'No role added')}</small></div></td>
        <td>${escapeHtml(item.platform)}</td><td><span class="application-stage-email-count">${statusPill(item.status)}${matchBadge(item)}</span></td><td>${formatDate(item.appliedDate)}</td>
        <td><button class="icon-button list-icon-button" type="button" data-edit-id="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.clientName)}" title="Edit application">✎</button></td>
      </tr>
    `).join('');
  }

  function applicationWeekOptions() {
    const currentRange = weekRange();
    const applicationDates = pipelineApplications().map(applicationAppliedDate).map(dateKey).filter(Boolean);
    const offsets = [...new Set(applicationDates.map(date => {
      const applicationDate = new Date(`${date}T12:00:00`);
      const daysSinceMonday = (applicationDate.getDay() + 6) % 7;
      applicationDate.setDate(applicationDate.getDate() - daysSinceMonday);
      return Math.round((applicationDate - new Date(`${currentRange.start}T12:00:00`)) / 86400000 / 7);
    }).filter(offset => offset < 0))].sort((first, second) => second - first);
    const options = offsets.map(offset => {
      const range = weekRange(offset);
      return `<option value="${offset}">${escapeHtml(weeklyRangeLabel(range).replace(' – ', ' to '))}</option>`;
    }).join('');
    return `<option value="">- Select -</option><option value="all">All weeks</option><option value="0">This week</option>${options}`;
  }

  function renderApplications() {
    const query = $('#applicationSearch').value.trim().toLowerCase();
    const status = $('#statusFilter').value;
    const platform = $('#platformFilter').value;
    const dateFilter = $('#applicationDateFilter').value;
    updatePlatformFilter();
    const weekOffset = Number(applicationDateSort);
    const weekRangeFilter = applicationDateSort && applicationDateSort !== 'all' ? weekRange(weekOffset) : null;
    $('#applicationWeekDate').textContent = !applicationDateSort
      ? 'Select a week'
      : applicationDateSort === 'all' ? 'All weeks' : weeklyRangeLabel(weekRangeFilter).replace(' – ', ' to ');
    $('#applicationDateSort').innerHTML = applicationWeekOptions();
    $('#applicationDateSort').value = applicationDateSort;
    const pipeline = pipelineApplications();
    const filtered = pipeline.filter(item => {
      const text = [item.clientName, item.contact, item.role, item.platform, item.nextStep, item.notes].join(' ').toLowerCase();
      const statusMatches = status
        ? (status === 'To Proceed' ? isToProceedStatus(item) : status === 'Ongoing' ? item.status === 'Ongoing' : item.status === status)
        : true;
      const alwaysVisibleStatus = isToProceedStatus(item) || item.status === 'Interview' || item.status === 'Ongoing';
      const dateMatches = alwaysVisibleStatus || !dateFilter || dateKey(item.appliedDate) === dateFilter;
      const weekMatches = alwaysVisibleStatus || !applicationDateSort || applicationDateSort === 'all' || isInWeeklyRange(applicationAppliedDate(item), weekRangeFilter);
      return (!query || text.includes(query)) && statusMatches && (!platform || item.platform === platform) && dateMatches && weekMatches;
    });
    $('#applicationListLabel').textContent = `${plural(filtered.length, 'application')}${filtered.length !== pipeline.length ? ` of ${pipeline.length}` : ''}`;
    const platformCounts = new Map();
    filtered.forEach(item => {
      const name = String(item.platform || 'Unspecified').trim() || 'Unspecified';
      platformCounts.set(name, (platformCounts.get(name) || 0) + 1);
    });
    $('#applicationPlatformCounts').innerHTML = [...platformCounts]
      .sort(([first], [second]) => first.localeCompare(second, undefined, { sensitivity: 'base' }))
      .map(([name, count]) => `<span class="application-platform-count">${escapeHtml(name)} - ${count}</span>`)
      .join('');
    const target = $('#applicationList');
    const filterChips = [
      query ? ['search', `Search: ${query}`] : null,
      dateFilter ? ['date', `Date: ${emailDate(dateFilter)}`] : null,
      status ? ['status', `Stage: ${status === 'Not selected' ? 'Rejected' : status}`] : null,
      platform ? ['platform', `Source: ${platform}`] : null,
      applicationDateSort && applicationDateSort !== '0' && applicationDateSort !== 'all' ? ['week', `Week: ${$('#applicationWeekDate').textContent}`] : null
    ].filter(Boolean);
    $('#applicationFilterChips').innerHTML = filterChips.map(([key, label]) => `<button class="filter-chip" type="button" data-remove-application-filter="${key}">${escapeHtml(label)} <span aria-hidden="true">×</span><span class="sr-only">Remove filter</span></button>`).join('');
    document.querySelectorAll('[data-application-quick-filter]').forEach(button => {
      const active = button.dataset.applicationQuickFilter === 'week'
        ? applicationDateSort === '0'
        : status === 'Applied';
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $('#clearApplicationFilters').hidden = filterChips.length === 0;
    $$('[data-application-view]').forEach(button => {
      const selected = button.dataset.applicationView === applicationViewMode;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const selectionToggle = $('#toggleApplicationSelection');
    selectionToggle.classList.toggle('active', applicationSelectionMode);
    selectionToggle.setAttribute('aria-pressed', String(applicationSelectionMode));
    selectionToggle.textContent = applicationSelectionMode ? 'Done' : 'Select';
    target.classList.toggle('application-board-mode', applicationViewMode === 'board');
    target.classList.toggle('selection-mode', applicationSelectionMode);
    selectedApplicationIds.forEach(id => {
      if (!filtered.some(item => item.id === id)) selectedApplicationIds.delete(id);
    });
    $('#applicationBulkActions').hidden = !applicationSelectionMode || selectedApplicationIds.size === 0;
    $('#applicationSelectionCount').textContent = `${selectedApplicationIds.size} selected`;
    if (!filtered.length) {
      const isFiltered = pipeline.length > 0;
      target.innerHTML = `<div class="application-empty"><h3>${isFiltered ? 'No matching applications' : 'Start your client pipeline'}</h3><p>${isFiltered ? 'Try a different search or filter.' : 'Track each application, where you applied, and the next step all in one private workspace.'}</p>${isFiltered ? '' : '<button class="button button-primary" type="button" data-open-add>Add your first client</button>'}</div>`;
      return;
    }
    const newestFirst = sortByDate(filtered, applicationAppliedDate);
    if (applicationViewMode === 'board') {
      const stages = ['To Proceed', 'Ongoing', 'Applied', 'Interview', 'Active client', 'Not selected'];
      target.innerHTML = `<div class="application-board">${stages.map(stage => {
        const cards = newestFirst.filter(item => stage === 'To Proceed' ? isToProceedStatus(item) : item.status === stage);
        return `<section class="application-board-column" data-application-drop-status="${escapeHtml(stage)}"><header><h3>${escapeHtml(stage === 'Not selected' ? 'Rejected' : stage)}</h3><span>${cards.length}</span></header><div class="application-board-cards">${cards.map(item => `<article class="application-board-card" draggable="${stage !== 'Active client'}" data-application-card="${escapeHtml(item.id)}">${applicationSelectionMode ? `<input type="checkbox" data-application-select="${escapeHtml(item.id)}" aria-label="Select ${escapeHtml(item.clientName)}"${selectedApplicationIds.has(item.id) ? ' checked' : ''} />` : ''}<button type="button" class="application-board-card-open" data-view-details="${escapeHtml(item.id)}"><strong>${escapeHtml(item.clientName)}</strong><span>${escapeHtml(item.role || item.contact || 'Role not set')}</span><small>${escapeHtml(item.platform || 'Source not set')} · ${escapeHtml(emailDate(item.appliedDate))}</small></button>${statusPill(item.status)}<button class="icon-button" type="button" data-edit-id="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.clientName)}">⋯</button></article>`).join('') || '<p class="application-board-empty">No applications</p>'}</div></section>`;
      }).join('')}</div>`;
      return;
    }
    target.innerHTML = `<div class="application-table-wrap"><table class="application-data-table"><thead><tr>${applicationSelectionMode ? '<th scope="col"><span class="sr-only">Select</span></th>' : ''}<th scope="col">Client / role</th><th scope="col">Source</th><th scope="col">Stage</th><th scope="col">Salary</th><th scope="col">Applied</th><th scope="col">Follow-up</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${newestFirst.map(item => {
      const salaryAmount = Number(item.salaryAmount);
      const salary = salaryAmount > 0 && ['monthly', 'hourly'].includes(item.salaryType)
        ? `${salaryCurrencySymbol(item.salaryCurrency)}${Math.round(salaryAmount).toLocaleString()} / ${item.salaryType === 'hourly' ? 'hour' : 'month'}`
        : '—';
      return `<tr data-view-details="${escapeHtml(item.id)}">${applicationSelectionMode ? `<td><input type="checkbox" data-application-select="${escapeHtml(item.id)}" aria-label="Select ${escapeHtml(item.clientName)}"${selectedApplicationIds.has(item.id) ? ' checked' : ''} /></td>` : ''}<td><strong>${escapeHtml(item.clientName)}</strong><small>${escapeHtml(item.role || item.contact || 'Role not set')}</small></td><td>${escapeHtml(item.platform || 'Not specified')}</td><td><span class="application-stage-email-count">${statusPill(item.status)}${matchBadge(item)}</span></td><td>${escapeHtml(salary)}</td><td>${escapeHtml(emailDate(item.appliedDate))}</td><td>${item.followUpDate ? escapeHtml(emailDate(item.followUpDate)) : '—'}</td><td><button class="icon-button application-actions-trigger" type="button" aria-label="More actions for ${escapeHtml(item.clientName)}" aria-haspopup="dialog" data-open-application-actions="${escapeHtml(item.id)}">⋯</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function emailWeekOptions() {
    const currentRange = weekRange();
    const emailDates = data.emails.map(item => dateKey(item.date)).filter(Boolean);
    const offsets = [...new Set(emailDates.map(date => {
      const emailDate = new Date(`${date}T12:00:00`);
      const daysSinceMonday = (emailDate.getDay() + 6) % 7;
      emailDate.setDate(emailDate.getDate() - daysSinceMonday);
      return Math.round((emailDate - new Date(`${currentRange.start}T12:00:00`)) / 86400000 / 7);
    }).filter(offset => offset < 0))].sort((first, second) => second - first);
    const options = offsets.map(offset => {
      const range = weekRange(offset);
      return `<option value="${offset}">${escapeHtml(weeklyRangeLabel(range).replace(' – ', ' to '))}</option>`;
    }).join('');
    return `<option value="all">All weeks</option><option value="0">This week</option>${options}`;
  }

  function renderToApplyList() {
    const target = $('#toApplyList');
    if (!target) return;
    const allReminders = data.toApply || [];
    const query = $('#toApplySearch').value.trim().toLowerCase();
    const sort = $('#toApplySort').value;
    const reminders = allReminders.filter(item => [item.title, item.link, item.notes].join(' ').toLowerCase().includes(query));
    reminders.sort((first, second) => {
      if (sort === 'title-asc') return String(first.title || '').localeCompare(String(second.title || ''), undefined, { sensitivity: 'base' });
      const dateOrder = String(first.dueDate || '').localeCompare(String(second.dueDate || ''));
      return sort === 'due-latest' ? -dateOrder : dateOrder;
    });
    $('#toApplyCountLabel').textContent = reminders.length === allReminders.length
      ? plural(reminders.length, 'reminder')
      : `${plural(reminders.length, 'reminder')} of ${plural(allReminders.length, 'reminder')}`;
    target.classList.toggle('is-empty', !reminders.length);
    if (!reminders.length) {
      target.innerHTML = `<div class="to-apply-empty">${allReminders.length ? 'No matching reminders.' : 'No application reminders yet.'}</div>`;
      return;
    }
    const currentDate = today();
    target.innerHTML = `<div class="to-apply-list-head"><span><i class="fa-regular fa-bookmark" aria-hidden="true"></i> Opportunity</span><span>Deadline</span><span>Manage</span></div>${reminders.map(item => {
      const overdue = item.dueDate < currentDate;
      const dueToday = item.dueDate === currentDate;
      return `<article class="to-apply-row${overdue ? ' overdue' : dueToday ? ' due-today' : ''}">
        <div class="to-apply-title"><strong>${escapeHtml(item.title)}</strong><a href="${escapeHtml(normalizeUrl(item.link))}" target="_blank" rel="noopener">${escapeHtml(item.link)}</a></div>
        <time class="to-apply-date"><span>${overdue ? 'Missed' : dueToday ? 'Apply today' : 'Apply by'}</span>${escapeHtml(formatDate(item.dueDate))}</time>
        <div class="to-apply-actions"><button class="button button-secondary to-apply-actions-trigger" type="button" data-to-apply-actions="${escapeHtml(item.id)}" aria-haspopup="dialog" aria-label="Actions for ${escapeHtml(item.title)}">Actions</button></div>
      </article>`;
    }).join('')}`;
  }

  function processDueApplyReminders() {
    const currentDate = today();
    data.toApply = data.toApply || [];
    data.alerts = data.alerts || [];
    let changed = false;
    let remindersDue = 0;
    data.toApply.forEach(item => {
      if (item.dueDate !== currentDate) return;
      const alertId = `to-apply|due|${item.id}|${item.dueDate}`;
      if (data.alerts.some(alert => alert.id === alertId)) return;
      data.alerts.unshift({
        id: alertId,
        type: 'to-apply',
        clientName: 'To apply',
        subject: `Apply today: ${item.title}`,
        from: 'Application reminder',
        date: new Date().toISOString(),
        unread: true
      });
      changed = true;
      remindersDue += 1;
    });
    if (changed) {
      limitAlertHistory();
      persist();
      renderAlerts();
      showActionResult({
        title: 'Application reminders due',
        message: `${plural(remindersDue, 'application reminder')} are due today.`,
        status: 'info',
        label: 'APPLICATION REMINDER',
        actionLabel: 'Open To Apply',
        onAction: () => showView('to-apply')
      });
    }
  }

  function openToApplyModal(id = null) {
    const item = (data.toApply || []).find(reminder => reminder.id === id);
    $('#toApplyForm').reset();
    $('#toApplyId').value = id || '';
    $('#toApplyModalTitle').textContent = id ? 'Edit reminder' : 'Add reminder';
    if (item) {
      $('#toApplyTitle').value = item.title || '';
      $('#toApplyLink').value = item.link || '';
      $('#toApplyDate').value = item.dueDate || '';
      $('#toApplyNotes').value = item.notes || '';
    }
    $('#toApplyModal').showModal();
    setTimeout(() => $('#toApplyTitle').focus(), 30);
  }

  function saveToApply(event) {
    if (event.submitter?.value === 'cancel') return;
    event.preventDefault();
    const savingInDrawer = isActiveClientDrawerView('edit');
    const form = $('#toApplyForm');
    if (!form.reportValidity()) return;
    data.toApply = data.toApply || [];
    const id = $('#toApplyId').value || uid();
    const reminder = { id, title: $('#toApplyTitle').value.trim(), link: $('#toApplyLink').value.trim(), dueDate: $('#toApplyDate').value, notes: $('#toApplyNotes').value.trim() };
    data.alerts = (data.alerts || []).filter(alert => !alert.id.startsWith(`to-apply|due|${id}|`));
    const existingIndex = data.toApply.findIndex(item => item.id === id);
    if (existingIndex >= 0) data.toApply[existingIndex] = reminder;
    else data.toApply.push(reminder);
    $('#toApplyModal').close();
    processDueApplyReminders();
    persist();
    renderAll();
  }

  async function deleteToApply(id) {
    const item = (data.toApply || []).find(reminder => reminder.id === id);
    if (!item || !(await appConfirm(`Delete the application reminder “${item.title}”?`, { title: 'Delete reminder', confirmLabel: 'Delete', danger: true }))) return;
    data.toApply = data.toApply.filter(reminder => reminder.id !== id);
    data.alerts = (data.alerts || []).filter(alert => !alert.id.startsWith(`to-apply|${id}|`));
    persist();
    renderAll();
  }

  function updatePlatformFilter() {
    const select = $('#platformFilter');
    const selected = select.value;
    const platforms = [...new Set(pipelineApplications().map(item => item.platform).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    select.innerHTML = '<option value="">All platforms</option>' + platforms.map(platform => `<option value="${escapeHtml(platform)}">${escapeHtml(platform)}</option>`).join('');
    select.value = platforms.includes(selected) ? selected : '';
  }

  function renderEmails() {
    const query = $('#emailSearch').value.trim().toLowerCase();
    const weekOffset = Number(emailDateSort);
    const weekRangeFilter = emailDateSort === 'all' ? null : weekRange(weekOffset);
    $('#emailWeekDate').textContent = emailDateSort === 'all' ? 'All weeks' : weeklyRangeLabel(weekRangeFilter).replace(' – ', ' to ');
    $('#emailDateSort').innerHTML = emailWeekOptions();
    $('#emailDateSort').value = emailDateSort;
    const received = receivedEmails();
    const sent = data.emails.filter(item => (item.direction === 'sent' || item.source === 'sent')
      && applicationsRelatedToEmail(item).length > 0);
    $('#emailReceivedCount').textContent = received.length;
    $('#emailSentCount').textContent = sent.length;
    const emails = data.emails
      .filter(item => [item.from, item.to, item.subject, item.body, item.date].join(' ').toLowerCase().includes(query))
      .filter(item => !emailDateFilter || dateKey(item.date) === emailDateFilter)
      .filter(item => emailDateSort === 'all' || isInWeeklyRange(item.date, weekRangeFilter))
      .filter(item => emailViewFilter === 'sent'
        ? (item.direction === 'sent' || item.source === 'sent') && applicationsRelatedToEmail(item).length > 0
        : item.direction !== 'sent' && item.source !== 'sent');
    const clientEmails = emails.filter(item => item.direction !== 'sent' && item.source !== 'sent');
    const sentEmails = emails.filter(item => item.direction === 'sent');
    const visibleEmails = sortByDate(emailViewFilter === 'sent' ? sentEmails : clientEmails, item => item.date);
    $('#emailCountLabel').textContent = `${plural(visibleEmails.length, 'email')}${query ? ' shown' : ''}`;
    $$('.email-summary-item').forEach(button => {
      const selected = button.dataset.emailView === emailViewFilter;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const target = $('#emailList');
    const sectionClass = `email-section${emailViewFilter === 'sent' ? ' email-section-sent' : ''}${emailSelectionMode ? ' email-selection-mode' : ''}`;
    const selectionActions = emailSelectionMode
      ? '<div class="email-bulk-actions"><label class="email-select-all-control"><input type="checkbox" data-email-select-all aria-label="Select all visible emails" /><span>Select all</span></label><span class="email-selection-count" data-email-selection-count aria-live="polite">0 selected</span><button class="email-selection-cancel" type="button" data-email-selection-toggle>Cancel</button><button class="button button-danger email-bulk-delete" type="button" data-email-bulk-delete disabled><i class="fa-regular fa-trash-can" aria-hidden="true"></i> Delete</button></div>'
      : '<button class="button button-secondary email-selection-trigger" type="button" data-email-selection-toggle><i class="fa-regular fa-square-check" aria-hidden="true"></i><span>Select emails</span></button>';
    $('#emailSelectionActions').innerHTML = selectionActions;
    if (!visibleEmails.length) {
      const hasFilters = Boolean(query || emailDateFilter || emailDateSort !== 'all');
      const title = emailViewFilter === 'sent'
        ? (hasFilters ? 'No matching sent emails' : 'No application-linked sent emails yet')
        : hasFilters
          ? 'No matching client emails'
          : 'No emails received yet';
      const copy = hasFilters
        ? 'Try another search term or date range.'
        : emailViewFilter === 'sent'
          ? 'Sent messages linked to an application or saved client will appear here.'
          : 'Received messages from Gmail will appear here.';
      target.innerHTML = `<section class="${sectionClass}"><div class="email-empty"><h3>${title}</h3><p>${copy}</p></div></section>`;
      return;
    }
    const renderEmailRows = items => items.map(item => {
      const matches = applicationsRelatedToEmail(item);
      const matchTag = matches.length ? `<span class="client-match-tag" aria-label="${matches.length} application matches" title="Matched to ${matches.length} applications">${matches.length}</span>` : '';
      const rawSender = (item.from || 'Unknown sender').trim();
      const platformName = item.direction !== 'sent' && item.source !== 'sent' ? platformNameForSender(item.from) : '';
      const sender = platformName || (rawSender.includes('<')
        ? rawSender.slice(0, rawSender.indexOf('<')).replace(/["']/g, '').trim() || rawSender
        : rawSender);
      const initial = sender.trim().charAt(0).toUpperCase() || '?';
      const bodyPreview = emailContentText(item.body).replace(/\s+/g, ' ').trim();
      const preview = bodyPreview.length > 110 ? `${bodyPreview.slice(0, 110).trimEnd()}...` : bodyPreview;
      const previewTitle = `${item.subject || '(No subject)'}${preview ? ` - ${preview}` : ''}`;
      const recipient = extractEmailAddress(item.from);
      const canCompose = matches.length > 0 && isEmailAddress(recipient);
      const sentClass = item.direction === 'sent' ? ' sent' : '';
      const sentBadge = item.direction === 'sent' ? '<span class="sent-email-badge">SENT</span>' : '';
      const dateLabel = item.direction === 'sent' ? 'Sent' : 'Received';
      const sentTime = emailTime(item.date);
      const selectionLabel = platformName ? `${platformName} email` : (item.subject || 'email');
      const selectionCheckbox = emailSelectionMode ? `<input class="email-select-checkbox" type="checkbox" data-email-select value="${escapeHtml(item.id)}" aria-label="Select ${escapeHtml(selectionLabel)}" />` : '';
      const previewMarkup = platformName ? '' : `<p class="email-preview" title="${escapeHtml(previewTitle)}"><strong class="email-subject">${escapeHtml(item.subject || '(No subject)')}</strong>${sentBadge}<span class="email-snippet">${preview ? ` - ${escapeHtml(preview)}` : ''}</span></p>`;
      return `<article class="email-row${sentClass}${platformName ? ' platform-email-row' : ''}" data-email-detail="${escapeHtml(item.id)}">${selectionCheckbox}<span class="email-avatar">${escapeHtml(initial)}</span><div class="email-row-content"><div class="email-sender-line"><h3 class="email-from" title="${escapeHtml(sender)}">${escapeHtml(sender)}</h3>${matchTag}</div>${previewMarkup}</div><time class="email-date" title="${dateLabel}"><span>${escapeHtml(emailDate(item.date))}</span>${sentTime ? `<span class="email-time">${escapeHtml(sentTime)}</span>` : ''}</time><div class="email-row-actions"><div class="email-action-menu"><button class="email-actions-trigger" type="button" data-email-action-trigger="${escapeHtml(item.id)}" aria-haspopup="true" aria-expanded="false">Actions</button><div class="email-actions-menu hidden" data-email-actions-menu="${escapeHtml(item.id)}" role="menu">${canCompose ? `<button type="button" role="menuitem" data-email-action="compose" data-email-id="${escapeHtml(item.id)}">Send email</button>` : ''}<button type="button" role="menuitem" class="email-action-delete" data-email-action="delete" data-email-id="${escapeHtml(item.id)}">Delete email</button></div></div></div></article>`;
    }).join('');
    target.innerHTML = `<section class="${sectionClass}">${renderEmailRows(visibleEmails)}</section>`;
  }

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
    const dateFilter = $('#hiredDateFilter').value;
    const clients = allHired.filter(item => {
      const contractStatus = isContractEnded(item) ? 'Contract Ended' : (item.contractStatus || 'Active');
      const searchableText = [
        item.clientName, item.email, item.phone, item.website, item.socialMedia,
        ...normalizeClientSocialLinks(item).flatMap(link => [link.platform, CLIENT_SOCIAL_PLATFORM_LABELS[link.platform], link.url]), item.location,
        item.companyName, item.company, item.role, contractStatus
      ].join(' ').toLowerCase();
      return (filter === 'all' || contractStatus === filter)
        && (!query || searchableText.includes(query))
        && (!dateFilter || dateKey(activeSinceDate(item)) === dateFilter);
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
      .filter(emailItem => emailItem.direction !== 'sent' && emailItem.source !== 'sent').length;
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
  $('#hiredDateFilter').addEventListener('change', event => {
    hiredDateFilter = event.target.value;
    renderHired();
  });
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

  function updateWeekNavigationCounts() {
    const applicationRange = applicationDateSort && applicationDateSort !== 'all' ? weekRange(Number(applicationDateSort)) : null;
    const emailRange = emailDateSort === 'all' ? null : weekRange(Number(emailDateSort));
    const relevantReceivedEmails = receivedEmails();
    $('#navApplicationCount').textContent = !applicationDateSort || applicationDateSort === 'all'
      ? pipelineApplications().length
      : pipelineApplications().filter(item => isInWeeklyRange(applicationAppliedDate(item), applicationRange)).length;
    $('#navEmailCount').textContent = emailDateSort === 'all'
      ? relevantReceivedEmails.length
      : relevantReceivedEmails.filter(item => isInWeeklyRange(item.date, emailRange)).length;
  }

  function updateToApplyAttention() {
    const hasUnfinishedApplications = (data.toApply || []).some(item => item.dueDate && item.dueDate <= today());
    const link = $('[data-view="to-apply"]');
    link.classList.toggle('to-apply-attention', hasUnfinishedApplications);
    link.setAttribute('aria-label', hasUnfinishedApplications ? 'To Apply - action needed' : 'To Apply');
  }

  function renderCurrentView() {
    const viewName = typeof activeView !== 'undefined' ? activeView : (localStorage.getItem(ACTIVE_VIEW_KEY) || 'dashboard');
    switch (viewName) {
      case 'dashboard':
        renderClientDashboard();
        renderDashboard();
        break;
      case 'daily-task':
        renderDailyTasks();
        break;
      case 'applications':
        renderApplications();
        break;
      case 'to-apply':
        renderToApplyList();
        break;
      case 'hired':
        renderHired();
        break;
      case 'inbox':
        renderEmails();
        break;
      case 'documents':
        renderPersonalDocuments();
        renderScripts();
        renderWorkLinks();
        renderInvoiceList();
        break;
      case 'wallet':
        renderWallet();
        break;
      case 'news':
        if (!newsLoading && (!newsLastLoaded || Date.now() - newsLastLoaded >= 3600000)) loadNews({ reset: true });
        break;
      case 'social-trends':
        renderSocialTrends();
        break;
      case 'account':
        renderAccountPage();
        break;
    }
  }

  function renderAll() {
    // perf: keep match caches until the application snapshot changes, instead of blowing them away on every rerender.
    invalidateApplicationMatchCaches();
    processContractEndedAlerts();
    renderCurrentView();
    updateWeekNavigationCounts();
    $('#navToApplyCount').textContent = (data.toApply || []).filter(item => item.dueDate === today()).length;
    updateToApplyAttention();
    $('#navHiredCount').textContent = hiredClients().filter(isActiveContract).length;
    $('#settingsAppCount').textContent = data.applications.length;
    $('#settingsEmailCount').textContent = receivedEmails().length;
    const autoBackupFrequency = $('#autoBackupFrequency');
    if (autoBackupFrequency) autoBackupFrequency.value = localStorage.getItem('jeff-va-auto-backup-frequency-v1') || 'off';
    renderAlerts();
    renderWeeklyReportAvailability();
    $$('.nav-count').forEach(count => count.classList.toggle('is-zero', Number(count.textContent) === 0));
  }

  function showView(view, { updateUrl = true } = {}) {
    if (view === 'password') view = 'account';
    if (!APP_VIEW_SET.has(view)) view = 'dashboard';
    if (view === 'account' && !hasAccountSettingsAccess()) view = 'dashboard';
    if (view !== 'dashboard') closeClientDashboardDrawer();
    if (view === 'account') {
      localStorage.setItem(ACTIVE_VIEW_KEY, view);
      if (updateUrl && window.location.pathname !== appViewPath(view)) {
        window.history.pushState({ view }, '', appViewPath(view));
      }
      openWorkspaceSettings();
      return;
    }
    if (updateUrl && (window.location.pathname !== appViewPath(view) || window.location.search || window.location.hash)) {
      window.history.pushState({ view }, '', appViewPath(view));
    }
    localStorage.setItem(ACTIVE_VIEW_KEY, view);
    activeView = view;
    if (view === 'applications') {
      applicationDateSort = '0';
      applicationDateFilter = '';
      $('#applicationDateSort').value = '0';
      $('#applicationDateFilter').value = '';
      $('#statusFilter').value = 'Applied';
    }
    if (view === 'hired') {
      showingHiredClientList = true;
      hiredEditingId = null;
    }
    // perf: render the requested view on entry while renderAll skips inactive pages.
    renderCurrentView();
    if (view === 'account') {
      renderPasswordPage();
      renderAccountPage();
      refreshAccountStorageUsage();
    }
    const labels = { dashboard: [activeDashboardTab === 'client' ? 'CLIENT WORKSPACE' : 'YOUR PIPELINE', activeDashboardTab === 'client' ? 'Client Dashboard' : 'Application Dashboard'], 'daily-task': ['', 'Daily Tasks'], applications: ['', 'Applications'], 'to-apply': ['APPLICATION PIPELINE', 'To Apply'], news: ['', 'News'], 'social-trends': ['', 'Social Trends'], hired: ['', 'Active Clients'], inbox: ['', 'Email'], documents: ['PRIVATE TOOLS', 'Tools'], account: ['', 'Account'] };
    labels.wallet = ['', 'Wallet'];
    $('#pageEyebrow').textContent = labels[view][0];
    $('#pageTitle').textContent = labels[view][1];
    $('#pageEyebrow').hidden = !labels[view][0];
    $('#pageTitle').hidden = false;
    $('#hiredCountLabel').hidden = view !== 'hired' || !showingHiredClientList;
    $('#hiredHeaderSummary').hidden = view !== 'hired' || !showingHiredClientList;
    $('#applicationWeekDate').hidden = view !== 'applications';
    $('#toApplyHeaderContext').hidden = view !== 'to-apply';
    $('#emailWeekDate').hidden = view !== 'inbox';
    $('#dailyTaskHeaderDate').hidden = view !== 'daily-task';
    $$('.view').forEach(panel => panel.classList.toggle('active', panel.dataset.viewPanel === view));
    $$('.nav-link').forEach(link => {
      const isCurrentRoute = link.dataset.view === view;
      link.classList.toggle('active', isCurrentRoute);
      if (isCurrentRoute) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    // The header Add client action belongs exclusively to the Applications view.
    // Keep it hidden everywhere else, including when navigating from the sidebar.
    const addClientButton = $('#openAddModal');
    addClientButton.hidden = activeView !== 'applications';
    addClientButton.setAttribute('aria-hidden', String(activeView !== 'applications'));
    const gmailHeaderActions = $('#gmailHeaderActions');
    gmailHeaderActions?.classList.toggle('hidden', activeView !== 'inbox');
    closeMobileSidebar({ restoreFocus: window.matchMedia('(max-width: 720px)').matches });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (view === 'inbox' && currentUser && gmailAccessToken) syncGmail(true);
  }

  function saveNewClientApplicationDraft() {
    const draft = {};
    $$('#clientForm input[id], #clientForm select[id], #clientForm textarea[id]').forEach(field => {
      if (field.id === 'clientId' || field.type === 'file') return;
      draft[field.id] = field.type === 'checkbox' ? field.checked : field.value;
    });
    draft.socialLinks = readClientSocialLinks({ includeEmpty: true });
    localStorage.setItem(`${APPLICATION_DRAFT_KEY}:${currentUser?.id || 'anonymous'}`, JSON.stringify(draft));
  }

  function restoreNewClientApplicationDraft() {
    const savedDraft = localStorage.getItem(`${APPLICATION_DRAFT_KEY}:${currentUser?.id || 'anonymous'}`);
    if (!savedDraft) return false;

    let draft;
    try {
      draft = JSON.parse(savedDraft);
    } catch (error) {
      console.error('Could not restore the unfinished application:', error);
      showActionResult({ title: 'Unfinished application could not be restored', message: 'The saved draft is invalid and has been kept in browser storage.', status: 'error' });
      return false;
    }
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
      console.error('Could not restore the unfinished application: saved draft has an invalid format.');
      showActionResult({ title: 'Unfinished application could not be restored', message: 'The saved draft has an invalid format and has been kept in browser storage.', status: 'error' });
      return false;
    }

    Object.entries(draft).forEach(([id, value]) => {
      const field = document.getElementById(id);
      if (!field || field.closest('#clientForm') !== $('#clientForm')) return;
      if (field.type === 'checkbox') field.checked = value === true;
      else field.value = String(value ?? '');
    });
    renderClientSocialLinkEditor(Array.isArray(draft.socialLinks) ? draft.socialLinks : []);
    if (!$('#hiredSocial').value && Array.isArray(draft.socialLinks)) {
      $('#hiredSocial').value = String(draft.socialLinks.find(link => link?.url)?.url || '');
    }
    $('#clientPlatform').dispatchEvent(new Event('change'));
    $('#clientCountry').dispatchEvent(new Event('change'));
    if ($('#clientRegion').value) $('#clientRegion').dispatchEvent(new Event('change'));
    updateSalaryFields();
    updateClientActionLabel();
    return true;
  }

  function openClientModal(id = null, viewOnly = false, activeClientOnly = false, drawerEdit = false, activeClientDetailsEdit = false) {
    const form = $('#clientForm');
    form.reset();
    renderClientSocialLinkEditor();
    activeClientDetailsModalEdit = activeClientDetailsEdit;
    $$('#clientForm input, #clientForm select, #clientForm textarea').forEach(field => { field.disabled = false; });
    editingId = id;
    viewingClientDetails = viewOnly;
    $('#clientModal').classList.toggle('application-detail-panel', viewOnly && activeView === 'applications');
    $('#clientId').value = id || '';
    $('#appliedDate').value = id ? '' : today();
    $('#automaticFollowUp').checked = false;
    $('#appliedDate').disabled = false;
    $('#followUpDate').disabled = false;
    $('#automaticFollowUp').disabled = false;
    $('#followUpDate').closest('.form-field')?.classList.remove('hidden');
    $('#automaticFollowUp').closest('.follow-up-option')?.classList.remove('hidden');
    $('#customPlatformField').classList.add('hidden');
    $('#customPlatform').required = false;
    $('#clientCountry').value = '';
    $('#clientRegion').value = '';
    $('#clientRegionField').classList.add('hidden');
    $('#clientFollowUpHistory').classList.add('hidden');
    $('#clientEmailHistory').classList.add('hidden');
    if (id) {
      const item = data.applications.find(application => application.id === id);
      if (!item) return;
      $('#modalEyebrow').textContent = viewOnly ? 'VIEW DETAILS' : 'EDIT RECORD';
      $('#clientModalTitle').textContent = viewOnly ? 'Application details' : 'Update client application';
      $('#saveClientButton').textContent = 'Save changes';
      $('#clientName').value = item.clientName;
      $('#contactName').value = item.contact || '';
      $('#clientRole').value = item.role || '';
      $('#employmentType').value = item.employmentType || '';
      $('#hiredEmail').value = item.email || '';
      $('#hiredPhone').value = item.phone || '';
      $('#hiredWebsite').value = item.website || '';
      $('#hiredSocial').value = item.socialMedia || normalizeClientSocialLinks(item)[0]?.url || '';
      renderClientSocialLinkEditor(normalizeClientSocialLinks(item), viewOnly);
      $('#hiredLocation').value = item.location || '';
      const savedLocation = String(item.location || '');
      const savedCountry = [...$('#clientCountry').options].find(option => savedLocation === option.text || savedLocation.startsWith(`${option.text},`));
      if (savedCountry) {
        $('#clientCountry').value = savedCountry.value;
        $('#clientCountry').dispatchEvent(new Event('change'));
        const savedRegion = [...$('#clientRegion').options].find(option => savedLocation.includes(option.text));
        if (savedRegion) $('#clientRegion').value = savedRegion.value;
      }
      $('#clientStatus').value = ['Ongoing', 'Applied', 'To Proceed', 'Interview', 'Active client', 'Not selected'].includes(item.status) ? item.status : 'Applied';
      $('#nextStep').value = item.nextStep || '';
      if (activeClientOnly && item.status !== 'Active client') return;
      $('#contractEndDate').value = item.contractEndDate || '';
      $('#appliedDate').value = item.appliedDate || '';
      $('#interviewDate').value = item.interviewDate || '';
      $('#interviewLink').value = item.interviewLink || '';
      $('#followUpDate').value = item.followUpDate || '';
      $('#automaticFollowUp').checked = Boolean(item.automaticFollowUp);
      $('#clientNotes').value = item.notes || '';
      renderClientFollowUpHistory(item, viewOnly);
      renderClientEmailHistory(item);
      const listedPlatforms = [...$('#clientPlatform').options].map(option => option.value);
      if (listedPlatforms.includes(item.platform)) {
        $('#clientPlatform').value = item.platform;
      } else {
        $('#clientPlatform').value = 'Other';
        $('#customPlatformField').classList.remove('hidden');
        $('#customPlatform').required = true;
        $('#customPlatform').value = item.platform;
      }
    } else {
      $('#modalEyebrow').textContent = 'NEW RECORD';
      $('#clientModalTitle').textContent = 'Add a client application';
      $('#saveClientButton').textContent = 'Save application';
      $('#salaryType').value = '';
      $('#salaryCurrency').value = 'USD';
      $('#salaryAmount').value = '';
      $('#salaryHoursPerWeek').value = '';
      updateSalaryFields();
    }
    if (id) {
      const item = data.applications.find(application => application.id === id);
      if (item) {
        $('#salaryType').value = item.salaryType || '';
        $('#salaryCurrency').value = item.salaryCurrency || 'USD';
        $('#salaryAmount').value = item.salaryAmount ?? '';
        $('#salaryHoursPerWeek').value = item.hoursPerWeek ?? '';
        updateSalaryFields();
      }
    }
    if (!id && !viewOnly) restoreNewClientApplicationDraft();
    const showSocialAccountEditor = Boolean(id && activeClientOnly && !viewOnly);
    $('#clientSocialLinksField').hidden = !showSocialAccountEditor;
    $('#hiredSocialField').hidden = showSocialAccountEditor;
    [
      ['#hiredWebsite', '#hiredWebsiteLink'],
      ['#hiredSocial', '#hiredSocialLink']
    ].forEach(([inputSelector, linkSelector]) => {
      const input = $(inputSelector);
      const link = $(linkSelector);
      const value = input.value.trim();
      input.hidden = viewOnly;
      link.hidden = !viewOnly || !value;
      link.textContent = value;
      if (value) link.href = normalizeUrl(value);
    });
    $$('#clientForm input, #clientForm select, #clientForm textarea').forEach(field => { field.disabled = viewOnly; });
    updateClientSocialEditorControls(viewOnly || !showSocialAccountEditor);
    if (activeClientOnly) {
      $('#clientStatus').value = 'Active client';
      $('#clientStatus').disabled = true;
    }
    $('#saveClientButton').hidden = viewOnly;
    $('#closeClientDetailsButton').hidden = !viewOnly;
    $('#clientForm').classList.toggle('view-details-form', viewOnly);
    const activeClientEdit = Boolean(id && data.applications.find(application => application.id === id)?.status === 'Active client' && !viewOnly);
    $('#appliedDate').disabled = activeClientEdit;
    $('#followUpDate').disabled = activeClientEdit;
    $('#automaticFollowUp').disabled = activeClientEdit;
    $('#followUpDate').closest('.form-field')?.classList.toggle('hidden', activeClientEdit);
    $('#automaticFollowUp').closest('.follow-up-option')?.classList.toggle('hidden', activeClientEdit);
    if (drawerEdit) {
      showActiveClientDrawerView('edit');
      $('#closeClientDetailsButton').textContent = 'Cancel';
      markActiveClientDrawerFormClean('edit');
    } else {
      $('#clientModal').showModal();
    }
    updateClientActionLabel();
    if (drawerEdit) $('#clientName').focus();
    else setTimeout(() => $('#clientName').focus(), 30);
  }

  function renderClientFollowUpHistory(item, viewOnly) {
    const target = $('#clientFollowUpHistory');
    if (!target || !viewOnly) return;
    const clientEmail = String(item.email || '').trim().toLowerCase();
    const followUps = data.emails.filter(email => email.direction === 'sent'
      && (email.applicationId === item.id || (clientEmail && String(email.to || '').trim().toLowerCase() === clientEmail && /^follow-up:/i.test(email.subject || ''))))
      .sort((first, second) => new Date(second.date) - new Date(first.date));
    const historicalFollowUp = !followUps.length && item.followUpSentAt
      ? [{ date: item.followUpSentAt, subject: `Follow-up: ${item.clientName}`, historical: true }]
      : followUps;
    target.classList.remove('hidden');
    target.innerHTML = `<div class="client-follow-up-history-head"><span>FOLLOW-UPS SENT</span><strong>${plural(historicalFollowUp.length, 'email')}</strong></div>${historicalFollowUp.length
      ? `<div class="client-follow-up-history-list">${historicalFollowUp.map(email => `<div><span title="${escapeHtml(email.subject || 'Follow-up')}">${escapeHtml(email.subject || 'Follow-up')}</span><small>${escapeHtml(emailDate(email.date))}</small></div>`).join('')}</div>`
      : '<p>No follow-up emails have been sent to this application.</p>'}`;
  }

  function renderClientEmailHistory(item) {
    const target = $('#clientEmailHistory');
    const list = $('#clientEmailHistoryList');
    const count = $('#clientEmailHistoryCount');
    if (!target || !list || !count) return;
    const sentEmails = sentEmailsForApplication(item);
    target.classList.remove('hidden');
    count.textContent = `${sentEmails.length} ${sentEmails.length === 1 ? 'email' : 'emails'}`;
    list.innerHTML = renderSentEmailHistoryItems(sentEmails, 'No emails have been sent to this application.');
  }

  function sentEmailsForApplication(item) {
    const clientEmail = String(item.email || '').trim().toLowerCase();
    return data.emails
      .filter(email => email.direction === 'sent'
        && (email.applicationId === item.id || (!email.applicationId && clientEmail && String(email.to || '').trim().toLowerCase() === clientEmail)))
      .sort((first, second) => new Date(second.date) - new Date(first.date));
  }

  function renderSentEmailHistoryItems(sentEmails, emptyMessage) {
    return sentEmails.length
      ? sentEmails.map(email => `<button type="button" class="client-email-history-item" data-email-detail="${escapeHtml(email.id)}" aria-label="Open email: ${escapeHtml(email.subject || 'No subject')}, sent ${escapeHtml(emailDate(email.date))}"><span class="client-email-history-copy"><strong title="${escapeHtml(email.subject || '(No subject)')}">${escapeHtml(email.subject || '(No subject)')}</strong><small>To ${escapeHtml(email.to || 'client')}</small></span><span class="client-email-history-meta"><span class="client-email-direction">Sent</span><time>${escapeHtml(emailDate(email.date))}</time></span></button>`).join('')
      : `<p>${emptyMessage}</p>`;
  }

  function renderHiredEmailHistory(item) {
    const sentEmails = sentEmailsForApplication(item);
    return `<section class="client-email-history hired-email-history" aria-live="polite">
      <div class="client-email-history-head"><div><p class="eyebrow">CLIENT COMMUNICATION</p><h3>Email History</h3><span>Sent to this client</span></div><strong>${plural(sentEmails.length, 'email')}</strong></div>
      <div class="client-email-history-list">${renderSentEmailHistoryItems(sentEmails, 'No emails have been sent to this client.')}</div>
    </section>`;
  }

  function updateClientActionLabel() {
    const button = $('#saveClientButton');
    if (!button) return;
    const activeClient = $('#clientStatus').value === 'Active client';
    const activeClientDrawerEdit = isActiveClientDrawerView('edit');
    button.textContent = activeClient && !activeClientDrawerEdit && !activeClientDetailsModalEdit ? 'Next' : (editingId ? 'Save changes' : 'Save application');
    $$('.contract-field').forEach(field => field.classList.toggle('hidden', !activeClient));
    const activeClientEdit = Boolean(editingId && activeClient && !viewingClientDetails);
    $('#appliedDate').disabled = activeClientEdit;
    $('#followUpDate').disabled = activeClientEdit;
    $('#automaticFollowUp').disabled = activeClientEdit;
    $('#followUpDate').closest('.form-field')?.classList.toggle('hidden', activeClientEdit);
    $('#automaticFollowUp').closest('.follow-up-option')?.classList.toggle('hidden', activeClientEdit);
    const isInterview = $('#clientStatus').value === 'Interview';
    $$('.interview-field').forEach(field => field.classList.toggle('hidden', !isInterview));
    const interviewDate = $('#interviewDate');
    const interviewLink = $('#interviewLink');
    [interviewDate, interviewLink].forEach(field => {
      if (!field) return;
      field.required = isInterview;
      field.setCustomValidity(isInterview ? '' : '');
    });
    $('#closeClientDetailsButton').hidden = false;
    if (!activeClientDrawerEdit) $('#closeClientDetailsButton').textContent = (viewingClientDetails || editingId) ? 'Close' : 'Cancel';
    $('#nextStepField').classList.toggle('hidden', $('#clientStatus').value !== 'To Proceed');
    $('#sendProceedEmailButton').hidden = viewingClientDetails || $('#clientStatus').value !== 'To Proceed';
  }

  async function saveClient(event) {
    const submitter = event.submitter;
    if (submitter?.value === 'cancel') {
      if (!editingId) localStorage.removeItem(`${APPLICATION_DRAFT_KEY}:${currentUser?.id || 'anonymous'}`);
      return;
    }
    event.preventDefault();
    const savingInDrawer = isActiveClientDrawerView('edit');
    const form = $('#clientForm');
    if (!form.reportValidity()) return;
    if ($('#automaticFollowUp').checked && !$('#followUpDate').value) {
      $('#followUpDate').value = addDays(today(), 7);
    }
    const platformChoice = $('#clientPlatform').value;
    const existing = editingId ? data.applications.find(item => item.id === editingId) : null;
    const existingIndex = editingId ? data.applications.findIndex(item => item.id === editingId) : -1;
    const previousApplication = existing ? JSON.parse(JSON.stringify(existing)) : null;
    const isActiveClient = $('#clientStatus').value === 'Active client';
    const contractEndDate = $('#contractEndDate').value;
    if (isActiveClient && contractEndDate && dateKey(contractEndDate) < today()
      && !(await appConfirm(`This contract end date has already passed (${formatDate(contractEndDate)}). Saving it will mark ${$('#clientName').value.trim() || 'this client'} as expired. Do you want to continue?`, { title: 'Contract date has passed', confirmLabel: 'Save anyway' }))) return;
    if (isActiveClient && (!existing || existing.status !== 'Active client')) beginActivationRollback(editingId || uid(), existing);
    const activeClientEmailPending = isActiveClient && (!existing || existing.status !== 'Active client' || Boolean(existing.activePendingEmail));
    const editingSocialAccounts = !$('#clientSocialLinksField').hidden;
    const applicationSocial = $('#hiredSocial').value.trim();
    const socialLinks = editingSocialAccounts
      ? readClientSocialLinks()
      : (applicationSocial ? [{ platform: inferClientSocialPlatform(applicationSocial), url: applicationSocial }] : []);
    const application = {
      id: editingId || (pendingActivation?.applicationId || uid()),
      clientName: $('#clientName').value.trim(),
      contact: $('#contactName').value.trim(),
      role: $('#clientRole').value.trim(),
      email: $('#hiredEmail').value.trim(),
      phone: $('#hiredPhone').value.trim(),
      website: $('#hiredWebsite').value.trim(),
      socialMedia: editingSocialAccounts ? (socialLinks[0]?.url || '') : applicationSocial,
      socialLinks,
      location: $('#hiredLocation').value.trim(),
      platform: platformChoice === 'Other' ? $('#customPlatform').value.trim() : platformChoice,
      employmentType: $('#employmentType').value,
      salaryType: $('#salaryType').value,
      salaryCurrency: $('#salaryCurrency').value || 'USD',
      salaryAmount: $('#salaryAmount').value === '' ? '' : Number($('#salaryAmount').value),
      hoursPerWeek: $('#salaryHoursPerWeek').value === '' ? '' : Number($('#salaryHoursPerWeek').value),
      status: $('#clientStatus').value,
      nextStep: $('#clientStatus').value === 'To Proceed' ? $('#nextStep').value.trim() : '',
      // Moving an application into Active Clients always requires a newly
      // confirmed contract for the activation email. Existing client files are
      // preserved, but they cannot accidentally skip this one-time step.
      activePendingDocument: isActiveClient && (!existing || existing.status !== 'Active client'),
      activePendingEmail: activeClientEmailPending,
      appliedDate: $('#appliedDate').value,
      interviewDate: $('#interviewDate').value,
      interviewLink: $('#interviewLink').value.trim(),
      interviewAlertDate: editingId && data.applications.find(item => item.id === editingId)?.interviewDate === $('#interviewDate').value ? (data.applications.find(item => item.id === editingId)?.interviewAlertDate || '') : '',
      createdAt: editingId ? (data.applications.find(item => item.id === editingId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
      activeAt: editingId ? (data.applications.find(item => item.id === editingId)?.activeAt || ($('#clientStatus').value === 'Active client' ? new Date().toISOString() : '')) : ($('#clientStatus').value === 'Active client' ? new Date().toISOString() : ''),
      followUpDate: $('#followUpDate').value,
      automaticFollowUp: $('#automaticFollowUp').checked,
      followUpProcessedAt: editingId && data.applications.find(item => item.id === editingId)?.followUpDate === $('#followUpDate').value ? (data.applications.find(item => item.id === editingId)?.followUpProcessedAt || '') : '',
      followUpSentAt: editingId && data.applications.find(item => item.id === editingId)?.followUpDate === $('#followUpDate').value ? (data.applications.find(item => item.id === editingId)?.followUpSentAt || '') : '',
      notes: $('#clientNotes').value.trim(),
      contractStatus: editingId ? (data.applications.find(item => item.id === editingId)?.contractStatus || 'Active') : 'Active',
      contractEndDate: isActiveClient ? contractEndDate : '',
      updatedAt: new Date().toISOString()
    };
    if (editingId) {
      // Document metadata lives in Supabase and is managed from the Active Clients page — carry the references forward.
      if (existing) {
        application.documents = existing.documents;
        application.profileImage = existing.profileImage;
      }
      if (existingIndex >= 0) data.applications[existingIndex] = application;
    } else {
      data.applications.push(application);
    }
    if (submitter) setButtonLoading(submitter, true);
    const saved = await persist();
    if (submitter) setButtonLoading(submitter, false);
    if (!saved) {
      if (previousApplication && existingIndex >= 0) data.applications[existingIndex] = previousApplication;
      else data.applications = data.applications.filter(item => item.id !== application.id);
      renderAll();
      return;
    }
    if (!editingId) localStorage.removeItem(`${APPLICATION_DRAFT_KEY}:${currentUser?.id || 'anonymous'}`);
    if ($('#clientModal').open) $('#clientModal').close();
    if (savingInDrawer) closeActiveClientActionsDrawer(true);
    renderAll();
    if (application.status === 'Active client' && application.activePendingDocument) {
      pendingActiveClientId = application.id;
      openClientDocumentPicker(application);
      toast('Next step: select or upload a client document');
    } else if (application.status === 'Active client' && application.activePendingEmail) {
      if (pendingActivation) pendingActivation.stage = 'email';
      openClientEmailComposer(application);
      toast('Next step: send the activation email');
    } else if (application.status === 'Active client') {
      showView('hired');
      renderHiredDetail(application);
    } else {
      showActionResult({ title: editingId ? 'Application updated' : 'Application added', message: editingId ? 'Your application changes were saved.' : 'The application was added to your workspace.' });
    }
    processDueInterviews();
    await processDueFollowUps();
  }

  async function deleteClient(id, fromActive = false) {
    const item = data.applications.find(application => application.id === id);
    if (!item) return;
    if (!(await appConfirm(`Delete ${item.clientName}? This removes the application, profile photo, and attached documents. This cannot be undone unless you've exported a backup.`, { title: 'Delete client application', confirmLabel: 'Delete', danger: true, showCloseButton: false }))) return;
    data.applications = data.applications.filter(application => application.id !== id);
    persist();
    (item.documents || []).forEach(doc => { deleteDocumentBlob(doc.storagePath || doc.id).catch(() => {}); });
    if (item.profileImage?.storagePath) {
      deleteDocumentBlob(item.profileImage.storagePath).catch(error => console.error('Could not remove the deleted client profile photo:', error));
    }
    $('#clientModal')?.close();
    if (isActiveClientDrawerOpen()) closeActiveClientActionsDrawer(true);
    editingId = null;
    if (fromActive) closeHiredDetail(false);
    renderAll();
    showActionResult({ title: 'Client deleted', message: 'The client, profile photo, and attached documents were removed.' });
  }
