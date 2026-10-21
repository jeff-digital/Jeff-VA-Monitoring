  const PLATFORM_SENDER_EMAIL_SET = new Set(Object.values(PLATFORM_SENDER_EMAILS).map(email => email.toLowerCase()));
  const GENERIC_APPLICATION_ROLE_WORDS = new Set([
    'application', 'assistant', 'candidate', 'employee', 'job', 'manager', 'opportunity',
    'professional', 'role', 'service', 'specialist', 'staff', 'support', 'team', 'work'
  ]);

  function normalizeMatchText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^\w]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function platformKeyForName(platform) {
    const name = String(platform || '').trim().toLowerCase();
    return Object.keys(PLATFORM_SENDER_EMAILS)
      .find(key => key === name || PLATFORM_DISPLAY_NAMES[key].toLowerCase() === name) || '';
  }

  function isSpecificApplicationRole(role) {
    return role.length >= 3 && role.split(' ').some(word => !GENERIC_APPLICATION_ROLE_WORDS.has(word));
  }

  function applicationLinkTokens(value) {
    const links = String(value || '').match(/(?:https?:\/\/|www\.)[^\s<>"']+|\/(?:jobseekers\/info|jobs?|job-postings?|listings?|vacancies)\/[^\s<>"']+/gi) || [];
    const tokens = new Set();
    for (const link of links) {
      const normalized = link.replace(/[),.;!?]+$/g, '').toLowerCase()
        .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
      if (normalized) tokens.add(`url:${normalized}`);
      for (const match of normalized.matchAll(/(?:jobseekers\/info|jobs?|job-postings?|listings?|vacancies)\/([a-z0-9_-]+)/g)) {
        tokens.add(`id:${match[1]}`);
      }
    }
    for (const id of onlineJobsJobIds(value)) tokens.add(`onlinejobs-job:${id}`);
    return [...tokens];
  }

  function onlineJobsJobIds(value) {
    const ids = new Set();
    const pattern = /(?:https?:\/\/(?:www\.)?|www\.)onlinejobs\.ph\/jobseekers\/job\/([^\s<>"'?#/]+)/gi;
    for (const match of String(value || '').matchAll(pattern)) {
      const slug = match[1].replace(/[),.;!]+$/, '');
      const id = slug.match(/(?:^|-)(\d+)$/)?.[1];
      if (id) ids.add(id);
    }
    return [...ids];
  }

  function platformApplicationMatchScore(item, senderPlatformKey, subjectText, bodyText, bodyLinkTokens, receivedDate) {
    if (item.platformKey && item.platformKey !== senderPlatformKey) return null;
    const clientMentioned = item.matchClientName.length >= 3
      && (containsWholeWord(subjectText, item.matchClientName) || containsWholeWord(bodyText, item.matchClientName));
    const roleInSubject = item.roleIsSpecific && containsWholeWord(subjectText, item.matchRole);
    const roleInBody = item.roleIsSpecific && containsWholeWord(bodyText, item.matchRole);
    const contactInBody = item.matchContact.length >= 3 && containsWholeWord(bodyText, item.matchContact);
    const linkMentioned = item.jobLinkTokens.some(token => bodyLinkTokens.includes(token));
    const ambiguousRoleTie = roleInSubject && item.roleGroupCount > 1;
    const replySubject = subjectText.replace(/^(?:(?:re|fw|fwd)\s+)+/, '');
    const exactApplicationSubject = [`application for ${item.matchRole}`, `application for the ${item.matchRole}`].includes(replySubject);
    const savedJobIds = item.jobLinkTokens.filter(token => token.startsWith('onlinejobs-job:'));
    const emailJobIds = bodyLinkTokens.filter(token => token.startsWith('onlinejobs-job:'));
    const conflictingJob = savedJobIds.length && emailJobIds.length && !savedJobIds.some(id => emailJobIds.includes(id));
    const uniqueRoleReply = senderPlatformKey === 'onlinejobs.ph' && item.platformKey === senderPlatformKey
      && item.roleIsSpecific && item.roleGroupCount === 1 && exactApplicationSubject && !conflictingJob
      && Number.isFinite(item.appliedTime) && Date.parse(receivedDate) >= item.appliedTime;
    if (!clientMentioned && !linkMentioned && !(roleInSubject && contactInBody) && !ambiguousRoleTie && !uniqueRoleReply) return null;
    return (clientMentioned ? 5 : 0) + (linkMentioned ? 5 : 0)
      + (roleInSubject ? 3 : 0) + (roleInBody ? 1 : 0) + (contactInBody ? 1 : 0)
      + (item.platformKey === senderPlatformKey ? 1 : -1);
  }
