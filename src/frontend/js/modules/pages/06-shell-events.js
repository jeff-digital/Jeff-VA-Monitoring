  // Shared shell only: navigation, dashboard controls, notifications, and layout.
  // Page-specific handlers live beside the page they control.
  document.addEventListener('submit', event => {
    if (event.target?.id === 'loginForm') return;
    if (event.target?.method === 'dialog' || event.target?.getAttribute('method') === 'dialog') return;
    event.preventDefault();
  });

  function isMobileLayout() {
    return window.matchMedia('(max-width: 720px)').matches;
  }

  function openMobileSidebar() {
    if (!isMobileLayout()) return;
    const sidebar = $('#mainSidebar');
    const backdrop = $('#mobileSidebarBackdrop');
    sidebar.classList.add('open');
    sidebar.setAttribute('aria-hidden', 'false');
    backdrop.hidden = false;
    document.body.classList.add('mobile-sidebar-open');
    $('#mobileMenu').setAttribute('aria-expanded', 'true');
    $('#mobileMenu').setAttribute('aria-label', 'Close navigation');
    requestAnimationFrame(() => $('#mobileSidebarClose').focus());
  }

  function closeMobileSidebar({ restoreFocus = false } = {}) {
    const sidebar = $('#mainSidebar');
    const backdrop = $('#mobileSidebarBackdrop');
    const mobileLayout = isMobileLayout();
    const wasOpen = sidebar.classList.contains('open');
    sidebar.classList.remove('open');
    sidebar.setAttribute('aria-hidden', String(mobileLayout));
    backdrop.hidden = true;
    document.body.classList.remove('mobile-sidebar-open');
    $('#mobileMenu').setAttribute('aria-expanded', 'false');
    $('#mobileMenu').setAttribute('aria-label', 'Open navigation');
    $('#utilityMenu').classList.add('hidden');
    $('#utilityMenuButton').setAttribute('aria-expanded', 'false');
    if (restoreFocus && wasOpen && mobileLayout) $('#mobileMenu').focus();
  }

  const quickSearchPages = [
    { id: 'dashboard', label: 'Dashboard', detail: 'Your overview', icon: 'fa-house' },
    { id: 'applications', label: 'Applications', detail: 'Search and manage your pipeline', icon: 'fa-layer-group' },
    { id: 'inbox', label: 'Email', detail: 'Open your email workspace', icon: 'fa-envelope' },
    { id: 'daily-task', label: 'Daily Tasks', detail: 'Review today’s tasks', icon: 'fa-list-check' },
    { id: 'to-apply', label: 'To Apply', detail: 'Review application reminders', icon: 'fa-calendar-check' },
    { id: 'hired', label: 'Active clients', detail: 'View your active client list', icon: 'fa-user-tie' },
    { id: 'documents', label: 'Tools', detail: 'Open your tools library', icon: 'fa-toolbox' },
    { id: 'weekly-report', label: 'Weekly report', detail: 'Review or export this week’s report', icon: 'fa-chart-column' },
    { id: 'settings', label: 'Settings', detail: 'Manage your workspace preferences', icon: 'fa-gear' }
  ];

  function renderQuickSearchResults(query = '') {
    const normalizedQuery = query.trim().toLowerCase();
    const matches = [];
    quickSearchPages.filter(page => !normalizedQuery || `${page.label} ${page.detail}`.toLowerCase().includes(normalizedQuery))
      .forEach(page => matches.push(`<button class="quick-search-result" type="button" role="option" data-quick-page="${page.id}"><i class="fa-solid ${page.icon}" aria-hidden="true"></i><span><strong>${escapeHtml(page.label)}</strong><small>${escapeHtml(page.detail)}</small></span><kbd>Page</kbd></button>`));
    const applications = data.applications.filter(item => !normalizedQuery
      ? true
      : [item.clientName, item.contact, item.role, item.platform, item.status].join(' ').toLowerCase().includes(normalizedQuery))
      .slice(0, normalizedQuery ? 6 : 5);
    applications.forEach(item => matches.push(`<button class="quick-search-result" type="button" role="option" data-quick-application="${escapeHtml(item.id)}"><i class="fa-regular fa-building" aria-hidden="true"></i><span><strong>${escapeHtml(item.clientName)}</strong><small>${escapeHtml([item.role, item.platform, item.status].filter(Boolean).join(' · '))}</small></span><kbd>Application</kbd></button>`));
    const emails = normalizedQuery
      ? data.emails.filter(item => [item.from, item.to, item.subject, item.body].join(' ').toLowerCase().includes(normalizedQuery)).slice(0, 5)
      : sortByDate(data.emails, item => item.date).slice(0, 3);
    emails.forEach(item => matches.push(`<button class="quick-search-result" type="button" role="option" data-quick-email="${escapeHtml(item.id)}"><i class="fa-regular fa-envelope" aria-hidden="true"></i><span><strong>${escapeHtml(item.subject || '(No subject)')}</strong><small>${escapeHtml(item.from || item.to || 'Email')}</small></span><kbd>${normalizedQuery ? 'Email' : 'Recent'}</kbd></button>`));
    $('#quickSearchResults').innerHTML = matches.length
      ? matches.join('')
      : '<p class="quick-search-empty">No matching pages, applications, or emails.</p>';
  }

  function openQuickSearch() {
    $('#quickSearchModal').showModal();
    $('#quickSearchInput').value = '';
    renderQuickSearchResults();
    requestAnimationFrame(() => $('#quickSearchInput').focus());
  }

  $('#openQuickSearch').addEventListener('click', openQuickSearch);
  $('#quickSearchInput').addEventListener('input', event => renderQuickSearchResults(event.target.value));
  $('#openWeeklyGoalDialog').addEventListener('click', () => {
    const savedGoal = localStorage.getItem(weeklyActivityGoalStorageKey()) || '';
    $('#weeklyGoalInput').value = savedGoal;
    $('#saveWeeklyGoal').disabled = !$('#weeklyGoalInput').checkValidity();
    $('#weeklyGoalDialog').showModal();
    requestAnimationFrame(() => $('#weeklyGoalInput').focus());
  });
  $('#weeklyGoalInput').addEventListener('input', event => {
    event.target.setCustomValidity('');
    $('#saveWeeklyGoal').disabled = !event.target.checkValidity();
  });
  $('#closeWeeklyGoalDialog').addEventListener('click', () => $('#weeklyGoalDialog').close());
  $('#cancelWeeklyGoal').addEventListener('click', () => $('#weeklyGoalDialog').close());
  $('#weeklyGoalForm').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const goal = Number($('#weeklyGoalInput').value);
    if (!Number.isInteger(goal) || goal < 1 || goal > 100) {
      $('#weeklyGoalInput').setCustomValidity('Enter a whole number between 1 and 100.');
      form.reportValidity();
      return;
    }
    localStorage.setItem(weeklyActivityGoalStorageKey(), String(goal));
    $('#weeklyGoalDialog').close();
    renderDashboard();
    toast('Weekly application goal saved.');
  });
  $('#showKeyboardShortcuts').addEventListener('click', () => {
    $('#quickSearchModal').close();
    $('#shortcutsModal').showModal();
  });
  $('#closeShortcuts').addEventListener('click', () => $('#shortcutsModal').close());
  document.addEventListener('click', event => {
    const pageResult = event.target.closest('[data-quick-page]');
    const applicationResult = event.target.closest('[data-quick-application]');
    const emailResult = event.target.closest('[data-quick-email]');
    if (!pageResult && !applicationResult && !emailResult) return;
    $('#quickSearchModal').close();
    if (pageResult) {
      if (pageResult.dataset.quickPage === 'weekly-report') {
        showView('dashboard');
        openWeeklyReport();
      } else if (pageResult.dataset.quickPage === 'settings') {
        openWorkspaceSettings();
      } else {
        showView(pageResult.dataset.quickPage);
      }
    } else if (applicationResult) {
      showView('applications');
      openClientModal(applicationResult.dataset.quickApplication, true);
    } else {
      showView('inbox');
      openEmailDetail(emailResult.dataset.quickEmail);
    }
  });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (!$('#quickSearchModal').open) openQuickSearch();
      return;
    }
    if ($('#quickSearchModal').open && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      const results = [...$('#quickSearchResults').querySelectorAll('.quick-search-result')];
      if (results.length) {
        event.preventDefault();
        const activeIndex = results.indexOf(document.activeElement);
        const nextIndex = event.key === 'ArrowDown'
          ? (activeIndex + 1) % results.length
          : activeIndex < 0 ? results.length - 1 : (activeIndex - 1 + results.length) % results.length;
        results[nextIndex].focus();
      }
      return;
    }
    const target = event.target;
    const isTyping = target instanceof HTMLElement
      && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    if ($('#weeklyReportModal').open && !isTyping && event.key === 'ArrowLeft') {
      event.preventDefault();
      selectWeeklyReportWeek(weeklyReportOffset - 1);
      return;
    }
    if ($('#weeklyReportModal').open && !isTyping && event.key === 'ArrowRight') {
      event.preventDefault();
      selectWeeklyReportWeek(weeklyReportOffset + 1);
      return;
    }
    if (isTyping || event.altKey || event.ctrlKey || event.metaKey || document.querySelector('dialog[open]')) return;
    if (event.key === '/') {
      event.preventDefault();
      if (activeView !== 'applications') showView('applications');
      $('#applicationSearch').focus();
    } else if (event.key.toLowerCase() === 'n' && activeView !== 'inbox') {
      event.preventDefault();
      if (activeView !== 'applications') showView('applications');
      openClientModal();
    }
  });

  $$('.nav-link').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    showView(link.dataset.view);
  }));
  $$('[data-go-to]').forEach(button => button.addEventListener('click', () => {
    showView(button.dataset.goTo);
  }));
  $('.brand').addEventListener('click', event => {
    event.preventDefault();
    showView('dashboard');
  });
  $('#openAddModal').addEventListener('click', () => openClientModal());

  document.addEventListener('click', event => {
    const dashboardTab = event.target.closest('[data-dashboard-tab]');
    const previousInterviewMonth = event.target.closest('#previousInterviewMonth');
    const nextInterviewMonth = event.target.closest('#nextInterviewMonth');
    const calendarClientButton = event.target.closest('[data-calendar-client]');
    const notificationFilterButton = event.target.closest('[data-notification-filter]');
    const notificationActionButton = event.target.closest('[data-alert-action]');
    const alertOpenButton = event.target.closest('[data-alert-open]');

    if (dashboardTab) {
      if (dashboardTab.dataset.dashboardTab === 'application') closeClientDashboardDrawer();
      activeDashboardTab = dashboardTab.dataset.dashboardTab;
      $$('[data-dashboard-tab]').forEach(tab => {
        const selected = tab === dashboardTab;
        tab.classList.toggle('active', selected);
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
      });
      $$('[data-dashboard-panel]').forEach(panel => {
        panel.hidden = panel.dataset.dashboardPanel !== activeDashboardTab;
      });
      $('#pageEyebrow').textContent = activeDashboardTab === 'client' ? 'CLIENT WORKSPACE' : 'YOUR PIPELINE';
      $('#pageTitle').textContent = activeDashboardTab === 'client' ? 'Client Dashboard' : 'Application Dashboard';
      return;
    }
    if (notificationFilterButton) {
      setNotificationFilter(notificationFilterButton.dataset.notificationFilter);
      return;
    }
    if (notificationActionButton) {
      handleNotificationAction(notificationActionButton.dataset.alertId, notificationActionButton.dataset.alertAction);
      return;
    }
    if (previousInterviewMonth) {
      interviewCalendarMonth = new Date(interviewCalendarMonth.getFullYear(), interviewCalendarMonth.getMonth() - 1, 1);
      renderInterviewCalendar();
      return;
    }
    if (nextInterviewMonth) {
      interviewCalendarMonth = new Date(interviewCalendarMonth.getFullYear(), interviewCalendarMonth.getMonth() + 1, 1);
      renderInterviewCalendar();
      return;
    }
    if (calendarClientButton) {
      openClientModal(calendarClientButton.dataset.calendarClient, true);
      return;
    }
    if (alertOpenButton) {
      const alert = (data.alerts || []).find(item => item.id === alertOpenButton.dataset.alertOpen);
      if (alert) {
        alert.unread = false;
        persist();
        renderAlerts();
      }
      closeNotifications();
      if (alert?.type?.startsWith('task-') && alert.taskId) {
        showView('daily-task');
        const taskDate = $('#dailyTaskDate');
        if (taskDate && alert.taskDate) taskDate.value = alert.taskDate;
        renderDailyTasks();
        requestAnimationFrame(() => $(`[data-daily-task-open="${CSS.escape(alert.taskId)}"]`)?.focus());
      } else if (alert?.type?.startsWith('client-task-') && alert.applicationId) {
        const client = data.applications.find(candidate => candidate.id === alert.applicationId);
        if (client) {
          showView('hired');
          renderHiredDetail(client);
        }
      } else if (alert?.type?.startsWith('contract-ending-') && alert.applicationId) {
        const client = data.applications.find(candidate => candidate.id === alert.applicationId);
        if (client) {
          showView('hired');
          renderHiredDetail(client);
        }
      } else if (alert?.type === 'contract-ended' && alert.applicationId) {
        const item = data.applications.find(candidate => candidate.id === alert.applicationId);
        // perf: let the manual review flow retry a prior failure instead of auto-retrying on every render.
        if (item && alert.emailSent === false && !item.contractEndedEmailSentAt) {
          alert.emailSent = undefined;
          showView('hired');
          renderHiredDetail(item);
          sendContractEndedEmail(item, alert);
          return;
        }
        if (item) {
          showView('hired');
          renderHiredDetail(item);
        }
      } else if (alert?.type === 'to-apply' || alert?.id?.startsWith('to-apply|due|')) {
        showView('to-apply');
      } else if (alert?.type === 'interview' && alert.applicationId) {
        showView('applications');
        openClientModal(alert.applicationId, true);
      } else if ((alert?.type === 'document-email-reminder' || alert?.type === 'onboarding-submission') && alert.applicationId) {
        const client = data.applications.find(item => item.id === alert.applicationId);
        if (client) {
          showView('hired');
          renderHiredDetail(client);
        }
      } else {
        showView('inbox');
      }
    }
  });

  document.addEventListener('keydown', event => {
    const currentTab = event.target.closest('[data-dashboard-tab]');
    if (!currentTab) return;
    const tabs = $$('[data-dashboard-tab]');
    const currentIndex = tabs.indexOf(currentTab);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[nextIndex].focus();
    tabs[nextIndex].click();
  });

  $('#notificationButton').addEventListener('click', openNotifications);
  $('#markAlertsRead').addEventListener('click', markAlertsRead);
  $('#clearAlerts').addEventListener('click', clearAlerts);
  $('#utilityMenuButton').addEventListener('click', () => {
    const menu = $('#utilityMenu');
    const willOpen = menu.classList.contains('hidden');
    menu.classList.toggle('hidden', !willOpen);
    $('#utilityMenuButton').setAttribute('aria-expanded', String(willOpen));
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('#notificationMenu')) {
      closeNotifications();
    }
    if (!event.target.closest('.sidebar-utility-menu')) {
      $('#utilityMenu').classList.add('hidden');
      $('#utilityMenuButton').setAttribute('aria-expanded', 'false');
    }
  });

  $('#exportButton').addEventListener('click', exportBackup);
  $('#backupInput').addEventListener('change', event => restoreBackup(event.target.files[0]));
  $('#settingsButton').addEventListener('click', openWorkspaceSettings);
  $('#closeSettingsModal').addEventListener('click', () => $('#settingsModal').close());
  $('#settingsDoneButton').addEventListener('click', () => $('#settingsModal').close());
  $('#settingsModal').addEventListener('close', () => {
    const mobileMenu = $('#mobileMenu');
    const focusTarget = mobileMenu && getComputedStyle(mobileMenu).display !== 'none'
      ? mobileMenu
      : $('#utilityMenuButton');
    focusTarget.focus();
  });
  $('#autoBackupFrequency').addEventListener('change', event => {
    localStorage.setItem('jeff-va-auto-backup-frequency-v1', event.target.value);
    localStorage.removeItem('jeff-va-auto-backup-last-run-v1');
    scheduleAutomaticBackup();
  });
  $('#clearDataButton').addEventListener('click', async () => {
    if (!(await appConfirm('Clear every application, imported email, and attached document from your account? This cannot be undone unless you have exported a backup.', { title: 'Clear workspace data', confirmLabel: 'Clear data', danger: true }))) return;
    clearSupabaseData()
      .then(() => {
        persist();
        renderAll();
        $('#settingsModal').close();
        showActionResult({ title: 'Workspace data cleared', message: 'All applications, imported email, and attached documents were removed from Supabase.' });
      })
      .catch(error => {
        console.error(error);
        showActionResult({ title: 'Could not clear workspace data', message: 'Your account data could not be cleared. Check your connection and try again.', status: 'error' });
      });
  });

  $('#mobileMenu').addEventListener('click', () => {
    if ($('#mainSidebar').classList.contains('open')) closeMobileSidebar({ restoreFocus: true });
    else openMobileSidebar();
  });
  $('#mobileSidebarClose').addEventListener('click', () => closeMobileSidebar({ restoreFocus: true }));
  $('#mobileSidebarBackdrop').addEventListener('click', () => closeMobileSidebar({ restoreFocus: true }));
  document.addEventListener('click', event => {
    if (!event.target.closest('#exportButton, #backupInput, #settingsButton, #logoutButton')) return;
    closeMobileSidebar();
  });
  window.addEventListener('resize', closeMobileSidebar);
  const desktopSidebarToggle = $('#desktopSidebarToggle');
  desktopSidebarToggle.addEventListener('click', () => {
    const collapsed = document.body.classList.toggle('sidebar-collapsed');
    desktopSidebarToggle.setAttribute('aria-expanded', String(!collapsed));
    desktopSidebarToggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Minimize sidebar');
    desktopSidebarToggle.textContent = collapsed ? '›' : '‹';
    localStorage.setItem('jeff-va-sidebar-collapsed', String(collapsed));
  });
  if (localStorage.getItem('jeff-va-sidebar-collapsed') === 'true') {
    document.body.classList.add('sidebar-collapsed');
    desktopSidebarToggle.setAttribute('aria-expanded', 'false');
    desktopSidebarToggle.setAttribute('aria-label', 'Expand sidebar');
    desktopSidebarToggle.textContent = '›';
  }

  window.addEventListener('focus', () => {
    if (currentUser && gmailAccessToken) syncGmail(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentUser && gmailAccessToken) syncGmail(true);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('#mainSidebar').classList.contains('open')) {
      event.preventDefault();
      closeMobileSidebar({ restoreFocus: true });
    }
  });

  closeMobileSidebar();
