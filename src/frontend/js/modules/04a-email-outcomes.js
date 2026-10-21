  // Application outcomes use the authenticated AI endpoint. No phrase-based
  // rejection classifier runs in the browser.
  const APPLICATION_AI_PENDING_STATUSES = ['Applied', 'Ongoing', 'To Proceed', 'To Proceeding', 'Interview'];

  function applicationAiScanKey(email, app) {
    return `application-v1:${clientEmailTaskScanKey({ ...email, subject: JSON.stringify([email.subject, email.from,
      email.to, email.date, email.direction, email.labelIds]) }, [{ id: app.id,
      role: JSON.stringify([app.role, app.clientName, app.companyName, app.company, app.email, app.website,
        app.status, app.appliedDate, app.updatedAt]) }])}`;
  }

  function latestApplicationAiEmails(emails) {
    const latest = new Map();
    for (const email of [...emails].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))) {
      if (isSentEmail(email) || !isEmailInAiWeek(email)) continue;
      const matches = matchApplicationsForEmail(email);
      for (const app of matches) {
        // Even an ambiguous newer message blocks rejecting from an older one.
        if (!latest.has(app.id)) latest.set(app.id, { email, unique: matches.length === 1 });
      }
    }
    return latest;
  }

  function applicationAiStillEligible(email, app, emails) {
    if (!APPLICATION_AI_PENDING_STATUSES.includes(app.status) || isSentEmail(email)) return false;
    const latest = latestApplicationAiEmails(emails).get(app.id);
    if (!latest?.unique || latest.email !== email) return false;
    const received = Date.parse(email.date), applied = Date.parse(app.appliedDate || '');
    const updated = Date.parse(app.updatedAt || app.createdAt || app.appliedDate || '');
    return Number.isFinite(received) && Number.isFinite(applied) && received >= applied
      && received <= Date.now() + 300000 && (!Number.isFinite(updated) || received >= updated);
  }

  async function applyAiApplicationOutcomes(emails, budget = { remaining: Infinity }) {
    const result = { changed: [], review: [], failed: false };
    if (!currentUser || !dataReady || !supabaseDataLoaded) return result;
    const userId = currentUser.id, workspace = data;
    const mutations = [], addedAlerts = [], processed = [];
    const latest = latestApplicationAiEmails(emails);
    let waiting = false;
    for (const app of workspace.applications) {
      const email = latest.get(app.id)?.email;
      if (!email || !applicationAiStillEligible(email, app, emails)) continue;
      if (!String(email.body || '').trim() && email.bodyLoaded !== true) continue;
      const scanKey = applicationAiScanKey(email, app), emailId = email.gmailId || email.id;
      if (email.applicationAiProcessedKey === scanKey || app.emailClosure?.emailId === emailId) continue;
      if (budget.remaining <= 0) { waiting = true; budget.queued = true; continue; }
      let analysis;
      try { analysis = await analyzeClientEmail(email, app, scanKey, true); budget.remaining--; }
      catch { waiting = true; break; }
      if (currentUser?.id !== userId || data !== workspace) return result;
      if (!workspace.applications.includes(app) || !workspace.emails.includes(email)
        || !applicationAiStillEligible(email, app, workspace.emails) || applicationAiScanKey(email, app) !== scanKey) {
        waiting = true; continue;
      }
      // Keep an isolated cache even after a failed save; never repeat inference
      // just because the database was briefly unavailable.
      email.applicationAiAnalysis = { ...analysis, applicationId: app.id };
      processed.push({ email, previousKey: email.applicationAiProcessedKey });
      email.applicationAiProcessedKey = scanKey;
      const outcomeReasons = { rejected: 'Not selected', position_closed: 'Position closed', position_filled: 'Position filled',
        position_unavailable: 'Position unavailable', application_expired: 'Application expired' };
      if (analysis.rejectApplication === true && analysis.matchesApplication === true && analysis.confidence >= 0.95
        && outcomeReasons[analysis.outcome] && analysis.evidence?.trim().length >= 8) {
        const alertId = `application-email-closed|${app.id}|${emailId}`;
        if (workspace.alerts.some(alert => alert.id === alertId)) continue;
        const previous = { status: app.status, updatedAt: app.updatedAt, emailClosure: app.emailClosure, interviewPriority: app.interviewPriority };
        const now = new Date().toISOString(), reason = outcomeReasons[analysis.outcome];
        app.status = 'Not selected'; app.updatedAt = now; app.interviewPriority = false;
        app.emailClosure = { emailId, emailRecordId: email.id, reason, evidence: analysis.evidence,
          previousStatus: previous.status, receivedAt: email.date, processedAt: now, source: 'cloudflare-ai', analysis };
        const alert = { id: alertId, type: 'application-email-closed', applicationId: app.id, emailId: email.id,
          clientName: app.clientName, from: email.from, date: now, unread: true,
          subject: `${reason} — marked Rejected: ${app.role || app.clientName}`, evidence: analysis.evidence,
          reason: analysis.reason, emailSubject: email.subject || '(No subject)' };
        workspace.alerts.unshift(alert); addedAlerts.push(alert);
        mutations.push({ app, previous });
        result.changed.push({ app, email, outcome: { reason, evidence: analysis.evidence } });
      } else if (analysis.outcome === 'uncertain' || !analysis.matchesApplication) {
        const alert = { id: `application-ai-review:${app.id}:${email.id}:${scanKey}`, type: 'application-email-review',
          applicationId: app.id, emailId: email.id, clientName: app.clientName, from: email.from,
          date: new Date().toISOString(), unread: true, subject: `Review application update: ${app.role || app.clientName}`,
          reason: analysis.reason, evidence: analysis.evidence };
        if (!workspace.alerts.some(item => item.id === alert.id)) {
          workspace.alerts.unshift(alert); addedAlerts.push(alert); result.review.push({ app, email, analysis });
        }
      }
    }
    if (processed.length) {
      let saved = false;
      try { saved = await persist(); } catch { /* Retry the cached decisions next sync. */ }
      if (!saved) {
        for (const { app, previous } of mutations) Object.assign(app, previous);
        workspace.alerts = workspace.alerts.filter(alert => !addedAlerts.includes(alert));
        for (const { email, previousKey } of processed) {
          if (previousKey === undefined) delete email.applicationAiProcessedKey;
          else email.applicationAiProcessedKey = previousKey;
        }
        return { changed: [], review: [], failed: true };
      }
    }
    if (currentUser?.id !== userId || data !== workspace) return { changed: [], review: [], failed: false };
    // Do not overwrite a provider/session error with a successful status.
    if (!(emailAiRetryState()?.until > Date.now())) renderEmailTaskAiStatus(waiting || budget.queued
      ? 'Email AI: remaining messages are queued for the next sync.' : 'Email AI: application and active-client messages checked.');
    if (result.review.length) renderAlerts();
    return result;
  }

  function showApplicationEmailOutcomeNotice(changes) {
    if (!changes.length) return;
    renderAll();
    const live = $('#notificationLive');
    if (live) live.textContent = `${changes.length} application${changes.length === 1 ? ' was' : 's were'} marked Rejected after AI checked a matched email. Check notifications for details.`;
    showActionResult({ title: 'Application closed', status: 'info', label: 'APPLICATION UPDATE',
      message: `${changes.length} application${changes.length === 1 ? ' was' : 's were'} automatically marked Rejected after AI confirmed a final outcome in a matched email. A notification with the supporting quote has been saved.`,
      actionLabel: 'Read email', details: changes.map(({ app, email, outcome }) => ({
        clientName: app.clientName, subject: `${outcome.reason}: ${email.subject || '(No subject)'} — ${outcome.evidence}`, from: email.from, date: email.date
      })), onAction: () => { showView('inbox'); openEmailDetail(changes[0].email.id); } });
  }

  function showApplicationAiReviewNotice(items) {
    if (!items.length) return;
    renderAlerts();
    showActionResult({ title: 'Application email needs review', status: 'info', label: 'APPLICATION REVIEW',
      message: 'AI could not confidently confirm a final outcome. Your application status is unchanged.',
      actionLabel: 'Review email', onAction: () => { showView('inbox'); openEmailDetail(items[0].email.id); },
      details: items.map(({ app, email, analysis }) => ({ clientName: app.clientName,
        subject: `${email.subject || '(No subject)'} — ${analysis.reason}`, from: email.from, date: email.date })) });
  }
