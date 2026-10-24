  function updateWeekNavigationCounts() {
    const applicationRange = applicationDateSort && applicationDateSort !== 'all' ? weekRange(Number(applicationDateSort)) : null;
    const emailRange = emailDateSort === 'all' ? null : weekRange(Number(emailDateSort));
    const relevantReceivedEmails = receivedEmails();
    $('#navApplicationCount').textContent = !applicationDateSort || applicationDateSort === 'all'
      ? pipelineApplications().length
      : pipelineApplications().filter(item => isInWeeklyRange(applicationAppliedDate(item), applicationRange)).length;
    $('#navEmailCount').textContent = emailDateSort === 'all'
      ? relevantReceivedEmails.length
      : relevantReceivedEmails.filter(item => isInWeeklyRange(item.date, emailRange)).length;
  }

  function updateToApplyAttention() {
    const hasUnfinishedApplications = (data.toApply || []).some(item => item.dueDate && item.dueDate <= today());
    const link = $('[data-view="to-apply"]');
    link.classList.toggle('to-apply-attention', hasUnfinishedApplications);
    link.setAttribute('aria-label', hasUnfinishedApplications ? 'To Apply - action needed' : 'To Apply');
  }

  function renderCurrentView() {
    const viewName = typeof activeView !== 'undefined' ? activeView : (localStorage.getItem(ACTIVE_VIEW_KEY) || 'dashboard');
    switch (viewName) {
      case 'dashboard':
        renderClientDashboard();
        renderDashboard();
        break;
      case 'daily-task':
        renderDailyTasks();
        break;
      case 'applications':
        renderApplications();
        break;
      case 'to-apply':
        renderToApplyList();
        break;
      case 'hired':
        renderHired();
        break;
      case 'inbox':
        renderEmails();
        break;
      case 'documents':
        renderPersonalDocuments();
        renderScripts();
        renderWorkLinks();
        renderInvoiceList();
        break;
      case 'wallet':
        renderWallet();
        break;
      case 'subscriptions':
        renderSubscriptions();
        break;
      case 'news':
        if (!newsLoading && (!newsLastLoaded || Date.now() - newsLastLoaded >= 3600000)) loadNews({ reset: true });
        break;
      case 'social-trends':
        renderSocialTrends();
        break;
      case 'account':
        renderAccountPage();
        break;
    }
  }

  const inboxSeenEmailIds = new Map();

  function updateInboxAttention() {
    const dot = $('#navEmailNewDot');
    if (!dot) return;
    if (!currentUser?.id || !dataReady || !supabaseDataLoaded) {
      dot.hidden = true;
      return;
    }
    const userId = currentUser.id;
    const key = `jeff-va-inbox-seen-v1:${userId}`;
    const ids = receivedEmails().map(item => String(item.gmailId || item.id || '')).filter(Boolean);
    if (!inboxSeenEmailIds.has(userId)) {
      let saved;
      try { saved = JSON.parse(localStorage.getItem(key)); } catch {}
      inboxSeenEmailIds.set(userId, Array.isArray(saved) ? new Set(saved) : null);
    }
    // Establish a baseline once; opening the inbox acknowledges every received
    // message regardless of the currently selected date or Sent/Received tab.
    if (!inboxSeenEmailIds.get(userId) || activeView === 'inbox') {
      inboxSeenEmailIds.set(userId, new Set(ids));
      try { localStorage.setItem(key, JSON.stringify(ids)); } catch {}
    }
    const seen = inboxSeenEmailIds.get(userId);
    dot.hidden = !ids.some(id => !seen.has(id));
  }

  function renderAll() {
    if (typeof scheduleSavedEmailAiCheck === 'function') scheduleSavedEmailAiCheck();
    // perf: keep match caches until the application snapshot changes, instead of blowing them away on every rerender.
    invalidateApplicationMatchCaches();
    processContractEndedAlerts();
    renderCurrentView();
    updateWeekNavigationCounts();
    updateInboxAttention();
    $('#navToApplyCount').textContent = (data.toApply || []).filter(item => item.dueDate === today()).length;
    updateToApplyAttention();
    $('#navHiredCount').textContent = hiredClients().filter(isActiveContract).length;
    $('#navSubscriptionsCount').textContent = (data.subscriptions || []).filter(item => ['soon', 'expired'].includes(subscriptionStatus(item).key)).length;
    $('#settingsAppCount').textContent = data.applications.length;
    $('#settingsEmailCount').textContent = receivedEmails().length;
    const autoBackupFrequency = $('#autoBackupFrequency');
    if (autoBackupFrequency) autoBackupFrequency.value = localStorage.getItem('jeff-va-auto-backup-frequency-v1') || 'off';
    renderAlerts();
    renderWeeklyReportAvailability();
    $$('.nav-count').forEach(count => count.classList.toggle('is-zero', Number(count.textContent) === 0));
  }

  function showView(view, { updateUrl = true } = {}) {
    if (view === 'password') view = 'account';
    if (!APP_VIEW_SET.has(view)) view = 'dashboard';
    if (view === 'account' && !hasAccountSettingsAccess()) view = 'dashboard';
    if (view !== 'dashboard') closeClientDashboardDrawer();
    if (view === 'account') {
      localStorage.setItem(ACTIVE_VIEW_KEY, view);
      if (updateUrl && window.location.pathname !== appViewPath(view)) {
        window.history.pushState({ view }, '', appViewPath(view));
      }
      openWorkspaceSettings();
      return;
    }
    if (updateUrl && (window.location.pathname !== appViewPath(view) || window.location.search || window.location.hash)) {
      window.history.pushState({ view }, '', appViewPath(view));
    }
    localStorage.setItem(ACTIVE_VIEW_KEY, view);
    activeView = view;
    updateInboxAttention();
    if (view === 'applications') {
      applicationDateSort = '0';
      applicationDateFilter = '';
      $('#applicationDateSort').value = '0';
      $('#applicationDateFilter').value = '';
      $('#statusFilter').value = 'Applied';
    }
    if (view === 'hired') {
      showingHiredClientList = true;
      hiredEditingId = null;
    }
    // perf: render the requested view on entry while renderAll skips inactive pages.
    renderCurrentView();
    if (view === 'account') {
      renderPasswordPage();
      renderAccountPage();
      refreshAccountStorageUsage();
    }
    const labels = { dashboard: [activeDashboardTab === 'client' ? 'CLIENT WORKSPACE' : 'YOUR PIPELINE', activeDashboardTab === 'client' ? 'Client Dashboard' : 'Application Dashboard'], 'daily-task': ['', 'Daily Tasks'], applications: ['', 'Applications'], 'to-apply': ['APPLICATION PIPELINE', 'To Apply'], news: ['', 'News'], 'social-trends': ['', 'Social Trends'], hired: ['', 'Active Clients'], inbox: ['', 'Email'], documents: ['PRIVATE TOOLS', 'Tools'], account: ['', 'Account'] };
    labels.wallet = ['', 'Wallet'];
    labels.subscriptions = ['', 'Account subscriptions'];
    $('#pageEyebrow').textContent = labels[view][0];
    $('#pageTitle').textContent = labels[view][1];
    $('#pageEyebrow').hidden = !labels[view][0];
    $('#pageTitle').hidden = false;
    $('#hiredCountLabel').hidden = view !== 'hired' || !showingHiredClientList;
    $('#hiredHeaderSummary').hidden = view !== 'hired' || !showingHiredClientList;
    $('#applicationWeekDate').hidden = view !== 'applications';
    $('#toApplyHeaderContext').hidden = view !== 'to-apply';
    $('#emailWeekDate').hidden = view !== 'inbox';
    $('#dailyTaskHeaderDate').hidden = view !== 'daily-task';
    $$('.view').forEach(panel => panel.classList.toggle('active', panel.dataset.viewPanel === view));
    $$('.nav-link').forEach(link => {
      const isCurrentRoute = link.dataset.view === view;
      link.classList.toggle('active', isCurrentRoute);
      if (isCurrentRoute) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    // The header Add client action belongs exclusively to the Applications view.
    // Keep it hidden everywhere else, including when navigating from the sidebar.
    const addClientButton = $('#openAddModal');
    addClientButton.hidden = activeView !== 'applications';
    addClientButton.setAttribute('aria-hidden', String(activeView !== 'applications'));
    const gmailHeaderActions = $('#gmailHeaderActions');
    gmailHeaderActions?.classList.toggle('hidden', activeView !== 'inbox');
    closeMobileSidebar({ restoreFocus: window.matchMedia('(max-width: 720px)').matches });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (view === 'inbox' && currentUser) syncGmail(true);
  }

