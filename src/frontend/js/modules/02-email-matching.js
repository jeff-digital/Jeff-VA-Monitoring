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
  let applicationEmailSummarySource = null;
  let applicationEmailSummaryCount = 0;
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
      application.platform || '',
      application.status || '', application.contractStatus || '', application.contractEndDate || '',
      Boolean(application.activePendingDocument), Boolean(application.activePendingEmail)
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

  function isEmailTaskActiveClient(application) {
    return Boolean(application && isActiveContract(application)
      && !application.activePendingDocument && !application.activePendingEmail);
  }

  function activeClientsMatchingSender(emailItem) {
    if (isSentEmail(emailItem)) return [];
    const sender = extractEmailAddress(emailItem.from);
    if (!isEmailAddress(sender) || PLATFORM_SENDER_EMAIL_SET.has(sender)) return [];
    return data.applications.filter(application => isEmailTaskActiveClient(application)
      && extractEmailAddress(application.email) === sender);
  }

  function activeClientsForTaskEmail(emailItem) {
    if (!emailItem || isSentEmail(emailItem)) return [];
    return matchApplicationsForEmail(emailItem).filter(isEmailTaskActiveClient);
  }

  function matchApplicationsForEmail(emailItem) {
    // Outgoing emails may repeat a company's name and role, but they are not
    // evidence of a client response. Check before consulting cached matches.
    if (isSentEmail(emailItem)) return [];
    // Work emails from an established client's saved address don't need to
    // mention the original job title, and must not be treated as job replies.
    const activeClients = activeClientsMatchingSender(emailItem);
    if (activeClients.length) return activeClients;
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
        const score = platformApplicationMatchScore(item, senderPlatformKey, subjectText, bodyText, bodyLinkTokens, emailItem.date);
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
    return isSentEmail(emailItem) ? [] : matchApplicationsForEmail(emailItem);
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
    if (!applicationEmailSummaryCache || applicationEmailSummarySource !== data.emails
      || applicationEmailSummaryCount !== data.emails.length) {
      applicationEmailSummaryCache = buildApplicationEmailSummary();
      applicationEmailSummarySource = data.emails;
      applicationEmailSummaryCount = data.emails.length;
    }
    return applicationEmailSummaryCache.get(application.id) || [];
  }

  function openApplicationEmailsModal(applicationId) {
    const application = data.applications.find(item => item.id === applicationId);
    if (!application) return;
    const emails = matchingEmailsForApplication(application)
      .filter(emailItem => !isSentEmail(emailItem))
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
    if (emailItem.applicationAiAnalysis?.rejectApplication === true) return false;
    const source = `${emailItem.subject || ''} ${emailItem.body || ''}`;
    return /\b(interview|meeting|video call|phone call|screening)\b/i.test(source);
  }

  function matchBadge(app) {
    const matches = matchingEmailsForApplication(app)
      .filter(emailItem => !isSentEmail(emailItem));
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

  function sortApplicationList(items, order = 'newest') {
    const timestamp = value => {
      const result = new Date(value || 0).getTime();
      return Number.isFinite(result) ? result : 0;
    };
    const direction = order === 'oldest' ? 1 : -1;
    return [...items].sort((first, second) => direction * (
      timestamp(applicationAppliedDate(first)) - timestamp(applicationAppliedDate(second))
      || timestamp(first.createdAt) - timestamp(second.createdAt)
    ));
  }

  function confirmedApplicationFollowUpSentAt(item) {
    const scheduledDate = dateKey(item.followUpDate);
    const recipient = extractEmailAddress(item.email || '');
    const sameRecipient = recipient ? data.applications.filter(app => extractEmailAddress(app.email || '') === recipient) : [];
    const expectedSubject = `follow-up: ${String(item.clientName || '').trim()}`.toLowerCase();
    const sentDates = [item.followUpSentAt, ...data.emails.filter(email => {
      if (!isSentEmail(email)) return false;
      const subject = String(email.subject || '').trim().replace(/^(?:(?:re|fw|fwd):\s*)+/i, '');
      if (email.emailType !== 'follow-up' && !/^follow(?:ing)?[\s-]*up\b/i.test(subject)) return false;
      if (email.applicationId) return email.applicationId === item.id;
      if (!recipient || extractEmailAddress(email.to || '') !== recipient) return false;
      // Shared recruiter addresses need a company-specific subject; a generic
      // follow-up to that address must not complete every application.
      return (sameRecipient.length === 1 && sameRecipient[0].id === item.id)
        || (String(item.clientName || '').trim() && subject.toLowerCase() === expectedSubject);
    }).map(email => email.date)].filter(value => {
      const date = dateKey(value);
      return date && (!scheduledDate || date >= scheduledDate)
        && (!item.appliedDate || date >= dateKey(item.appliedDate))
        && Number.isFinite(new Date(value).getTime());
    });
    return sentDates.sort((a, b) => new Date(b) - new Date(a))[0] || '';
  }

  function applicationFollowUpState(item) {
    const scheduledDate = dateKey(item.followUpDate);
    const sentDate = dateKey(confirmedApplicationFollowUpSentAt(item));
    if (sentDate && (!scheduledDate || sentDate >= scheduledDate)) return 'sent';
    if (scheduledDate === today() && !['Active client', 'Not selected'].includes(item.status)) return 'due';
    return '';
  }

  function applicationFollowUpMarkup(item) {
    const state = applicationFollowUpState(item);
    const date = state === 'sent' ? dateKey(confirmedApplicationFollowUpSentAt(item)) : dateKey(item.followUpDate);
    if (!date) return '—';
    const label = state === 'sent' ? 'Follow-up sent successfully' : state === 'due' ? 'Follow-up due today — not sent yet' : 'Scheduled follow-up';
    return `<span class="application-follow-up${state ? ` is-${state}` : ''}" title="${escapeHtml(label)}"><span>${escapeHtml(emailDate(date))}</span>${state === 'sent' ? '<span class="follow-up-check" aria-label="Sent successfully">✓</span>' : state === 'due' ? '<span class="follow-up-due-label">Due today</span>' : ''}</span>`;
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
    const sourceBreakdown = [...platformCounts]
      .sort(([first], [second]) => first.localeCompare(second, undefined, { sensitivity: 'base' }))
      .map(([name, count]) => `<span class="application-source-row"><span>${escapeHtml(name)}</span><strong>${count}</strong></span>`)
      .join('');
    $('#applicationPlatformCounts').innerHTML = `<span class="application-source-heading"><span>Applications by source</span><strong>${filtered.length}</strong></span><span class="application-source-caption">Current filtered results</span><span class="application-source-list">${sourceBreakdown || '<span class="application-source-empty">No applications in this view</span>'}</span>`;
    const target = $('#applicationList');
    const filterChips = [
      query ? ['search', `Search: ${query}`] : null,
      dateFilter ? ['date', `Date: ${emailDate(dateFilter)}`] : null,
      status && status !== 'Applied' ? ['status', `Stage: ${status === 'Not selected' ? 'Rejected' : status}`] : null,
      platform ? ['platform', `Source: ${platform}`] : null,
      applicationDateSort && applicationDateSort !== '0' && applicationDateSort !== 'all' ? ['week', `Week: ${$('#applicationWeekDate').textContent}`] : null
    ].filter(Boolean);
    $('#applicationFilterChips').innerHTML = filterChips.map(([key, label]) => `<button class="filter-chip" type="button" data-remove-application-filter="${key}">${escapeHtml(label)} <span aria-hidden="true">×</span><span class="sr-only">Remove filter</span></button>`).join('');
    $('#clearApplicationFilters').hidden = filterChips.length === 0 && applicationDateSort !== '0' && status !== 'Applied';
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
    const sortedApplications = sortApplicationList(filtered, $('#applicationOrderSort').value);
    if (applicationViewMode === 'board') {
      const stages = ['To Proceed', 'Ongoing', 'Applied', 'Interview', 'Active client', 'Not selected'];
      target.innerHTML = `<div class="application-board">${stages.map(stage => {
        const cards = sortedApplications.filter(item => stage === 'To Proceed' ? isToProceedStatus(item) : item.status === stage);
        return `<section class="application-board-column" data-application-drop-status="${escapeHtml(stage)}"><header><h3>${escapeHtml(stage === 'Not selected' ? 'Rejected' : stage)}</h3><span>${cards.length}</span></header><div class="application-board-cards">${cards.map(item => `<article class="application-board-card" draggable="${stage !== 'Active client'}" data-application-card="${escapeHtml(item.id)}">${applicationSelectionMode ? `<input type="checkbox" data-application-select="${escapeHtml(item.id)}" aria-label="Select ${escapeHtml(item.clientName)}"${selectedApplicationIds.has(item.id) ? ' checked' : ''} />` : ''}<button type="button" class="application-board-card-open" data-view-details="${escapeHtml(item.id)}"><strong>${escapeHtml(item.clientName)}</strong><span>${escapeHtml(item.role || item.contact || 'Role not set')}</span><small>${escapeHtml(item.platform || 'Source not set')} · ${escapeHtml(emailDate(item.appliedDate))}</small></button>${statusPill(item.status)}<button class="icon-button" type="button" data-edit-id="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.clientName)}">⋯</button></article>`).join('') || '<p class="application-board-empty">No applications</p>'}</div></section>`;
      }).join('')}</div>`;
      return;
    }
    target.innerHTML = `<div class="application-table-wrap"><table class="application-data-table"><thead><tr>${applicationSelectionMode ? '<th scope="col"><span class="sr-only">Select</span></th>' : ''}<th scope="col">Client / role</th><th scope="col">Source</th><th scope="col">Stage</th><th scope="col">Salary</th><th scope="col">Applied</th><th scope="col">Follow-up</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${sortedApplications.map(item => {
      const salaryAmount = Number(item.salaryAmount);
      const salary = salaryAmount > 0 && ['monthly', 'hourly'].includes(item.salaryType)
        ? `${salaryCurrencySymbol(item.salaryCurrency)}${Math.round(salaryAmount).toLocaleString()} / ${item.salaryType === 'hourly' ? 'hour' : 'month'}`
        : '—';
      return `<tr class="${applicationFollowUpState(item) === 'due' ? 'application-follow-up-due' : ''}" data-view-details="${escapeHtml(item.id)}">${applicationSelectionMode ? `<td><input type="checkbox" data-application-select="${escapeHtml(item.id)}" aria-label="Select ${escapeHtml(item.clientName)}"${selectedApplicationIds.has(item.id) ? ' checked' : ''} /></td>` : ''}<td><strong>${escapeHtml(item.clientName)}</strong><small>${escapeHtml(item.role || item.contact || 'Role not set')}</small></td><td>${escapeHtml(item.platform || 'Not specified')}</td><td><span class="application-stage-email-count">${statusPill(item.status)}${matchBadge(item)}</span></td><td>${escapeHtml(salary)}</td><td>${escapeHtml(emailDate(item.appliedDate))}</td><td>${applicationFollowUpMarkup(item)}</td><td><button class="icon-button application-actions-trigger" type="button" aria-label="More actions for ${escapeHtml(item.clientName)}" aria-haspopup="dialog" data-open-application-actions="${escapeHtml(item.id)}">⋯</button></td></tr>`;
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
    target.innerHTML = `<div class="application-table-wrap"><table class="application-data-table to-apply-data-table"><thead><tr><th scope="col">Opportunity</th><th scope="col">Deadline</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${reminders.map(item => {
      const overdue = item.dueDate < currentDate;
      const dueToday = item.dueDate === currentDate;
      return `<tr class="to-apply-data-row${overdue ? ' overdue' : dueToday ? ' due-today' : ''}">
        <td><strong>${escapeHtml(item.title)}</strong><a href="${escapeHtml(normalizeUrl(item.link))}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(item.link)}">${escapeHtml(item.link)}</a></td>
        <td><time datetime="${escapeHtml(item.dueDate)}">${escapeHtml(formatDate(item.dueDate))}</time>${overdue || dueToday ? `<small class="to-apply-deadline-status">${overdue ? 'Missed' : 'Apply today'}</small>` : ''}</td>
        <td><button class="icon-button to-apply-actions-trigger" type="button" data-to-apply-actions="${escapeHtml(item.id)}" aria-haspopup="dialog" aria-label="Actions for ${escapeHtml(item.title)}">⋯</button></td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
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

