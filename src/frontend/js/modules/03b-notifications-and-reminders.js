  const generatedNotificationTypes = new Set([
    'task-due-today', 'task-overdue', 'client-task-due-today', 'client-task-overdue',
    'contract-ending-30', 'contract-ending-14', 'contract-ending-7', 'contract-ended',
    'wallet-payment-due-soon', 'wallet-payment-due-today', 'wallet-payment-overdue',
    'subscription-due-soon', 'subscription-due-today', 'subscription-expired'
  ]);
  let notificationFilter = 'all';
  let notificationReturnFocus = null;
  let notificationRefreshTimer = null;

  function isGeneratedNotification(alert) {
    return generatedNotificationTypes.has(alert.type);
  }

  function notificationDeletionKey(alert) {
    const id = String(alert.id || '');
    const parts = id.split('|');
    if (/^(?:task-|client-task-|wallet-payment-|subscription-)/.test(parts[0])) return 'reminder|' + parts.slice(1).join('|');
    if (/^contract-(?:ending-\d+|ended)$/.test(parts[0])) return 'contract|' + parts.slice(1).join('|');
    return id;
  }

  function rememberClearedNotifications(alerts) {
    const keys = new Set(data.clearedNotificationKeys || []);
    for (const alert of alerts) { const key = notificationDeletionKey(alert); if (key) keys.add(key); }
    data.clearedNotificationKeys = [...keys];
  }

  function isNotificationCleared(alert) {
    return (data.clearedNotificationKeys || []).includes(notificationDeletionKey(alert));
  }

  function limitAlertHistory() {
    rememberClearedNotifications((data.alerts || []).filter(alert => alert.dismissedAt));
    const alerts = (Array.isArray(data.alerts) ? data.alerts : []).filter(alert => !isNotificationCleared(alert));
    const generated = alerts.filter(isGeneratedNotification);
    const history = alerts.filter(alert => !isGeneratedNotification(alert)).slice(0, Math.max(0, 30 - generated.length));
    data.alerts = [...generated, ...history];
  }

  function notificationDate(date) {
    return new Date(`${date}T12:00:00`).toISOString();
  }

  function notificationRelativeTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value || 'No date';
    const day = dateKey(date);
    const currentDay = today();
    const dayOffset = Math.round((new Date(`${day}T12:00:00`) - new Date(`${currentDay}T12:00:00`)) / 86400000);
    if (dayOffset === 0) return 'Today';
    if (dayOffset === 1) return 'Tomorrow';
    if (dayOffset === -1) return 'Yesterday';
    return dayOffset > 0 ? `In ${dayOffset} days` : `${Math.abs(dayOffset)} days ago`;
  }

  function refreshGeneratedNotifications() {
    if (!dataReady || !supabaseDataLoaded) return false;
    data.alerts = Array.isArray(data.alerts) ? data.alerts : [];
    const previousDeletedCount = (data.clearedNotificationKeys || []).length;
    rememberClearedNotifications(data.alerts.filter(alert => alert.dismissedAt));
    const existingById = new Map(data.alerts.map(alert => [alert.id, alert]));
    const generated = new Map();
    const add = alert => {
      if (isNotificationCleared(alert)) return;
      const previous = existingById.get(alert.id);
      const wasContractEmailUpdated = alert.type === 'contract-ended' && previous?.emailSent !== undefined;
      generated.set(alert.id, {
        ...alert,
        unread: previous ? Boolean(previous.unread) : true,
        dismissedAt: previous?.dismissedAt || '',
        snoozedUntil: previous?.snoozedUntil || '',
        ...(wasContractEmailUpdated ? {
          emailSent: previous.emailSent,
          subject: previous.subject,
          from: previous.from
        } : {})
      });
    };
    const addTaskAlert = (task, { type, entityType, date, clientName = '' }) => {
      const title = task.title || 'Untitled task';
      add({
        id: `${type}|${entityType}:${task.id}|${date}`,
        type,
        taskId: task.id,
        taskDate: date,
        clientId: entityType === 'client-task' ? task.clientId : task.relatedType === 'client' ? task.relatedId : '',
        applicationId: entityType === 'client-task' ? task.clientId : task.relatedType === 'client' ? task.relatedId : '',
        clientName: clientName || task.relatedName || (entityType === 'client-task' ? 'Client task' : 'Task'),
        subject: `${type.endsWith('overdue') ? 'Overdue' : 'Due today'}: ${title}`,
        from: 'Jeff VA reminder',
        date: notificationDate(date),
        urgency: type.endsWith('overdue') ? 'overdue' : 'due-today'
      });
    };
    const todayDate = today();
    (data.dailyTasks || []).forEach(task => {
      if (!task.id || task.completedAt || task.status === 'done' || !task.taskDate) return;
      if (task.taskDate === todayDate) addTaskAlert(task, { type: 'task-due-today', entityType: 'daily-task', date: task.taskDate });
      else if (task.taskDate < todayDate) addTaskAlert(task, { type: 'task-overdue', entityType: 'daily-task', date: task.taskDate });
    });
    (data.clientTasks || []).forEach(task => {
      if (!task.id || task.status === 'done' || task.completedAt || !task.dueDate) return;
      const client = (data.applications || []).find(item => item.id === task.clientId);
      const type = task.dueDate === todayDate ? 'client-task-due-today' : task.dueDate < todayDate ? 'client-task-overdue' : '';
      if (type) addTaskAlert(task, { type, entityType: 'client-task', date: task.dueDate, clientName: client?.clientName || 'Client task' });
    });
    (data.walletEntries || []).forEach(entry => {
      if (!entry.id || entry.type !== 'payable' || !entry.date) return;
      const deadline = dateKey(entry.date);
      if (!deadline) return;
      const daysLeft = Math.round((new Date(`${deadline}T12:00:00`) - new Date(`${todayDate}T12:00:00`)) / 86400000);
      if (daysLeft > 3) return;
      const type = daysLeft < 0 ? 'wallet-payment-overdue' : daysLeft === 0 ? 'wallet-payment-due-today' : 'wallet-payment-due-soon';
      const timing = daysLeft < 0 ? 'overdue' : daysLeft === 0 ? 'due today' : `due in ${plural(daysLeft, 'day')}`;
      add({
        id: `${type}|wallet-entry:${entry.id}|${deadline}`,
        type,
        walletEntryId: entry.id,
        clientName: entry.payee || 'Upcoming payment',
        subject: `Payment ${timing}: ${entry.description || 'Untitled payment'}`,
        from: 'Wallet reminder',
        date: notificationDate(deadline),
        paymentDeadline: deadline,
        urgency: daysLeft < 0 ? 'overdue' : daysLeft === 0 ? 'due-today' : 'ending-soon'
      });
    });
    (data.subscriptions || []).forEach(item => {
      if (!item?.id || item.tracking === 'cancelled') return;
      const expiry = subscriptionDateValue(item.expiryDate);
      const daysLeft = Math.round((expiry - subscriptionDateValue(subscriptionToday())) / 86400000);
      if (!Number.isFinite(daysLeft) || daysLeft > 7) return;
      const type = daysLeft < 0 ? 'subscription-expired' : daysLeft === 0 ? 'subscription-due-today' : 'subscription-due-soon';
      add({ id: `${type}|subscription:${item.id}|${item.expiryDate}`, type, subscriptionId: item.id,
        clientName: item.name || 'Paid account',
        subject: `${item.name || 'Subscription'}: ${daysLeft < 0 ? 'expired' : daysLeft === 0 ? 'expires today' : `expires in ${plural(daysLeft, 'day')}`}`,
        from: 'Subscription reminder', date: notificationDate(item.expiryDate),
        urgency: daysLeft < 0 ? 'overdue' : daysLeft === 0 ? 'due-today' : 'ending-soon' });
    });
    (data.applications || []).forEach(item => {
      if (!item.id || item.status !== 'Active client') return;
      const endDate = dateKey(item.contractEndDate);
      const explicitlyEnded = String(item.contractStatus || '').trim().toLowerCase() === 'contract ended';
      if (explicitlyEnded || endDate && endDate < todayDate) {
        const endedDate = endDate || dateKey(item.updatedAt || item.activeAt || item.createdAt) || todayDate;
        add({
          id: `contract-ended|${item.id}|${endedDate}`,
          type: 'contract-ended',
          applicationId: item.id,
          clientName: item.clientName || 'Client',
          subject: 'Contract ended',
          from: 'Jeff VA reminder',
          date: notificationDate(endedDate),
          contractEndDate: endedDate,
          urgency: 'ended'
        });
        return;
      }
      if (!endDate || String(item.contractStatus || 'Active').trim().toLowerCase() !== 'active') return;
      const daysLeft = Math.round((new Date(`${endDate}T12:00:00`) - new Date(`${todayDate}T12:00:00`)) / 86400000);
      if (daysLeft < 0 || daysLeft > 30) return;
      const threshold = daysLeft <= 7 ? 7 : daysLeft <= 14 ? 14 : 30;
      add({
        id: `contract-ending-${threshold}|${item.id}|${endDate}`,
        type: `contract-ending-${threshold}`,
        applicationId: item.id,
        clientName: item.clientName || 'Client',
        subject: daysLeft ? `Contract ending in ${plural(daysLeft, 'day')}` : 'Contract ends today',
        from: 'Jeff VA reminder',
        date: notificationDate(endDate),
        contractEndDate: endDate,
        urgency: 'ending-soon'
      });
    });

    const existingGenerated = data.alerts.filter(isGeneratedNotification);
    const previousGeneratedIds = new Set(existingGenerated.map(alert => alert.id));
    const generatedIds = new Set(generated.keys());
    const urgentNewCount = [...generated.values()].filter(alert =>
      !previousGeneratedIds.has(alert.id) && ['task-overdue', 'task-due-today', 'client-task-overdue', 'client-task-due-today', 'contract-ending-7', 'contract-ended', 'wallet-payment-overdue', 'wallet-payment-due-today'].includes(alert.type)
    ).length;
    const changed = previousDeletedCount !== data.clearedNotificationKeys.length || data.alerts.some(isNotificationCleared) || previousGeneratedIds.size !== generatedIds.size
      || [...previousGeneratedIds].some(id => !generatedIds.has(id))
      || [...generatedIds].some(id => !previousGeneratedIds.has(id))
      || [...generated.values()].some(alert => {
        const existing = existingById.get(alert.id);
        return !existing || Object.keys(alert).some(key => existing[key] !== alert[key]);
      });
    const retainedAlerts = data.alerts.filter(alert => !isGeneratedNotification(alert) && !isNotificationCleared(alert));
    data.alerts = [...generated.values(), ...retainedAlerts];
    if (changed) {
      data.alerts.sort((first, second) => new Date(second.date) - new Date(first.date));
      persist();
      if (urgentNewCount) {
        const live = $('#notificationLive');
        if (live) live.textContent = `${urgentNewCount} new urgent ${urgentNewCount === 1 ? 'notification' : 'notifications'}.`;
      }
    }
    return changed;
  }

  function visibleNotificationAlerts() {
    const now = Date.now();
    return (data.alerts || []).filter(alert => !isNotificationCleared(alert) && !alert.dismissedAt && (!alert.snoozedUntil || new Date(alert.snoozedUntil).getTime() <= now));
  }

  function notificationCategory(alert) {
    if (alert.type?.startsWith('task-')) return 'daily-tasks';
    if (alert.type?.startsWith('wallet-payment-') || alert.type?.startsWith('subscription-')) return 'finance';
    if (alert.type === 'to-apply' || alert.id?.startsWith('to-apply|due|')) return 'to-apply';
    if (alert.type?.startsWith('client-task-') || alert.type?.startsWith('contract-') || ['document-email-reminder', 'onboarding-submission', 'active-client-email', 'active-client-email-review'].includes(alert.type)) return 'active-clients';
    const linkedApplication = (data.applications || []).find(item =>
      item.id === alert.applicationId || alert.id?.endsWith(`|${item.id}`)
    );
    return linkedApplication?.status === 'Active client' ? 'active-clients' : 'applications';
  }

  function renderAlerts() {
    refreshGeneratedNotifications();
    const alerts = visibleNotificationAlerts().sort((first, second) => new Date(second.date) - new Date(first.date));
    let unread = 0;
    const unreadByCategory = new Map();
    for (const alert of alerts) {
      if (!alert.unread) continue;
      unread += 1;
      const category = notificationCategory(alert);
      unreadByCategory.set(category, (unreadByCategory.get(category) || 0) + 1);
    }
    const badge = $('#notificationBadge');
    const button = $('#notificationButton');
    if (badge) {
      badge.textContent = unread > 9 ? '9+' : String(unread);
      badge.hidden = unread === 0;
      badge.classList.toggle('is-single', unread === 1);
    }
    if (button) button.setAttribute('aria-label', unread ? `Notifications, ${unread} unread` : 'Notifications');
    updateTabNotification(unread);
    $$('.notification-tabs [role="tab"]').forEach(tab => {
      const filter = tab.dataset.notificationFilter;
      const count = filter === 'all' || filter === 'unread' ? unread : (unreadByCategory.get(filter) || 0);
      const countPill = tab.querySelector('.notification-tab-count');
      if (countPill) {
        countPill.textContent = count > 9 ? '9+' : String(count);
        countPill.hidden = count === 0;
        countPill.classList.toggle('is-single', count === 1);
      }
      tab.classList.toggle('has-unread', count > 0);
      const label = tab.querySelector('.notification-tab-text')?.textContent.trim() || '';
      const accessibleLabel = count ? `${label}, ${count} unread ${count === 1 ? 'notification' : 'notifications'}` : label;
      tab.setAttribute('aria-label', accessibleLabel);
    });
    const list = $('#notificationList');
    if (!list) return;
    const shownAlerts = alerts.filter(alert => {
      if (notificationFilter === 'unread') return alert.unread;
      return notificationFilter === 'all' || notificationCategory(alert) === notificationFilter;
    });
    const groups = [
      { key: 'applications', label: 'Applications' },
      { key: 'active-clients', label: 'Active Clients' },
      { key: 'daily-tasks', label: 'Daily Tasks' },
      { key: 'to-apply', label: 'To Apply' },
      { key: 'finance', label: 'Finance' }
    ].map(group => ({
      label: group.label,
      items: shownAlerts.filter(alert => notificationCategory(alert) === group.key)
    })).filter(group => group.items.length);
    if (!groups.length) {
      const emptyMessages = {
        all: 'No notifications right now. Tasks and client updates will appear here.',
        applications: 'No application notifications right now.',
        'active-clients': 'No active client notifications right now.',
        'daily-tasks': 'No daily task notifications right now.',
        'to-apply': 'No To Apply notifications right now.',
        finance: 'No finance notifications right now.',
        unread: 'You’re all caught up. No unread notifications.'
      };
      list.innerHTML = `<div class="notification-empty">${emptyMessages[notificationFilter]}</div>`;
      return;
    }
    list.innerHTML = groups.map(group => `
      <section class="notification-section" aria-label="${group.label}">
        <h3 class="notification-section-title">${group.label}</h3>
        ${group.items.map(alert => {
          const urgency = alert.urgency || (alert.type === 'contract-ended' ? 'ended' : '');
          return `<article class="notification-item ${alert.unread ? 'unread' : ''}${urgency ? ` is-${escapeHtml(urgency)}` : ''}">
            <span class="notification-item-dot" aria-hidden="true"></span>
            <div class="notification-item-copy">
              <span class="notification-item-heading"><strong>${escapeHtml(alert.clientName || 'Notification')}</strong><time datetime="${escapeHtml(alert.date || '')}">${escapeHtml(notificationRelativeTime(alert.date))}</time></span>
              <button type="button" class="notification-item-subject" data-alert-open="${escapeHtml(alert.id)}">${escapeHtml(alert.subject || '(No subject)')}</button>
              ${alert.from ? `<small>${escapeHtml(alert.from)}</small>` : ''}
              ${alert.id?.startsWith('follow-up|') && alert.deliveryReason ? `<small>${escapeHtml(alert.deliveryReason)}</small>` : ''}
              ${['application-email-closed', 'application-email-review'].includes(alert.type) && alert.evidence ? `<small>From the email: ${escapeHtml(alert.evidence)}</small>` : ''}
              ${['application-email-closed', 'application-email-review'].includes(alert.type) && alert.reason ? `<small>AI assessment: ${escapeHtml(alert.reason)}</small>` : ''}
              <div class="notification-item-actions">
                <button type="button" data-alert-action="snooze" data-alert-id="${escapeHtml(alert.id)}" aria-label="Snooze ${escapeHtml(alert.subject || 'notification')} for one day">Snooze</button>
                <button type="button" data-alert-action="dismiss" data-alert-id="${escapeHtml(alert.id)}" aria-label="Dismiss ${escapeHtml(alert.subject || 'notification')}">Dismiss</button>
                <button type="button" data-alert-action="done" data-alert-id="${escapeHtml(alert.id)}">Mark done</button>
              </div>
            </div>
          </article>`;
        }).join('')}
      </section>
    `).join('');
  }

  function closeNotifications({ restoreFocus = false } = {}) {
    const panel = $('#notificationPanel');
    if (!panel || panel.classList.contains('hidden')) return;
    panel.classList.add('hidden');
    $('#notificationButton').setAttribute('aria-expanded', 'false');
    const focusTarget = notificationReturnFocus instanceof HTMLElement && notificationReturnFocus.isConnected
      ? notificationReturnFocus
      : $('#notificationButton');
    notificationReturnFocus = null;
    if (restoreFocus) focusTarget.focus();
  }

  function openNotifications() {
    const panel = $('#notificationPanel');
    const willOpen = panel.classList.contains('hidden');
    if (!willOpen) {
      closeNotifications({ restoreFocus: true });
      return;
    }
    notificationReturnFocus = $('#notificationButton');
    renderAlerts();
    panel.classList.remove('hidden');
    $('#notificationButton').setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => {
      $(`[data-notification-filter="${notificationFilter}"]`)?.focus();
    });
  }

  function setNotificationFilter(filter) {
    notificationFilter = filter;
    const tabs = $$('.notification-tabs [role="tab"]');
    tabs.forEach(tab => {
      const selected = tab.dataset.notificationFilter === filter;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    $('#notificationList').setAttribute('aria-labelledby', $(`[data-notification-filter="${filter}"]`).id);
    renderAlerts();
  }

  function handleNotificationAction(alertId, action) {
    const alert = (data.alerts || []).find(item => item.id === alertId);
    if (!alert) return;
    if (action === 'snooze') alert.snoozedUntil = new Date(Date.now() + 86400000).toISOString();
    else if (action === 'dismiss') { rememberClearedNotifications([alert]); data.alerts = data.alerts.filter(item => item !== alert); }
    else if (action === 'done') {
      if (alert.type?.startsWith('client-task-')) {
        const task = (data.clientTasks || []).find(item => item.id === alert.taskId);
        if (task) {
          task.status = 'done';
          task.completedAt = new Date().toISOString();
          task.updatedAt = task.completedAt;
        }
      } else if (alert.type?.startsWith('task-')) {
        const task = (data.dailyTasks || []).find(item => item.id === alert.taskId);
        if (task) task.completedAt = new Date().toISOString();
      } else {
        alert.unread = false;
        alert.dismissedAt = new Date().toISOString();
        rememberClearedNotifications([alert]);
        data.alerts = data.alerts.filter(item => item !== alert);
      }
    }
    persist();
    renderAll();
    if (!$('#notificationPanel').classList.contains('hidden')) {
      requestAnimationFrame(() => $(`[data-notification-filter="${notificationFilter}"]`)?.focus());
    }
  }

  function handleNotificationKeydown(event) {
    const panel = $('#notificationPanel');
    if (panel.classList.contains('hidden') || document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeNotifications({ restoreFocus: true });
      return;
    }
    if (event.target instanceof HTMLElement && event.target.matches('[role="tab"]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const tabs = $$('.notification-tabs [role="tab"]');
      const currentIndex = tabs.indexOf(event.target);
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (currentIndex + 1) % tabs.length : (currentIndex - 1 + tabs.length) % tabs.length;
      const next = tabs[nextIndex];
      next.focus();
      next.click();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(item => !item.closest('[hidden]') && item.getClientRects().length);
    if (!focusable.length) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('keydown', handleNotificationKeydown);
  window.addEventListener('focus', renderAlerts);
  function checkAutomaticFollowUps() {
    if (!currentUser || !dataReady || !supabaseDataLoaded || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    processDueFollowUps().catch(error => console.error('Scheduled follow-up check failed:', error));
  }
  window.addEventListener('focus', checkAutomaticFollowUps);
  window.addEventListener('online', checkAutomaticFollowUps);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkAutomaticFollowUps();
  });

  function startNotificationRefreshTimer() {
    if (!notificationRefreshTimer) {
      notificationRefreshTimer = setInterval(() => {
        if (dataReady && supabaseDataLoaded) {
          renderAlerts();
          checkAutomaticFollowUps();
          if (activeView === 'subscriptions') renderSubscriptions();
        }
      }, 60000);
    }
  }

  function stopNotificationRefreshTimer() {
    if (!notificationRefreshTimer) return;
    clearInterval(notificationRefreshTimer);
    notificationRefreshTimer = null;
  }

  let onboardingAlertsRefreshInFlight = false;
  async function refreshClientOnboardingAlerts() {
    if (!currentUser || !dataReady || !supabaseDataLoaded || onboardingAlertsRefreshInFlight) return;
    const userId = currentUser.id;
    onboardingAlertsRefreshInFlight = true;
    try {
      const { data: submissions, error } = await requireSupabase().rpc('get_client_onboarding_submissions');
      if (error) throw error;
      if (!currentUser || currentUser.id !== userId || !dataReady || !supabaseDataLoaded) return;
      if (!Array.isArray(submissions)) throw new Error('The onboarding notifications response was invalid.');
      submissions.forEach(submission => {
        if (!submission.client_id) return;
        if (submission.timezone) clientTimeZones.set(submission.client_id, submission.timezone);
      });
      updateClientOnlineIndicators();
      data.onboardingSubmissionIds = data.onboardingSubmissionIds || [];
      data.alerts = data.alerts || [];
      const seen = new Set(data.onboardingSubmissionIds);
      let changed = false;
      submissions.forEach(submission => {
        const submissionId = `onboarding|${submission.client_id}|${submission.submitted_at}`;
        if (seen.has(submissionId)) return;
        seen.add(submissionId);
        data.onboardingSubmissionIds.push(submissionId);
        data.alerts.unshift({
          id: submissionId,
          type: 'onboarding-submission',
          applicationId: submission.client_id,
          clientName: submission.client_name || 'Client',
          subject: 'Submitted onboarding form',
          from: submission.client_email || 'Client',
          date: submission.submitted_at,
          unread: true
        });
        changed = true;
      });
      if (changed) {
        limitAlertHistory();
        persist();
        renderAlerts();
      }
    } catch (error) {
      console.error('Could not refresh client onboarding notifications:', error);
    } finally {
      onboardingAlertsRefreshInFlight = false;
    }
  }

  function updateTabNotification(unread) {
    const favicon = $('#tabFavicon');
    if (!favicon) return;
    const baseTitle = 'Jeff VA';
    document.title = unread ? `(${unread > 9 ? '9+' : unread}) ${baseTitle}` : baseTitle;
    if (!unread) {
      favicon.href = 'images/tab.png';
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    context.fillStyle = '#20374c';
    context.beginPath();
    context.arc(32, 32, 30, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#c34f57';
    context.beginPath();
    context.arc(47, 17, 15, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#fff';
    context.font = '700 14px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(unread > 9 ? '9+' : String(unread), 47, 17);
    favicon.href = canvas.toDataURL('image/png');
  }

  function contractDuration(item) {
    const start = item.activeAt || item.appliedDate;
    const end = item.contractEndDate;
    if (!start || !end) return '';
    const startDate = new Date(`${start.slice(0, 10)}T12:00:00`);
    const endDate = new Date(`${end.slice(0, 10)}T12:00:00`);
    const months = Math.max(1, Math.round((endDate - startDate) / (1000 * 60 * 60 * 24 * 30.4375)));
    return `${months} month${months === 1 ? '' : 's'}`;
  }

  async function sendContractEndedEmail(item, alert) {
    if (!gmailAccessToken || !isEmailAddress(item.email) || item.contractEndedEmailSentAt || contractEndedEmailSending.has(item.id)) return;
    contractEndedEmailSending.add(item.id);
    const previousFailureWasReported = alert.emailSent === false;
    const previousAlertState = {
      subject: alert.subject,
      from: alert.from,
      emailSent: alert.emailSent,
      date: alert.date
    };
    const template = buildDocumentEmailTemplate('contract-ended', item, { duration: contractDuration(item) || 'the project period' });
    const subject = template.subject;
    const body = template.body;
    try {
      const rawMessage = buildRawEmailMessage({ to: item.email, subject, body });
      await sendGmailRaw(rawMessage);
      const sentAt = new Date().toISOString();
      item.contractEndedEmailSentAt = sentAt;
      data.emails.unshift({ id: uid(), from: 'You', to: item.email, subject, body, date: sentAt, importedAt: sentAt, source: 'sent', direction: 'sent' });
      alert.subject = 'Contract ended: email sent to client';
      alert.from = 'Jeff VA';
      alert.emailSent = true;
      alert.date = sentAt;
      persist();
      renderAll();
      showActionResult({ title: 'Contract email sent successfully', message: 'The contract-ended email was sent to the client.' });
    } catch (error) {
      console.error('Contract-ended email failed:', error);
      alert.subject = 'Contract ended: email not sent';
      alert.from = 'Sign in with Google to retry';
      alert.emailSent = false;
      const alertChanged = previousAlertState.subject !== alert.subject
        || previousAlertState.from !== alert.from
        || previousAlertState.emailSent !== alert.emailSent
        || previousAlertState.date !== alert.date;
      // perf: avoid persist churn when a retry failure leaves the alert unchanged.
      if (alertChanged) persist();
      renderAlerts();
      if (!previousFailureWasReported) {
        showActionResult({ title: 'Contract email could not be sent', message: 'Sign in with Google again and review the client alert before retrying.', status: 'error' });
      }
    } finally {
      contractEndedEmailSending.delete(item.id);
    }
  }

  function processContractEndedAlerts() {
    const ended = data.applications.filter(item => item.status === 'Active client' && item.contractEndDate && dateKey(item.contractEndDate) < today());
    if (!ended.length) return;
    data.alerts = data.alerts || [];
    let changed = false;
    ended.forEach(item => {
      const alertId = `contract-ended|${item.id}|${dateKey(item.contractEndDate)}`;
      if (isNotificationCleared({ id: alertId }) || data.alerts.some(alert => alert.id === alertId)) return;
      data.alerts.unshift({
        id: alertId,
        type: 'contract-ended',
        applicationId: item.id,
        clientName: item.clientName,
        subject: 'Contract ended',
        from: 'Jeff VA reminder',
        date: new Date().toISOString(),
        contractEndDate: item.contractEndDate,
        unread: true
      });
      changed = true;
    });
    if (changed) {
      limitAlertHistory();
      persist();
      const needsManualEmail = ended.filter(item => !item.contractEndedEmailSentAt && (!gmailAccessToken || !isEmailAddress(item.email))).length;
      if (needsManualEmail) {
        showActionResult({
          title: 'Contract ended',
          message: `${plural(needsManualEmail, 'client')} have an ended contract. Connect Gmail and review the client alert to send the notice.`,
          status: 'info',
          label: 'CLIENT REMINDER',
          actionLabel: 'Open active clients',
          onAction: () => showView('hired')
        });
      }
    }
    ended.forEach(item => {
      const alert = data.alerts.find(candidate => candidate.id === `contract-ended|${item.id}|${dateKey(item.contractEndDate)}`);
      // perf: never auto-retry a recorded failure; only retry when the user intentionally opens the alert again.
      if (alert && alert.emailSent !== false && !item.contractEndedEmailSentAt) sendContractEndedEmail(item, alert);
    });
  }

  function processDueInterviews() {
    const due = data.applications.filter(item => isInterviewToday(item) && item.interviewAlertDate !== today());
    if (!due.length) return;
    data.alerts = data.alerts || [];
    let interviewsDue = 0;
    due.forEach(item => {
      const alertId = `interview|today|${item.id}|${today()}`;
      if (data.alerts.some(alert => alert.id === alertId)) {
        item.interviewAlertDate = today();
        return;
      }
      item.interviewAlertDate = today();
      data.alerts.unshift({
        id: alertId,
        type: 'interview',
        applicationId: item.id,
        clientName: item.clientName,
        subject: 'Interview scheduled for today',
        from: item.interviewLink ? 'Interview meeting' : 'Jeff VA reminder',
        date: new Date().toISOString(),
        interviewDate: item.interviewDate,
        meetingLink: item.interviewLink || '',
        unread: true
      });
      interviewsDue += 1;
    });
    limitAlertHistory();
    persist();
    renderAlerts();
    if (interviewsDue) {
      showActionResult({
        title: 'Interview scheduled today',
        message: `${plural(interviewsDue, 'interview')} are scheduled for today.`,
        status: 'info',
        label: 'INTERVIEW REMINDER',
        actionLabel: 'Open applications',
        onAction: () => showView('applications')
      });
    }
  }

  function processDueDocumentEmailReminders() {
    const due = data.applications.filter(item => item.status === 'Active client'
      && item.documentEmailPending
      && item.documentEmailReminderDate
      && dateKey(item.documentEmailReminderDate) <= today()
      && item.documentEmailReminderAlertedDate !== dateKey(item.documentEmailReminderDate));
    if (!due.length) return;
    data.alerts = data.alerts || [];
    due.forEach(item => {
      const reminderDate = dateKey(item.documentEmailReminderDate);
      const alertId = `document-email|due|${item.id}|${reminderDate}`;
      item.documentEmailReminderAlertedDate = reminderDate;
      item.documentEmailReminderDate = '';
      if (isNotificationCleared({ id: alertId }) || data.alerts.some(alert => alert.id === alertId)) return;
      data.alerts.unshift({ id: alertId, type: 'document-email-reminder', applicationId: item.id, clientName: item.clientName, subject: 'Send the updated document today', from: 'Jeff VA reminder', date: new Date().toISOString(), unread: true });
    });
    limitAlertHistory();
    persist();
    renderAlerts();
    const currentClient = data.applications.find(item => item.id === hiredEditingId);
    if (currentClient) renderHiredDetail(currentClient, false);
    showActionResult({
      title: 'Document reminder due',
      message: `${plural(due.length, 'updated document')} need to be sent today.`,
      status: 'info',
      label: 'DOCUMENT REMINDER',
      actionLabel: 'Open client',
      onAction: () => {
        showView('hired');
        renderHiredDetail(due[0], false);
      }
    });
  }

  async function processDueFollowUps() {
    if (followUpProcessing) return followUpProcessing;
    const run = runDueFollowUps();
    followUpProcessing = run;
    try { return await run; } finally { if (followUpProcessing === run) followUpProcessing = null; }
  }

  let followUpProcessing = null;

  function followUpGmailAvailable() {
    if (typeof gmailReconnectRequired !== 'undefined' && gmailReconnectRequired) return false;
    if (gmailAccessToken) return true;
    return typeof readGmailCredentials === 'function' && Boolean(readGmailCredentials()?.refreshToken);
  }

  function reconcileSentFollowUpAlerts() {
    let changed = false;
    for (const item of data.applications) {
      const sentAt = confirmedApplicationFollowUpSentAt(item);
      if (!sentAt) continue;
      const scheduledDate = item.followUpDate;
      if (scheduledDate && dateKey(sentAt) < scheduledDate) continue;
      if (item.followUpSentAt !== sentAt || scheduledDate || item.automaticFollowUp) {
        item.followUpSentAt = sentAt;
        item.followUpDate = '';
        item.automaticFollowUp = false;
        changed = true;
      }
      for (const alert of data.alerts || []) {
        if (!alert.id?.startsWith(`follow-up|${item.id}|`) || alert.deliveryStatus === 'sent') continue;
        const alertDate = alert.id.slice(`follow-up|${item.id}|`.length);
        if (alertDate > dateKey(sentAt)) continue;
        alert.subject = `Follow-up sent: ${buildDocumentEmailTemplate('follow-up', item).subject}`;
        alert.from = 'Jeff VA';
        alert.deliveryStatus = 'sent';
        alert.deliveryReason = '';
        alert.unread = true;
        changed = true;
      }
    }
    return changed;
  }

  async function runDueFollowUps() {
    const userId = currentUser?.id;
    if (reconcileSentFollowUpAlerts()) {
      await persist();
      if (currentUser?.id !== userId) return;
      if (activeView === 'applications') renderApplications();
      if (activeView === 'dashboard') renderDashboard();
      renderAlerts();
    }
    const due = data.applications.filter(item => item.followUpDate && isFollowUpSendTime(item, item.followUpDate) && item.status !== 'Active client' && item.status !== 'Not selected' && applicationFollowUpState(item) !== 'sent' && (!item.followUpProcessedAt || (item.automaticFollowUp && applicationFollowUpState(item) !== 'sent' && followUpGmailAvailable())));
    if (!due.length) return;
    data.alerts = data.alerts || [];
    let followUpAlertsAdded = 0;
    let automaticEmailsSent = 0;
    let automaticEmailsFailed = 0;
    let followUpsNeedingReview = 0;
    let lastFailure = '';
    for (const candidate of due) {
      if (currentUser?.id !== userId) return;
      let item = data.applications.find(app => app.id === candidate.id);
      if (!item) continue;
      if (!item.followUpDate || !isFollowUpSendTime(item, item.followUpDate) || ['Active client', 'Not selected'].includes(item.status) || applicationFollowUpState(item) === 'sent') continue;
      const scheduledFollowUpDate = item.followUpDate;
      const template = buildDocumentEmailTemplate('follow-up', item);
      const subject = template.subject;
      const body = template.body;
      let sent = false;
      let deliveryFailed = false;
      let deliveryState = '';
      let deliveryReason = '';
      let delivery = null;
      if (item.automaticFollowUp && followUpGmailAvailable() && isEmailAddress(item.email)) {
        try {
          if ((await persist()) === false) throw new Error('Waiting for the follow-up schedule to save to your account. The app will retry automatically.');
          delivery = await sendAutomaticFollowUpOnce(item, scheduledFollowUpDate, subject, body);
          sent = true;
          automaticEmailsSent += 1;
        } catch (error) {
          deliveryFailed = true;
          deliveryState = error.followUpDeliveryState || 'retry';
          deliveryReason = error.message || 'The app will retry automatically.';
          console.error('Automatic follow-up failed:', error);
          automaticEmailsFailed += 1;
          lastFailure = error.message || 'Follow-up delivery could not be confirmed.';
        }
      }
      if (currentUser?.id !== userId) return;
      // Realtime refreshes can replace the workspace while Gmail is awaiting.
      // Write the receipt to the current record, never an abandoned object.
      item = data.applications.find(app => app.id === candidate.id);
      if (!item) continue;
      item.followUpProcessedAt = new Date().toISOString();
      if (sent) {
        item.followUpSentAt = delivery.sentAt;
        item.followUpGmailId = delivery.gmailId || '';
      }
      if (sent && item.followUpDate === scheduledFollowUpDate) {
        item.followUpDate = '';
        item.automaticFollowUp = false;
        if (editingId === item.id) {
          $('#followUpDate').value = '';
          $('#automaticFollowUp').checked = false;
        }
      }
      const alertId = `follow-up|${item.id}|${scheduledFollowUpDate}`;
      const existingAlert = data.alerts.find(alert => alert.id === alertId);
      const followUpAlert = {
        id: alertId,
        clientName: item.clientName,
        subject: sent ? `Automatic follow-up sent: ${subject}` : deliveryFailed ? (deliveryState === 'uncertain' ? `Follow-up delivery unconfirmed: ${subject}` : deliveryState === 'sending' ? `Follow-up sending: ${subject}` : `Automatic follow-up waiting to retry: ${subject}`) : `Follow-up needed: ${subject}`,
        from: sent ? 'Jeff VA' : 'Jeff VA reminder',
        deliveryStatus: sent ? 'sent' : deliveryFailed ? (deliveryState === 'uncertain' ? 'review' : deliveryState) : 'due',
        deliveryReason: sent ? '' : deliveryReason,
        date: new Date().toISOString(),
        unread: true
      };
      if (existingAlert) {
        if (existingAlert.deliveryStatus !== 'sent') {
          const statusChanged = existingAlert.subject !== followUpAlert.subject;
          Object.assign(existingAlert, followUpAlert, { unread: statusChanged || existingAlert.unread });
        }
      }
      else {
        data.alerts.unshift(followUpAlert);
        followUpAlertsAdded += 1;
      }
      if (sent) {
        if (!delivery.gmailId || !data.emails.some(email => email.gmailId === delivery.gmailId)) {
          data.emails.unshift({ id: delivery.gmailId ? `gmail-${delivery.gmailId}` : uid(), gmailId: delivery.gmailId || '', applicationId: item.id, emailType: 'follow-up', from: 'You', to: item.email, subject, body, date: delivery.sentAt, importedAt: new Date().toISOString(), source: delivery.gmailId ? 'gmail' : 'sent', direction: 'sent' });
        }
        await persist();
      } else if (!item.automaticFollowUp || !followUpGmailAvailable() || !isEmailAddress(item.email)) {
        followUpsNeedingReview += 1;
      }
    }
    limitAlertHistory();
    persist();
    if (automaticEmailsSent && activeView === 'applications') renderApplications();
    if (automaticEmailsSent && activeView === 'dashboard') renderDashboard();
    renderAlerts();
    if (followUpAlertsAdded || automaticEmailsSent) {
      const summary = [
        automaticEmailsSent ? `${plural(automaticEmailsSent, 'automatic follow-up email')} sent` : '',
          automaticEmailsFailed ? `${plural(automaticEmailsFailed, 'automatic follow-up email')} need review. ${lastFailure}` : '',
        followUpsNeedingReview ? `${plural(followUpsNeedingReview, 'follow-up')} need your attention in Applications` : ''
      ].filter(Boolean).join('. ');
      showActionResult({
        title: automaticEmailsFailed ? 'Follow-ups need attention' : automaticEmailsSent ? 'Automatic follow-ups sent' : 'Follow-ups due',
        message: summary,
        status: automaticEmailsFailed ? 'error' : automaticEmailsSent ? 'success' : 'info',
        label: 'FOLLOW-UP STATUS',
        actionLabel: 'Open applications',
        onAction: () => showView('applications')
      });
    }
  }

  function markAlertsRead() {
    (data.alerts || []).forEach(alert => { alert.unread = false; });
    persist();
    renderAlerts();
  }

  async function clearAlerts() {
    if (!(data.alerts || []).length) return;
    const userId = currentUser?.id;
    if (!(await appConfirm('Permanently clear all notifications, including snoozed items? These notifications will not reappear. Your tasks and client records are kept.', { title: 'Clear notifications permanently', confirmLabel: 'Clear permanently', danger: true }))) return;
    if (currentUser?.id !== userId) return;
    rememberClearedNotifications(data.alerts);
    data.alerts = [];
    if ((await persist()) === false) showActionResult({ title: 'Notification clear could not be saved', message: 'Notifications are hidden here, but the cloud save failed. Reconnect and try again before closing the app.', status: 'error' });
    renderAlerts();
  }
