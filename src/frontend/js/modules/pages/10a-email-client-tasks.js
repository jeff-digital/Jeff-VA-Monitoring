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
  function emailAiDailyUsage() {
    const day = new Date().toISOString().slice(0, 10);
    const cloud = data.emailTaskAiUsage;
    let local;
    try { local = JSON.parse(localStorage.getItem(`email-task-ai-usage:${currentUser?.id}`) || 'null'); } catch { /* Use the account snapshot. */ }
    return { day, requests: Math.max(cloud?.day === day ? Number(cloud.requests) || 0 : 0,
      local?.day === day ? Number(local.requests) || 0 : 0) };
  }
  function emailAiRetryState() {
    try { return JSON.parse(localStorage.getItem(`email-task-ai-retry-v2:${currentUser?.id}`) || 'null'); } catch { return null; }
  }
  function renderEmailTaskAiStatus(message) {
    const element = $('#clientEmailAiStatus');
    if (!element) return;
    element.hidden = !currentUser;
    if (!currentUser) return;
    if (message) clientEmailAiStatus = { userId: currentUser.id, message };
    const retry = emailAiRetryState();
    element.textContent = retry?.until > Date.now() ? retry.message
      : clientEmailAiStatus.userId === currentUser.id && clientEmailAiStatus.message
        ? clientEmailAiStatus.message : 'Email tasks: AI checks active-client messages during sync.';
    element.textContent += ` · ${emailAiDailyUsage().requests}/40 checks today (resets 8 AM)`;
  }

  async function analyzeClientEmail(email, client, scanKey) {
    if (email.taskAiAnalysis?.scanKey === scanKey) return email.taskAiAnalysis;
    const userId = currentUser.id;
    const retry = emailAiRetryState();
    if (retry?.until > Date.now()) throw new Error(retry.message);
    renderEmailTaskAiStatus('Email tasks: AI is checking the purpose of client messages…');
    try {
      const { data: auth, error } = await requireSupabase().auth.getSession();
      if (error || !auth?.session?.access_token || currentUser?.id !== userId) throw new Error('Email tasks: waiting for your signed-in session.');
      const usage = emailAiDailyUsage();
      if (usage.requests >= 40) {
        const failure = new Error('Email tasks: daily check limit reached. Remaining messages are queued until 8 AM.');
        failure.retryAfter = Math.ceil((Date.parse(`${usage.day}T00:00:00Z`) + 86400000 - Date.now()) / 1000);
        throw failure;
      }
      const response = await fetch('/api/email/classify', {
        method: 'POST', headers: { authorization: `Bearer ${auth.session.access_token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ emailId: email.id, clientId: client.id }), signal: AbortSignal.timeout(25000)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = typeof result.code === 'string' && /^[A-Z_]{1,64}$/.test(result.code) ? result.code : '';
        const detail = code ? ` (${code}${Number.isInteger(result.providerCode) ? `/${result.providerCode}` : ''})` : '';
        const failure = new Error((result.error || 'Email tasks: Cloudflare AI is not available yet. Messages remain queued.') + detail);
        failure.retryAfter = result.retryAfter || (response.status === 404 ? 60 : 120);
        throw failure;
      }
      if (!['work_task', 'administrative', 'informational', 'personal', 'uncertain'].includes(result.purpose)
        || typeof result.createTask !== 'boolean' || typeof result.reason !== 'string'
        || typeof result.confidence !== 'number' || !Number.isFinite(result.confidence)
        || typeof result.evidence !== 'string' || typeof result.title !== 'string') {
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
        try { localStorage.setItem(`email-task-ai-retry-v2:${userId}`, JSON.stringify(state)); } catch { /* Status still displays without storage. */ }
        renderEmailTaskAiStatus(state.message);
      }
      throw error;
    }
  }

  let automaticEmailTaskRun = null;
  async function createAutomaticEmailTasks() {
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
          if (analyses >= 3) { waiting = true; continue; }
          try { analysis = await analyzeClientEmail(email, client, scanKey); analyses++; }
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

  function openEmailTaskComposer(emailId) {
    const email = data.emails.find(item => item.id === emailId);
    const clients = activeClientsForTaskEmail(email);
    if (!clients.length) return;
    const form = $('#emailTaskForm');
    form.reset();
    form.dataset.emailId = email.id;
    form.dataset.userId = currentUser.id;
    $('#emailTaskClient').innerHTML = (clients.length > 1 ? '<option value="">Choose the client</option>' : '')
      + clients.map(client => `<option value="${escapeHtml(client.id)}">${escapeHtml([client.contact, client.clientName].filter(Boolean).join(' | '))}</option>`).join('');
    $('#emailTaskName').value = String(email.subject || '').replace(/^(?:(?:re|fw|fwd):\s*)+/i, '').slice(0, 160);
    $('#emailTaskNotes').value = emailContentText(email.body || email.snippet || '').slice(0, 3000);
    $('#emailTaskSource').textContent = `${email.from} · ${email.subject || '(No subject)'}`;
    $('#emailTaskError').textContent = '';
    $('#saveEmailTask').disabled = false;
    $('#emailDetailModal').close();
    $('#emailTaskModal').showModal();
    $('#emailTaskName').focus();
  }

  async function submitEmailTask(event) {
    event.preventDefault();
    const form = $('#emailTaskForm');
    const button = $('#saveEmailTask');
    if (button.disabled || !form.reportValidity()) return;
    const email = data.emails.find(item => item.id === form.dataset.emailId);
    const clientId = $('#emailTaskClient').value;
    const error = $('#emailTaskError');
    error.textContent = '';
    if (!currentUser || currentUser.id !== form.dataset.userId
      || !activeClientsForTaskEmail(email).some(client => client.id === clientId)) {
      error.textContent = 'This email must match a currently active client. Reopen the email and try again.';
      return;
    }
    const existing = emailTaskExisting(email, clientId);
    if (existing) {
      $('#emailTaskModal').close();
      showActionResult({ title: 'Task already exists', message: 'This email already has a task for this client.', status: 'info',
        actionLabel: 'View task', onAction: () => viewEmailClientTask(existing) });
      return;
    }
    const title = $('#emailTaskName').value.trim();
    if (!title) { error.textContent = 'Enter a task title.'; return; }
    const now = new Date().toISOString();
    const task = {
      id: uid(), clientId, title, category: $('#emailTaskCategory').value,
      priority: $('#emailTaskPriority').value, dueDate: $('#emailTaskDueDate').value,
      estimateMinutes: $('#emailTaskEstimate').value === '' ? '' : Number($('#emailTaskEstimate').value),
      notes: $('#emailTaskNotes').value.trim(), repeat: { frequency: 'none', weekdays: [], dayOfMonth: null },
      status: 'todo', completedAt: '', timeEntries: [], timerStartedAt: '', createdAt: now, updatedAt: now,
      sourceEmailId: email.id, sourceGmailId: email.gmailId || '', sourceEmailSubject: email.subject || '',
      sourceEmailFrom: email.from || '', sourceEmailDate: email.date || ''
    };
    const userId = currentUser.id;
    button.disabled = true;
    button.textContent = 'Saving…';
    // Prevent dismissal while persistence is pending, so the same email cannot be submitted twice.
    $('#cancelEmailTask').disabled = true;
    data.clientTasks ||= [];
    data.clientTasks.push(task);
    try {
      if (!await persist()) throw new Error('The task could not be saved. Please try again.');
      if (currentUser?.id !== userId) return;
      $('#emailTaskModal').close();
      if (hiredEditingId === clientId) renderClientTasks(clientId);
      renderAlerts();
      showActionResult({ title: 'Task created', message: 'Saved to the active client’s tasks with a link to the email.',
        actionLabel: 'View task', onAction: () => viewEmailClientTask(task) });
    } catch (failure) {
      if (currentUser?.id !== userId) return;
      data.clientTasks = data.clientTasks.filter(item => item !== task);
      error.textContent = failure.message || 'The task could not be saved. Please try again.';
    } finally {
      button.disabled = false;
      button.textContent = 'Create task';
      $('#cancelEmailTask').disabled = false;
    }
  }

  $('#emailTaskForm').addEventListener('submit', submitEmailTask);
  $('#cancelEmailTask').addEventListener('click', () => $('#emailTaskModal').close());
  $('#emailTaskModal').addEventListener('cancel', event => {
    if ($('#saveEmailTask').disabled) event.preventDefault();
  });
  $('#emailDetailTaskButton').addEventListener('click', event => openEmailTaskComposer(event.currentTarget.dataset.emailId));
  document.addEventListener('click', event => {
    const sourceButton = event.target.closest('[data-task-source-email]');
    if (!sourceButton) return;
    const task = data.clientTasks.find(item => item.id === sourceButton.dataset.taskSourceEmail);
    const email = task && data.emails.find(item => item.id === task.sourceEmailId || (task.sourceGmailId && item.gmailId === task.sourceGmailId));
    if (email) openEmailDetail(email.id);
    else showActionResult({ title: 'Email unavailable', message: `The original email is no longer in the saved inbox. ${task?.sourceEmailFrom || ''} · ${task?.sourceEmailSubject || ''}`, status: 'info' });
  });
