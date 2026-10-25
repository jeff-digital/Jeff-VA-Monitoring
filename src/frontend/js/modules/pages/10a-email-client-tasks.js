  function emailAiWeekRange(now = Date.now()) {
    const day = 86400000, offset = 8 * 3600000;
    const local = new Date(now + offset);
    const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
      - ((local.getUTCDay() + 6) % 7) * day - offset;
    return { start, end: start + 7 * day };
  }

  function isEmailInAiWeek(email, now = Date.now()) {
    const received = Date.parse(email?.date || '');
    const { start, end } = emailAiWeekRange(now);
    return Number.isFinite(received) && received >= start && received < end && received <= now + 300000;
  }

  function emailAiWeekLabel() {
    const range = emailAiWeekRange();
    const format = new Intl.DateTimeFormat(undefined, { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });
    return `${format.format(new Date(range.start))} – ${format.format(new Date(range.end - 1))} (Philippines)`;
  }

  function emailTaskDueDate(analysis) {
    const value = analysis?.dueDate || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !analysis.deadlineEvidence || !(analysis.deadlineConfidence >= .9)) return '';
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : '';
  }

  function emailTaskExisting(email, clientId) {
    return (data.clientTasks || []).find(task => task.clientId === clientId
      && (task.sourceEmailId === email.id || (email.gmailId && task.sourceGmailId === email.gmailId)));
  }

  function clientEmailTaskScanKey(email, clients) {
    const input = JSON.stringify([email.subject || '', email.body || '', Boolean(email.automatedMessage),
      clients.map(client => [client.id, client.activeAt || '', client.role || '']).sort()]);
    // Change detection only: no email content or credentials are sent elsewhere.
    let fingerprint = 2166136261;
    for (let index = 0; index < input.length; index++) {
      fingerprint = Math.imul(fingerprint ^ input.charCodeAt(index), 16777619);
    }
    return `ai-v2:${input.length}:${fingerprint >>> 0}`;
  }

  let clientEmailAiStatus = { userId: '', message: '' };
  let emailAiQueueState = { userId: '', running: false, checked: 0, total: 0, keys: new Set() };
  let automaticEmailQueueRun = null;

  function pendingEmailAiChecks() {
    const checks = [];
    for (const email of data.emails || []) {
      if (!isEmailInAiWeek(email) || isSentEmail(email) || email.automatedMessage
        || (!String(email.body || '').trim() && email.bodyLoaded !== true)) continue;
      const clients = activeClientsMatchingSender(email);
      if (clients.length !== 1) continue;
      const client = clients[0], activeAt = Date.parse(client.activeAt || '');
      if (Number.isFinite(activeAt) && Date.parse(email.date) < activeAt) continue;
      if (email.autoTaskPending || email.autoTaskScanKey !== clientEmailTaskScanKey(email, clients)) checks.push(`task:${email.id}`);
    }
    if (typeof latestApplicationAiEmails === 'function') {
      const latest = latestApplicationAiEmails(data.emails || []);
      for (const app of data.applications || []) {
        const email = latest.get(app.id)?.email;
        if (!email || !applicationAiStillEligible(email, app, data.emails)
          || (!String(email.body || '').trim() && email.bodyLoaded !== true)
          || app.emailClosure?.emailId === (email.gmailId || email.id)) continue;
        if (email.applicationAiProcessedKey !== applicationAiScanKey(email, app) || email.applicationAiAnalysis?.rejectApplication === true) checks.push(`application:${app.id}:${email.id}`);
      }
    }
    return checks;
  }

  function recordEmailAiQueueCheck(email, client, scanKey, application) {
    if (!emailAiQueueState.running || emailAiQueueState.userId !== currentUser?.id) return;
    emailAiQueueState.keys.add(`${application ? 'application' : 'task'}:${client.id}:${email.id}:${scanKey}`);
    emailAiQueueState.checked = emailAiQueueState.keys.size;
    emailAiQueueState.total = Math.max(emailAiQueueState.total, emailAiQueueState.checked);
    renderEmailTaskAiStatus();
  }

  let savedEmailAiTimer = null;
  let savedEmailAiDebounce = null;
  let savedEmailAiRun = null;

  function scheduleSavedEmailAiCheck() {
    if (!currentUser || !dataReady || !supabaseDataLoaded || savedEmailAiRun) return;
    if (savedEmailAiDebounce) clearTimeout(savedEmailAiDebounce);
    savedEmailAiDebounce = setTimeout(() => {
      savedEmailAiDebounce = null;
      runSavedEmailAiChecks().catch(error => console.error('Saved email AI check failed:', error));
    }, 300);
  }

  function startSavedEmailAiChecks() {
    if (!savedEmailAiTimer) savedEmailAiTimer = setInterval(scheduleSavedEmailAiCheck, 15000);
    scheduleSavedEmailAiCheck();
  }

  function stopSavedEmailAiChecks() {
    if (savedEmailAiTimer) clearInterval(savedEmailAiTimer);
    if (savedEmailAiDebounce) clearTimeout(savedEmailAiDebounce);
    savedEmailAiTimer = null;
    savedEmailAiDebounce = null;
  }

  async function runSavedEmailAiChecks() {
    if (savedEmailAiRun) return savedEmailAiRun;
    if (!currentUser || !dataReady || !supabaseDataLoaded || navigator.onLine === false
      || emailAiRetryState()?.until > Date.now() || !pendingEmailAiChecks().length) return;
    const userId = currentUser.id, workspace = data;
    const run = (async () => {
      const { automaticTasks, applicationOutcomes } = await checkAllEmailAiMessages();
      if (currentUser?.id !== userId || data !== workspace) return;
      let linkedTask = false;
      for (const task of automaticTasks.created) {
        const alert = (data.alerts || []).find(item => item.applicationId === task.clientId && item.emailId === task.sourceEmailId);
        if (alert && alert.taskId !== task.id) { alert.taskId = task.id; linkedTask = true; }
      }
      if (linkedTask) await persist();
      if (currentUser?.id !== userId || data !== workspace) return;
      if (automaticTasks.created.length) showAutomaticEmailTasksNotice(automaticTasks.created);
      showEmailAiReviewNotice(automaticTasks.review);
      showApplicationAiReviewNotice(applicationOutcomes.review);
      showApplicationEmailOutcomeNotice(applicationOutcomes.changed);
      if (automaticTasks.failed || applicationOutcomes.failed) showActionResult({ title: 'Email AI update pending', status: 'error',
        message: 'An AI update could not be saved. Saved emails remain available; the independent checker will retry.' });
      if (automaticTasks.created.length || applicationOutcomes.changed.length || linkedTask) renderAll();
    })();
    savedEmailAiRun = run;
    try { return await run; } finally { if (savedEmailAiRun === run) savedEmailAiRun = null; }
  }

  async function checkAllEmailAiMessages() {
    if (automaticEmailQueueRun) return automaticEmailQueueRun;
    const userId = currentUser?.id, workspace = data;
    if (!userId || !dataReady || !supabaseDataLoaded) return { automaticTasks: { created: [], review: [], failed: false },
      applicationOutcomes: { changed: [], review: [], failed: false } };
    const total = pendingEmailAiChecks().length;
    emailAiQueueState = { userId, running: total > 0, checked: 0, total, keys: new Set() };
    renderEmailTaskAiStatus(total ? 'Email AI: checking the purpose of this week’s eligible messages…'
      : 'Email AI: this week’s eligible messages checked.');
    automaticEmailQueueRun = (async () => {
      // Continue the whole queue in one run. Calls remain sequential to avoid
      // flooding the provider; analyzeClientEmail enforces the shared daily cap.
      const budget = { remaining: Infinity };
      let failed = false;
      try {
        const automaticTasks = await createAutomaticEmailTasks(budget);
        if (currentUser?.id !== userId || data !== workspace) return { automaticTasks: { created: [], review: [], failed: false },
          applicationOutcomes: { changed: [], review: [], failed: false } };
        const applicationOutcomes = automaticTasks.failed || emailAiRetryState()?.until > Date.now()
          ? { changed: [], review: [], failed: false } : await applyAiApplicationOutcomes(data.emails, budget);
        failed = automaticTasks.failed || applicationOutcomes.failed;
        return { automaticTasks, applicationOutcomes };
      } finally {
        if (currentUser?.id === userId && data === workspace) {
          emailAiQueueState.running = false;
          const remaining = pendingEmailAiChecks().length;
          emailAiQueueState.total = emailAiQueueState.checked + remaining;
          renderEmailTaskAiStatus(failed ? 'Email AI: updates could not be saved; queued for the next automatic check.'
            : remaining ? `Email AI: ${remaining} eligible messages remain queued. Checks will resume automatically.`
              : 'Email AI: this week’s eligible messages checked.');
        }
      }
    })();
    try { return await automaticEmailQueueRun; }
    finally { automaticEmailQueueRun = null; }
  }
  let emailAiSessionRenewal = null;
  async function renewEmailAiSession(authClient, userId) {
    if (currentUser?.id !== userId) throw new Error('Your signed-in account changed during email analysis.');
    if (emailAiSessionRenewal?.userId === userId) return emailAiSessionRenewal.promise;
    const renewal = { userId };
    renewal.promise = (async () => {
      const { data: auth, error } = await authClient.refreshSession();
      if (currentUser?.id !== userId) throw new Error('Your signed-in account changed during email analysis.');
      if (error || !auth?.session?.access_token) {
        const expired = ['refresh_token_not_found', 'refresh_token_already_used', 'session_not_found', 'invalid_grant'].includes(error?.code);
        const failure = new Error(expired
          ? 'Your dashboard session has expired. Sign in again to resume AI checks. Saved emails remain available.'
          : 'Email tasks: session renewal is temporarily unavailable. Analysis is queued and will retry.');
        failure.retryAfter = 30;
        throw failure;
      }
      if (auth.session.user?.id && auth.session.user.id !== userId) throw new Error('Your signed-in account changed during email analysis.');
      return auth.session;
    })();
    emailAiSessionRenewal = renewal;
    try { return await renewal.promise; }
    finally { if (emailAiSessionRenewal === renewal) emailAiSessionRenewal = null; }
  }

  async function postClientEmailAi(emailId, clientId, userId, application = false) {
    const authClient = requireSupabase().auth;
    const current = await authClient.getSession();
    if (currentUser?.id !== userId) throw new Error('Your signed-in account changed during email analysis.');
    let session = current.data?.session;
    if (current.error || !session?.access_token || (session.expires_at && session.expires_at <= Date.now() / 1000 + 60)) {
      session = await renewEmailAiSession(authClient, userId);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      if (currentUser?.id !== userId || (session.user?.id && session.user.id !== userId)) throw new Error('Your signed-in account changed during email analysis.');
      const response = await fetch('/api/email/classify', {
        method: 'POST', headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
        body: JSON.stringify(application ? { emailId, applicationId: clientId } : { emailId, clientId }), signal: AbortSignal.timeout(25000)
      });
      const result = await response.json().catch(() => ({}));
      if (response.status !== 401) return { response, result };
      if (attempt === 1) {
        const failure = new Error('Email tasks: the renewed session could not be verified. Analysis remains queued and will retry.');
        failure.retryAfter = 30;
        throw failure;
      }
      renderEmailTaskAiStatus('Email tasks: renewing your dashboard session…');
      // The SDK may already have refreshed while this request was in flight.
      const latest = await authClient.getSession();
      session = !latest.error && latest.data?.session?.access_token && latest.data.session.access_token !== session.access_token
        ? latest.data.session : await renewEmailAiSession(authClient, userId);
    }
  }
  function emailAiDailyUsage() {
    const day = new Date().toISOString().slice(0, 10);
    const cloud = data.emailTaskAiUsage;
    let local;
    try { local = JSON.parse(localStorage.getItem(`email-task-ai-usage:${currentUser?.id}`) || 'null'); } catch { /* Use the account snapshot. */ }
    return { day, requests: Math.max(cloud?.day === day ? Number(cloud.requests) || 0 : 0,
      local?.day === day ? Number(local.requests) || 0 : 0) };
  }
  function emailAiRetryState() {
    try { return JSON.parse(localStorage.getItem(`email-task-ai-retry-v3:${currentUser?.id}`) || 'null'); } catch { return null; }
  }
  let emailAiDetailsCloseTimer = null;
  function closeEmailAiStatusDetails() {
    const details = $('#emailAiStatusDetails'), trigger = $('#emailAiStatusTrigger');
    if (details) {
      try { details.hidePopover?.(); } catch { /* Already closed. */ }
      details.hidden = true;
    }
    if (trigger) trigger.ariaExpanded = 'false';
  }
  function openEmailAiStatusDetails() {
    if (!currentUser) return;
    if (emailAiDetailsCloseTimer) clearTimeout(emailAiDetailsCloseTimer);
    const details = $('#emailAiStatusDetails'), trigger = $('#emailAiStatusTrigger');
    if (!details || !trigger) return;
    details.hidden = false;
    // Native popovers escape the inbox's rounded, clipped container. Older
    // browsers can still use the fixed-position details panel.
    try { details.showPopover?.(); } catch { /* Already open. */ }
    trigger.ariaExpanded = 'true';
    const rect = trigger.getBoundingClientRect(), size = details.getBoundingClientRect();
    details.style.left = `${Math.max(16, Math.min(rect.right - size.width, window.innerWidth - size.width - 16))}px`;
    details.style.top = `${Math.max(16, Math.min(rect.bottom + 8, window.innerHeight - size.height - 16))}px`;
  }
  function lastEmailAiCheck() {
    let stored = '';
    try { stored = localStorage.getItem(`email-ai-last-check:${currentUser?.id}`) || ''; } catch { /* Use saved analyses. */ }
    const times = [stored, ...(data.emails || []).flatMap(email => [email.taskAiAnalysis?.analyzedAt, email.applicationAiAnalysis?.analyzedAt])]
      .map(value => Date.parse(value || '')).filter(value => Number.isFinite(value) && value <= Date.now());
    return times.length ? new Date(times.reduce((latest, time) => Math.max(latest, time), 0)).toLocaleString() : 'No successful check yet';
  }
  function renderEmailTaskAiStatus(message) {
    const element = $('#clientEmailAiStatus');
    if (!element) return;
    element.hidden = !currentUser;
    const summary = $('#emailAiStatusSummary');
    if (summary) summary.hidden = !currentUser;
    if (!currentUser) { closeEmailAiStatusDetails(); return; }
    if (summary && summary.dataset.userId !== currentUser.id) {
      closeEmailAiStatusDetails();
      summary.dataset.userId = currentUser.id;
    }
    if (message) clientEmailAiStatus = { userId: currentUser.id, message };
    const retry = emailAiRetryState();
    const fullStatus = retry?.until > Date.now() ? retry.message
      : clientEmailAiStatus.userId === currentUser.id && clientEmailAiStatus.message
        ? clientEmailAiStatus.message : 'Email AI checks this week’s matched applications and active-client messages during sync.';
    const attention = retry?.until > Date.now();
    const offline = navigator.onLine === false;
    const queue = emailAiQueueState.userId === currentUser.id ? emailAiQueueState : null;
    const processing = !offline && !attention && (queue?.running || /checking the purpose|renewing your dashboard/i.test(fullStatus));
    const queued = !attention && /queued/i.test(fullStatus);
    element.textContent = offline ? 'AI offline' : attention ? 'AI needs attention' : processing
      ? queue?.running && queue.total ? `AI checking ${queue.checked}/${queue.total}…` : 'AI checking…' : queued ? 'AI queued'
      : /messages checked/i.test(fullStatus) ? 'AI checked' : 'AI ready';
    element.title = '';
    if (summary) {
      summary.dataset.state = offline ? 'offline' : attention ? 'attention' : processing ? 'processing' : queued ? 'queued' : 'ready';
      summary.title = '';
    }
    const trigger = $('#emailAiStatusTrigger');
    if (trigger) trigger.ariaBusy = String(processing);
    const detailState = $('#emailAiDetailsState'), lastCheck = $('#emailAiLastCheck'), detailUsage = $('#emailAiDetailsUsage');
    if (detailState) detailState.textContent = `${offline ? 'Offline. ' : ''}${queue?.running ? `Checking this week’s queue: ${queue.checked} of ${queue.total} completed. ` : ''}${fullStatus}`;
    const progress = $('#emailAiQueueProgress');
    if (progress) progress.textContent = queue ? `${queue.checked}/${queue.total} this run` : 'No check running';
    if (lastCheck) lastCheck.textContent = lastEmailAiCheck();
    if (detailUsage) detailUsage.textContent = `${emailAiDailyUsage().requests}/40 checks`;
    const week = $('#emailAiWeekScope');
    if (week) week.textContent = emailAiWeekLabel();
    const retryRow = $('#emailAiRetryRow'), retryTime = $('#emailAiRetryTime');
    if (retryRow) retryRow.hidden = !attention;
    if (retryTime) retryTime.textContent = attention ? new Date(retry.until).toLocaleString() : '';
    const usage = $('#emailAiUsage');
    if (usage) {
      usage.textContent = `${emailAiDailyUsage().requests}/40`;
      usage.title = '';
      usage.ariaLabel = `${emailAiDailyUsage().requests} of 40 email checks today · Resets at 8 AM (Philippines)`;
    }
  }

  async function analyzeClientEmail(email, client, scanKey, application = false) {
    if (!isEmailInAiWeek(email)) throw new Error('AI checks emails received this week only (Monday–Sunday, Philippine time).');
    const cached = application ? email.applicationAiAnalysis : email.taskAiAnalysis;
    if (cached?.scanKey === scanKey) { recordEmailAiQueueCheck(email, client, scanKey, application); return cached; }
    const userId = currentUser.id;
    const retry = emailAiRetryState();
    if (retry?.until > Date.now()) throw new Error(retry.message);
    renderEmailTaskAiStatus(application ? 'Email AI: checking the purpose and outcome of application messages…' : 'Email tasks: AI is checking the purpose of client messages…');
    try {
      const usage = emailAiDailyUsage();
      if (usage.requests >= 40) {
        const failure = new Error('Email tasks: daily check limit reached. Remaining messages are queued until 8 AM.');
        failure.retryAfter = Math.ceil((Date.parse(`${usage.day}T00:00:00Z`) + 86400000 - Date.now()) / 1000);
        throw failure;
      }
      const { response, result } = await postClientEmailAi(email.id, client.id, userId, application);
      if (!response.ok) {
        const code = typeof result.code === 'string' && /^[A-Z_]{1,64}$/.test(result.code) ? result.code : '';
        const detail = code ? ` (${code}${Number.isInteger(result.providerCode) ? `/${result.providerCode}` : ''})` : '';
        const failure = new Error((result.error || 'Email tasks: Cloudflare AI is not available yet. Messages remain queued.') + detail);
        failure.retryAfter = result.retryAfter || (response.status === 404 ? 60 : 120);
        throw failure;
      }
      const valid = application ? ['rejected', 'position_closed', 'position_filled', 'position_unavailable', 'application_expired', 'no_change', 'uncertain'].includes(result.outcome)
        && typeof result.rejectApplication === 'boolean' && typeof result.matchesApplication === 'boolean'
        && typeof result.reason === 'string' && typeof result.evidence === 'string'
        && typeof result.confidence === 'number' && Number.isFinite(result.confidence) && result.confidence >= 0 && result.confidence <= 1
        : ['work_task', 'administrative', 'informational', 'personal', 'uncertain'].includes(result.purpose)
        && typeof result.createTask === 'boolean' && typeof result.reason === 'string'
        && typeof result.confidence === 'number' && Number.isFinite(result.confidence)
        && typeof result.evidence === 'string' && typeof result.title === 'string';
      if (!valid) {
        throw new Error('Email tasks: AI returned an unreadable result. Messages remain queued.');
      }
      if (currentUser?.id !== userId) throw new Error('Your signed-in account changed during email analysis.');
      usage.requests++;
      data.emailTaskAiUsage = usage;
      try { localStorage.setItem(`email-task-ai-usage:${userId}`, JSON.stringify(usage)); } catch { /* The next account save retains the usage. */ }
      const analyzedAt = new Date().toISOString();
      try { localStorage.setItem(`email-ai-last-check:${userId}`, analyzedAt); } catch { /* Saved analyses also retain the timestamp. */ }
      recordEmailAiQueueCheck(email, client, scanKey, application);
      return { ...result, scanKey, analyzedAt };
    } catch (error) {
      if (currentUser?.id === userId) {
        const state = { until: Date.now() + Math.max(30, Math.min(86400, Number(error.retryAfter) || 120)) * 1000,
          message: error.message || 'Email tasks: AI is unavailable. Messages remain queued.' };
        try { localStorage.setItem(`email-task-ai-retry-v3:${userId}`, JSON.stringify(state)); } catch { /* Status still displays without storage. */ }
        renderEmailTaskAiStatus(state.message);
      }
      throw error;
    }
  }

  let automaticEmailTaskRun = null;
  async function createAutomaticEmailTasks(budget = { remaining: Infinity }) {
    if (automaticEmailTaskRun) return automaticEmailTaskRun;
    if (!currentUser || !dataReady || !supabaseDataLoaded) return { created: [], failed: false };
    const userId = currentUser.id;
    const workspace = data;
    automaticEmailTaskRun = (async () => {
      const created = [];
      const processed = [];
      const review = [];
      const reviewAlerts = [];
      const initialUsage = workspace.emailTaskAiUsage;
      let waiting = false;
      // Version the scan so saved messages evaluated under older matching rules
      // are checked once again, without recreating tasks on every sync.
      for (const email of [...workspace.emails].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))) {
        if (!isEmailInAiWeek(email)) continue;
        const clients = activeClientsMatchingSender(email);
        if (!email.autoTaskPending && !clients.length) continue;
        if (!String(email.body || '').trim() && email.bodyLoaded !== true) continue;
        const scanKey = clientEmailTaskScanKey(email, clients);
        if (!email.autoTaskPending && email.autoTaskScanKey === scanKey) continue;
        const client = clients.length === 1 ? clients[0] : null;
        const receivedAt = Date.parse(email.date);
        const activeAt = Date.parse(client?.activeAt || '');
        const duringContract = Number.isFinite(receivedAt) && receivedAt <= Date.now() + 300000
          && (!Number.isFinite(activeAt) || receivedAt >= activeAt);
        let analysis = null;
        if (client && duringContract && !isSentEmail(email) && !email.automatedMessage) {
          if (budget.remaining <= 0) { waiting = true; budget.queued = true; continue; }
          try { analysis = await analyzeClientEmail(email, client, scanKey); budget.remaining--; }
          catch { waiting = true; break; }
          if (currentUser?.id !== userId || data !== workspace) return { created: [], review: [], failed: false };
          // Recheck after the network request: the client or message can be edited
          // while AI is working, and that old decision must not create a task.
          const currentClients = activeClientsMatchingSender(email);
          if (!workspace.emails.includes(email) || currentClients.length !== 1
            || !isEmailInAiWeek(email) || currentClients[0].id !== client.id || clientEmailTaskScanKey(email, currentClients) !== scanKey) { waiting = true; continue; }
        }
        const existing = client && emailTaskExisting(email, client.id);
        const evidence = analysis?.evidence || '';
        if (client && analysis?.createTask === true && analysis.purpose === 'work_task'
          && analysis.roleRelated === true && analysis.confidence >= 0.9 && evidence && duringContract && !existing) {
          const now = new Date().toISOString();
          const task = {
            id: `email-task:${encodeURIComponent(client.id)}:${encodeURIComponent(email.gmailId || email.id)}`,
            clientId: client.id, title: analysis.title || String(email.subject || '').replace(/^(?:(?:re|fw|fwd):\s*)+/i, '').trim().slice(0, 160) || evidence.slice(0, 160),
            category: 'Other', priority: 'Medium', dueDate: emailTaskDueDate(analysis), estimateMinutes: '',
            notes: emailContentText(email.body || '').slice(0, 3000),
            repeat: { frequency: 'none', weekdays: [], dayOfMonth: null }, status: 'todo', completedAt: '',
            timeEntries: [], timerStartedAt: '', createdAt: now, updatedAt: now,
            sourceEmailId: email.id, sourceGmailId: email.gmailId || '', sourceEmailSubject: email.subject || '',
            sourceEmailFrom: email.from || '', sourceEmailDate: email.date || '',
            automaticallyCreated: true, requestEvidence: evidence, aiClassification: analysis
          };
          workspace.clientTasks ||= [];
          workspace.clientTasks.push(task);
          created.push(task);
        }
        if (analysis && (analysis.purpose === 'uncertain' || (existing?.automaticallyCreated && !analysis.createTask))) {
          const alert = { id: `email-ai-review:${email.id}:${scanKey}`, type: 'active-client-email-review',
            applicationId: client.id, emailId: email.id, taskId: existing?.id || '',
            clientName: client.clientName, subject: `Review email: ${email.subject || '(No subject)'}`,
            from: email.from, date: new Date().toISOString(), unread: true, reason: analysis.reason };
          if (!workspace.alerts.some(item => item.id === alert.id)) {
            workspace.alerts.unshift(alert);
            reviewAlerts.push(alert);
            review.push({ email, client, reason: analysis.reason });
          }
        }
        processed.push({ email, pending: email.autoTaskPending, processedAt: email.autoTaskProcessedAt,
          scanKey: email.autoTaskScanKey, analysis: email.taskAiAnalysis });
        if (analysis) email.taskAiAnalysis = analysis;
        email.autoTaskPending = false;
        email.autoTaskProcessedAt = new Date().toISOString();
        email.autoTaskScanKey = scanKey;
      }
      if (!processed.length) {
        if (!waiting) renderEmailTaskAiStatus('Email tasks: active-client messages checked.');
        if (workspace.emailTaskAiUsage !== initialUsage && currentUser?.id === userId && data === workspace) await persist();
        return { created, review, failed: false };
      }
      let saved = false;
      try { saved = await persist(); } catch (_) { /* Restore pending work for the independent checker. */ }
      if (!saved) {
        workspace.clientTasks = (workspace.clientTasks || []).filter(task => !created.includes(task));
        workspace.alerts = workspace.alerts.filter(alert => !reviewAlerts.includes(alert));
        processed.forEach(({ email, pending, processedAt, scanKey, analysis }) => {
          if (pending === undefined) delete email.autoTaskPending;
          else email.autoTaskPending = pending;
          if (processedAt === undefined) delete email.autoTaskProcessedAt;
          else email.autoTaskProcessedAt = processedAt;
          if (scanKey === undefined) delete email.autoTaskScanKey;
          else email.autoTaskScanKey = scanKey;
          if (analysis === undefined) delete email.taskAiAnalysis;
          else email.taskAiAnalysis = analysis;
        });
        return { created: [], review: [], failed: true };
      }
      if (currentUser?.id !== userId || data !== workspace) return { created: [], failed: false };
      if (hiredEditingId && created.some(task => task.clientId === hiredEditingId)) renderClientTasks(hiredEditingId);
      if (review.length) renderAlerts();
      renderEmailTaskAiStatus(waiting ? 'Email tasks: remaining messages are queued for the next automatic check.' : 'Email tasks: active-client messages checked.');
      return { created, review, failed: false };
    })();
    try { return await automaticEmailTaskRun; }
    finally { automaticEmailTaskRun = null; }
  }

  function showEmailAiReviewNotice(items) {
    if (!items?.length) return;
    showActionResult({ title: 'Client email needs review', label: 'EMAIL REVIEW', status: 'info',
      message: 'AI could not confidently identify job-related work in these messages. No new task was created. Any existing task is unchanged.',
      actionLabel: 'Review email', onAction: () => { showView('inbox'); openEmailDetail(items[0].email.id); },
      details: items.map(item => ({ clientName: item.client.clientName, subject: `${item.email.subject || '(No subject)'} — ${item.reason}`,
        from: item.email.from, date: item.email.date })) });
  }

  function showAutomaticEmailTasksNotice(tasks) {
    if (!tasks.length) return;
    showActionResult({ title: 'Client tasks created', label: 'EMAIL TO TASK',
      message: `${plural(tasks.length, 'task')} automatically created from active-client work requests. Clear dates from the email are filled in automatically; unclear or missing deadlines stay blank.`,
      actionLabel: 'View tasks', onAction: () => viewEmailClientTask(tasks[0]),
      details: tasks.map(task => ({ clientName: data.applications.find(client => client.id === task.clientId)?.clientName,
        subject: task.title, from: task.sourceEmailFrom, date: task.sourceEmailDate, taskCreated: true })) });
  }

  function viewEmailClientTask(task) {
    const client = data.applications.find(item => item.id === task.clientId);
    if (!client) return;
    showView('hired');
    renderHiredDetail(client);
    selectClientDetailTab('tasks');
  }

  const emailAiSummary = $('#emailAiStatusSummary'), emailAiTrigger = $('#emailAiStatusTrigger'), emailAiDetails = $('#emailAiStatusDetails');
  emailAiSummary?.addEventListener?.('mouseenter', openEmailAiStatusDetails);
  emailAiSummary?.addEventListener?.('focusin', openEmailAiStatusDetails);
  emailAiTrigger?.addEventListener?.('click', openEmailAiStatusDetails);
  emailAiSummary?.addEventListener?.('mouseleave', () => {
    emailAiDetailsCloseTimer = setTimeout(() => {
      if (!emailAiSummary.contains(document.activeElement)) closeEmailAiStatusDetails();
    }, 150);
  });
  emailAiDetails?.addEventListener?.('mouseenter', () => { if (emailAiDetailsCloseTimer) clearTimeout(emailAiDetailsCloseTimer); });
  emailAiSummary?.addEventListener?.('focusout', event => {
    if (!emailAiSummary.contains(event.relatedTarget)) closeEmailAiStatusDetails();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeEmailAiStatusDetails(); });
  document.addEventListener('click', event => {
    if (!emailAiSummary?.contains?.(event.target)) closeEmailAiStatusDetails();
  });
  if (typeof window !== 'undefined') {
    window.addEventListener('online', scheduleSavedEmailAiCheck);
    window.addEventListener('focus', scheduleSavedEmailAiCheck);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSavedEmailAiCheck(); });
    window.addEventListener('resize', closeEmailAiStatusDetails);
    window.addEventListener('scroll', event => { if (event.target !== emailAiDetails) closeEmailAiStatusDetails(); }, true);
  }

  document.addEventListener('click', event => {
    const sourceButton = event.target.closest('[data-task-source-email]');
    if (!sourceButton) return;
    const task = data.clientTasks.find(item => item.id === sourceButton.dataset.taskSourceEmail);
    const email = task && data.emails.find(item => item.id === task.sourceEmailId || (task.sourceGmailId && item.gmailId === task.sourceGmailId));
    if (email) openEmailDetail(email.id);
    else showActionResult({ title: 'Email unavailable', message: `The original email is no longer in the saved inbox. ${task?.sourceEmailFrom || ''} · ${task?.sourceEmailSubject || ''}`, status: 'info' });
  });
