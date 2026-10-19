  // Only explicit, unambiguous outcomes may change an application's status.
  // This is a conservative text classifier, not an AI verdict on every email.
  function currentEmailOutcomeText(email) {
    let body = String(email.body || '');
    if (/<[a-z][\s\S]*>/i.test(body)) {
      const document = new DOMParser().parseFromString(body, 'text/html');
      document.querySelectorAll('blockquote, .gmail_quote, .yahoo_quoted').forEach(node => node.remove());
      const reply = document.querySelector('#divRplyFwdMsg');
      if (reply) {
        while (reply.nextSibling) reply.nextSibling.remove();
        reply.remove();
      }
      body = emailContentText(document.body.innerHTML);
    }
    body = body.split(/\n\s*(?:On [^\n]{0,200}wrote:|[-_]{2,}\s*(?:Original|Forwarded) message|Begin forwarded message:|From:\s*[^\n]+\nSent:)/i)[0];
    body = body.split('\n').filter(line => !/^\s*>/.test(line)).join('\n');
    // Reply/forward subjects can describe a previous outcome rather than the
    // newly authored message. Require the reply body to state its own outcome.
    const subject = /^(?:re|fw|fwd):/i.test(String(email.subject || '').trim())
      ? '' : String(email.subject || '');
    return { subject, body };
  }

  function detectApplicationEmailOutcome(email) {
    if (isSentEmail(email)) return null;
    const text = currentEmailOutcomeText(email);
    const normalize = value => value.normalize('NFKC').replace(/[\u2018\u2019]/g, "'").replace(/[ \t]+/g, ' ').trim();
    const body = normalize(text.body);
    // A new invitation or reopened role takes precedence over a stale subject.
    if (/\b(?:we|i) (?:would like to|want to|will|are pleased to|are happy to) (?:invite|offer|move forward|proceed)\b/i.test(body)
      || /\byou (?:have been|are|were) (?:selected|successful|hired)\b/i.test(body)
      || /\b(?:position|role|vacancy|job) (?:is |remains |has been )?(?:still open|not (?:yet )?(?:filled|closed)|reopened)\b/i.test(body)) return null;
    const rules = [
      ['Not selected', /\b(?:we|i|our team) (?:have |has )?(?:decided |chosen )?not to (?:move forward|proceed|continue|progress)\b[^.!?\n]{0,80}\b(?:you|your|application|candidacy)\b/i],
      ['Not selected', /\b(?:we|i|our team) (?:will not|won't|cannot|can't|are unable to|will no longer|are no longer|are not|is not) (?:be )?(?:moving forward|move forward|proceed(?:ing)?|continu(?:e|ing)|progress(?:ing)?)\b[^.!?\n]{0,80}\b(?:you|your|application|candidacy)\b/i],
      ['Not selected', /\bwe (?:will not|won't) (?:be )?(?:taking|progressing) your (?:application|candidacy) (?:any )?further\b/i],
      ['Not selected', /\bwe (?:are unable to|cannot|can't) offer you (?:the|this|a) (?:role|position|job)\b/i],
      ['Not selected', /\byour (?:application|candidacy)\b[^.!?\n]{0,55}\b(?:was unsuccessful|is unsuccessful|has been unsuccessful|was not successful|has not been successful|has been rejected|was rejected|has been declined|was declined|will not (?:be progressing|proceed|progress)|is no longer (?:being )?(?:under consideration|considered))\b/i],
      ['Not selected', /\byou (?:(?:have not been|were not|weren't) (?:selected|shortlisted)|were unsuccessful|have been unsuccessful)\b/i],
      ['Not selected', /\b(?:we have|we've) (?:decided|chosen) to (?:move forward|proceed) with (?:another|other|a different) candidate[s]?\b/i],
      ['Not selected', /\b(?:we|i) (?:will be|are|am) (?:moving forward|proceeding) with (?:another|other|a different) candidate[s]?\b/i],
      ['Not selected', /\b(?:we have|we've) (?:selected|chosen|hired) (?:another|a different) candidate\b/i],
      ['Position filled', /\b(?:we have|we've) (?:now |already )?filled (?:the|this|our) (?:role|position|vacancy)\b/i],
      ['Position filled', /\b(?:the |this |our )?(?:position|role|vacancy|job opening) (?:has (?:now |already )?been|is|was) (?:now |already |successfully )?filled\b/i],
      ['Position filled', /^(?:the |this |our )?(?:position|role|vacancy|job opening) (?:already )?filled$/i],
      ['Position closed', /\b(?:the |this |our )?(?:position|role|vacancy|job opening) (?:has (?:now )?been|is|was) (?:now |permanently )?(?:closed|cancelled|canceled)\b/i],
      ['Position closed', /^(?:the |this |our )?(?:position|role|vacancy|job opening) (?:closed|cancelled|canceled)$/i],
      ['Position unavailable', /\b(?:the |this |our )?(?:position|role|vacancy|job opening) (?:is |will be )?no longer (?:available|open)\b/i],
      ['Application closed', /\byour application (?:has (?:now )?been|is|was) (?:now )?closed\b/i],
      ['Application expired', /\byour application (?:has (?:now )?expired|is (?:now )?expired)\b/i]
    ];
    // Evaluate sentences separately so conditional examples don't cause changes.
    for (const sentence of `${normalize(text.subject)}\n${body}`.split(/[.!?\n]+/)) {
      if (/\b(?:if|unless|might|may|could|whether|in case|not sure|not true|incorrect|mistake)\b/i.test(sentence)
        || /\b(?:another|different|previous|other|former) (?:role|position|vacancy)\b/i.test(sentence)
        || /\b(?:not yet (?:been )?(?:selected|shortlisted)|(?:selected|shortlisted) yet)\b/i.test(sentence)) continue;
      for (const [reason, pattern] of rules) {
        if (pattern.test(sentence)) return { reason, evidence: sentence.trim().slice(0, 300) };
      }
    }
    return null;
  }

  async function applyApplicationEmailOutcomes(emails) {
    const candidates = new Map();
    for (const email of emails) {
      if (isSentEmail(email)) continue;
      const matches = matchApplicationsForEmail(email);
      if (matches.length !== 1) continue;
      const app = matches[0];
      if (!['Applied', 'Ongoing', 'To Proceed', 'To Proceeding', 'Interview'].includes(app.status)) continue;
      const emailId = email.gmailId || email.id;
      if (!emailId || app.emailClosure?.emailId === emailId) continue;
      const emailTime = Date.parse(email.date);
      const appliedTime = Date.parse(app.appliedDate || '');
      const lastChanged = Date.parse(app.updatedAt || app.createdAt || app.appliedDate || '');
      if (!Number.isFinite(emailTime) || !Number.isFinite(appliedTime)
        || emailTime < appliedTime || (Number.isFinite(lastChanged) && emailTime < lastChanged)
        || emailTime > Date.now() + 300000) continue;
      const previous = candidates.get(app.id);
      if (!previous || emailTime > Date.parse(previous.email.date)) candidates.set(app.id, { app, email });
    }
    const changed = [];
    for (const { app, email } of candidates.values()) {
      const outcome = detectApplicationEmailOutcome(email);
      if (!outcome) continue;
      const emailId = email.gmailId || email.id;
      const alertId = `application-email-closed|${app.id}|${emailId}`;
      if ((data.alerts || []).some(alert => alert.id === alertId)) continue;
      const previous = { status: app.status, updatedAt: app.updatedAt, emailClosure: app.emailClosure, interviewPriority: app.interviewPriority };
      const now = new Date().toISOString();
      app.status = 'Not selected';
      app.updatedAt = now;
      app.interviewPriority = false;
      app.emailClosure = { emailId, emailRecordId: email.id, reason: outcome.reason, evidence: outcome.evidence,
        previousStatus: previous.status, receivedAt: email.date, processedAt: now };
      data.alerts = data.alerts || [];
      data.alerts.unshift({ id: alertId, type: 'application-email-closed', applicationId: app.id,
        emailId: email.id, clientName: app.clientName, from: email.from, date: now, unread: true,
        subject: `${outcome.reason} — marked Rejected: ${app.role || app.clientName}`,
        evidence: outcome.evidence, emailSubject: email.subject || '(No subject)' });
      changed.push({ app, email, outcome, previous, alertId });
    }
    if (!changed.length) return [];
    const saved = await persist();
    if (!saved) {
      for (const change of changed) {
        if (change.app.emailClosure?.emailId === (change.email.gmailId || change.email.id)) Object.assign(change.app, change.previous);
      }
      const failedIds = new Set(changed.map(change => change.alertId));
      data.alerts = data.alerts.filter(alert => !failedIds.has(alert.id));
      return [];
    }
    return changed;
  }

  function showApplicationEmailOutcomeNotice(changes) {
    if (!changes.length) return;
    renderAll();
    const live = $('#notificationLive');
    if (live) live.textContent = `${changes.length} application${changes.length === 1 ? ' was' : 's were'} marked Rejected after a closure email. Check notifications for details.`;
    showActionResult({ title: 'Application closed', status: 'info', label: 'APPLICATION UPDATE',
      message: `${changes.length} application${changes.length === 1 ? ' was' : 's were'} automatically marked Rejected based on a matched incoming email. A notification has been saved.`,
      actionLabel: 'Read email', details: changes.map(({ app, email, outcome }) => ({
        clientName: app.clientName, subject: `${outcome.reason}: ${email.subject || '(No subject)'}`, from: email.from, date: email.date
      })), onAction: () => { showView('inbox'); openEmailDetail(changes[0].email.id); } });
  }
