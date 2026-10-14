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
    const priorDates = new Array(indexed.length);
    let closestPriorDate = Infinity;
    for (let index = 0; index < indexed.length; index++) {
      const item = indexed[index];
      const appliedTime = item.appliedTime;
      const days = Number.isFinite(emailTime) && Number.isFinite(appliedTime) && appliedTime <= emailTime
        ? Math.floor((emailTime - appliedTime) / 86400000)
        : null;
      priorDates[index] = days;
      if (days !== null) closestPriorDate = Math.min(closestPriorDate, days);
    }
    let highestScore = -Infinity;
    const topMatches = [];
    const topMatchesWithRoleOrLinkEvidence = [];
    for (let index = 0; index < indexed.length; index++) {
      const item = indexed[index];
      const roleScore = roleScores[index];
      const linkMatch = item.jobLinkTokens.some(token => bodyLinkTokenSet.has(token));
      const contactMatch = item.contactNorm.length >= 3 && emailWords.has(item.contactLastWord)
        && containsNormalizedPhrase(bodyText, item.contactNorm);
      const days = priorDates[index];
      const timeScore = days === null ? 0 : Math.max(1, 10 - (days - closestPriorDate));
      const score = roleScore + (linkMatch ? 100 : 0) + (contactMatch ? 15 : 0) + timeScore;
      if (score > highestScore) {
        highestScore = score;
        topMatches.length = 0;
        topMatchesWithRoleOrLinkEvidence.length = 0;
      }
      if (score === highestScore) {
        topMatches.push(item.application);
        topMatchesWithRoleOrLinkEvidence.push(roleScore > 0 || linkMatch);
      }
    }
    if (topMatches.length > 1 && !topMatchesWithRoleOrLinkEvidence.some(Boolean)) {
      ambiguousEmailMatches.set(emailItem, topMatches);
    }
    return topMatches;
  }
