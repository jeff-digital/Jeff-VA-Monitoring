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
  function renderEmailTaskAiStatus(message) {
    const element = $('#clientEmailAiStatus');
    if (!element) return;
    element.hidden = !currentUser;
    const summary = $('#emailAiStatusSummary');
    if (summary) summary.hidden = !currentUser;
    if (!currentUser) return;
    if (message) clientEmailAiStatus = { userId: currentUser.id, message };
    const retry = emailAiRetryState();
    const fullStatus = retry?.until > Date.now() ? retry.message
      : clientEmailAiStatus.userId === currentUser.id && clientEmailAiStatus.message
        ? clientEmailAiStatus.message : 'Email AI checks matched applications and active-client messages during sync.';
    const attention = retry?.until > Date.now();
    const processing = !attention && /checking the purpose|renewing your dashboard/i.test(fullStatus);
    const queued = !attention && /queued/i.test(fullStatus);
    element.textContent = attention ? fullStatus : processing ? 'AI checking…' : queued ? 'AI queued'
      : /messages checked/i.test(fullStatus) ? 'AI checked' : 'AI ready';
    element.title = fullStatus;
    if (summary) {
      summary.dataset.state = attention ? 'attention' : processing ? 'processing' : queued ? 'queued' : 'ready';
      summary.title = fullStatus;
    }
    const usage = $('#emailAiUsage');
    if (usage) {
      usage.textContent = `${emailAiDailyUsage().requests}/40`;
      usage.title = `${emailAiDailyUsage().requests} of 40 email checks today · Resets at 8 AM (Philippines)`;
      usage.ariaLabel = usage.title;
    }
    const accountStatus = $('#accountEmailAiStatus');
    const accountDetails = $('#accountEmailAiDetails');
    if (accountStatus) accountStatus.textContent = navigator.onLine === false ? 'Offline'
      : attention ? 'Needs attention' : processing ? 'Checking messages' : queued ? 'Checks queued'
        : /messages checked/i.test(fullStatus) ? 'Messages checked' : 'Waiting for next check';
    if (accountDetails) accountDetails.textContent = `${navigator.onLine === false ? 'Waiting for an internet connection. ' : ''}${fullStatus} · ${emailAiDailyUsage().requests}/40 checks today (resets 8 AM, Philippines). Shared by application outcomes and active-client tasks.`;
  }

  async function analyzeClientEmail(email, client, scanKey, application = false) {
    const cached = application ? email.applicationAiAnalysis : email.taskAiAnalysis;
    if (cached?.scanKey === scanKey) return cached;
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
      return { ...result, scanKey, analyzedAt: new Date().toISOString() };
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
  async function createAutomaticEmailTasks(budget = { remaining: 3 }) {
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
      let analyses = 0;
      let waiting = false;
      // Version the scan so saved messages evaluated under older matching rules
      // are checked once again, without recreating tasks on every sync.
      for (const email of [...workspace.emails].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))) {
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
          if (analyses >= 3 || budget.remaining <= 0) { waiting = true; budget.queued = true; continue; }
          try { analysis = await analyzeClientEmail(email, client, scanKey); analyses++; budget.remaining--; }
          catch { waiting = true; break; }
          if (currentUser?.id !== userId || data !== workspace) return { created: [], review: [], failed: false };
          // Recheck after the network request: the client or message can be edited
          // while AI is working, and that old decision must not create a task.
          const currentClients = activeClientsMatchingSender(email);
          if (!workspace.emails.includes(email) || currentClients.length !== 1
            || currentClients[0].id !== client.id || clientEmailTaskScanKey(email, currentClients) !== scanKey) { waiting = true; continue; }
        }
        const existing = client && emailTaskExisting(email, client.id);
        const evidence = analysis?.evidence || '';
        if (client && analysis?.createTask === true && analysis.purpose === 'work_task'
          && analysis.roleRelated === true && analysis.confidence >= 0.9 && evidence && duringContract && !existing) {
          const now = new Date().toISOString();
          const task = {
            id: `email-task:${encodeURIComponent(client.id)}:${encodeURIComponent(email.gmailId || email.id)}`,
            clientId: client.id, title: analysis.title || String(email.subject || '').replace(/^(?:(?:re|fw|fwd):\s*)+/i, '').trim().slice(0, 160) || evidence.slice(0, 160),
            category: 'Other', priority: 'Medium', dueDate: '', estimateMinutes: '',
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
      try { saved = await persist(); } catch (_) { /* Restore the pending work for the next sync. */ }
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
      renderEmailTaskAiStatus(waiting ? 'Email tasks: remaining messages are queued for the next sync.' : 'Email tasks: active-client messages checked.');
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
      message: `${plural(tasks.length, 'task')} automatically created from active-client work requests. Review the tasks to set any deadline or estimate.`,
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

  document.addEventListener('click', event => {
    const sourceButton = event.target.closest('[data-task-source-email]');
    if (!sourceButton) return;
    const task = data.clientTasks.find(item => item.id === sourceButton.dataset.taskSourceEmail);
    const email = task && data.emails.find(item => item.id === task.sourceEmailId || (task.sourceGmailId && item.gmailId === task.sourceGmailId));
    if (email) openEmailDetail(email.id);
    else showActionResult({ title: 'Email unavailable', message: `The original email is no longer in the saved inbox. ${task?.sourceEmailFrom || ''} · ${task?.sourceEmailSubject || ''}`, status: 'info' });
  });
