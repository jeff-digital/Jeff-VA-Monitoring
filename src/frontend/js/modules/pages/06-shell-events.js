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
    const previousInterviewMonth = event.target.closest('#previousInterviewMonth');
    const nextInterviewMonth = event.target.closest('#nextInterviewMonth');
    const calendarClientButton = event.target.closest('[data-calendar-client]');
    const alertOpenButton = event.target.closest('[data-alert-open]');

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
      $('#notificationPanel').classList.add('hidden');
      $('#notificationButton').setAttribute('aria-expanded', 'false');
      if (alert?.type === 'interview' && alert.applicationId) {
        showView('applications');
        openClientModal(alert.applicationId, true);
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
        showView('hired');
        renderHiredDetail(item);
      } else if ((alert?.type === 'document-email-reminder' || alert?.type === 'onboarding-submission') && alert.applicationId) {
        showView('hired');
        renderHiredDetail(data.applications.find(item => item.id === alert.applicationId));
      } else {
        showView('inbox');
      }
    }
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
      $('#notificationPanel').classList.add('hidden');
      $('#notificationButton').setAttribute('aria-expanded', 'false');
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
