  function normalizeApplicationMatchEvidence(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function containsNormalizedPhrase(text, phrase) {
    if (!phrase) return false;
    let index = -1;
    while ((index = text.indexOf(phrase, index + 1)) !== -1) {
      if ((index === 0 || text[index - 1] === ' ')
        && (index + phrase.length === text.length || text[index + phrase.length] === ' ')) return true;
    }
    return false;
  }

  function emailExplicitlyNamesDifferentRole(item, subjectText, bodyText) {
    const source = `${subjectText} ${bodyText}`;
    const rolePhrases = [];
    const roleMentionPattern = /\bfor (?:the |a |an )?(.{2,120}?) (?:role|position|job)\b/g;
    for (const match of source.matchAll(roleMentionPattern)) {
      const phrase = match[1].trim();
      const words = phrase.split(' ');
      if (words.some(word => ['application', 'job', 'position', 'role'].includes(word))) continue;
      if (words.length < 2 && (phrase.length < 10 || GENERIC_DISAMBIGUATION_ROLE_WORDS.has(phrase))) continue;
      rolePhrases.push(phrase);
    }
    if (!rolePhrases.length) return false;
    return !rolePhrases.some(phrase => (
      item.roleIsMatchable && containsNormalizedPhrase(phrase, item.roleNorm)
    ) || (
      item.coreRoleIsMatchable && containsNormalizedPhrase(phrase, item.coreRoleNorm)
    ));
  }

  function disambiguateApplicationMatches(candidateItems, emailItem, subjectText, bodyText, bodyLinkTokens) {
    if (candidateItems.length < 2) return candidateItems.map(item => item.application);
    const indexed = candidateItems;
    const emailWords = new Set(`${subjectText} ${bodyText}`.split(' '));
    const bodyLinkTokenSet = new Set(bodyLinkTokens);
    const fullRoleMatches = indexed.map(item => item.roleIsMatchable
      && emailWords.has(item.roleLastWord)
      && (containsNormalizedPhrase(subjectText, item.roleNorm) || containsNormalizedPhrase(bodyText, item.roleNorm)));
    const hasFullRoleMatch = fullRoleMatches.some(Boolean);
    const coreRoleMatches = hasFullRoleMatch ? [] : indexed.map(item => item.coreRoleIsMatchable
      && emailWords.has(item.coreRoleLastWord)
      && (containsNormalizedPhrase(subjectText, item.coreRoleNorm) || containsNormalizedPhrase(bodyText, item.coreRoleNorm)));
    const roleScores = new Array(indexed.length).fill(0);
    if (hasFullRoleMatch) {
      for (let index = 0; index < indexed.length; index++) {
        if (!fullRoleMatches[index]) continue;
        const item = indexed[index];
        const shadowedByLongerRole = indexed.some((other, otherIndex) => otherIndex !== index
          && fullRoleMatches[otherIndex]
          && other.roleNorm.length > item.roleNorm.length
          && containsNormalizedPhrase(other.roleNorm, item.roleNorm));
        if (!shadowedByLongerRole) roleScores[index] = 100 + item.roleNorm.length;
      }
    } else {
      for (let index = 0; index < indexed.length; index++) {
        if (!coreRoleMatches[index]) continue;
        const item = indexed[index];
        const shadowedByLongerCore = indexed.some((other, otherIndex) => otherIndex !== index
          && coreRoleMatches[otherIndex]
          && other.coreRoleNorm.length > item.coreRoleNorm.length
          && containsNormalizedPhrase(other.coreRoleNorm, item.coreRoleNorm));
        if (!shadowedByLongerCore) roleScores[index] = 60;
      }
    }
    const emailTime = new Date(emailItem.date || '').getTime();
    const scoredCandidates = [];
    let highestEvidenceScore = -Infinity;
    for (let index = 0; index < indexed.length; index++) {
      const item = indexed[index];
      const roleScore = roleScores[index];
      const linkMatch = item.jobLinkTokens.some(token => bodyLinkTokenSet.has(token));
      const contactMatch = item.contactNorm.length >= 3 && emailWords.has(item.contactLastWord)
        && containsNormalizedPhrase(bodyText, item.contactNorm);
      const appliedTime = item.appliedTime;
      const days = Number.isFinite(emailTime) && Number.isFinite(appliedTime) && appliedTime <= emailTime
        ? Math.floor((emailTime - appliedTime) / 86400000)
        : null;
      const evidenceScore = roleScore + (linkMatch ? 100 : 0) + (contactMatch ? 15 : 0);
      highestEvidenceScore = Math.max(highestEvidenceScore, evidenceScore);
      scoredCandidates.push({ item, evidenceScore, days, hasRoleOrLinkEvidence: roleScore > 0 || linkMatch });
    }
    const evidenceTies = scoredCandidates.filter(candidate => candidate.evidenceScore === highestEvidenceScore);
    const priorDateTies = evidenceTies.filter(candidate => candidate.days !== null);
    const closestPriorDate = priorDateTies.length
      ? Math.min(...priorDateTies.map(candidate => candidate.days))
      : Infinity;
    const topCandidates = evidenceTies.map(candidate => ({
      ...candidate,
      timeScore: candidate.days === null ? 0 : Math.max(1, 10 - (candidate.days - closestPriorDate))
    }));
    const highestTimeScore = Math.max(...topCandidates.map(candidate => candidate.timeScore));
    const topMatches = topCandidates
      .filter(candidate => candidate.timeScore === highestTimeScore)
      .map(candidate => candidate.item.application);
    if (topMatches.length > 1 && !topCandidates.some(candidate =>
      candidate.timeScore === highestTimeScore && candidate.hasRoleOrLinkEvidence
    )) {
      ambiguousEmailMatches.set(emailItem, topMatches);
    }
    return topMatches;
  }
