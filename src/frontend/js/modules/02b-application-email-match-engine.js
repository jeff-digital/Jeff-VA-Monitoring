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
    const employerBody = applicationEmployerEvidenceText(emailItem.body);
    const contentLower = `${emailItem.subject || ''} ${employerBody}`.toLowerCase();
    const senderPlatformKey = platformKeyForName(platformNameForSender(fromAddress));
    const matches = [];
    if (senderPlatformKey) {
      const subjectText = normalizeMatchText(emailItem.subject);
      const bodySource = employerBody
        .replace(/\bsent\s+via\s+[\w.-]+\s+contact\s+form\b/gi, ' ');
      const bodyText = normalizeMatchText(bodySource);
      const bodyLinkTokens = applicationLinkTokens(employerBody);
      const scoredMatches = [];
      const applicationIndex = buildApplicationMatchIndex(data.applications);
      for (const item of applicationIndex) {
        if (Date.parse(emailItem.date) < item.appliedTime) continue;
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
      if (Date.parse(emailItem.date) < item.appliedTime) continue;
      const { application, email, contact, clientName, role } = item;
      const roleReferenced = role.length >= 3 && contentLower.includes(role);
      const companyReferenced = clientName.length >= 3 && containsWholeWord(contentLower, clientName);
      if (email && !item.emailIsPlatformSender && email === fromAddress) {
        matches.push(application);
        candidateItems.push(item);
        continue;
      }
      if (isDirectClientApplication(application) && isEmailAddress(email)) continue;
      if (!roleReferenced && !companyReferenced) continue;
      if ([contact, clientName].filter(name => name.length >= 3).some(name => containsWholeWord(senderName, name))) {
        matches.push(application);
        candidateItems.push(item);
      }
    }
    if (candidateItems.length > 1) {
      const subjectText = normalizeApplicationMatchEvidence(emailItem.subject);
      const bodyText = normalizeApplicationMatchEvidence(employerBody);
      matches.splice(0, matches.length, ...disambiguateApplicationMatches(
        candidateItems, emailItem, subjectText, bodyText, applicationLinkTokens(employerBody)
      ));
    } else if (candidateItems.length === 1) {
      const subjectText = normalizeApplicationMatchEvidence(emailItem.subject);
      const bodyText = normalizeApplicationMatchEvidence(employerBody);
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

