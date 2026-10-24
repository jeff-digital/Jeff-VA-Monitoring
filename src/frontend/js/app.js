(() => {
  'use strict';

  const STORAGE_KEY = 'client-compass-data-v1'; // Legacy key name retained only for migration detection; app data is no longer stored in localStorage.
  const ACTIVE_VIEW_KEY = 'jeff-va-active-view-v1';
  const APPLICATION_DRAFT_KEY = 'jeff-va-new-application-draft-v1';
  const SUPABASE_BUCKET = 'client-documents';
  const STORAGE_PLAN_KEY = 'jeff-va-storage-plan-v1';
  const CUSTOM_STORAGE_QUOTA_KEY = 'jeff-va-custom-storage-quota-gb-v1';
  const AUTH_PROVIDER_SESSION_KEY = 'jeff-va-auth-provider-v1';
  const AUTH_TAB_READY_KEY = 'jeff-va-auth-tab-ready-v1';
  const WORKSPACE_READY_NOTICE_KEY = 'jeff-va-workspace-ready-v1';
  const APP_VIEWS = ['dashboard', 'daily-task', 'applications', 'to-apply', 'news', 'social-trends', 'hired', 'inbox', 'documents', 'subscriptions', 'wallet', 'account'];
  const APP_VIEW_SET = new Set(APP_VIEWS);
  const appViewPath = view => `/${APP_VIEW_SET.has(view) ? view : 'dashboard'}`;
  function appViewFromLocation() {
    const hashView = window.location.hash.slice(1);
    if (APP_VIEW_SET.has(hashView)) return hashView;
    const pathView = window.location.pathname.split('/').filter(Boolean).pop() || '';
    return APP_VIEW_SET.has(pathView) ? pathView : '';
  }
  const emptyData = () => ({ applications: [], toApply: [], dailyTasks: [], clientTasks: [], socialTrends: [], emails: [], deletedGmailIds: [], alerts: [], onboardingSubmissionIds: [], emailTemplates: [], personalDocuments: [], invoices: [], scripts: [], workLinks: [], walletEntries: [], subscriptions: [], accountSignInHistory: [], weeklyActivityGoal: null });
  let supabaseClient = null;
  let currentUser = null;
  let activeAuthProvider = null;
  let appStateChannel = null;
  let gmailSyncTimer = null;
  let gmailSyncInFlight = false;
  let applyReminderTimer = null;
  let initializingUserId = null;
  let welcomeTransitionStartedAt = 0;
  let persistChain = Promise.resolve();
  let persistWritePending = false;
  let pendingPersistWrites = 0;
  let saveIndicatorTimer = null;
  const MAX_LOCAL_WRITE_STAMPS = 20;
  const lastLocalWriteStamps = new Set();
  let dataReady = false;
  let supabaseDataLoaded = false;
  let projectStorageUsedBytes = null;
  let projectStorageFileCount = 0;
  let passwordRecoveryMode = false;
  const STATUS_COLORS = {
    'To Apply': '#69717d', Ongoing: '#16756f', Replied: '#16756f', Applied: '#2563a6',
    'To Proceed': '#2f6f9f', Interview: '#7550a3', Offer: '#187443',
    'Active client': '#187443', Rejected: '#ad343d', 'Not selected': '#ad343d', Ghosted: '#8a6331'
  };
  const STATUS_CLASS = { 'To Apply': 'to-apply', Ongoing: 'ongoing', Replied: 'responded', Applied: 'applied', 'To Proceed': 'to-proceed', 'To Proceeding': 'to-proceed', Interview: 'interview', Offer: 'offer', 'Active client': 'active-client', Rejected: 'rejected', 'Not selected': 'not-selected', Ghosted: 'ghosted' };
  const STATUS_LABELS = { 'Not selected': 'Rejected', 'To Proceeding': 'To Proceed' };
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  function setButtonLoading(button, loading) {
    if (!button) return;
    button.classList.toggle('is-loading', loading);
    button.toggleAttribute('aria-busy', loading);
    button.disabled = loading;
  }

  function showButtonFeedback(button) {
    if (!button || button.disabled) return;
    button.classList.remove('is-pressed');
    void button.offsetWidth;
    button.classList.add('is-pressed');
    window.setTimeout(() => button.classList.remove('is-pressed'), 180);
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('button, .button');
    if (button) showButtonFeedback(button);
  });

  document.addEventListener('submit', event => {
    const submitter = event.submitter;
    if (!submitter || submitter.disabled || submitter.value === 'cancel') return;
    submitter.classList.add('is-submitting');
    window.setTimeout(() => submitter.classList.remove('is-submitting'), 520);
  });
  let appConfirmResolve = null;
  function appConfirm(message, { title = 'Confirm action', confirmLabel = 'Continue', danger = false, showCloseButton = true } = {}) {
    return new Promise(resolve => {
      const modal = $('#appConfirmModal');
      if (modal.open) {
        resolve(false);
        return;
      }
      $('#appConfirmTitle').textContent = title;
      $('#appConfirmMessage').textContent = message;
      $('.app-confirm-close')?.toggleAttribute('hidden', !showCloseButton);
      const acceptButton = $('#appConfirmAccept');
      acceptButton.textContent = confirmLabel;
      acceptButton.className = `button ${danger ? 'button-danger' : 'button-primary'}`;
      appConfirmResolve = resolve;
      modal.returnValue = '';
      modal.showModal();
      acceptButton.focus();
    });
  }
  $('#appConfirmAccept').addEventListener('click', () => $('#appConfirmModal').close('confirm'));
  $('#appConfirmModal').addEventListener('close', () => {
    const resolve = appConfirmResolve;
    appConfirmResolve = null;
    resolve?.($('#appConfirmModal').returnValue === 'confirm');
  });
  const actionResultQueue = [];
  let actionResultAction = null;
  const actionResultModal = $('#emailActionResultModal');
  $('#emailActionResultAction')?.addEventListener('click', () => {
    const action = actionResultAction;
    actionResultModal.close('action');
    action?.();
  });
  actionResultModal?.addEventListener('close', () => {
    actionResultAction = null;
    const nextResult = actionResultQueue.shift();
    if (nextResult) setTimeout(() => showActionResult(nextResult), 0);
  });

  function showActionResult({ title = 'Action complete', message = '', status = 'success', label = '', actionLabel = '', onAction = null, details = [], showCloseButton = true } = {}) {
    const modal = $('#emailActionResultModal');
    if (!modal) {
      toast(message);
      return;
    }
    if (modal.open) {
      actionResultQueue.push({ title, message, status, label, actionLabel, onAction, details, showCloseButton });
      return;
    }
    const isError = status === 'error';
    const isInfo = status === 'info';
    modal.dataset.status = isError ? 'error' : isInfo ? 'info' : 'success';
    $('#emailActionResultEyebrow').textContent = label || (isError ? 'ACTION FAILED' : isInfo ? 'NOTICE' : 'SUCCESS');
    $('#emailActionResultTitle').textContent = title;
    $('#emailActionResultMessage').textContent = message;
    $('.email-result-close')?.toggleAttribute('hidden', !showCloseButton);
    const detailList = $('#emailActionResultDetails');
    detailList.replaceChildren(...details.map(detail => {
      const item = document.createElement('article');
      item.className = 'client-email-alert-item';
      item.setAttribute('role', 'listitem');
      if (detail.matchType) {
        const category = document.createElement('span');
        category.className = 'client-email-alert-category';
        category.dataset.kind = detail.matchType === 'Active client' ? 'active-client' : detail.matchType === 'Ended client' ? 'ended-client' : 'application';
        category.textContent = detail.matchType;
        item.append(category);
      }

      const heading = document.createElement('div');
      heading.className = 'client-email-alert-heading';
      const client = document.createElement('strong');
      client.textContent = detail.clientName || 'Client';
      const date = document.createElement('time');
      date.textContent = detail.date ? emailDate(detail.date) : '';
      heading.append(client, date);

      const subject = document.createElement('span');
      subject.className = 'client-email-alert-subject';
      subject.textContent = detail.subject || '(No subject)';

      const sender = document.createElement('small');
      if (detail.kind === 'application-rejection') {
        date.textContent = detail.date ? `Applied ${emailDate(detail.date)}` : '';
        sender.textContent = 'Status changed to Rejected after one calendar month';
      } else {
        sender.textContent = `From ${detail.from || 'Unknown sender'}${detail.taskCreated ? ' · Task created automatically' : ''}`;
      }
      item.append(heading, subject, sender);
      return item;
    }));
    detailList.hidden = details.length === 0;
    const badge = $('#emailActionResultBadge');
    badge.classList.toggle('error', isError);
    badge.classList.toggle('info', isInfo);
    badge.classList.toggle('success', !isError && !isInfo);
    const icon = document.createElement('i');
    icon.className = `fa-solid ${isError ? 'fa-triangle-exclamation' : isInfo ? 'fa-circle-info' : 'fa-check'}`;
    icon.setAttribute('aria-hidden', 'true');
    badge.replaceChildren(icon);
    actionResultAction = typeof onAction === 'function' ? onAction : null;
    const actionButton = $('#emailActionResultAction');
    actionButton.hidden = !actionResultAction;
    actionButton.textContent = actionLabel || 'Open';
    modal.showModal();
    $('#emailActionResultAccept').focus();
  }

  function showEmailActionResult(options = {}) {
    showActionResult({ ...options, label: 'EMAIL STATUS' });
  }

  function showApplicationRejectionNotice(applications) {
    showActionResult({
      title: 'Applications automatically rejected',
      message: 'These applications were still marked Ongoing or Applied one calendar month after their Applied date.',
      status: 'info',
      label: 'APPLICATION STATUS',
      details: applications.map(application => ({
        kind: 'application-rejection',
        clientName: application.clientName || 'Untitled application',
        date: application.appliedDate,
        subject: application.role || 'Role not specified'
      }))
    });
  }

  function userHasPasswordIdentity(user = currentUser) {
    return Boolean(user?.app_metadata?.providers?.includes('email')
      || user?.identities?.some(identity => identity.provider === 'email'));
  }

  function resolveAuthProvider(session) {
    if (session?.provider_token) return 'google';
    const savedProvider = sessionStorage.getItem(AUTH_PROVIDER_SESSION_KEY);
    if (savedProvider === 'google' || savedProvider === 'email') return savedProvider;
    return !userHasPasswordIdentity(session?.user) ? 'google' : 'email';
  }

  function hasAccountSettingsAccess() {
    return Boolean(currentUser);
  }

  function renderAccountAccess() {
    const settingsButton = $('#settingsButton');
    if (settingsButton) settingsButton.disabled = !hasAccountSettingsAccess();
  }

  function renderPasswordPage() {
    const isGoogleSession = activeAuthProvider === 'google';
    const hasPassword = userHasPasswordIdentity() && !isGoogleSession;
    $('#accountGooglePasswordNotice').hidden = !isGoogleSession;
    $('#passwordSettingsSection').hidden = isGoogleSession;
    $('#passwordRecoverySection').hidden = isGoogleSession || !hasPassword;
    $('#currentPasswordField').hidden = isGoogleSession || passwordRecoveryMode || !hasPassword;
    $('#currentPassword').required = !isGoogleSession && !passwordRecoveryMode && hasPassword;
    $('#saveNewPasswordButton').textContent = hasPassword ? 'Save password' : passwordRecoveryMode ? 'Reset password' : 'Set password';
    $('#passwordRecoveryNotice').classList.toggle('hidden', !passwordRecoveryMode);
  }

  function formatAccountTimestamp(value) {
    if (!value) return 'Not available';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? 'Not available'
      : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function recordAccountSignIn(user, provider) {
    const signedInAt = user.last_sign_in_at || new Date().toISOString();
    const history = Array.isArray(data.accountSignInHistory) ? data.accountSignInHistory : [];
    if (history.some(entry => entry.userId === user.id && entry.signedInAt === signedInAt)) return false;
    data.accountSignInHistory = [{
      id: `${user.id}:${signedInAt}`,
      userId: user.id,
      signedInAt,
      provider: provider === 'google' ? 'Google' : 'Email and password'
    }, ...history].slice(0, 20);
    return true;
  }

  function renderAccountPage() {
    if (!currentUser) return;
    const provider = activeAuthProvider === 'google' ? 'Google' : activeAuthProvider === 'email' ? 'Email and password' : 'Supabase Auth';
    const projectHost = (() => {
      try { return new URL(window.SUPABASE_URL).host; } catch { return 'Not configured'; }
    })();
    const supabaseStatus = !supabaseConfigured()
      ? 'Not configured'
      : !navigator.onLine
        ? 'Offline'
        : supabaseDataLoaded
          ? 'Connected'
          : dataReady
            ? 'Unavailable'
            : 'Connecting';
    const gmailSyncMessage = $('#accountGmailSyncStatus').textContent;
    const gmailNeedsAttention = /failed|expired|not set up|unavailable|paused|needs.*cloudflare/i.test(gmailSyncMessage);
    const gmailStatus = !navigator.onLine
      ? 'Offline'
      : !gmailConfigured()
        ? 'Not configured'
        : gmailReconnectRequired
          ? 'Permission required'
          : gmailNeedsAttention
            ? 'Needs attention'
            : gmailAccessToken
              ? 'Connected'
              : 'Not connected';
    $('#accountEmail').textContent = currentUser.email || 'Not available';
    $('#accountUserId').textContent = currentUser.id || 'Not available';
    $('#accountSignInProvider').textContent = provider;
    $('#accountSupabaseStatus').textContent = supabaseStatus;
    $('#accountSupabaseProject').textContent = projectHost;
    $('#accountNetworkStatus').textContent = navigator.onLine ? 'Online' : 'Offline';
    $('#accountGmailStatus').textContent = gmailStatus;
    updateGmailConnectionUI(Boolean(gmailAccessToken && !gmailReconnectRequired));
    $('#accountLastSignIn').textContent = formatAccountTimestamp(currentUser.last_sign_in_at);
    $('#accountCreatedAt').textContent = formatAccountTimestamp(currentUser.created_at);
    const history = Array.isArray(data.accountSignInHistory) ? data.accountSignInHistory : [];
    const list = $('#accountSignInHistory');
    list.replaceChildren();
    $('#accountNoSignIns').hidden = history.length > 0;
    history.forEach(entry => {
      const item = document.createElement('li');
      const method = document.createElement('span');
      method.textContent = entry.provider || 'Sign-in';
      const timestamp = document.createElement('time');
      timestamp.dateTime = entry.signedInAt || '';
      timestamp.textContent = formatAccountTimestamp(entry.signedInAt);
      item.append(method, timestamp);
      list.append(item);
    });
  }

  function selectedStorageQuotaBytes() {
    const plan = $('#accountStoragePlan').value;
    if (plan === 'free') return 1_000_000_000;
    if (plan === 'pro-team') return 100_000_000_000;
    if (plan === 'custom') {
      const customQuotaGb = Number($('#accountStorageCustomQuota').value);
      return Number.isFinite(customQuotaGb) && customQuotaGb > 0 ? customQuotaGb * 1_000_000_000 : null;
    }
    return null;
  }

  function formatStorageQuota(bytes) {
    if (bytes >= 1_000_000_000) {
      const gigabytes = bytes / 1_000_000_000;
      const roundedGigabytes = Math.round(gigabytes * 10) / 10;
      return `${Number.isInteger(roundedGigabytes) ? roundedGigabytes : roundedGigabytes.toFixed(1)} GB`;
    }
    if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
    return formatFileSize(bytes);
  }

  function renderProjectStorageSummary() {
    const plan = $('#accountStoragePlan').value;
    const quotaBytes = selectedStorageQuotaBytes();
    const quotaLabels = { free: '1 GB', 'pro-team': '100 GB' };
    const quotaLabel = quotaLabels[plan] || (quotaBytes ? formatStorageQuota(quotaBytes) : 'Select plan');
    $('#accountProjectStorageQuota').textContent = quotaLabel;
    if (projectStorageUsedBytes === null) {
      $('#accountProjectStorageUsage').textContent = 'Unavailable';
    } else if (quotaBytes) {
      const usedPercent = (projectStorageUsedBytes / quotaBytes) * 100;
      const percentLabel = usedPercent > 0 && usedPercent < 1 ? '<1%' : `${Math.round(usedPercent)}%`;
      $('#accountProjectStorageUsage').textContent = `${formatStorageQuota(projectStorageUsedBytes)} / ${quotaLabel} (${percentLabel}) · ${plural(projectStorageFileCount, 'file')}`;
    } else {
      $('#accountProjectStorageUsage').textContent = `${formatFileSize(projectStorageUsedBytes)} across ${plural(projectStorageFileCount, 'file')}`;
    }
    if (projectStorageUsedBytes === null) {
      $('#accountProjectStorageAvailable').textContent = 'Usage unavailable';
    } else if (!quotaBytes) {
      $('#accountProjectStorageAvailable').textContent = plan === 'custom' ? 'Enter custom quota' : 'Select plan';
    } else {
      const remainingBytes = quotaBytes - projectStorageUsedBytes;
      if (remainingBytes >= 0) {
        const remainingPercent = Math.max(0, (remainingBytes / quotaBytes) * 100);
        const percentLabel = remainingPercent > 0 && remainingPercent < 1 ? '<1%' : `${Math.round(remainingPercent)}%`;
        $('#accountProjectStorageAvailable').textContent = `${formatStorageQuota(remainingBytes)} (${percentLabel})`;
      } else {
        $('#accountProjectStorageAvailable').textContent = `${formatStorageQuota(Math.abs(remainingBytes))} over quota`;
      }
    }
  }

  const storagePlanControl = $('#accountStoragePlan');
  const customStorageQuotaControl = $('#accountStorageCustomQuota');
  const customStorageQuotaField = $('#accountStorageCustomQuotaField');
  storagePlanControl.value = localStorage.getItem(STORAGE_PLAN_KEY) || 'free';
  customStorageQuotaControl.value = localStorage.getItem(CUSTOM_STORAGE_QUOTA_KEY) || '';
  customStorageQuotaField.hidden = storagePlanControl.value !== 'custom';
  storagePlanControl.addEventListener('change', () => {
    if (storagePlanControl.value) localStorage.setItem(STORAGE_PLAN_KEY, storagePlanControl.value);
    else localStorage.removeItem(STORAGE_PLAN_KEY);
    customStorageQuotaField.hidden = storagePlanControl.value !== 'custom';
    renderProjectStorageSummary();
  });
  customStorageQuotaControl.addEventListener('input', () => {
    if (customStorageQuotaControl.value) localStorage.setItem(CUSTOM_STORAGE_QUOTA_KEY, customStorageQuotaControl.value);
    else localStorage.removeItem(CUSTOM_STORAGE_QUOTA_KEY);
    renderProjectStorageSummary();
  });
  renderProjectStorageSummary();

  async function refreshAccountStorageUsage() {
    const output = $('#accountStorageUsage');
    const refreshButton = $('#refreshAccountStorageUsage');
    if (!currentUser || !output || !refreshButton || refreshButton.disabled) return;
    const userId = currentUser.id;
    output.textContent = 'Checking...';
    $('#accountProjectStorageUsage').textContent = 'Checking...';
    $('#accountProjectStorageAvailable').textContent = 'Checking...';
    refreshButton.disabled = true;
    try {
      const client = requireSupabase();
      try {
        const { data: usage, error } = await client.rpc('get_project_storage_usage');
        if (error) throw error;
        const summary = Array.isArray(usage) ? usage[0] : usage;
        const usedBytes = Number(summary?.total_bytes);
        const fileCount = Number(summary?.file_count);
        if (!Number.isFinite(usedBytes) || usedBytes < 0 || !Number.isFinite(fileCount) || fileCount < 0) {
          throw new Error('The project storage summary is invalid.');
        }
        projectStorageUsedBytes = usedBytes;
        projectStorageFileCount = fileCount;
      } catch (error) {
        projectStorageUsedBytes = null;
        projectStorageFileCount = 0;
        console.error('Could not load project storage usage:', error);
      }
      renderProjectStorageSummary();

      const bucket = client.storage.from(SUPABASE_BUCKET);
      const folders = [userId];
      let totalBytes = 0;
      let fileCount = 0;
      while (folders.length) {
        const folder = folders.pop();
        let offset = 0;
        while (true) {
          const { data: entries, error } = await bucket.list(folder, { limit: 100, offset });
          if (error) throw error;
          const objects = entries || [];
          objects.forEach(object => {
            if (object.id === null && object.metadata === null) {
              folders.push(`${folder}/${object.name}`);
              return;
            }
            const size = Number(object.metadata?.size);
            if (!Number.isFinite(size) || size < 0) throw new Error('A stored file size is unavailable.');
            totalBytes += size;
            fileCount += 1;
          });
          if (objects.length < 100) break;
          offset += objects.length;
        }
      }
      if (currentUser?.id === userId) output.textContent = `${formatFileSize(totalBytes)} across ${plural(fileCount, 'file')}`;
    } catch (error) {
      console.error('Could not load account storage usage:', error);
      if (currentUser?.id === userId) output.textContent = 'Unavailable';
      projectStorageUsedBytes = null;
      projectStorageFileCount = 0;
      renderProjectStorageSummary();
    } finally {
      refreshButton.disabled = false;
    }
  }

  $('#refreshAccountStorageUsage').addEventListener('click', refreshAccountStorageUsage);

  function openWorkspaceSettings() {
    const accountView = $('#accountView');
    $('#settingsAccountContent').append(accountView);
    accountView.classList.add('active');
    renderPasswordPage();
    renderAccountPage();
    refreshAccountStorageUsage();
    renderGmailSyncStatus();
    renderEmailTaskAiStatus();
    if (!$('#settingsModal').open) $('#settingsModal').showModal();
  }

  function setPasswordRecoveryMode(value) {
    passwordRecoveryMode = Boolean(value);
  }

  function openPasswordPage({ recovery = false } = {}) {
    passwordRecoveryMode = recovery;
    $('#changePasswordForm').reset();
    $('#changePasswordError').textContent = '';
    renderPasswordPage();
    showView('account');
    $('#newPassword').focus();
  }
  const today = () => {
    const date = new Date();
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 10);
  };
  const localDateKey = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  const addDays = (date, days) => {
    const result = new Date(`${date}T12:00:00`);
    result.setDate(result.getDate() + days);
    return result.toISOString().slice(0, 10);
  };
  const uid = () => (crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  const SESSION_KEY = 'jeff-va-session-v1';
  const EMAIL_WEEK_FILTER_KEY = 'jeff-va-email-week-filter-v1';
  function weeklyActivityGoalStorageKey() {
    return `jeff-va-weekly-activity-goal-v1:${currentUser?.id || 'anonymous'}`;
  }
  function normalizeWeeklyActivityGoal(value) {
    const goal = Number(value);
    return Number.isInteger(goal) && goal >= 1 && goal <= 100 ? goal : null;
  }
  let data = emptyData();
  let clientTimeZones = new Map();
  let activeView = 'dashboard';
  let activeDashboardTab = 'client';
  let emailViewFilter = 'client';
  let emailSelectionMode = false;
  let applicationDateSort = 'all';
  let applicationViewMode = localStorage.getItem('jeff-va-application-view-v1') === 'board' ? 'board' : 'table';
  let applicationSelectionMode = false;
  const selectedApplicationIds = new Set();
  let hiredDateSort = 'newest';
  let emailDateSort = localStorage.getItem(EMAIL_WEEK_FILTER_KEY) || 'all';
  let applicationDateFilter = '';
  let emailDateFilter = '';
  let interviewCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const contractEndedEmailSending = new Set();
  let pendingActiveClientId = null;
  let editingId = null;
  let hiredEditingId = null;
  let pendingDocumentFile = null;
  let pendingDocumentPreviewUrl = null;
  let pendingInvoiceFile = null;
  let pendingInvoiceClientId = null;
  let pendingInvoiceDetails = {};
  let pendingActivation = null;
  let toastTimer;
  let viewingClientDetails = false;

  function isAuthenticated() {
    return Boolean(currentUser);
  }

  function setAuthenticated(value) {
    if (value) document.body.classList.add('authenticated');
    else document.body.classList.remove('authenticated');
  }

  function supabaseConfigured() {
    return Boolean(window.SUPABASE_URL && window.SUPABASE_ANON_KEY && window.supabase?.createClient);
  }

  function createRememberedAuthStorage() {
    const memory = new Map();
    const projectRef = new URL(window.SUPABASE_URL).hostname.split('.')[0];
    const storageKey = `jeff-va-auth-remembered-${projectRef}-v1`;
    const storage = {
      getItem(key) {
        try {
          return window.localStorage.getItem(key);
        } catch {}
        return memory.get(key) ?? null;
      },
      setItem(key, value) {
        memory.set(key, value);
        try { window.localStorage.setItem(key, value); } catch {}
      },
      removeItem(key) {
        memory.delete(key);
        try { window.localStorage.removeItem(key); } catch {}
      }
    };
    // Carry the current tab's login forward once. Remove the old copy so logout
    // cannot restore an obsolete session when the page opens again.
    try {
      const tabIdKey = 'jeff-va-auth-tab-id-v1';
      const tabId = window.sessionStorage.getItem(tabIdKey);
      if (tabId) {
        const oldKey = `jeff-va-auth-${tabId}`;
        const previous = window.sessionStorage.getItem(oldKey);
        if (!storage.getItem(storageKey) && previous) storage.setItem(storageKey, previous);
        window.sessionStorage.removeItem(oldKey);
        window.sessionStorage.removeItem(tabIdKey);
      }
      window.localStorage.removeItem(`sb-${projectRef}-auth-token`);
    } catch {}
    return { storage, storageKey };
  }

  function requireSupabase() {
    if (!supabaseConfigured()) throw new Error('Account sign-in is unavailable. Check the app configuration.');
    if (!supabaseClient) {
      const rememberedAuth = createRememberedAuthStorage();
      supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          storage: rememberedAuth.storage,
          storageKey: rememberedAuth.storageKey,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
    }
    return supabaseClient;
  }

  function dedupeEmails(items = []) {
    const seen = new Set();
    return items.filter(item => {
      const key = item.source === 'gmail' && item.gmailId
        ? `gmail:${item.gmailId}`
        : `email:${item.id || `${item.from}|${item.to}|${item.subject}|${item.date}`}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function loadDataFromSupabase() {
    const client = requireSupabase();
    if (!currentUser) return emptyData();
    const { data: row, error } = await client
      .from('app_state')
      .select('data')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (error) throw error;
    const saved = row?.data || {};
    const deletedGmailIds = Array.isArray(saved.deletedGmailIds) ? saved.deletedGmailIds : [];
    const deletedGmailIdSet = new Set(deletedGmailIds);
    const weeklyActivityGoal = normalizeWeeklyActivityGoal(saved.weeklyActivityGoal)
      ?? normalizeWeeklyActivityGoal(localStorage.getItem(weeklyActivityGoalStorageKey()));
    return {
      applications: Array.isArray(saved.applications) ? saved.applications : [],
      toApply: Array.isArray(saved.toApply) ? saved.toApply : [],
      dailyTasks: Array.isArray(saved.dailyTasks) ? saved.dailyTasks : [],
      clientTasks: Array.isArray(saved.clientTasks) ? saved.clientTasks : [],
      emailTaskAiUsage: saved.emailTaskAiUsage || null,
      socialTrends: Array.isArray(saved.socialTrends) ? saved.socialTrends : [],
      emails: dedupeEmails(Array.isArray(saved.emails) ? saved.emails : []).filter(item => !(item.source === 'gmail' && deletedGmailIdSet.has(item.gmailId))),
      deletedGmailIds,
      accountSignInHistory: Array.isArray(saved.accountSignInHistory) ? saved.accountSignInHistory : [],
      alerts: Array.isArray(saved.alerts) ? saved.alerts : [],
      onboardingSubmissionIds: Array.isArray(saved.onboardingSubmissionIds) ? saved.onboardingSubmissionIds : [],
      emailTemplates: Array.isArray(saved.emailTemplates) ? saved.emailTemplates : [],
      personalDocuments: Array.isArray(saved.personalDocuments) ? saved.personalDocuments : [],
      invoices: Array.isArray(saved.invoices) ? saved.invoices : [],
      scripts: Array.isArray(saved.scripts) ? saved.scripts : [],
      workLinks: Array.isArray(saved.workLinks) ? saved.workLinks : [],
      walletEntries: Array.isArray(saved.walletEntries) ? saved.walletEntries : [],
      subscriptions: Array.isArray(saved.subscriptions) ? saved.subscriptions : [],
      weeklyActivityGoal
    };
  }

  function rememberLocalWriteStamp(updatedAt) {
    if (!updatedAt) return;
    lastLocalWriteStamps.add(updatedAt);
    if (lastLocalWriteStamps.size > MAX_LOCAL_WRITE_STAMPS) {
      const oldestStamp = lastLocalWriteStamps.values().next().value;
      if (oldestStamp !== undefined) lastLocalWriteStamps.delete(oldestStamp);
    }
  }

  function updateSaveIndicator(state) {
    const indicator = $('#saveIndicator');
    const label = $('#saveIndicatorText');
    if (!indicator || !label) return;
    if (saveIndicatorTimer) {
      clearTimeout(saveIndicatorTimer);
      saveIndicatorTimer = null;
    }
    indicator.className = `local-indicator is-${state}`;
    indicator.hidden = false;
    label.textContent = state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Save failed';
    if (state === 'saved') {
      saveIndicatorTimer = setTimeout(() => {
        indicator.hidden = true;
        indicator.className = 'local-indicator';
        label.textContent = '';
        saveIndicatorTimer = null;
      }, 2200);
    }
  }

  function persist() {
    if (!currentUser || !supabaseClient || !dataReady || !supabaseDataLoaded) {
      console.warn('Skipped cloud save because the workspace is not ready.');
      if (currentUser) updateSaveIndicator('error');
      return Promise.resolve(false);
    }
    const snapshot = JSON.parse(JSON.stringify(data));
    const userId = currentUser.id;
    const client = supabaseClient;
    const updatedAt = new Date().toISOString();
    // perf: remember our own writes so repeat realtime echoes do not trigger a reload loop.
    rememberLocalWriteStamp(updatedAt);
    pendingPersistWrites += 1;
    persistWritePending = true;
    updateSaveIndicator('saving');
    let saved = false;
    const write = persistChain.then(async () => {
      if (!client || !userId) return;
      let lastError = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { error } = await client.from('app_state').upsert({
          user_id: userId,
          data: snapshot,
          updated_at: updatedAt
        }, { onConflict: 'user_id' });
        if (!error) {
          saved = true;
          return;
        }
        lastError = error;
        if (attempt < 2) await new Promise(resolve => window.setTimeout(resolve, 350 * (attempt + 1)));
      }
      console.error('Supabase save failed after retries:', lastError);
      showActionResult({ title: 'Cloud save failed', message: 'Your change could not be saved to your account. Check your connection and try again.', status: 'error' });
      throw lastError || new Error('Cloud save failed.');
    });
    const result = write.then(() => true).catch(() => false).finally(() => {
      pendingPersistWrites = Math.max(0, pendingPersistWrites - 1);
      persistWritePending = pendingPersistWrites > 0;
      if (!pendingPersistWrites) updateSaveIndicator(saved ? 'saved' : 'error');
    });
    // Keep the queue alive after a failure, while allowing the caller that
    // initiated this save to know whether its snapshot reached Supabase.
    persistChain = result.then(() => undefined);
    // Keep the local Documents Excel copy current too. The function debounces
    // rapid edits, so this does not create a file for every keystroke.
    queueDocumentsBackup({ immediate: true });
    return result;
  }

  function startAuthTransition(title, copy, name = '') {
    const transition = $('#welcomeTransition');
    if (!transition || !transition.hidden) return;
    const titleElement = $('#welcomeTransitionTitle');
    titleElement.firstChild.textContent = title;
    const nameElement = $('#welcomeTransitionName');
    nameElement.hidden = !name;
    nameElement.textContent = name;
    $('#welcomeTransitionCopy').textContent = copy;
    transition.classList.remove('is-visible', 'is-leaving');
    transition.hidden = false;
    document.body.classList.add('auth-loading');
    welcomeTransitionStartedAt = performance.now();
    requestAnimationFrame(() => transition.classList.add('is-visible'));
  }

  function startWelcomeTransition(user) {
    const metadata = user.user_metadata || {};
    const metadataName = [metadata.full_name, metadata.name, metadata.display_name]
      .find(value => typeof value === 'string' && value.trim());
    const displayName = metadataName || user.email?.split('@')[0] || 'there';
    startAuthTransition('Welcome back, ', 'Getting your workspace ready…', displayName.trim().split(/\s+/)[0] || 'there');
  }

  async function finishWelcomeTransition() {
    const transition = $('#welcomeTransition');
    if (!transition || transition.hidden) return;
    // Keep the welcome state visible long enough for its entrance animation to
    // complete, while still moving into the workspace quickly.
    const minimumDuration = 900;
    const elapsed = performance.now() - welcomeTransitionStartedAt;
    await new Promise(resolve => setTimeout(resolve, Math.max(0, minimumDuration - elapsed)));
    transition.classList.remove('is-visible');
    transition.classList.add('is-leaving');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    await new Promise(resolve => setTimeout(resolve, reducedMotion ? 0 : 100));
    transition.hidden = true;
    transition.classList.remove('is-leaving');
    document.body.classList.remove('auth-loading');
  }

  async function waitForWorkspaceData(promise, timeoutMs = 15000) {
    let timeoutId;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timeoutId = window.setTimeout(() => reject(new Error('The workspace data request took too long.')), timeoutMs);
        })
      ]);
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
    }
  }

  async function initializeSupabaseForUser(user, { showLoading = true, recordSignIn = false, showOverview = false } = {}) {
    if (!user) return;
    if (initializingUserId === user.id) {
      if (showLoading) startWelcomeTransition(user);
      return;
    }
    if (currentUser?.id === user.id && dataReady) {
      if (showLoading) {
        startWelcomeTransition(user);
        await finishWelcomeTransition();
      }
      return;
    }
    initializingUserId = user.id;
    if (showLoading) startWelcomeTransition(user);
    currentUser = user;
    clientTimeZones.clear();
    renderAccountAccess();
    dataReady = false;
    supabaseDataLoaded = false;
    setAuthenticated(true);
    if (showOverview) showView('dashboard');
    subscribeToAppState(user.id);
    if (!applyReminderTimer) applyReminderTimer = setInterval(() => {
      if (!currentUser) return;
      if (dataReady && supabaseDataLoaded) {
        const autoRejectedApplications = processStaleApplications();
        if (autoRejectedApplications.length) {
          renderAll();
          persist();
          showApplicationRejectionNotice(autoRejectedApplications);
        }
      }
      processDueApplyReminders();
      processDueInterviews();
      processDueDocumentEmailReminders();
      processContractEndedAlerts();
      refreshClientOnboardingAlerts();
    }, 60000);
    const loginStatus = $('#loginGoogleStatus');
    if (loginStatus) loginStatus.textContent = 'Signed in successfully. Loading your dashboard…';
    try {
      data = await waitForWorkspaceData(loadDataFromSupabase());
    } catch (error) {
      console.error('Could not load workspace data from Supabase:', error);
      data = emptyData();
      supabaseDataLoaded = false;
      dataReady = true;
      showActionResult({
        title: 'Could not load workspace data',
        message: `The request for your saved account data failed${error?.message ? `: ${error.message}` : '.'} Check the service connection and try again.`,
        status: 'error'
      });
      await finishWelcomeTransition();
      initializingUserId = null;
      renderAll();
      renderAccountPage();
      return;
    }

    supabaseDataLoaded = true;
    dataReady = true;
    let autoRejectedApplications = [];
    let workspaceRenderFailed = false;
    try {
      startNotificationRefreshTimer();
      startSavedEmailAiChecks();
      if (recordSignIn) recordAccountSignIn(user, activeAuthProvider);
      autoRejectedApplications = processStaleApplications();
      renderAll();
      renderAccountPage();
    } catch (error) {
      workspaceRenderFailed = true;
      console.error('Workspace rendering failed after sign-in:', error);
      try {
        showActionResult({
          title: 'Dashboard could not finish loading',
          message: `You are signed in, but the dashboard could not finish rendering${error?.message ? `: ${error.message}` : '.'} Refresh the page to try again.`,
          status: 'error'
        });
      } catch (noticeError) {
        console.error('Could not show the dashboard loading error:', noticeError);
      }
    } finally {
      // Never leave the welcome screen or initialization lock active when an
      // optional dashboard renderer fails after authentication succeeds.
      await finishWelcomeTransition();
      initializingUserId = null;
    }
    if (workspaceRenderFailed) return;
    if (localStorage.getItem(`${APPLICATION_DRAFT_KEY}:${user.id}`)) openClientModal();

    // Everything below is useful refresh work, but none of it is required to
    // enter the dashboard. Keep it outside the login critical path.
    window.setTimeout(async () => {
      let startupStage = 'processing workspace reminders';
      try {
        if (!currentUser || currentUser.id !== user.id) return;
        await processDueFollowUps();
        processDueApplyReminders();
        processDueInterviews();
        processDueDocumentEmailReminders();
        processContractEndedAlerts();
        renderAll();
        renderAccountPage();
        startupStage = 'refreshing client onboarding alerts';
        await refreshClientOnboardingAlerts();
        if (gmailAccessToken) {
          startupStage = 'syncing Gmail';
          startGmailSyncTimer();
          await syncGmail(true);
        }
        startupStage = 'saving workspace changes';
        await persist();
        scheduleAutomaticBackup();
        if (autoRejectedApplications.length) showApplicationRejectionNotice(autoRejectedApplications);
      } catch (error) {
        console.error(`Workspace refresh failed while ${startupStage}:`, error);
      }
    }, 0);
  }

  function subscribeToAppState(userId) {
    if (!supabaseClient || !userId) return;
    if (appStateChannel) supabaseClient.removeChannel(appStateChannel);
    appStateChannel = supabaseClient.channel(`app-state-${userId}`).on('postgres_changes', {
      event: '*', schema: 'public', table: 'app_state', filter: `user_id=eq.${userId}`
    }, async (payload) => {
      if (!dataReady || !currentUser || currentUser.id !== userId) return;
      const updatedAt = payload?.new?.updated_at;
      // perf: ignore the realtime echo from our own local write and any queued local save still in flight.
      if (updatedAt && lastLocalWriteStamps.has(updatedAt)) return;
      if (persistWritePending) return;
      try {
        data = await loadDataFromSupabase();
        renderAll();
      } catch (error) {
        console.error('Could not refresh live app state:', error);
      }
    }).subscribe();
  }

  async function restoreSupabaseSession() {
    if (!supabaseConfigured()) return;
    const isFirstLoadInTab = sessionStorage.getItem(AUTH_TAB_READY_KEY) !== '1';
    sessionStorage.setItem(AUTH_TAB_READY_KEY, '1');
    const callbackParams = new URLSearchParams(`${window.location.search}&${window.location.hash.slice(1)}`);
    const isPasswordRecovery = callbackParams.get('type') === 'recovery';
    const isAuthenticationCallback = callbackParams.has('code')
      || (callbackParams.has('access_token') && callbackParams.has('refresh_token'));
    const callbackKeys = ['error', 'error_description', 'access_token', 'refresh_token', 'code', 'type'];
    const hasCallbackParams = callbackKeys.some(key => callbackParams.has(key));
    const callbackView = 'dashboard';
    if (hasCallbackParams) {
      window.history.replaceState({ view: callbackView }, document.title, appViewPath(callbackView));
    }
    if (callbackParams.get('error')) {
      const description = callbackParams.get('error_description') || callbackParams.get('error');
      $('#loginError').textContent = description.includes('exchange external code')
        ? 'Google sign-in could not complete the authorization exchange. Check the OAuth client configuration.'
        : `Google sign-in failed: ${description}`;
      $('#loginGoogleStatus').textContent = 'Sign-in could not be completed. You can try again after correcting the provider settings.';
      return;
    }
    try {
      const client = requireSupabase();
      const accessToken = callbackParams.get('access_token');
      const refreshToken = callbackParams.get('refresh_token');
      const callbackCode = callbackParams.get('code');
      let callbackProviderSession = null;
      let { data: sessionData, error } = await client.auth.getSession();
      if (error) throw error;
      if (accessToken && refreshToken) {
        const callbackResult = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (callbackResult.error) throw callbackResult.error;
        callbackProviderSession = callbackResult.data?.session;
        ({ data: sessionData, error } = await client.auth.getSession());
        if (error) throw error;
      }
      if (callbackCode && !accessToken) {
        const exchangeResult = await client.auth.exchangeCodeForSession(callbackCode);
        if (exchangeResult.error) throw exchangeResult.error;
        callbackProviderSession = exchangeResult.data?.session;
        ({ data: sessionData, error } = await client.auth.getSession());
        if (error) throw error;
      }
      // Supabase's setSession restores dashboard credentials, but may omit
      // Google's provider tokens from the returned session. Keep the provider
      // grant from this callback before removing it from the URL.
      const googleSession = sessionData.session ? {
        ...sessionData.session,
        provider_token: callbackParams.get('provider_token') || callbackProviderSession?.provider_token || sessionData.session.provider_token,
        provider_refresh_token: callbackParams.get('provider_refresh_token') || callbackProviderSession?.provider_refresh_token || sessionData.session.provider_refresh_token
      } : null;
      captureGoogleSession(googleSession, isAuthenticationCallback);
      if (sessionData.session?.user) {
        activeAuthProvider = isPasswordRecovery ? 'email' : resolveAuthProvider(sessionData.session);
        if (isAuthenticationCallback && !isPasswordRecovery) {
          showView(callbackView, { updateUrl: false });
        }
        await initializeSupabaseForUser(sessionData.session.user, {
          showLoading: !isPasswordRecovery && (isAuthenticationCallback || isFirstLoadInTab),
          recordSignIn: isAuthenticationCallback && !isPasswordRecovery,
          showOverview: !isPasswordRecovery
        });
        if (isPasswordRecovery) openPasswordPage({ recovery: true });
      }
      client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT' && currentUser) {
          dataReady = false;
          setAuthenticated(false);
          window.location.reload();
          return;
        }
        if (event !== 'SIGNED_IN' || !session?.user) return;
        // Password sign-in and OAuth callback restoration initialize the session
        // directly. Defer this fallback so those paths cannot start a second load.
        window.setTimeout(() => {
          if (currentUser || initializingUserId) return;
          activeAuthProvider = resolveAuthProvider(session);
          captureGoogleSession(session, true);
          initializeSupabaseForUser(session.user, {
            showLoading: !isPasswordRecovery && isFirstLoadInTab,
            recordSignIn: !isPasswordRecovery,
            showOverview: !isPasswordRecovery
          });
        }, 0);
      });
    } catch (error) {
      console.error('Could not restore Supabase session:', error);
      $('#loginError').textContent = 'Google sign-in returned, but the session could not be restored. Check the authentication redirect URL.';
      $('#loginGoogleStatus').textContent = 'Sign-in could not be completed.';
    }
  }

  async function clearSupabaseData() {
    if (!currentUser || !supabaseClient) return;
    const client = supabaseClient;
    const paths = (data.applications || []).flatMap(application => (application.documents || []).map(doc => doc.storagePath || `${currentUser.id}/${doc.id}`));
    if (paths.length) {
      const { error: storageError } = await client.storage.from(SUPABASE_BUCKET).remove(paths);
      if (storageError) throw storageError;
    }
    const personalPaths = (data.personalDocuments || []).map(document => document.storagePath).filter(Boolean);
    if (personalPaths.length) {
      const { error: personalStorageError } = await client.storage.from(SUPABASE_BUCKET).remove(personalPaths);
      if (personalStorageError) throw personalStorageError;
    }
    const { error } = await client.from('app_state').delete().eq('user_id', currentUser.id);
    if (error) throw error;
    data = emptyData();
    supabaseDataLoaded = true;
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function formatDate(value) {
    if (!value) return 'No date';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
      ? new Date(`${value}T12:00:00`)
      : new Date(value);
    return Number.isNaN(date.getTime())
      ? String(value)
      : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  }

  function relativeDate(value) {
    if (!value) return 'No date';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  }

  function emailDate(value) {
    if (!value) return 'No date';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  }

  function emailTime(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
  }

  function applicationAddedDate(item) {
    return item.createdAt || item.updatedAt || item.appliedDate;
  }

  function applicationAppliedDate(item) {
    return item.appliedDate || applicationAddedDate(item);
  }

  function activeSinceDate(item) {
    return item.activeAt || item.appliedDate;
  }

  function sortByDate(items, getDate, direction = 'newest') {
    const multiplier = direction === 'oldest' ? 1 : -1;
    return [...items].sort((a, b) => {
      const firstDate = new Date(getDate(a) || 0).getTime();
      const secondDate = new Date(getDate(b) || 0).getTime();
      const first = Number.isNaN(firstDate) ? 0 : firstDate;
      const second = Number.isNaN(secondDate) ? 0 : secondDate;
      return (first - second) * multiplier;
    });
  }

  function dateKey(value) {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : localDateKey(date);
  }

  function plural(number, word) { return `${number} ${word}${number === 1 ? '' : 's'}`; }

  function receivedEmails() {
    const deletedGmailIds = new Set(data.deletedGmailIds || []);
    return data.emails.filter(item => !isSentEmail(item)
      && !(item.source === 'gmail' && deletedGmailIds.has(item.gmailId)));
  }

  function isSentEmail(item) {
    if (item.direction === 'sent' || item.source === 'sent' || item.labelIds?.includes('SENT')) return true;
    const sender = extractEmailAddress(item.from);
    const ownAddresses = [currentUser?.email, ...(currentUser?.identities || []).map(identity => identity.identity_data?.email)]
      .filter(Boolean).map(email => String(email).trim().toLowerCase());
    return Boolean(sender && ownAddresses.includes(sender));
  }

  function manualApplicationStatusTimestamp(existing, nextStatus, now = new Date().toISOString()) {
    return existing && existing.status !== nextStatus ? now : existing?.manualStatusChangedAt || '';
  }

  function statusPill(status) {
    return `<span class="status-pill ${STATUS_CLASS[status] || ''}">${escapeHtml(STATUS_LABELS[status] || status)}</span>`;
  }

  function salaryCurrencySymbol(currency = 'USD') {
    return currency === 'PHP' ? '₱' : '$';
  }

  function formatSalaryAmount(amount, currency = 'USD', type = 'monthly', hoursPerWeek = 0) {
    const numeric = Number(amount || 0);
    const symbol = salaryCurrencySymbol(currency);
    if (!Number.isFinite(numeric) || numeric <= 0) return `${symbol}0`;
    if (type === 'hourly' && Number(hoursPerWeek) > 0) {
      return `${symbol}${Math.round(numeric * Number(hoursPerWeek) * 4).toLocaleString()} / month`;
    }
    return `${symbol}${Math.round(numeric).toLocaleString()}${type === 'monthly' ? ' / month' : ' / hour'}`;
  }

  function isInterviewToday(item) {
    return item.status === 'Interview' && dateKey(item.interviewDate) === today();
  }

  function isToProceedStatus(item) {
    return item.status === 'To Proceed' || item.status === 'To Proceeding';
  }

  function sortedApplications() {
    return [...data.applications].sort((a, b) => Number(Boolean(b.interviewPriority)) - Number(Boolean(a.interviewPriority)) || new Date(b.updatedAt || b.appliedDate) - new Date(a.updatedAt || a.appliedDate));
  }

  // Once a client's status is "Active client", they move to the Active Clients page and drop out
  // of the Applications tracker — this is the shared list both the Dashboard's recent table and
  // the Applications page itself pull from, so they stay in sync with each other.
  function pipelineApplications() {
    return data.applications.filter(item => item.status !== 'Active client' || item.activePendingDocument || item.activePendingEmail);
  }

  function processStaleApplications() {
    const todayDate = new Date(`${today()}T00:00:00`);
    const updatedAt = new Date().toISOString();
    const changedApplications = [];
    for (const application of data.applications) {
      if (!['Ongoing', 'Applied'].includes(application.status)) continue;
      const appliedDateKey = dateKey(application.appliedDate);
      if (!appliedDateKey) continue;
      const [year, month, day] = appliedDateKey.split('-').map(Number);
      const appliedDate = new Date(year, month - 1, day);
      if (Number.isNaN(appliedDate.getTime())
        || appliedDate.getFullYear() !== year
        || appliedDate.getMonth() !== month - 1
        || appliedDate.getDate() !== day) continue;
      const nextMonth = month;
      const lastDayOfNextMonth = new Date(year, nextMonth + 1, 0).getDate();
      const rejectionDate = new Date(year, nextMonth, Math.min(day, lastDayOfNextMonth));
      if (todayDate < rejectionDate) continue;
      application.status = 'Not selected';
      application.updatedAt = updatedAt;
      changedApplications.push(application);
    }
    return changedApplications;
  }

  function sortedPipelineApplications() {
    return sortByDate(pipelineApplications(), applicationAppliedDate);
  }

  // --- Application/email matching ---
  const PLATFORM_SENDER_EMAILS = Object.freeze({
    '20four7va': 'info@20four7va.com',
    indeed: 'donotreply@jobalert.indeed.com',
    jobstreet: 'noreply@e.jobstreet.com',
    multiplymii: 'info@multiplymii.com',
    'onlinejobs.ph': 'support@onlinejobs.ph',
    'remote work ph': 'support@remotework.ph',
    zirtual: 'noreply@candidates.workablemail.com'
  });
  const PLATFORM_DISPLAY_NAMES = Object.freeze({
    '20four7va': '20four7VA',
    indeed: 'Indeed',
    jobstreet: 'Jobstreet',
    multiplymii: 'MultiplyMii',
    'onlinejobs.ph': 'OnlineJobs.ph',
    'remote work ph': 'Remote Work PH',
    zirtual: 'Zirtual'
  });
  let applicationEmailMatchesCache = new WeakMap();
  let applicationEmailSummaryCache = null;
  let applicationEmailSummarySource = null;
  let applicationEmailSummaryCount = 0;
  let ambiguousEmailMatches = new WeakMap();
  const GENERIC_DISAMBIGUATION_ROLE_WORDS = new Set([
    'virtual', 'assistant', 'manager', 'specialist', 'marketing', 'digital', 'remote', 'wfh', 'wfo'
  ]);
  let applicationMatchIndex = [];
  let applicationMatchIndexSignature = '';

  let activeClientDetailsModalEdit = false;
  const CLIENT_SOCIAL_PLATFORM_LABELS = Object.freeze({
    facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', twitter: 'X / Twitter',
    linkedin: 'LinkedIn', youtube: 'YouTube', pinterest: 'Pinterest', website: 'Website', other: 'Other'
  });

  function inferClientSocialPlatform(url = '') {
    const value = String(url).toLowerCase();
    if (value.includes('facebook.com') || value.includes('fb.com')) return 'facebook';
    if (value.includes('instagram.com')) return 'instagram';
    if (value.includes('tiktok.com')) return 'tiktok';
    if (value.includes('twitter.com') || value.includes('x.com')) return 'twitter';
    if (value.includes('linkedin.com')) return 'linkedin';
    if (value.includes('youtube.com') || value.includes('youtu.be')) return 'youtube';
    if (value.includes('pinterest.com') || value.includes('pin.it')) return 'pinterest';
    return 'website';
  }

  function normalizeClientSocialLinks(item = {}) {
    const source = Array.isArray(item.socialLinks) ? item.socialLinks : [];
    const links = source.map(link => {
      const url = String(link?.url || '').trim();
      const platform = Object.prototype.hasOwnProperty.call(CLIENT_SOCIAL_PLATFORM_LABELS, link?.platform)
        ? link.platform
        : inferClientSocialPlatform(url);
      return { platform, url };
    }).filter(link => link.url);
    if (!links.length && String(item.socialMedia || '').trim()) {
      const url = String(item.socialMedia).trim();
      links.push({ platform: inferClientSocialPlatform(url), url });
    }
    const seen = new Set();
    return links.filter(link => {
      const key = link.url.toLowerCase().replace(/\/$/, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function clientSocialPlatformOptions(selected = 'website') {
    return Object.entries(CLIENT_SOCIAL_PLATFORM_LABELS).map(([value, label]) =>
      `<option value="${value}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
  }

  function clientSocialHref(link) {
    const value = String(link?.url || '').trim();
    if (!value.startsWith('@')) return normalizeUrl(value);
    const handle = value.slice(1);
    const platformRoots = {
      facebook: 'https://facebook.com/', instagram: 'https://instagram.com/', tiktok: 'https://tiktok.com/@',
      twitter: 'https://x.com/', linkedin: 'https://linkedin.com/in/', youtube: 'https://youtube.com/@',
      pinterest: 'https://pinterest.com/'
    };
    return `${platformRoots[link.platform] || 'https://'}${handle}`;
  }

  function clientSocialDisplay(link) {
    const label = CLIENT_SOCIAL_PLATFORM_LABELS[link.platform] || 'Link';
    const value = String(link.url || '').trim();
    if (value.startsWith('@')) return `${label} · ${value}`;
    try {
      const parsed = new URL(normalizeUrl(value));
      const account = parsed.pathname.split('/').filter(Boolean).pop()
        || parsed.hostname.replace(/^www\./, '');
      return `${label} · ${decodeURIComponent(account)}`;
    } catch {
      return label;
    }
  }

  function updateClientSocialEditorControls(viewOnly = viewingClientDetails) {
    const rows = $$('#clientSocialLinksList .client-social-link-row');
    const addButton = $('#addClientSocialLink');
    if (addButton) {
      addButton.hidden = viewOnly;
      addButton.disabled = viewOnly || rows.length >= 12;
    }
    rows.forEach(row => {
      const removeButton = row.querySelector('[data-remove-client-social-link]');
      if (removeButton) removeButton.hidden = viewOnly;
    });
  }

  function renderClientSocialLinkEditor(links = [], viewOnly = false) {
    const target = $('#clientSocialLinksList');
    if (!target) return;
    const entries = links.length ? links : [{ platform: 'website', url: '' }];
    target.innerHTML = entries.slice(0, 12).map((link, index) => {
      const platform = Object.prototype.hasOwnProperty.call(CLIENT_SOCIAL_PLATFORM_LABELS, link?.platform) ? link.platform : inferClientSocialPlatform(link?.url);
      return `<div class="client-social-link-row">
        <label><span class="sr-only">Platform ${index + 1}</span><select data-client-social-platform aria-label="Social platform ${index + 1}">${clientSocialPlatformOptions(platform)}</select></label>
        <label><span class="sr-only">Profile URL or handle ${index + 1}</span><input data-client-social-url type="text" inputmode="url" maxlength="500" value="${escapeHtml(String(link?.url || ''))}" placeholder="Profile URL or @handle" aria-label="Profile URL or handle ${index + 1}" /></label>
        <button class="client-social-remove" type="button" data-remove-client-social-link aria-label="Remove ${escapeHtml(CLIENT_SOCIAL_PLATFORM_LABELS[platform])} account" title="Remove account"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>
      </div>`;
    }).join('');
    updateClientSocialEditorControls(viewOnly);
  }

  function readClientSocialLinks({ includeEmpty = false } = {}) {
    const seen = new Set();
    return $$('#clientSocialLinksList .client-social-link-row').map(row => ({
      platform: row.querySelector('[data-client-social-platform]')?.value || 'website',
      url: row.querySelector('[data-client-social-url]')?.value.trim() || ''
    })).filter(link => {
      if (includeEmpty && !link.url) return true;
      if (!link.url) return false;
      const key = link.url.toLowerCase().replace(/\/$/, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function clientSocialLinksMarkup(item) {
    const links = normalizeClientSocialLinks(item);
    if (!links.length) return '';
    return `<span class="client-social-detail-links">${links.map(link => `<a href="${escapeHtml(clientSocialHref(link))}" target="_blank" rel="noopener" title="${escapeHtml(link.url)}"><span>${escapeHtml(clientSocialDisplay(link))}</span><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>`).join('')}</span>`;
  }

  $('#addClientSocialLink')?.addEventListener('click', () => {
    const links = readClientSocialLinks({ includeEmpty: true });
    if (links.length >= 12) return;
    links.push({ platform: 'website', url: '' });
    renderClientSocialLinkEditor(links);
    $('#clientSocialLinksList .client-social-link-row:last-child [data-client-social-platform]')?.focus();
  });
  $('#clientSocialLinksList')?.addEventListener('click', event => {
    const removeButton = event.target.closest('[data-remove-client-social-link]');
    if (!removeButton) return;
    removeButton.closest('.client-social-link-row')?.remove();
    if (!$('#clientSocialLinksList .client-social-link-row')) renderClientSocialLinkEditor();
    updateClientSocialEditorControls(false);
  });


  function applicationMatchSignature(applications = data.applications || []) {
    return (applications || []).map(application => [
      application.id || '',
      application.updatedAt || '',
      application.email || '',
      application.contact || '',
      application.clientName || '',
      application.role || '',
      application.appliedDate || '',
      application.website || '',
      application.platform || '',
      application.status || '', application.contractStatus || '', application.contractEndDate || '',
      Boolean(application.activePendingDocument), Boolean(application.activePendingEmail)
    ].join('|')).join('~');
  }

  // perf: precompute the application fields used by matching once per application snapshot instead of rescanning every row on each email.
  function buildApplicationMatchIndex(applications = data.applications || []) {
    const signature = applicationMatchSignature(applications);
    if (signature === applicationMatchIndexSignature && applicationMatchIndex.length === applications.length) return applicationMatchIndex;
    applicationMatchIndex = (applications || []).map(application => {
      const email = String(application.email || '').trim().toLowerCase();
      const contact = String(application.contact || '').trim().toLowerCase();
      const clientName = String(application.clientName || '').trim().toLowerCase();
      const role = String(application.role || '').trim().toLowerCase();
      const matchContact = normalizeMatchText(contact);
      const matchClientName = normalizeMatchText(clientName);
      const matchRole = normalizeMatchText(role);
      const roleNorm = normalizeApplicationMatchEvidence(role);
      const coreRoleNorm = roleNorm.replace(/\s+(?:wfh|wfo|remote|hybrid|on(?: site|site)?|work from (?:home|office))$/i, '');
      const contactNorm = normalizeApplicationMatchEvidence(contact);
      const roleWordCount = roleNorm.split(' ').length;
      const coreRoleWordCount = coreRoleNorm.split(' ').length;
      const platformKey = platformKeyForName(application.platform);
      return {
        application,
        email,
        emailIsPlatformSender: PLATFORM_SENDER_EMAIL_SET.has(email),
        contact,
        clientName,
        role,
        matchContact,
        matchClientName,
        matchRole,
        roleNorm,
        coreRoleNorm,
        roleIsMatchable: roleWordCount > 1 || (roleNorm.length >= 10 && !GENERIC_DISAMBIGUATION_ROLE_WORDS.has(roleNorm)),
        coreRoleIsMatchable: coreRoleWordCount > 1 || (coreRoleNorm.length >= 10 && !GENERIC_DISAMBIGUATION_ROLE_WORDS.has(coreRoleNorm)),
        roleLastWord: roleNorm.split(' ').pop(),
        coreRoleLastWord: coreRoleNorm.split(' ').pop(),
        appliedDate: application.appliedDate || '',
        appliedTime: new Date(application.appliedDate || '').getTime(),
        contactNorm,
        contactLastWord: contactNorm.split(' ').pop(),
        roleIsSpecific: isSpecificApplicationRole(matchRole),
        platformKey,
        jobLinkTokens: applicationLinkTokens(application.website),
        roleGroupKey: `${platformKey || 'unknown'}|${matchRole}`,
        roleGroupCount: 0
      };
    });
    const roleGroupCounts = new Map();
    for (const item of applicationMatchIndex) {
      if (item.roleIsSpecific) roleGroupCounts.set(item.roleGroupKey, (roleGroupCounts.get(item.roleGroupKey) || 0) + 1);
    }
    for (const item of applicationMatchIndex) item.roleGroupCount = roleGroupCounts.get(item.roleGroupKey) || 0;
    applicationMatchIndexSignature = signature;
    return applicationMatchIndex;
  }

  function invalidateApplicationMatchCaches(applications = data.applications || []) {
    const nextSignature = applicationMatchSignature(applications);
    if (nextSignature !== applicationMatchIndexSignature) {
      applicationEmailMatchesCache = new WeakMap();
      applicationEmailSummaryCache = null;
      ambiguousEmailMatches = new WeakMap();
      buildApplicationMatchIndex(applications);
    }
  }

  function platformSenderEmail(platform) {
    return PLATFORM_SENDER_EMAILS[String(platform || '').trim().toLowerCase()] || '';
  }

  function platformNameForSender(fromHeader) {
    const senderAddress = extractEmailAddress(fromHeader);
    const platform = Object.keys(PLATFORM_SENDER_EMAILS)
      .find(name => PLATFORM_SENDER_EMAILS[name] === senderAddress);
    return platform ? PLATFORM_DISPLAY_NAMES[platform] : '';
  }

  function extractEmailAddress(fromHeader) {
    const match = (fromHeader || '').match(/<([^>]+)>/);
    return (match ? match[1] : (fromHeader || '')).trim().toLowerCase();
  }

  function isEmailAddress(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '');
  }

  function extractSenderName(fromHeader) {
    return (fromHeader || '').split('<')[0].replace(/["']/g, '').trim().toLowerCase();
  }

  function isDirectClientApplication(application) {
    const platform = String(application.platform || '').trim().toLowerCase();
    return platform === 'direct client' || platform === 'direct apply';
  }

  function containsWholeWord(haystack, needle) {
    if (!needle) return false;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack || '');
  }

  function isEmailTaskActiveClient(application) {
    return Boolean(application && isActiveContract(application)
      && !application.activePendingDocument && !application.activePendingEmail);
  }

  function activeClientsMatchingSender(emailItem) {
    if (isSentEmail(emailItem)) return [];
    const sender = extractEmailAddress(emailItem.from);
    if (!isEmailAddress(sender) || PLATFORM_SENDER_EMAIL_SET.has(sender)) return [];
    return data.applications.filter(application => isEmailTaskActiveClient(application)
      && extractEmailAddress(application.email) === sender);
  }

  function activeClientsForTaskEmail(emailItem) {
    if (!emailItem || isSentEmail(emailItem)) return [];
    return matchApplicationsForEmail(emailItem).filter(isEmailTaskActiveClient);
  }

  function matchApplicationsForEmail(emailItem) {
    // Outgoing emails may repeat a company's name and role, but they are not
    // evidence of a client response. Check before consulting cached matches.
    if (isSentEmail(emailItem)) return [];
    // Work emails from an established client's saved address don't need to
    // mention the original job title, and must not be treated as job replies.
    const activeClients = activeClientsMatchingSender(emailItem);
    if (activeClients.length) return activeClients;
    const cachedMatches = applicationEmailMatchesCache.get(emailItem);
    if (cachedMatches) return cachedMatches;
    const fromAddress = extractEmailAddress(emailItem.from);
    const senderName = extractSenderName(emailItem.from);
    const contentLower = `${emailItem.subject || ''} ${emailItem.body || ''}`.toLowerCase();
    const senderPlatformKey = platformKeyForName(platformNameForSender(fromAddress));
    const matches = [];
    if (senderPlatformKey) {
      const subjectText = normalizeMatchText(emailItem.subject);
      const bodySource = String(emailItem.body || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\bsent\s+via\s+[\w.-]+\s+contact\s+form\b/gi, ' ');
      const bodyText = normalizeMatchText(bodySource);
      const bodyLinkTokens = applicationLinkTokens(emailItem.body);
      const scoredMatches = [];
      const applicationIndex = buildApplicationMatchIndex(data.applications);
      for (const item of applicationIndex) {
        const score = platformApplicationMatchScore(item, senderPlatformKey, subjectText, bodyText, bodyLinkTokens, emailItem.date);
        if (score !== null) scoredMatches.push({ item, score });
      }
      let topCandidates = [];
      if (scoredMatches.length) {
        const highestScore = Math.max(...scoredMatches.map(match => match.score));
        topCandidates = scoredMatches.filter(match => match.score === highestScore).map(match => match.item);
      }
      if (topCandidates.length > 1) {
        const roleSubjectText = normalizeApplicationMatchEvidence(emailItem.subject);
        const roleBodyText = normalizeApplicationMatchEvidence(bodySource);
        matches.push(...disambiguateApplicationMatches(
          topCandidates, emailItem, roleSubjectText, roleBodyText, bodyLinkTokens
        ));
      } else if (topCandidates.length === 1) {
        const roleSubjectText = normalizeApplicationMatchEvidence(emailItem.subject);
        const roleBodyText = normalizeApplicationMatchEvidence(bodySource);
        if (!emailExplicitlyNamesDifferentRole(topCandidates[0], roleSubjectText, roleBodyText)) {
          matches.push(topCandidates[0].application);
        }
      }
      applicationEmailMatchesCache.set(emailItem, matches);
      return matches;
    }
    const applicationIndex = buildApplicationMatchIndex(data.applications);
    const candidateItems = [];
    for (const item of applicationIndex) {
      const { application, email, contact, clientName, role } = item;
      const roleReferenced = role.length >= 3 && contentLower.includes(role);
      const companyReferenced = clientName.length >= 3 && containsWholeWord(contentLower, clientName);
      if (email && !item.emailIsPlatformSender && email === fromAddress) {
        matches.push(application);
        candidateItems.push(item);
        continue;
      }
      if (!roleReferenced && !companyReferenced) continue;
      if ([contact, clientName].filter(name => name.length >= 3).some(name => containsWholeWord(senderName, name))) {
        matches.push(application);
        candidateItems.push(item);
      }
    }
    if (candidateItems.length > 1) {
      const subjectText = normalizeApplicationMatchEvidence(emailItem.subject);
      const bodyText = normalizeApplicationMatchEvidence(emailItem.body);
      matches.splice(0, matches.length, ...disambiguateApplicationMatches(
        candidateItems, emailItem, subjectText, bodyText, applicationLinkTokens(emailItem.body)
      ));
    } else if (candidateItems.length === 1) {
      const subjectText = normalizeApplicationMatchEvidence(emailItem.subject);
      const bodyText = normalizeApplicationMatchEvidence(emailItem.body);
      if (emailExplicitlyNamesDifferentRole(candidateItems[0], subjectText, bodyText)) {
        matches.length = 0;
      }
    }
    applicationEmailMatchesCache.set(emailItem, matches);
    return matches;
  }

  function applicationsRelatedToEmail(emailItem) {
    return isSentEmail(emailItem) ? [] : matchApplicationsForEmail(emailItem);
  }

  function buildApplicationEmailSummary() {
    const summary = new Map((data.applications || []).map(application => [application.id, []]));
    const seenIds = new Map((data.applications || []).map(application => [application.id, new Set()]));
    const seenGmailIds = new Map((data.applications || []).map(application => [application.id, new Set()]));
    for (const emailItem of data.emails || []) {
      for (const application of matchApplicationsForEmail(emailItem)) {
        const ids = seenIds.get(application.id);
        const gmailIds = seenGmailIds.get(application.id);
        if (!ids || !gmailIds) continue;
        const id = String(emailItem.id || '');
        const gmailId = String(emailItem.gmailId || '');
        const alreadySeen = (id && ids.has(id)) || (gmailId && gmailIds.has(gmailId));
        if (id) ids.add(id);
        if (gmailId) gmailIds.add(gmailId);
        if (!alreadySeen) summary.get(application.id)?.push(emailItem);
      }
    }
    return summary;
  }

  function matchingEmailsForApplication(application) {
    if (!applicationEmailSummaryCache || applicationEmailSummarySource !== data.emails
      || applicationEmailSummaryCount !== data.emails.length) {
      applicationEmailSummaryCache = buildApplicationEmailSummary();
      applicationEmailSummarySource = data.emails;
      applicationEmailSummaryCount = data.emails.length;
    }
    return applicationEmailSummaryCache.get(application.id) || [];
  }

  function openApplicationEmailsModal(applicationId) {
    const application = data.applications.find(item => item.id === applicationId);
    if (!application) return;
    const emails = matchingEmailsForApplication(application)
      .filter(emailItem => !isSentEmail(emailItem))
      .sort((first, second) => new Date(second.date) - new Date(first.date));
    if (!emails.length) return;
    $('#applicationEmailsTitle').textContent = `${application.clientName} · Emails`;
    $('#applicationEmailsSummary').textContent = plural(emails.length, 'matching email');
    $('#applicationEmailsList').innerHTML = emails.map(emailItem => `
      <article class="application-email-message">
        <header class="application-email-message-heading">
          <div><h3>${escapeHtml(emailItem.subject || '(No subject)')}</h3><p>${escapeHtml(emailItem.from || 'Unknown sender')}</p>${(() => {
            const otherRoles = (ambiguousEmailMatches.get(emailItem) || [])
              .filter(other => other !== application)
              .map(other => other.role)
              .filter(Boolean);
            return otherRoles.length
              ? `<small class="field-help">Could also belong to: ${escapeHtml([...new Set(otherRoles)].join(', '))}</small>`
              : '';
          })()}</div>
          <time>${escapeHtml(emailDate(emailItem.date))}</time>
        </header>
        <div class="application-email-message-body">${escapeHtml(emailContentText(emailItem.body) || 'No message body available.')}</div>
      </article>`).join('');
    $('#applicationEmailsModal').showModal();
  }

  function interviewDateFromEmail(emailItem) {
    const source = `${emailItem.subject || ''} ${emailItem.body || ''}`;
    const match = source.match(/\b(\d{4}-\d{1,2}-\d{1,2}|[A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?|\d{1,2}\/\d{1,2}\/\d{2,4})\b/);
    if (!match) return '';
    const parsed = new Date(match[1]);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
  }

  function isInterviewEmail(emailItem) {
    if (emailItem.applicationAiAnalysis?.rejectApplication === true) return false;
    const source = `${emailItem.subject || ''} ${emailItem.body || ''}`;
    return /\b(interview|meeting|video call|phone call|screening)\b/i.test(source);
  }

  function matchBadge(app) {
    const matches = matchingEmailsForApplication(app)
      .filter(emailItem => !isSentEmail(emailItem));
    if (!matches.length) return '';
    return ` <button class="match-badge" type="button" data-application-emails="${escapeHtml(app.id)}" aria-label="View ${plural(matches.length, 'matching email')} for ${escapeHtml(app.clientName)}" title="View matching application emails">${matches.length}</button>`;
  }


  function renderDashboard() {
    const applications = data.applications;
    const pipelineCount = pipelineApplications().length;
    const appliedToday = pipelineApplications().filter(item => dateKey(item.appliedDate) === today()).length;
    const followUp = applications.filter(item => item.followUpDate && item.followUpDate <= today() && item.status !== 'Active client' && item.status !== 'Not selected').length;
    const interviewsToday = applications.filter(item => item.status === 'Interview' && dateKey(item.interviewDate) === today()).length;
    const toApplyToday = (data.toApply || []).filter(item => item.dueDate && item.dueDate <= today()).length;
    $('#totalApplications').textContent = pipelineCount;
    $('#conversationClients').textContent = appliedToday;
    $('#followUpClients').textContent = followUp;
    $('#applicationsDetail').textContent = pipelineCount ? `${plural(pipelineCount, 'application')} in your tracker` : 'No applications tracked yet';
    $('#conversationDetail').textContent = appliedToday ? `${plural(appliedToday, 'application')} submitted today` : 'Applications submitted today';
    $('#followUpDetail').textContent = followUp ? `${plural(followUp, 'application')} due for a follow-up` : 'Applications to revisit soon';
    $('#todayFollowUps').textContent = followUp;
    $('#todayInterviews').textContent = interviewsToday;
    $('#todayToApply').textContent = toApplyToday;
    const weeklyApplicationCount = weeklyReportData().applications.length;
    const weeklyGoal = normalizeWeeklyActivityGoal(data.weeklyActivityGoal) || 0;
    $('#dashboardWeeklyActivity').textContent = weeklyGoal
      ? `${weeklyApplicationCount} of ${weeklyGoal} ${weeklyGoal === 1 ? 'application' : 'applications'}`
      : plural(weeklyApplicationCount, 'application');
    $('#dashboardWeeklyGoalLabel').textContent = weeklyGoal ? 'Weekly application goal' : 'Weekly goal not set';
    const weeklyProgress = $('#dashboardWeeklyProgress');
    weeklyProgress.hidden = !weeklyGoal;
    weeklyProgress.max = weeklyGoal || 1;
    weeklyProgress.value = Math.min(weeklyApplicationCount, weeklyGoal || 1);
    weeklyProgress.setAttribute('aria-valuemin', '0');
    weeklyProgress.setAttribute('aria-valuemax', String(weeklyGoal || 1));
    weeklyProgress.setAttribute('aria-valuenow', String(Math.min(weeklyApplicationCount, weeklyGoal || 1)));
    $('#openWeeklyGoalDialog').textContent = weeklyGoal ? 'Edit goal' : 'Set goal';
    renderPlatformBreakdown(applications);
    renderStatusChart(applications);
    renderInterviewCalendar();
    renderRecentApplications();
  }

  let clientDashboardSort = 'name';
  let clientDashboardSortDirection = 'asc';
  let clientDashboardSelectedId = '';
  let clientDashboardAction = '';
  let clientDashboardDrawerReturnFocus = null;

  function clientDashboardDaysLeft(item) {
    if (!item.contractEndDate || isContractEnded(item)) return null;
    const end = new Date(`${dateKey(item.contractEndDate)}T12:00:00`);
    const current = new Date(`${today()}T12:00:00`);
    return Number.isNaN(end.getTime()) ? null : Math.round((end - current) / 86400000);
  }

  function clientDashboardStatus(item) {
    if (isContractEnded(item)) return { key: 'ended', label: 'Ended' };
    if (String(item.contractStatus || '').toLowerCase() === 'not active'
      || String(item.contractStatus || '').toLowerCase() === 'paused') return { key: 'paused', label: 'Paused' };
    const daysLeft = clientDashboardDaysLeft(item);
    if (isActiveContract(item) && daysLeft !== null && daysLeft <= 30) return { key: 'ending', label: 'Ending soon' };
    return { key: 'active', label: 'Active' };
  }

  function clientDashboardLastContact(item) {
    const emailAddress = String(item.email || '').trim().toLowerCase();
    const matching = (data.emails || []).filter(email => email.applicationId === item.id
      || (emailAddress && [email.to, email.from].some(address => String(address || '').trim().toLowerCase() === emailAddress)));
    return matching.reduce((latest, email) => {
      const date = email.date || '';
      return dateKey(date) && (!latest || new Date(date) > new Date(latest)) ? date : latest;
    }, '');
  }

  function clientDashboardRate(item) {
    const amount = Number(item.salaryAmount);
    if (!(amount > 0) || !['monthly', 'hourly'].includes(item.salaryType)) return '';
    const symbol = item.salaryCurrency === 'PHP' ? '₱' : '$';
    return `${symbol}${amount.toLocaleString()} / ${item.salaryType === 'monthly' ? 'month' : 'hour'}`;
  }

  function clientDashboardMonthlyAmount(item) {
    const amount = Number(item.salaryAmount);
    if (!(amount > 0)) return 0;
    if (item.salaryType === 'monthly') return amount;
    if (item.salaryType === 'hourly' && Number(item.hoursPerWeek) > 0) return amount * Number(item.hoursPerWeek) * 4;
    return 0;
  }

  function clientDashboardMoneyByCurrency(clients) {
    const totals = new Map();
    clients.filter(isActiveContract).forEach(item => {
      const amount = clientDashboardMonthlyAmount(item);
      if (!amount) return;
      const currency = item.salaryCurrency === 'PHP' ? 'PHP' : 'USD';
      totals.set(currency, (totals.get(currency) || 0) + amount);
    });
    return [...totals].map(([currency, amount]) => `${currency === 'PHP' ? '₱' : '$'}${Math.round(amount).toLocaleString()}`).join(' · ');
  }

  function clientDashboardMatchesStatus(item, filter) {
    return filter === 'all' || clientDashboardStatus(item).key === filter;
  }

  function clientDashboardTableValue(item, key) {
    const daysLeft = clientDashboardDaysLeft(item);
    switch (key) {
      case 'name': return String(item.clientName || '').toLowerCase();
      case 'status': return clientDashboardStatus(item).label;
      case 'start': return dateKey(item.activeAt || item.appliedDate) || '';
      case 'end': return dateKey(item.contractEndDate) || '';
      case 'days': return daysLeft ?? Number.POSITIVE_INFINITY;
      case 'rate': return Number(item.salaryAmount) || 0;
      case 'contact': return clientDashboardLastContact(item) || '';
      default: return '';
    }
  }

  function renderClientDashboardTable(clients) {
    const query = $('#clientDashboardSearch').value.trim().toLowerCase();
    const filter = $('#clientDashboardStatusFilter').value;
    const filtered = clients.filter(item => {
      const haystack = [item.clientName, item.contact, item.email, item.role, item.companyName, item.company].join(' ').toLowerCase();
      return (!query || haystack.includes(query)) && clientDashboardMatchesStatus(item, filter);
    });
    const multiplier = clientDashboardSortDirection === 'asc' ? 1 : -1;
    filtered.sort((first, second) => {
      const a = clientDashboardTableValue(first, clientDashboardSort);
      const b = clientDashboardTableValue(second, clientDashboardSort);
      return (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))) * multiplier;
    });
    $('#clientDashboardListCount').textContent = plural(filtered.length, 'client');
    $$('#clientDashboardPanel [data-client-sort]').forEach(button => {
      button.closest('th')?.setAttribute('aria-sort', button.dataset.clientSort === clientDashboardSort
        ? (clientDashboardSortDirection === 'asc' ? 'ascending' : 'descending')
        : 'none');
    });
    const tbody = $('#clientDashboardTableBody');
    const empty = $('#clientDashboardEmpty');
    empty.hidden = filtered.length > 0;
    if (!filtered.length) {
      const hasClients = clients.length > 0;
      $('#clientDashboardEmptyTitle').textContent = hasClients ? 'No matching clients' : 'No clients yet';
      $('#clientDashboardEmptyMessage').textContent = hasClients
        ? 'Try changing your search or status filter.'
        : 'Clients you add from Applications will appear here for tracking.';
      tbody.innerHTML = '';
      return;
    }
    tbody.innerHTML = filtered.map(item => {
      const status = clientDashboardStatus(item);
      const daysLeft = clientDashboardDaysLeft(item);
      const lastContact = clientDashboardLastContact(item);
      const startDate = item.activeAt || item.appliedDate;
      const initials = clientInitials(item.clientName);
      const rate = clientDashboardRate(item);
      return `<tr data-client-row="${escapeHtml(item.id)}" tabindex="0" aria-label="Open details for ${escapeHtml(item.clientName || 'client')}">
        <td data-label="Client name"><button class="client-dashboard-name" type="button" data-client-dashboard-open="${escapeHtml(item.id)}"><span class="client-dashboard-avatar" aria-hidden="true">${escapeHtml(initials)}</span><span>${escapeHtml(item.clientName || 'Untitled client')}<small>${escapeHtml(item.role || item.companyName || item.company || 'Client')}</small></span></button></td>
        <td data-label="Status"><span class="client-dashboard-status is-${status.key}">${status.label}</span></td>
        <td data-label="Contract start">${startDate ? escapeHtml(formatDate(startDate)) : '—'}</td>
        <td data-label="Contract end">${item.contractEndDate ? escapeHtml(formatDate(item.contractEndDate)) : '—'}</td>
        <td data-label="Days left">${daysLeft === null ? '—' : daysLeft < 0 ? 'Ended' : plural(daysLeft, 'day')}</td>
        <td data-label="Rate">${escapeHtml(rate || '—')}</td>
        <td data-label="Last contact">${lastContact ? escapeHtml(formatDate(lastContact)) : '—'}</td>
        <td data-label="Actions"><button class="client-dashboard-row-action" type="button" data-client-dashboard-open="${escapeHtml(item.id)}" aria-label="Open ${escapeHtml(item.clientName || 'client')} details"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i><span>View</span></button></td>
      </tr>`;
    }).join('');
  }

  function clientDashboardRecentActivity(clients) {
    const activity = [];
    const recentThreshold = new Date();
    recentThreshold.setMonth(recentThreshold.getMonth() - 6);
    const thresholdKey = localDateKey(recentThreshold);
    clients.forEach(item => {
      const addedAt = item.createdAt || item.activeAt;
      if (addedAt) activity.push({ date: addedAt, title: 'Client added', detail: item.clientName || 'Client', icon: 'fa-user-plus', tone: 'blue' });
      if (item.contractStatus === 'Contract Ended' || (item.contractEndDate && dateKey(item.contractEndDate) < today())) {
        activity.push({ date: item.contractEndDate || item.updatedAt || item.activeAt, title: 'Contract ended', detail: item.clientName || 'Client', icon: 'fa-circle-check', tone: 'gray' });
      }
      (item.dashboardActivity || []).forEach(entry => activity.push(entry));
    });
    (data.clientTasks || []).filter(task => task.status === 'done' && task.completedAt).forEach(task => {
      const client = clients.find(item => item.id === task.clientId);
      if (client) activity.push({ date: task.completedAt, title: 'Task completed', detail: `${client.clientName || 'Client'} · ${task.title || 'Task'}`, icon: 'fa-check', tone: 'green' });
    });
    (data.dailyTasks || []).filter(task => task.completedAt && task.relatedType === 'client').forEach(task => {
      const client = clients.find(item => item.id === task.relatedId);
      if (client) activity.push({ date: task.completedAt, title: 'Task completed', detail: `${client.clientName || 'Client'} · ${task.title || 'Task'}`, icon: 'fa-check', tone: 'green' });
    });
    return activity.filter(item => dateKey(item.date) >= thresholdKey)
      .sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8);
  }

  function renderClientDashboardActivity(clients) {
    const activity = clientDashboardRecentActivity(clients);
    $('#clientDashboardActivityList').innerHTML = activity.length
      ? activity.map(item => `<article class="client-dashboard-activity-item"><span class="client-dashboard-activity-icon is-${escapeHtml(item.tone || 'blue')}"><i class="fa-solid ${escapeHtml(item.icon || 'fa-bolt')}" aria-hidden="true"></i></span><span><strong>${escapeHtml(item.title || 'Client update')}</strong><small>${escapeHtml(item.detail || '')}</small></span><time>${escapeHtml(formatDate(item.date))}</time></article>`).join('')
      : '<p class="client-dashboard-inline-empty">Client updates and completed tasks will appear here.</p>';
  }

  function clientDashboardMonthKeys() {
    return Array.from({ length: 6 }, (_, index) => {
      const date = new Date();
      date.setDate(1);
      date.setMonth(date.getMonth() - (5 - index));
      return { key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, label: new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date) };
    });
  }

  function renderClientDashboardHours() {
    const months = clientDashboardMonthKeys();
    const totals = new Map(months.map(month => [month.key, 0]));
    (data.clientTasks || []).forEach(task => {
      (task.timeEntries || []).forEach(entry => {
        const date = dateKey(entry.start);
        if (!date) return;
        const key = date.slice(0, 7);
        if (!totals.has(key)) return;
        const start = new Date(entry.start || '').getTime();
        const end = new Date(entry.end || '').getTime();
        const duration = Number(entry.durationMs) || (Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0);
        totals.set(key, totals.get(key) + duration / 3600000);
      });
    });
    (data.applications || []).forEach(item => {
      (item.dashboardLoggedHours || []).forEach(entry => {
        const key = dateKey(entry.date).slice(0, 7);
        if (totals.has(key)) totals.set(key, totals.get(key) + (Number(entry.hours) || 0));
      });
    });
    const values = months.map(month => totals.get(month.key) || 0);
    const chart = $('#clientDashboardHoursChart');
    if (!values.some(value => value > 0)) {
      chart.innerHTML = '<text x="300" y="106" text-anchor="middle" class="client-dashboard-chart-empty">Logged client hours will appear here.</text>';
      return;
    }
    const max = Math.max(...values, 1);
    const points = values.map((value, index) => `${48 + index * 100},${160 - value / max * 112}`).join(' ');
    chart.innerHTML = `<line x1="34" y1="160" x2="566" y2="160" class="client-dashboard-chart-axis"></line><polyline points="${points}" class="client-dashboard-chart-line"></polyline>${values.map((value, index) => {
      const x = 48 + index * 100;
      const y = 160 - value / max * 112;
      return `<circle cx="${x}" cy="${y}" r="4" class="client-dashboard-chart-point"><title>${value.toFixed(1)} hours</title></circle><text x="${x}" y="190" text-anchor="middle" class="client-dashboard-chart-label">${months[index].label}</text><text x="${x}" y="${Math.max(y - 10, 20)}" text-anchor="middle" class="client-dashboard-chart-value">${value.toFixed(value % 1 ? 1 : 0)}</text>`;
    }).join('')}`;
  }

  function renderClientDashboardAttention(clients) {
    const entries = [];
    clients.forEach(item => {
      const daysLeft = clientDashboardDaysLeft(item);
      if (isActiveContract(item) && daysLeft !== null && daysLeft >= 0 && daysLeft <= 30) {
        entries.push({ id: item.id, type: 'renew', title: 'Contract ending soon', detail: `${item.clientName || 'Client'} · ${plural(daysLeft, 'day')} left`, action: 'Renew', tone: 'amber' });
      }
      const lastContact = clientDashboardLastContact(item);
      const followUpBasis = lastContact || item.activeAt || item.createdAt;
      if (isActiveContract(item) && followUpBasis && Math.floor((new Date(`${today()}T12:00:00`) - new Date(dateKey(followUpBasis) + 'T12:00:00')) / 86400000) >= 14) {
        entries.push({ id: item.id, type: 'message', title: 'Follow-up due', detail: `${item.clientName || 'Client'} · ${lastContact ? `Last contacted ${formatDate(lastContact)}` : 'No contact recorded'}`, action: 'Message', tone: 'blue' });
      }
    });
    (data.clientTasks || []).filter(task => task.status !== 'done' && task.dueDate && dateKey(task.dueDate) < today()).forEach(task => {
      const item = clients.find(client => client.id === task.clientId);
      if (item) entries.push({ id: task.id, clientId: item.id, type: 'client-task', title: 'Overdue client task', detail: `${item.clientName || 'Client'} · ${task.title || 'Task'}`, action: 'Mark done', tone: 'red' });
    });
    (data.dailyTasks || []).filter(task => !task.completedAt && task.taskDate < today() && task.relatedType === 'client').forEach(task => {
      const item = clients.find(client => client.id === task.relatedId);
      if (item) entries.push({ id: task.id, clientId: item.id, type: 'daily-task', title: 'Overdue task', detail: `${item.clientName || 'Client'} · ${task.title || 'Task'}`, action: 'Mark done', tone: 'red' });
    });
    $('#clientDashboardAttentionCount').textContent = entries.length ? plural(entries.length, 'item') : 'All caught up';
    $('#clientDashboardAttentionList').innerHTML = entries.length
      ? entries.slice(0, 8).map(entry => `<article class="client-dashboard-attention-item"><span class="client-dashboard-attention-dot is-${entry.tone}" aria-hidden="true"></span><span class="client-dashboard-attention-copy"><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(entry.detail)}</small></span><button class="button button-secondary" type="button" data-client-dashboard-attention="${entry.type}" data-client-id="${escapeHtml(entry.clientId || entry.id)}" data-item-id="${escapeHtml(entry.id)}">${entry.action}</button></article>`).join('')
      : '<p class="client-dashboard-inline-empty">No contracts, follow-ups, or tasks need attention.</p>';
  }

  function renderClientDashboardDrawer(client) {
    const content = $('#clientDashboardDrawerContent');
    if (!client || !content) return;
    const status = clientDashboardStatus(client);
    const tasks = [
      ...(data.clientTasks || []).filter(task => task.clientId === client.id),
      ...(data.dailyTasks || []).filter(task => task.relatedType === 'client' && task.relatedId === client.id)
    ].sort((a, b) => new Date(a.dueDate || a.taskDate || 0) - new Date(b.dueDate || b.taskDate || 0)).slice(0, 5);
    const startDate = client.activeAt || client.appliedDate;
    const salary = clientDashboardRate(client);
    content.innerHTML = `
      <div class="client-dashboard-drawer-profile"><span class="client-dashboard-avatar is-large" aria-hidden="true">${escapeHtml(clientInitials(client.clientName))}</span><div><h3>${escapeHtml(client.clientName || 'Untitled client')}</h3><span class="client-dashboard-status is-${status.key}">${status.label}</span></div></div>
      <section class="client-dashboard-drawer-section"><h3>Contract information</h3><dl><div><dt>Position</dt><dd>${escapeHtml(client.role || 'Not set')}</dd></div><div><dt>Start date</dt><dd>${startDate ? escapeHtml(formatDate(startDate)) : 'Not set'}</dd></div><div><dt>End date</dt><dd>${client.contractEndDate ? escapeHtml(formatDate(client.contractEndDate)) : 'Not set'}</dd></div><div><dt>Rate</dt><dd>${escapeHtml(salary || 'Not set')}</dd></div><div><dt>Contact</dt><dd>${escapeHtml(client.contact || 'Not set')}</dd></div>${client.email ? `<div><dt>Email</dt><dd><a href="mailto:${escapeHtml(client.email)}">${escapeHtml(client.email)}</a></dd></div>` : ''}${client.phone ? `<div><dt>Phone</dt><dd><a href="tel:${escapeHtml(client.phone)}">${escapeHtml(client.phone)}</a></dd></div>` : ''}${client.companyName || client.company ? `<div><dt>Company</dt><dd>${escapeHtml(client.companyName || client.company)}</dd></div>` : ''}</dl></section>
      <section class="client-dashboard-drawer-section"><h3>Notes</h3><p class="client-dashboard-drawer-notes">${escapeHtml(client.notes || 'No notes yet.')}</p></section>
      <section class="client-dashboard-drawer-section"><h3>Linked tasks <span>${tasks.length}</span></h3>${tasks.length ? `<ul class="client-dashboard-drawer-tasks">${tasks.map(task => `<li><span>${escapeHtml(task.title || 'Untitled task')}</span><small>${escapeHtml(task.status === 'done' || task.completedAt ? 'Done' : (task.dueDate || task.taskDate) ? formatDate(task.dueDate || task.taskDate) : 'No due date')}</small></li>`).join('')}</ul>` : '<p class="client-dashboard-inline-empty">No tasks linked to this client yet.</p>'}</section>
      <div class="client-dashboard-drawer-actions"><button class="button button-secondary" type="button" data-client-dashboard-drawer-action="message"><i class="fa-regular fa-envelope" aria-hidden="true"></i> Message</button><button class="button button-primary" type="button" data-client-dashboard-edit="${escapeHtml(client.id)}"><i class="fa-solid fa-pen" aria-hidden="true"></i> Edit details</button></div>`;
  }

  function renderClientDashboard() {
    const clients = hiredClients();
    const loading = !dataReady;
    $('#clientDashboardLoading').hidden = !loading;
    $('#clientDashboardContent').hidden = loading;
    if (loading) {
      $('#clientDashboardCount').textContent = '—';
      $('#clientDashboardDetail').textContent = 'Loading clients…';
      return;
    }
    const activeClients = clients.filter(isActiveContract).length;
    const endingSoon = clients.filter(item => isActiveContract(item) && clientDashboardDaysLeft(item) !== null && clientDashboardDaysLeft(item) >= 0 && clientDashboardDaysLeft(item) <= 30).length;
    const endedContracts = clients.filter(isContractEnded).length;
    const income = clientDashboardMoneyByCurrency(clients);
    $('#clientDashboardCount').textContent = Number.isFinite(activeClients) ? String(activeClients) : '—';
    $('#clientDashboardDetail').textContent = activeClients ? plural(activeClients, 'client') : 'No active contracts';
    $('#clientDashboardEndingCount').textContent = String(endingSoon);
    $('#clientDashboardEndedCount').textContent = String(endedContracts);
    $('#clientDashboardEndedDetail').textContent = endedContracts ? plural(endedContracts, 'contract') : 'No ended contracts';
    $('#clientDashboardIncomeCard').hidden = !income;
    $('#clientDashboardIncome').textContent = income || '—';
    $('#clientDashboardPanel .client-dashboard-stat-grid').classList.toggle('has-income', Boolean(income));
    $('#clientDashboardActionClient').innerHTML = clients.length
      ? clients.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.clientName || 'Untitled client')}</option>`).join('')
      : '<option value="">Add a client to get started</option>';
    $$('#clientDashboardQuickActions [data-client-dashboard-action]').forEach(button => { button.disabled = !clients.length; });
    renderClientDashboardTable(clients);
    renderClientDashboardAttention(clients);
    renderClientDashboardActivity(clients);
    renderClientDashboardHours();
    if (clientDashboardSelectedId) {
      const selected = clients.find(item => item.id === clientDashboardSelectedId);
      if (selected && !$('#clientDashboardDrawer').hidden) renderClientDashboardDrawer(selected);
      else closeClientDashboardDrawer();
    }
  }

  function closeClientDashboardDrawer() {
    const drawer = $('#clientDashboardDrawer');
    if (!drawer || drawer.hidden) return;
    drawer.hidden = true;
    drawer.setAttribute('aria-hidden', 'true');
    $('#clientDashboardBackdrop').hidden = true;
    document.body.classList.remove('client-dashboard-drawer-open');
    clientDashboardSelectedId = '';
    clientDashboardDrawerReturnFocus?.focus();
    clientDashboardDrawerReturnFocus = null;
  }

  function openClientDashboardDrawer(clientId, trigger) {
    const client = hiredClients().find(item => item.id === clientId);
    if (!client) return;
    clientDashboardSelectedId = client.id;
    clientDashboardDrawerReturnFocus = trigger;
    $('#clientDashboardDrawerTitle').textContent = client.clientName || 'Client';
    renderClientDashboardDrawer(client);
    const drawer = $('#clientDashboardDrawer');
    drawer.hidden = false;
    drawer.setAttribute('aria-hidden', 'false');
    $('#clientDashboardBackdrop').hidden = false;
    document.body.classList.add('client-dashboard-drawer-open');
    requestAnimationFrame(() => drawer.querySelector('button, a, input, select, textarea')?.focus());
  }

  function renderClientDashboardEditForm(client) {
    const status = client.contractStatus === 'Contract Ended' ? 'Contract Ended' : client.contractStatus === 'Not active' ? 'Not active' : 'Active';
    $('#clientDashboardDrawerContent').innerHTML = `<form class="client-dashboard-edit-form" data-client-dashboard-save="${escapeHtml(client.id)}">
      <label class="form-field">Client name<input name="clientName" required maxlength="180" value="${escapeHtml(client.clientName || '')}" /></label>
      <label class="form-field">Position<input name="role" maxlength="180" value="${escapeHtml(client.role || '')}" /></label>
      <label class="form-field">Contact name<input name="contact" maxlength="180" value="${escapeHtml(client.contact || '')}" /></label>
      <label class="form-field">Contract status<select name="contractStatus"><option${status === 'Active' ? ' selected' : ''}>Active</option><option${status === 'Not active' ? ' selected' : ''}>Not active</option><option${status === 'Contract Ended' ? ' selected' : ''}>Contract Ended</option></select></label>
      <label class="form-field">Contract start<input name="activeAt" type="date" value="${escapeHtml(dateKey(client.activeAt || client.appliedDate))}" /></label>
      <label class="form-field">Contract end<input name="contractEndDate" type="date" value="${escapeHtml(dateKey(client.contractEndDate))}" /></label>
      <label class="form-field">Rate amount<input name="salaryAmount" type="number" min="0" step="0.01" value="${escapeHtml(client.salaryAmount ?? '')}" /></label>
      <label class="form-field">Rate type<select name="salaryType"><option value="">Not set</option><option value="hourly"${client.salaryType === 'hourly' ? ' selected' : ''}>Hourly</option><option value="monthly"${client.salaryType === 'monthly' ? ' selected' : ''}>Monthly</option></select></label>
      <label class="form-field">Currency<select name="salaryCurrency"><option value="USD"${client.salaryCurrency !== 'PHP' ? ' selected' : ''}>USD ($)</option><option value="PHP"${client.salaryCurrency === 'PHP' ? ' selected' : ''}>PHP (₱)</option></select></label>
      <label class="form-field">Hours per week<input name="hoursPerWeek" type="number" min="0" step="0.5" value="${escapeHtml(client.hoursPerWeek ?? '')}" /></label>
      <label class="form-field">Contact email<input name="email" type="email" value="${escapeHtml(client.email || '')}" /></label>
      <label class="form-field">Phone<input name="phone" type="tel" maxlength="80" value="${escapeHtml(client.phone || '')}" /></label>
      <label class="form-field client-dashboard-edit-notes">Notes<textarea name="notes" rows="5" maxlength="4000">${escapeHtml(client.notes || '')}</textarea></label>
      <div class="client-dashboard-drawer-actions"><button class="button button-secondary" type="button" data-client-dashboard-cancel-edit>Cancel</button><button class="button button-primary" type="submit">Save changes</button></div>
    </form>`;
    $('#clientDashboardDrawerContent').querySelector('input')?.focus();
  }

  function openClientDashboardAction(action) {
    const client = hiredClients().find(item => item.id === $('#clientDashboardActionClient').value);
    if (!client) return;
    if (action === 'message') {
      openPlainClientEmailComposer(client);
      return;
    }
    clientDashboardAction = action;
    const title = action === 'hours' ? 'Log client hours' : action === 'task' ? 'Add a client task' : 'Add a client note';
    $('#clientDashboardActionTitle').textContent = `${title} · ${client.clientName || 'Client'}`;
    $('#clientDashboardActionFields').innerHTML = action === 'hours'
      ? '<label class="form-field">Hours worked<input name="hours" type="number" min="0.25" step="0.25" required autofocus /></label><label class="form-field">Date<input name="date" type="date" required /></label>'
      : action === 'task'
        ? '<label class="form-field">Task title<input name="title" maxlength="180" required autofocus /></label><label class="form-field">Due date<input name="date" type="date" /></label>'
        : '<label class="form-field">Note<textarea name="note" rows="5" maxlength="2000" required autofocus placeholder="Add a note for this client"></textarea></label>';
    const dateInput = $('#clientDashboardActionFields [name="date"]');
    if (dateInput) dateInput.value = today();
    $('#clientDashboardActionDialog').showModal();
    requestAnimationFrame(() => $('#clientDashboardActionFields').querySelector('input, textarea')?.focus());
  }

  async function saveClientDashboardAction(event) {
    event.preventDefault();
    const client = hiredClients().find(item => item.id === $('#clientDashboardActionClient').value);
    if (!client) return;
    const formData = new FormData(event.currentTarget);
    const now = new Date().toISOString();
    if (clientDashboardAction === 'hours') {
      client.dashboardLoggedHours = Array.isArray(client.dashboardLoggedHours) ? client.dashboardLoggedHours : [];
      client.dashboardLoggedHours.push({ id: uid(), hours: Number(formData.get('hours')), date: String(formData.get('date') || today()), createdAt: now });
      client.dashboardActivity = [...(client.dashboardActivity || []), { date: now, title: 'Hours logged', detail: `${client.clientName || 'Client'} · ${Number(formData.get('hours'))} hours`, icon: 'fa-clock', tone: 'blue' }].slice(-100);
    } else if (clientDashboardAction === 'task') {
      data.dailyTasks = Array.isArray(data.dailyTasks) ? data.dailyTasks : [];
      data.dailyTasks.push({
        id: uid(),
        title: String(formData.get('title') || '').trim(),
        type: 'task',
        taskDate: String(formData.get('date') || today()),
        relatedType: 'client',
        relatedId: client.id,
        relatedName: client.clientName || '',
        destination: '',
        notes: '',
        checklist: [],
        createdAt: now,
        completedAt: ''
      });
      client.dashboardActivity = [...(client.dashboardActivity || []), { date: now, title: 'Task added', detail: `${client.clientName || 'Client'} · ${String(formData.get('title') || '').trim()}`, icon: 'fa-list-check', tone: 'blue' }].slice(-100);
    } else {
      const note = String(formData.get('note') || '').trim();
      client.notes = [client.notes, note].filter(Boolean).join('\n\n');
      client.dashboardActivity = [...(client.dashboardActivity || []), { date: now, title: 'Note added', detail: client.clientName || 'Client', icon: 'fa-note-sticky', tone: 'gray' }].slice(-100);
    }
    const action = clientDashboardAction;
    try {
      if (!(await persist())) throw new Error('Cloud save failed.');
    } catch (error) {
      console.error('Could not save client dashboard action:', error);
      showActionResult({ title: 'Could not save client update', message: error.message || 'Check your connection and try again.', status: 'error' });
      return;
    }
    $('#clientDashboardActionDialog').close();
    renderAll();
    if (action === 'task') showView('daily-task');
    else if (clientDashboardSelectedId) openClientDashboardDrawer(client.id, clientDashboardDrawerReturnFocus);
    toast(action === 'hours' ? 'Client hours saved.' : action === 'task' ? 'Task added to Daily Tasks.' : 'Client note saved.');
  }

  $('#clientDashboardSearch').addEventListener('input', () => renderClientDashboardTable(hiredClients()));
  $('#clientDashboardStatusFilter').addEventListener('change', () => renderClientDashboardTable(hiredClients()));
  $('#clientDashboardActionForm').addEventListener('submit', saveClientDashboardAction);
  $('#clientDashboardClients').addEventListener('click', event => {
    const sortButton = event.target.closest('[data-client-sort]');
    if (sortButton) {
      if (clientDashboardSort === sortButton.dataset.clientSort) clientDashboardSortDirection = clientDashboardSortDirection === 'asc' ? 'desc' : 'asc';
      else {
        clientDashboardSort = sortButton.dataset.clientSort;
        clientDashboardSortDirection = 'asc';
      }
      renderClientDashboardTable(hiredClients());
      return;
    }
    const openButton = event.target.closest('[data-client-dashboard-open]');
    if (openButton) openClientDashboardDrawer(openButton.dataset.clientDashboardOpen, openButton);
    else {
      const row = event.target.closest('[data-client-row]');
      if (row && !event.target.closest('button, a, input, select, textarea')) {
        openClientDashboardDrawer(row.dataset.clientRow, row);
      }
    }
  });
  $('#clientDashboardPanel').addEventListener('click', event => {
    const actionButton = event.target.closest('[data-client-dashboard-action]');
    const closeButton = event.target.closest('[data-client-dashboard-close], [data-client-dashboard-action-close]');
    const drawerMessage = event.target.closest('[data-client-dashboard-drawer-action="message"]');
    const editButton = event.target.closest('[data-client-dashboard-edit]');
    const cancelEditButton = event.target.closest('[data-client-dashboard-cancel-edit]');
    const attentionButton = event.target.closest('[data-client-dashboard-attention]');
    if (actionButton) {
      openClientDashboardAction(actionButton.dataset.clientDashboardAction);
    } else if (closeButton) {
      if (closeButton.closest('#clientDashboardActionDialog')) $('#clientDashboardActionDialog').close();
      else closeClientDashboardDrawer();
    } else if (drawerMessage) {
      const client = hiredClients().find(item => item.id === clientDashboardSelectedId);
      if (client) openPlainClientEmailComposer(client);
    } else if (editButton) {
      const client = hiredClients().find(item => item.id === editButton.dataset.clientDashboardEdit);
      if (client) renderClientDashboardEditForm(client);
    } else if (cancelEditButton) {
      const client = hiredClients().find(item => item.id === clientDashboardSelectedId);
      if (client) renderClientDashboardDrawer(client);
    } else if (attentionButton) {
      const client = hiredClients().find(item => item.id === attentionButton.dataset.clientId);
      if (attentionButton.dataset.clientDashboardAttention === 'renew' && client) {
        openClientModal(client.id, false, true, false, true);
      } else if (attentionButton.dataset.clientDashboardAttention === 'message' && client) {
        openPlainClientEmailComposer(client);
      } else if (attentionButton.dataset.clientDashboardAttention === 'client-task') {
        const task = (data.clientTasks || []).find(item => item.id === attentionButton.dataset.itemId);
        if (task) {
          const now = new Date();
          if (task.timerStartedAt) {
            const start = new Date(task.timerStartedAt);
            const durationMs = Math.max(0, now.getTime() - start.getTime());
            task.timeEntries = Array.isArray(task.timeEntries) ? task.timeEntries : [];
            if (durationMs) task.timeEntries.push({ id: uid(), start: start.toISOString(), end: now.toISOString(), durationMs });
            task.timerStartedAt = '';
          }
          Object.assign(task, { status: 'done', completedAt: now.toISOString(), updatedAt: now.toISOString() });
        }
        persist().catch(error => {
          console.error('Could not complete overdue client task:', error);
          showActionResult({ title: 'Could not update task', message: error.message || 'Check your connection and try again.', status: 'error' });
        });
        renderAll();
      } else if (attentionButton.dataset.clientDashboardAttention === 'daily-task') {
        const task = (data.dailyTasks || []).find(item => item.id === attentionButton.dataset.itemId);
        if (task) task.completedAt = new Date().toISOString();
        persist().catch(error => {
          console.error('Could not complete overdue daily task:', error);
          showActionResult({ title: 'Could not update task', message: error.message || 'Check your connection and try again.', status: 'error' });
        });
        renderAll();
      }
    }
  });
  $('#clientDashboardPanel').addEventListener('submit', async event => {
    const form = event.target.closest('[data-client-dashboard-save]');
    if (!form) return;
    event.preventDefault();
    const client = hiredClients().find(item => item.id === form.dataset.clientDashboardSave);
    if (!client) return;
    const previousClient = JSON.parse(JSON.stringify(client));
    const fields = new FormData(form);
    Object.assign(client, {
      clientName: String(fields.get('clientName') || '').trim(),
      role: String(fields.get('role') || '').trim(),
      contact: String(fields.get('contact') || '').trim(),
      contractStatus: String(fields.get('contractStatus') || 'Active'),
      activeAt: String(fields.get('activeAt') || ''),
      contractEndDate: String(fields.get('contractEndDate') || ''),
      salaryAmount: fields.get('salaryAmount') === '' ? '' : Number(fields.get('salaryAmount')),
      salaryType: String(fields.get('salaryType') || ''),
      salaryCurrency: String(fields.get('salaryCurrency') || 'USD'),
      hoursPerWeek: fields.get('hoursPerWeek') === '' ? '' : Number(fields.get('hoursPerWeek')),
      email: String(fields.get('email') || '').trim(),
      phone: String(fields.get('phone') || '').trim(),
      notes: String(fields.get('notes') || '').trim(),
      updatedAt: new Date().toISOString()
    });
    try {
      if (!(await persist())) {
        Object.assign(client, previousClient);
        throw new Error('Cloud save failed.');
      }
      renderClientDashboard();
      toast('Client details saved.');
    } catch (error) {
      console.error('Could not save client dashboard details:', error);
      showActionResult({ title: 'Could not save client details', message: error.message || 'Check your connection and try again.', status: 'error' });
    }
  });
  $('#clientDashboardBackdrop').addEventListener('click', closeClientDashboardDrawer);
  $('#clientDashboardDrawer').addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeClientDashboardDrawer();
    } else if (event.key === 'Tab') {
      const focusable = [...event.currentTarget.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])')];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
  $('#clientDashboardActionDialog').addEventListener('click', event => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  $('#clientDashboardActionDialog').addEventListener('close', () => { clientDashboardAction = ''; });
  $('#clientDashboardPanel').addEventListener('keydown', event => {
    const sortButton = event.target.closest('[data-client-sort]');
    if (sortButton && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      sortButton.click();
      return;
    }
    const row = event.target.closest('[data-client-row]');
    if (row && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openClientDashboardDrawer(row.dataset.clientRow, row);
    }
  });
  renderClientDashboard();

  function renderInterviewCalendar() {
    const target = $('#interviewCalendar');
    const monthLabel = $('#interviewCalendarMonth');
    if (!target || !monthLabel) return;
    const year = interviewCalendarMonth.getFullYear();
    const month = interviewCalendarMonth.getMonth();
    monthLabel.textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(interviewCalendarMonth);
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const interviews = data.applications.filter(item => item.status === 'Interview' && item.interviewDate);
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const cells = weekdays.map(day => `<div class="calendar-weekday">${day}</div>`);
    for (let index = 0; index < 42; index += 1) {
      const dayOffset = index - firstDay;
      const date = new Date(year, month, dayOffset + 1);
      const inMonth = dayOffset >= 0 && dayOffset < daysInMonth;
      const dateValue = localDateKey(date);
      const dayInterviews = interviews.filter(item => dateKey(item.interviewDate) === dateValue);
      cells.push(`<div class="calendar-day${inMonth ? '' : ' other-month'}${dateValue === today() ? ' today' : ''}"><span class="calendar-day-number">${date.getDate()}</span><div class="calendar-interviews">${dayInterviews.map(item => `<button class="calendar-interview" type="button" data-calendar-client="${escapeHtml(item.id)}" title="${escapeHtml(item.clientName)}">${escapeHtml(item.clientName)}</button>`).join('')}</div></div>`);
    }
    target.innerHTML = cells.join('');
  }

  function renderPlatformBreakdown(applications) {
    const target = $('#platformBreakdown');
    const counts = applications.reduce((result, item) => {
      const key = item.platform || 'Not specified';
      result[key] = (result[key] || 0) + 1;
      return result;
    }, {});
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (!entries.length) {
      target.innerHTML = '<div class="empty-chart">Add an application to see your platform mix.</div>';
      return;
    }
    const maximum = Math.max(...entries.map(([, count]) => count));
    target.innerHTML = entries.map(([name, count]) => `
      <div class="platform-row"><span class="platform-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span><span class="platform-track"><i style="width:${(count / maximum) * 100}%"></i></span><strong>${count}</strong></div>
    `).join('');
  }

  function renderStatusChart(applications) {
    const target = $('#statusLegend');
    const statusEntries = Object.entries(STATUS_COLORS).map(([status, color]) => [status, applications.filter(item => item.status === status).length, color]).filter(([, count]) => count > 0);
    $('#donutValue').textContent = applications.length;
    if (!statusEntries.length) {
      $('#statusDonut').style.background = 'conic-gradient(#eff0ec 0 100%)';
      target.innerHTML = '<span class="empty-chart" style="padding:13px 8px">Status mix will appear here.</span>';
      return;
    }
    let total = 0;
    const stops = statusEntries.map(([, count, color]) => {
      const from = total;
      total += (count / applications.length) * 100;
      return `${color} ${from}% ${total}%`;
    });
    $('#statusDonut').style.background = `conic-gradient(${stops.join(',')})`;
    target.innerHTML = statusEntries.map(([status, count, color]) => `
      <span class="legend-item"><i class="legend-dot" style="background:${color}"></i><span>${escapeHtml(STATUS_LABELS[status] || status)}</span><strong>${count}</strong></span>
    `).join('');
  }

  function renderRecentApplications() {
    const target = $('#recentApplications');
    const applications = sortedPipelineApplications().slice(0, 5);
    if (!applications.length) {
      target.innerHTML = '<tr><td colspan="5"><div class="application-empty"><h3>Your tracker is ready</h3><p>Add your first client or application from the Applications tab and Jeff VA will organize the rest.</p><button class="button button-primary" type="button" data-go-to="applications">Go to applications</button></div></td></tr>';
      return;
    }
    target.innerHTML = applications.map(item => `
      <tr>
        <td><div class="table-client">${escapeHtml(item.clientName)}<small>${escapeHtml(item.role || item.contact || 'No role added')}</small></div></td>
        <td>${escapeHtml(item.platform)}</td><td><span class="application-stage-email-count">${statusPill(item.status)}${matchBadge(item)}</span></td><td>${formatDate(item.appliedDate)}</td>
        <td><button class="icon-button list-icon-button" type="button" data-edit-id="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.clientName)}" title="Edit application">✎</button></td>
      </tr>
    `).join('');
  }


  function applicationWeekOptions() {
    const currentRange = weekRange();
    const applicationDates = pipelineApplications().map(applicationAppliedDate).map(dateKey).filter(Boolean);
    const offsets = [...new Set(applicationDates.map(date => {
      const applicationDate = new Date(`${date}T12:00:00`);
      const daysSinceMonday = (applicationDate.getDay() + 6) % 7;
      applicationDate.setDate(applicationDate.getDate() - daysSinceMonday);
      return Math.round((applicationDate - new Date(`${currentRange.start}T12:00:00`)) / 86400000 / 7);
    }).filter(offset => offset < 0))].sort((first, second) => second - first);
    const options = offsets.map(offset => {
      const range = weekRange(offset);
      return `<option value="${offset}">${escapeHtml(weeklyRangeLabel(range).replace(' – ', ' to '))}</option>`;
    }).join('');
    return `<option value="">- Select -</option><option value="all">All weeks</option><option value="0">This week</option>${options}`;
  }

  function sortApplicationList(items, order = 'newest') {
    const timestamp = value => {
      const result = new Date(value || 0).getTime();
      return Number.isFinite(result) ? result : 0;
    };
    const direction = order === 'oldest' ? 1 : -1;
    return [...items].sort((first, second) => direction * (
      timestamp(applicationAppliedDate(first)) - timestamp(applicationAppliedDate(second))
      || timestamp(first.createdAt) - timestamp(second.createdAt)
    ));
  }

  function confirmedApplicationFollowUpSentAt(item) {
    const scheduledDate = dateKey(item.followUpDate);
    const recipient = extractEmailAddress(item.email || '');
    const sameRecipient = recipient ? data.applications.filter(app => extractEmailAddress(app.email || '') === recipient) : [];
    const expectedSubject = `follow-up: ${String(item.clientName || '').trim()}`.toLowerCase();
    const sentDates = [item.followUpSentAt, ...data.emails.filter(email => {
      if (!isSentEmail(email)) return false;
      const subject = String(email.subject || '').trim().replace(/^(?:(?:re|fw|fwd):\s*)+/i, '');
      if (email.emailType !== 'follow-up' && !/^follow(?:ing)?[\s-]*up\b/i.test(subject)) return false;
      if (email.applicationId) return email.applicationId === item.id;
      if (!recipient || extractEmailAddress(email.to || '') !== recipient) return false;
      // Shared recruiter addresses need a company-specific subject; a generic
      // follow-up to that address must not complete every application.
      return (sameRecipient.length === 1 && sameRecipient[0].id === item.id)
        || (String(item.clientName || '').trim() && subject.toLowerCase() === expectedSubject);
    }).map(email => email.date)].filter(value => {
      const date = dateKey(value);
      return date && (!scheduledDate || date >= scheduledDate)
        && (!item.appliedDate || date >= dateKey(item.appliedDate))
        && Number.isFinite(new Date(value).getTime());
    });
    return sentDates.sort((a, b) => new Date(b) - new Date(a))[0] || '';
  }

  function applicationFollowUpState(item) {
    const scheduledDate = dateKey(item.followUpDate);
    const sentDate = dateKey(confirmedApplicationFollowUpSentAt(item));
    if (sentDate && (!scheduledDate || sentDate >= scheduledDate)) return 'sent';
    if (scheduledDate === today() && !['Active client', 'Not selected'].includes(item.status)) return 'due';
    return '';
  }

  function applicationFollowUpMarkup(item) {
    const state = applicationFollowUpState(item);
    const date = state === 'sent' ? dateKey(confirmedApplicationFollowUpSentAt(item)) : dateKey(item.followUpDate);
    if (!date) return '—';
    const label = state === 'sent' ? 'Follow-up sent successfully' : state === 'due' ? 'Follow-up due today — not sent yet' : 'Scheduled follow-up';
    return `<span class="application-follow-up${state ? ` is-${state}` : ''}" title="${escapeHtml(label)}"><span>${escapeHtml(emailDate(date))}</span>${state === 'sent' ? '<span class="follow-up-check" aria-label="Sent successfully">✓</span>' : state === 'due' ? '<span class="follow-up-due-label">Due today</span>' : ''}</span>`;
  }

  function renderApplications() {
    const query = $('#applicationSearch').value.trim().toLowerCase();
    const status = $('#statusFilter').value;
    const platform = $('#platformFilter').value;
    const dateFilter = $('#applicationDateFilter').value;
    updatePlatformFilter();
    const weekOffset = Number(applicationDateSort);
    const weekRangeFilter = applicationDateSort && applicationDateSort !== 'all' ? weekRange(weekOffset) : null;
    $('#applicationWeekDate').textContent = !applicationDateSort
      ? 'Select a week'
      : applicationDateSort === 'all' ? 'All weeks' : weeklyRangeLabel(weekRangeFilter).replace(' – ', ' to ');
    $('#applicationDateSort').innerHTML = applicationWeekOptions();
    $('#applicationDateSort').value = applicationDateSort;
    const pipeline = pipelineApplications();
    const filtered = pipeline.filter(item => {
      const text = [item.clientName, item.contact, item.role, item.platform, item.nextStep, item.notes].join(' ').toLowerCase();
      const statusMatches = status
        ? (status === 'To Proceed' ? isToProceedStatus(item) : status === 'Ongoing' ? item.status === 'Ongoing' : item.status === status)
        : true;
      const alwaysVisibleStatus = isToProceedStatus(item) || item.status === 'Interview' || item.status === 'Ongoing';
      const dateMatches = alwaysVisibleStatus || !dateFilter || dateKey(item.appliedDate) === dateFilter;
      const weekMatches = alwaysVisibleStatus || !applicationDateSort || applicationDateSort === 'all' || isInWeeklyRange(applicationAppliedDate(item), weekRangeFilter);
      return (!query || text.includes(query)) && statusMatches && (!platform || item.platform === platform) && dateMatches && weekMatches;
    });
    $('#applicationListLabel').textContent = `${plural(filtered.length, 'application')}${filtered.length !== pipeline.length ? ` of ${pipeline.length}` : ''}`;
    const platformCounts = new Map();
    filtered.forEach(item => {
      const name = String(item.platform || 'Unspecified').trim() || 'Unspecified';
      platformCounts.set(name, (platformCounts.get(name) || 0) + 1);
    });
    const sourceBreakdown = [...platformCounts]
      .sort(([first], [second]) => first.localeCompare(second, undefined, { sensitivity: 'base' }))
      .map(([name, count]) => `<span class="application-source-row"><span>${escapeHtml(name)}</span><strong>${count}</strong></span>`)
      .join('');
    $('#applicationPlatformCounts').innerHTML = `<span class="application-source-heading"><span>Applications by source</span><strong>${filtered.length}</strong></span><span class="application-source-caption">Current filtered results</span><span class="application-source-list">${sourceBreakdown || '<span class="application-source-empty">No applications in this view</span>'}</span>`;
    const target = $('#applicationList');
    const filterChips = [
      query ? ['search', `Search: ${query}`] : null,
      dateFilter ? ['date', `Date: ${emailDate(dateFilter)}`] : null,
      status && status !== 'Applied' ? ['status', `Stage: ${status === 'Not selected' ? 'Rejected' : status}`] : null,
      platform ? ['platform', `Source: ${platform}`] : null,
      applicationDateSort && applicationDateSort !== '0' && applicationDateSort !== 'all' ? ['week', `Week: ${$('#applicationWeekDate').textContent}`] : null
    ].filter(Boolean);
    $('#applicationFilterChips').innerHTML = filterChips.map(([key, label]) => `<button class="filter-chip" type="button" data-remove-application-filter="${key}">${escapeHtml(label)} <span aria-hidden="true">×</span><span class="sr-only">Remove filter</span></button>`).join('');
    $('#clearApplicationFilters').hidden = filterChips.length === 0 && applicationDateSort !== '0' && status !== 'Applied';
    $$('[data-application-view]').forEach(button => {
      const selected = button.dataset.applicationView === applicationViewMode;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const selectionToggle = $('#toggleApplicationSelection');
    selectionToggle.classList.toggle('active', applicationSelectionMode);
    selectionToggle.setAttribute('aria-pressed', String(applicationSelectionMode));
    selectionToggle.textContent = applicationSelectionMode ? 'Done' : 'Select';
    target.classList.toggle('application-board-mode', applicationViewMode === 'board');
    target.classList.toggle('selection-mode', applicationSelectionMode);
    selectedApplicationIds.forEach(id => {
      if (!filtered.some(item => item.id === id)) selectedApplicationIds.delete(id);
    });
    $('#applicationBulkActions').hidden = !applicationSelectionMode || selectedApplicationIds.size === 0;
    $('#applicationSelectionCount').textContent = `${selectedApplicationIds.size} selected`;
    if (!filtered.length) {
      const isFiltered = pipeline.length > 0;
      target.innerHTML = `<div class="application-empty"><h3>${isFiltered ? 'No matching applications' : 'Start your client pipeline'}</h3><p>${isFiltered ? 'Try a different search or filter.' : 'Track each application, where you applied, and the next step all in one private workspace.'}</p>${isFiltered ? '' : '<button class="button button-primary" type="button" data-open-add>Add your first client</button>'}</div>`;
      return;
    }
    const sortedApplications = sortApplicationList(filtered, $('#applicationOrderSort').value);
    if (applicationViewMode === 'board') {
      const stages = ['To Proceed', 'Ongoing', 'Applied', 'Interview', 'Active client', 'Not selected'];
      target.innerHTML = `<div class="application-board">${stages.map(stage => {
        const cards = sortedApplications.filter(item => stage === 'To Proceed' ? isToProceedStatus(item) : item.status === stage);
        return `<section class="application-board-column" data-application-drop-status="${escapeHtml(stage)}"><header><h3>${escapeHtml(stage === 'Not selected' ? 'Rejected' : stage)}</h3><span>${cards.length}</span></header><div class="application-board-cards">${cards.map(item => `<article class="application-board-card" draggable="${stage !== 'Active client'}" data-application-card="${escapeHtml(item.id)}">${applicationSelectionMode ? `<input type="checkbox" data-application-select="${escapeHtml(item.id)}" aria-label="Select ${escapeHtml(item.clientName)}"${selectedApplicationIds.has(item.id) ? ' checked' : ''} />` : ''}<button type="button" class="application-board-card-open" data-view-details="${escapeHtml(item.id)}"><strong>${escapeHtml(item.clientName)}</strong><span>${escapeHtml(item.role || item.contact || 'Role not set')}</span><small>${escapeHtml(item.platform || 'Source not set')} · ${escapeHtml(emailDate(item.appliedDate))}</small></button>${statusPill(item.status)}<button class="icon-button" type="button" data-edit-id="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.clientName)}">⋯</button></article>`).join('') || '<p class="application-board-empty">No applications</p>'}</div></section>`;
      }).join('')}</div>`;
      return;
    }
    target.innerHTML = `<div class="application-table-wrap"><table class="application-data-table"><thead><tr>${applicationSelectionMode ? '<th scope="col"><span class="sr-only">Select</span></th>' : ''}<th scope="col">Client / role</th><th scope="col">Source</th><th scope="col">Stage</th><th scope="col">Salary</th><th scope="col">Applied</th><th scope="col">Follow-up</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${sortedApplications.map(item => {
      const salaryAmount = Number(item.salaryAmount);
      const salary = salaryAmount > 0 && ['monthly', 'hourly'].includes(item.salaryType)
        ? `${salaryCurrencySymbol(item.salaryCurrency)}${Math.round(salaryAmount).toLocaleString()} / ${item.salaryType === 'hourly' ? 'hour' : 'month'}`
        : '—';
      return `<tr class="${applicationFollowUpState(item) === 'due' ? 'application-follow-up-due' : ''}" data-view-details="${escapeHtml(item.id)}">${applicationSelectionMode ? `<td><input type="checkbox" data-application-select="${escapeHtml(item.id)}" aria-label="Select ${escapeHtml(item.clientName)}"${selectedApplicationIds.has(item.id) ? ' checked' : ''} /></td>` : ''}<td><strong>${escapeHtml(item.clientName)}</strong><small>${escapeHtml(item.role || item.contact || 'Role not set')}</small></td><td>${escapeHtml(item.platform || 'Not specified')}</td><td><span class="application-stage-email-count">${statusPill(item.status)}${matchBadge(item)}</span></td><td>${escapeHtml(salary)}</td><td>${escapeHtml(emailDate(item.appliedDate))}</td><td>${applicationFollowUpMarkup(item)}</td><td><button class="icon-button application-actions-trigger" type="button" aria-label="More actions for ${escapeHtml(item.clientName)}" aria-haspopup="dialog" data-open-application-actions="${escapeHtml(item.id)}">⋯</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function emailWeekOptions() {
    const currentRange = weekRange();
    const emailDates = data.emails.map(item => dateKey(item.date)).filter(Boolean);
    const offsets = [...new Set(emailDates.map(date => {
      const emailDate = new Date(`${date}T12:00:00`);
      const daysSinceMonday = (emailDate.getDay() + 6) % 7;
      emailDate.setDate(emailDate.getDate() - daysSinceMonday);
      return Math.round((emailDate - new Date(`${currentRange.start}T12:00:00`)) / 86400000 / 7);
    }).filter(offset => offset < 0))].sort((first, second) => second - first);
    const options = offsets.map(offset => {
      const range = weekRange(offset);
      return `<option value="${offset}">${escapeHtml(weeklyRangeLabel(range).replace(' – ', ' to '))}</option>`;
    }).join('');
    return `<option value="all">All weeks</option><option value="0">This week</option>${options}`;
  }


  function renderToApplyList() {
    const target = $('#toApplyList');
    if (!target) return;
    const allReminders = data.toApply || [];
    const query = $('#toApplySearch').value.trim().toLowerCase();
    const sort = $('#toApplySort').value;
    const reminders = allReminders.filter(item => [item.title, item.link, item.notes].join(' ').toLowerCase().includes(query));
    reminders.sort((first, second) => {
      if (sort === 'title-asc') return String(first.title || '').localeCompare(String(second.title || ''), undefined, { sensitivity: 'base' });
      const dateOrder = String(first.dueDate || '').localeCompare(String(second.dueDate || ''));
      return sort === 'due-latest' ? -dateOrder : dateOrder;
    });
    $('#toApplyCountLabel').textContent = reminders.length === allReminders.length
      ? plural(reminders.length, 'reminder')
      : `${plural(reminders.length, 'reminder')} of ${plural(allReminders.length, 'reminder')}`;
    target.classList.toggle('is-empty', !reminders.length);
    if (!reminders.length) {
      target.innerHTML = `<div class="to-apply-empty">${allReminders.length ? 'No matching reminders.' : 'No application reminders yet.'}</div>`;
      return;
    }
    const currentDate = today();
    target.innerHTML = `<div class="application-table-wrap"><table class="application-data-table to-apply-data-table"><thead><tr><th scope="col">Opportunity</th><th scope="col">Deadline</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${reminders.map(item => {
      const overdue = item.dueDate < currentDate;
      const dueToday = item.dueDate === currentDate;
      return `<tr class="to-apply-data-row${overdue ? ' overdue' : dueToday ? ' due-today' : ''}">
        <td><strong>${escapeHtml(item.title)}</strong><a href="${escapeHtml(normalizeUrl(item.link))}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(item.link)}">${escapeHtml(item.link)}</a></td>
        <td><time datetime="${escapeHtml(item.dueDate)}">${escapeHtml(formatDate(item.dueDate))}</time>${overdue || dueToday ? `<small class="to-apply-deadline-status">${overdue ? 'Missed' : 'Apply today'}</small>` : ''}</td>
        <td><button class="icon-button to-apply-actions-trigger" type="button" data-to-apply-actions="${escapeHtml(item.id)}" aria-haspopup="dialog" aria-label="Actions for ${escapeHtml(item.title)}">⋯</button></td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function processDueApplyReminders() {
    const currentDate = today();
    data.toApply = data.toApply || [];
    data.alerts = data.alerts || [];
    let changed = false;
    let remindersDue = 0;
    data.toApply.forEach(item => {
      if (item.dueDate !== currentDate) return;
      const alertId = `to-apply|due|${item.id}|${item.dueDate}`;
      if (data.alerts.some(alert => alert.id === alertId)) return;
      data.alerts.unshift({
        id: alertId,
        type: 'to-apply',
        clientName: 'To apply',
        subject: `Apply today: ${item.title}`,
        from: 'Application reminder',
        date: new Date().toISOString(),
        unread: true
      });
      changed = true;
      remindersDue += 1;
    });
    if (changed) {
      limitAlertHistory();
      persist();
      renderAlerts();
      showActionResult({
        title: 'Application reminders due',
        message: `${plural(remindersDue, 'application reminder')} are due today.`,
        status: 'info',
        label: 'APPLICATION REMINDER',
        actionLabel: 'Open To Apply',
        onAction: () => showView('to-apply')
      });
    }
  }

  function openToApplyModal(id = null) {
    const item = (data.toApply || []).find(reminder => reminder.id === id);
    $('#toApplyForm').reset();
    $('#toApplyId').value = id || '';
    $('#toApplyModalTitle').textContent = id ? 'Edit reminder' : 'Add reminder';
    if (item) {
      $('#toApplyTitle').value = item.title || '';
      $('#toApplyLink').value = item.link || '';
      $('#toApplyDate').value = item.dueDate || '';
      $('#toApplyNotes').value = item.notes || '';
    }
    $('#toApplyModal').showModal();
    setTimeout(() => $('#toApplyTitle').focus(), 30);
  }

  function saveToApply(event) {
    if (event.submitter?.value === 'cancel') return;
    event.preventDefault();
    const savingInDrawer = isActiveClientDrawerView('edit');
    const form = $('#toApplyForm');
    if (!form.reportValidity()) return;
    data.toApply = data.toApply || [];
    const id = $('#toApplyId').value || uid();
    const reminder = { id, title: $('#toApplyTitle').value.trim(), link: $('#toApplyLink').value.trim(), dueDate: $('#toApplyDate').value, notes: $('#toApplyNotes').value.trim() };
    data.alerts = (data.alerts || []).filter(alert => !alert.id.startsWith(`to-apply|due|${id}|`));
    const existingIndex = data.toApply.findIndex(item => item.id === id);
    if (existingIndex >= 0) data.toApply[existingIndex] = reminder;
    else data.toApply.push(reminder);
    $('#toApplyModal').close();
    processDueApplyReminders();
    persist();
    renderAll();
  }

  async function deleteToApply(id) {
    const item = (data.toApply || []).find(reminder => reminder.id === id);
    if (!item || !(await appConfirm(`Delete the application reminder “${item.title}”?`, { title: 'Delete reminder', confirmLabel: 'Delete', danger: true }))) return;
    data.toApply = data.toApply.filter(reminder => reminder.id !== id);
    data.alerts = (data.alerts || []).filter(alert => !alert.id.startsWith(`to-apply|${id}|`));
    persist();
    renderAll();
  }

  function updatePlatformFilter() {
    const select = $('#platformFilter');
    const selected = select.value;
    const platforms = [...new Set(pipelineApplications().map(item => item.platform).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    select.innerHTML = '<option value="">All platforms</option>' + platforms.map(platform => `<option value="${escapeHtml(platform)}">${escapeHtml(platform)}</option>`).join('');
    select.value = platforms.includes(selected) ? selected : '';
  }


  function renderEmails() {
    renderGmailSyncStatus();
    renderEmailTaskAiStatus();
    const query = $('#emailSearch').value.trim().toLowerCase();
    const weekOffset = Number(emailDateSort);
    const weekRangeFilter = emailDateSort === 'all' ? null : weekRange(weekOffset);
    $('#emailWeekDate').textContent = emailDateSort === 'all' ? 'All weeks' : weeklyRangeLabel(weekRangeFilter).replace(' – ', ' to ');
    $('#emailDateSort').innerHTML = emailWeekOptions();
    $('#emailDateSort').value = emailDateSort;
    const received = receivedEmails();
    const sent = data.emails.filter(isSentEmail);
    $('#emailReceivedCount').textContent = received.length;
    $('#emailSentCount').textContent = sent.length;
    const emails = data.emails
      .filter(item => [item.from, item.to, item.subject, item.body, item.date].join(' ').toLowerCase().includes(query))
      .filter(item => !emailDateFilter || dateKey(item.date) === emailDateFilter)
      .filter(item => emailDateSort === 'all' || isInWeeklyRange(item.date, weekRangeFilter))
      .filter(item => emailViewFilter === 'sent'
        ? isSentEmail(item)
        : !isSentEmail(item));
    const clientEmails = emails.filter(item => !isSentEmail(item));
    const sentEmails = emails.filter(item => isSentEmail(item));
    const visibleEmails = sortByDate(emailViewFilter === 'sent' ? sentEmails : clientEmails, item => item.date);
    $$('.email-summary-item').forEach(button => {
      const selected = button.dataset.emailView === emailViewFilter;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const target = $('#emailList');
    const sectionClass = `email-section${emailViewFilter === 'sent' ? ' email-section-sent' : ''}${emailSelectionMode ? ' email-selection-mode' : ''}`;
    const selectionActions = emailSelectionMode
      ? '<div class="email-bulk-actions"><label class="email-select-all-control"><input type="checkbox" data-email-select-all aria-label="Select all visible emails" /><span>Select all</span></label><span class="email-selection-count" data-email-selection-count aria-live="polite">0 selected</span><button class="email-selection-cancel" type="button" data-email-selection-toggle>Cancel</button><button class="button button-danger email-bulk-delete" type="button" data-email-bulk-delete disabled><i class="fa-regular fa-trash-can" aria-hidden="true"></i> Delete</button></div>'
      : '<button class="button button-secondary email-selection-trigger" type="button" data-email-selection-toggle><i class="fa-regular fa-square-check" aria-hidden="true"></i><span>Select emails</span></button>';
    $('#emailSelectionActions').innerHTML = selectionActions;
    if (!visibleEmails.length) {
      const hasFilters = Boolean(query || emailDateFilter || emailDateSort !== 'all');
      const title = emailViewFilter === 'sent'
        ? (hasFilters ? 'No sent emails found' : 'No sent emails yet')
        : hasFilters
          ? 'No matching client emails'
          : 'No emails received yet';
      const copy = hasFilters
        ? 'Try another search term or date range.'
        : emailViewFilter === 'sent'
          ? 'Your saved sent messages will appear here.'
          : 'Received messages from Gmail will appear here.';
      target.innerHTML = `<section class="${sectionClass}"><div class="email-empty"><h3>${title}</h3><p>${copy}</p></div></section>`;
      return;
    }
    const renderEmailRows = items => items.map(item => {
      const matches = applicationsRelatedToEmail(item);
      const matchTag = matches.length ? `<span class="client-match-tag" aria-label="${matches.length} application matches" title="Matched to ${matches.length} applications">${matches.length}</span>` : '';
      const rawSender = ((isSentEmail(item) ? item.to : item.from) || 'Unknown sender').trim();
      const platformName = !isSentEmail(item) ? platformNameForSender(item.from) : '';
      const sender = platformName || (rawSender.includes('<')
        ? rawSender.slice(0, rawSender.indexOf('<')).replace(/["']/g, '').trim() || rawSender
        : rawSender);
      const initial = sender.trim().charAt(0).toUpperCase() || '?';
      const bodyPreview = emailContentText(item.body).replace(/\s+/g, ' ').trim();
      const preview = bodyPreview.length > 110 ? `${bodyPreview.slice(0, 110).trimEnd()}...` : bodyPreview;
      const previewTitle = `${item.subject || '(No subject)'}${preview ? ` - ${preview}` : ''}`;
      const recipient = extractEmailAddress(isSentEmail(item) ? item.to : item.from);
      const canCompose = isEmailAddress(recipient) && (isSentEmail(item) || matches.length > 0);
      const sentClass = isSentEmail(item) ? ' sent' : '';
      const sentBadge = isSentEmail(item) ? '<span class="sent-email-badge">SENT</span>' : '';
      const dateLabel = isSentEmail(item) ? 'Sent' : 'Received';
      const sentTime = emailTime(item.date);
      const selectionLabel = platformName ? `${platformName} email` : (item.subject || 'email');
      const selectionCheckbox = emailSelectionMode ? `<input class="email-select-checkbox" type="checkbox" data-email-select value="${escapeHtml(item.id)}" aria-label="Select ${escapeHtml(selectionLabel)}" />` : '';
      const previewMarkup = `<p class="email-preview" title="${escapeHtml(previewTitle)}"><strong class="email-subject">${escapeHtml(item.subject || '(No subject)')}</strong>${sentBadge}<span class="email-snippet">${preview ? ` - ${escapeHtml(preview)}` : ''}</span></p>`;
      return `<article class="email-row${sentClass}${platformName ? ' platform-email-row' : ''}" data-email-detail="${escapeHtml(item.id)}">${selectionCheckbox}<span class="email-avatar">${escapeHtml(initial)}</span><div class="email-row-content"><div class="email-sender-line"><h3 class="email-from" title="${escapeHtml(sender)}">${escapeHtml(sender)}</h3>${matchTag}</div>${previewMarkup}</div><time class="email-date" title="${dateLabel}"><span>${escapeHtml(emailDate(item.date))}</span>${sentTime ? `<span class="email-time">${escapeHtml(sentTime)}</span>` : ''}</time><div class="email-row-actions"><div class="email-action-menu"><button class="email-actions-trigger" type="button" data-email-action-trigger="${escapeHtml(item.id)}" aria-haspopup="true" aria-expanded="false">Actions</button><div class="email-actions-menu hidden" data-email-actions-menu="${escapeHtml(item.id)}" role="menu">${canCompose ? `<button type="button" role="menuitem" data-email-action="compose" data-email-id="${escapeHtml(item.id)}">Send email</button>` : ''}<button type="button" role="menuitem" class="email-action-delete" data-email-action="delete" data-email-id="${escapeHtml(item.id)}">Delete email</button></div></div></div></article>`;
    }).join('');
    target.innerHTML = `<section class="${sectionClass}">${renderEmailRows(visibleEmails)}</section>`;
  }


  function hiredClients() {
    return sortedApplications().filter(item => item.status === 'Active client' && !item.activePendingDocument && !item.activePendingEmail);
  }

  function normalizeUrl(value) {
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  }

  function clientInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return parts.length > 1
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
      : (parts[0]?.slice(0, 2) || '?').toUpperCase();
  }

  function clientAvatarHue(name) {
    return [...String(name || '')].reduce((hue, character) => hue + character.charCodeAt(0), 0) % 6;
  }

  const hiredClientAvatarUrls = new Map();
  const hiredClientAvatarLoads = new Map();

  function cacheHiredClientAvatar(clientId, storagePath, blob) {
    const current = hiredClientAvatarUrls.get(clientId);
    if (current) URL.revokeObjectURL(current.url);
    const url = URL.createObjectURL(blob);
    hiredClientAvatarUrls.set(clientId, { storagePath, url });
  }

  function clearHiredClientAvatar(clientId) {
    const current = hiredClientAvatarUrls.get(clientId);
    if (current) URL.revokeObjectURL(current.url);
    hiredClientAvatarUrls.delete(clientId);
  }

  function renderHiredClientAvatars() {
    $$('[data-client-avatar-path]').forEach(async image => {
      const clientId = image.dataset.clientAvatarId;
      const storagePath = image.dataset.clientAvatarPath;
      const cached = hiredClientAvatarUrls.get(clientId);
      if (cached?.storagePath === storagePath) {
        image.src = cached.url;
        image.hidden = false;
        return;
      }
      try {
        const loadKey = `${clientId}:${storagePath}`;
        let load = hiredClientAvatarLoads.get(loadKey);
        if (!load) {
          load = getDocumentBlob(storagePath).then(blob => {
            const item = data.applications.find(application => application.id === clientId);
            if (!item || item.profileImage?.storagePath !== storagePath) return '';
            cacheHiredClientAvatar(clientId, storagePath, blob);
            return hiredClientAvatarUrls.get(clientId).url;
          }).finally(() => hiredClientAvatarLoads.delete(loadKey));
          hiredClientAvatarLoads.set(loadKey, load);
        }
        const url = await load;
        if (!url || !image.isConnected || image.dataset.clientAvatarPath !== storagePath) return;
        image.src = url;
        image.hidden = false;
      } catch (error) {
        console.error('Could not load client profile photo:', error);
        showActionResult({
          title: 'Profile photo could not be loaded',
          message: 'The client photo is unavailable. The initials avatar will remain visible.',
          status: 'error'
        });
      }
    });
  }

  function formatFileSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function isContractEnded(item) {
    return String(item.contractStatus || '').trim().toLowerCase() === 'contract ended'
      || Boolean(item.contractEndDate && dateKey(item.contractEndDate) < today());
  }

  function isActiveContract(item) {
    return item.status === 'Active client'
      && !isContractEnded(item)
      && String(item.contractStatus || 'Active').trim().toLowerCase() === 'active';
  }

  function contractEndingLabel(item) {
    if (!item.contractEndDate || isContractEnded(item)) return '';
    const endDate = new Date(`${dateKey(item.contractEndDate)}T12:00:00`);
    const currentDate = new Date(`${today()}T12:00:00`);
    const daysRemaining = Math.round((endDate - currentDate) / 86400000);
    if (daysRemaining < 0 || daysRemaining > 7) return '';
    if (daysRemaining === 0) return 'Ends today';
    return `Ends in ${plural(daysRemaining, 'day')}`;
  }

  function clientOnlineStatus(item, now = new Date()) {
    const timeZone = clientTimeZones.get(item.id);
    if (!timeZone) return { className: 'unknown', text: 'Time zone not set', localTime: '', utcOffset: '', country: '' };
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
        hourCycle: 'h23'
      }).formatToParts(now);
      const part = type => parts.find(value => value.type === type)?.value;
      const weekday = part('weekday');
      const hour = Number(part('hour'));
      if (!weekday || !Number.isInteger(hour)) return { className: 'unknown', text: 'Time zone not set', localTime: '', utcOffset: '', country: '' };
      const localTime = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: 'numeric',
        minute: '2-digit'
      }).format(now);
      const offsetLabel = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'longOffset'
      }).formatToParts(now).find(value => value.type === 'timeZoneName')?.value || 'GMT';
      const utcOffset = offsetLabel === 'GMT' || offsetLabel === 'UTC'
        ? 'UTC+00:00'
        : offsetLabel.replace(/^GMT/, 'UTC');
      const availabilityMatch = String(item.clientAvailability || '').match(/^\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*[–-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*$/i);
      const validAvailability = availabilityMatch
        && [1, 4].every(index => Number(availabilityMatch[index]) >= 1 && Number(availabilityMatch[index]) <= 12)
        && [2, 5].every(index => !availabilityMatch[index] || Number(availabilityMatch[index]) <= 59);
      const availabilityMinutes = validAvailability ? availabilityMatch.slice(1).map(Number) : null;
      const toMinutes = (hours, minutes, meridiem) => ((hours % 12) + (meridiem.toUpperCase() === 'PM' ? 12 : 0)) * 60 + minutes;
      const parsedStartMinutes = availabilityMinutes
        ? toMinutes(availabilityMinutes[0], availabilityMinutes[1] || 0, availabilityMatch[3])
        : 9 * 60;
      const parsedEndMinutes = availabilityMinutes
        ? toMinutes(availabilityMinutes[3], availabilityMinutes[4] || 0, availabilityMatch[6])
        : 17 * 60;
      const hasAvailability = Boolean(availabilityMinutes && parsedEndMinutes > parsedStartMinutes);
      const startMinutes = hasAvailability ? parsedStartMinutes : 9 * 60;
      const endMinutes = hasAvailability ? parsedEndMinutes : 17 * 60;
      const availability = hasAvailability ? item.clientAvailability : '';
      const localMinutes = hour * 60 + Number(part('minute'));
      const isOnline = !['Sat', 'Sun'].includes(weekday) && localMinutes >= startMinutes && localMinutes < endMinutes;
      const country = String(item.location || '').trim();
      return {
        className: isOnline ? 'online' : 'offline',
        text: `${isOnline ? 'Online now' : 'Offline'} · ${localTime} · ${utcOffset}${country ? ` · ${country}` : ''}${availability ? ` · ${availability}` : ''}`,
        localTime,
        utcOffset,
        country,
        availability
      };
    } catch (error) {
      if (error instanceof RangeError) return { className: 'unknown', text: 'Time zone not set', localTime: '', utcOffset: '', country: '' };
      throw error;
    }
  }

  function clientOnlineStatusTitle(status) {
    return `Estimated from weekdays and the client's submitted work hours${status.availability ? ` (${status.availability})` : ' (9 AM–5 PM default)'}`;
  }

  function renderClientOnlineStatus(item, includeLabel = true) {
    const status = clientOnlineStatus(item);
    return `<span class="client-online-status ${status.className}${includeLabel ? '' : ' status-dot-only'}" title="${includeLabel ? escapeHtml(clientOnlineStatusTitle(status)) : escapeHtml(status.text)}" aria-label="${escapeHtml(status.text)}" data-client-online-status="${escapeHtml(item.id)}" data-status-dot-only="${!includeLabel}">${includeLabel ? escapeHtml(status.text) : ''}</span>`;
  }

  function updateClientOnlineIndicators() {
    document.querySelectorAll('[data-client-online-status]').forEach(indicator => {
      const item = data.applications.find(application => application.id === indicator.dataset.clientOnlineStatus);
      if (!item) return;
      const status = clientOnlineStatus(item);
      indicator.className = `client-online-status ${status.className}${indicator.dataset.statusDotOnly === 'true' ? ' status-dot-only' : ''}`;
      if (indicator.classList.contains('status-dot-only')) {
        indicator.textContent = '';
        indicator.title = status.text;
        indicator.setAttribute('aria-label', status.text);
        const timeZoneText = indicator.closest('.hired-card-timezone')?.querySelector('[data-client-timezone-text]');
        if (timeZoneText && status.localTime) timeZoneText.textContent = `${status.localTime} (${status.utcOffset})${status.country ? ` · ${status.country}` : ''}${status.availability ? ` · ${status.availability}` : ''}`;
      } else {
        indicator.textContent = status.text;
        indicator.title = clientOnlineStatusTitle(status);
      }
    });
    const detailIndicator = $('#hiredDetailOnlineStatus');
    const detailClient = data.applications.find(application => application.id === hiredEditingId);
    if (detailIndicator && detailClient) {
      const status = clientOnlineStatus(detailClient);
      detailIndicator.className = `client-online-status ${status.className}`;
      detailIndicator.textContent = status.text;
      detailIndicator.title = clientOnlineStatusTitle(status);
    }
  }

  setInterval(updateClientOnlineIndicators, 60000);
  window.addEventListener('focus', updateClientOnlineIndicators);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateClientOnlineIndicators();
  });

  let showingHiredClientList = false;

  function renderHired() {
    const allHired = sortByDate(hiredClients(), activeSinceDate, hiredDateSort);
    const query = $('#hiredSearch').value.trim().toLowerCase();
    const filter = $('#hiredStatusFilter').value;
    const clients = allHired.filter(item => {
      const contractStatus = isContractEnded(item) ? 'Contract Ended' : (item.contractStatus || 'Active');
      const searchableText = [
        item.clientName, item.email, item.phone, item.website, item.socialMedia,
        ...normalizeClientSocialLinks(item).flatMap(link => [link.platform, CLIENT_SOCIAL_PLATFORM_LABELS[link.platform], link.url]), item.location,
        item.companyName, item.company, item.role, contractStatus
      ].join(' ').toLowerCase();
      return (filter === 'all' || contractStatus === filter)
        && (!query || searchableText.includes(query));
    });
    const nonEndedClients = clients.filter(item => !isContractEnded(item));
    const endedClients = clients.filter(isContractEnded);
    const target = $('#hiredList');
    const detailPanel = $('#hiredDetailPanel');
    const hiredView = $('#hiredView');
    const panel = target.closest('.hired-panel');
    const allActiveClients = allHired.filter(isActiveContract);
    const allEndedClients = allHired.filter(isContractEnded);
    $('#hiredCountLabel').textContent = `${allHired.length} ${allHired.length === 1 ? 'client' : 'clients'}`;
    $('#hiredActiveSummary').textContent = String(allActiveClients.length);
    $('#hiredEndedSummary').textContent = String(allEndedClients.length);
    const selected = allHired.find(item => item.id === hiredEditingId)
      || allActiveClients[0];
    if (!selected && allHired.length) showingHiredClientList = true;

    if (showingHiredClientList) {
      hiredView.classList.remove('client-focused');
      $('#hiredCountLabel').hidden = false;
      $('#hiredHeaderSummary').hidden = false;
      detailPanel.classList.add('hidden');
      detailPanel.dataset.clientId = '';
      panel.hidden = false;
      target.innerHTML = clients.length
        ? [
          ...nonEndedClients.map(renderActiveClientCard),
          ...(endedClients.length ? ['<h3 class="hired-ended-heading">Ended</h3>', ...endedClients.map(renderActiveClientCard)] : [])
        ].join('')
        : `<div class="application-empty"><h3>${allHired.length ? 'No matching clients' : 'No clients yet'}</h3><p>${allHired.length ? 'Try changing your search or filters.' : 'Clients marked as active in your tracker will appear here.'}</p></div>`;
      renderHiredClientAvatars();
      return;
    }
    if (selected) {
      renderHiredDetail(selected, false);
      return;
    }
    hiredView.classList.remove('client-focused');
    $('#hiredCountLabel').hidden = false;
    $('#hiredHeaderSummary').hidden = false;
    target.innerHTML = '<div class="application-empty"><h3>No active clients yet</h3><p>Clients with an active contract will appear here.</p></div>';
    panel.hidden = false;
    detailPanel.classList.add('hidden');
    detailPanel.dataset.clientId = '';
  }

  function renderActiveClientCard(item) {
    const docs = item.documents || [];
    const contractEnded = isContractEnded(item);
    const contractStatus = contractEnded ? 'Contract Ended' : (item.contractStatus || 'Active');
    const endingLabel = contractEnded ? 'Contract ended' : contractEndingLabel(item);
    const statusLabel = endingLabel || (contractStatus === 'Not active' ? 'Not active' : 'Active');
    const statusPillClass = contractEnded ? 'contract-ended'
      : (endingLabel ? 'contract-ending-soon' : (contractStatus === 'Not active' ? 'not-active' : 'contract-active'));
    const contractDetails = [
      item.employmentType,
      activeSinceDate(item) ? `Since ${emailDate(activeSinceDate(item))}` : ''
    ].filter(Boolean).map(escapeHtml).join(' · ');
    const initials = clientInitials(item.clientName);
    const avatarTone = clientAvatarHue(item.clientName);
    const emailMarkup = item.email ? `<span class="hired-card-email" title="${escapeHtml(item.email)}">${escapeHtml(item.email)}</span>` : '';
    const websiteMarkup = item.website ? `<a class="hired-card-website" href="${escapeHtml(normalizeUrl(item.website))}" target="_blank" rel="noopener"><i class="fa-solid fa-globe" aria-hidden="true"></i><span>${escapeHtml(item.website)}</span></a>` : '';
    const companyMarkup = item.companyName || item.company
      ? `<span class="hired-card-company">${escapeHtml(item.companyName || item.company)}</span>`
      : websiteMarkup;
    const matchCount = matchingEmailsForApplication(item)
      .filter(emailItem => !isSentEmail(emailItem)).length;
    const matchMarkup = matchCount
      ? `<span class="hired-card-match"><i class="fa-regular fa-envelope" title="Emails" aria-label="Emails"></i>${matchBadge(item).replace('title="View matching application emails"', `title="${matchCount} matching incoming emails"`)}</span>`
      : '';
    const timeZone = clientTimeZones.has(item.id) ? clientOnlineStatus(item) : null;
    const timeZoneMarkup = timeZone?.localTime
      ? `<span class="hired-card-timezone">${!contractEnded ? renderClientOnlineStatus(item, false) : ''}<span class="hired-card-timezone-separator" aria-hidden="true">·</span><span data-client-timezone-text>${escapeHtml(`${timeZone.localTime} (${timeZone.utcOffset})${timeZone.country ? ` · ${timeZone.country}` : ''}`)}</span></span>`
      : '';
    const avatarPath = item.profileImage?.storagePath || '';
    const clientDisplayName = [item.contact, item.companyName || item.company || item.clientName]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .join(' | ') || 'Active client';
    return `<article class="hired-card${contractEnded ? ' contract-ended-card' : ''}" data-hired-select="${escapeHtml(item.id)}" tabindex="0" role="button">
      <span class="hired-card-heading"><span class="hired-card-profile"><span class="hired-card-avatar" style="--avatar-tone:${avatarTone}"><span aria-hidden="true">${escapeHtml(initials)}</span>${avatarPath ? `<img class="hired-card-avatar-image" data-client-avatar-id="${escapeHtml(item.id)}" data-client-avatar-path="${escapeHtml(avatarPath)}" alt="${escapeHtml(item.clientName)} profile photo" hidden />` : ''}</span><span class="hired-card-identity"><strong class="client-card-title hired-client-contact-name" title="${escapeHtml(clientDisplayName)}">${escapeHtml(clientDisplayName)}</strong>${item.role ? `<span class="client-card-subtitle">${escapeHtml(item.role)}</span>` : ''}</span></span><span class="client-contract-status ${statusPillClass}">${escapeHtml(statusLabel)}</span></span>
      ${emailMarkup ? `<span class="hired-card-email-line">${emailMarkup}</span>` : ''}
      ${companyMarkup || timeZoneMarkup ? `<span class="hired-card-contact">${companyMarkup}${timeZoneMarkup}</span>` : ''}
      ${contractDetails ? `<span class="hired-card-contract"><i class="fa-regular fa-calendar" aria-hidden="true"></i>${contractDetails}</span>` : ''}
      <span class="hired-card-footer">${docs.length ? `<span class="hired-card-files" title="${escapeHtml(plural(docs.length, 'file'))}"><i class="fa-regular fa-file" aria-hidden="true"></i>${escapeHtml(plural(docs.length, 'file'))}</span>` : ''}${matchMarkup}<span class="view-details-label">View Details <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></span></span>
    </article>`;
  }

  $('#backToHiredList').addEventListener('click', () => {
    showingHiredClientList = true;
    renderHired();
  });
  $('#hiredSearch').addEventListener('input', renderHired);
  $('#hiredDateSort').addEventListener('change', event => {
    hiredDateSort = event.target.value;
    renderHired();
  });
  $('#hiredStatusFilter').addEventListener('change', renderHired);

  function renderHiredDetail(item, scroll = true) {
    if (!item) return;
    showingHiredClientList = false;
    $('#hiredCountLabel').hidden = true;
    $('#hiredHeaderSummary').hidden = true;
    hiredEditingId = item.id;
    $('#hiredView').classList.add('client-focused');
    $('#hiredList').innerHTML = '';
    $('#hiredList').closest('.hired-panel').hidden = true;
    const detailPanel = $('#hiredDetailPanel');
    detailPanel.classList.remove('hidden');
    if (detailPanel.dataset.clientId !== item.id) {
      detailPanel.dataset.clientId = item.id;
      selectClientDetailTab('overview');
    }
    const contractEnded = isContractEnded(item);
    const contractStatus = contractEnded ? 'Contract Ended' : (item.contractStatus || 'Active');
    const contractStatusClass = contractEnded ? 'contract-ended' : (contractStatus === 'Not active' ? 'not-active' : 'contract-active');
    const salaryLabel = item.salaryType === 'monthly' && Number(item.salaryAmount) > 0
      ? `${salaryCurrencySymbol(item.salaryCurrency)}${Number(item.salaryAmount).toLocaleString()} / month`
      : item.salaryType === 'hourly' && Number(item.salaryAmount) > 0 && Number(item.hoursPerWeek) > 0
        ? `${salaryCurrencySymbol(item.salaryCurrency)}${Math.round(Number(item.salaryAmount) * Number(item.hoursPerWeek) * 4).toLocaleString()} / month (estimated)`
        : item.salaryType === 'hourly' && Number(item.salaryAmount) > 0
          ? `${salaryCurrencySymbol(item.salaryCurrency)}${Number(item.salaryAmount).toLocaleString()} / hour`
          : '';
    $('#hiredDetailTitle').textContent = 'Client details';
    $('#hiredDetailSubtitle').textContent = item.role || 'Client workspace';
    $('#hiredDetailStatus').className = `status-pill ${contractStatusClass}`;
    $('#hiredDetailStatus').textContent = contractStatus;
    const onlineStatus = $('#hiredDetailOnlineStatus');
    onlineStatus.dataset.clientOnlineStatus = item.id;
    const clientStatus = clientOnlineStatus(item);
    onlineStatus.className = `client-online-status ${clientStatus.className}`;
    onlineStatus.textContent = clientStatus.text;
    onlineStatus.title = clientOnlineStatusTitle(clientStatus);
    const contactDetails = [
      item.email ? `<a href="mailto:${escapeHtml(item.email)}">${escapeHtml(item.email)}</a>` : '',
      item.phone ? `<a href="tel:${escapeHtml(item.phone)}">${escapeHtml(item.phone)}</a>` : ''
    ].filter(Boolean);
    $('#hiredDetailContact').innerHTML = contactDetails.length
      ? `<span class="hired-detail-contact-separator" aria-hidden="true">·</span>${contactDetails.join('<span class="hired-detail-contact-separator" aria-hidden="true">·</span>')}`
      : '';
    const invoices = (data.invoices || []).filter(invoice => invoice.clientId === item.id).sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
    const sentEmails = sentEmailsForApplication(item);
    const latestInvoice = invoices[0];
    const latestEmail = sentEmails[0];
    const profileImagePath = item.profileImage?.storagePath || '';
    const clientDetailName = [item.contact, item.companyName || item.company || item.clientName]
      .map(value => String(value || '').trim()).filter(Boolean).join(' | ') || 'Active client';
    $('#clientOverviewProfile').innerHTML = `
      <article class="client-overview-profile-card">
        <div class="client-overview-profile-main">
          <span class="client-overview-profile-photo" data-client-avatar-control>
            <span class="client-overview-profile-avatar"><span aria-hidden="true">${escapeHtml(clientInitials(item.clientName))}</span>${profileImagePath ? `<img class="client-overview-profile-image" data-client-avatar-id="${escapeHtml(item.id)}" data-client-avatar-path="${escapeHtml(profileImagePath)}" alt="${escapeHtml(item.clientName)} profile photo" hidden />` : ''}</span>
            <button class="client-overview-profile-upload" type="button" data-client-avatar-upload="${escapeHtml(item.id)}" aria-label="${profileImagePath ? 'Change' : 'Upload'} profile photo for ${escapeHtml(item.clientName)}" title="${profileImagePath ? 'Change profile photo' : 'Upload profile photo'}"><i class="fa-solid fa-camera" aria-hidden="true"></i></button>
            <input type="file" accept=".jpg,.jpeg,.jpe,.png,.webp,image/jpeg,image/jpg,image/pjpeg,image/png,image/x-png,image/webp" data-client-avatar-input="${escapeHtml(item.id)}" aria-label="Choose a profile photo for ${escapeHtml(item.clientName)}" hidden />
          </span>
          <div class="client-overview-profile-identity"><span>CLIENT PROFILE</span><div class="client-overview-profile-name"><h3 title="${escapeHtml(clientDetailName)}">${escapeHtml(clientDetailName)}</h3><span class="status-pill ${contractStatusClass}">${escapeHtml(contractStatus)}</span></div><p>${escapeHtml(item.role || 'Client workspace')}</p></div>
        </div>
        <div class="client-overview-profile-facts">
          ${item.email ? `<a href="mailto:${escapeHtml(item.email)}"><i class="fa-regular fa-envelope" aria-hidden="true"></i><span>${escapeHtml(item.email)}</span></a>` : ''}
          ${item.phone ? `<a href="tel:${escapeHtml(item.phone)}"><i class="fa-solid fa-phone" aria-hidden="true"></i><span>${escapeHtml(item.phone)}</span></a>` : ''}
          <span><i class="fa-regular fa-calendar" aria-hidden="true"></i><span>${item.contractEndDate ? `Ends ${escapeHtml(formatDate(item.contractEndDate))}` : 'No end date set'}</span></span>
          ${salaryLabel ? `<span><i class="fa-solid fa-coins" aria-hidden="true"></i><span>${escapeHtml(salaryLabel)}</span></span>` : ''}
        </div>
      </article>`;
    renderHiredClientAvatars();
    $('#clientOverviewSummary').innerHTML = `
      <div class="client-overview-summary-item"><span>Active since</span><strong>${escapeHtml(emailDate(activeSinceDate(item)))}</strong><small>${escapeHtml(contractStatus)} engagement</small></div>
      <div class="client-overview-summary-item"><span>Onboarding</span><strong id="clientOverviewOnboardingStatus">Checking status</strong><small>Client form response</small></div>
      <div class="client-overview-summary-item"><span>Invoices</span><strong>${escapeHtml(plural(invoices.length, 'invoice'))}</strong><small>${latestInvoice ? `Last sent ${escapeHtml(emailDate(latestInvoice.sentAt))}` : 'No invoices sent yet'}</small></div>
      <div class="client-overview-summary-item"><span>Email History</span><strong>${escapeHtml(plural(sentEmails.length, 'email'))}</strong><small>${latestEmail ? `Last sent ${escapeHtml(emailDate(latestEmail.date))}` : 'No emails sent yet'}</small></div>`;
    const detailsMarkup = fields => fields.filter(([, value]) => value).map(([label, value]) => `
      <div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`).join('');
    const contactFields = detailsMarkup([
      ['Contact', item.contact && escapeHtml(item.contact)],
      ['Email', item.email && `<a href="mailto:${escapeHtml(item.email)}">${escapeHtml(item.email)}</a>`],
      ['Phone', item.phone && `<a href="tel:${escapeHtml(item.phone)}">${escapeHtml(item.phone)}</a>`],
      ['Application Link', item.website && `<a href="${escapeHtml(normalizeUrl(item.website))}" target="_blank" rel="noopener">${escapeHtml(item.website)}</a>`],
      ['Social media & websites', clientSocialLinksMarkup(item)],
      ['Location', item.location && escapeHtml(item.location)]
    ]);
    const workFields = detailsMarkup([
      ['Position', item.role && escapeHtml(item.role)],
      ['Platform', item.platform && escapeHtml(item.platform)],
      ['Employment type', item.employmentType && escapeHtml(item.employmentType)],
      ['Compensation', salaryLabel && escapeHtml(salaryLabel)],
      ['Hours per week', Number(item.hoursPerWeek) > 0 && escapeHtml(String(item.hoursPerWeek))]
    ]);
    $('#hiredDetailGrid').innerHTML = `
      <section class="hired-detail-info-group">
        <h4>Contact Information</h4>
        ${contactFields ? `<dl>${contactFields}</dl>` : '<p class="client-detail-empty-copy">No contact information has been added.</p>'}
      </section>
      <section class="hired-detail-info-group">
        <h4>Work Information</h4>
        ${workFields ? `<dl>${workFields}</dl>` : '<p class="client-detail-empty-copy">No work information has been added.</p>'}
      </section>
      <section class="hired-detail-info-group hired-detail-timeline">
        <h4>Client History</h4>
        <dl>${detailsMarkup([
          ['Applied', item.appliedDate && escapeHtml(emailDate(item.appliedDate))],
          ['Added', escapeHtml(emailDate(applicationAddedDate(item)))],
          ['Active since', escapeHtml(emailDate(activeSinceDate(item)))]
        ])}</dl>
      </section>
      ${item.notes ? `<section class="hired-detail-info-group hired-detail-notes"><h4>Notes</h4><p>${escapeHtml(item.notes)}</p></section>` : ''}`;
    $('#clientContractSummary').innerHTML = `
      <dl class="client-contract-facts">
        <div><dt>Status</dt><dd><span class="status-pill ${contractStatusClass}">${escapeHtml(contractStatus)}</span></dd></div>
        <div><dt>Active since</dt><dd>${escapeHtml(emailDate(activeSinceDate(item)))}</dd></div>
        <div><dt>End date</dt><dd>${item.contractEndDate ? escapeHtml(formatDate(item.contractEndDate)) : 'No end date set'}</dd></div>
        ${item.contractEndDate && contractDuration(item) ? `<div><dt>Duration</dt><dd>${escapeHtml(contractDuration(item))}</dd></div>` : ''}
        ${contractEnded ? `<div><dt>Contract ended email</dt><dd><span class="status-pill ${item.contractEndedEmailSentAt ? 'contract-active' : 'not-active'}">${item.contractEndedEmailSentAt ? 'Sent' : 'Not sent'}</span></dd></div>` : ''}
      </dl>`;
    $('#clientInvoiceWorkspace').innerHTML = `
      <section class="invoice-send-panel client-invoice-panel${contractEnded ? ' contract-ended-readonly' : ''}" aria-labelledby="clientInvoicesTitle">
        <div class="invoice-send-heading"><div><p class="eyebrow">BILLING</p><h3 id="clientInvoicesTitle">Invoices</h3></div><div class="client-invoice-heading-actions"><span class="invoice-sent-count">${escapeHtml(plural(invoices.length, 'invoice'))}</span></div></div>
        ${contractEnded ? '<div class="client-invoice-actions"><p class="client-invoice-notice">Invoice sending is unavailable while this contract is ended.</p></div>' : ''}
        ${invoices.length ? `${invoicePaymentSummary(invoices)}<div class="client-invoice-list" role="list">${invoices.map(invoice => {
          const status = invoicePaymentStatus(invoice);
          const paid = status === 'Paid';
          const dueDate = parseInvoiceDate(invoice.dueDate);
          const invoiceNumber = invoice.invoiceNumber || 'Invoice';
          const displayedStatus = paid ? 'Paid' : status === 'Overdue' ? 'Overdue' : 'Unpaid';
          const dueDays = dueDate ? Math.round((new Date(`${dueDate}T00:00:00Z`) - new Date(`${today()}T00:00:00Z`)) / 86400000) : null;
          const dueCopy = dueDays === null ? '' : dueDays < 0 ? `overdue by ${plural(Math.abs(dueDays), 'day')}` : dueDays === 0 ? 'due today' : `in ${plural(dueDays, 'day')}`;
          const paidDate = parseInvoiceDate(invoice.paidAt);
          const paidAmount = invoice.amountReceived === '' || invoice.amountReceived == null ? '' : Number(invoice.amountReceived);
          const paidInfo = [Number.isFinite(paidAmount) ? `${paidAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}${invoice.paymentCurrency ? ` ${String(invoice.paymentCurrency).toUpperCase()}` : ''}` : '', invoice.paymentMethod || ''].filter(Boolean).join(' · ');
          return `
          <article class="client-invoice-item" role="listitem">
            <div class="client-invoice-main"><div class="client-invoice-title"><strong>${escapeHtml(invoiceNumber)}</strong><span class="status-pill ${paid ? 'contract-active' : status === 'Overdue' ? 'not-active' : 'applied'}">${escapeHtml(displayedStatus)}</span></div><span class="client-invoice-file" title="${escapeHtml(invoice.fileName || 'Invoice document')}">${escapeHtml(invoice.fileName || 'Invoice document')}</span></div>
            <div class="client-invoice-meta">
              ${invoice.service ? `<div class="client-invoice-meta-item"><span>Service</span><strong title="${escapeHtml(invoice.service)}">${escapeHtml(invoice.service)}</strong></div>` : ''}
              ${invoice.billingPeriod ? `<div class="client-invoice-meta-item"><span>Period</span><strong>${escapeHtml(invoice.billingPeriod)}</strong></div>` : ''}
              ${invoice.sentAt ? `<div class="client-invoice-meta-item"><span>Sent</span><strong>${escapeHtml(emailDate(invoice.sentAt))}</strong></div>` : ''}
              ${dueDate && !paid ? `<div class="client-invoice-meta-item"><span>Due</span><strong>${escapeHtml(formatDate(dueDate))}${dueCopy ? ` · <span class="${dueDays < 0 ? 'client-invoice-overdue-copy' : ''}">${escapeHtml(dueCopy)}</span>` : ''}</strong></div>` : ''}
            </div>
            <div class="client-invoice-date">${paid ? `<strong class="client-invoice-paid-date">Paid on ${escapeHtml(paidDate ? formatDate(paidDate) : emailDate(invoice.paidAt))}</strong>${paidInfo ? `<span class="client-invoice-paid-detail">${escapeHtml(paidInfo)}</span>` : ''}` : ''}<div class="client-invoice-payment-actions">${paid ? `<button class="button button-secondary" type="button" data-invoice-edit-payment="${escapeHtml(invoice.id)}" aria-label="Edit payment for invoice ${escapeHtml(invoiceNumber)}">Edit payment</button><button class="client-invoice-unpaid-action" type="button" data-invoice-mark-unpaid="${escapeHtml(invoice.id)}" aria-label="Mark invoice ${escapeHtml(invoiceNumber)} as unpaid">Mark as unpaid</button>` : `<button class="button button-secondary" type="button" data-invoice-mark-paid="${escapeHtml(invoice.id)}" aria-label="Mark invoice ${escapeHtml(invoiceNumber)} as paid">Mark as paid</button>`}</div></div>
          </article>`;
        }).join('')}</div>` : `<div class="client-section-empty client-invoice-empty"><h4>No invoices yet</h4><p>${contractEnded ? 'No invoices have been sent to this client.' : 'Send an invoice to keep billing history together.'}</p></div>`}
      </section>`;
    $('#clientEmailHistoryWorkspace').innerHTML = renderHiredEmailHistory(item);
    $('#clientDocumentActions').innerHTML = contractEnded
      ? '<span class="details-readonly-label">Read only</span>'
      : '<input id="hiredDetailDocumentInput" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden />';
    $('#clientDocumentBox').classList.toggle('contract-ended-readonly', contractEnded);
    $('#documentsFolderStatus').textContent = 'Files are stored securely in your account.';
    renderHiredDocumentWorkspace(item);
    loadClientOnboardingSubmission(item);
    renderClientTasks(item.id);
    if (scroll) $('#hiredDetailPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateHiredClientPhoneDisplay(item) {
    const contactDetails = [
      item.email ? `<a href="mailto:${escapeHtml(item.email)}">${escapeHtml(item.email)}</a>` : '',
      item.phone ? `<a href="tel:${escapeHtml(item.phone)}">${escapeHtml(item.phone)}</a>` : ''
    ].filter(Boolean);
    $('#hiredDetailContact').innerHTML = contactDetails.length
      ? `<span class="hired-detail-contact-separator" aria-hidden="true">·</span>${contactDetails.join('<span class="hired-detail-contact-separator" aria-hidden="true">·</span>')}`
      : '';

    const contactSection = $('#hiredDetailGrid .hired-detail-info-group');
    if (!contactSection) return;
    let details = contactSection.querySelector('dl');
    const phoneRow = [...(details?.children || [])].find(row => row.querySelector('dt')?.textContent === 'Phone');
    if (!item.phone) {
      phoneRow?.remove();
      return;
    }
    if (!details) {
      contactSection.querySelector('.client-detail-empty-copy')?.remove();
      details = document.createElement('dl');
      contactSection.append(details);
    }
    const row = phoneRow || document.createElement('div');
    if (!phoneRow) {
      const term = document.createElement('dt');
      term.textContent = 'Phone';
      row.append(term, document.createElement('dd'));
      details.append(row);
    }
    const phoneLink = document.createElement('a');
    phoneLink.href = `tel:${item.phone.replace(/[^+\d]/g, '')}`;
    phoneLink.textContent = item.phone;
    row.querySelector('dd').replaceChildren(phoneLink);
  }

  async function loadClientOnboardingSubmission(item) {
    const target = $('#activeOnboardingResponse');
    if (!target) return;
    target.dataset.clientId = item.id;
    updateClientOnboardingStatus('Checking status', 'pending');
    target.innerHTML = '<p class="client-onboarding-loading">Loading onboarding details…</p>';
    try {
      const { data: submission, error } = await requireSupabase().rpc('get_client_onboarding_submission', {
        p_client_id: item.id
      });
      if (error) throw error;
      if (target.dataset.clientId !== item.id || hiredEditingId !== item.id) return;
      if (!submission) {
        clientTimeZones.delete(item.id);
        updateClientOnlineIndicators();
        updateClientOnboardingStatus('Not submitted', 'empty');
        target.innerHTML = '<div class="client-section-empty"><h4>No onboarding submission yet</h4><p>Use Actions → Send onboarding form to invite this client.</p></div>';
        return;
      }
      const submissionTimestamp = String(submission.submitted_at || '');
      let onboardingDetailsChanged = false;
      const submittedContactName = String(submission.contact_name || '').trim();
      if (submittedContactName && submissionTimestamp && item.onboardingContactSubmissionAppliedAt !== submissionTimestamp) {
        item.contact = submittedContactName;
        item.onboardingContactSubmissionAppliedAt = submissionTimestamp;
        onboardingDetailsChanged = true;
      }
      const submittedPhone = String(submission.phone || '').trim();
      if (submittedPhone && submissionTimestamp && item.onboardingPhoneSubmissionAppliedAt !== submissionTimestamp) {
        item.phone = submittedPhone;
        item.onboardingPhoneSubmissionAppliedAt = submissionTimestamp;
        onboardingDetailsChanged = true;
      }
      const submittedAvailability = String(submission.availability || '').trim();
      if (submittedAvailability && submissionTimestamp && item.onboardingAvailabilitySubmissionAppliedAt !== submissionTimestamp) {
        item.clientAvailability = submittedAvailability;
        item.onboardingAvailabilitySubmissionAppliedAt = submissionTimestamp;
        onboardingDetailsChanged = true;
      }
      if (onboardingDetailsChanged) {
        item.updatedAt = new Date().toISOString();
        const profileName = $('#clientOverviewProfile .client-overview-profile-name h3');
        if (profileName) {
          profileName.textContent = [item.contact, item.companyName || item.company || item.clientName]
            .map(value => String(value || '').trim()).filter(Boolean).join(' | ') || 'Active client';
          profileName.title = profileName.textContent;
        }
        if (submittedPhone) updateHiredClientPhoneDisplay(item);
        await persist();
      }
      if (submission.timezone) clientTimeZones.set(item.id, submission.timezone);
      else clientTimeZones.delete(item.id);
      updateClientOnlineIndicators();
      const onboardingParts = [
        {
          title: 'Part 1: About you',
          details: [
            ['Client contact', submission.contact_name],
            ['Email', submission.client_email],
            ['Phone', submission.phone],
            ['Company or business name', submission.details?.companyName],
            ['Role or title', submission.details?.role]
          ]
        },
        {
          title: 'Part 2: Services and communication',
          details: [
            ['Services needed', Array.isArray(submission.details?.services) ? submission.details.services.join(', ') : ''],
            ['Expected hours per week', submission.details?.hoursPerWeek],
            ['Desired start date', submission.details?.startDate],
            ['Communication channel', submission.details?.preferredChannel],
            ['Expected response time', submission.details?.responseTime]
          ]
        },
        {
          title: 'Part 3: Schedule',
          details: [
            ['Time zone', submission.timezone],
            ['Availability and preferred working hours', submission.availability],
            ['Holidays or blackout dates', submission.details?.blackoutDates]
          ]
        },
        {
          title: 'Part 4: Tools and contacts',
          details: [
            ['Tools or platforms', submission.tools],
            ['First-week priorities', submission.priorities],
            ['Access sharing method', submission.details?.accessMethod],
            ['Backup contact name', submission.details?.backupName],
            ['Backup contact email', submission.details?.backupEmail],
            ['Backup contact phone', submission.details?.backupPhone],
            ['Approval preferences', submission.details?.approval],
            ['Confidentiality and terms agreement', submission.details?.agreement ? 'Agreed' : '']
          ]
        }
      ];
      target.replaceChildren();
      updateClientOnboardingStatus('Submitted', 'complete');
      const submittedAt = document.createElement('p');
      submittedAt.className = 'active-client-onboarding-submitted';
      submittedAt.textContent = `Submitted ${new Date(submission.submitted_at).toLocaleString()}`;
      const parts = document.createElement('div');
      parts.className = 'active-client-onboarding-parts';
      onboardingParts.forEach(part => {
        const section = document.createElement('section');
        section.className = 'active-client-onboarding-part';
        const heading = document.createElement('h4');
        heading.textContent = part.title;
        const list = document.createElement('dl');
        list.className = 'active-client-onboarding-details';
        part.details.forEach(([label, value]) => {
          const wrapper = document.createElement('div');
          const term = document.createElement('dt');
          const description = document.createElement('dd');
          term.textContent = label;
          description.textContent = value || 'Not provided';
          wrapper.append(term, description);
          list.append(wrapper);
        });
        section.append(heading, list);
        parts.append(section);
      });
      target.append(submittedAt, parts);
    } catch (error) {
      console.error('Could not load client onboarding response:', error);
      if (target.dataset.clientId === item.id && hiredEditingId === item.id) {
        updateClientOnboardingStatus('Unavailable', 'error');
        target.innerHTML = '<div class="client-section-empty"><h4>Onboarding could not be loaded</h4><p>Check your connection and try again.</p></div>';
      }
    }
  }

  function updateClientOnboardingStatus(label, state) {
    ['#clientOverviewOnboardingStatus', '#clientOnboardingStatus'].forEach(selector => {
      const status = $(selector);
      if (!status) return;
      status.className = `client-onboarding-status ${state}`;
      status.textContent = label;
    });
  }

  function selectClientDetailTab(tabName, focus = false) {
    const detailPanel = $('#hiredDetailPanel');
    if (!detailPanel) return;
    detailPanel.querySelectorAll('[data-client-detail-tab]').forEach(tab => {
      const isSelected = tab.dataset.clientDetailTab === tabName;
      tab.classList.toggle('active', isSelected);
      tab.setAttribute('aria-selected', String(isSelected));
      tab.tabIndex = isSelected ? 0 : -1;
      if (isSelected && focus) tab.focus();
    });
    detailPanel.querySelectorAll('[data-client-detail-panel]').forEach(panel => {
      panel.hidden = panel.dataset.clientDetailPanel !== tabName;
    });
    if (tabName === 'tasks') renderClientTasks(hiredEditingId);
  }

  function closeHiredDetail(render = true) {
    hiredEditingId = null;
    $('#hiredView').classList.remove('client-focused');
    $('#hiredDetailPanel').classList.add('hidden');
    $('#hiredDetailPanel').dataset.clientId = '';
    if (render) renderHired();
  }


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


  function saveNewClientApplicationDraft() {
    const draft = {};
    $$('#clientForm input[id], #clientForm select[id], #clientForm textarea[id]').forEach(field => {
      if (field.id === 'clientId' || field.type === 'file') return;
      draft[field.id] = field.type === 'checkbox' ? field.checked : field.value;
    });
    draft.socialLinks = readClientSocialLinks({ includeEmpty: true });
    localStorage.setItem(`${APPLICATION_DRAFT_KEY}:${currentUser?.id || 'anonymous'}`, JSON.stringify(draft));
  }

  function restoreNewClientApplicationDraft() {
    const savedDraft = localStorage.getItem(`${APPLICATION_DRAFT_KEY}:${currentUser?.id || 'anonymous'}`);
    if (!savedDraft) return false;

    let draft;
    try {
      draft = JSON.parse(savedDraft);
    } catch (error) {
      console.error('Could not restore the unfinished application:', error);
      showActionResult({ title: 'Unfinished application could not be restored', message: 'The saved draft is invalid and has been kept in browser storage.', status: 'error' });
      return false;
    }
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
      console.error('Could not restore the unfinished application: saved draft has an invalid format.');
      showActionResult({ title: 'Unfinished application could not be restored', message: 'The saved draft has an invalid format and has been kept in browser storage.', status: 'error' });
      return false;
    }

    Object.entries(draft).forEach(([id, value]) => {
      const field = document.getElementById(id);
      if (!field || field.closest('#clientForm') !== $('#clientForm')) return;
      if (field.type === 'checkbox') field.checked = value === true;
      else field.value = String(value ?? '');
    });
    renderClientSocialLinkEditor(Array.isArray(draft.socialLinks) ? draft.socialLinks : []);
    if (!$('#hiredSocial').value && Array.isArray(draft.socialLinks)) {
      $('#hiredSocial').value = String(draft.socialLinks.find(link => link?.url)?.url || '');
    }
    $('#clientPlatform').dispatchEvent(new Event('change'));
    $('#clientCountry').dispatchEvent(new Event('change'));
    if ($('#clientRegion').value) $('#clientRegion').dispatchEvent(new Event('change'));
    updateSalaryFields();
    updateClientActionLabel();
    return true;
  }

  function openClientModal(id = null, viewOnly = false, activeClientOnly = false, drawerEdit = false, activeClientDetailsEdit = false) {
    const form = $('#clientForm');
    form.reset();
    renderClientSocialLinkEditor();
    activeClientDetailsModalEdit = activeClientDetailsEdit;
    $$('#clientForm input, #clientForm select, #clientForm textarea').forEach(field => { field.disabled = false; });
    editingId = id;
    viewingClientDetails = viewOnly;
    $('#clientModal').classList.toggle('application-detail-panel', viewOnly && activeView === 'applications');
    $('#clientId').value = id || '';
    $('#appliedDate').value = id ? '' : today();
    $('#automaticFollowUp').checked = false;
    $('#appliedDate').disabled = false;
    $('#followUpDate').disabled = false;
    $('#automaticFollowUp').disabled = false;
    $('#followUpDate').closest('.form-field')?.classList.remove('hidden');
    $('#automaticFollowUp').closest('.follow-up-option')?.classList.remove('hidden');
    $('#customPlatformField').classList.add('hidden');
    $('#customPlatform').required = false;
    $('#clientCountry').value = '';
    $('#clientRegion').value = '';
    $('#clientRegionField').classList.add('hidden');
    $('#clientFollowUpHistory').classList.add('hidden');
    $('#clientEmailHistory').classList.add('hidden');
    if (id) {
      const item = data.applications.find(application => application.id === id);
      if (!item) return;
      $('#modalEyebrow').textContent = viewOnly ? 'VIEW DETAILS' : 'EDIT RECORD';
      $('#clientModalTitle').textContent = viewOnly ? 'Application details' : 'Update client application';
      $('#saveClientButton').textContent = 'Save changes';
      $('#clientName').value = item.clientName;
      $('#contactName').value = item.contact || '';
      $('#clientRole').value = item.role || '';
      $('#employmentType').value = item.employmentType || '';
      $('#hiredEmail').value = item.email || '';
      $('#hiredPhone').value = item.phone || '';
      $('#hiredWebsite').value = item.website || '';
      $('#hiredSocial').value = item.socialMedia || normalizeClientSocialLinks(item)[0]?.url || '';
      renderClientSocialLinkEditor(normalizeClientSocialLinks(item), viewOnly);
      $('#hiredLocation').value = item.location || '';
      const savedLocation = String(item.location || '');
      const savedCountry = [...$('#clientCountry').options].find(option => savedLocation === option.text || savedLocation.startsWith(`${option.text},`));
      if (savedCountry) {
        $('#clientCountry').value = savedCountry.value;
        $('#clientCountry').dispatchEvent(new Event('change'));
        const savedRegion = [...$('#clientRegion').options].find(option => savedLocation.includes(option.text));
        if (savedRegion) $('#clientRegion').value = savedRegion.value;
      }
      $('#clientStatus').value = ['Ongoing', 'Applied', 'To Proceed', 'Interview', 'Active client', 'Not selected'].includes(item.status) ? item.status : 'Applied';
      $('#nextStep').value = item.nextStep || '';
      if (activeClientOnly && item.status !== 'Active client') return;
      $('#contractEndDate').value = item.contractEndDate || '';
      $('#appliedDate').value = item.appliedDate || '';
      $('#interviewDate').value = item.interviewDate || '';
      $('#interviewLink').value = item.interviewLink || '';
      $('#followUpDate').value = item.followUpDate || '';
      $('#automaticFollowUp').checked = Boolean(item.automaticFollowUp);
      $('#clientNotes').value = item.notes || '';
      renderClientFollowUpHistory(item, viewOnly);
      renderClientEmailHistory(item);
      const listedPlatforms = [...$('#clientPlatform').options].map(option => option.value);
      if (listedPlatforms.includes(item.platform)) {
        $('#clientPlatform').value = item.platform;
      } else {
        $('#clientPlatform').value = 'Other';
        $('#customPlatformField').classList.remove('hidden');
        $('#customPlatform').required = true;
        $('#customPlatform').value = item.platform;
      }
    } else {
      $('#modalEyebrow').textContent = 'NEW RECORD';
      $('#clientModalTitle').textContent = 'Add a client application';
      $('#saveClientButton').textContent = 'Save application';
      $('#salaryType').value = '';
      $('#salaryCurrency').value = 'USD';
      $('#salaryAmount').value = '';
      $('#salaryHoursPerWeek').value = '';
      updateSalaryFields();
    }
    if (id) {
      const item = data.applications.find(application => application.id === id);
      if (item) {
        $('#salaryType').value = item.salaryType || '';
        $('#salaryCurrency').value = item.salaryCurrency || 'USD';
        $('#salaryAmount').value = item.salaryAmount ?? '';
        $('#salaryHoursPerWeek').value = item.hoursPerWeek ?? '';
        updateSalaryFields();
      }
    }
    if (!id && !viewOnly) restoreNewClientApplicationDraft();
    const showSocialAccountEditor = Boolean(id && activeClientOnly && !viewOnly);
    $('#clientSocialLinksField').hidden = !showSocialAccountEditor;
    $('#hiredSocialField').hidden = showSocialAccountEditor;
    [
      ['#hiredWebsite', '#hiredWebsiteLink'],
      ['#hiredSocial', '#hiredSocialLink']
    ].forEach(([inputSelector, linkSelector]) => {
      const input = $(inputSelector);
      const link = $(linkSelector);
      const value = input.value.trim();
      input.hidden = viewOnly;
      link.hidden = !viewOnly || !value;
      link.textContent = value;
      if (value) link.href = normalizeUrl(value);
    });
    $$('#clientForm input, #clientForm select, #clientForm textarea').forEach(field => { field.disabled = viewOnly; });
    updateClientSocialEditorControls(viewOnly || !showSocialAccountEditor);
    if (activeClientOnly) {
      $('#clientStatus').value = 'Active client';
      $('#clientStatus').disabled = true;
    }
    $('#saveClientButton').hidden = viewOnly;
    $('#closeClientDetailsButton').hidden = !viewOnly;
    $('#clientForm').classList.toggle('view-details-form', viewOnly);
    const activeClientEdit = Boolean(id && data.applications.find(application => application.id === id)?.status === 'Active client' && !viewOnly);
    $('#appliedDate').disabled = activeClientEdit;
    $('#followUpDate').disabled = activeClientEdit;
    $('#automaticFollowUp').disabled = activeClientEdit;
    $('#followUpDate').closest('.form-field')?.classList.toggle('hidden', activeClientEdit);
    $('#automaticFollowUp').closest('.follow-up-option')?.classList.toggle('hidden', activeClientEdit);
    if (drawerEdit) {
      showActiveClientDrawerView('edit');
      $('#closeClientDetailsButton').textContent = 'Cancel';
      markActiveClientDrawerFormClean('edit');
    } else {
      $('#clientModal').showModal();
    }
    updateClientActionLabel();
    updateApplicationDuplicateNotice();
    if (drawerEdit) $('#clientName').focus();
    else setTimeout(() => $('#clientName').focus(), 30);
  }

  function renderClientFollowUpHistory(item, viewOnly) {
    const target = $('#clientFollowUpHistory');
    if (!target || !viewOnly) return;
    const clientEmail = String(item.email || '').trim().toLowerCase();
    const followUps = data.emails.filter(email => isSentEmail(email)
      && (email.applicationId === item.id || (clientEmail && String(email.to || '').trim().toLowerCase() === clientEmail && /^follow-up:/i.test(email.subject || ''))))
      .sort((first, second) => new Date(second.date) - new Date(first.date));
    const historicalFollowUp = !followUps.length && item.followUpSentAt
      ? [{ date: item.followUpSentAt, subject: `Follow-up: ${item.clientName}`, historical: true }]
      : followUps;
    target.classList.remove('hidden');
    target.innerHTML = `<div class="client-follow-up-history-head"><span>FOLLOW-UPS SENT</span><strong>${plural(historicalFollowUp.length, 'email')}</strong></div>${historicalFollowUp.length
      ? `<div class="client-follow-up-history-list">${historicalFollowUp.map(email => `<div><span title="${escapeHtml(email.subject || 'Follow-up')}">${escapeHtml(email.subject || 'Follow-up')}</span><small>${escapeHtml(emailDate(email.date))}</small></div>`).join('')}</div>`
      : '<p>No follow-up emails have been sent to this application.</p>'}`;
  }

  function renderClientEmailHistory(item) {
    const target = $('#clientEmailHistory');
    const list = $('#clientEmailHistoryList');
    const count = $('#clientEmailHistoryCount');
    if (!target || !list || !count) return;
    const sentEmails = sentEmailsForApplication(item);
    target.classList.remove('hidden');
    count.textContent = `${sentEmails.length} ${sentEmails.length === 1 ? 'email' : 'emails'}`;
    list.innerHTML = renderSentEmailHistoryItems(sentEmails, 'No emails have been sent to this application.');
  }

  function sentEmailsForApplication(item) {
    const clientEmail = String(item.email || '').trim().toLowerCase();
    return data.emails
      .filter(email => isSentEmail(email)
        && (email.applicationId === item.id || (!email.applicationId && clientEmail && String(email.to || '').trim().toLowerCase() === clientEmail)))
      .sort((first, second) => new Date(second.date) - new Date(first.date));
  }

  function renderSentEmailHistoryItems(sentEmails, emptyMessage) {
    return sentEmails.length
      ? sentEmails.map(email => `<button type="button" class="client-email-history-item" data-email-detail="${escapeHtml(email.id)}" aria-label="Open email: ${escapeHtml(email.subject || 'No subject')}, sent ${escapeHtml(emailDate(email.date))}"><span class="client-email-history-copy"><strong title="${escapeHtml(email.subject || '(No subject)')}">${escapeHtml(email.subject || '(No subject)')}</strong><small>To ${escapeHtml(email.to || 'client')}</small></span><span class="client-email-history-meta"><span class="client-email-direction">Sent</span><time>${escapeHtml(emailDate(email.date))}</time></span></button>`).join('')
      : `<p>${emptyMessage}</p>`;
  }

  function renderHiredEmailHistory(item) {
    const sentEmails = sentEmailsForApplication(item);
    return `<section class="client-email-history hired-email-history" aria-live="polite">
      <div class="client-email-history-head"><div><p class="eyebrow">CLIENT COMMUNICATION</p><h3>Email History</h3><span>Sent to this client</span></div><strong>${plural(sentEmails.length, 'email')}</strong></div>
      <div class="client-email-history-list">${renderSentEmailHistoryItems(sentEmails, 'No emails have been sent to this client.')}</div>
    </section>`;
  }

  function updateClientActionLabel() {
    const button = $('#saveClientButton');
    if (!button) return;
    const activeClient = $('#clientStatus').value === 'Active client';
    const activeClientDrawerEdit = isActiveClientDrawerView('edit');
    button.textContent = activeClient && !activeClientDrawerEdit && !activeClientDetailsModalEdit ? 'Next' : (editingId ? 'Save changes' : 'Save application');
    $$('.contract-field').forEach(field => field.classList.toggle('hidden', !activeClient));
    const activeClientEdit = Boolean(editingId && activeClient && !viewingClientDetails);
    $('#appliedDate').disabled = activeClientEdit;
    $('#followUpDate').disabled = activeClientEdit;
    $('#automaticFollowUp').disabled = activeClientEdit;
    $('#followUpDate').closest('.form-field')?.classList.toggle('hidden', activeClientEdit);
    $('#automaticFollowUp').closest('.follow-up-option')?.classList.toggle('hidden', activeClientEdit);
    const isInterview = $('#clientStatus').value === 'Interview';
    $$('.interview-field').forEach(field => field.classList.toggle('hidden', !isInterview));
    const interviewDate = $('#interviewDate');
    const interviewLink = $('#interviewLink');
    [interviewDate, interviewLink].forEach(field => {
      if (!field) return;
      field.required = isInterview;
      field.setCustomValidity(isInterview ? '' : '');
    });
    $('#closeClientDetailsButton').hidden = false;
    if (!activeClientDrawerEdit) $('#closeClientDetailsButton').textContent = (viewingClientDetails || editingId) ? 'Close' : 'Cancel';
    $('#nextStepField').classList.toggle('hidden', $('#clientStatus').value !== 'To Proceed');
    $('#sendProceedEmailButton').hidden = viewingClientDetails || $('#clientStatus').value !== 'To Proceed';
  }

  function normalizeApplicationIdentity(value) {
    return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function findDuplicateApplication(candidate, applications = data.applications) {
    if (candidate.id) return undefined;
    const fields = ['clientName', 'contact', 'email', 'role'];
    const values = fields.map(field => normalizeApplicationIdentity(candidate[field]));
    if (values.some(value => !value) || !values[2].includes('@')) return undefined;
    const matches = item => fields.every((field, index) => normalizeApplicationIdentity(item[field]) === values[index]);
    return applications.find(matches);
  }

  function updateApplicationDuplicateNotice() {
    const notice = $('#applicationDuplicateNotice');
    if (!notice) return;
    notice.hidden = true;
    notice.textContent = '';
    if (viewingClientDetails || editingId) return;
    const candidate = { id: editingId || '', clientName: $('#clientName').value,
      contact: $('#contactName').value, email: $('#hiredEmail').value, role: $('#clientRole').value };
    const duplicate = findDuplicateApplication(candidate);
    if (candidate.id && !duplicate) return;
    const existing = duplicate;
    if (!existing) return;
    const status = STATUS_LABELS[existing.status] || existing.status || 'Not specified';
    notice.dataset.kind = 'duplicate';
    notice.textContent = `${candidate.id ? 'These details match another saved application' : 'Already saved'}: ${existing.clientName} — ${existing.contact} — ${existing.email} — ${existing.role} (${status}${existing.appliedDate ? `; applied ${formatDate(existing.appliedDate)}` : ''}). ${candidate.id ? 'Check the company name, contact person, email and role/service.' : 'Update the existing application instead of adding it again.'}`;
    notice.hidden = false;
  }

  async function saveClient(event) {
    const submitter = event.submitter;
    if (submitter?.value === 'cancel') {
      if (!editingId) localStorage.removeItem(`${APPLICATION_DRAFT_KEY}:${currentUser?.id || 'anonymous'}`);
      return;
    }
    event.preventDefault();
    const savingInDrawer = isActiveClientDrawerView('edit');
    const form = $('#clientForm');
    if (!form.reportValidity()) return;
    if ($('#automaticFollowUp').checked && !$('#followUpDate').value) {
      $('#followUpDate').value = addDays(today(), 7);
    }
    const platformChoice = $('#clientPlatform').value;
    const existing = editingId ? data.applications.find(item => item.id === editingId) : null;
    const existingIndex = editingId ? data.applications.findIndex(item => item.id === editingId) : -1;
    const previousApplication = existing ? JSON.parse(JSON.stringify(existing)) : null;
    const duplicate = findDuplicateApplication({
      id: editingId || '', clientName: $('#clientName').value,
      contact: $('#contactName').value, email: $('#hiredEmail').value, role: $('#clientRole').value
    });
    if (duplicate) {
      showActionResult({
        title: 'Application already exists',
        message: `${duplicate.clientName} — ${duplicate.contact} — ${duplicate.email} — ${duplicate.role} is already saved (status: ${STATUS_LABELS[duplicate.status] || duplicate.status || 'Not specified'}${duplicate.appliedDate ? `; applied ${formatDate(duplicate.appliedDate)}` : ''}). Open the existing application to update it.`,
        status: 'error'
      });
      return;
    }
    const isActiveClient = $('#clientStatus').value === 'Active client';
    const contractEndDate = $('#contractEndDate').value;
    if (isActiveClient && contractEndDate && dateKey(contractEndDate) < today()
      && !(await appConfirm(`This contract end date has already passed (${formatDate(contractEndDate)}). Saving it will mark ${$('#clientName').value.trim() || 'this client'} as expired. Do you want to continue?`, { title: 'Contract date has passed', confirmLabel: 'Save anyway' }))) return;
    if (isActiveClient && (!existing || existing.status !== 'Active client')) beginActivationRollback(editingId || uid(), existing);
    const activeClientEmailPending = isActiveClient && (!existing || existing.status !== 'Active client' || Boolean(existing.activePendingEmail));
    const editingSocialAccounts = !$('#clientSocialLinksField').hidden;
    const applicationSocial = $('#hiredSocial').value.trim();
    const socialLinks = editingSocialAccounts
      ? readClientSocialLinks()
      : (applicationSocial ? [{ platform: inferClientSocialPlatform(applicationSocial), url: applicationSocial }] : []);
    const application = {
      id: editingId || (pendingActivation?.applicationId || uid()),
      clientName: $('#clientName').value.trim(),
      contact: $('#contactName').value.trim(),
      role: $('#clientRole').value.trim(),
      email: $('#hiredEmail').value.trim(),
      phone: $('#hiredPhone').value.trim(),
      website: $('#hiredWebsite').value.trim(),
      socialMedia: editingSocialAccounts ? (socialLinks[0]?.url || '') : applicationSocial,
      socialLinks,
      location: $('#hiredLocation').value.trim(),
      platform: platformChoice === 'Other' ? $('#customPlatform').value.trim() : platformChoice,
      employmentType: $('#employmentType').value,
      salaryType: $('#salaryType').value,
      salaryCurrency: $('#salaryCurrency').value || 'USD',
      salaryAmount: $('#salaryAmount').value === '' ? '' : Number($('#salaryAmount').value),
      hoursPerWeek: $('#salaryHoursPerWeek').value === '' ? '' : Number($('#salaryHoursPerWeek').value),
      status: $('#clientStatus').value,
      manualStatusChangedAt: manualApplicationStatusTimestamp(existing, $('#clientStatus').value),
      nextStep: $('#clientStatus').value === 'To Proceed' ? $('#nextStep').value.trim() : '',
      // Moving an application into Active Clients always requires a newly
      // confirmed contract for the activation email. Existing client files are
      // preserved, but they cannot accidentally skip this one-time step.
      activePendingDocument: isActiveClient && (!existing || existing.status !== 'Active client'),
      activePendingEmail: activeClientEmailPending,
      appliedDate: $('#appliedDate').value,
      interviewDate: $('#interviewDate').value,
      interviewLink: $('#interviewLink').value.trim(),
      interviewAlertDate: editingId && data.applications.find(item => item.id === editingId)?.interviewDate === $('#interviewDate').value ? (data.applications.find(item => item.id === editingId)?.interviewAlertDate || '') : '',
      createdAt: editingId ? (data.applications.find(item => item.id === editingId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
      activeAt: editingId ? (data.applications.find(item => item.id === editingId)?.activeAt || ($('#clientStatus').value === 'Active client' ? new Date().toISOString() : '')) : ($('#clientStatus').value === 'Active client' ? new Date().toISOString() : ''),
      followUpDate: $('#followUpDate').value,
      automaticFollowUp: $('#automaticFollowUp').checked,
      followUpProcessedAt: editingId && data.applications.find(item => item.id === editingId)?.followUpDate === $('#followUpDate').value ? (data.applications.find(item => item.id === editingId)?.followUpProcessedAt || '') : '',
      followUpSentAt: editingId && data.applications.find(item => item.id === editingId)?.followUpDate === $('#followUpDate').value ? (data.applications.find(item => item.id === editingId)?.followUpSentAt || '') : '',
      notes: $('#clientNotes').value.trim(),
      emailClosure: existing?.emailClosure,
      contractStatus: editingId ? (data.applications.find(item => item.id === editingId)?.contractStatus || 'Active') : 'Active',
      contractEndDate: isActiveClient ? contractEndDate : '',
      updatedAt: new Date().toISOString()
    };
    if (editingId) {
      // Document metadata lives in Supabase and is managed from the Active Clients page — carry the references forward.
      if (existing) {
        application.documents = existing.documents;
        application.profileImage = existing.profileImage;
      }
      if (existingIndex >= 0) data.applications[existingIndex] = application;
    } else {
      data.applications.push(application);
    }
    if (submitter) setButtonLoading(submitter, true);
    const saved = await persist();
    if (submitter) setButtonLoading(submitter, false);
    if (!saved) {
      if (previousApplication && existingIndex >= 0) data.applications[existingIndex] = previousApplication;
      else data.applications = data.applications.filter(item => item.id !== application.id);
      renderAll();
      return;
    }
    if (!editingId) localStorage.removeItem(`${APPLICATION_DRAFT_KEY}:${currentUser?.id || 'anonymous'}`);
    if ($('#clientModal').open) $('#clientModal').close();
    if (savingInDrawer) closeActiveClientActionsDrawer(true);
    renderAll();
    if (application.status === 'Active client' && application.activePendingDocument) {
      pendingActiveClientId = application.id;
      openClientDocumentPicker(application);
      toast('Next step: select or upload a client document');
    } else if (application.status === 'Active client' && application.activePendingEmail) {
      if (pendingActivation) pendingActivation.stage = 'email';
      openClientEmailComposer(application);
      toast('Next step: send the activation email');
    } else if (application.status === 'Active client') {
      showView('hired');
      renderHiredDetail(application);
    } else {
      showActionResult({ title: editingId ? 'Application updated' : 'Application added', message: editingId ? 'Your application changes were saved.' : 'The application was added to your workspace.' });
    }
    processDueInterviews();
    await processDueFollowUps();
  }

  async function deleteClient(id, fromActive = false) {
    const item = data.applications.find(application => application.id === id);
    if (!item) return;
    if (!(await appConfirm(`Delete ${item.clientName}? This removes the application, profile photo, and attached documents. This cannot be undone unless you've exported a backup.`, { title: 'Delete client application', confirmLabel: 'Delete', danger: true, showCloseButton: false }))) return;
    data.applications = data.applications.filter(application => application.id !== id);
    persist();
    (item.documents || []).forEach(doc => { deleteDocumentBlob(doc.storagePath || doc.id).catch(() => {}); });
    if (item.profileImage?.storagePath) {
      deleteDocumentBlob(item.profileImage.storagePath).catch(error => console.error('Could not remove the deleted client profile photo:', error));
    }
    $('#clientModal')?.close();
    if (isActiveClientDrawerOpen()) closeActiveClientActionsDrawer(true);
    editingId = null;
    if (fromActive) closeHiredDetail(false);
    renderAll();
    showActionResult({ title: 'Client deleted', message: 'The client, profile photo, and attached documents were removed.' });
  }

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

  function emailExplicitlyNamesDifferentRole(item, subjectText, bodyText) {
    const source = `${subjectText} ${bodyText}`;
    const rolePhrases = [];
    const roleMentionPattern = /\bfor (?:the |a |an )?(.{2,120}?) (?:role|position|job)\b/g;
    for (const match of source.matchAll(roleMentionPattern)) {
      const phrase = match[1].trim();
      const words = phrase.split(' ');
      if (words.some(word => ['application', 'job', 'position', 'role'].includes(word))) continue;
      if (words.length < 2 && (phrase.length < 10 || GENERIC_DISAMBIGUATION_ROLE_WORDS.has(phrase))) continue;
      rolePhrases.push(phrase);
    }
    if (!rolePhrases.length) return false;
    return !rolePhrases.some(phrase => (
      item.roleIsMatchable && containsNormalizedPhrase(phrase, item.roleNorm)
    ) || (
      item.coreRoleIsMatchable && containsNormalizedPhrase(phrase, item.coreRoleNorm)
    ));
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
    const scoredCandidates = [];
    let highestEvidenceScore = -Infinity;
    for (let index = 0; index < indexed.length; index++) {
      const item = indexed[index];
      const roleScore = roleScores[index];
      const linkMatch = item.jobLinkTokens.some(token => bodyLinkTokenSet.has(token));
      const contactMatch = item.contactNorm.length >= 3 && emailWords.has(item.contactLastWord)
        && containsNormalizedPhrase(bodyText, item.contactNorm);
      const appliedTime = item.appliedTime;
      const days = Number.isFinite(emailTime) && Number.isFinite(appliedTime) && appliedTime <= emailTime
        ? Math.floor((emailTime - appliedTime) / 86400000)
        : null;
      const evidenceScore = roleScore + (linkMatch ? 100 : 0) + (contactMatch ? 15 : 0);
      highestEvidenceScore = Math.max(highestEvidenceScore, evidenceScore);
      scoredCandidates.push({ item, evidenceScore, days, hasRoleOrLinkEvidence: roleScore > 0 || linkMatch });
    }
    const evidenceTies = scoredCandidates.filter(candidate => candidate.evidenceScore === highestEvidenceScore);
    const priorDateTies = evidenceTies.filter(candidate => candidate.days !== null);
    const closestPriorDate = priorDateTies.length
      ? Math.min(...priorDateTies.map(candidate => candidate.days))
      : Infinity;
    const topCandidates = evidenceTies.map(candidate => ({
      ...candidate,
      timeScore: candidate.days === null ? 0 : Math.max(1, 10 - (candidate.days - closestPriorDate))
    }));
    const highestTimeScore = Math.max(...topCandidates.map(candidate => candidate.timeScore));
    const topMatches = topCandidates
      .filter(candidate => candidate.timeScore === highestTimeScore)
      .map(candidate => candidate.item.application);
    if (topMatches.length > 1 && !topCandidates.some(candidate =>
      candidate.timeScore === highestTimeScore && candidate.hasRoleOrLinkEvidence
    )) {
      ambiguousEmailMatches.set(emailItem, topMatches);
    }
    return topMatches;
  }

  const PLATFORM_SENDER_EMAIL_SET = new Set(Object.values(PLATFORM_SENDER_EMAILS).map(email => email.toLowerCase()));
  const GENERIC_APPLICATION_ROLE_WORDS = new Set([
    'application', 'assistant', 'candidate', 'employee', 'job', 'manager', 'opportunity',
    'professional', 'role', 'service', 'specialist', 'staff', 'support', 'team', 'work'
  ]);

  function normalizeMatchText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^\w]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function platformKeyForName(platform) {
    const name = String(platform || '').trim().toLowerCase();
    return Object.keys(PLATFORM_SENDER_EMAILS)
      .find(key => key === name || PLATFORM_DISPLAY_NAMES[key].toLowerCase() === name) || '';
  }

  function isSpecificApplicationRole(role) {
    return role.length >= 3 && role.split(' ').some(word => !GENERIC_APPLICATION_ROLE_WORDS.has(word));
  }

  function applicationLinkTokens(value) {
    const links = String(value || '').match(/(?:https?:\/\/|www\.)[^\s<>"']+|\/(?:jobseekers\/info|jobs?|job-postings?|listings?|vacancies)\/[^\s<>"']+/gi) || [];
    const tokens = new Set();
    for (const link of links) {
      const normalized = link.replace(/[),.;!?]+$/g, '').toLowerCase()
        .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
      if (normalized) tokens.add(`url:${normalized}`);
      for (const match of normalized.matchAll(/(?:jobseekers\/info|jobs?|job-postings?|listings?|vacancies)\/([a-z0-9_-]+)/g)) {
        tokens.add(`id:${match[1]}`);
      }
    }
    for (const id of onlineJobsJobIds(value)) tokens.add(`onlinejobs-job:${id}`);
    return [...tokens];
  }

  function onlineJobsJobIds(value) {
    const ids = new Set();
    const pattern = /(?:https?:\/\/(?:www\.)?|www\.)onlinejobs\.ph\/jobseekers\/job\/([^\s<>"'?#/]+)/gi;
    for (const match of String(value || '').matchAll(pattern)) {
      const slug = match[1].replace(/[),.;!]+$/, '');
      const id = slug.match(/(?:^|-)(\d+)$/)?.[1];
      if (id) ids.add(id);
    }
    return [...ids];
  }

  function platformApplicationMatchScore(item, senderPlatformKey, subjectText, bodyText, bodyLinkTokens, receivedDate) {
    if (item.platformKey && item.platformKey !== senderPlatformKey) return null;
    const clientMentioned = item.matchClientName.length >= 3
      && (containsWholeWord(subjectText, item.matchClientName) || containsWholeWord(bodyText, item.matchClientName));
    const roleInSubject = item.roleIsSpecific && containsWholeWord(subjectText, item.matchRole);
    const roleInBody = item.roleIsSpecific && containsWholeWord(bodyText, item.matchRole);
    const contactInBody = item.matchContact.length >= 3 && containsWholeWord(bodyText, item.matchContact);
    const linkMentioned = item.jobLinkTokens.some(token => bodyLinkTokens.includes(token));
    const ambiguousRoleTie = roleInSubject && item.roleGroupCount > 1;
    const replySubject = subjectText.replace(/^(?:(?:re|fw|fwd)\s+)+/, '');
    const exactApplicationSubject = [`application for ${item.matchRole}`, `application for the ${item.matchRole}`].includes(replySubject);
    const savedJobIds = item.jobLinkTokens.filter(token => token.startsWith('onlinejobs-job:'));
    const emailJobIds = bodyLinkTokens.filter(token => token.startsWith('onlinejobs-job:'));
    const conflictingJob = savedJobIds.length && emailJobIds.length && !savedJobIds.some(id => emailJobIds.includes(id));
    const uniqueRoleReply = senderPlatformKey === 'onlinejobs.ph' && item.platformKey === senderPlatformKey
      && item.roleIsSpecific && item.roleGroupCount === 1 && exactApplicationSubject && !conflictingJob
      && Number.isFinite(item.appliedTime) && Date.parse(receivedDate) >= item.appliedTime;
    if (!clientMentioned && !linkMentioned && !(roleInSubject && contactInBody) && !ambiguousRoleTie && !uniqueRoleReply) return null;
    return (clientMentioned ? 5 : 0) + (linkMentioned ? 5 : 0)
      + (roleInSubject ? 3 : 0) + (roleInBody ? 1 : 0) + (contactInBody ? 1 : 0)
      + (item.platformKey === senderPlatformKey ? 1 : -1);
  }

  // --- Active client documents ---
  // Document binaries are stored in the private Supabase Storage bucket; only metadata and
  // the storage path are kept in the user's app_state row. Nothing is stored in IndexedDB.
  const PDFJS_MODULE_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.min.mjs';
  const PDFJS_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.min.mjs';
  const MAX_DOCUMENT_SIZE_BYTES = 25 * 1024 * 1024;
  const DOCUMENT_CONTENT_TYPES = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };
  let pdfjsModulePromise = null;
  let contractEmailUploadClientId = '';
  let contractEmailUploadFile = null;

  function loadPdfJs() {
    if (!pdfjsModulePromise) {
      pdfjsModulePromise = import(PDFJS_MODULE_URL).then(pdfjs => {
        pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        return pdfjs;
      }).catch(error => {
        pdfjsModulePromise = null;
        throw error;
      });
    }
    return pdfjsModulePromise;
  }

  function documentContentType(file) {
    if (Object.values(DOCUMENT_CONTENT_TYPES).includes(file.type)) return file.type;
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    return DOCUMENT_CONTENT_TYPES[extension] || 'application/octet-stream';
  }

  async function saveDocumentBlob(id, file) {
    const client = requireSupabase();
    if (!currentUser) throw new Error('Not signed in');
    if (file.size > MAX_DOCUMENT_SIZE_BYTES) throw new Error('Documents must be 25 MB or smaller.');
    const path = `${currentUser.id}/${id}`;
    const { error } = await client.storage.from(SUPABASE_BUCKET).upload(path, file, {
      upsert: false,
      contentType: documentContentType(file)
    });
    if (error) throw error;
    return path;
  }

  async function getDocumentBlob(idOrPath) {
    const client = requireSupabase();
    if (!currentUser) throw new Error('Not signed in');
    const path = String(idOrPath).includes('/') ? String(idOrPath) : `${currentUser.id}/${idOrPath}`;
    const { data: blob, error } = await client.storage.from(SUPABASE_BUCKET).download(path);
    if (error) throw error;
    return blob;
  }

  async function deleteDocumentBlob(idOrPath) {
    const client = requireSupabase();
    if (!currentUser) return;
    const path = String(idOrPath).includes('/') ? String(idOrPath) : `${currentUser.id}/${idOrPath}`;
    const { error } = await client.storage.from(SUPABASE_BUCKET).remove([path]);
    if (error) throw error;
  }

  function personalDocumentPath(id) {
    return `${currentUser.id}/personal/${id}`;
  }

  function renderPersonalDocuments() {
    const target = $('#personalDocumentList');
    if (!target) return;
    const documents = data.personalDocuments || [];
    $('#uploadDocumentButton').hidden = documents.length === 0;
    target.innerHTML = documents.length ? documents.map(document => {
      const isPdf = /\.pdf$/i.test(document.name) || document.type === 'application/pdf';
      const fileType = isPdf ? 'PDF' : 'Word document';
      return `
        <article class="document-preview-card personal-document-card" data-personal-open="${escapeHtml(document.id)}" tabindex="0" role="button" aria-label="Preview ${escapeHtml(document.name)}">
          <div class="document-preview-head">
            <div class="document-preview-title">
              <span class="doc-type-icon">${fileType === 'PDF' ? 'PDF' : 'DOC'}</span>
              <div><p class="eyebrow">DOCUMENT PREVIEW</p><h3>${escapeHtml(document.name)}</h3><p>${fileType} · ${formatFileSize(document.size)} · Added ${emailDate(document.addedAt)}</p></div>
              <button class="personal-document-delete" type="button" data-personal-delete="${escapeHtml(document.id)}" aria-label="Delete ${escapeHtml(document.name)}" title="Delete document">×</button>
            </div>
          </div>
          <div class="personal-document-thumbnail" aria-hidden="true"><span class="personal-document-file-icon">${fileType === 'PDF' ? 'PDF' : 'DOC'}</span></div>
        </article>`;
    }).join('') : '<div class="personal-document-empty"><span class="personal-document-empty-icon" aria-hidden="true"><i class="fa-solid fa-cloud-arrow-up"></i></span><h3>No personal documents yet</h3><p>Upload a document here when it is for your own records.</p><label class="button button-primary personal-document-empty-upload import-label" for="personalDocumentInput"><i class="fa-solid fa-arrow-up-from-bracket" aria-hidden="true"></i> Upload personal document</label></div>';
  }

  function renderScripts() {
    const target = $('#scriptList');
    if (!target) return;
    const scripts = [...(data.scripts || [])].sort((first, second) => new Date(second.updatedAt || second.createdAt || 0) - new Date(first.updatedAt || first.createdAt || 0));
    target.innerHTML = scripts.length ? scripts.map(script => `
      <article class="script-item" data-script-open="${escapeHtml(script.id)}" tabindex="0" aria-label="Open script: ${escapeHtml(script.title)}">
        <div class="script-item-head"><div><h3>${escapeHtml(script.title)}</h3><small>Updated ${emailDate(script.updatedAt || script.createdAt)}</small></div><div class="script-item-actions"><button class="button button-secondary" type="button" data-script-edit="${escapeHtml(script.id)}">Edit</button><button class="icon-button" type="button" data-script-delete="${escapeHtml(script.id)}" aria-label="Delete ${escapeHtml(script.title)}" title="Delete script">×</button></div></div>
      </article>`).join('') : '<div class="application-empty"><h3>No scripts yet</h3><p>Add a reusable script for outreach, follow-ups, or client communication.</p></div>';
  }

  function openScriptDetails(id) {
    const script = (data.scripts || []).find(item => item.id === id);
    if (!script) return;
    $('#scriptDetailTitle').textContent = script.title;
    $('#scriptDetailUpdated').textContent = `Updated ${emailDate(script.updatedAt || script.createdAt)}`;
    $('#scriptDetailContent').textContent = script.content;
    $('#scriptDetailEdit').dataset.scriptDetailEdit = script.id;
    $('#scriptDetailDialog').showModal();
  }

  function resetScriptForm() {
    const form = $('#scriptForm');
    if (!form) return;
    form.reset();
    $('#scriptId').value = '';
    const dialog = $('#scriptDialog');
    if (dialog && dialog.open) dialog.close();
    form.classList.add('hidden');
  }

  function openScriptForm(id = '') {
    const form = $('#scriptForm');
    const dialog = $('#scriptDialog');
    if (!form || !dialog) return;
    const script = (data.scripts || []).find(item => item.id === id);
    form.reset();
    $('#scriptId').value = script?.id || '';
    $('#scriptTitle').value = script?.title || '';
    $('#scriptContent').value = script?.content || '';
    form.classList.remove('hidden');
    dialog.showModal();
    $('#scriptTitle').focus();
  }

  function saveScript(event) {
    event.preventDefault();
    const form = $('#scriptForm');
    if (!form.reportValidity()) return;
    const id = $('#scriptId').value || uid();
    const now = new Date().toISOString();
    const existingIndex = (data.scripts || []).findIndex(item => item.id === id);
    const script = { id, title: $('#scriptTitle').value.trim(), content: $('#scriptContent').value.trim(), createdAt: existingIndex >= 0 ? data.scripts[existingIndex].createdAt : now, updatedAt: now };
    data.scripts = data.scripts || [];
    if (existingIndex >= 0) data.scripts[existingIndex] = script;
    else data.scripts.unshift(script);
    persist();
    resetScriptForm();
    renderScripts();
    showActionResult({ title: existingIndex >= 0 ? 'Script updated' : 'Script saved', message: existingIndex >= 0 ? 'Your script changes were saved.' : 'The script was added to your tools.' });
  }

  async function deleteScript(id) {
    const script = (data.scripts || []).find(item => item.id === id);
    if (!script || !(await appConfirm(`Delete ${script.title}?`, { title: 'Delete script', confirmLabel: 'Delete', danger: true }))) return;
    data.scripts = data.scripts.filter(item => item.id !== id);
    persist();
    renderScripts();
    showActionResult({ title: 'Script deleted', message: 'The script was removed from your tools.' });
  }

  function renderWorkLinks() {
    const target = $('#workLinkList');
    if (!target) return;
    const links = [...(data.workLinks || [])].sort((first, second) => new Date(second.updatedAt || second.createdAt || 0) - new Date(first.updatedAt || first.createdAt || 0));
    target.innerHTML = links.length ? links.map(link => `
      <article class="work-link-item">
        <div class="work-link-copy"><strong>${escapeHtml(link.name || link.url)}</strong><a href="${escapeHtml(normalizeUrl(link.url))}" target="_blank" rel="noopener">${escapeHtml(link.url)}</a></div>
        <div class="work-link-actions"><button class="button button-secondary" type="button" data-work-link-edit="${escapeHtml(link.id)}">Edit</button><button class="icon-button" type="button" data-work-link-delete="${escapeHtml(link.id)}" aria-label="Delete ${escapeHtml(link.name || link.url)}" title="Delete softcopy link">×</button></div>
      </article>`).join('') : '<div class="small-empty"><p class="doc-empty">No softcopy links yet. Add a shared document or tool link here.</p></div>';
  }

  function resetWorkLinkForm() {
    const form = $('#workLinkForm');
    if (!form) return;
    $('#workLinkName').value = '';
    $('#workLinkUrl').value = '';
    form.dataset.editingId = '';
    const dialog = $('#workLinkDialog');
    if (dialog && dialog.open) dialog.close();
    form.classList.add('hidden');
  }

  function openWorkLinkForm(id = '') {
    const form = $('#workLinkForm');
    const dialog = $('#workLinkDialog');
    if (!form || !dialog) return;
    const link = (data.workLinks || []).find(item => item.id === id);
    $('#workLinkName').value = '';
    $('#workLinkUrl').value = '';
    form.dataset.editingId = link?.id || '';
    $('#workLinkName').value = link?.name || '';
    $('#workLinkUrl').value = link?.url || '';
    form.classList.remove('hidden');
    dialog.showModal();
    $('#workLinkName').focus();
  }

  function saveWorkLink() {
    const name = $('#workLinkName').value.trim();
    const url = $('#workLinkUrl').value.trim();
    if (!url) { $('#workLinkUrl').focus(); return; }
    try { new URL(url); } catch { $('#workLinkUrl').focus(); toast('Enter a valid link URL'); return; }
    const id = $('#workLinkForm').dataset.editingId || uid();
    const now = new Date().toISOString();
    data.workLinks = data.workLinks || [];
    const existingIndex = data.workLinks.findIndex(item => item.id === id);
    const link = { id, name, url, createdAt: existingIndex >= 0 ? data.workLinks[existingIndex].createdAt : now, updatedAt: now };
    if (existingIndex >= 0) data.workLinks[existingIndex] = link;
    else data.workLinks.unshift(link);
    persist();
    resetWorkLinkForm();
    renderWorkLinks();
    showActionResult({ title: existingIndex >= 0 ? 'Link updated' : 'Link saved', message: existingIndex >= 0 ? 'Your link changes were saved.' : 'The link was added to your tools.' });
  }

  async function deleteWorkLink(id) {
    const link = (data.workLinks || []).find(item => item.id === id);
    if (!link || !(await appConfirm(`Delete ${link.name || link.url}?`, { title: 'Delete softcopy link', confirmLabel: 'Delete', danger: true }))) return;
    data.workLinks = data.workLinks.filter(item => item.id !== id);
    persist();
    renderWorkLinks();
    showActionResult({ title: 'Link deleted', message: 'The link was removed from your tools.' });
  }

  function renderInvoiceList() {
    const target = $('#invoiceList');
    if (!target) return;
    const invoices = [...(data.invoices || [])].sort((first, second) => new Date(second.sentAt) - new Date(first.sentAt));
    target.innerHTML = invoices.length ? invoices.map(invoice => {
      const client = data.applications.find(application => application.id === invoice.clientId);
      const dueDate = parseInvoiceDate(invoice.dueDate);
      return `<article class="invoice-email-row">
        <span class="invoice-email-icon">PDF</span>
        <div class="invoice-email-main"><strong>${escapeHtml(invoice.invoiceNumber || '')}</strong><span>${escapeHtml(client?.clientName || 'Client unavailable')}</span></div>
        <div class="invoice-email-subject"><strong>${escapeHtml(invoice.fileName || 'Invoice')}</strong><span>${escapeHtml(invoice.service || 'Invoice')}</span></div>
        <div class="invoice-email-meta"><strong>${emailDate(invoice.sentAt)}</strong><span>Sent invoice${dueDate ? ` · Due ${escapeHtml(formatDate(dueDate))}` : ''}</span></div>
      </article>`;
    }).join('') : '<div class="application-empty"><h3>No invoices sent yet</h3><p>Invoices sent from an active client will appear here.</p></div>';
  }

  async function uploadPersonalDocument(file) {
    if (!file) return;
    if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
      toast('Documents must be 25 MB or smaller.');
      return null;
    }
    if (!/\.(pdf|doc|docx)$/i.test(file.name)) {
      toast('Please choose a PDF or Word document.');
      return;
    }
    try {
      const documentId = uid();
      const storagePath = personalDocumentPath(documentId);
      const client = requireSupabase();
      const { error } = await client.storage.from(SUPABASE_BUCKET).upload(storagePath, file, {
        upsert: false,
        contentType: documentContentType(file)
      });
      if (error) throw error;
      data.personalDocuments = data.personalDocuments || [];
      const record = { id: documentId, storagePath, name: file.name, type: file.type, size: file.size, addedAt: new Date().toISOString() };
      data.personalDocuments.unshift(record);
      persist();
      renderAll();
      showActionResult({ title: 'Document uploaded', message: 'Your personal document was saved to Supabase.' });
      return record;
    } catch (error) {
      console.error(error);
      showActionResult({ title: 'Document upload failed', message: `Could not upload ${file.name}. Check your connection and try again.`, status: 'error' });
      return null;
    }
  }

  function renderClientDocumentPicker() {
    const target = $('#clientDocumentPickerList');
    if (!target) return;
    const documents = data.personalDocuments || [];
    target.innerHTML = documents.length ? documents.map(document => `
      <button class="client-document-picker-item" type="button" data-client-document-attach="${escapeHtml(document.id)}">
        <span><strong>${escapeHtml(document.name)}</strong><small>${formatFileSize(document.size)} · Added ${emailDate(document.addedAt)}</small></span><span>Use file</span>
      </button>`).join('') : '<p class="doc-empty">No saved documents yet. Upload a new document below.</p>';
  }

  function extractInvoiceField(content, labelPattern, maxLength, dateField = false) {
    if (!content) return '';
    const labels = '(?:Invoice\\s*(?:Number|No\\.?|#)|Date\\s+of\\s+Issue|Billing\\s+Period|Due\\s+Date)';
    const matches = content.matchAll(new RegExp(`${labelPattern}\\s*[:#-]?\\s*(.*?)(?=\\s+${labels}\\s*[:#-]?|$)`, 'gi'));
    for (const match of matches) {
      if (/[\[\]]/.test(match[1] || '')) continue;
      const candidate = (match[1] || '').replace(/\s+/g, ' ').trim();
      if (!candidate || /[\[\]]/.test(candidate)) continue;
      if (dateField) {
        const dates = candidate.match(/\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4})\b/gi) || [];
        const validDate = dates.find(value => parseInvoiceDate(value));
        if (validDate) return validDate.slice(0, maxLength);
        continue;
      }
      return candidate.slice(0, maxLength);
    }
    return '';
  }

  function extractInvoiceDetails(content) {
    return {
      invoiceNumber: extractInvoiceField(content, '(?:Invoice\\s*(?:Number|No\\.?|#))', 40),
      issueDate: extractInvoiceField(content, 'Date\\s+of\\s+Issue', 40, true),
      billingPeriod: extractInvoiceField(content, 'Billing\\s+Period', 60),
      dueDate: extractInvoiceField(content, 'Due\\s+Date', 40, true)
    };
  }

  function invoiceAlreadySent(clientId, invoiceNumber) {
    const normalized = String(invoiceNumber || '').trim().toLowerCase();
    return Boolean(normalized && (data.invoices || []).some(invoice => invoice.clientId === clientId && String(invoice.invoiceNumber || '').trim().toLowerCase() === normalized));
  }

  function showInvoiceDuplicateAlert(invoiceNumber) {
    const message = `Invoice ${invoiceNumber} was already sent to this client. Choose a different invoice number.`;
    $('#invoiceDuplicateAlertMessage').textContent = message;
    $('#invoiceDuplicateAlertModal').showModal();
  }

  async function extractInvoiceText(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    if (extension === 'pdf') {
      const pdfjs = await loadPdfJs();
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      const pages = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const text = await page.getTextContent();
        pages.push(text.items.map(item => item.str).join(' '));
      }
      return pages.join('\n');
    }
    if (extension === 'docx' && window.mammoth) {
      const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      return result.value || '';
    }
    return '';
  }

  function openInvoiceDocumentPicker(application) {
    if (!application?.email) { toast('Add a client email before sending an invoice.'); return; }
    pendingInvoiceClientId = application.id;
    pendingInvoiceFile = null;
    pendingInvoiceDetails = {};
    $('#invoiceNumber').value = '';
    $('#invoiceIssueDate').value = '';
    $('#invoiceBillingPeriod').value = '';
    $('#invoiceDueDate').value = '';
    $('#invoiceService').value = application.role || '';
    $('#invoiceStartDate').value = '';
    $('#invoiceEndDate').value = '';
    $('#invoiceDocumentPickerStatus').textContent = 'Choose an invoice file. Its invoice details will be read from the document.';
    $('#useInvoiceFileButton').disabled = true;
    $('#invoiceDocumentPickerModal').showModal();
  }

  async function stageInvoiceFile(file) {
    if (!file) return;
    if (!/\.(pdf|doc|docx)$/i.test(file.name)) {
      $('#invoiceDocumentPickerStatus').textContent = 'Please choose a PDF or Word invoice.';
      return;
    }
    pendingInvoiceFile = file;
    $('#useInvoiceFileButton').disabled = true;
    $('#invoiceDocumentPickerStatus').textContent = 'Reading invoice content...';
    try {
      const content = await extractInvoiceText(file);
      if (pendingInvoiceFile !== file) return;
      pendingInvoiceDetails = extractInvoiceDetails(content);
      $('#invoiceNumber').value = pendingInvoiceDetails.invoiceNumber;
      $('#invoiceIssueDate').value = pendingInvoiceDetails.issueDate;
      $('#invoiceBillingPeriod').value = pendingInvoiceDetails.billingPeriod;
      $('#invoiceDueDate').value = pendingInvoiceDetails.dueDate;
      if (invoiceAlreadySent(pendingInvoiceClientId, pendingInvoiceDetails.invoiceNumber)) {
        showInvoiceDuplicateAlert(pendingInvoiceDetails.invoiceNumber);
        $('#invoiceDocumentPickerStatus').textContent = 'Duplicate invoice number detected. Choose a different invoice number.';
      } else {
        $('#invoiceDocumentPickerStatus').textContent = content ? 'Invoice details loaded from the file. Empty fields were left blank.' : 'The file text could not be read. Invoice detail fields were left blank.';
      }
    } catch (error) {
      console.error('Could not read invoice content:', error);
      pendingInvoiceDetails = {};
      $('#invoiceDocumentPickerStatus').textContent = 'Could not read the file content. Invoice detail fields were left blank.';
    }
    $('#useInvoiceFileButton').disabled = false;
  }

  function continueInvoicePicker() {
    const application = data.applications.find(item => item.id === pendingInvoiceClientId);
    if (!application || !pendingInvoiceFile) return;
    const invoiceNumber = $('#invoiceNumber').value.trim();
    const service = $('#invoiceService').value.trim();
    const issueDate = $('#invoiceIssueDate').value.trim();
    const billingPeriod = $('#invoiceBillingPeriod').value.trim();
    const dueDate = $('#invoiceDueDate').value.trim();
    const startDate = $('#invoiceStartDate').value;
    const endDate = $('#invoiceEndDate').value;
    if (!invoiceNumber || !issueDate || !billingPeriod || !dueDate || !service || !startDate || !endDate) {
      $('#invoiceDocumentPickerStatus').textContent = 'Complete every invoice field before continuing.';
      return;
    }
    if (invoiceAlreadySent(application.id, invoiceNumber)) {
      showInvoiceDuplicateAlert(invoiceNumber);
      $('#invoiceDocumentPickerStatus').textContent = 'Duplicate invoice number detected. Choose a different invoice number.';
      return;
    }
    const file = pendingInvoiceFile;
    $('#invoiceDocumentPickerModal').close();
    pendingInvoiceFile = null;
    pendingInvoiceClientId = null;
    openInvoiceComposer(application, file, {
      invoiceNumber,
      issueDate,
      billingPeriod,
      dueDate,
      service,
      startDate,
      endDate
    });
  }

  function openClientDocumentPicker(application) {
    pendingActiveClientId = application.id;
    $('#activationFileInfo').classList.add('hidden');
    $('#activationFileInfo').textContent = '';
    const uploadButton = $('#uploadActivationFileButton');
    const uploadInput = $('#clientPickerUploadInput');
    uploadButton.textContent = '+ Upload contract file';
    uploadButton.setAttribute('for', 'clientPickerUploadInput');
    uploadButton.removeAttribute('aria-disabled');
    uploadButton.classList.remove('is-uploading');
    uploadInput.disabled = false;
    uploadInput.value = '';
    $('#continueActivationEmailButton').disabled = true;
    $('#clientDocumentPickerStatus').textContent = 'Upload the contract, review the file information, then click Next to open the email composer.';
    $('#clientDocumentPickerModal').showModal();
  }

  function beginActivationRollback(applicationId, previousApplication) {
    pendingActivation = {
      applicationId,
      previousApplication: previousApplication ? JSON.parse(JSON.stringify(previousApplication)) : null,
      previousIndex: previousApplication ? data.applications.findIndex(item => item.id === applicationId) : -1,
      storagePath: '',
      documentId: '',
      stage: 'document-selection',
      cancelled: false,
      uploading: false
    };
  }

  async function rollbackActivation() {
    const transaction = pendingActivation;
    if (!transaction) return;
    transaction.cancelled = true;
    pendingActivation = null;
    pendingActiveClientId = null;
    editingId = null;
    if (transaction.storagePath) {
      try { await deleteDocumentBlob(transaction.storagePath); } catch (error) { console.error(error); }
    }
    if (transaction.previousApplication) {
      const index = data.applications.findIndex(item => item.id === transaction.applicationId);
      if (index >= 0) data.applications[index] = transaction.previousApplication;
      else data.applications.splice(Math.max(0, transaction.previousIndex), 0, transaction.previousApplication);
    } else {
      data.applications = data.applications.filter(item => item.id !== transaction.applicationId);
    }
    persist();
    renderAll();
    showView('applications');
    showActionResult({ title: 'Activation cancelled', message: 'The application was restored and the staged document was removed.' });
  }

  function clearActivationRollback() {
    pendingActivation = null;
    pendingActiveClientId = null;
  }

  function continueActivationEmail() {
    const transaction = pendingActivation;
    const application = data.applications.find(item => item.id === pendingActiveClientId);
    const selectedDocument = application?.documents?.find(document => document.id === transaction?.documentId);
    if (!transaction || transaction.stage !== 'document-selection' || transaction.uploading || !selectedDocument) {
      $('#clientDocumentPickerStatus').textContent = 'Choose a contract file and wait for it to finish uploading before continuing.';
      return;
    }
    transaction.stage = 'email';
    $('#clientDocumentPickerModal').close();
    pendingActiveClientId = null;
    openClientEmailComposer(application);
  }

  async function uploadActivationDocument(file) {
    if (!file) return;
    if (!/\.(pdf|doc|docx)$/i.test(file.name)) {
      $('#clientDocumentPickerStatus').textContent = 'Please choose a PDF or Word document.';
      return;
    }
    const transaction = pendingActivation;
    if (!transaction || transaction.stage !== 'document-selection' || transaction.uploading) return;
    const applicationId = pendingActiveClientId;
    const application = data.applications.find(item => item.id === applicationId);
    if (!application || transaction.applicationId !== applicationId) return;
    const uploadButton = $('#uploadActivationFileButton');
    const uploadInput = $('#clientPickerUploadInput');
    transaction.uploading = true;
    uploadButton.textContent = 'Uploading contract…';
    uploadButton.removeAttribute('for');
    uploadButton.setAttribute('aria-disabled', 'true');
    uploadButton.classList.add('is-uploading');
    uploadInput.disabled = true;
    $('#continueActivationEmailButton').disabled = true;
    $('#clientDocumentPickerStatus').textContent = 'Uploading the contract file…';
    try {
      const documentId = uid();
      const storagePath = await saveDocumentBlob(documentId, file);
      // The picker can be cancelled while the browser is still uploading. Do not
      // leave an orphaned blob or re-apply a cancelled activation in that case.
      if (pendingActivation !== transaction || transaction.cancelled) {
        await deleteDocumentBlob(storagePath);
        return;
      }
      const currentApplication = data.applications.find(item => item.id === applicationId);
      if (!currentApplication) {
        await deleteDocumentBlob(storagePath);
        return;
      }
      currentApplication.documents = [...(currentApplication.documents || []), {
        id: documentId,
        storagePath,
        name: file.name,
        type: file.type,
        size: file.size,
        addedAt: new Date().toISOString()
      }];
      currentApplication.activePendingDocument = false;
      currentApplication.activePendingEmail = true;
      currentApplication.updatedAt = new Date().toISOString();
      transaction.storagePath = storagePath;
      transaction.documentId = documentId;
      transaction.uploading = false;
      persist();
      $('#activationFileInfo').textContent = `${file.name} · ${formatFileSize(file.size)} · Ready to email`;
      $('#activationFileInfo').classList.remove('hidden');
      uploadButton.textContent = file.name;
      uploadButton.classList.remove('is-uploading');
      $('#continueActivationEmailButton').disabled = false;
      $('#clientDocumentPickerStatus').textContent = 'File attached. Click Next to review the activation email.';
      renderAll();
    } catch (error) {
      console.error(error);
      if (pendingActivation === transaction && !transaction.cancelled) {
        transaction.uploading = false;
        uploadButton.textContent = '+ Upload contract file';
        uploadButton.setAttribute('for', 'clientPickerUploadInput');
        uploadButton.removeAttribute('aria-disabled');
        uploadButton.classList.remove('is-uploading');
        uploadInput.disabled = false;
      }
      $('#clientDocumentPickerStatus').textContent = 'Could not upload the contract file. Please try again.';
    }
  }

  async function attachPersonalDocumentToClient(documentId) {
    const application = data.applications.find(item => item.id === pendingActiveClientId);
    const fileRecord = (data.personalDocuments || []).find(item => item.id === documentId);
    const transaction = pendingActivation;
    if (!application || !fileRecord || !transaction || transaction.stage !== 'document-selection') return;
    try {
      const documentIdForClient = uid();
      const blob = await getDocumentBlob(fileRecord.storagePath);
      const storagePath = await saveDocumentBlob(documentIdForClient, blob);
      if (pendingActivation !== transaction || transaction.cancelled) {
        await deleteDocumentBlob(storagePath);
        return;
      }
      application.documents = [...(application.documents || []), { ...fileRecord, id: documentIdForClient, storagePath, addedAt: new Date().toISOString() }];
      transaction.storagePath = storagePath;
      transaction.documentId = documentIdForClient;
    } catch (error) {
      console.error(error);
      $('#clientDocumentPickerStatus').textContent = 'Could not copy that document to the client.';
      return;
    }
    application.activePendingDocument = false;
    application.activePendingEmail = true;
    application.updatedAt = new Date().toISOString();
    persist();
    transaction.stage = 'email';
    $('#clientDocumentPickerModal').close();
    pendingActiveClientId = null;
    renderAll();
    openClientEmailComposer(application);
    showActionResult({ title: 'Document attached', message: 'The contract was attached. Send the client email to finish activation.' });
  }

  function showDocumentViewer(fileRecord, blob) {
    const url = URL.createObjectURL(blob);
    const modal = $('#documentViewerModal');
    const frame = $('#documentViewerFrame');
    const title = $('#documentViewerTitle');
    const note = $('#documentViewerNote');
    const openButton = $('#documentViewerOpen');
    if (!modal || !frame) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    title.textContent = fileRecord.name || 'Document viewer';
    openButton.href = url;
    openButton.download = fileRecord.name || 'document';
    if (/\.pdf$/i.test(fileRecord.name || '') || blob.type === 'application/pdf') {
      frame.classList.remove('document-word-placeholder');
      frame.src = url;
      frame.style.display = 'block';
      note.textContent = 'PDF preview';
    } else {
      frame.src = 'about:blank';
      frame.style.display = 'block';
      frame.classList.add('document-word-placeholder');
      frame.srcdoc = `<div style="font-family:Arial,sans-serif;padding:40px;color:#333"><div style="font-size:42px">DOC</div><h2>${escapeHtml(fileRecord.name || 'Word document')}</h2><p>Word files are stored securely in your account. Use “Open / download” to view the original file.</p></div>`;
      note.textContent = 'Word document preview';
    }
    modal.showModal();
    modal.addEventListener('close', () => URL.revokeObjectURL(url), { once: true });
  }

  async function openPersonalDocument(documentId) {
    const fileRecord = (data.personalDocuments || []).find(item => item.id === documentId);
    if (!fileRecord) return;
    try {
      const blob = await getDocumentBlob(fileRecord.storagePath);
      showDocumentViewer(fileRecord, blob);
    } catch (error) {
      console.error(error);
      showActionResult({ title: 'Could not open document', message: 'The personal document could not be downloaded from Supabase.', status: 'error' });
    }
  }

  async function removePersonalDocument(documentId) {
    const fileRecord = (data.personalDocuments || []).find(item => item.id === documentId);
    if (!fileRecord || !(await appConfirm(`Delete ${fileRecord.name}?`, { title: 'Delete personal document', confirmLabel: 'Delete', danger: true }))) return;
    data.personalDocuments = data.personalDocuments.filter(item => item.id !== documentId);
    persist();
    try { await deleteDocumentBlob(fileRecord.storagePath); } catch (error) { console.error(error); }
    renderAll();
    showActionResult({ title: 'Document deleted', message: 'The personal document was removed from Supabase.' });
  }

  function clearPendingDocumentPreview() {
    if (pendingDocumentPreviewUrl) {
      URL.revokeObjectURL(pendingDocumentPreviewUrl);
      pendingDocumentPreviewUrl = null;
    }
    pendingDocumentFile = null;
  }

  function clearContractEmailUploadStage() {
    contractEmailUploadFile = null;
    contractEmailUploadClientId = '';
    $('#contractEmailFileInput').value = '';
    $('#chooseContractEmailFileButton').hidden = false;
    $('#contractEmailSelectedFile').hidden = true;
    $('#contractEmailFileName').textContent = '';
    $('#contractEmailUploadStatus').textContent = '';
    $('#continueContractEmailButton').disabled = true;
  }

  function openContractEmailUploadModal(clientId) {
    const application = data.applications.find(item => item.id === clientId);
    if (!application || isContractEnded(application)) return;
    if (!application.email?.trim()) {
      toast('Add a client email before sending a contract.');
      return;
    }
    clearContractEmailUploadStage();
    contractEmailUploadClientId = application.id;
    $('#contractEmailUploadClientName').textContent = application.clientName || 'Active client';
    $('#contractEmailUploadModal').showModal();
  }

  function renderContractEmailSelectedFile(file) {
    $('#contractEmailFileName').textContent = file.name;
    $('#contractEmailSelectedFile').hidden = false;
    $('#chooseContractEmailFileButton').hidden = true;
    $('#contractEmailUploadStatus').textContent = '';
    $('#continueContractEmailButton').disabled = false;
  }

  function removeContractEmailUploadFile() {
    contractEmailUploadFile = null;
    $('#contractEmailSelectedFile').hidden = true;
    $('#contractEmailFileName').textContent = '';
    $('#chooseContractEmailFileButton').hidden = false;
    $('#contractEmailUploadStatus').textContent = '';
    $('#continueContractEmailButton').disabled = true;
  }

  function stageContractEmailFile(file) {
    if (!file) return;
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const supportedTypes = {
      pdf: ['application/pdf', 'application/x-pdf'],
      doc: ['application/msword', 'application/octet-stream'],
      docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream'],
      xls: ['application/vnd.ms-excel', 'application/msexcel', 'application/xls', 'application/x-excel', 'application/octet-stream'],
      xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream']
    };
    const allowedMimes = supportedTypes[extension];
    const validType = allowedMimes && (!file.type || allowedMimes.includes(file.type.toLowerCase()));
    if (!validType) {
      $('#contractEmailUploadStatus').textContent = 'Please choose a PDF, Word, or Excel document.';
      return;
    }
    if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
      $('#contractEmailUploadStatus').textContent = 'Documents must be 25 MB or smaller.';
      return;
    }
    contractEmailUploadFile = file;
    renderContractEmailSelectedFile(file);
  }

  async function pickContractEmailFile() {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [{ description: 'PDF, Word, or Excel document', accept: {
            'application/pdf': ['.pdf'],
            'application/msword': ['.doc'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
            'application/vnd.ms-excel': ['.xls'],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
          }}]
        });
        stageContractEmailFile(await handle.getFile());
      } catch (error) {
        if (error?.name !== 'AbortError') {
          console.error('Could not open the contract file picker:', error);
          $('#contractEmailUploadStatus').textContent = 'Could not open the file picker. Check browser permissions and try again.';
        }
      }
      return;
    }
    $('#contractEmailFileInput').value = '';
    $('#contractEmailFileInput').click();
  }

  function continueContractEmailUpload() {
    const application = data.applications.find(item => item.id === contractEmailUploadClientId);
    const file = contractEmailUploadFile;
    if (!application || !file) return;
    if (isContractEnded(application)) {
      $('#contractEmailUploadModal').close();
      return;
    }
    const hasEmail = Boolean(application.email?.trim());
    clearContractEmailUploadStage();
    $('#contractEmailUploadModal').close();
    if (!hasEmail) {
      toast('Add a client email before sending a contract.');
      return;
    }
    openContractEmailComposer(application, file);
  }

  $('#contractEmailUploadModal').addEventListener('close', clearContractEmailUploadStage);

  async function saveSentContractFile(application, file) {
    try {
      if (!application || !file) throw new Error('The contract or client could not be found.');
      const id = uid();
      const storagePath = await saveDocumentBlob(id, file);
      application.documents = application.documents || [];
      application.documents.push({
        id,
        storagePath,
        name: file.name,
        type: file.type || documentContentType(file),
        size: file.size,
        addedAt: new Date().toISOString()
      });
      application.updatedAt = new Date().toISOString();
      persist();
      renderAll();
      return true;
    } catch (error) {
      console.error('Email sent, but the contract file could not be saved to the client:', error);
      toast('Email sent, but the file could not be saved to the client. You can upload it again.');
      return false;
    }
  }

  function renderPendingDocumentPreview(item) {
    const workspace = $('#hiredDocumentWorkspace');
    if (!workspace || !pendingDocumentFile) return;
    const file = pendingDocumentFile;
    const openEmailAfterSave = Boolean(item && !item.activePendingEmail && item.email?.trim() && !isContractEnded(item));
    pendingDocumentPreviewUrl = URL.createObjectURL(file);
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    workspace.innerHTML = `
      <div class="document-preview-card document-pending-card">
        <div class="document-preview-head">
          <div class="document-preview-title">
            <span class="doc-type-icon">${isPdf ? 'PDF' : 'DOC'}</span>
            <div><p class="eyebrow">READY TO SAVE</p><h3>${escapeHtml(file.name)}</h3><p>${formatFileSize(file.size)} · Selected just now</p></div>
          </div>
          <div class="document-preview-actions">
            <button class="button button-secondary" type="button" id="cancelPendingDocument">Cancel</button>
            <button class="button button-primary" type="button" id="savePendingDocument">${openEmailAfterSave ? 'Save &amp; send email' : 'Save file'}</button>
          </div>
        </div>
        <div class="document-inline-viewer" id="pendingInlineDocumentViewer">
          ${isPdf
            ? `<iframe src="${pendingDocumentPreviewUrl}" title="Preview of ${escapeHtml(file.name)}"></iframe>`
            : `<div class="word-preview"><div class="word-preview-icon">DOC</div><h4>${escapeHtml(file.name)}</h4><p>Your Word file is selected and ready to save. The browser cannot render .doc/.docx directly here, but you can open it after saving.</p></div>`}
        </div>
        <p class="doc-note save-file-note">${openEmailAfterSave ? 'Choose <strong>Save &amp; send email</strong> to attach this file and open the email to your client.' : 'Choose <strong>Save file</strong> to attach it to this client. It&#39;s stored securely in your account and ready to preview anytime.'}</p>
      </div>`;
  }

  function renderHiredDocumentWorkspace(item) {
    const workspace = $('#hiredDocumentWorkspace');
    if (!workspace) return;
    if (pendingDocumentFile && hiredEditingId === item.id) {
      renderPendingDocumentPreview(item);
      return;
    }
    const docs = item.documents || [];
    const latest = docs.length ? docs[docs.length - 1] : null;
    const oldest = docs.length ? docs[0] : null;
    if (!latest) {
      workspace.innerHTML = `
        <div class="upload-empty-state">
          <div>
            <p class="eyebrow">NEXT STEP REQUIRED</p>
            <h3>Upload a client document</h3>
            <p>This client is active, but the workflow is not complete until you attach a PDF or Word document.</p>
          </div>
          <span class="doc-empty">Choose Send contract email from Actions to attach the first document.</span>
        </div>`;
      return;
    }

    const documentRow = (doc, options = {}) => `
      <div class="active-document-row ${options.type || 'other-version-row'} ${options.highlight ? 'version-highlight' : ''}">
        <span class="doc-type-icon">${/\.pdf$/i.test(doc.name) ? 'PDF' : 'DOC'}</span>
        <div class="active-document-name"><strong>${escapeHtml(doc.name)}</strong><small>${/\.pdf$/i.test(doc.name) ? 'PDF' : 'Word document'}</small></div>
        ${item.contractEndDate && dateKey(item.contractEndDate) < today() ? '' : `<div class="document-row-menu">
          <button class="icon-button document-menu-button" type="button" aria-label="Document actions" aria-haspopup="true" aria-expanded="false"><i class="fa-solid fa-ellipsis-vertical" aria-hidden="true"></i></button>
          <div class="document-menu hidden">
            <button type="button" data-doc-open="${escapeHtml(doc.id)}">View File</button>
              <button type="button" class="document-menu-danger" data-doc-remove="${escapeHtml(doc.id)}">Delete File</button>
          </div>
        </div>`}
      </div>`;

    const newestVersionMarkup = documentRow(latest, { type: 'newest-version-row', highlight: true });
    const oldestVersionMarkup = oldest && oldest.id !== latest.id ? documentRow(oldest, { type: 'oldest-version-row' }) : '';
    const archiveItems = docs.slice().reverse();

    workspace.innerHTML = `
      <div class="document-version-section newest-version-section">
        <div class="document-version-label">Newest version</div>
        <div class="active-document-list">${newestVersionMarkup}</div>
        ${item.documentEmailPending && !(item.contractEndDate && dateKey(item.contractEndDate) < today()) ? renderDocumentUpdateAction(item) : ''}
      </div>
      ${oldestVersionMarkup ? `
      <div class="document-version-section oldest-version-section">
        <div class="document-version-label">Oldest version</div>
        <div class="active-document-list">${oldestVersionMarkup}</div>
      </div>` : ''}
      ${archiveItems.length ? `
      <div class="document-archive">
        <div class="document-archive-head"><span class="eyebrow">FULL FILE RECORD</span><span>${plural(docs.length, 'file')} saved</span></div>
        <div class="document-archive-list">
          ${archiveItems.map(doc => `
            <div class="document-archive-item">
              <button type="button" class="document-archive-name" data-doc-open="${escapeHtml(doc.id)}">
                <span class="doc-type-icon">${/\.pdf$/i.test(doc.name) ? 'PDF' : 'DOC'}</span>
                <span class="document-archive-meta"><span class="document-archive-filename">COA | ${escapeHtml(formatDate(doc.addedAt.slice(0, 10)))}</span><span class="document-archive-date">${formatFileSize(doc.size)}</span></span>
              </button>
              <button type="button" class="doc-remove archive-delete-button" data-doc-remove="${escapeHtml(doc.id)}" aria-label="Delete ${escapeHtml(doc.name)} from the archive" title="Delete file">Delete file</button>
            </div>`).join('')}
        </div>
      </div>` : ''}`;
  }

  function renderDocumentUpdateAction(item) {
    const reminderDate = dateKey(item.documentEmailReminderDate);
    if (reminderDate && reminderDate > today()) {
      return `<div class="document-update-prompt document-update-scheduled"><div><strong>Email reminder scheduled</strong><span>${escapeHtml(formatDate(reminderDate))}</span></div><button class="button button-secondary" type="button" id="changeDocumentEmailReminder">Change date</button></div>`;
    }
    return `<div class="document-update-prompt"><div><strong>Updated file saved</strong><span>Send the latest version to this client.</span></div><div class="document-update-actions"><button class="button button-primary" type="button" id="sendUpdatedDocumentEmail">Send updated version</button><button class="button button-secondary" type="button" id="dismissUpdatedDocumentEmail">Send later</button></div></div>`;
  }

  async function renderInlineDocumentPreview(doc) {
    const target = $('#inlineDocumentViewer');
    if (!target || !doc) return;
    try {
      const blob = await getDocumentBlob(doc.id);
      if (!blob) { target.innerHTML = '<div class="document-loading">Preview unavailable. Use “View file” to open the saved copy.</div>'; return; }
      const url = URL.createObjectURL(blob);
      if (/\.pdf$/i.test(doc.name) || blob.type === 'application/pdf') {
        target.innerHTML = `<iframe src="${url}" title="PDF preview for ${escapeHtml(doc.name)}"></iframe>`;
      } else {
        target.innerHTML = `<div class="word-preview"><div class="word-preview-icon">DOC</div><h4>${escapeHtml(doc.name)}</h4><p>Word preview is not rendered directly by the browser. Use “Open Word file” to view the saved document.</p><button class="button button-primary" type="button" data-doc-open="${escapeHtml(doc.id)}">Open Word file</button></div>`;
      }
    } catch { target.innerHTML = '<div class="document-loading">Could not load the document preview.</div>'; }
  }

  function renderHiredDocuments(item, targetSelector = '#hiredDetailDocumentList') {
    const list = $(targetSelector);
    if (!list) return;
    const docs = item.documents || [];
    list.innerHTML = docs.length ? docs.map(doc => `
      <div class="doc-row"><button type="button" class="doc-name" data-doc-open="${escapeHtml(doc.id)}"><span class="doc-type-icon">${/\.pdf$/i.test(doc.name) ? 'PDF' : 'DOC'}</span><span class="doc-name-text">${escapeHtml(doc.name)}</span></button><span class="doc-size">${formatFileSize(doc.size)}</span><button type="button" class="doc-remove" data-doc-remove="${escapeHtml(doc.id)}" aria-label="Remove ${escapeHtml(doc.name)}">×</button></div>
    `).join('') : '<p class="doc-empty">No documents attached yet.</p>';
  }

  function stageHiredDocument(files) {
    const file = [...(files || [])].find(candidate => /\.(pdf|doc|docx)$/i.test(candidate.name) || ['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(candidate.type));
    if (!file) { toast('Please choose a PDF or Word document.'); return; }
    clearPendingDocumentPreview();
    pendingDocumentFile = file;
    renderHiredDocumentWorkspace(data.applications.find(application => application.id === hiredEditingId));
  }

  async function pickHiredDocumentFile() {
    if (!hiredEditingId) return;
    // Prefer the File System Access picker when available. It returns a File directly and
    // avoids the hidden input/form path that can cause a static page to navigate on some browsers.
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [{ description: 'PDF or Word document', accept: {
            'application/pdf': ['.pdf'],
            'application/msword': ['.doc'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx']
          }}]
        });
        const file = await handle.getFile();
        stageHiredDocument([file]);
      } catch (error) {
        if (error?.name !== 'AbortError') showActionResult({ title: 'File picker unavailable', message: 'Could not open the file picker. Check browser permissions and try again.', status: 'error' });
      }
      return;
    }
    const input = $('#hiredDetailDocumentInput');
    if (!input) return;
    input.value = '';
    input.click();
  }

  async function savePendingHiredDocument() {
    const item = data.applications.find(application => application.id === hiredEditingId);
    const file = pendingDocumentFile;
    const saveButton = $('#savePendingDocument');
    const cancelButton = $('#cancelPendingDocument');
    if (!item || !file || isContractEnded(item) || saveButton?.disabled) return;
    if (saveButton) saveButton.disabled = true;
    if (cancelButton) cancelButton.disabled = true;
    const docId = uid();
    try {
      const storagePath = await saveDocumentBlob(docId, file);
      item.documents = item.documents || [];
      item.documents.push({ id: docId, storagePath, name: file.name, type: file.type, size: file.size, addedAt: new Date().toISOString() });
      const activationEmailPending = Boolean(item.activePendingEmail);
      item.activePendingDocument = false;
      if (activationEmailPending) {
        item.documentEmailPending = false;
        item.documentEmailReminderDate = '';
        item.documentEmailReminderAlertedDate = '';
      }
      item.updatedAt = new Date().toISOString();
      await persist();
      clearPendingDocumentPreview();
      renderAll();
      if (activationEmailPending) openClientEmailComposer(item);
      else if (item.email?.trim()) openUpdatedDocumentEmailComposer(item, docId);
      const status = $('#documentsFolderStatus');
      if (status) status.textContent = 'Saved — ready to preview anytime.';
      if (activationEmailPending) {
        showActionResult({ title: 'Document saved', message: 'The file was saved. Send the client email to finish activation.' });
      } else if (item.email?.trim()) {
        showActionResult({ title: 'Document saved', message: 'Review the email below and send it to your client.' });
      } else {
        toast('Add a client email to send this contract.');
      }
    } catch (error) {
      console.error(error);
      const message = error?.message || 'The secure file store rejected the upload';
      const status = $('#documentsFolderStatus');
      if (status) status.textContent = `Upload failed: ${message}`;
      showActionResult({ title: 'Document save failed', message: `Could not save ${file.name}: ${message}`, status: 'error' });
    } finally {
      if (saveButton) saveButton.disabled = false;
      if (cancelButton) cancelButton.disabled = false;
    }
  }

  async function removeHiredDocument(docId) {
    const item = data.applications.find(application => application.id === hiredEditingId);
    if (!item) return;
    const doc = (item.documents || []).find(document => document.id === docId);
    if (!doc || !(await appConfirm(`Are you sure you want to delete the file "${doc.name}" from ${item.clientName}? This cannot be undone.`, { title: 'Delete client document', confirmLabel: 'Delete', danger: true }))) return;
    item.documents = (item.documents || []).filter(document => document.id !== docId);
    item.activePendingDocument = false;
    item.updatedAt = new Date().toISOString();
    persist();
    try { await deleteDocumentBlob(doc?.storagePath || docId); } catch { /* already gone, ignore */ }
    renderHired();
    renderHiredDetail(item, false);
    showActionResult({ title: 'Document removed', message: 'The client document was removed from Supabase.' });
  }

  async function openDocument(docId) {
    try {
      const doc = (data.applications.flatMap(app => app.documents || [])).find(item => item.id === docId);
      const blob = await getDocumentBlob(doc?.storagePath || docId);
      if (!blob) { showActionResult({ title: 'Document unavailable', message: 'That file could not be found in your account.', status: 'error' }); return; }
      showDocumentViewer(doc || { name: 'Document' }, blob);
    } catch {
      showActionResult({ title: 'Could not open document', message: 'The document could not be downloaded from Supabase.', status: 'error' });
    }
  }

  function alertPortfolioSubmissionEmails(emails) {
    data.alerts = data.alerts || [];
    let added = false;
    (emails || []).forEach(emailItem => {
      if (isSentEmail(emailItem)) return;
      const fromHeader = String(emailItem.from || '');
      const bracketAddress = fromHeader.match(/<([^>]+)>/);
      const senderAddress = (bracketAddress?.[1] || fromHeader.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '').trim().toLowerCase();
      if (senderAddress !== 'submissions@formsubmit.co') return;
      const alertId = `portfolio-submission|${emailItem.gmailId || emailItem.id}`;
      if (data.alerts.some(alert => alert.id === alertId)) return;
      data.alerts.unshift({
        id: alertId,
        clientName: 'Portfolio submission',
        subject: `Portfolio inquiry: ${emailItem.subject || '(No subject)'}`,
        from: fromHeader || 'submissions@formsubmit.co',
        date: emailItem.date || new Date().toISOString(),
        unread: true
      });
      added = true;
    });
    if (added) limitAlertHistory();
    return added;
  }

  function alertNewMatches(newEmails, { showNotice = true, createdTasks = [] } = {}) {
    const matchTypeFor = app => app.status === 'Active client'
      ? (isContractEnded(app) ? 'Ended client' : 'Active client') : 'Application';
    const matches = [];
    newEmails.forEach(emailItem => {
      if (isSentEmail(emailItem)) return;
      const applications = matchApplicationsForEmail(emailItem);
      applications.forEach(app => matches.push({ emailItem, app }));
    });
    // Retain a durable pending flag until the notification snapshot saves.
    // This recovers mail fetched just before a reload interrupted notification creation.
    const pendingEmails = newEmails.filter(email => email.clientEmailNotificationPending);
    pendingEmails.forEach(email => { email.clientEmailNotificationPending = false; });
    if (!matches.length) {
      if (pendingEmails.length) saveClientEmailNotifications(pendingEmails);
      return false;
    }

    const unique = [];
    const seen = new Set();
    matches.forEach(match => {
      const key = `${match.emailItem.gmailId || match.emailItem.id}|${match.app.id}`;
      if (!seen.has(key) && !data.alerts.some(alert => alert.id === key)) { seen.add(key); unique.push(match); }
    });

    if (!unique.length) {
      if (pendingEmails.length) saveClientEmailNotifications(pendingEmails);
      return false;
    }

    unique.forEach(({ emailItem, app }) => {
      if (app.status === 'Active client') return;
      if (!isInterviewEmail(emailItem)) return;
      const interviewDate = interviewDateFromEmail(emailItem);
      const sameDay = Boolean(interviewDate && app.interviewDate && interviewDate === app.interviewDate);
      app.interviewPriority = true;
      if (interviewDate) app.interviewDate = interviewDate;
      app.interviewSameDay = sameDay;
      app.interviewAlert = sameDay ? 'Interview date confirmed by another client email' : 'Interview requested or scheduled';
    });

    unique.forEach(({ emailItem, app }) => {
      const alertId = `${emailItem.gmailId || emailItem.id}|${app.id}`;
      if (!data.alerts.some(alert => alert.id === alertId)) {
        const clientRecord = app.status === 'Active client';
        const interview = !clientRecord && isInterviewEmail(emailItem);
        const interviewDate = interviewDateFromEmail(emailItem);
        const sameDay = Boolean(app.interviewSameDay);
        data.alerts.unshift({
          id: alertId,
          type: clientRecord ? 'active-client-email' : 'application-email',
          matchType: matchTypeFor(app),
          applicationId: app.id,
          emailId: emailItem.id,
          taskId: createdTasks.find(task => task.clientId === app.id && task.sourceEmailId === emailItem.id)?.id || '',
          clientName: app.clientName,
          subject: interview ? `${sameDay ? 'Interview date confirmed' : 'Interview with client'}: ${emailItem.subject || '(No subject)'}` : (emailItem.subject || '(No subject)'),
          from: emailItem.from || 'Unknown sender',
          date: emailItem.date || new Date().toISOString(),
          interviewDate: interviewDate || app.interviewDate || '',
          unread: true
        });
      }
    });
    limitAlertHistory();
    saveClientEmailNotifications(pendingEmails);
    renderAlerts();

    const categories = ['Application', 'Active client', 'Ended client'].map(label => ({
      label, count: new Set(unique.filter(({ app }) => matchTypeFor(app) === label).map(({ app }) => app.id)).size
    })).filter(category => category.count);
    const emailCount = new Set(unique.map(({ emailItem }) => emailItem.gmailId || emailItem.id)).size;
    const mixed = categories.length > 1;
    const category = categories[0].label;
    const matchSummary = mixed
      ? `${plural(emailCount, 'new email')} matched to ${categories.map(item => plural(item.count, item.label.toLowerCase())).join(' and ')}.`
      : `${plural(emailCount, 'new email')} matched to your ${category.toLowerCase()}s.`;
    if (showNotice) showActionResult({
      title: mixed ? `New ${categories.map(item => item.label.toLowerCase()).join(' and ')} emails`
        : category !== 'Application' && unique.length === 1
          ? `${category}: ${unique[0].app.contact || unique[0].app.clientName || 'Your client'} sent you an email`
          : `New ${category.toLowerCase()} email${emailCount === 1 ? '' : 's'}`,
      message: `${matchSummary}${createdTasks.length ? ` ${plural(createdTasks.length, 'task')} created automatically from work requests.` : ''}`,
      status: 'info',
      label: mixed ? 'MATCHED EMAIL ALERT' : category === 'Application' ? 'APPLICATION EMAIL ALERT' : category === 'Ended client' ? 'ENDED CLIENT EMAIL ALERT' : 'CLIENT EMAIL ALERT',
      actionLabel: 'Open inbox',
      details: unique.map(({ emailItem, app }) => ({
        clientName: app.clientName,
        matchType: matchTypeFor(app),
        subject: emailItem.subject || '(No subject)',
        from: emailItem.from || 'Unknown sender',
        date: emailItem.date || '',
        taskCreated: createdTasks.some(task => task.clientId === app.id && task.sourceEmailId === emailItem.id)
      })),
      onAction: () => { showView('inbox'); openEmailDetail(unique[0].emailItem.id); }
    });
    return true;
  }

  function saveClientEmailNotifications(pendingEmails) {
    const workspace = data;
    const restorePending = () => {
      if (data === workspace) pendingEmails.forEach(email => { email.clientEmailNotificationPending = true; });
    };
    Promise.resolve(persist()).then(saved => { if (saved === false) restorePending(); }).catch(restorePending);
  }


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

  function limitAlertHistory() {
    const alerts = Array.isArray(data.alerts) ? data.alerts : [];
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
    const existingById = new Map(data.alerts.map(alert => [alert.id, alert]));
    const generated = new Map();
    const add = alert => {
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
    const changed = previousGeneratedIds.size !== generatedIds.size
      || [...previousGeneratedIds].some(id => !generatedIds.has(id))
      || [...generatedIds].some(id => !previousGeneratedIds.has(id))
      || [...generated.values()].some(alert => {
        const existing = existingById.get(alert.id);
        return !existing || Object.keys(alert).some(key => existing[key] !== alert[key]);
      });
    const retainedAlerts = data.alerts.filter(alert => !isGeneratedNotification(alert));
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
    return (data.alerts || []).filter(alert => !alert.dismissedAt && (!alert.snoozedUntil || new Date(alert.snoozedUntil).getTime() <= now));
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
    else if (action === 'dismiss') alert.dismissedAt = new Date().toISOString();
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

  function startNotificationRefreshTimer() {
    if (!notificationRefreshTimer) {
      notificationRefreshTimer = setInterval(() => {
        if (dataReady && supabaseDataLoaded) {
          renderAlerts();
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
      if (data.alerts.some(alert => alert.id === alertId)) return;
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
      if (data.alerts.some(alert => alert.id === alertId)) return;
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

  async function runDueFollowUps() {
    const userId = currentUser?.id;
    const due = data.applications.filter(item => item.followUpDate && item.followUpDate <= today() && item.status !== 'Active client' && item.status !== 'Not selected' && applicationFollowUpState(item) !== 'sent' && (!item.followUpProcessedAt || (item.automaticFollowUp && !item.followUpSentAt && gmailAccessToken)));
    if (!due.length) return;
    data.alerts = data.alerts || [];
    let followUpAlertsAdded = 0;
    let automaticEmailsSent = 0;
    let automaticEmailsFailed = 0;
    let followUpsNeedingReview = 0;
    let lastFailure = '';
    for (const item of due) {
      if (currentUser?.id !== userId) return;
      if (!item.followUpDate || applicationFollowUpState(item) === 'sent') continue;
      const scheduledFollowUpDate = item.followUpDate;
      const template = buildDocumentEmailTemplate('follow-up', item);
      const subject = template.subject;
      const body = template.body;
      let sent = false;
      let delivery = null;
      if (item.automaticFollowUp && gmailAccessToken && isEmailAddress(item.email)) {
        try {
          delivery = await sendAutomaticFollowUpOnce(item, scheduledFollowUpDate, subject, body);
          sent = true;
          automaticEmailsSent += 1;
        } catch (error) {
          console.error('Automatic follow-up failed:', error);
          automaticEmailsFailed += 1;
          lastFailure = error.message || 'Follow-up delivery could not be confirmed.';
        }
      }
      if (currentUser?.id !== userId) return;
      item.followUpProcessedAt = new Date().toISOString();
      item.followUpSentAt = sent ? delivery.sentAt : '';
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
        subject: sent ? `Automatic follow-up sent: ${subject}` : `Follow-up needed: ${subject}`,
        from: sent ? 'Jeff VA' : 'Jeff VA reminder',
        date: new Date().toISOString(),
        unread: true
      };
      if (existingAlert) Object.assign(existingAlert, followUpAlert);
      else {
        data.alerts.unshift(followUpAlert);
        followUpAlertsAdded += 1;
      }
      if (sent) {
        if (!delivery.gmailId || !data.emails.some(email => email.gmailId === delivery.gmailId)) {
          data.emails.unshift({ id: delivery.gmailId ? `gmail-${delivery.gmailId}` : uid(), gmailId: delivery.gmailId || '', applicationId: item.id, emailType: 'follow-up', from: 'You', to: item.email, subject, body, date: delivery.sentAt, importedAt: new Date().toISOString(), source: delivery.gmailId ? 'gmail' : 'sent', direction: 'sent' });
        }
        await persist();
      } else if (!item.automaticFollowUp || !gmailAccessToken || !isEmailAddress(item.email)) {
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
    if (!visibleNotificationAlerts().length) return;
    if (!(await appConfirm('Dismiss all visible notifications? This will not delete your tasks or client records.', { title: 'Clear notifications', confirmLabel: 'Clear all', danger: true }))) return;
    const dismissedAt = new Date().toISOString();
    visibleNotificationAlerts().forEach(alert => { alert.dismissedAt = dismissedAt; });
    persist();
    renderAlerts();
  }

  const INVOICE_PAYMENT_METHODS = ['Wise', 'PayPal', 'Payoneer', 'GCash', 'MariBank', 'Bank transfer', 'Other'];

  function parseInvoiceDate(value) {
    const text = String(value || '').trim();
    let year;
    let month;
    let day;
    let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/);
    if (match) [, year, month, day] = match;
    else if ((match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [, day, month, year] = match;
    else {
      match = text.match(/^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})$/i);
      if (!match) return '';
      const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      month = monthNames.indexOf(match[1].slice(0, 3).toLowerCase()) + 1;
      day = match[2];
      year = match[3];
    }
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return '';
    return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function invoicePaymentStatus(invoice) {
    if (invoice.paidAt) return 'Paid';
    const dueDate = parseInvoiceDate(invoice.dueDate);
    return dueDate && dueDate < today() ? 'Overdue' : 'Sent';
  }

  function invoiceAmount(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '';
  }

  function invoicePaymentSummary(invoices) {
    const totals = { invoiced: new Map(), received: new Map(), unpaid: new Map() };
    let paidCount = 0;
    invoices.forEach(invoice => {
      const paid = invoicePaymentStatus(invoice) === 'Paid';
      if (paid) paidCount += 1;
      const currency = String(invoice.paymentCurrency || 'USD').toUpperCase();
      const amountInvoiced = invoice.amountInvoiced === '' || invoice.amountInvoiced == null ? Number.NaN : Number(invoice.amountInvoiced);
      const amountReceived = invoice.amountReceived === '' || invoice.amountReceived == null ? Number.NaN : Number(invoice.amountReceived);
      if (Number.isFinite(amountInvoiced) && amountInvoiced >= 0) {
        totals.invoiced.set(currency, (totals.invoiced.get(currency) || 0) + amountInvoiced);
        if (!paid) totals.unpaid.set(currency, (totals.unpaid.get(currency) || 0) + Math.max(0, amountInvoiced - (Number.isFinite(amountReceived) ? amountReceived : 0)));
      }
      if (paid && Number.isFinite(amountReceived) && amountReceived >= 0) totals.received.set(currency, (totals.received.get(currency) || 0) + amountReceived);
    });
    const formatTotals = map => [...map].map(([currency, amount]) => `${invoiceAmount(amount)} ${escapeHtml(currency)}`).join(' · ');
    return `
      <div class="client-invoice-payment-summary" aria-label="Invoice payment summary">
        <div><strong>Billed</strong><span>${formatTotals(totals.invoiced) || '—'}</span><small>${invoices.length} ${plural(invoices.length, 'invoice')}</small></div>
        <div><strong>Received</strong><span>${formatTotals(totals.received) || '—'}</span><small>${paidCount} paid</small></div>
        <div><strong>Outstanding</strong><span>${formatTotals(totals.unpaid) || '—'}</span><small>${invoices.length - paidCount} unpaid${invoices.filter(invoice => invoicePaymentStatus(invoice) === 'Overdue').length ? ` · <span class="client-invoice-overdue-copy">${invoices.filter(invoice => invoicePaymentStatus(invoice) === 'Overdue').length} overdue</span>` : ''}</small></div>
        ${invoices.some(invoice => invoice.amountInvoiced === '' || invoice.amountInvoiced == null) ? '<small class="client-invoice-payment-hint">Some invoices have no amount</small>' : ''}
      </div>`;
  }

  function invoicePaymentDetail(invoice) {
    const parts = [];
    const paidDate = parseInvoiceDate(invoice.paidAt);
    if (paidDate) parts.push(formatDate(paidDate));
    const received = invoice.amountReceived === '' || invoice.amountReceived == null ? Number.NaN : Number(invoice.amountReceived);
    if (Number.isFinite(received) && received >= 0) parts.push(`${invoiceAmount(received)}${invoice.paymentCurrency ? ` ${String(invoice.paymentCurrency).toUpperCase()}` : ''}`);
    if (invoice.paymentMethod) parts.push(String(invoice.paymentMethod));
    return parts.length ? `Paid ${parts.join(' · ')}` : '';
  }

  function openInvoicePayment(invoiceId) {
    const invoice = (data.invoices || []).find(item => item.id === invoiceId);
    if (!invoice) return;
    const client = data.applications.find(item => item.id === invoice.clientId);
    const salaryAmount = Number(client?.salaryAmount);
    const amountPrefill = Number.isFinite(salaryAmount) && salaryAmount >= 0 && client?.salaryAmount !== '' ? String(salaryAmount) : '';
    const currency = invoice.paymentCurrency || client?.salaryCurrency || 'USD';
    const currencySelect = $('#invoicePaymentCurrency');
    if (![...currencySelect.options].some(option => option.value === currency)) {
      const option = document.createElement('option');
      option.value = currency;
      option.textContent = currency;
      currencySelect.append(option);
    }
    $('#invoicePaymentForm').dataset.invoiceId = invoice.id;
    $('#invoicePaymentTitle').textContent = invoice.paidAt ? 'Edit payment' : 'Mark invoice as paid';
    $('#invoicePaymentDate').value = parseInvoiceDate(invoice.paidAt) || today();
    $('#invoiceAmountReceived').value = invoice.amountReceived ?? amountPrefill;
    currencySelect.value = currency;
    $('#invoicePaymentFee').value = invoice.paymentFee ?? '';
    $('#invoiceAmountReceivedPhp').value = invoice.amountReceivedPhp ?? '';
    $('#invoicePaymentMethod').value = invoice.paymentMethod || '';
    $('#invoiceWalletAccount').value = invoice.walletAccount || '';
    $('#invoiceAmountInvoiced').value = invoice.amountInvoiced ?? amountPrefill;
    $('#invoicePaymentNote').value = invoice.paymentNote || '';
    $('#invoicePaymentModal').showModal();
    $('#invoicePaymentDate').focus();
  }

  async function markInvoiceUnpaid(invoiceId) {
    const invoice = (data.invoices || []).find(item => item.id === invoiceId);
    if (!invoice) return;
    if (!(await appConfirm(`Mark invoice ${invoice.invoiceNumber || ''} as unpaid? Its payment details will be cleared.`, {
      title: 'Mark invoice as unpaid',
      confirmLabel: 'Mark as unpaid',
      danger: true
    }))) return;
    ['paymentStatus', 'paidAt', 'amountInvoiced', 'amountReceived', 'paymentCurrency', 'paymentFee', 'amountReceivedPhp', 'paymentMethod', 'paymentNote', 'walletAccount']
      .forEach(field => delete invoice[field]);
    persist();
    const client = data.applications.find(item => item.id === invoice.clientId);
    if (activeView === 'wallet') renderWallet();
    else if (client) renderHiredDetail(client, false);
    showActionResult({ title: 'Payment cleared', message: 'The invoice is marked as unpaid.' });
  }

  $('#invoicePaymentForm').addEventListener('submit', event => {
    if (event.submitter?.value === 'cancel') return;
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const invoice = (data.invoices || []).find(item => item.id === form.dataset.invoiceId);
    if (!invoice) {
      $('#invoicePaymentModal').close();
      showActionResult({ title: 'Invoice not found', message: 'The invoice could not be found. Refresh the client details and try again.', status: 'error' });
      return;
    }
    const dateReceived = $('#invoicePaymentDate').value;
    const amountReceivedText = $('#invoiceAmountReceived').value;
    const amountReceived = Number(amountReceivedText);
    if (!parseInvoiceDate(dateReceived) || amountReceivedText === '' || !Number.isFinite(amountReceived) || amountReceived < 0) {
      toast('Enter a valid date and a non-negative amount received.');
      return;
    }
    const optionalAmounts = [
      ['amountInvoiced', '#invoiceAmountInvoiced'],
      ['paymentFee', '#invoicePaymentFee'],
      ['amountReceivedPhp', '#invoiceAmountReceivedPhp']
    ];
    const payment = {
      paymentStatus: 'paid',
      paidAt: dateReceived,
      amountReceived,
      paymentCurrency: $('#invoicePaymentCurrency').value || 'USD',
      paymentMethod: $('#invoicePaymentMethod').value,
      walletAccount: $('#invoiceWalletAccount').value,
      paymentNote: $('#invoicePaymentNote').value.trim()
    };
    for (const [field, selector] of optionalAmounts) {
      const value = $(selector).value;
      if (value === '') {
        payment[field] = '';
        continue;
      }
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount < 0) {
        toast('Enter valid non-negative amounts.');
        return;
      }
      payment[field] = amount;
    }
    Object.entries(payment).forEach(([field, value]) => {
      if (value === '') delete invoice[field];
      else invoice[field] = value;
    });
    persist();
    $('#invoicePaymentModal').close();
    const client = data.applications.find(item => item.id === invoice.clientId);
    if (activeView === 'wallet') renderWallet();
    else if (client) renderHiredDetail(client, false);
    showActionResult({ title: 'Payment saved', message: `Payment for ${invoice.invoiceNumber || 'the invoice'} was saved.` });
  });

  // --- Gmail sync ---
  // Runs entirely in the browser via Google's own sign-in (Google Identity Services) and calls
  // the Gmail API directly with the resulting token. Jeff VA has no server of its own,
  // so nothing about your inbox passes through anything but your browser and Google's API.
  const GMAIL_SCOPE = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send'
  ].join(' ');
  const GMAIL_SEND_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
  const DOCUMENT_TEMPLATE_DEFINITIONS = {
    'blank-email': {
      name: 'Empty email',
      subject: '',
      body: ''
    },
    'contract-signing': {
      name: 'Contract signing',
      subject: 'Contract for Your Review: Jeffrey S. Almocera',
      body: 'Hi {{contact}},\n\nThank you for choosing to move forward together. Please find attached the service contract for **{{role}}** outlining the scope of work, rate, and terms we discussed.\n\nKindly review the details at your convenience. Once everything looks good, please sign and return a copy so we can get started. Let me know if you have any questions or if any adjustments are needed.\n\nBest regards,\nJeffrey S. Almocera\nalmocerajeffreys@gmail.com | +63 975-683-4839'
    },
    'follow-up': {
      name: 'Follow-up',
      subject: 'Follow-up: {{clientName}}',
      body: 'Hi {{contact}},\n\nI wanted to follow up on my application for the **{{role}}** role, which I submitted on {{applicationDate}}. I would appreciate any update on the progress or next steps.\n\nThank you for your time and consideration.\n\nBest regards,\nJeffrey S. Almocera\nalmocerajeffreys@gmail.com | +63 975-683-4839'
    },
    'proceed-application': {
      name: 'Proceed application',
      subject: 'Application for - {{role}}',
      body: 'Dear Hiring Team,\n\nThank you for the opportunity to move forward with my application for the {{role}} position. I am sharing my contact details below for your reference.\n\nFull name: Jeffrey S. Almocera\nEmail: almocerajeffreys@gmail.com\nPhone: +63 975 683 4839\nWebsite: jeffdigi.com\n\nPlease let me know if you need any additional information. I look forward to hearing from you about the next steps.\n\nBest regards,\nJeffrey S. Almocera\nalmocerajeffreys@gmail.com | +63 975-683-4839'
    },
    'contract-ended': {
      name: 'Contract ended',
      subject: 'Wrapping Up Our Engagement: Jeffrey S. Almocera',
      body: 'Hi {{contact}},\n\nAs we reach the end of our contract period, I wanted to reach out and thank you for the opportunity to work with you over the past **{{duration}}** on **{{role}}**.\n\nIf there is any handover or documentation you need from my end before we close things out, please let me know and I will take care of it.\n\nShould you ever need support again in the future, I would welcome the chance to work together again.\n\nThank you again for the trust and the opportunity.\n\nBest regards,\nJeffrey S. Almocera\nalmocerajeffreys@gmail.com | +63 975-683-4839'
    },
    'send-new-contract': {
      name: 'Send new contract',
      subject: 'New Contract for {{clientName}}: Jeffrey S. Almocera',
      body: 'Hi {{contact}},\n\nThank you for the opportunity to continue working together. Please find attached the latest contract for **{{role}}**.\n\nPlease review it at your convenience and let me know if you need any adjustments before we proceed.\n\nBest regards,\nJeffrey S. Almocera\nalmocerajeffreys@gmail.com | +63 975-683-4839'
    },
    'invoice': {
      name: 'Invoice',
      subject: 'Invoice for {{role}}: {{invoiceNumber}} / {{billingPeriod}}',
      body: 'Hi {{contact}},\n\nI hope this message finds you well. Please find attached the invoice for the **{{role}}** services provided.\n\nInvoice Number: {{invoiceNumber}}\nDate of Issue: {{issueDate}}\nBilling Period: {{billingPeriod}}\nDue Date: {{dueDate}}\n\nKindly review at your convenience, and let me know if you have any questions.\n\nThank you for the continued opportunity to work with you.\n\nBest regards,\nJeffrey S. Almocera\nalmocerajeffreys@gmail.com | +63 975-683-4839'
    },
    'updated-contract': {
      name: 'Updated contract',
      subject: 'Updated Contract Of Agreement',
      body: 'Dear {{contactPerson}},\n\nPlease find attached the updated Contract of Agreement for your review and records.\n\nShould you have any questions or require further clarification, please feel free to contact me.\n\nThank you.\n\nBest regards,\n**Jeffrey S. Almocera**\nalmocerajeffreys@gmail.com | +63 975-683-4839'
    }
  };

  let gmailAccessToken = null;
  let composeAttachment = null;
  let composeAttachmentFile = null;
  let composeClientId = null;
  let composeActivationClientId = null;
  let composeInvoiceDraft = null;
  let composeDocumentUpdateClientId = null;
  let composeContractEmailMode = false;
  let contractEmailSendPending = false;
  let composeRequiresConfirmation = false;
  let gmailTokenRequest = null;
  let gmailAuthorizationRecovery = null;
  let gmailReconnectRequired = false;
  let gmailSyncTriggerTimer = null;
  let sentHistoryAddressSignature = '';
  let sentHistoryPageToken = '';
  let sentHistoryQueue = [];
  let sentHistoryLoaded = false;
  let inboxHistoryLoaded = false;
  let inboxHistoryPageToken = '';
  let inboxHistoryQueue = [];
  const GMAIL_CONNECTED_KEY = 'jeff-va-gmail-connected-v1';
  const GMAIL_TOKEN_SESSION_KEY = 'jeff-va-gmail-token-session-v1';
  const GMAIL_RECONNECT_REQUIRED_KEY = 'jeff-va-gmail-reconnect-required-v1';
  const GMAIL_CREDENTIALS_KEY = 'jeff-va-gmail-credentials-v2:';

  function saveGmailCredentials(userId, token, refreshToken, expiresIn = 3600) {
    if (!userId || !token) return;
    const previous = readGmailCredentials(userId);
    const credentials = { token, refreshToken: refreshToken || previous?.refreshToken || '',
      expiresAt: Date.now() + Math.max(0, Number(expiresIn) || 3600) * 1000 };
    localStorage.setItem(`${GMAIL_CREDENTIALS_KEY}${userId}`, JSON.stringify(credentials));
    gmailAccessToken = token;
    gmailReconnectRequired = false;
    sessionStorage.setItem(GMAIL_TOKEN_SESSION_KEY, token);
    sessionStorage.removeItem(GMAIL_RECONNECT_REQUIRED_KEY);
    sessionStorage.setItem(GMAIL_CONNECTED_KEY, '1');
  }

  function readGmailCredentials(userId = currentUser?.id) {
    if (!userId) return null;
    try { return JSON.parse(localStorage.getItem(`${GMAIL_CREDENTIALS_KEY}${userId}`) || 'null'); }
    catch { return null; }
  }

  function captureGoogleSession(session, freshLogin = false) {
    const saved = readGmailCredentials(session?.user?.id);
    if (session?.provider_token && (freshLogin || !saved)) {
      saveGmailCredentials(session.user.id, session.provider_token, session.provider_refresh_token,
        freshLogin ? 3600 : 1);
    } else if (saved) {
      gmailAccessToken = saved.token;
      gmailReconnectRequired = false;
    }
  }

  async function renewGmailAccess() {
    const userId = currentUser?.id;
    const saved = readGmailCredentials();
    if (!saved?.refreshToken) {
      const error = new Error('Connect Gmail once to enable automatic renewal. Saved emails remain available.');
      error.reconnect = true;
      throw error;
    }
    const { data: auth, error: authError } = await requireSupabase().auth.getSession();
    if (authError || !auth?.session?.access_token) throw new Error('Your dashboard session could not be renewed. Try again when online.');
    const response = await fetch('/api/gmail/refresh', {
      method: 'POST', headers: { authorization: `Bearer ${auth.session.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: saved.refreshToken }), signal: AbortSignal.timeout(15000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.access_token) {
      const error = new Error(result.error || 'Automatic Gmail renewal is unavailable on this server.');
      error.reconnect = result.reconnect === true;
      throw error;
    }
    if (!userId || currentUser?.id !== userId) throw new Error('The account changed while Gmail was reconnecting.');
    saveGmailCredentials(userId, result.access_token, saved.refreshToken, result.expires_in);
    return gmailAccessToken;
  }

  $('#emailComposeModal').addEventListener('close', () => {
    if (composeContractEmailMode) {
      composeContractEmailMode = false;
      contractEmailSendPending = false;
      composeAttachment = null;
      composeAttachmentFile = null;
      composeClientId = null;
      composeActivationClientId = null;
      composeInvoiceDraft = null;
      composeDocumentUpdateClientId = null;
      composeRequiresConfirmation = false;
      updateComposeAttachmentDisplay();
      return;
    }
    if (!composeDocumentUpdateClientId) return;
    composeDocumentUpdateClientId = null;
    toast('Contract saved. Email not sent yet.');
  });

  function renderDocumentTemplateOptions(selectedId = 'contract-signing') {
    const select = $('#documentTemplateSelect');
    if (!select) return;
    select.innerHTML = Object.entries(DOCUMENT_TEMPLATE_DEFINITIONS)
      .map(([templateId, template]) => `<option value="${escapeHtml(templateId)}">${escapeHtml(template.name)}</option>`)
      .join('');
    select.value = selectedId;
  }

  function escapeHtmlForEmail(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function htmlEmailBodyFromText(value = '') {
    const plain = String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    const escaped = escapeHtmlForEmail(plain)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    const paragraphs = escaped
      .split(/\n\s*\n/)
      .map(paragraph => paragraph.replace(/\n/g, '<br>'))
      .filter(Boolean)
      .map(paragraph => `<p style="margin:0 0 18px; line-height:1.7; font-size:17px; color:#1f2a2d;">${paragraph}</p>`)
      .join('');

    const content = paragraphs || '<p style="margin:0; line-height:1.7; font-size:17px; color:#1f2a2d;">&nbsp;</p>';
    return `
      <div style="background:#f3efe9; padding:32px 16px; font-family:Arial, Helvetica, sans-serif;">
        <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #e6dfd7; border-radius:18px; box-shadow:0 8px 22px rgba(27,24,20,0.06); overflow:hidden;">
          <div style="height:5px; background:#0f1720; border-radius:18px 18px 0 0;"></div>
          <div style="padding:28px 32px 20px;">
            ${content}
          </div>
          <div style="background:rgb(26, 35, 64); padding:16px 24px; text-align:center; font-size:13px; color:#ffffff; letter-spacing:0.02em; border-top:1px solid rgba(255,255,255,0.15);">
            <div>Copyright © 2026 Jeffrey S. Almocera</div>
            <div style="margin-top:4px; font-weight:600;">jeffdigi.com</div>
          </div>
        </div>
      </div>
    `;
  }

  function buildRawEmailMessage({ to, subject, body, attachmentName = '', attachmentType = 'application/octet-stream', attachmentBase64 = '' }) {
    const safeRecipient = String(to || '').replace(/[\r\n]+/g, '');
    const safeSubject = String(subject || '').replace(/[\r\n]+/g, ' ');
    const safeAttachmentName = String(attachmentName || 'attachment')
      .replace(/[\r\n"\\]/g, '_')
      .replace(/[^\x20-\x7E]/g, '_')
      .slice(0, 180) || 'attachment';
    const safeAttachmentType = /^[a-z\d.+-]+\/[a-z\d.+-]+$/i.test(attachmentType)
      ? attachmentType
      : 'application/octet-stream';
    const mixedBoundary = `jeff-va-${uid()}`;
    const altBoundary = `jeff-va-alt-${uid()}`;
    const htmlBody = htmlEmailBodyFromText(body);
    if (!attachmentBase64) {
      return [
        `To: ${safeRecipient}`,
        `Subject: ${safeSubject}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
        '',
        `--${altBoundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        '',
        body,
        `--${altBoundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        '',
        htmlBody,
        `--${altBoundary}--`
      ].join('\r\n');
    }

    return [
      `To: ${safeRecipient}`,
      `Subject: ${safeSubject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
      '',
      `--${mixedBoundary}`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      `--${altBoundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      body,
      `--${altBoundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      '',
      htmlBody,
      `--${altBoundary}--`,
      `--${mixedBoundary}`,
      `Content-Type: ${safeAttachmentType}; name="${safeAttachmentName}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${safeAttachmentName}"`,
      '',
      attachmentBase64,
      `--${mixedBoundary}--`
    ].join('\r\n');
  }

  async function sendDocumentTemplateTestEmail(templateType = 'contract-signing') {
    const template = DOCUMENT_TEMPLATE_DEFINITIONS[templateType] || DOCUMENT_TEMPLATE_DEFINITIONS['contract-signing'];
    const rendered = buildDocumentEmailTemplate(templateType, {
      clientName: 'Acme Studio',
      contact: 'Jordan Lee',
      role: 'Social Media Management Services'
    }, {
      duration: '3 months',
      invoiceNumber: 'INV-2026-104',
      billingPeriod: 'September 2026',
      issueDate: '2026-09-24',
      dueDate: '2026-10-08'
    });
    const recipient = 'almocerajeffreys@gmail.com';
    const rawMessage = buildRawEmailMessage({
      to: recipient,
      subject: rendered.subject,
      body: rendered.body
    });

    try {
      await sendGmailRaw(rawMessage);
      showEmailActionResult({ title: 'Test email sent successfully', message: `The template test was sent to ${recipient}.` });
    } catch (error) {
      console.error('Template test failed:', error);
      showEmailActionResult({ title: 'Test email could not be sent', message: `Could not send the ${template.name} test email. Check Gmail access.`, status: 'error' });
    }
  }

  function getDocumentTemplateCatalog() {
    return Object.entries(DOCUMENT_TEMPLATE_DEFINITIONS).map(([templateId, template]) => ({ id: templateId, ...template }));
  }

  function buildDocumentEmailTemplate(templateType, application = {}, additional = {}) {
    const template = DOCUMENT_TEMPLATE_DEFINITIONS[templateType] || DOCUMENT_TEMPLATE_DEFINITIONS['contract-signing'];
    const clientName = application.clientName || 'Client';
    const contactName = application.contact || clientName;
    const contactPerson = application.contact || 'Client';
    const roleName = application.role || 'your project';
    const duration = additional.duration || contractDuration(application) || 'the project period';
    const invoiceNumber = additional.invoiceNumber || 'INV-000';
    const billingPeriod = additional.billingPeriod || 'this period';
    const issueDate = additional.issueDate || new Date().toISOString().slice(0, 10);
    const dueDate = additional.dueDate || new Date().toISOString().slice(0, 10);
    const subject = (additional.subject || template.subject)
      .replace(/{{clientName}}/g, clientName)
      .replace(/{{contact}}/g, contactName)
      .replace(/{{contactPerson}}/g, contactPerson)
      .replace(/{{role}}/g, roleName)
      .replace(/{{duration}}/g, duration)
      .replace(/{{invoiceNumber}}/g, invoiceNumber)
      .replace(/{{billingPeriod}}/g, billingPeriod)
      .replace(/{{issueDate}}/g, issueDate)
      .replace(/{{dueDate}}/g, dueDate);
    const body = (additional.body || template.body)
      .replace(/{{clientName}}/g, clientName)
      .replace(/{{contact}}/g, contactName)
      .replace(/{{contactPerson}}/g, contactPerson)
      .replace(/{{role}}/g, roleName)
      .replace(/{{duration}}/g, duration)
      .replace(/{{invoiceNumber}}/g, invoiceNumber)
      .replace(/{{billingPeriod}}/g, billingPeriod)
      .replace(/{{issueDate}}/g, issueDate)
      .replace(/{{dueDate}}/g, dueDate);
    return { subject, body };
  }

  function renderEmailTemplateOptions(selectedId = '') {
    const select = $('#emailTemplateSelect');
    const deleteButton = $('#deleteEmailTemplateButton');
    if (!select || !deleteButton) return;
    select.innerHTML = '<option value="">Start from scratch</option>' + (data.emailTemplates || []).map(template => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`).join('');
    select.value = selectedId;
    deleteButton.hidden = !selectedId;
  }

  function updateComposeAttachmentDisplay() {
    const fileName = composeAttachmentFile?.name || composeAttachment?.name || '';
    const label = $('#composeAttachmentName');
    const removeButton = $('#removeComposeAttachmentButton');
    if (label) label.textContent = fileName ? `Attachment: ${fileName}` : '';
    if (removeButton) removeButton.hidden = !fileName;
  }

  function setEmailComposeStatus(message, type = 'info') {
    const status = $('#emailComposeStatus');
    if (!status) return;
    const classType = type === 'error' ? 'alert' : type;
    status.textContent = message;
    status.className = `compose-status status-${classType}`;
  }

  function openEmailComposer(emailId) {
    const emailItem = data.emails.find(item => item.id === emailId);
    if (!emailItem) return;
    const matches = matchApplicationsForEmail(emailItem);
    const matchedClient = matches[0];
    const recipient = isEmailAddress(matchedClient?.email) ? matchedClient.email : extractEmailAddress(emailItem.from);
    composeClientId = null;
    composeActivationClientId = null;
    composeAttachment = null;
    composeAttachmentFile = null;
    composeInvoiceDraft = null;
    composeDocumentUpdateClientId = null;
    composeContractEmailMode = false;
    composeRequiresConfirmation = false;
    $('#composeAttachmentInput').value = '';
    $('#composeTo').value = recipient;
    $('#composeSubject').value = emailItem.subject?.toLowerCase().startsWith('re:') ? emailItem.subject : `Re: ${emailItem.subject || ''}`.trim();
    $('#composeBody').value = '';
    $('#emailTemplateName').value = '';
    setEmailComposeStatus(gmailAccessToken ? 'Ready to send through Gmail.' : 'Gmail will connect automatically when you send.');
    updateComposeAttachmentDisplay();
    renderEmailTemplateOptions();
    $('#emailComposeModal').showModal();
    $('#composeBody').focus();
  }

  function openClientEmailComposer(application) {
    if (!application?.email) {
      toast('Add a client email before sending a message.');
      return;
    }
    $('#composeTo').value = application.email;
    composeClientId = application.id;
    composeActivationClientId = application.activePendingEmail ? application.id : null;
    composeAttachmentFile = null;
    composeInvoiceDraft = null;
    composeDocumentUpdateClientId = null;
    composeContractEmailMode = false;
    composeRequiresConfirmation = false;
    $('#composeAttachmentInput').value = '';
    const document = application.documents?.[application.documents.length - 1];
    composeAttachment = document || null;
    const template = buildDocumentEmailTemplate('contract-signing', application);
    $('#composeSubject').value = template.subject;
    $('#composeBody').value = template.body;
    $('#emailTemplateName').value = '';
    setEmailComposeStatus(gmailAccessToken
      ? `Review the details, then send through Gmail. Attachment: ${document?.name || 'none'}`
      : 'Gmail will connect automatically when you send.');
    updateComposeAttachmentDisplay();
    renderEmailTemplateOptions();
    $('#emailComposeModal').showModal();
    $('#composeBody').focus();
  }

  function openPlainClientEmailComposer(application, preferDrawer = false, sidePanel = false) {
    if (!application?.email) {
      toast('Add a client email before sending a message.');
      return;
    }
    composeClientId = application.id;
    composeActivationClientId = null;
    composeAttachment = null;
    composeAttachmentFile = null;
    composeInvoiceDraft = null;
    composeDocumentUpdateClientId = null;
    composeContractEmailMode = false;
    composeRequiresConfirmation = false;
    $('#composeAttachmentInput').value = '';
    $('#composeTo').value = application.email;
    $('#composeSubject').value = '';
    $('#composeBody').value = '';
    $('#emailTemplateName').value = '';
    setEmailComposeStatus(gmailAccessToken
      ? 'Ready to send through Gmail.'
      : 'Gmail will connect automatically when you send.');
    updateComposeAttachmentDisplay();
    renderEmailTemplateOptions();
    $('#emailComposeModal').classList.toggle('email-compose-side-panel', sidePanel);
    if (preferDrawer || isActiveClientDrawerOpen()) {
      showActiveClientDrawerView('email');
      markActiveClientDrawerFormClean('email');
    } else {
      $('#emailComposeModal').showModal();
    }
    $('#composeSubject').focus();
  }

  function openProceedEmailComposer(application) {
    if (!application?.email) {
      toast('Add a client email before sending a message.');
      return;
    }
    if (!String(application.role || '').trim()) {
      toast('Add a role or service before sending the proceed email.');
      return;
    }
    composeClientId = application.id;
    composeActivationClientId = null;
    composeAttachment = null;
    composeAttachmentFile = null;
    composeInvoiceDraft = null;
    composeDocumentUpdateClientId = null;
    composeContractEmailMode = false;
    composeRequiresConfirmation = true;
    $('#composeAttachmentInput').value = '';
    const template = buildDocumentEmailTemplate('proceed-application', application);
    $('#composeTo').value = application.email;
    $('#composeSubject').value = template.subject;
    $('#composeBody').value = template.body;
    $('#emailTemplateName').value = '';
    setEmailComposeStatus(gmailAccessToken
      ? 'Review the application email before sending through Gmail. You can attach a resume or CV if needed.'
      : 'Review the application email. Gmail will connect when you send. You can attach a resume or CV if needed.');
    updateComposeAttachmentDisplay();
    renderEmailTemplateOptions();
    $('#emailComposeModal').showModal();
    $('#composeBody').focus();
  }

  function openInvoiceComposer(application, file, invoice) {
    composeClientId = null;
    composeActivationClientId = null;
    composeDocumentUpdateClientId = null;
    composeContractEmailMode = false;
    composeRequiresConfirmation = false;
    composeAttachment = null;
    composeAttachmentFile = file;
    $('#composeAttachmentInput').value = '';
    composeInvoiceDraft = { ...invoice, clientId: application.id, fileName: file.name };
    const template = buildDocumentEmailTemplate('invoice', application, {
      invoiceNumber: invoice.invoiceNumber,
      billingPeriod: invoice.billingPeriod,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      role: invoice.service || application.role || 'services'
    });
    $('#composeTo').value = application.email;
    $('#composeSubject').value = template.subject;
    $('#composeBody').value = template.body;
    $('#emailTemplateName').value = '';
    setEmailComposeStatus(`Review the invoice email, then send through Gmail. Attachment: ${file.name}`);
    renderEmailTemplateOptions();
    $('#emailComposeModal').showModal();
    $('#composeBody').focus();
  }

  function openUpdatedDocumentEmailComposer(application, documentId = null) {
    const document = application?.documents?.find(item => item.id === documentId) || application?.documents?.[application.documents.length - 1];
    if (!application || !document) return;
    composeClientId = null;
    composeActivationClientId = null;
    composeInvoiceDraft = null;
    composeDocumentUpdateClientId = application.id;
    composeContractEmailMode = false;
    composeAttachment = document;
    composeAttachmentFile = null;
    composeRequiresConfirmation = false;
    $('#composeAttachmentInput').value = '';
    const template = buildDocumentEmailTemplate('updated-contract', application);
    $('#composeTo').value = application.email || '';
    $('#composeSubject').value = template.subject;
    $('#composeBody').value = template.body;
    $('#emailTemplateName').value = '';
    const status = `Review the updated document email, then send through Gmail. Attachment: ${document.name}`;
    setEmailComposeStatus(gmailAccessToken ? status : `${status} Gmail will connect automatically when you send.`);
    updateComposeAttachmentDisplay();
    renderEmailTemplateOptions();
    $('#emailComposeModal').showModal();
    $('#composeBody').focus();
  }

  function openContractEmailComposer(application, file) {
    if (!application?.email || !file) return;
    composeClientId = null;
    composeActivationClientId = null;
    composeInvoiceDraft = null;
    composeDocumentUpdateClientId = application.id;
    composeAttachment = null;
    composeAttachmentFile = file;
    composeContractEmailMode = true;
    composeRequiresConfirmation = false;
    $('#composeAttachmentInput').value = '';
    const template = buildDocumentEmailTemplate('updated-contract', application);
    $('#composeTo').value = application.email;
    $('#composeSubject').value = template.subject;
    $('#composeBody').value = template.body;
    $('#emailTemplateName').value = '';
    const status = `Review the updated document email, then send through Gmail. Attachment: ${file.name}`;
    setEmailComposeStatus(gmailAccessToken ? status : `${status} Gmail will connect automatically when you send.`);
    updateComposeAttachmentDisplay();
    renderEmailTemplateOptions();
    $('#emailComposeModal').showModal();
    $('#composeBody').focus();
  }

  function openEmailDetail(emailId) {
    const emailItem = data.emails.find(item => item.id === emailId);
    if (!emailItem) return;
    if ($('#applicationEmailsModal').open) $('#applicationEmailsModal').close();
    if ($('#clientModal').open) $('#clientModal').close();
    const isSent = isSentEmail(emailItem);
    const recipient = isSent ? emailItem.to : extractEmailAddress(emailItem.from);
    $('#emailDetailEyebrow').textContent = isSent ? 'SENT EMAIL' : 'EMAIL DETAILS';
    $('#emailDetailTitle').textContent = emailItem.subject || '(No subject)';
    $('#emailDetailFrom').textContent = isSent ? 'You' : (emailItem.from || 'Unknown sender');
    $('#emailDetailTo').textContent = recipient || 'Not available';
    $('#emailDetailDateLabel').textContent = isSent ? 'Sent' : 'Received';
    $('#emailDetailDate').textContent = emailDate(emailItem.date);
    $('#emailDetailBody').textContent = `${emailContentText(emailItem.body) || 'This inbox sync stores message headers only. Open the message in Gmail to read its full content.'}${emailItem.attachmentName ? `\n\nAttachment: ${emailItem.attachmentName}` : ''}`;
    $('#emailDetailStatus').textContent = isSent ? 'This message was sent from Jeff VA.' : 'Reply from this client directly through Gmail.';
    const applicationAnalysis = isSent ? null : emailItem.applicationAiAnalysis;
    const analysis = isSent ? null : applicationAnalysis || emailItem.taskAiAnalysis;
    const assessmentMatches = !isSent && !analysis && typeof applicationAiSkipReason === 'function'
      ? matchApplicationsForEmail(emailItem) : null;
    const pendingApplication = assessmentMatches?.find(app => APPLICATION_AI_PENDING_STATUSES.includes(app.status));
    const pendingAssessment = pendingApplication
      ? `AI application check: ${applicationAiSkipReason(emailItem, pendingApplication, data.emails)
        || (emailAiRetryState()?.until > Date.now() ? emailAiRetryState().message : 'Matched and waiting for AI analysis during Gmail sync.')}`
      : assessmentMatches?.length === 0 ? 'AI check: no saved application or active client is matched to this email.' : '';
    const outcomeApplication = applicationAnalysis && data.applications.find(app => app.id === applicationAnalysis.applicationId
      || app.emailClosure?.emailRecordId === emailItem.id);
    const outcomeSaved = outcomeApplication?.status === 'Not selected'
      && outcomeApplication.emailClosure?.emailId === (emailItem.gmailId || emailItem.id);
    const outcomeBlockedReason = outcomeApplication && !outcomeSaved && typeof applicationAiSkipReason === 'function'
      ? applicationAiSkipReason(emailItem, outcomeApplication, data.emails)
        || (outcomeApplication.emailClosure?.emailId === (emailItem.gmailId || emailItem.id) ? 'Your later manual stage change is retained.' : '') : '';
    const analysisStatus = $('#emailDetailAiStatus');
    analysisStatus.hidden = !analysis && !pendingAssessment;
    analysisStatus.textContent = applicationAnalysis
      ? `AI application assessment: ${applicationAnalysis.outcome === 'uncertain' ? 'Outcome unclear; status unchanged' : applicationAnalysis.rejectApplication
        ? outcomeSaved ? 'Automatically marked Rejected' : outcomeBlockedReason ? `Closure confirmed; status unchanged: ${outcomeBlockedReason}` : 'Closure confirmed; automatic status update pending'
        : 'No rejection confirmed'} — ${applicationAnalysis.reason}${applicationAnalysis.evidence ? ` · From the email: “${applicationAnalysis.evidence}”` : ''}`
      : analysis ? `AI: ${analysis.purpose === 'work_task' && analysis.createTask ? 'Job-related work request' : analysis.purpose === 'uncertain' ? 'Needs your review' : analysis.purpose} — ${analysis.reason}` : pendingAssessment;
    const composeButton = $('#emailDetailComposeButton');
    composeButton.hidden = isSent || !isEmailAddress(recipient);
    composeButton.dataset.composeEmail = emailItem.id;
    $('#emailDetailModal').showModal();
  }

  function applyEmailTemplate(templateId) {
    const template = (data.emailTemplates || []).find(item => item.id === templateId);
    $('#deleteEmailTemplateButton').hidden = !template;
    if (!template) return;
    $('#composeSubject').value = template.subject;
    $('#composeBody').value = template.body;
  }

  function saveEmailTemplate() {
    const name = $('#emailTemplateName').value.trim();
    const subject = $('#composeSubject').value.trim();
    const body = $('#composeBody').value.trim();
    if (!name || !subject || !body) {
      setEmailComposeStatus('Add a template name, subject, and message first.', 'error');
      return;
    }
    data.emailTemplates = data.emailTemplates || [];
    const existing = data.emailTemplates.find(template => template.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.subject = subject;
      existing.body = body;
      renderEmailTemplateOptions(existing.id);
    } else {
      const template = { id: uid(), name, subject, body };
      data.emailTemplates.push(template);
      renderEmailTemplateOptions(template.id);
    }
    persist();
    $('#emailTemplateName').value = '';
    setEmailComposeStatus('Template saved.', 'success');
  }

  async function deleteEmailTemplate() {
    const templateId = $('#emailTemplateSelect').value;
    if (!templateId || !(await appConfirm('Delete this email template?', { title: 'Delete email template', confirmLabel: 'Delete', danger: true }))) return;
    data.emailTemplates = (data.emailTemplates || []).filter(template => template.id !== templateId);
    persist();
    renderEmailTemplateOptions();
    setEmailComposeStatus('Template deleted.', 'success');
  }

  function encodeBase64Url(value) {
    return encodeBase64UrlBytes(new TextEncoder().encode(value));
  }

  function encodeBase64UrlBytes(bytes) {
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function encodeBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  }

  function wrapBase64(value) {
    return value.match(/.{1,76}/g)?.join('\r\n') || '';
  }

  function decodeGmailBody(value) {
    if (!value) return '';
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function emailContentText(value = '') {
    if (!value) return '';
    if (!/<[a-z][\s\S]*>/i.test(value)) return value.trim();
    const parsed = new DOMParser().parseFromString(value, 'text/html');
    parsed.querySelectorAll('script, style, noscript, template, comment').forEach(node => node.remove());
    parsed.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
    parsed.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6').forEach(node => {
      node.before('\n');
      node.after('\n');
    });
    return (parsed.body?.textContent || '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function collectGmailMessageBodies(payload, bodies) {
    if (!payload) return;
    if (payload.body?.data) {
      const content = emailContentText(decodeGmailBody(payload.body.data));
      if (content) {
        if (payload.mimeType === 'text/html') bodies.html.push(content);
        else if (!payload.mimeType || payload.mimeType.startsWith('text/')) bodies.plain.push(content);
      }
    }
    for (const part of payload.parts || []) collectGmailMessageBodies(part, bodies);
  }

  function gmailMessageBody(payload) {
    const bodies = { plain: [], html: [] };
    collectGmailMessageBodies(payload, bodies);
    const plainBody = bodies.plain.join('\n\n').trim();
    const htmlBody = bodies.html.join('\n\n').trim();
    return plainBody || htmlBody;
  }

  function requestGmailAccessToken(prompt = '') {
    if (!window.google?.accounts?.oauth2 || !gmailConfigured()) return Promise.reject(new Error('Gmail is not configured.'));
    if (gmailTokenRequest) return gmailTokenRequest;
    gmailTokenRequest = new Promise((resolve, reject) => {
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: window.GMAIL_CLIENT_ID,
        scope: GMAIL_SCOPE,
        callback: response => {
          if (response.error || !response.access_token) {
            reject(new Error(response.error_description || response.error || 'Gmail authorization was not completed.'));
            return;
          }
          gmailAccessToken = response.access_token;
          saveGmailCredentials(currentUser?.id, response.access_token, '', response.expires_in);
          sessionStorage.setItem(GMAIL_TOKEN_SESSION_KEY, response.access_token);
          sessionStorage.setItem(GMAIL_CONNECTED_KEY, '1');
          sessionStorage.removeItem(GMAIL_RECONNECT_REQUIRED_KEY);
          gmailReconnectRequired = false;
          updateGmailConnectionUI(true);
          updateLoginGoogleUI(true, 'Google account connected for this browser session.');
          resolve(response.access_token);
        },
        error_callback: error => reject(new Error(error.message || 'Google authorization was closed or blocked.'))
      });
      tokenClient.requestAccessToken({ prompt });
    }).finally(() => { gmailTokenRequest = null; });
    return gmailTokenRequest;
  }

  async function ensureGmailAccessToken() {
    const saved = readGmailCredentials();
    if (gmailAccessToken && !gmailReconnectRequired && (!saved || saved.expiresAt > Date.now() + 60000)) return gmailAccessToken;
    if (saved?.refreshToken) return refreshGmailAuthorization();
    try {
      return await requestGmailAccessToken('');
    } catch {
      return requestGmailAccessToken('consent');
    }
  }

  async function requestFollowUpReservation(item, scheduledDate, action, receipt = {}) {
    const userId = currentUser?.id;
    if (!userId) throw new Error('Sign in before sending follow-ups.');
    const auth = requireSupabase().auth;
    let current = await auth.getSession();
    let session = current.data?.session;
    if (current.error || !session?.access_token || session.expires_at <= Date.now() / 1000 + 60) {
      current = await auth.refreshSession();
      session = current.data?.session;
    }
    if (current.error || !session?.access_token || currentUser?.id !== userId || (session.user?.id && session.user.id !== userId)) {
      throw new Error('Could not verify your session. No new follow-up was sent.');
    }
    const response = await fetch('/api/follow-up/delivery', {
      method: 'POST', headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ applicationId: item.id, scheduledDate, action, ...receipt }), signal: AbortSignal.timeout(15000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Send protection is unavailable. Automatic sending is paused.');
    return result;
  }

  async function findGmailSentFollowUp(item, scheduledDate, subject) {
    const after = Math.floor(new Date(`${scheduledDate}T00:00:00+08:00`).getTime() / 1000);
    const recipient = extractEmailAddress(item.email);
    const root = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
    const q = `in:sent to:${recipient} after:${after} subject:"${subject.replace(/["\\]/g, ' ')}"`;
    const list = await fetchGmailJson(`${root}?${new URLSearchParams({ q, maxResults: '100' })}`);
    for (const message of list.messages || []) {
      const email = await fetchGmailJson(`${root}/${encodeURIComponent(message.id)}?format=metadata&metadataHeaders=To&metadataHeaders=Subject`);
      const header = name => email.payload?.headers?.find(value => value.name.toLowerCase() === name)?.value || '';
      const sentAt = Number(email.internalDate);
      if (extractEmailAddress(header('to')) === recipient && header('subject').trim() === subject
        && Number.isFinite(sentAt) && sentAt >= after * 1000) {
        return { sentAt: new Date(sentAt).toISOString(), gmailId: email.id, recovered: true };
      }
    }
    if (list.nextPageToken) throw new Error('Sent history needs review. Automatic sending is paused to avoid duplicates.');
    return null;
  }

  async function sendAutomaticFollowUpOnce(item, scheduledDate, subject, body) {
    const userId = currentUser?.id;
    await ensureGmailAccessToken();
    // Read Gmail directly before claiming; do not depend on an old tab's cache.
    const existing = await findGmailSentFollowUp(item, scheduledDate, subject);
    if (currentUser?.id !== userId) throw new Error('Account changed. No follow-up was sent.');
    if (existing) return existing;
    const claim = await requestFollowUpReservation(item, scheduledDate, 'claim');
    if (claim.status === 'sent') return claim;
    if (claim.status !== 'claimed' || !claim.claimToken) throw new Error(claim.error || 'This follow-up is already sending. Check Gmail Sent; automatic resending is blocked.');
    if (currentUser?.id !== userId) throw new Error('Account changed. Automatic sending was paused.');
    let gmail;
    try { gmail = await sendGmailRaw(buildRawEmailMessage({ to: item.email, subject, body }), { timeoutMs: 15000 }); }
    catch (error) {
      if (error.gmailRejected && currentUser?.id === userId) {
        await requestFollowUpReservation(item, scheduledDate, 'release', { claimToken: claim.claimToken }).catch(() => {});
      }
      throw new Error(error.gmailRejected ? 'Gmail rejected the follow-up. It can retry later.' : 'Delivery is uncertain. Check Gmail Sent; automatic resending is blocked.');
    }
    const delivery = { sentAt: new Date().toISOString(), gmailId: gmail?.id || '' };
    if (currentUser?.id !== userId) throw new Error('Account changed. Check Gmail Sent to confirm delivery.');
    // A failed receipt save leaves the durable reservation locked, never open
    // for another send. Gmail history can recover this delivery on the next run.
    await requestFollowUpReservation(item, scheduledDate, 'complete', { claimToken: claim.claimToken, ...delivery }).catch(error => {
      console.error('Follow-up sent; shared receipt save pending:', error);
    });
    return delivery;
  }

  async function sendGmailRaw(rawMessage, { timeoutMs = 0 } = {}) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await ensureGmailAccessToken();
      const response = await fetch(GMAIL_SEND_ENDPOINT, {
        method: 'POST',
        ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
        headers: { Authorization: `Bearer ${gmailAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: encodeBase64Url(rawMessage) })
      });
      if (response.ok) return response.json();
      if (response.status === 401 && attempt === 0) {
        await refreshGmailAuthorization();
        continue;
      }
      if (response.status === 401) handleGmailAuthorizationFailure();
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(errorData.error?.message || `Gmail returned ${response.status}`);
      error.gmailRejected = [400, 401, 403, 404, 429].includes(response.status);
      throw error;
    }
    throw new Error('Gmail could not send the message.');
  }

  async function sendComposedEmail() {
    const to = $('#composeTo').value.trim();
    const subject = $('#composeSubject').value.trim().replace(/[\r\n]+/g, ' ');
    const body = $('#composeBody').value.trim();
    const contractEmailMode = composeContractEmailMode;
    const contractEmailApplication = contractEmailMode
      ? data.applications.find(item => item.id === composeDocumentUpdateClientId)
      : null;
    const contractEmailFile = contractEmailMode ? composeAttachmentFile : null;
    const attachment = composeAttachment;
    const attachmentFile = composeAttachmentFile;
    if (!to || !subject || !body || !isEmailAddress(to)) {
      setEmailComposeStatus('Enter a valid recipient, subject, and message.', 'error');
      return;
    }
    if (contractEmailMode && !contractEmailFile) {
      setEmailComposeStatus('Attach the contract file before sending.', 'error');
      return;
    }
    if (composeDocumentUpdateClientId) {
      if (contractEmailMode && contractEmailSendPending) return;
      if (contractEmailMode) contractEmailSendPending = true;
      const confirmation = contractEmailMode
        ? await appConfirm(`Send this contract to ${to}?`, { title: 'Send contract', confirmLabel: 'Send' })
        : await appConfirm('Send the updated document to this client now?', { title: 'Send updated document', confirmLabel: 'Send' });
      if (!confirmation) {
        contractEmailSendPending = false;
        return;
      }
    }
    if (composeRequiresConfirmation && !(await appConfirm(`Send this application email to ${to}?`, { title: 'Confirm email', confirmLabel: 'Send' }))) return;
    const sendButton = $('#sendEmailButton');
    setButtonLoading(sendButton, true);
    setEmailComposeStatus('Sending through Gmail...');
    let gmailAccepted = false;
    try {
      let rawMessage;
      if (attachment || attachmentFile) {
        const attachmentBlob = attachmentFile || await getDocumentBlob(attachment.storagePath || attachment.id);
        const attachmentBytes = new Uint8Array(await attachmentBlob.arrayBuffer());
        const attachmentName = attachment?.name || attachmentFile?.name || 'attachment';
        const attachmentType = attachment?.type || attachmentBlob.type || 'application/octet-stream';
        const attachmentBase64 = wrapBase64(encodeBase64(attachmentBytes));
        rawMessage = buildRawEmailMessage({
          to,
          subject,
          body,
          attachmentName,
          attachmentType,
          attachmentBase64
        });
      } else {
        rawMessage = buildRawEmailMessage({ to, subject, body });
      }
      const gmailMessage = await sendGmailRaw(rawMessage);
      gmailAccepted = true;
      const gmailId = gmailMessage?.id || '';
      const sentEmailRecord = {
        id: gmailId ? `gmail-${gmailId}` : uid(),
        gmailId,
        applicationId: contractEmailMode
          ? contractEmailApplication?.id || ''
          : composeClientId || composeActivationClientId || composeDocumentUpdateClientId || '',
        from: 'You',
        to,
        subject,
        body,
        date: new Date().toISOString(),
        importedAt: new Date().toISOString(),
        source: gmailId ? 'gmail' : 'sent',
        direction: 'sent',
        attachmentName: attachment?.name || attachmentFile?.name || ''
      };
      data.emails.unshift(sentEmailRecord);
      if (composeInvoiceDraft) {
        data.invoices = data.invoices || [];
        data.invoices.unshift({ id: uid(), ...composeInvoiceDraft, sentAt: new Date().toISOString() });
      }
      const activationCandidate = composeActivationClientId && data.applications.find(item => item.id === composeActivationClientId);
      const activatingClient = activationCandidate?.activePendingEmail
        && composeClientId === activationCandidate.id
        && activationCandidate.email?.trim().toLowerCase() === to.toLowerCase()
        ? activationCandidate
        : null;
      const updatingClient = contractEmailMode
        ? contractEmailApplication
        : composeDocumentUpdateClientId && data.applications.find(item => item.id === composeDocumentUpdateClientId);
      if (activatingClient?.activePendingEmail) {
        activatingClient.activePendingEmail = false;
        activatingClient.updatedAt = new Date().toISOString();
        clearActivationRollback();
      }
      if (updatingClient?.documentEmailPending && !contractEmailMode) {
        updatingClient.documentEmailPending = false;
        updatingClient.documentEmailReminderDate = '';
        updatingClient.documentEmailReminderAlertedDate = '';
        updatingClient.updatedAt = new Date().toISOString();
      }
      if (contractEmailMode) await saveSentContractFile(contractEmailApplication, contractEmailFile);
      const savePromise = persist();
      let successMessage = 'Email sent successfully through Gmail.';
      if (contractEmailMode) {
        successMessage = 'Contract email sent successfully.';
      } else if (activatingClient) {
        successMessage = 'Email sent successfully. Client moved to Active Clients.';
      } else if (updatingClient) {
        successMessage = 'Updated document email sent successfully.';
      }
      if (composeInvoiceDraft) successMessage = 'Invoice sent successfully and added to this client\'s history.';
      savePromise.catch(error => {
        console.error('Gmail accepted the email, but the app could not save its history:', error);
      });
      renderAll();
      if ($('#clientModal').open && sentEmailRecord.applicationId === editingId) {
        const application = data.applications.find(item => item.id === editingId);
        if (application) renderClientEmailHistory(application);
      }
      if (isActiveClientDrawerOpen()) closeActiveClientActionsDrawer(true);
      else $('#emailComposeModal').close();
      if (activatingClient) {
        showView('hired');
        renderHiredDetail(activatingClient);
      }
      showEmailActionResult({ title: 'Email sent successfully', message: successMessage });
      composeAttachmentFile = null;
      composeInvoiceDraft = null;
      composeClientId = null;
      composeActivationClientId = null;
      composeDocumentUpdateClientId = null;
      composeContractEmailMode = false;
      composeRequiresConfirmation = false;
    } catch (error) {
      console.error(error);
      if (gmailAccepted) {
        if (isActiveClientDrawerOpen()) closeActiveClientActionsDrawer(true);
        else $('#emailComposeModal').close();
        showEmailActionResult({
          title: 'Email sent, but history could not update',
          message: 'Gmail accepted the message. Reload the app to refresh the email and invoice history.',
          status: 'error'
        });
      } else {
        const failureMessage = `${error.message} Google authorization may be required.`;
        setEmailComposeStatus(failureMessage, 'error');
        showEmailActionResult({ title: 'Email could not be sent', message: failureMessage, status: 'error' });
      }
    } finally {
      if (gmailAccepted) {
        composeAttachmentFile = null;
        composeInvoiceDraft = null;
        composeClientId = null;
        composeActivationClientId = null;
        composeDocumentUpdateClientId = null;
        composeContractEmailMode = false;
        composeRequiresConfirmation = false;
      }
      contractEmailSendPending = false;
      setButtonLoading(sendButton, false);
    }
  }

  function gmailConfigured() {
    const clientId = window.GMAIL_CLIENT_ID;
    return Boolean(clientId && !clientId.includes('YOUR_CLIENT_ID'));
  }

  function updateGmailConnectionUI(connected) {
    const reconnectButton = $('#gmailReconnectButton');
    if (reconnectButton) {
      reconnectButton.hidden = connected || !currentUser || !gmailConfigured();
      reconnectButton.textContent = gmailReconnectRequired ? 'Reconnect Gmail' : 'Connect Gmail';
    }
  }

  function updateLoginGoogleUI(connected, message) {
    const button = $('#loginGoogleButton');
    const status = $('#loginGoogleStatus');
    if (button) {
      button.textContent = connected ? 'Google account connected' : 'Log in with Google';
      button.classList.toggle('button-secondary', !connected);
      button.classList.toggle('button-success', connected);
    }
    if (status && message) status.textContent = message;
  }

  let gmailSyncDisplay = { userId: '', state: 'checking' };

  function setGmailSyncDisplay(state) {
    gmailSyncDisplay = { userId: currentUser?.id || '', state };
    renderGmailSyncStatus();
  }

  function gmailLastSyncKey() {
    return `jeff-va-gmail-last-sync-v1:${currentUser?.id || ''}`;
  }

  function recordGmailSyncSuccess() {
    try { localStorage.setItem(gmailLastSyncKey(), new Date().toISOString()); } catch (_) { /* Status storage may be unavailable. */ }
    setGmailSyncDisplay('synced');
  }

  function renderGmailSyncStatus() {
    const summary = $('#gmailSyncSummary');
    if (!summary) return;
    summary.hidden = !currentUser;
    if (!currentUser) return;
    const connected = Boolean(gmailAccessToken || readGmailCredentials()?.refreshToken) && !gmailReconnectRequired;
    const state = navigator.onLine === false ? 'offline' : !connected ? 'permission'
      : gmailSyncDisplay.userId === currentUser.id ? gmailSyncDisplay.state : 'checking';
    const labels = { checking: 'Checking Gmail connection', syncing: 'Syncing Gmail…', renewing: 'Renewing Gmail connection…',
      synced: 'Gmail synced', partial: 'Some messages could not load · retrying automatically',
      paused: 'Gmail sync interrupted · retrying automatically', offline: 'Offline · showing saved emails',
      permission: 'Gmail permission needed · showing saved emails' };
    let lastSync = '';
    try { lastSync = localStorage.getItem(gmailLastSyncKey()) || ''; } catch (_) { /* Keep the status usable. */ }
    const date = new Date(lastSync);
    const lastSyncLabel = lastSync && !Number.isNaN(date.getTime()) ? `Last synced ${date.toLocaleString()}` : 'No successful sync yet';
    const compactLabels = { checking: 'Gmail connecting', syncing: 'Gmail syncing…', renewing: 'Gmail reconnecting…',
      synced: 'Gmail synced', partial: 'Gmail sync incomplete', paused: 'Gmail retrying', offline: 'Gmail offline', permission: 'Gmail permission needed' };
    $('#gmailSyncStatusText').textContent = compactLabels[state] || compactLabels.checking;
    summary.title = `${labels[state] || labels.checking} · ${lastSyncLabel}`;
    const accountDetails = $('#accountGmailSyncDetails');
    if (accountDetails) accountDetails.textContent = summary.title;
    const accountConnection = $('#accountGmailStatus');
    if (accountConnection) accountConnection.textContent = ({ synced: 'Connected', syncing: 'Syncing',
      renewing: 'Reconnecting', checking: 'Checking connection', permission: 'Permission required',
      offline: 'Offline', partial: 'Sync incomplete', paused: 'Retrying connection' })[state] || 'Checking connection';
    const time = $('#gmailSyncTime');
    time.hidden = !lastSync || Number.isNaN(date.getTime());
    time.textContent = time.hidden ? '' : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
    time.dateTime = time.hidden ? '' : date.toISOString();
    time.title = lastSyncLabel;
    summary.dataset.state = state;
    const connectButton = $('#gmailSyncConnectButton');
    connectButton.hidden = state !== 'permission' || !gmailConfigured();
    connectButton.textContent = gmailReconnectRequired ? 'Reconnect Gmail' : 'Connect Gmail';
    connectButton.onclick = loginWithGoogle;
  }

  function setGmailStatus(message) {
    const status = $('#gmailStatus');
    if (status) status.textContent = message;
    const accountStatus = $('#accountGmailSyncStatus');
    if (accountStatus) accountStatus.textContent = message;
    renderAccountPage();
    renderGmailSyncStatus();
  }

  function initGmail() {
    setGmailSyncDisplay('checking');
    gmailReconnectRequired = sessionStorage.getItem(GMAIL_RECONNECT_REQUIRED_KEY) === '1';
    updateGmailConnectionUI(false);
    updateLoginGoogleUI(false, 'Use your Google account to open the dashboard.');
    const loginGoogleButton = $('#loginGoogleButton');
    loginGoogleButton.disabled = !supabaseConfigured();
    // Supabase sign-in and Worker token renewal do not need the popup SDK.
    // A blocked or slow Google script must not prevent restoring this inbox.
    if (!gmailConfigured()) {
      setGmailStatus('Gmail not set up yet — you can still log in with Google to open the dashboard.');
      loginGoogleButton.disabled = !supabaseConfigured();
      return;
    }
    $('#gmailReconnectButton').onclick = loginWithGoogle;
    loginGoogleButton.disabled = false;
    const saved = readGmailCredentials();
    if (saved) {
      gmailAccessToken = saved.token;
      gmailReconnectRequired = false;
      updateGmailConnectionUI(true);
      setGmailStatus('Gmail connected — checking for new messages…');
      startGmailSyncTimer();
      syncGmail(true);
    } else {
      setGmailStatus('Saved emails remain available. Connect Gmail to enable automatic updates.');
      updateGmailConnectionUI(false);
    }
  }

  async function loginWithGoogle() {
    if (!supabaseConfigured()) {
      $('#loginError').textContent = 'Sign-in is unavailable. Check the app configuration.';
      return;
    }
    const loginGoogleButton = $('#loginGoogleButton');
    setButtonLoading(loginGoogleButton, true);
    $('#loginGoogleStatus').textContent = 'Opening Google sign-in…';
    activeAuthProvider = 'google';
    sessionStorage.setItem(AUTH_PROVIDER_SESSION_KEY, activeAuthProvider);
    try {
      const { error } = await requireSupabase().auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/?auth_view=dashboard`,
          scopes: GMAIL_SCOPE,
          queryParams: { access_type: 'offline', prompt: 'consent' }
        }
      });
      if (error) throw error;
    } catch (error) {
      activeAuthProvider = null;
      sessionStorage.removeItem(AUTH_PROVIDER_SESSION_KEY);
      console.error(error);
      const providerDisabled = error?.error_code === 'validation_failed' && error?.msg?.includes('provider is not enabled');
      $('#loginError').textContent = providerDisabled
        ? 'Google sign-in is not enabled. Check the authentication provider settings, then try again.'
        : 'Google sign-in could not start. Check the authentication provider settings.';
      $('#loginGoogleStatus').textContent = 'Use your Google account to open the dashboard.';
      setButtonLoading(loginGoogleButton, false);
    }
  }

  function handleGmailAuthorizationFailure() {
    gmailAccessToken = null;
    sessionStorage.removeItem(GMAIL_TOKEN_SESSION_KEY);
    gmailReconnectRequired = true;
    setGmailSyncDisplay('permission');
    sessionStorage.setItem(GMAIL_RECONNECT_REQUIRED_KEY, '1');
    updateGmailConnectionUI(false);
    updateLoginGoogleUI(false, 'Gmail needs to reconnect. Your dashboard session is still active.');
    setGmailStatus('Saved emails remain available. Renew Google permission in Account settings to resume updates.');
  }

  function startGmailSyncTimer() {
    if (gmailSyncTimer) clearInterval(gmailSyncTimer);
    gmailSyncTimer = setInterval(() => {
      if (currentUser && (gmailAccessToken || readGmailCredentials()?.refreshToken) && !gmailReconnectRequired) syncGmail(true);
    }, 30000);
  }

  function scheduleGmailSync({ silent = true } = {}) {
    renderGmailSyncStatus();
    if (!currentUser || !(gmailAccessToken || readGmailCredentials()?.refreshToken) || gmailReconnectRequired || gmailSyncInFlight) return;
    if (gmailSyncTriggerTimer) clearTimeout(gmailSyncTriggerTimer);
    gmailSyncTriggerTimer = setTimeout(() => {
      gmailSyncTriggerTimer = null;
      syncGmail(silent);
    }, 200);
  }

  async function refreshGmailAuthorization() {
    if (gmailAuthorizationRecovery) return gmailAuthorizationRecovery;
    gmailAuthorizationRecovery = renewGmailAccess()
      .catch(error => {
        if (error.reconnect) handleGmailAuthorizationFailure(error);
        throw error;
      })
      .finally(() => { gmailAuthorizationRecovery = null; });
    return gmailAuthorizationRecovery;
  }

  async function fetchGmailJson(url) {
    const makeRequest = () => fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${gmailAccessToken}` }
    });
    const saved = readGmailCredentials();
    if (saved && saved.expiresAt <= Date.now() + 60000) await refreshGmailAuthorization();
    let response = await makeRequest();
    if (response.status === 401) {
      await refreshGmailAuthorization();
      response = await makeRequest();
    }
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(errorData.error?.message || `Gmail returned ${response.status}`);
      error.status = response.status;
      error.reason = errorData.error?.errors?.[0]?.reason || '';
      if (response.status === 401) handleGmailAuthorizationFailure(error);
      throw error;
    }
    return response.json();
  }

  async function syncGmail(silent = false) {
    // Do not let a restored Gmail session sync against the empty startup state.
    // The authenticated startup flow triggers the first sync after saved deletions load.
    if (gmailSyncInFlight || !currentUser || !dataReady || !supabaseDataLoaded) return;
    if (navigator.onLine === false) { setGmailSyncDisplay('offline'); return; }
    const syncUserId = currentUser.id;
    if (!gmailAccessToken || gmailReconnectRequired) {
      if (!readGmailCredentials()?.refreshToken || gmailReconnectRequired) return;
      try {
        setGmailSyncDisplay('renewing');
        await refreshGmailAuthorization();
      } catch (error) {
        if (!gmailReconnectRequired) setGmailSyncDisplay('paused');
        if (!gmailReconnectRequired) setGmailStatus(error.message);
        return;
      }
    }
    gmailSyncInFlight = true;
    setGmailSyncDisplay('syncing');
    if (!silent) setGmailStatus('Checking Gmail for new messages…');
    try {
      const fetchMessageList = async params => {
        return fetchGmailJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`);
      };
      const directClientEmailList = [...new Set(data.applications
        .filter(application => isDirectClientApplication(application) || isEmailTaskActiveClient(application))
        .map(application => String(application.email || '').trim().toLowerCase())
        .filter(isEmailAddress))].sort();
      const directClientEmails = new Set(directClientEmailList);
      const nextSentHistorySignature = directClientEmailList.join('|');
      if (nextSentHistorySignature !== sentHistoryAddressSignature) {
        sentHistoryAddressSignature = nextSentHistorySignature;
        sentHistoryPageToken = '';
        sentHistoryQueue = [];
        sentHistoryLoaded = directClientEmails.size === 0;
      }
      const inboxParams = new URLSearchParams({ maxResults: '30', labelIds: 'INBOX' });
      const historyParams = new URLSearchParams({ maxResults: '500', labelIds: 'INBOX' });
      const portfolioSubmissionParams = new URLSearchParams({
        maxResults: '30',
        q: 'from:submissions@formsubmit.co'
      });
      const recentSentParams = directClientEmails.size
        ? new URLSearchParams({ maxResults: '30', labelIds: 'SENT', q: `{${[...directClientEmails].map(email => `to:${email}`).join(' ')}}` })
        : null;
      const sentHistoryParams = directClientEmails.size && !sentHistoryLoaded && sentHistoryQueue.length < 30
        ? new URLSearchParams({ maxResults: '500', labelIds: 'SENT', q: `{${[...directClientEmails].map(email => `to:${email}`).join(' ')}}` })
        : null;
      if (inboxHistoryPageToken) historyParams.set('pageToken', inboxHistoryPageToken);
      if (sentHistoryPageToken && sentHistoryParams) sentHistoryParams.set('pageToken', sentHistoryPageToken);
      const [inboxList, historyList, portfolioSubmissionList, recentSentList, sentHistoryList] = await Promise.all([
        fetchMessageList(inboxParams),
        !inboxHistoryLoaded && inboxHistoryQueue.length < 30 ? fetchMessageList(historyParams) : Promise.resolve({ messages: [] }),
        fetchMessageList(portfolioSubmissionParams),
        recentSentParams ? fetchMessageList(recentSentParams) : Promise.resolve({ messages: [] }),
        sentHistoryParams ? fetchMessageList(sentHistoryParams) : Promise.resolve({ messages: [] })
      ]);
      const listedMessages = [...(inboxList.messages || []), ...(portfolioSubmissionList.messages || [])];
      if (!inboxHistoryLoaded && inboxHistoryQueue.length < 30) {
        const firstHistoryPage = !inboxHistoryPageToken;
        const historyMessages = historyList.messages || [];
        inboxHistoryQueue.push(...historyMessages.slice(firstHistoryPage ? 30 : 0).map(message => message.id));
        inboxHistoryPageToken = historyList.nextPageToken || '';
        inboxHistoryLoaded = !inboxHistoryPageToken;
      }
      listedMessages.push(...inboxHistoryQueue.slice(0, 30).map(id => ({ id })));
      if (directClientEmails.size) {
        listedMessages.push(...(recentSentList.messages || []));
        if (!sentHistoryLoaded && sentHistoryQueue.length < 30) {
          const firstHistoryPage = !sentHistoryPageToken;
          const sentHistoryMessages = sentHistoryList.messages || [];
          sentHistoryQueue.push(...sentHistoryMessages.slice(firstHistoryPage ? 30 : 0).map(message => message.id));
          sentHistoryPageToken = sentHistoryList.nextPageToken || '';
          sentHistoryLoaded = !sentHistoryPageToken;
        }
        listedMessages.push(...sentHistoryQueue.slice(0, 30).map(id => ({ id })));
      }
      const deletedGmailIds = new Set(data.deletedGmailIds || []);
      const ids = [...new Set(listedMessages.map(message => message.id))].filter(id => !deletedGmailIds.has(id));
      const previousGmailIds = new Set(data.emails.filter(item => item.source === 'gmail').map(item => item.gmailId));
      const newIds = ids.filter(id => !previousGmailIds.has(id));
      const newIdSet = new Set(newIds);
      const latestInboxMessageIds = new Set((inboxList.messages || []).map(message => message.id));
      const incompleteGmailIds = new Set(data.emails
        .filter(item => item.source === 'gmail'
          && item.gmailId
          && item.bodyLoaded !== true
          && !String(item.body || '').trim()
          && !deletedGmailIds.has(item.gmailId))
        .map(item => item.gmailId));
      const messageIdsToFetch = [...new Set([
        ...ids.filter(id => newIdSet.has(id) || incompleteGmailIds.has(id)),
        ...[...incompleteGmailIds].slice(0, 30)
      ])];
      let matchedExistingSentMessages = false;
      const fetchedResults = await Promise.allSettled(messageIdsToFetch.map(async id => {
        const msg = await fetchGmailJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`);
        if (currentUser?.id !== syncUserId) return null;
        const headers = msg.payload?.headers || [];
        const header = name => headers.find(item => item.name === name)?.value || '';
        const rawDate = header('Date');
        const date = rawDate && !Number.isNaN(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : new Date().toISOString();
        const to = header('To');
        const isSent = isSentEmail({ from: header('From'), labelIds: msg.labelIds || [] });
        const recipient = extractEmailAddress(to);
        if (isSent && !directClientEmails.has(recipient)) return null;
        const subject = header('Subject') || '(No subject)';
        const body = gmailMessageBody(msg.payload);
        if (isSent) {
          const existingSentMessage = data.emails.find(email => email.direction === 'sent'
            && !email.gmailId
            && extractEmailAddress(email.to) === recipient
            && String(email.subject || '').trim() === subject.trim()
            && String(email.body || '').trim() === body.trim());
          if (existingSentMessage) {
            existingSentMessage.id = `gmail-${id}`;
            existingSentMessage.gmailId = id;
            existingSentMessage.source = 'gmail';
            existingSentMessage.bodyLoaded = true;
            matchedExistingSentMessages = true;
            return null;
          }
        }
        const previousEmail = data.emails.find(email => email.gmailId === id);
        const newInboxEmail = !isSent && newIdSet.has(id) && latestInboxMessageIds.has(id);
        return {
          ...previousEmail,
          id: `gmail-${id}`,
          gmailId: id,
          from: header('From') || 'Unknown sender',
          to,
          subject,
          body,
          date,
          importedAt: new Date().toISOString(),
          source: 'gmail',
          bodyLoaded: true,
          labelIds: msg.labelIds || [],
          direction: isSent ? 'sent' : 'received',
          automatedMessage: Boolean(header('List-Id') || header('List-Unsubscribe')
            || /^(?:bulk|list|junk)$/i.test(header('Precedence').trim())
            || (header('Auto-Submitted') && !/^no$/i.test(header('Auto-Submitted').trim()))),
          autoTaskPending: Boolean(previousEmail?.autoTaskPending || newInboxEmail),
          clientEmailNotificationPending: Boolean(previousEmail?.clientEmailNotificationPending || newInboxEmail)
        };
      }));
      if (currentUser?.id !== syncUserId) return;
      if (fetchedResults.some(result => result.status === 'rejected' && result.reason?.status === 401)) {
        handleGmailAuthorizationFailure();
        throw new Error('Gmail authorization needs to be refreshed.');
      }
      const failedMessageFetches = fetchedResults.filter(result => result.status === 'rejected');
      const fetchedMessages = fetchedResults
        .filter(result => result.status === 'fulfilled')
        .map(result => result.value)
        .filter(Boolean);
      // A user can delete an email while this sync is fetching message details.
      // Re-read the deletion list before merging so an older response cannot revive it.
      const currentDeletedGmailIds = new Set(data.deletedGmailIds || []);
      const activeIds = ids.filter(id => !currentDeletedGmailIds.has(id));
      const fetchedOnes = fetchedMessages.filter(item => !currentDeletedGmailIds.has(item.gmailId));
      const fetchedGmailIds = new Set(fetchedOnes.map(item => item.gmailId));
      const existingGmailMessages = data.emails.filter(item => item.source === 'gmail'
        && activeIds.includes(item.gmailId)
        && !fetchedGmailIds.has(item.gmailId));
      const newOnes = fetchedOnes.filter(item => newIdSet.has(item.gmailId));
      const emailCountBeforeMerge = data.emails.length;
      data.emails = dedupeEmails([
        ...data.emails.filter(item => item.source !== 'gmail'
          || (!activeIds.includes(item.gmailId)
            && !currentDeletedGmailIds.has(item.gmailId)
            && !fetchedGmailIds.has(item.gmailId))),
        ...fetchedOnes,
        ...existingGmailMessages,
      ]).filter(item => !(item.source === 'gmail' && currentDeletedGmailIds.has(item.gmailId)));
      const portfolioAlertsAdded = alertPortfolioSubmissionEmails(data.emails);
      const savedGmailIds = new Set(data.emails.filter(item => item.source === 'gmail').map(item => item.gmailId));
      inboxHistoryQueue = inboxHistoryQueue.filter(id => !savedGmailIds.has(id) && !currentDeletedGmailIds.has(id));
      sentHistoryQueue = sentHistoryQueue.filter(id => !savedGmailIds.has(id) && !currentDeletedGmailIds.has(id));
      if (fetchedOnes.length || matchedExistingSentMessages || data.emails.length !== emailCountBeforeMerge || portfolioAlertsAdded) {
        await persist();
        renderAll();
      }
      // Inbox fetching is complete; AI progress has its own independent status.
      updateGmailConnectionUI(true);
      if (failedMessageFetches.length) setGmailSyncDisplay('partial');
      else recordGmailSyncSuccess();
      sessionStorage.setItem(GMAIL_CONNECTED_KEY, '1');
      setGmailStatus(`Connected — ${plural(activeIds.length, 'message')}${newOnes.length ? ` · ${plural(newOnes.length, 'new message')} just now` : ''}${failedMessageFetches.length ? ` · ${plural(failedMessageFetches.length, 'message')} failed to load` : ''}`);
      if (currentUser?.id !== syncUserId) return;
      const notificationEmails = [...new Map([...newOnes,
        ...data.emails.filter(email => email.clientEmailNotificationPending)]
        .map(email => [email.gmailId || email.id, email])).values()];
      const hasNewMatches = alertNewMatches(notificationEmails);
      if (typeof scheduleSavedEmailAiCheck === 'function') scheduleSavedEmailAiCheck();
      if (!silent) {
        if (failedMessageFetches.length) {
          showActionResult({ title: 'Gmail sync incomplete', message: `${plural(failedMessageFetches.length, 'message')} could not be loaded. Gmail will retry on the next sync.`, status: 'error' });
        } else if (!hasNewMatches) {
          showActionResult({ title: 'Gmail synced', message: `${plural(activeIds.length, 'message')} are available in the inbox.` });
        }
      }
    } catch (error) {
      if (currentUser?.id !== syncUserId) return;
      if (!gmailReconnectRequired) setGmailSyncDisplay('paused');
      const message = error?.message || 'Unknown Gmail API error';
      if (!gmailReconnectRequired) setGmailStatus(`Gmail sync failed: ${message}`);
      if (!silent) showActionResult({ title: 'Gmail sync failed', message, status: 'error' });
    } finally {
      gmailSyncInFlight = false;
    }
  }

  // perf: debounce visibility, focus, and online events so one queued Gmail sync replaces a burst of duplicate triggers.
  window.addEventListener('online', () => scheduleGmailSync({ silent: true }));
  window.addEventListener('offline', () => renderGmailSyncStatus());
  window.addEventListener('focus', () => scheduleGmailSync({ silent: true }));
  document.addEventListener('visibilitychange', () => {
    if (currentUser && document.visibilityState === 'visible') scheduleGmailSync({ silent: true });
  });

  // Application outcomes use the authenticated AI endpoint. No phrase-based
  // rejection classifier runs in the browser.
  const APPLICATION_AI_PENDING_STATUSES = ['Applied', 'Ongoing', 'To Proceed', 'To Proceeding', 'Interview'];

  function applicationAiScanKey(email, app) {
    return `application-v2:${clientEmailTaskScanKey({ ...email, subject: JSON.stringify([email.subject, email.from,
      email.to, email.date, email.direction, email.labelIds]) }, [{ id: app.id,
      role: JSON.stringify([app.role, app.clientName, app.companyName, app.company, app.email, app.website,
        app.status, app.appliedDate, app.updatedAt, app.manualStatusChangedAt]) }])}`;
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

  function applicationAiSkipReason(email, app, emails) {
    if (!APPLICATION_AI_PENDING_STATUSES.includes(app.status)) return 'This application is no longer in a pending stage.';
    if (isSentEmail(email)) return 'Only received emails are checked.';
    if (!isEmailInAiWeek(email)) return 'Only emails received this week are checked.';
    const latest = latestApplicationAiEmails(emails).get(app.id);
    if (!latest?.unique) return 'This message is not uniquely matched to one application.';
    if (latest.email !== email) return 'A newer matched email takes priority over this message.';
    const received = Date.parse(email.date), applied = Date.parse(app.appliedDate || '');
    const manualStatusChanged = Date.parse(app.manualStatusChangedAt || '');
    if (!Number.isFinite(received) || !Number.isFinite(applied)) return 'A valid email date and application date are needed.';
    if (received < applied) return 'This email predates the application date.';
    if (received > Date.now() + 300000) return 'The email has a future received date.';
    if (Number.isFinite(manualStatusChanged) && received < manualStatusChanged) return 'You manually changed the application stage after receiving this email.';
    if (!String(email.body || '').trim() && email.bodyLoaded !== true) return 'The full email body is still loading.';
    return '';
  }

  function applicationAiStillEligible(email, app, emails) {
    return !applicationAiSkipReason(email, app, emails);
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
      if (app.emailClosure?.emailId === emailId) continue;
      if (email.applicationAiProcessedKey === scanKey && email.applicationAiAnalysis?.rejectApplication !== true) continue;
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
      if (analysis.rejectApplication === true && analysis.matchesApplication === true
        && outcomeReasons[analysis.outcome] && analysis.evidence?.trim().length >= 8) {
        const alertId = `application-email-closed|${app.id}|${emailId}`;
        const previous = { status: app.status, updatedAt: app.updatedAt, emailClosure: app.emailClosure, interviewPriority: app.interviewPriority };
        const now = new Date().toISOString(), reason = outcomeReasons[analysis.outcome];
        app.status = 'Not selected'; app.updatedAt = now; app.interviewPriority = false;
        app.emailClosure = { emailId, emailRecordId: email.id, reason, evidence: analysis.evidence,
          previousStatus: previous.status, receivedAt: email.date, processedAt: now, source: 'cloudflare-ai', analysis };
        const alert = { id: alertId, type: 'application-email-closed', applicationId: app.id, emailId: email.id,
          clientName: app.clientName, from: email.from, date: now, unread: true,
          subject: `${reason} — marked Rejected: ${app.role || app.clientName}`, evidence: analysis.evidence,
          reason: analysis.reason, emailSubject: email.subject || '(No subject)' };
        if (!workspace.alerts.some(item => item.id === alertId)) {
          workspace.alerts.unshift(alert); addedAlerts.push(alert);
        }
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
    if (result.changed.length) renderApplications();
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

  // --- Excel export/restore ---
  // Uses SheetJS (loaded via CDN in index.html) to read/write real .xlsx workbooks in the
  // browser. Application records and tool data are exported as separate sheets. Document binaries stay in private
  // Supabase Storage and are never included in the sheet — only their names/sizes/metadata travel
  // with the sheet. A restore therefore restores records, not document binaries or email history.
  const APPLICATION_COLUMNS = ['id', 'clientName', 'status', 'contractStatus', 'contractEndDate', 'contractEndedEmailSentAt', 'platform', 'employmentType', 'salaryType', 'salaryAmount', 'hoursPerWeek', 'contact', 'role', 'appliedDate', 'createdAt', 'activeAt', 'activePendingDocument', 'activePendingEmail', 'documentEmailPending', 'documentEmailReminderDate', 'documentEmailReminderAlertedDate', 'interviewPriority', 'interviewDate', 'interviewLink', 'interviewAlertDate', 'followUpDate', 'automaticFollowUp', 'followUpProcessedAt', 'followUpSentAt', 'notes', 'email', 'phone', 'website', 'socialMedia', 'socialLinks', 'location', 'documents', 'updatedAt'];
  const TO_APPLY_COLUMNS = ['id', 'title', 'link', 'dueDate', 'notes'];
  const DAILY_TASK_COLUMNS = ['id', 'title', 'type', 'taskDate', 'relatedType', 'relatedId', 'relatedName', 'destination', 'notes', 'checklist', 'createdAt', 'completedAt'];
  const SOCIAL_TREND_COLUMNS = ['id', 'name', 'platform', 'url', 'views', 'uses', 'scope', 'observedAt', 'notes', 'createdAt', 'updatedAt'];
  const LINK_COLUMNS = ['id', 'name', 'url', 'createdAt', 'updatedAt'];
  const SCRIPT_COLUMNS = ['id', 'title', 'content', 'createdAt', 'updatedAt'];
  const AUTO_BACKUP_FREQUENCY_KEY = 'jeff-va-auto-backup-frequency-v1';
  const AUTO_BACKUP_LAST_RUN_KEY = 'jeff-va-auto-backup-last-run-v1';
  const DOCUMENTS_BACKUP_ENDPOINT = '/api/automatic-backup';
  const DOCUMENTS_BACKUP_NAME = 'Jeff VA Backup.xlsx';
  const DOCUMENTS_BACKUP_LAST_SAVED_KEY = 'jeff-va-documents-backup-saved-at-v1';
  let automaticBackupTimer = null;
  let documentsBackupTimer = null;
  let documentsBackupInFlight = false;
  let documentsBackupQueued = false;
  let documentsBackupUnavailable = false;

  function applicationToRow(item) {
    const row = {};
    APPLICATION_COLUMNS.forEach(key => {
      row[key] = key === 'documents' || key === 'socialLinks' ? JSON.stringify(item[key] || []) : (item[key] ?? '');
    });
    return row;
  }

  function dailyTaskToRow(task) {
    return { ...task, checklist: JSON.stringify(task.checklist || []) };
  }

  function rowToDailyTask(row) {
    let checklist = [];
    try { checklist = row.checklist ? JSON.parse(row.checklist) : []; } catch { checklist = []; }
    return { ...row, checklist: Array.isArray(checklist) ? checklist : [] };
  }

  function rowToInvoice(row) {
    const invoice = { ...row };
    if (String(row.paymentStatus || '').toLowerCase() === 'paid') invoice.paymentStatus = 'paid';
    else delete invoice.paymentStatus;
    ['paidAt', 'paymentCurrency', 'paymentMethod', 'paymentNote', 'walletAccount'].forEach(field => {
      if (row[field] === '' || row[field] === null || row[field] === undefined) delete invoice[field];
      else invoice[field] = String(row[field]);
    });
    ['amountInvoiced', 'amountReceived', 'paymentFee', 'amountReceivedPhp'].forEach(field => {
      if (row[field] === '' || row[field] === null || row[field] === undefined) {
        delete invoice[field];
        return;
      }
      const value = Number(row[field]);
      if (!Number.isFinite(value)) throw new Error(`Invalid ${field} in invoice backup.`);
      invoice[field] = value;
    });
    return invoice;
  }

  function createDataSheet(records, columns, widths = {}) {
    const sheet = XLSX.utils.json_to_sheet(records || [], { header: columns });
    sheet['!cols'] = columns.map(column => ({ wch: widths[column] || (column === 'content' || column === 'notes' ? 48 : column.length + 4) }));
    return sheet;
  }

  function rowToApplication(row) {
    let documents = [];
    let socialLinks = [];
    try { documents = row.documents ? JSON.parse(row.documents) : []; } catch { documents = []; }
    try { socialLinks = row.socialLinks ? JSON.parse(row.socialLinks) : []; } catch { socialLinks = []; }
    if (!Array.isArray(socialLinks)) socialLinks = [];
    socialLinks = socialLinks.map(link => ({ platform: String(link?.platform || 'website'), url: String(link?.url || '').trim() })).filter(link => link.url);
    if (!socialLinks.length && String(row.socialMedia || '').trim()) socialLinks = [{ platform: 'website', url: String(row.socialMedia).trim() }];
    return {
      id: String(row.id || uid()),
      clientName: String(row.clientName || ''),
      status: String(row.status || 'Applied'),
      platform: String(row.platform || ''),
      employmentType: String(row.employmentType || ''),
      salaryType: String(row.salaryType || ''),
      salaryAmount: row.salaryAmount === '' || row.salaryAmount === null || row.salaryAmount === undefined ? '' : Number(row.salaryAmount),
      hoursPerWeek: row.hoursPerWeek === '' || row.hoursPerWeek === null || row.hoursPerWeek === undefined ? '' : Number(row.hoursPerWeek),
      contact: String(row.contact || ''),
      role: String(row.role || ''),
      appliedDate: String(row.appliedDate || ''),
      followUpDate: String(row.followUpDate || ''),
      automaticFollowUp: String(row.automaticFollowUp).toLowerCase() === 'true',
      followUpProcessedAt: String(row.followUpProcessedAt || ''),
      followUpSentAt: String(row.followUpSentAt || ''),
      activePendingDocument: String(row.activePendingDocument).toLowerCase() === 'true',
      activePendingEmail: String(row.activePendingEmail).toLowerCase() === 'true',
      documentEmailPending: String(row.documentEmailPending).toLowerCase() === 'true',
      documentEmailReminderDate: String(row.documentEmailReminderDate || ''),
      documentEmailReminderAlertedDate: String(row.documentEmailReminderAlertedDate || ''),
      contractEndedEmailSentAt: String(row.contractEndedEmailSentAt || ''),
      interviewPriority: String(row.interviewPriority).toLowerCase() === 'true',
      interviewDate: String(row.interviewDate || ''),
      interviewLink: String(row.interviewLink || ''),
      interviewAlertDate: String(row.interviewAlertDate || ''),
      notes: String(row.notes || ''),
      email: String(row.email || ''),
      phone: String(row.phone || ''),
      website: String(row.website || ''),
      socialMedia: String(row.socialMedia || socialLinks[0]?.url || ''),
      socialLinks,
      location: String(row.location || ''),
      createdAt: String(row.createdAt || row.updatedAt || new Date().toISOString()),
      activeAt: String(row.activeAt || (row.status === 'Active client' ? row.appliedDate || '' : '')),
      documents,
      updatedAt: String(row.updatedAt || new Date().toISOString())
    };
  }

  function buildBackupWorkbook() {
    const workbook = XLSX.utils.book_new();
    const applicationWidths = { id: 38, clientName: 24, status: 16, contractStatus: 16, contractEndDate: 16, contractEndedEmailSentAt: 24, platform: 18, employmentType: 16, salaryType: 16, salaryAmount: 18, hoursPerWeek: 18, contact: 22, role: 24, appliedDate: 16, createdAt: 24, activeAt: 24, activePendingDocument: 20, activePendingEmail: 18, documentEmailPending: 20, documentEmailReminderDate: 20, documentEmailReminderAlertedDate: 24, interviewPriority: 18, interviewDate: 16, interviewLink: 36, interviewAlertDate: 24, followUpDate: 16, automaticFollowUp: 18, followUpProcessedAt: 24, followUpSentAt: 24, notes: 48, email: 30, phone: 18, website: 32, socialMedia: 24, socialLinks: 52, location: 24, documents: 48, updatedAt: 24 };
    const applicationsSheet = createDataSheet(pipelineApplications().map(applicationToRow), APPLICATION_COLUMNS, applicationWidths);
    const activeClientsSheet = createDataSheet(hiredClients().map(applicationToRow), APPLICATION_COLUMNS, applicationWidths);
    const invoiceColumns = ['id', 'clientId', 'invoiceNumber', 'issueDate', 'billingPeriod', 'dueDate', 'service', 'startDate', 'endDate', 'fileName', 'sentAt', 'paymentStatus', 'paidAt', 'amountInvoiced', 'amountReceived', 'paymentCurrency', 'paymentFee', 'amountReceivedPhp', 'paymentMethod', 'paymentNote', 'walletAccount'];
    XLSX.utils.book_append_sheet(workbook, applicationsSheet, 'Applications');
    XLSX.utils.book_append_sheet(workbook, activeClientsSheet, 'Active clients');
    XLSX.utils.book_append_sheet(workbook, createDataSheet(data.invoices || [], invoiceColumns, { id: 38, clientId: 38, invoiceNumber: 18, issueDate: 18, billingPeriod: 24, dueDate: 18, service: 34, startDate: 16, endDate: 16, fileName: 34, sentAt: 24, paymentStatus: 16, paidAt: 18, amountInvoiced: 18, amountReceived: 18, paymentCurrency: 18, paymentFee: 16, amountReceivedPhp: 20, paymentMethod: 20, paymentNote: 40 }), 'Invoices');
    XLSX.utils.book_append_sheet(workbook, createDataSheet(data.toApply || [], TO_APPLY_COLUMNS, { id: 38, title: 28, link: 48, dueDate: 16, notes: 48 }), 'To apply');
    XLSX.utils.book_append_sheet(workbook, createDataSheet((data.dailyTasks || []).map(dailyTaskToRow), DAILY_TASK_COLUMNS, { id: 38, title: 40, type: 18, taskDate: 16, relatedType: 18, relatedId: 38, relatedName: 28, destination: 40, notes: 60, checklist: 60, createdAt: 24, completedAt: 24 }), 'Daily tasks');
    XLSX.utils.book_append_sheet(workbook, createDataSheet(data.socialTrends || [], SOCIAL_TREND_COLUMNS, { id: 38, name: 34, platform: 16, url: 55, views: 18, uses: 18, scope: 18, observedAt: 16, notes: 48, createdAt: 24, updatedAt: 24 }), 'Social trends');
    XLSX.utils.book_append_sheet(workbook, createDataSheet(data.workLinks || [], LINK_COLUMNS, { id: 38, name: 28, url: 55, createdAt: 24, updatedAt: 24 }), 'Links');
    XLSX.utils.book_append_sheet(workbook, createDataSheet(data.scripts || [], SCRIPT_COLUMNS, { id: 38, title: 28, content: 70, createdAt: 24, updatedAt: 24 }), 'Scripts');
    return workbook;
  }

  function exportBackup({ automatic = false } = {}) {
    if (!window.XLSX) { if (!automatic) toast('Excel export is still loading, try again in a moment'); return false; }
    const workbook = buildBackupWorkbook();
    XLSX.writeFile(workbook, `${automatic ? 'jeff-va-auto-backup' : 'jeff-va-export'}-${today()}.xlsx`);
    showActionResult({
      title: automatic ? 'Automatic backup downloaded' : 'Backup downloaded',
      message: automatic ? 'Your scheduled Excel backup was downloaded.' : 'Your Excel backup was downloaded.'
    });
    return true;
  }

  function canSaveToDocuments() {
    return window.location.protocol.startsWith('http')
      && ['127.0.0.1', 'localhost'].includes(window.location.hostname)
      && Boolean(window.XLSX && currentUser && dataReady && supabaseDataLoaded);
  }

  function documentsBackupTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
  }

  function updateDocumentsBackupNote(message = '') {
    const note = $('#autoBackupNote');
    const status = $('#documentsBackupStatus');
    if (!note) return;
    if (message) {
      note.textContent = message;
      if (status) status.textContent = 'Waiting for the Documents backup server.';
      return;
    }
    if (documentsBackupUnavailable) {
      note.textContent = 'Automatic Documents backup is unavailable. Start Jeff VA with start-jeff-va.bat, then reopen the app.';
      if (status) status.textContent = 'Documents backup could not be saved.';
      return;
    }
    note.textContent = `An updated Excel copy is saved to Documents\\${DOCUMENTS_BACKUP_NAME} when Jeff VA opens and when it closes. Downloaded backups still use your browser Downloads folder.`;
    const lastSavedAt = localStorage.getItem(DOCUMENTS_BACKUP_LAST_SAVED_KEY);
    if (status) status.textContent = lastSavedAt
      ? `Documents backup saved at ${documentsBackupTime(lastSavedAt)}.`
      : 'Preparing the first Documents backup.';
  }

  async function saveBackupToDocuments() {
    documentsBackupTimer = null;
    if (!canSaveToDocuments()) return;
    if (documentsBackupInFlight) {
      documentsBackupQueued = true;
      return;
    }
    documentsBackupInFlight = true;
    documentsBackupQueued = false;
    try {
      const workbook = buildBackupWorkbook();
      const file = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const response = await fetch(DOCUMENTS_BACKUP_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        body: file
      });
      if (!response.ok) throw new Error('The local backup server did not accept the Excel file.');
      const result = await response.json();
      if (!result?.ok || result.file !== DOCUMENTS_BACKUP_NAME) throw new Error('The local backup server returned an unexpected response.');
      documentsBackupUnavailable = false;
      localStorage.setItem(DOCUMENTS_BACKUP_LAST_SAVED_KEY, new Date().toISOString());
      updateDocumentsBackupNote();
    } catch (error) {
      documentsBackupUnavailable = true;
      console.warn('Could not save the automatic Documents backup:', error);
      updateDocumentsBackupNote();
    } finally {
      documentsBackupInFlight = false;
      if (documentsBackupQueued) queueDocumentsBackup({ immediate: true });
    }
  }

  function queueDocumentsBackup({ immediate = false } = {}) {
    if (!canSaveToDocuments()) return;
    if (documentsBackupTimer) clearTimeout(documentsBackupTimer);
    documentsBackupTimer = setTimeout(saveBackupToDocuments, immediate ? 0 : 700);
  }

  function scheduleDocumentsBackup() {
    updateDocumentsBackupNote();
    queueDocumentsBackup();
  }

  function autoBackupPeriodKey(frequency) {
    const currentDate = new Date(`${today()}T12:00:00`);
    if (frequency === 'daily') return today();
    if (frequency !== 'weekly') return '';
    const firstDay = new Date(currentDate.getFullYear(), 0, 1);
    const dayOfYear = Math.floor((currentDate - firstDay) / 86400000);
    return `${currentDate.getFullYear()}-week-${Math.floor((dayOfYear + firstDay.getDay()) / 7)}`;
  }

  function runAutomaticBackup() {
    if (!currentUser || !dataReady || !supabaseDataLoaded) return;
    const frequency = localStorage.getItem(AUTO_BACKUP_FREQUENCY_KEY) || 'off';
    const periodKey = autoBackupPeriodKey(frequency);
    if (!periodKey || localStorage.getItem(AUTO_BACKUP_LAST_RUN_KEY) === `${frequency}:${periodKey}`) return;
    if (exportBackup({ automatic: true })) localStorage.setItem(AUTO_BACKUP_LAST_RUN_KEY, `${frequency}:${periodKey}`);
  }

  function scheduleAutomaticBackup() {
    if (automaticBackupTimer) clearInterval(automaticBackupTimer);
    automaticBackupTimer = setInterval(runAutomaticBackup, 60000);
    runAutomaticBackup();
    scheduleDocumentsBackup();
  }

  window.addEventListener('pagehide', () => queueDocumentsBackup({ immediate: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') queueDocumentsBackup({ immediate: true });
  });

  async function restoreBackup(file) {
    if (!file) return;
    if (!window.XLSX) { toast('Excel restore is still loading, try again in a moment'); return; }
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const applicationsSheet = workbook.Sheets['Applications'];
      const activeClientsSheet = workbook.Sheets['Active clients'];
      if (!applicationsSheet || !activeClientsSheet) throw new Error('invalid');
      const applications = XLSX.utils.sheet_to_json(applicationsSheet, { defval: '' }).map(rowToApplication);
      const activeClients = XLSX.utils.sheet_to_json(activeClientsSheet, { defval: '' }).map(rowToApplication).map(item => ({ ...item, status: 'Active client', activePendingDocument: false }));
      const invoices = workbook.Sheets.Invoices ? XLSX.utils.sheet_to_json(workbook.Sheets.Invoices, { defval: '' }).map(rowToInvoice) : data.invoices || [];
      const toApply = workbook.Sheets['To apply'] ? XLSX.utils.sheet_to_json(workbook.Sheets['To apply'], { defval: '' }) : data.toApply || [];
      const dailyTasks = workbook.Sheets['Daily tasks'] ? XLSX.utils.sheet_to_json(workbook.Sheets['Daily tasks'], { defval: '' }).map(rowToDailyTask) : data.dailyTasks || [];
      const socialTrends = workbook.Sheets['Social trends'] ? XLSX.utils.sheet_to_json(workbook.Sheets['Social trends'], { defval: '' }).map(row => ({ ...row, views: Number(row.views) || 0, uses: Number(row.uses) || 0 })) : data.socialTrends || [];
      const workLinks = workbook.Sheets.Links ? XLSX.utils.sheet_to_json(workbook.Sheets.Links, { defval: '' }) : data.workLinks || [];
      const scripts = workbook.Sheets.Scripts ? XLSX.utils.sheet_to_json(workbook.Sheets.Scripts, { defval: '' }) : data.scripts || [];
      const restoredApplications = [...applications, ...activeClients.filter(active => !applications.some(application => application.id === active.id))];
      if (!(await appConfirm(`Replace the current application data with ${applications.length} applications and ${activeClients.length} active clients? Tool data and email history will also be restored.`, { title: 'Replace workspace data', confirmLabel: 'Replace data', danger: true }))) return;
      data = { applications: restoredApplications, toApply, dailyTasks, socialTrends, emails: data.emails, deletedGmailIds: data.deletedGmailIds || [], accountSignInHistory: data.accountSignInHistory || [], alerts: [], emailTemplates: data.emailTemplates || [], personalDocuments: data.personalDocuments || [], invoices, scripts, workLinks, walletEntries: data.walletEntries || [], subscriptions: data.subscriptions || [] };
      persist(); renderAll(); showActionResult({ title: 'Backup restored', message: 'Your workspace data was restored from the Excel file.' });
    } catch {
      showActionResult({ title: 'Could not restore backup', message: 'That file is not a valid Jeff VA export.', status: 'error' });
    } finally { $('#backupInput').value = ''; }
  }

  function toast(message) {
    const target = $('#toast');
    target.textContent = message;
    target.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => target.classList.remove('show'), 2800);
  }

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
    { id: 'subscriptions', label: 'Account subscriptions', detail: 'Paid accounts, expiry dates and renewal decisions', icon: 'fa-credit-card' },
    { id: 'wallet', label: 'Wallet', detail: 'Income, expenses, salary and account balances', icon: 'fa-wallet' },
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
    const savedGoal = normalizeWeeklyActivityGoal(data.weeklyActivityGoal)
      ?? normalizeWeeklyActivityGoal(localStorage.getItem(weeklyActivityGoalStorageKey()));
    $('#weeklyGoalInput').value = savedGoal ?? '';
    $('#saveWeeklyGoal').disabled = !$('#weeklyGoalInput').checkValidity();
    $('#weeklyGoalDialog').showModal();
    requestAnimationFrame(() => $('#weeklyGoalInput').focus());
  });
  $('#weeklyGoalInput').addEventListener('input', event => {
    event.target.setCustomValidity('');
    $('#saveWeeklyGoal').disabled = !event.target.checkValidity();
  });
  $('#closeWeeklyGoalDialog')?.addEventListener('click', () => $('#weeklyGoalDialog').close());
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
    data.weeklyActivityGoal = goal;
    localStorage.setItem(weeklyActivityGoalStorageKey(), String(goal));
    $('#weeklyGoalDialog').close();
    renderDashboard();
    persist();
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
    } else if (event.key.toLowerCase() === 'n' && activeView === 'wallet') {
      event.preventDefault();
      openWalletEntry();
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
          selectClientDetailTab('tasks');
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
      } else if (alert?.type?.startsWith('subscription-')) {
        showView('subscriptions');
        if ((data.subscriptions || []).some(item => item.id === alert.subscriptionId)) openSubscriptionEditor(alert.subscriptionId);
      } else if (alert?.type?.startsWith('wallet-payment-')) {
        showView('wallet');
        renderWallet();
        requestAnimationFrame(() => $(`[data-wallet-actions="${CSS.escape(alert.walletEntryId || '')}"]`)?.focus());
      } else if (['active-client-email', 'active-client-email-review', 'application-email', 'application-email-closed'].includes(alert?.type)) {
        showView('inbox');
        if (data.emails.some(email => email.id === alert.emailId)) openEmailDetail(alert.emailId);
        else if (alert.applicationId) {
          const client = data.applications.find(item => item.id === alert.applicationId);
          if (alert.type === 'active-client-email' && client) {
            showView('hired');
            renderHiredDetail(client);
          } else {
            showView('applications');
            openClientModal(alert.applicationId, true);
          }
        }
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

  // Applications page and its Active Client activation flow are intentionally
  // contained here. Nothing on the inbox, tools, or active-clients page can
  // advance or cancel this transaction.
  let applicationActionsReturnFocus = null;

  function openApplicationActionsPanel(applicationId, trigger) {
    const application = data.applications.find(item => item.id === applicationId);
    const panel = $('#applicationActionsPanel');
    if (!application || !panel) return;
    applicationActionsReturnFocus = trigger;
    panel.dataset.applicationId = applicationId;
    $('#applicationActionsTitle').textContent = application.clientName || 'Application';
    $('#applicationActionsRole').textContent = application.role || 'Role or service not specified';
    $('#applicationActionsFollowUpDate').textContent = application.followUpDate
      ? `Scheduled for ${formatDate(dateKey(application.followUpDate))}`
      : 'Set a follow-up date.';
    panel.showModal();
    panel.querySelector('[data-application-panel-action]')?.focus();
  }

  function openApplicationFollowUpModal(application) {
    const modal = $('#applicationFollowUpModal');
    modal.dataset.applicationId = application.id;
    $('#applicationFollowUpTitle').textContent = `Follow-up date for ${application.clientName || 'Application'}`;
    $('#applicationFollowUpDateInput').value = dateKey(application.followUpDate);
    modal.showModal();
    $('#applicationFollowUpDateInput').focus();
  }

  $('#applicationActionsPanel').addEventListener('close', () => {
    applicationActionsReturnFocus?.focus();
    applicationActionsReturnFocus = null;
  });

  $('#applicationActionsPanel').addEventListener('click', event => {
    if (event.target.closest('.application-actions-panel-close')) {
      event.currentTarget.close();
      return;
    }
    if (event.target === event.currentTarget) event.currentTarget.close();
  });

  function updateClientLocation() {
    const country = $('#clientCountry');
    const region = $('#clientRegion');
    const regionField = $('#clientRegionField');
    const selectedCountry = country.options[country.selectedIndex];
    const countryCode = country.value;
    const countryName = selectedCountry?.text || '';
    const regionalCountries = [...region.options].filter(option => option.dataset.countries?.split(',').includes(countryCode));
    regionalCountries.forEach(option => { option.hidden = false; });
    [...region.options].filter(option => option.value).forEach(option => { option.hidden = !regionalCountries.includes(option); });
    const hasRegions = regionalCountries.length > 0;
    regionField.classList.toggle('hidden', !hasRegions);
    if (!hasRegions) region.value = '';
    const selectedRegion = region.options[region.selectedIndex];
    $('#hiredLocation').value = countryName ? `${countryName}${selectedRegion?.value ? `, ${selectedRegion.text}` : ''}` : '';
  }

  function updateSalaryFields() {
    const USD_TO_PHP = 58;
    const salaryType = $('#salaryType').value;
    const salaryCurrency = $('#salaryCurrency').value || 'USD';
    const salaryAmount = Number($('#salaryAmount').value || 0);
    const hoursPerWeek = Number($('#salaryHoursPerWeek').value || 0);
    const amountField = $('#salaryAmount').closest('.salary-amount-field');
    const hoursField = $('#salaryHoursPerWeek').closest('.salary-hours-field');
    const estimate = $('#salaryMonthlyEstimatePreview');
    const estimatePhp = $('#salaryMonthlyEstimatePhp');
    const estimateField = $('#salaryMonthlyEstimatePreview')?.closest('.salary-estimate-field');
    const needsSalary = Boolean(salaryType && (salaryType === 'monthly' || salaryType === 'hourly'));
    const mainCurrencySymbol = salaryCurrency === 'PHP' ? '₱' : '$';
    const conversionCurrencySymbol = salaryCurrency === 'PHP' ? '$' : '₱';
    amountField?.classList.toggle('hidden', !needsSalary);
    hoursField?.classList.toggle('hidden', salaryType !== 'hourly');
    estimateField?.classList.toggle('hidden', !needsSalary);
    if (!needsSalary) {
      estimate.textContent = `${mainCurrencySymbol}0`;
      estimatePhp.textContent = `(approx. ${conversionCurrencySymbol}0)`;
      return;
    }
    const monthlyEstimate = salaryType === 'monthly'
      ? salaryAmount
      : (salaryAmount * hoursPerWeek * 4);
    const roundedEstimate = Math.round(monthlyEstimate);
    const convertedEstimate = salaryCurrency === 'PHP'
      ? Math.round(roundedEstimate / USD_TO_PHP)
      : Math.round(roundedEstimate * USD_TO_PHP);
    estimate.textContent = Number.isFinite(monthlyEstimate) && monthlyEstimate > 0
      ? `${mainCurrencySymbol}${roundedEstimate.toLocaleString()}`
      : `${mainCurrencySymbol}0`;
    estimatePhp.textContent = Number.isFinite(monthlyEstimate) && monthlyEstimate > 0
      ? `(approx. ${conversionCurrencySymbol}${convertedEstimate.toLocaleString()})`
      : `(approx. ${conversionCurrencySymbol}0)`;
  }

  document.addEventListener('click', async event => {
    const addButton = event.target.closest('[data-open-add]');
    const editButton = event.target.closest('[data-edit-id]');
    const applicationEmailsButton = event.target.closest('[data-application-emails]');
    const viewDetailsButton = event.target.closest('[data-view-details]');
    const clientDocumentAttachButton = event.target.closest('[data-client-document-attach]');
    const sendProceedEmailButton = event.target.closest('#sendProceedEmailButton');
    const applicationActionsTrigger = event.target.closest('[data-open-application-actions]');
    const applicationPanelAction = event.target.closest('[data-application-panel-action]');
    if (addButton) {
      openClientModal();
      return;
    }
    if (applicationActionsTrigger) {
      openApplicationActionsPanel(applicationActionsTrigger.dataset.openApplicationActions, applicationActionsTrigger);
      return;
    }
    if (applicationPanelAction) {
      const panel = $('#applicationActionsPanel');
      const applicationId = panel.dataset.applicationId;
      const action = applicationPanelAction.dataset.applicationPanelAction;
      const application = data.applications.find(item => item.id === applicationId);
      applicationActionsReturnFocus = null;
      panel.close();
      if (action === 'email' && application) openPlainClientEmailComposer(application, false, true);
      else if (action === 'follow-up' && application) openApplicationFollowUpModal(application);
      else if (action === 'edit') openClientModal(applicationId);
      else if (action === 'delete') await deleteClient(applicationId);
      return;
    }
    if (editButton) {
      openClientModal(editButton.dataset.editId);
      return;
    }
    if (applicationEmailsButton) {
      openApplicationEmailsModal(applicationEmailsButton.dataset.applicationEmails);
      return;
    }
    if (viewDetailsButton && !event.target.closest('button, a, input, select, textarea, label')) {
      openClientModal(viewDetailsButton.dataset.viewDetails, true);
      return;
    }
    if (clientDocumentAttachButton) attachPersonalDocumentToClient(clientDocumentAttachButton.dataset.clientDocumentAttach);
    if (sendProceedEmailButton) {
      const application = data.applications.find(item => item.id === editingId);
      if (application) openProceedEmailComposer(application);
      else toast('Save the application first, then open it again to send the proceed email.');
      return;
    }
  });

  $('#applicationFollowUpForm').addEventListener('submit', event => {
    if (event.submitter?.value === 'cancel') return;
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const modal = $('#applicationFollowUpModal');
    const application = data.applications.find(item => item.id === modal.dataset.applicationId);
    if (!application) {
      modal.close();
      toast('This application could not be found. Reopen the actions panel and try again.');
      return;
    }
    const followUpDate = $('#applicationFollowUpDateInput').value;
    if (application.followUpDate !== followUpDate) {
      application.followUpDate = followUpDate;
      application.followUpProcessedAt = '';
      application.followUpSentAt = '';
    }
    application.updatedAt = new Date().toISOString();
    persist();
    renderAll();
    modal.close();
    toast('Follow-up date saved.');
  });

  $('#clientPlatform').addEventListener('change', event => {
    const isOther = event.target.value === 'Other';
    $('#customPlatformField').classList.toggle('hidden', !isOther);
    $('#customPlatform').required = isOther;
    if (!isOther) $('#customPlatform').value = '';
    if (!editingId && !viewingClientDetails) {
      const email = $('#hiredEmail');
      const knownSenderEmails = Object.keys(PLATFORM_SENDER_EMAILS).map(platformSenderEmail);
      const currentEmail = email.value.trim().toLowerCase();
      const senderEmail = platformSenderEmail(event.target.value);
      if (senderEmail && (!currentEmail || knownSenderEmails.includes(currentEmail))) {
        email.value = senderEmail;
      } else if (!senderEmail && knownSenderEmails.includes(currentEmail)) {
        email.value = '';
      }
    }
  });
  $('#salaryType').addEventListener('change', updateSalaryFields);
  $('#salaryCurrency').addEventListener('change', updateSalaryFields);
  $('#salaryAmount').addEventListener('input', updateSalaryFields);
  $('#salaryHoursPerWeek').addEventListener('input', updateSalaryFields);
  $('#clientCountry').addEventListener('change', updateClientLocation);
  $('#clientRegion').addEventListener('change', updateClientLocation);
  $('#clientForm').addEventListener('submit', saveClient);
  ['input', 'change'].forEach(eventName => {
    $('#clientForm').addEventListener(eventName, event => {
      if (['clientName', 'contactName', 'hiredEmail', 'clientRole'].includes(event.target.id)) updateApplicationDuplicateNotice();
      if ($('#clientModal').open && !editingId && !viewingClientDetails) saveNewClientApplicationDraft();
    });
  });
  $('#clientStatus').addEventListener('change', updateClientActionLabel);
  $('#automaticFollowUp').addEventListener('change', event => {
    if (event.target.checked && !$('#followUpDate').value) $('#followUpDate').value = addDays(today(), 7);
  });
  $('#applicationSearch').addEventListener('input', renderApplications);
  $('#applicationOrderSort').addEventListener('change', renderApplications);
  $('#applicationDateFilter').addEventListener('change', event => {
    applicationDateFilter = event.target.value;
    applicationDateSort = '';
    renderApplications();
    updateWeekNavigationCounts();
  });
  $('#applicationDateSort').addEventListener('change', event => {
    applicationDateSort = event.target.value;
    if (applicationDateSort === 'all') {
      applicationDateFilter = '';
      $('#applicationDateFilter').value = '';
    }
    renderApplications();
    updateWeekNavigationCounts();
  });
  $('#statusFilter').addEventListener('change', renderApplications);
  $('#platformFilter').addEventListener('change', renderApplications);
  document.querySelectorAll('[data-application-view]').forEach(button => {
    button.addEventListener('click', () => {
      applicationViewMode = button.dataset.applicationView;
      localStorage.setItem('jeff-va-application-view-v1', applicationViewMode);
      renderApplications();
    });
  });
  $('#toggleApplicationSelection').addEventListener('click', () => {
    applicationSelectionMode = !applicationSelectionMode;
    if (!applicationSelectionMode) selectedApplicationIds.clear();
    renderApplications();
  });
  $('#clearApplicationFilters').addEventListener('click', () => {
    $('#applicationSearch').value = '';
    $('#applicationDateFilter').value = '';
    $('#statusFilter').value = '';
    $('#platformFilter').value = '';
    $('#applicationDateSort').value = 'all';
    applicationDateFilter = '';
    applicationDateSort = 'all';
    renderApplications();
    updateWeekNavigationCounts();
  });
  document.addEventListener('click', async event => {
    const removeFilter = event.target.closest('[data-remove-application-filter]');
    const detailButton = event.target.closest('button[data-view-details]');
    if (removeFilter) {
      const filter = removeFilter.dataset.removeApplicationFilter;
      if (filter === 'search') $('#applicationSearch').value = '';
      if (filter === 'date') {
        applicationDateFilter = '';
        $('#applicationDateFilter').value = '';
      }
      if (filter === 'status') $('#statusFilter').value = '';
      if (filter === 'platform') $('#platformFilter').value = '';
      if (filter === 'week') {
        applicationDateSort = 'all';
        $('#applicationDateSort').value = 'all';
      }
      renderApplications();
      updateWeekNavigationCounts();
      return;
    }
    if (detailButton) {
      openClientModal(detailButton.dataset.viewDetails, true);
      return;
    }
  });
  $('#applicationList').addEventListener('change', event => {
    const checkbox = event.target.closest('[data-application-select]');
    if (!checkbox) return;
    if (checkbox.checked) selectedApplicationIds.add(checkbox.dataset.applicationSelect);
    else selectedApplicationIds.delete(checkbox.dataset.applicationSelect);
    $('#applicationBulkActions').hidden = !applicationSelectionMode || selectedApplicationIds.size === 0;
    $('#applicationSelectionCount').textContent = `${selectedApplicationIds.size} selected`;
  });
  $('#clearApplicationSelection').addEventListener('click', () => {
    selectedApplicationIds.clear();
    renderApplications();
  });
  $('#applyBulkStatus').addEventListener('click', () => {
    const newStatus = $('#applicationBulkStatus').value;
    if (!newStatus || !selectedApplicationIds.size) return;
    const selected = data.applications.filter(item => selectedApplicationIds.has(item.id));
    const activeClients = selected.filter(item => item.status === 'Active client');
    if (activeClients.length) {
      toast('Active clients must be updated from their details to preserve contract records.');
      return;
    }
    selected.forEach(item => {
      item.manualStatusChangedAt = manualApplicationStatusTimestamp(item, newStatus);
      item.status = newStatus;
      if (newStatus !== 'Interview') {
        item.interviewDate = '';
        item.interviewLink = '';
      }
      if (newStatus !== 'To Proceed') item.nextStep = '';
    });
    selectedApplicationIds.clear();
    $('#applicationBulkStatus').value = '';
    persist();
    renderAll();
    toast(`Updated ${plural(selected.length, 'application')}.`);
  });
  let draggedApplicationId = '';
  $('#applicationList').addEventListener('dragstart', event => {
    const card = event.target.closest('[data-application-card]');
    if (!card || card.getAttribute('draggable') !== 'true') return;
    draggedApplicationId = card.dataset.applicationCard;
    event.dataTransfer.setData('text/plain', draggedApplicationId);
    event.dataTransfer.effectAllowed = 'move';
  });
  $('#applicationList').addEventListener('dragover', event => {
    const column = event.target.closest('[data-application-drop-status]');
    if (!column || !draggedApplicationId) return;
    event.preventDefault();
    column.classList.add('drop-target');
  });
  $('#applicationList').addEventListener('dragleave', event => {
    const column = event.target.closest('[data-application-drop-status]');
    if (column && !column.contains(event.relatedTarget)) column.classList.remove('drop-target');
  });
  $('#applicationList').addEventListener('drop', event => {
    const column = event.target.closest('[data-application-drop-status]');
    if (!column || !draggedApplicationId) return;
    event.preventDefault();
    column.classList.remove('drop-target');
    const item = data.applications.find(application => application.id === draggedApplicationId);
    const nextStatus = column.dataset.applicationDropStatus;
    draggedApplicationId = '';
    if (!item || item.status === nextStatus) return;
    if (nextStatus === 'Interview' || nextStatus === 'Active client') {
      openClientModal(item.id);
      $('#clientStatus').value = nextStatus;
      $('#clientStatus').dispatchEvent(new Event('change'));
      toast(nextStatus === 'Interview'
        ? 'Add the interview date and link to complete this status change.'
        : 'Complete the client activation steps to change this status.');
      return;
    }
    item.manualStatusChangedAt = manualApplicationStatusTimestamp(item, nextStatus);
    item.status = nextStatus;
    if (nextStatus !== 'To Proceed') item.nextStep = '';
    item.interviewDate = '';
    item.interviewLink = '';
    persist();
    renderAll();
    toast(`Moved ${item.clientName} to ${nextStatus === 'Not selected' ? 'Rejected' : nextStatus}.`);
  });

  $('#clientPickerUploadInput').addEventListener('change', async event => {
    await uploadActivationDocument(event.target.files[0]);
    event.target.value = '';
  });
  $('#continueActivationEmailButton').addEventListener('click', continueActivationEmail);
  $('#cancelActivationDocumentButton').addEventListener('click', event => {
    event.preventDefault();
    $('#clientDocumentPickerModal').close();
  });
  $('#cancelActivationEmailButton').addEventListener('click', event => {
    event.preventDefault();
    $('#emailComposeModal').close();
  });
  $('#clientDocumentPickerModal').addEventListener('close', () => {
    if (pendingActivation?.stage === 'document-selection') rollbackActivation();
  });
  $('#emailComposeModal').addEventListener('close', () => {
    $('#emailComposeModal').classList.remove('email-compose-side-panel');
    if (pendingActivation?.stage === 'email') rollbackActivation();
  });

  // To Apply page controls.
  $('#addToApplyButton')?.addEventListener('click', () => openToApplyModal());
  $('#toApplySearch')?.addEventListener('input', renderToApplyList);
  $('#toApplySort')?.addEventListener('change', renderToApplyList);
  $('#toApplyForm')?.addEventListener('submit', saveToApply);
  let toApplyActionId = null;
  function openToApplyActions(id) {
    const item = (data.toApply || []).find(reminder => reminder.id === id);
    if (!item) return;
    toApplyActionId = id;
    const panel = $('#toApplyActionsPanel');
    if (!panel) return;
    $('#toApplyActionsSubtitle').textContent = item.title || 'Application reminder';
    panel.showModal();
    $('#editToApplyAction')?.focus();
  }
  function closeToApplyActions() {
    const panel = $('#toApplyActionsPanel');
    if (panel?.open) panel.close();
    toApplyActionId = null;
  }
  $('#cancelToApplyActions')?.addEventListener('click', closeToApplyActions);
  $('#editToApplyAction')?.addEventListener('click', () => {
    const id = toApplyActionId;
    closeToApplyActions();
    if (id) openToApplyModal(id);
  });
  $('#deleteToApplyAction')?.addEventListener('click', async () => {
    const id = toApplyActionId;
    closeToApplyActions();
    if (id) await deleteToApply(id);
  });
  function closeToApplyActionMenus(restoreFocus = false) {
    document.querySelectorAll('[data-to-apply-menu][aria-expanded="true"]').forEach(button => {
      button.setAttribute('aria-expanded', 'false');
      button.nextElementSibling.classList.add('hidden');
      button.nextElementSibling.classList.remove('opens-up');
      if (restoreFocus) button.focus();
    });
  }

  document.addEventListener('click', event => {
    const menuButton = event.target.closest('[data-to-apply-actions]');
    if (menuButton) {
      closeToApplyActionMenus();
      openToApplyActions(menuButton.dataset.toApplyActions);
      return;
    }
    closeToApplyActionMenus();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeToApplyActionMenus(true);
  });

  const DAILY_TASK_TYPES = {
    task: 'General task',
    client: 'Client work',
    application: 'Application',
    apply: 'Apply somewhere',
    content: 'Content'
  };
  let activeDailyTaskId = '';
  let pendingDailyTaskChecklist = [];
  let dailyTaskFilter = 'all';
  let dailyTaskUndoTimer = null;
  let pendingDailyTaskUndo = null;

  function dailyTaskDateStatus(task) {
    if (task.completedAt) {
      return '<span class="daily-task-status is-complete">Done</span>';
    }
    if (task.taskDate < today()) {
      return '<span class="daily-task-status is-overdue">Overdue</span>';
    }
    if (task.taskDate === today()) {
      return '<span class="daily-task-status is-due-today">Due today</span>';
    }
    return '<span class="daily-task-status is-upcoming">Upcoming</span>';
  }

  function dailyTaskRelatedOptions() {
    const selected = $('#dailyTaskRelated').value;
    const clients = sortByDate(data.applications.filter(item => item.status === 'Active client'), applicationAddedDate);
    const applications = sortByDate(data.applications.filter(item => item.status !== 'Active client'), applicationAddedDate);
    const option = (item, type) => {
      const name = item.clientName || item.role || 'Untitled record';
      const detail = item.role && item.clientName ? ` - ${item.role}` : '';
      return { value: `${type}:${item.id}`, name, detail: detail.replace(/^ - /, ''), searchText: `${name} ${detail}`.toLowerCase() };
    };
    const groups = [
      { label: 'Active clients', records: clients.map(item => option(item, 'client')) },
      { label: 'Applications', records: applications.map(item => option(item, 'application')) }
    ];
    const records = groups.flatMap(group => group.records);
    const select = $('#dailyTaskRelated');
    select.innerHTML = `<option value="">No linked record</option>${groups.map(group => group.records.length
      ? `<optgroup label="${group.label}">${group.records.map(record => `<option value="${escapeHtml(record.value)}">${escapeHtml(record.name + (record.detail ? ` - ${record.detail}` : ''))}</option>`).join('')}</optgroup>`
      : '').join('')}`;
    select.value = records.some(record => record.value === selected) ? selected : '';

    const query = $('#dailyTaskRelatedSearch').value.trim().toLowerCase();
    const matchingRecords = records.filter(record => record.searchText.includes(query));
    const list = $('#dailyTaskRelatedList');
    const noLinkedSelected = select.value === '';
    const noLinkedOption = `<div class="daily-task-related-option${noLinkedSelected ? ' is-selected' : ''}" role="option" aria-selected="${noLinkedSelected}" tabindex="-1" data-related-value=""><span class="daily-task-related-option-icon is-neutral"><i class="fa-solid fa-link-slash" aria-hidden="true"></i></span><span class="daily-task-related-option-copy"><strong>No linked record</strong><small>Keep this task independent</small></span>${noLinkedSelected ? '<i class="fa-solid fa-check daily-task-related-check" aria-hidden="true"></i>' : ''}</div>`;
    const groupsMarkup = groups.map(group => {
      const groupRecords = group.records.filter(record => record.searchText.includes(query));
      if (!groupRecords.length) return '';
      const type = group.label === 'Active clients' ? 'client' : 'application';
      const icon = type === 'client' ? 'fa-user-tie' : 'fa-briefcase';
      return `<section class="daily-task-related-group" role="group" aria-label="${group.label}"><div class="daily-task-related-group-heading"><span>${group.label}</span><small>${groupRecords.length}</small></div>${groupRecords.map(record => {
        const isSelected = record.value === select.value;
        return `<div class="daily-task-related-option${isSelected ? ' is-selected' : ''}" role="option" aria-selected="${isSelected}" tabindex="-1" data-related-value="${escapeHtml(record.value)}"><span class="daily-task-related-option-icon ${type === 'client' ? 'is-client' : 'is-application'}"><i class="fa-solid ${icon}" aria-hidden="true"></i></span><span class="daily-task-related-option-copy"><strong>${escapeHtml(record.name)}</strong>${record.detail ? `<small>${escapeHtml(record.detail)}</small>` : ''}</span>${isSelected ? '<i class="fa-solid fa-check daily-task-related-check" aria-hidden="true"></i>' : ''}</div>`;
      }).join('')}</section>`;
    }).join('');
    list.innerHTML = `${noLinkedOption}${groupsMarkup}${query && !matchingRecords.length ? '<p class="daily-task-related-empty">No matching clients or applications.</p>' : ''}`;
    $('#dailyTaskRelatedValue').textContent = select.value
      ? (() => {
        const record = records.find(item => item.value === select.value);
        return record ? record.name : 'No linked record';
      })()
      : 'No linked record';
    const selectedRecord = records.find(record => record.value === select.value);
    $('#dailyTaskRelatedTrigger').querySelector('small').textContent = selectedRecord
      ? selectedRecord.detail || (select.value.startsWith('client:') ? 'Active client' : 'Application')
      : 'Optional — connect it to a client or application';
  }

  function setDailyTaskRelatedPickerOpen(open, focusSearch = false) {
    const trigger = $('#dailyTaskRelatedTrigger');
    const popover = $('#dailyTaskRelatedPopover');
    trigger.setAttribute('aria-expanded', String(open));
    popover.classList.toggle('hidden', !open);
    if (open) {
      dailyTaskRelatedOptions();
      const triggerBounds = trigger.getBoundingClientRect();
      const desiredHeight = Math.min(360, window.innerHeight - 24);
      const spaceBelow = window.innerHeight - triggerBounds.bottom - 12;
      const spaceAbove = triggerBounds.top - 12;
      const openBelow = spaceBelow >= 210 || spaceBelow >= spaceAbove;
      const availableSpace = Math.max(160, Math.min(desiredHeight, openBelow ? spaceBelow : spaceAbove));
      const width = Math.min(triggerBounds.width, window.innerWidth - 24);
      const left = Math.max(12, Math.min(triggerBounds.left, window.innerWidth - width - 12));
      const top = openBelow
        ? Math.min(window.innerHeight - availableSpace - 12, triggerBounds.bottom + 6)
        : Math.max(12, triggerBounds.top - availableSpace - 6);
      popover.style.width = `${width}px`;
      popover.style.maxHeight = `${availableSpace}px`;
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
      $('#dailyTaskRelatedList').style.maxHeight = `${Math.max(90, availableSpace - 61)}px`;
      if (focusSearch) $('#dailyTaskRelatedSearch').focus();
    } else {
      $('#dailyTaskRelatedSearch').value = '';
      dailyTaskRelatedOptions();
    }
  }

  function moveDailyTaskRelatedOption(currentOption, direction) {
    const options = [...$('#dailyTaskRelatedList').querySelectorAll('[role="option"]')];
    if (!options.length) return;
    const currentIndex = options.indexOf(currentOption);
    const nextIndex = currentIndex < 0
      ? (direction > 0 ? 0 : options.length - 1)
      : Math.max(0, Math.min(options.length - 1, currentIndex + direction));
    options[nextIndex].focus();
  }

  function dailyTaskRelatedName(task) {
    const related = data.applications.find(item => item.id === task.relatedId);
    return related ? related.clientName || related.role || task.relatedName : task.relatedName;
  }

  function renderDailyTaskChecklist(task) {
    const checklist = Array.isArray(task.checklist) ? task.checklist : [];
    const completedCount = checklist.filter(item => item.completed).length;
    $('#dailyTaskDetailChecklistCount').textContent = `${completedCount} of ${checklist.length}`;
    $('#dailyTaskDetailChecklist').innerHTML = checklist.length
      ? checklist.map((item, index) => `<div class="daily-task-check-item${item.completed ? ' is-checked' : ''}"><span class="daily-task-check-number" aria-hidden="true">${index + 1}</span><label><input type="checkbox" data-daily-task-check="${escapeHtml(item.id)}" data-task-id="${escapeHtml(task.id)}" ${item.completed ? 'checked' : ''} /><span>${escapeHtml(item.text)}</span></label><button class="daily-task-check-delete" type="button" data-daily-task-check-delete="${escapeHtml(item.id)}" data-task-id="${escapeHtml(task.id)}" aria-label="Remove checklist item: ${escapeHtml(item.text)}" title="Remove item"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button></div>`).join('')
      : '<p class="daily-task-checklist-empty">No checklist items yet.</p>';
  }

  function renderDailyTaskDraftChecklist() {
    $('#dailyTaskDraftChecklistCount').textContent = plural(pendingDailyTaskChecklist.length, 'item');
    $('#dailyTaskDraftChecklist').innerHTML = pendingDailyTaskChecklist.map((item, index) => `<li><span>${escapeHtml(item.text)}</span><button type="button" data-daily-task-draft-delete="${escapeHtml(item.id)}" aria-label="Remove checklist item: ${escapeHtml(item.text)}" title="Remove item"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button></li>`).join('');
  }

  function addDailyTaskDraftChecklistItem() {
    const input = $('#dailyTaskChecklistInput');
    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }
    pendingDailyTaskChecklist.push({ id: uid(), text, completed: false });
    input.value = '';
    renderDailyTaskDraftChecklist();
    input.focus();
  }

  function resetDailyTaskDraft() {
    $('#dailyTaskForm').reset();
    pendingDailyTaskChecklist = [];
    $('#dailyTaskDestinationField').classList.add('hidden');
    setDailyTaskRelatedPickerOpen(false);
    renderDailyTaskDraftChecklist();
  }

  function closeDailyTaskAddModal() {
    $('#dailyTaskAddModal').close();
  }

  function renderDailyTaskDetails(task) {
    const relatedName = dailyTaskRelatedName(task);
    const relatedLabel = task.relatedType === 'client' ? 'Client' : task.relatedType === 'application' ? 'Application' : '';
    const completed = Boolean(task.completedAt);
    $('#dailyTaskDetailTitle').textContent = task.title || 'Untitled task';
    $('#dailyTaskDetailSummary').innerHTML = `
      <div class="daily-task-detail-facts">
        <div><span>Type</span><strong>${escapeHtml(DAILY_TASK_TYPES[task.type] || DAILY_TASK_TYPES.task)}</strong></div>
        <div><span>Planned for</span><strong>${escapeHtml(formatDate(task.taskDate))}</strong></div>
        <div><span>Status</span><strong class="daily-task-detail-status${completed ? ' is-complete' : ''}">${completed ? 'Completed' : 'Pending'}</strong></div>
        ${relatedName ? `<div><span>${relatedLabel}</span><strong>${escapeHtml(relatedName)}</strong></div>` : ''}
        ${task.destination ? `<div><span>Apply destination</span><strong>${escapeHtml(task.destination)}</strong></div>` : ''}
      </div>
      ${task.notes ? `<section class="daily-task-detail-notes"><span>Notes or content</span><p>${escapeHtml(task.notes)}</p></section>` : ''}
      <button class="button ${completed ? 'button-secondary' : 'button-primary'} daily-task-detail-complete" type="button" data-daily-task-toggle="${escapeHtml(task.id)}"><i class="fa-solid ${completed ? 'fa-rotate-left' : 'fa-check'}" aria-hidden="true"></i> ${completed ? 'Reopen task' : 'Complete task'}</button>`;
    $('#dailyTaskChecklistForm').hidden = completed;
    $('#dailyTaskChecklistLocked').hidden = !completed;
    renderDailyTaskChecklist(task);
  }

  function openDailyTaskDetails(taskId) {
    const task = (data.dailyTasks || []).find(item => item.id === taskId);
    if (!task) return;
    activeDailyTaskId = task.id;
    renderDailyTaskDetails(task);
    $('#dailyTaskDetailModal').showModal();
  }

  function renderDailyTaskItem(task, history = false) {
    const completed = Boolean(task.completedAt);
    const actionLabel = completed ? 'Mark incomplete' : 'Mark complete';
    return `
      <article class="daily-task-item${completed ? ' is-complete' : ''}${history ? ' is-history' : ''}">
        <button class="daily-task-action" type="button" data-daily-task-toggle="${escapeHtml(task.id)}" aria-label="${actionLabel}: ${escapeHtml(task.title || 'task')}" aria-pressed="${completed}" title="${actionLabel}"><i class="fa-solid fa-check" aria-hidden="true"></i></button>
        <button class="daily-task-row-open" type="button" data-daily-task-open="${escapeHtml(task.id)}" aria-label="View details for ${escapeHtml(task.title || 'task')}">
          <span class="daily-task-item-title">${escapeHtml(task.title || 'Untitled task')}</span>
        </button>
        ${dailyTaskDateStatus(task)}
        <button class="daily-task-delete" type="button" data-daily-task-delete="${escapeHtml(task.id)}" aria-label="Delete task: ${escapeHtml(task.title || 'task')}" title="Delete task"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>
      </article>`;
  }

  function renderDailyTasks() {
    const planDate = $('#dailyTaskDate');
    const historyDate = $('#dailyTaskHistoryDate');
    if (!planDate || !historyDate) return;
    if (!planDate.value) planDate.value = today();
    if (!historyDate.value) historyDate.value = planDate.value;
    dailyTaskRelatedOptions();
    const selectedDate = planDate.value;
    const allTasks = data.dailyTasks || [];
    const dateTasks = allTasks.filter(task => task.taskDate === selectedDate);
    const overdueTasks = allTasks.filter(task => !task.completedAt && task.taskDate < today());
    const completedCount = dateTasks.filter(task => task.completedAt).length;
    const remainingCount = dateTasks.length - completedCount;
    const dateLabel = formatDate(selectedDate);
    $('#dailyTaskHeaderDate').textContent = dateLabel;
    $('#dailyTaskDateLabel').textContent = dateLabel;
    $('#dailyTaskToday').disabled = selectedDate === today();
    $('#dailyTaskScheduledCount').textContent = dateTasks.length;
    $('#dailyTaskCompletedCount').textContent = completedCount;
    $('#dailyTaskRemainingCount').textContent = remainingCount;
    $('#dailyTaskOverdueCount').textContent = overdueTasks.length;
    const overdueButton = $('#dailyTaskOverdueFilter');
    overdueButton.hidden = overdueTasks.length === 0;
    overdueButton.classList.toggle('has-overdue', overdueTasks.length > 0);
    overdueButton.classList.toggle('is-active', dailyTaskFilter === 'overdue');
    $('#dailyTaskProgressLabel').textContent = `${completedCount} of ${dateTasks.length} done`;
    const progress = $('#dailyTaskProgress');
    progress.setAttribute('aria-valuemax', String(dateTasks.length));
    progress.setAttribute('aria-valuenow', String(completedCount));
    progress.querySelector('span').style.width = `${dateTasks.length ? Math.round(completedCount / dateTasks.length * 100) : 0}%`;
    const overdueIds = new Set(overdueTasks.map(task => task.id));
    const query = $('#dailyTaskSearch').value.trim().toLowerCase();
    const matchesSearch = task => !query || [
      task.title, task.notes, task.destination, task.relatedName,
      DAILY_TASK_TYPES[task.type] || task.type,
      dailyTaskRelatedName(task)
    ].join(' ').toLowerCase().includes(query);
    const visibleOverdueTasks = overdueTasks.filter(matchesSearch);
    const sortTasks = tasks => tasks.sort((first, second) => String(first.createdAt || '').localeCompare(String(second.createdAt || '')));
    const selectedTasks = dateTasks.filter(task => dailyTaskFilter === 'completed'
      ? Boolean(task.completedAt)
      : dailyTaskFilter === 'remaining'
        ? !task.completedAt
        : true).filter(matchesSearch);
    const tasks = dailyTaskFilter === 'overdue'
      ? sortTasks([...visibleOverdueTasks])
      : dailyTaskFilter === 'all'
        ? [...sortTasks([...visibleOverdueTasks]), ...sortTasks(selectedTasks.filter(task => !overdueIds.has(task.id)))]
        : sortTasks(selectedTasks);
    $('#navDailyTaskCount').textContent = allTasks.filter(task => task.taskDate === today()).length;
    $('#dailyTaskListTitle').textContent = 'Tasks';
    const overdueGroup = (dailyTaskFilter === 'all' || dailyTaskFilter === 'overdue') && visibleOverdueTasks.length
      ? `<h4 class="daily-task-overdue-heading">Overdue</h4>${sortTasks([...visibleOverdueTasks]).map(task => renderDailyTaskItem(task)).join('')}`
      : '';
    const nonOverdueTasks = dailyTaskFilter === 'all'
      ? tasks.filter(task => !overdueIds.has(task.id))
      : dailyTaskFilter === 'overdue' ? [] : tasks;
    const taskMarkup = `${overdueGroup}${nonOverdueTasks.map(task => renderDailyTaskItem(task)).join('')}`;
    $('#dailyTaskList').innerHTML = tasks.length
      ? taskMarkup
      : `<div class="daily-task-empty"><i class="fa-regular ${query ? 'fa-face-frown' : 'fa-circle-check'}" aria-hidden="true"></i><span>${query ? 'No tasks match your search.' : dailyTaskFilter === 'all' && selectedDate === today() || dailyTaskFilter === 'overdue' ? 'You’re all caught up.' : dailyTaskFilter === 'completed' ? 'No completed tasks for this date.' : dailyTaskFilter === 'remaining' ? 'No remaining tasks for this date.' : 'No tasks planned for this date.'}</span></div>`;

    const historyTasks = (data.dailyTasks || []).filter(task => task.completedAt && dateKey(task.completedAt) === historyDate.value)
      .filter(matchesSearch)
      .sort((first, second) => String(second.completedAt).localeCompare(String(first.completedAt)));
    $('#dailyTaskHistoryCount').textContent = historyTasks.length;
    $('#dailyTaskHistoryList').innerHTML = historyTasks.length
      ? historyTasks.map(task => renderDailyTaskItem(task, true)).join('')
      : '<div class="daily-task-history-empty"><i class="fa-regular fa-calendar-check" aria-hidden="true"></i><span>No completed tasks for this date yet.</span></div>';
    if ($('#dailyTaskDetailModal').open) {
      const activeTask = (data.dailyTasks || []).find(task => task.id === activeDailyTaskId);
      if (activeTask) renderDailyTaskDetails(activeTask);
      else $('#dailyTaskDetailModal').close();
    }
    renderAlerts();
  }

  $('#dailyTaskType').addEventListener('change', event => {
    $('#dailyTaskDestinationField').classList.toggle('hidden', event.target.value !== 'apply');
  });
  $('#dailyTaskRelatedTrigger').addEventListener('click', () => {
    setDailyTaskRelatedPickerOpen($('#dailyTaskRelatedTrigger').getAttribute('aria-expanded') !== 'true', true);
  });
  $('#dailyTaskRelatedSearch').addEventListener('input', dailyTaskRelatedOptions);
  $('#dailyTaskRelatedSearch').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      moveDailyTaskRelatedOption(null, 1);
    }
  });
  $('#dailyTaskRelatedPicker').addEventListener('click', event => {
    const option = event.target.closest('[data-related-value]');
    if (!option) return;
    $('#dailyTaskRelated').value = option.dataset.relatedValue;
    dailyTaskRelatedOptions();
    setDailyTaskRelatedPickerOpen(false);
    $('#dailyTaskRelatedTrigger').focus();
  });
  $('#dailyTaskRelatedPicker').addEventListener('focusout', () => {
    setTimeout(() => {
      if (!$('#dailyTaskRelatedPicker').contains(document.activeElement) && $('#dailyTaskRelatedTrigger').getAttribute('aria-expanded') === 'true') {
        setDailyTaskRelatedPickerOpen(false);
      }
    }, 0);
  });
  $('#dailyTaskRelatedPicker').addEventListener('keydown', event => {
    const option = event.target.closest('[role="option"]');
    if (event.key === 'Escape') {
      event.preventDefault();
      setDailyTaskRelatedPickerOpen(false);
      $('#dailyTaskRelatedTrigger').focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveDailyTaskRelatedOption(option, event.key === 'ArrowDown' ? 1 : -1);
    } else if (option && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      option.click();
    } else if (option && event.key === 'Home') {
      event.preventDefault();
      moveDailyTaskRelatedOption(null, 1);
    } else if (option && event.key === 'End') {
      event.preventDefault();
      moveDailyTaskRelatedOption(null, -1);
    }
  });
  document.addEventListener('click', event => {
    const picker = $('#dailyTaskRelatedPicker');
    if (!picker.contains(event.target) && $('#dailyTaskRelatedTrigger').getAttribute('aria-expanded') === 'true') {
      setDailyTaskRelatedPickerOpen(false);
    }
  });
  window.addEventListener('resize', () => {
    if ($('#dailyTaskRelatedTrigger').getAttribute('aria-expanded') === 'true') setDailyTaskRelatedPickerOpen(false);
  });
  $('#dailyTaskAddModal').addEventListener('scroll', () => {
    if ($('#dailyTaskRelatedTrigger').getAttribute('aria-expanded') === 'true') setDailyTaskRelatedPickerOpen(false);
  });
  $('#openDailyTaskAddModal').addEventListener('click', () => {
    resetDailyTaskDraft();
    $('#dailyTaskAddModal').showModal();
    $('#dailyTaskTitle').focus();
  });
  $('#closeDailyTaskAddModal')?.addEventListener('click', closeDailyTaskAddModal);
  $('#cancelDailyTaskAddModal').addEventListener('click', closeDailyTaskAddModal);
  $('#dailyTaskAddModal').addEventListener('close', resetDailyTaskDraft);
  $('#dailyTaskAddChecklistButton').addEventListener('click', addDailyTaskDraftChecklistItem);
  $('#dailyTaskChecklistInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addDailyTaskDraftChecklistItem();
    }
  });
  $('#dailyTaskDate').addEventListener('change', () => {
    $('#dailyTaskHistoryDate').value = $('#dailyTaskDate').value;
    renderDailyTasks();
  });
  $('#dailyTaskDateLabel').addEventListener('click', () => {
    const input = $('#dailyTaskDate');
    if (typeof input.showPicker === 'function') input.showPicker();
    else input.click();
  });
  $('#dailyTaskPreviousDate').addEventListener('click', () => {
    $('#dailyTaskDate').value = addDays($('#dailyTaskDate').value, -1);
    $('#dailyTaskHistoryDate').value = $('#dailyTaskDate').value;
    renderDailyTasks();
  });
  $('#dailyTaskNextDate').addEventListener('click', () => {
    $('#dailyTaskDate').value = addDays($('#dailyTaskDate').value, 1);
    $('#dailyTaskHistoryDate').value = $('#dailyTaskDate').value;
    renderDailyTasks();
  });
  $('#dailyTaskToday').addEventListener('click', () => {
    $('#dailyTaskDate').value = today();
    $('#dailyTaskHistoryDate').value = today();
    renderDailyTasks();
  });
  $('#dailyTaskHistoryDate').addEventListener('change', renderDailyTasks);
  $('#dailyTaskSearch').addEventListener('input', renderDailyTasks);
  $('#dailyTaskQuickAdd').addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.value = '';
      renderDailyTasks();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const title = event.currentTarget.value.trim();
      if (!title) return;
      data.dailyTasks = data.dailyTasks || [];
      data.dailyTasks.push({
        id: uid(),
        title,
        type: 'task',
        taskDate: $('#dailyTaskDate').value || today(),
        relatedType: '',
        relatedId: '',
        relatedName: '',
        destination: '',
        notes: '',
        checklist: [],
        createdAt: new Date().toISOString(),
        completedAt: ''
      });
      event.currentTarget.value = '';
      persist();
      renderDailyTasks();
      event.currentTarget.focus();
    }
  });
  $('#dailyTaskFilter').addEventListener('change', event => {
    dailyTaskFilter = event.target.value;
    renderDailyTasks();
  });
  $('#dailyTaskOverdueFilter').addEventListener('click', () => {
    dailyTaskFilter = 'overdue';
    $('#dailyTaskFilter').value = 'overdue';
    renderDailyTasks();
  });
  $('#dailyTaskForm').addEventListener('submit', event => {
    event.preventDefault();
    const title = $('#dailyTaskTitle').value.trim();
    if (!title) return;
    const [relatedType = '', relatedId = ''] = $('#dailyTaskRelated').value.split(':');
    const relatedRecord = relatedId ? data.applications.find(item => item.id === relatedId) : null;
    data.dailyTasks = data.dailyTasks || [];
    data.dailyTasks.push({
      id: uid(),
      title,
      type: $('#dailyTaskType').value,
      taskDate: $('#dailyTaskDate').value || today(),
      relatedType,
      relatedId,
      relatedName: relatedRecord?.clientName || relatedRecord?.role || '',
      destination: $('#dailyTaskType').value === 'apply' ? $('#dailyTaskDestination').value.trim() : '',
      notes: $('#dailyTaskNotes').value.trim(),
      checklist: pendingDailyTaskChecklist.map(item => ({ ...item })),
      createdAt: new Date().toISOString(),
      completedAt: ''
    });
    persist();
    closeDailyTaskAddModal();
    renderDailyTasks();
    $('#openDailyTaskAddModal').focus();
  });
  $('#dailyTaskDetailModal').addEventListener('close', () => { activeDailyTaskId = ''; });
  $('#closeDailyTaskDetails')?.addEventListener('click', () => $('#dailyTaskDetailModal').close());
  $('#closeDailyTaskDetailsAction').addEventListener('click', () => $('#dailyTaskDetailModal').close());
  $('#dailyTaskChecklistForm').addEventListener('submit', event => {
    event.preventDefault();
    const task = (data.dailyTasks || []).find(item => item.id === activeDailyTaskId);
    const text = $('#dailyTaskChecklistItemInput').value.trim();
    if (!task || task.completedAt || !text) return;
    task.checklist = task.checklist || [];
    task.checklist.push({ id: uid(), text, completed: false });
    persist();
    event.currentTarget.reset();
    renderDailyTasks();
    $('#dailyTaskChecklistItemInput').focus();
  });

  document.addEventListener('change', event => {
    const checkbox = event.target.closest('[data-daily-task-check]');
    if (!checkbox) return;
    const task = (data.dailyTasks || []).find(item => item.id === checkbox.dataset.taskId);
    const checklistItem = task?.checklist?.find(item => item.id === checkbox.dataset.dailyTaskCheck);
    if (!checklistItem) return;
    checklistItem.completed = checkbox.checked;
    persist();
    renderDailyTasks();
  });

  document.addEventListener('click', async event => {
    const openButton = event.target.closest('[data-daily-task-open]');
    if (openButton) {
      openDailyTaskDetails(openButton.dataset.dailyTaskOpen);
      return;
    }
    const checklistDeleteButton = event.target.closest('[data-daily-task-check-delete]');
    if (checklistDeleteButton) {
      const task = (data.dailyTasks || []).find(item => item.id === checklistDeleteButton.dataset.taskId);
      if (!task) return;
      task.checklist = (task.checklist || []).filter(item => item.id !== checklistDeleteButton.dataset.dailyTaskCheckDelete);
      persist();
      renderDailyTasks();
      return;
    }
    const historyShortcut = event.target.closest('[data-task-history-offset]');
    if (historyShortcut) {
      $('#dailyTaskHistoryDate').value = addDays(today(), Number(historyShortcut.dataset.taskHistoryOffset));
      renderDailyTasks();
      return;
    }
    const undoButton = event.target.closest('#undoDailyTaskDelete');
    if (undoButton && pendingDailyTaskUndo) {
      clearTimeout(dailyTaskUndoTimer);
      const { task, index } = pendingDailyTaskUndo;
      data.dailyTasks = data.dailyTasks || [];
      data.dailyTasks.splice(Math.min(index, data.dailyTasks.length), 0, task);
      pendingDailyTaskUndo = null;
      $('#dailyTaskUndoToast').hidden = true;
      persist();
      renderDailyTasks();
      return;
    }
    const toggleButton = event.target.closest('[data-daily-task-toggle]');
    if (toggleButton) {
      const task = (data.dailyTasks || []).find(item => item.id === toggleButton.dataset.dailyTaskToggle);
      if (!task) return;
      task.completedAt = task.completedAt ? '' : new Date().toISOString();
      persist();
      renderDailyTasks();
      return;
    }
    const deleteButton = event.target.closest('[data-daily-task-delete]');
    if (deleteButton) {
      const index = (data.dailyTasks || []).findIndex(item => item.id === deleteButton.dataset.dailyTaskDelete);
      if (index < 0) return;
      const [task] = data.dailyTasks.splice(index, 1);
      pendingDailyTaskUndo = { task, index };
      const undoToast = $('#dailyTaskUndoToast');
      undoToast.hidden = false;
      clearTimeout(dailyTaskUndoTimer);
      dailyTaskUndoTimer = setTimeout(() => {
        pendingDailyTaskUndo = null;
        undoToast.hidden = true;
      }, 5000);
      persist();
      renderDailyTasks();
    }
  });
  document.addEventListener('click', event => {
    const deleteDraftButton = event.target.closest('[data-daily-task-draft-delete]');
    if (!deleteDraftButton) return;
    pendingDailyTaskChecklist = pendingDailyTaskChecklist.filter(item => item.id !== deleteDraftButton.dataset.dailyTaskDraftDelete);
    renderDailyTaskDraftChecklist();
  });

  document.addEventListener('keydown', event => {
    if (!$('#dailyTaskView').classList.contains('active') || $('#dailyTaskAddModal').open || $('#dailyTaskDetailModal').open) return;
    const target = event.target;
    const editing = target instanceof HTMLElement
      && (target.matches('input, textarea, select, [contenteditable="true"]') || target.closest('[contenteditable="true"]'));
    if ((event.key === 'n' || event.key === 'N') && !editing && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      $('#dailyTaskQuickAdd').focus();
      return;
    }
    const taskButton = target instanceof Element ? target.closest('[data-daily-task-open]') : null;
    if (taskButton && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      const task = (data.dailyTasks || []).find(item => item.id === taskButton.dataset.dailyTaskOpen);
      if (!task) return;
      task.completedAt = task.completedAt ? '' : new Date().toISOString();
      persist();
      renderDailyTasks();
      document.querySelector(`[data-daily-task-open="${CSS.escape(task.id)}"]`)?.focus();
    }
  });

  renderDailyTasks();

  // Active Clients page controls, including its document and invoice tools.
  let activeClientDrawerOpen = false;
  let activeClientDrawerView = 'list';
  let activeClientDrawerReturnFocus = null;
  let activeClientDrawerCloseTimer = null;
  const activeClientDrawerBaselines = new Map();

  function isActiveClientDrawerOpen() {
    return activeClientDrawerOpen;
  }

  function isActiveClientDrawerView(view) {
    return activeClientDrawerOpen && activeClientDrawerView === view;
  }

  function activeClientDrawerFormSnapshot(form) {
    return JSON.stringify([...form.elements].map(field => ({
      id: field.id,
      type: field.type,
      value: field.type === 'checkbox' || field.type === 'radio'
        ? field.checked
        : field.type === 'file'
          ? [...(field.files || [])].map(file => file.name)
          : field.value
    })));
  }

  function activeClientDrawerFormChanged(view) {
    const baseline = activeClientDrawerBaselines.get(view);
    const form = view === 'email' ? $('#emailComposeForm') : $('#clientForm');
    return Boolean(baseline && form && activeClientDrawerFormSnapshot(form) !== baseline);
  }

  function markActiveClientDrawerFormClean(view) {
    const form = view === 'email' ? $('#emailComposeForm') : $('#clientForm');
    if (form) activeClientDrawerBaselines.set(view, activeClientDrawerFormSnapshot(form));
  }

  function resetActiveClientDrawerForm(view) {
    const form = view === 'email' ? $('#emailComposeForm') : $('#clientForm');
    const baseline = activeClientDrawerBaselines.get(view);
    if (!form || !baseline) return;
    const values = JSON.parse(baseline);
    [...form.elements].forEach((field, index) => {
      const initial = values[index];
      if (!initial) return;
      if (field.type === 'file') {
        field.value = '';
        return;
      }
      if (field.type === 'checkbox' || field.type === 'radio') field.checked = initial.value;
      else field.value = initial.value;
    });
  }

  function mountActiveClientDrawerForm(formId, slotId) {
    const form = $(`#${formId}`);
    const slot = $(`#${slotId}`);
    if (!form || !slot || form.parentElement === slot) return;
    form.dataset.drawerOriginalMethod = form.getAttribute('method') || '';
    form.setAttribute('method', 'post');
    slot.append(form);
    if (formId === 'emailComposeForm') $('#sendEmailButton').textContent = 'Send';
    if (formId === 'clientForm') $('#closeClientDetailsButton').textContent = 'Cancel';
  }

  function restoreActiveClientDrawerForms() {
    [
      ['emailComposeForm', 'emailComposeModal'],
      ['clientForm', 'clientModal']
    ].forEach(([formId, modalId]) => {
      const form = $(`#${formId}`);
      const modal = $(`#${modalId}`);
      if (!form || !modal || !form.dataset.drawerOriginalMethod) return;
      form.setAttribute('method', form.dataset.drawerOriginalMethod);
      delete form.dataset.drawerOriginalMethod;
      modal.append(form);
    });
    $('#sendEmailButton').textContent = 'Send email';
    $('#closeClientDetailsButton').textContent = 'Close';
    activeClientDrawerBaselines.clear();
  }

  function showActiveClientDrawerView(view) {
    const layer = $('#activeClientDrawerLayer');
    const title = $('#activeClientActionsTitle');
    const back = $('#activeClientDrawerBack');
    const close = $('#closeActiveClientDrawer');
    const client = data.applications.find(application => application.id === hiredEditingId);
    if (!layer || !client) return;
    activeClientDrawerView = view;
    $('#activeClientDrawerList').hidden = view !== 'list';
    $('#activeClientDrawerEmailView').hidden = view !== 'email';
    $('#activeClientDrawerOnboardingView').hidden = view !== 'onboarding';
    $('#activeClientDrawerEditView').hidden = view !== 'edit';
    back.hidden = view === 'list';
    if (close) close.hidden = view === 'email';
    title.textContent = view === 'list'
      ? client.clientName || 'Active client'
      : view === 'email'
        ? 'Send email'
        : view === 'onboarding'
          ? 'Request corrected onboarding details'
          : 'Edit details';
    $('#activeClientDrawerClientName').textContent = view === 'list'
      ? client.role || client.service || ''
      : client.clientName || 'Active client';
    if (view === 'email') mountActiveClientDrawerForm('emailComposeForm', 'activeClientDrawerEmailSlot');
    if (view === 'edit') mountActiveClientDrawerForm('clientForm', 'activeClientDrawerClientFormSlot');
    layer.dataset.view = view;
    document.body.style.setProperty('--active-client-drawer-width', `${$('#activeClientDrawer').getBoundingClientRect().width}px`);
  }

  function openActiveClientActionsDrawer(trigger) {
    const detailClientId = $('#hiredDetailPanel')?.dataset.clientId;
    const clientId = hiredEditingId || detailClientId;
    const client = data.applications.find(application => application.id === clientId);
    if (!client) return;
    hiredEditingId = client.id;
    const layer = $('#activeClientDrawerLayer');
    activeClientDrawerReturnFocus = trigger;
    activeClientDrawerOpen = true;
    activeClientDrawerView = 'list';
    clearTimeout(activeClientDrawerCloseTimer);
    document.body.style.setProperty('--active-client-drawer-width', `${$('#activeClientDrawer').getBoundingClientRect().width}px`);
    layer.hidden = false;
    layer.setAttribute('aria-hidden', 'false');
    layer.classList.remove('closing');
    document.body.classList.add('active-client-drawer-open');
    $('#activeClientGeneratedLink').hidden = true;
    $('#activeClientOnboardingUrl').value = '';
    $('#activeClientOnboardingStatus').textContent = '';
    $('#activeClientDrawerList [data-active-client-action="contract-email"]').hidden = isContractEnded(client);
    $('#activeClientDrawerList [data-active-client-action="send-invoice"]').hidden = isContractEnded(client);
    $('#activeClientDrawerList [data-active-client-action="new-task"]').hidden = isContractEnded(client);
    showActiveClientDrawerView('list');
    requestAnimationFrame(() => {
      if (!activeClientDrawerOpen) return;
      layer.classList.add('open');
      $('#activeClientDrawerList [data-active-client-action]')?.focus();
    });
  }

  $('#activeClientActionsButton')?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    openActiveClientActionsDrawer(event.currentTarget);
  });

  async function closeActiveClientActionsDrawer(force = false, onClosed = null) {
    if (!activeClientDrawerOpen) {
      onClosed?.();
      return;
    }
    const changedViews = ['email', 'edit'].filter(activeClientDrawerFormChanged);
    if (!force && changedViews.length
      && !window.confirm('Discard unsaved changes and close client actions?')) return;
    if (!force) changedViews.forEach(resetActiveClientDrawerForm);
    activeClientDrawerOpen = false;
    const layer = $('#activeClientDrawerLayer');
    layer.classList.add('closing');
    layer.classList.remove('open');
    layer.setAttribute('aria-hidden', 'true');
    activeClientDrawerCloseTimer = setTimeout(() => {
      layer.hidden = true;
      layer.classList.remove('closing');
      document.body.classList.remove('active-client-drawer-open');
      document.body.style.removeProperty('--active-client-drawer-width');
      restoreActiveClientDrawerForms();
      updateClientActionLabel();
      activeClientDrawerReturnFocus?.focus();
      activeClientDrawerReturnFocus = null;
      onClosed?.();
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 270);
  }

  window.addEventListener('resize', () => {
    if (activeClientDrawerOpen) {
      document.body.style.setProperty('--active-client-drawer-width', `${$('#activeClientDrawer').getBoundingClientRect().width}px`);
    }
  });

  function drawerTabStops() {
    return $$('#activeClientDrawer button:not([disabled]), #activeClientDrawer input:not([disabled]), #activeClientDrawer select:not([disabled]), #activeClientDrawer textarea:not([disabled]), #activeClientDrawer a[href]')
      .filter(element => !element.closest('[hidden]') && element.getClientRects().length);
  }

  $('#closeActiveClientDrawer')?.addEventListener('click', () => closeActiveClientActionsDrawer());
  $('#activeClientDrawerBackdrop').addEventListener('click', () => closeActiveClientActionsDrawer());
  $('#activeClientDrawerBack').addEventListener('click', () => {
    if (activeClientDrawerFormChanged(activeClientDrawerView)) {
      if (!window.confirm('Discard unsaved changes and return to actions?')) return;
      resetActiveClientDrawerForm(activeClientDrawerView);
    }
    showActiveClientDrawerView('list');
    $('#activeClientDrawerList [data-active-client-action]')?.focus();
  });
  document.addEventListener('keydown', event => {
    if (!activeClientDrawerOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeActiveClientActionsDrawer();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = drawerTabStops();
    if (!stops.length) {
      event.preventDefault();
      $('#activeClientDrawer').focus();
      return;
    }
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (event.shiftKey && (document.activeElement === first || !$('#activeClientDrawer').contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !$('#activeClientDrawer').contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }, true);
  $('#activeClientDrawerLayer').addEventListener('click', event => {
    if (activeClientDrawerOpen && event.target.closest('#closeClientDetailsButton, #cancelActivationEmailButton, .active-client-drawer-cancel')) {
      event.preventDefault();
      event.stopPropagation();
      closeActiveClientActionsDrawer();
    }
  });

  document.addEventListener('click', event => {
    const avatarUploadButton = event.target.closest('[data-client-avatar-upload]');
    const avatarInput = event.target.closest('[data-client-avatar-input]');
    if (!avatarUploadButton && !avatarInput) return;
    event.stopPropagation();
    if (!avatarUploadButton) return;
    event.preventDefault();
    openClientAvatarUpload(avatarUploadButton.dataset.clientAvatarUpload);
  }, true);

  document.addEventListener('click', async event => {
    const clientDetailTab = event.target.closest('#hiredDetailPanel [data-client-detail-tab]');
    if (clientDetailTab) {
      selectClientDetailTab(clientDetailTab.dataset.clientDetailTab);
      return;
    }
    const deleteActiveButton = event.target.closest('#deleteActiveClient');
    const activeClientActionsButton = event.target.closest('#activeClientActionsButton');
    const invoicePaymentButton = event.target.closest('[data-invoice-mark-paid], [data-invoice-edit-payment], [data-invoice-mark-unpaid]');
    const actionRow = event.target.closest('[data-active-client-action]');
    const generateOnboardingLinkButton = event.target.closest('#generateClientOnboardingLinkButton');
    const copyOnboardingLinkButton = event.target.closest('#copyActiveClientOnboardingUrl');
    const hiredSelectButton = event.target.closest('[data-hired-select]');
    const docOpenButton = event.target.closest('[data-doc-open]');
    const docRemoveButton = event.target.closest('[data-doc-remove]');
    const docEmailButton = event.target.closest('[data-doc-email]');
    const documentMenuButton = event.target.closest('.document-menu-button');

    if (activeClientActionsButton) {
      openActiveClientActionsDrawer(activeClientActionsButton);
      return;
    }

    if (actionRow) {
      if (actionRow.dataset.activeClientAction === 'new-task') {
        closeActiveClientActionsDrawer(false, () => {
          selectClientDetailTab('tasks');
          openClientTaskDrawer(null, $('#activeClientActionsButton'));
        });
      } else if (actionRow.dataset.activeClientAction === 'email') {
        const item = data.applications.find(application => application.id === hiredEditingId);
        if (item) openPlainClientEmailComposer(item, true);
      } else if (actionRow.dataset.activeClientAction === 'send-invoice') {
        const client = data.applications.find(application => application.id === hiredEditingId);
        if (client) closeActiveClientActionsDrawer(false, () => openInvoiceDocumentPicker(client));
      } else if (actionRow.dataset.activeClientAction === 'contract-email') {
        const clientId = hiredEditingId;
        const client = data.applications.find(application => application.id === clientId);
        if (!client?.email?.trim()) {
          toast('Add a client email before sending a contract.');
        } else if (!isContractEnded(client)) {
          closeActiveClientActionsDrawer(false, () => openContractEmailUploadModal(clientId));
        }
      } else if (actionRow.dataset.activeClientAction === 'onboarding') {
        showActiveClientDrawerView('onboarding');
        $('#generateClientOnboardingLinkButton').focus();
      } else if (actionRow.dataset.activeClientAction === 'edit') {
        const clientId = hiredEditingId;
        closeActiveClientActionsDrawer(false, () => openClientModal(clientId, false, true, false, true));
      } else if (actionRow.dataset.activeClientAction === 'delete') {
        await deleteClient(hiredEditingId, true);
      }
      return;
    }

    if (generateOnboardingLinkButton) {
      const item = data.applications.find(application => application.id === hiredEditingId);
      if (item) await sendClientOnboardingInvite(item, generateOnboardingLinkButton, true);
      return;
    }

    if (copyOnboardingLinkButton) {
      const status = $('#activeClientOnboardingStatus');
      try {
        await navigator.clipboard.writeText($('#activeClientOnboardingUrl').value);
        status.textContent = 'Onboarding link copied to clipboard.';
        status.className = 'compose-status status-success';
      } catch (error) {
        console.error('Could not copy the onboarding link:', error);
        status.textContent = 'Could not copy automatically. Select and copy the link above.';
        status.className = 'compose-status status-alert';
      }
      return;
    }

    if (deleteActiveButton) {
      deleteClient(hiredEditingId, true);
      return;
    }
    if (invoicePaymentButton) {
      const invoiceId = invoicePaymentButton.dataset.invoiceMarkPaid
        || invoicePaymentButton.dataset.invoiceEditPayment
        || invoicePaymentButton.dataset.invoiceMarkUnpaid;
      if (invoicePaymentButton.hasAttribute('data-invoice-mark-unpaid')) await markInvoiceUnpaid(invoiceId);
      else openInvoicePayment(invoiceId);
      return;
    }
    if (hiredSelectButton && !event.target.closest('a')) {
      renderHiredDetail(data.applications.find(item => item.id === hiredSelectButton.dataset.hiredSelect));
      return;
    }
    if (docOpenButton) {
      openDocument(docOpenButton.dataset.docOpen);
      return;
    }
    if (docRemoveButton) {
      removeHiredDocument(docRemoveButton.dataset.docRemove);
      return;
    }
    if (docEmailButton) {
      const item = data.applications.find(application => (application.documents || []).some(document => document.id === docEmailButton.dataset.docEmail));
      if (item) openUpdatedDocumentEmailComposer(item, docEmailButton.dataset.docEmail);
      return;
    }
    if (documentMenuButton) {
      const menu = documentMenuButton.nextElementSibling;
      const willOpen = menu.classList.contains('hidden');
      document.querySelectorAll('.document-menu').forEach(item => item.classList.add('hidden'));
      document.querySelectorAll('.document-menu-button').forEach(item => item.setAttribute('aria-expanded', 'false'));
      menu.classList.toggle('hidden', !willOpen);
      documentMenuButton.setAttribute('aria-expanded', String(willOpen));
      return;
    }
    if (!event.target.closest('.document-row-menu')) {
      document.querySelectorAll('.document-menu').forEach(item => item.classList.add('hidden'));
      document.querySelectorAll('.document-menu-button').forEach(item => item.setAttribute('aria-expanded', 'false'));
    }
  });

  document.addEventListener('keydown', event => {
    const currentTab = event.target.closest('#hiredDetailPanel [role="tab"][data-client-detail-tab]');
    if (!currentTab) return;
    const tabs = [...$('#hiredDetailPanel').querySelectorAll('[role="tab"][data-client-detail-tab]')];
    const currentIndex = tabs.indexOf(currentTab);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    selectClientDetailTab(tabs[nextIndex].dataset.clientDetailTab, true);
  });

  let clientAvatarCropState = null;
  let clientAvatarCropObjectUrl = '';
  let clientAvatarUploadState = null;
  let clientAvatarUploadObjectUrl = '';

  function clearClientAvatarUploadPreview() {
    if (clientAvatarUploadObjectUrl) URL.revokeObjectURL(clientAvatarUploadObjectUrl);
    clientAvatarUploadObjectUrl = '';
    clientAvatarUploadState = null;
    $('#clientAvatarUploadImage').removeAttribute('src');
    $('#clientAvatarUploadImage').hidden = true;
    $('.client-avatar-upload-placeholder')?.removeAttribute('hidden');
    $('#clientAvatarUploadFile').textContent = 'No picture selected';
    $('#continueClientAvatarUpload').disabled = true;
    $('#removeClientAvatarButton').hidden = true;
  }

  function openClientAvatarUpload(clientId) {
    const item = data.applications.find(application => application.id === clientId);
    if (!item) return;
    clearClientAvatarUploadPreview();
    clientAvatarUploadState = { clientId, file: null };
    $('#removeClientAvatarButton').hidden = !item.profileImage?.storagePath;
    $('#clientAvatarUploadModal').showModal();
    $('#clientAvatarUploadPreview').focus();
  }

  function closeClientAvatarUpload() {
    if ($('#clientAvatarUploadModal').open) $('#clientAvatarUploadModal').close();
    clearClientAvatarUploadPreview();
  }

  async function removeClientAvatar() {
    const clientId = clientAvatarUploadState?.clientId;
    const item = data.applications.find(application => application.id === clientId);
    if (!item?.profileImage?.storagePath) return;
    if (!(await appConfirm(`Remove ${item.clientName || 'this client'}'s profile photo?`, {
      title: 'Remove profile photo',
      confirmLabel: 'Remove photo',
      danger: true,
      showCloseButton: false
    }))) return;
    const button = $('#removeClientAvatarButton');
    setButtonLoading(button, true);
    const previousProfileImage = item.profileImage;
    try {
      await deleteDocumentBlob(previousProfileImage.storagePath);
      item.profileImage = null;
      clearHiredClientAvatar(item.id);
      await persist();
      renderHired();
      closeClientAvatarUpload();
      showActionResult({ title: 'Profile photo removed', message: 'The client profile picture was removed successfully.' });
    } catch (error) {
      console.error('Could not remove client profile photo:', error);
      showActionResult({ title: 'Profile photo could not be removed', message: error.message || 'Check your connection and try again.', status: 'error' });
    } finally {
      setButtonLoading(button, false);
    }
  }

  function clampClientAvatarPosition() {
    if (!clientAvatarCropState) return;
    const viewport = $('#clientAvatarCropViewport');
    const image = $('#clientAvatarCropImage');
    const bounds = viewport.getBoundingClientRect();
    const width = clientAvatarCropState.image.naturalWidth * clientAvatarCropState.scale;
    const height = clientAvatarCropState.image.naturalHeight * clientAvatarCropState.scale;
    clientAvatarCropState.left = Math.min(0, Math.max(bounds.width - width, clientAvatarCropState.left));
    clientAvatarCropState.top = Math.min(0, Math.max(bounds.height - height, clientAvatarCropState.top));
    image.style.width = `${width}px`;
    image.style.height = `${height}px`;
    image.style.left = `${clientAvatarCropState.left}px`;
    image.style.top = `${clientAvatarCropState.top}px`;
  }

  function updateClientAvatarCropScale(keepCenter = true) {
    if (!clientAvatarCropState) return;
    const viewport = $('#clientAvatarCropViewport');
    const bounds = viewport.getBoundingClientRect();
    const oldScale = clientAvatarCropState.scale;
    const baseScale = Math.max(
      bounds.width / clientAvatarCropState.image.naturalWidth,
      bounds.height / clientAvatarCropState.image.naturalHeight
    );
    const zoom = Number($('#clientAvatarZoom').value) || 1;
    const scale = baseScale * zoom;
    if (keepCenter && oldScale) {
      const centerX = (bounds.width / 2 - clientAvatarCropState.left) / oldScale;
      const centerY = (bounds.height / 2 - clientAvatarCropState.top) / oldScale;
      clientAvatarCropState.left = bounds.width / 2 - centerX * scale;
      clientAvatarCropState.top = bounds.height / 2 - centerY * scale;
    } else {
      clientAvatarCropState.left = (bounds.width - clientAvatarCropState.image.naturalWidth * scale) / 2;
      clientAvatarCropState.top = (bounds.height - clientAvatarCropState.image.naturalHeight * scale) / 2;
    }
    clientAvatarCropState.scale = scale;
    clampClientAvatarPosition();
  }

  function closeClientAvatarCrop() {
    if ($('#clientAvatarCropModal').open) $('#clientAvatarCropModal').close();
    if (clientAvatarCropObjectUrl) URL.revokeObjectURL(clientAvatarCropObjectUrl);
    clientAvatarCropObjectUrl = '';
    clientAvatarCropState = null;
    $('#clientAvatarCropImage').removeAttribute('src');
  }

  function backClientAvatarCropToUpload() {
    const crop = clientAvatarCropState;
    if (!crop) {
      closeClientAvatarCrop();
      return;
    }
    const { clientId, file } = crop;
    closeClientAvatarCrop();
    openClientAvatarUpload(clientId);
    clientAvatarUploadState = { clientId, file };
    clientAvatarUploadObjectUrl = URL.createObjectURL(file);
    $('#clientAvatarUploadImage').src = clientAvatarUploadObjectUrl;
    $('#clientAvatarUploadImage').hidden = false;
    $('.client-avatar-upload-placeholder')?.setAttribute('hidden', '');
    $('#clientAvatarUploadFile').textContent = `${file.name || 'Selected picture'} · Ready to continue`;
    $('#continueClientAvatarUpload').disabled = false;
  }

  function openClientAvatarCrop(clientId, file) {
    if (clientAvatarCropObjectUrl) URL.revokeObjectURL(clientAvatarCropObjectUrl);
    clientAvatarCropObjectUrl = URL.createObjectURL(file);
    const image = $('#clientAvatarCropImage');
    image.onload = () => {
      clientAvatarCropState = { clientId, file, image, scale: 0, left: 0, top: 0, drag: null };
      $('#clientAvatarZoom').value = '1';
      $('#clientAvatarCropStatus').textContent = 'The saved profile photo will be a square JPEG.';
      $('#clientAvatarCropModal').showModal();
      updateClientAvatarCropScale(false);
      $('#useClientAvatarCrop').focus();
    };
    image.onerror = () => {
      closeClientAvatarCrop();
      showActionResult({ title: 'Image could not be opened', message: 'Choose a valid JPEG, PNG, or WebP image.', status: 'error' });
    };
    image.src = clientAvatarCropObjectUrl;
  }

  function makeClientAvatarCropBlob() {
    if (!clientAvatarCropState) return Promise.reject(new Error('Choose a profile image to crop.'));
    const viewport = $('#clientAvatarCropViewport');
    const bounds = viewport.getBoundingClientRect();
    const sourceX = -clientAvatarCropState.left / clientAvatarCropState.scale;
    const sourceY = -clientAvatarCropState.top / clientAvatarCropState.scale;
    const sourceSize = bounds.width / clientAvatarCropState.scale;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) return Promise.reject(new Error('The image crop could not be prepared in this browser.'));
    context.drawImage(
      clientAvatarCropState.image,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      canvas.width,
      canvas.height
    );
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('The cropped profile photo could not be created.'));
      }, 'image/jpeg', 0.9);
    });
  }

  async function uploadClientAvatar(clientId, file) {
    const item = data.applications.find(application => application.id === clientId);
    if (!item) throw new Error('This client could not be found.');
    if (!currentUser) throw new Error('Sign in before uploading a client photo.');
    const button = document.querySelector(`[data-client-avatar-upload="${CSS.escape(clientId)}"]`);
    if (button) button.disabled = true;
    const storagePath = `${currentUser.id}/client-avatars/${item.id}/${uid()}.jpg`;
    let uploaded = false;
    const previousProfileImage = item.profileImage;
    try {
      const { error } = await requireSupabase().storage.from(SUPABASE_BUCKET).upload(storagePath, file, {
        upsert: false,
        contentType: 'image/jpeg'
      });
      if (error) throw error;
      uploaded = true;
      const previousPath = item.profileImage?.storagePath;
      item.profileImage = {
        storagePath,
        name: `profile-${item.id}.jpg`,
        type: 'image/jpeg',
        size: file.size,
        updatedAt: new Date().toISOString()
      };
      cacheHiredClientAvatar(item.id, storagePath, file);
      await persist();
      const { data: savedState, error: verifyError } = await requireSupabase()
        .from('app_state')
        .select('data')
        .eq('user_id', currentUser.id)
        .maybeSingle();
      if (verifyError) throw verifyError;
      const savedClient = savedState?.data?.applications?.find(application => application.id === item.id);
      if (savedClient?.profileImage?.storagePath !== storagePath) {
        throw new Error('The photo uploaded, but its client record could not be confirmed as saved. Please try again.');
      }
      renderHired();
      if (previousProfileImage?.storagePath && previousProfileImage.storagePath !== storagePath) {
        try {
          await deleteDocumentBlob(previousProfileImage.storagePath);
        } catch (error) {
          console.error('Could not remove the replaced client profile photo:', error);
          showActionResult({
            title: 'Previous profile photo retained',
            message: error.message || 'The new photo is displayed, but the previous photo could not be safely removed.',
            status: 'info'
          });
        }
      }
      toast('Client profile photo saved.');
      return true;
    } catch (error) {
      if (uploaded) {
        try {
          await deleteDocumentBlob(storagePath);
        } catch (cleanupError) {
          console.error('Could not clean up an unsuccessful client photo upload:', cleanupError);
        }
      }
      item.profileImage = previousProfileImage;
      clearHiredClientAvatar(item.id);
      renderHired();
      console.error('Could not upload client profile photo:', error);
      showActionResult({
        title: 'Profile photo could not be uploaded',
        message: /mime type .* not supported|mime types? not allowed/i.test(error.message || '')
          ? 'The Supabase client-documents bucket must allow image/jpeg. Apply src/backend/supabase/profile-photo-storage-migration.sql in your Supabase SQL Editor, then try again.'
          : error.message || 'Check your connection and try again.',
        status: 'error'
      });
      return false;
    } finally {
      if (button?.isConnected) button.disabled = false;
    }
  }

  const cropViewport = $('#clientAvatarCropViewport');
  cropViewport.addEventListener('pointerdown', event => {
    if (!clientAvatarCropState) return;
    event.preventDefault();
    cropViewport.setPointerCapture(event.pointerId);
    clientAvatarCropState.drag = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      left: clientAvatarCropState.left,
      top: clientAvatarCropState.top
    };
  });
  cropViewport.addEventListener('pointermove', event => {
    const drag = clientAvatarCropState?.drag;
    if (!drag) return;
    clientAvatarCropState.left = drag.left + event.clientX - drag.pointerX;
    clientAvatarCropState.top = drag.top + event.clientY - drag.pointerY;
    clampClientAvatarPosition();
  });
  const stopClientAvatarCropDrag = () => {
    if (clientAvatarCropState) clientAvatarCropState.drag = null;
  };
  cropViewport.addEventListener('pointerup', stopClientAvatarCropDrag);
  cropViewport.addEventListener('pointercancel', stopClientAvatarCropDrag);
  $('#clientAvatarZoom').addEventListener('input', () => updateClientAvatarCropScale(true));
  const openClientAvatarFilePicker = () => {
    const clientId = clientAvatarUploadState?.clientId;
    if (!clientId) return;
    document.querySelector(`[data-client-avatar-input="${CSS.escape(clientId)}"]`)?.click();
  };
  $('#clientAvatarUploadPreview').addEventListener('click', openClientAvatarFilePicker);
  $('#clientAvatarUploadPreview').addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openClientAvatarFilePicker();
  });
  $('#cancelClientAvatarUpload').addEventListener('click', closeClientAvatarUpload);
  $('#removeClientAvatarButton').addEventListener('click', removeClientAvatar);
  $('#clientAvatarUploadModal').addEventListener('close', clearClientAvatarUploadPreview);
  $('#continueClientAvatarUpload').addEventListener('click', () => {
    if (!clientAvatarUploadState?.file) return;
    const { clientId, file } = clientAvatarUploadState;
    closeClientAvatarUpload();
    openClientAvatarCrop(clientId, file);
  });
  $('#cancelClientAvatarCrop')?.addEventListener('click', closeClientAvatarCrop);
  $('#cancelClientAvatarCropAction').addEventListener('click', backClientAvatarCropToUpload);
  $('#clientAvatarCropModal').addEventListener('close', () => {
    if (clientAvatarCropObjectUrl) URL.revokeObjectURL(clientAvatarCropObjectUrl);
    clientAvatarCropObjectUrl = '';
    clientAvatarCropState = null;
    $('#clientAvatarCropImage').removeAttribute('src');
  });
  $('#useClientAvatarCrop').addEventListener('click', async event => {
    if (!clientAvatarCropState) return;
    const button = event.currentTarget;
    setButtonLoading(button, true);
    $('#clientAvatarCropStatus').textContent = 'Uploading your cropped photo…';
    const clientId = clientAvatarCropState.clientId;
    try {
      const croppedFile = await makeClientAvatarCropBlob();
      closeClientAvatarCrop();
      const uploaded = await uploadClientAvatar(clientId, croppedFile);
      if (uploaded) showActionResult({ title: 'Profile photo saved', message: 'The client profile picture was uploaded successfully.' });
    } catch (error) {
      console.error('Could not crop client profile photo:', error);
      $('#clientAvatarCropStatus').textContent = error.message || 'The photo could not be cropped.';
      setButtonLoading(button, false);
      return;
    }
    setButtonLoading(button, false);
  });
  document.addEventListener('change', async event => {
    const input = event.target.closest('[data-client-avatar-input]');
    const file = input?.files?.[0];
    if (!input || !file) return;
    const clientId = input.dataset.clientAvatarInput;
    input.value = '';
    const item = data.applications.find(application => application.id === clientId);
    if (!item) return;
    const typeByMime = {
      'image/jpeg': { extension: 'jpg', contentType: 'image/jpeg' },
      'image/jpg': { extension: 'jpg', contentType: 'image/jpeg' },
      'image/pjpeg': { extension: 'jpg', contentType: 'image/jpeg' },
      'image/png': { extension: 'png', contentType: 'image/png' },
      'image/x-png': { extension: 'png', contentType: 'image/png' },
      'image/webp': { extension: 'webp', contentType: 'image/webp' }
    };
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    const typeByExtension = {
      jpg: typeByMime['image/jpeg'],
      jpeg: typeByMime['image/jpeg'],
      jpe: typeByMime['image/jpeg'],
      png: typeByMime['image/png'],
      webp: typeByMime['image/webp']
    };
    const normalizedMimeType = String(file.type || '').split(';')[0].trim().toLowerCase();
    const imageType = typeByMime[normalizedMimeType] || typeByExtension[extension];
    if (!imageType) {
      showActionResult({ title: 'Unsupported profile photo', message: 'Choose a JPEG, PNG, or WebP image.', status: 'error' });
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      showActionResult({ title: 'Profile photo is too large', message: 'Choose an image that is 25 MB or smaller before cropping.', status: 'error' });
      return;
    }
    const imageUrl = URL.createObjectURL(file);
    clientAvatarUploadState = { clientId, file };
    if (clientAvatarUploadObjectUrl) URL.revokeObjectURL(clientAvatarUploadObjectUrl);
    clientAvatarUploadObjectUrl = imageUrl;
    $('#clientAvatarUploadImage').src = imageUrl;
    $('#clientAvatarUploadImage').hidden = false;
    $('.client-avatar-upload-placeholder')?.setAttribute('hidden', '');
    $('#clientAvatarUploadFile').textContent = `${file.name || 'Selected picture'} · Ready to continue`;
    $('#continueClientAvatarUpload').disabled = false;
    if (!$('#clientAvatarUploadModal').open) $('#clientAvatarUploadModal').showModal();
  });

  async function sendClientOnboardingInvite(item, button, generateOnly = false) {
    if (!item.email) {
      if (generateOnly) {
        $('#activeClientOnboardingStatus').textContent = 'Add an email address to this active client before creating an onboarding link.';
        $('#activeClientOnboardingStatus').className = 'compose-status status-alert';
      } else {
        showActionResult({ title: 'Client email required', message: 'Add an email address to this active client before sending an onboarding invitation.', status: 'error' });
      }
      return;
    }
    button.disabled = true;
    try {
      const randomBytes = crypto.getRandomValues(new Uint8Array(32));
      const token = [...randomBytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      const tokenHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      const { data: issued, error } = await requireSupabase().rpc('issue_client_onboarding_invite', {
        p_client_id: item.id,
        p_token_hash: tokenHash
      });
      if (error) throw error;
      if (issued !== true) throw new Error('The onboarding invitation could not be created.');
      const onboardingUrl = new URL('/onboarding/', window.location.origin);
      onboardingUrl.hash = `token=${token}`;
      if (generateOnly) {
        $('#activeClientOnboardingUrl').value = onboardingUrl.href;
        $('#activeClientGeneratedLink').hidden = false;
        $('#activeClientOnboardingStatus').textContent = 'Private link generated. Copy it to share with your client.';
        $('#activeClientOnboardingStatus').className = 'compose-status status-success';
        $('#copyActiveClientOnboardingUrl').focus();
        return;
      }
      openPlainClientEmailComposer(item);
      $('#composeSubject').value = 'Please review your client onboarding details';
      $('#composeBody').value = `Hi ${item.clientName || 'there'},\n\nPlease complete or update your onboarding details using this private form:\n\n${onboardingUrl.href}\n\nThe link is private to you, expires in 14 days, and can only be submitted once. Submitting this form will replace any onboarding details previously provided. You will be able to review and confirm all your answers before submitting. Please do not enter passwords or sensitive account credentials.\n\nThank you`;
      toast('Review the onboarding invitation and send it through Gmail.');
    } catch (error) {
      console.error('Could not create client onboarding invitation:', error);
      if (generateOnly) {
        $('#activeClientOnboardingStatus').textContent = error.message || 'The link could not be created. Check your connection and try again.';
        $('#activeClientOnboardingStatus').className = 'compose-status status-alert';
      } else {
        showActionResult({ title: 'Onboarding link could not be created', message: error.message || 'Check your connection and try again.', status: 'error' });
      }
    } finally {
      button.disabled = false;
    }
  }

  function openDocumentEmailReminder(item) {
    const modal = $('#documentEmailReminderModal');
    const input = $('#documentEmailReminderDate');
    input.min = today();
    input.value = item.documentEmailReminderDate || '';
    modal.showModal();
  }

  function closeDocumentEmailReminder() {
    $('#documentEmailReminderModal').close();
  }

  $('#documentEmailReminderForm').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const item = data.applications.find(application => application.id === hiredEditingId);
    if (!item) return;
    const reminderDate = $('#documentEmailReminderDate').value;
    if (reminderDate < today()) {
      toast('Choose today or a future date.');
      return;
    }
    item.documentEmailPending = true;
    item.documentEmailReminderDate = reminderDate;
    item.documentEmailReminderAlertedDate = '';
    item.updatedAt = new Date().toISOString();
    persist();
    closeDocumentEmailReminder();
    renderHiredDetail(item, false);
    processDueDocumentEmailReminders();
    showActionResult({ title: 'Reminder set', message: `The document email reminder is set for ${formatDate(reminderDate)}.` });
  });

  $('#cancelDocumentEmailReminder')?.addEventListener('click', closeDocumentEmailReminder);
  $('#cancelDocumentEmailReminderAction').addEventListener('click', closeDocumentEmailReminder);

  document.addEventListener('change', event => {
    if (event.target.id === 'contractEmailFileInput') {
      stageContractEmailFile(event.target.files?.[0]);
      event.target.value = '';
      return;
    }
    if (event.target.id === 'invoicePickerUploadInput') {
      stageInvoiceFile(event.target.files[0]);
      event.target.value = '';
      return;
    }
    if (['hiredDetailDocumentInput', 'hiredDocumentInput'].includes(event.target.id)) {
      const files = [...event.target.files];
      event.target.value = '';
      stageHiredDocument(files);
    }
  });
  document.addEventListener('click', event => {
    if (event.target.closest('#chooseContractEmailFileButton, #chooseDifferentContractEmailFileButton')) {
      event.preventDefault();
      pickContractEmailFile();
      return;
    }
    if (event.target.closest('#removeContractEmailFileButton')) {
      removeContractEmailUploadFile();
      return;
    }
    if (event.target.closest('#cancelContractEmailUploadButton, #closeContractEmailUploadModal')) {
      $('#contractEmailUploadModal').close();
      return;
    }
    if (event.target.closest('#continueContractEmailButton')) {
      continueContractEmailUpload();
      return;
    }
    if (event.target.closest('#useInvoiceFileButton')) {
      event.preventDefault();
      continueInvoicePicker();
      return;
    }
    if (event.target.closest('#reviewActiveClientButton')) {
      const item = data.applications.find(application => application.id === hiredEditingId);
      if (item) openClientEmailComposer(item);
      return;
    }
    const uploadButton = event.target.closest('#hiredDetailUploadButton, #hiredDetailReplaceButton');
    if (uploadButton) {
      event.preventDefault();
      event.stopPropagation();
      openContractEmailUploadModal(hiredEditingId);
      return;
    }
    if (event.target.closest('#savePendingDocument')) {
      event.preventDefault();
      event.stopPropagation();
      savePendingHiredDocument();
      return;
    }
    if (event.target.closest('#sendUpdatedDocumentEmail')) {
      const item = data.applications.find(application => application.id === hiredEditingId);
      if (item) openUpdatedDocumentEmailComposer(item);
      return;
    }
    if (event.target.closest('#dismissUpdatedDocumentEmail')) {
      const item = data.applications.find(application => application.id === hiredEditingId);
      if (item) openDocumentEmailReminder(item);
      return;
    }
    if (event.target.closest('#changeDocumentEmailReminder')) {
      const item = data.applications.find(application => application.id === hiredEditingId);
      if (item) openDocumentEmailReminder(item);
      return;
    }
    if (event.target.closest('#cancelPendingDocument')) {
      event.preventDefault();
      event.stopPropagation();
      clearPendingDocumentPreview();
      const item = data.applications.find(application => application.id === hiredEditingId);
      if (item) renderHiredDetail(item, false);
    }
  });

  // Inbox and shared email composer controls.
  function removeEmailsFromList(emails) {
    const emailIds = new Set(emails.map(email => email.id));
    const gmailIds = new Set(emails.map(email => email.gmailId).filter(Boolean));
    data.deletedGmailIds = [...new Set([...(data.deletedGmailIds || []), ...gmailIds])];
    data.emails = data.emails.filter(email => !emailIds.has(email.id)
      && !(email.source === 'gmail' && gmailIds.has(email.gmailId)));
  }

  function updateEmailSelectionControls() {
    const checkboxes = [...document.querySelectorAll('#emailList [data-email-select]')];
    const selectedCount = checkboxes.filter(checkbox => checkbox.checked).length;
    const selectAll = document.querySelector('#emailSelectionActions [data-email-select-all]');
    const deleteButton = document.querySelector('#emailSelectionActions [data-email-bulk-delete]');
    const selectionCount = document.querySelector('#emailSelectionActions [data-email-selection-count]');
    if (selectAll) {
      selectAll.checked = checkboxes.length > 0 && selectedCount === checkboxes.length;
      selectAll.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
      selectAll.disabled = checkboxes.length === 0;
    }
    if (deleteButton) {
      deleteButton.disabled = selectedCount === 0;
    }
    if (selectionCount) selectionCount.textContent = `${selectedCount} selected`;
  }

  document.addEventListener('click', async event => {
    if (event.target.closest('[data-email-selection-toggle]')) {
      emailSelectionMode = !emailSelectionMode;
      renderEmails();
      return;
    }

    if (event.target.closest('[data-email-select], [data-email-select-all]')) return;

    if (event.target.closest('[data-email-bulk-delete]')) {
      const selectedIds = new Set([...document.querySelectorAll('#emailList [data-email-select]:checked')].map(input => input.value));
      const selectedEmails = data.emails.filter(email => selectedIds.has(email.id));
      if (!selectedEmails.length || !(await appConfirm(`Are you sure you want to delete ${selectedEmails.length} selected email${selectedEmails.length === 1 ? '' : 's'} from your list?`, { title: 'Remove selected emails', confirmLabel: 'Remove', danger: true }))) return;
      removeEmailsFromList(selectedEmails);
      emailSelectionMode = false;
      renderAll();
      await persist();
      showActionResult({ title: 'Emails removed', message: `${selectedEmails.length} selected email${selectedEmails.length === 1 ? ' was' : 's were'} removed from your saved list.` });
      return;
    }

    const actionTrigger = event.target.closest('[data-email-action-trigger]');
    const actionButton = event.target.closest('[data-email-action]');
    const emailDetail = event.target.closest('[data-email-detail]');

    if (actionTrigger) {
      event.stopPropagation();
      const menu = document.querySelector(`[data-email-actions-menu="${actionTrigger.dataset.emailActionTrigger}"]`);
      if (!menu) return;
      const willOpen = menu.classList.contains('hidden');
      document.querySelectorAll('.email-actions-menu').forEach(panel => {
        if (panel !== menu) panel.classList.add('hidden');
      });
      menu.classList.toggle('hidden', !willOpen);
      actionTrigger.setAttribute('aria-expanded', String(willOpen));
      return;
    }

    if (actionButton) {
      event.stopPropagation();
      const emailId = actionButton.dataset.emailId;
      if (actionButton.dataset.emailAction === 'compose') {
        openEmailComposer(emailId);
        return;
      }
      if (actionButton.dataset.emailAction === 'delete') {
        const email = data.emails.find(item => item.id === emailId);
        if (!email || !(await appConfirm(`Are you sure you want to delete this email from your list?\n\n${email.subject || '(No subject)'}`, { title: 'Remove email', confirmLabel: 'Remove', danger: true }))) return;
        removeEmailsFromList([email]);
        renderAll();
        await persist();
        showActionResult({ title: 'Email removed', message: 'The email was removed from your saved list.' });
      }
      document.querySelectorAll('.email-actions-menu').forEach(menu => menu.classList.add('hidden'));
      document.querySelectorAll('[data-email-action-trigger]').forEach(trigger => trigger.setAttribute('aria-expanded', 'false'));
      return;
    }

    if (!event.target.closest('.email-actions-trigger') && !event.target.closest('.email-actions-menu')) {
      document.querySelectorAll('.email-actions-menu').forEach(menu => menu.classList.add('hidden'));
      document.querySelectorAll('[data-email-action-trigger]').forEach(trigger => trigger.setAttribute('aria-expanded', 'false'));
    }

    if (emailDetail && (!event.target.closest('button') || event.target.closest('button[data-email-detail]'))) {
      openEmailDetail(emailDetail.dataset.emailDetail);
    }
  });

  document.addEventListener('change', event => {
    if (event.target.matches('[data-email-select-all]')) {
      document.querySelectorAll('#emailList [data-email-select]').forEach(checkbox => {
        checkbox.checked = event.target.checked;
      });
      updateEmailSelectionControls();
    } else if (event.target.matches('[data-email-select]')) {
      updateEmailSelectionControls();
    }
  });

  $('#emailSearch').addEventListener('input', renderEmails);
  $('#emailDateFilter').addEventListener('change', event => {
    emailDateFilter = event.target.value;
    renderEmails();
  });
  $('#emailDateSort').addEventListener('change', event => {
    emailDateSort = event.target.value;
    localStorage.setItem(EMAIL_WEEK_FILTER_KEY, emailDateSort);
    renderEmails();
    updateWeekNavigationCounts();
  });
  $$('.email-summary-item').forEach(button => button.addEventListener('click', () => {
    emailViewFilter = button.dataset.emailView;
    renderEmails();
  }));
  $('#emailTemplateSelect').addEventListener('change', event => applyEmailTemplate(event.target.value));
  $('#saveEmailTemplateButton').addEventListener('click', saveEmailTemplate);
  $('#deleteEmailTemplateButton').addEventListener('click', deleteEmailTemplate);
  $('#attachFileButton').addEventListener('click', () => $('#composeAttachmentInput').click());
  $('#removeComposeAttachmentButton').addEventListener('click', () => {
    composeAttachment = null;
    composeAttachmentFile = null;
    $('#composeAttachmentInput').value = '';
    updateComposeAttachmentDisplay();
    setEmailComposeStatus('Attachment removed. Review the email before sending.');
  });
  $('#composeAttachmentInput').addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (!file) {
      composeAttachment = null;
      composeAttachmentFile = null;
      updateComposeAttachmentDisplay();
      return;
    }
    composeAttachment = null;
    composeAttachmentFile = file;
    updateComposeAttachmentDisplay();
    setEmailComposeStatus(`Resume/CV attached: ${file.name}. Review before sending.`);
  });
  $('#sendEmailButton').addEventListener('click', sendComposedEmail);
  $('#emailDetailComposeButton').addEventListener('click', event => {
    const emailId = event.currentTarget.dataset.composeEmail;
    $('#emailDetailModal').close();
    openEmailComposer(emailId);
  });

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
    const accountStatus = $('#accountEmailAiStatus');
    const accountDetails = $('#accountEmailAiDetails');
    if (accountStatus) accountStatus.textContent = navigator.onLine === false ? 'Offline'
      : attention ? 'Needs attention' : processing ? 'Checking messages' : queued ? 'Checks queued'
        : /messages checked/i.test(fullStatus) ? 'Messages checked' : 'Waiting for next check';
    if (accountDetails) accountDetails.textContent = `${navigator.onLine === false ? 'Waiting for an internet connection. ' : ''}${fullStatus} · ${emailAiDailyUsage().requests}/40 checks today (resets 8 AM, Philippines). Shared by application outcomes and active-client tasks. This week only: ${emailAiWeekLabel()}.`;
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

  // Tools page controls: documents, scripts, and work links.
  const COVER_LETTER_STORAGE_KEY = 'jeff-va-cover-letter-v1';
  const COVER_LETTER_DEFAULTS = {
    recipient: 'Hiring Manager',
    company: '',
    role: 'Social Media Marketing Virtual Assistant',
    email: 'almocerajeffreys@gmail.com',
    phone: '+63 975 683 4839',
    location: 'Calamba, Philippines',
    website: 'jeffdigi.com',
    body: 'With over three years of digital marketing experience supporting multiple client accounts, I bring hands-on experience in social media content creation, scheduling, publishing, community engagement, and visual design.\n\nIn my previous role as a Digital Marketing Specialist at a Canada-based company, I managed content across Facebook, Instagram, Reddit, Pinterest, Quora, YouTube, X, and TikTok, maintaining multiple client accounts with 5-20 posts per week. I also created post graphics, promotional visuals, and campaign materials using Canva and Photoshop, and responded to comments and messages to support community engagement.\n\nI have training in social media marketing through HubSpot Academy, as well as experience with CapCut, Adobe Premiere Pro, Grammarly, and other content creation and publishing tools. My digital marketing background has also helped me plan content and identify the right audience for each platform.\n\nI am organized, detail-oriented, and comfortable managing multiple social media accounts and content tasks independently. I would welcome the opportunity to bring my social media and virtual assistance skills to your team.\n\nThank you for considering my application. I look forward to discussing how I can support your social media marketing efforts.'
  };
  const coverLetterFields = [...document.querySelectorAll('[data-cover-letter-field]')];

  function coverLetterValues() {
    return { ...COVER_LETTER_DEFAULTS, ...Object.fromEntries(coverLetterFields.map(field => [field.dataset.coverLetterField, field.value.trim()])) };
  }

  function coverLetterDate() {
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());
  }

  function renderCoverLetterPreview() {
    const values = coverLetterValues();
    const intro = `I am excited to apply for the ${values.role || 'position'}${values.company ? ` at ${values.company}` : ''}.`;
    const contact = [values.email, values.phone, values.location, values.website].filter(Boolean).join(' | ');
    const body = [intro, values.body].filter(Boolean).join('\n\n');
    const bodyHtml = body.split(/\n\s*\n/).filter(Boolean)
      .map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('');
    const recipientName = (values.recipient || '').trim();
    const defaultRecipient = 'Hiring Manager';
    const salutationRecipient = recipientName || defaultRecipient;
    $('#coverLetterPreview').innerHTML = `
      <header class="cover-letter-page-header">
        <img src="images/tab.png" alt="Jeff VA logo" />
        <div><h1>Jeffrey S. Almocera</h1><div class="cover-letter-contact">${escapeHtml(contact)}</div></div>
      </header>
      <p class="cover-letter-date">${coverLetterDate()}</p>
      <p class="cover-letter-greeting">Dear ${escapeHtml(salutationRecipient)},</p>
      <div class="cover-letter-copy">${bodyHtml}</div>
      <p class="cover-letter-signoff">Best regards,<br><strong>Jeffrey S. Almocera</strong></p>`;
  }

  function initializeCoverLetter() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(COVER_LETTER_STORAGE_KEY) || '{}');
    } catch (error) {
      console.warn('Could not load the saved cover letter:', error);
    }
    const values = { ...COVER_LETTER_DEFAULTS, ...saved };
    coverLetterFields.forEach(field => {
      field.value = values[field.dataset.coverLetterField] || '';
      field.addEventListener('input', () => {
        try {
          localStorage.setItem(COVER_LETTER_STORAGE_KEY, JSON.stringify(coverLetterValues()));
        } catch (error) {
          console.warn('Could not save the cover letter:', error);
        }
        renderCoverLetterPreview();
      });
    });
    renderCoverLetterPreview();
  }

  function coverLetterFilename(extension) {
    const role = coverLetterValues().role || 'cover-letter';
    const safeRole = role.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cover-letter';
    return `jeffrey-almocera-${safeRole}.${extension}`;
  }

  function downloadCoverLetterBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function renderCoverLetterCanvas() {
    if (!window.html2canvas) throw new Error('The cover letter renderer is unavailable.');
    if (document.fonts?.ready) await document.fonts.ready;
    return window.html2canvas($('#coverLetterPreview'), { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  }

  async function downloadCoverLetterPdf() {
    const pdfLib = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!pdfLib || !window.html2canvas) {
      showActionResult({ title: 'PDF export unavailable', message: 'The PDF tools are still loading. Try again in a moment.', status: 'error' });
      return;
    }
    if (!await appConfirm('Create a PDF file from the current cover letter?', { title: 'Download PDF', confirmLabel: 'Download PDF' })) return;
    const button = $('#downloadCoverLetterPdf');
    setButtonLoading(button, true);
    try {
      const canvas = await renderCoverLetterCanvas();
      const pdf = new pdfLib({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const image = canvas.toDataURL('image/jpeg', 0.94);
      const fitScale = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
      const imageWidth = canvas.width * fitScale;
      const imageHeight = canvas.height * fitScale;
      pdf.addImage(image, 'JPEG', (pageWidth - imageWidth) / 2, (pageHeight - imageHeight) / 2, imageWidth, imageHeight);
      pdf.save(coverLetterFilename('pdf'));
      showActionResult({ title: 'Download complete', message: 'Your cover letter PDF is ready.' });
    } catch (error) {
      console.error('Cover letter PDF export failed:', error);
      showActionResult({ title: 'Could not create PDF', message: 'The cover letter PDF could not be generated. Try again.', status: 'error' });
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function downloadCoverLetterWord() {
    const docx = window.docx;
    if (!docx) {
      showActionResult({ title: 'Word export unavailable', message: 'The Word document tool could not load. Check your connection and try again.', status: 'error' });
      return;
    }
    if (!await appConfirm('Create a Word file from the current cover letter?', { title: 'Download Word document', confirmLabel: 'Download Word' })) return;
    const button = $('#downloadCoverLetterWord');
    setButtonLoading(button, true);
    try {
      const values = coverLetterValues();
      const logoResponse = await fetch('images/tab.png');
      if (!logoResponse.ok) throw new Error('The logo image could not be loaded.');
      const logoData = new Uint8Array(await logoResponse.arrayBuffer());
      const { AlignmentType, BorderStyle, Document, ImageRun, Packer, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType } = docx;
      const contact = [values.email, values.phone, values.location, values.website].filter(Boolean).join(' | ');
      const recipientName = (values.recipient || '').trim();
      const defaultRecipient = 'Hiring Manager';
      const salutationRecipient = recipientName || defaultRecipient;
      const textParagraph = (text, options = {}) => {
        const { fontSize = 20, color, bold = false, ...paragraphOptions } = options;
        return new Paragraph({
          children: [new TextRun({ text, font: 'Arial', size: fontSize, ...(color ? { color } : {}), ...(bold ? { bold: true } : {}) })],
          spacing: { after: 165, line: 290 },
          ...paragraphOptions
        });
      };
      const headerRule = { style: BorderStyle.SINGLE, size: 6, color: 'DCE3DD' };
      const twipsPerPixel = 15;
      const pageMarginHorizontal = 52 * twipsPerPixel;
      const pageMarginVertical = 48 * twipsPerPixel;
      const logoAndGapWidth = (56 + 15) * twipsPerPixel;
      const headerWidth = 11906 - pageMarginHorizontal * 2;
      const nameColumnWidth = headerWidth - logoAndGapWidth;
      const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
      const header = new Table({
        width: { size: headerWidth, type: WidthType.DXA },
        columnWidths: [logoAndGapWidth, nameColumnWidth],
        layout: TableLayoutType.FIXED,
        borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder },
        rows: [new TableRow({ children: [
          new TableCell({
            width: { size: logoAndGapWidth, type: WidthType.DXA },
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({ spacing: { before: 0, after: 0 }, children: [new ImageRun({ data: logoData, transformation: { width: 56, height: 56 } })] })]
          }),
          new TableCell({
            width: { size: nameColumnWidth, type: WidthType.DXA },
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            verticalAlign: VerticalAlign.CENTER,
            children: [
              textParagraph('Jeffrey S. Almocera', { fontSize: 30, color: '1F3525', spacing: { before: 0, after: 35, line: 300 }, bold: true }),
              textParagraph(contact, { fontSize: 16, color: '505952', spacing: { before: 0, after: 0, line: 250 } })
            ]
          })
        ] })]
      });
      const headerDivider = new Paragraph({
        children: [new TextRun({ text: ' ', font: 'Arial', size: 1 })],
        spacing: { before: 120, after: 100, line: 20 },
        border: { bottom: headerRule }
      });
      const body = [
        header,
        headerDivider,
        textParagraph(coverLetterDate(), { fontSize: 18, spacing: { before: 200, after: 200 } }),
        textParagraph(`Dear ${salutationRecipient},`, { spacing: { after: 165 } }),
        textParagraph(`I am excited to apply for the ${values.role || 'position'}${values.company ? ` at ${values.company}` : ''}.`, { alignment: AlignmentType.JUSTIFIED })
      ];
      String(values.body || '').split(/\n\s*\n/).filter(Boolean).forEach(paragraph => {
        body.push(textParagraph(paragraph.replace(/\n/g, ' '), { alignment: AlignmentType.JUSTIFIED }));
      });
      body.push(textParagraph('Best regards,', { spacing: { before: 200, after: 70 } }));
      body.push(new Paragraph({ children: [new TextRun({ text: 'Jeffrey S. Almocera', bold: true, font: 'Arial', size: 20, color: '1F3525' })] }));
      const document = new Document({ sections: [{
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: pageMarginVertical, right: pageMarginHorizontal, bottom: pageMarginVertical, left: pageMarginHorizontal } } },
        children: body
      }] });
      const blob = await Packer.toBlob(document);
      downloadCoverLetterBlob(blob, coverLetterFilename('docx'));
      showActionResult({ title: 'Download complete', message: 'Your Word document is ready.' });
    } catch (error) {
      console.error('Cover letter Word export failed:', error);
      showActionResult({ title: 'Could not create Word document', message: 'The Word document could not be generated. Try again.', status: 'error' });
    } finally {
      setButtonLoading(button, false);
    }
  }

  $('#downloadCoverLetterPdf').addEventListener('click', downloadCoverLetterPdf);
  $('#downloadCoverLetterWord').addEventListener('click', downloadCoverLetterWord);
  initializeCoverLetter();

  function renderTemplateTesterPreview() {
    const select = $('#documentTemplateSelect');
    const preview = $('#documentTemplatePreview');
    if (!select || !preview) return;
    const templateId = select.value || 'contract-signing';
    const rendered = buildDocumentEmailTemplate(templateId, {
      clientName: 'Acme Studio',
      contact: 'Jordan Lee',
      role: 'Social Media Management Services'
    }, {
      duration: '3 months',
      invoiceNumber: 'INV-2026-104',
      billingPeriod: 'September 2026',
      issueDate: '2026-09-24',
      dueDate: '2026-10-08'
    });
    const previewBody = htmlEmailBodyFromText(rendered.body);
    preview.innerHTML = `<div style="font-family:Arial, Helvetica, sans-serif; margin:0;">${previewBody}</div>`;
  }

  $('#personalDocumentInput').addEventListener('change', event => {
    uploadPersonalDocument(event.target.files[0]);
    event.target.value = '';
  });
  $('#documentTemplateSelect')?.addEventListener('change', renderTemplateTesterPreview);
  $('#previewDocumentTemplateButton')?.addEventListener('click', renderTemplateTesterPreview);
  $('#sendDocumentTemplateTestButton')?.addEventListener('click', () => {
    const select = $('#documentTemplateSelect');
    sendDocumentTemplateTestEmail(select?.value || 'contract-signing');
  });
  function updateSalaryCalculator() {
    const currency = $('#salaryCalculatorCurrency')?.value || 'USD';
    const payType = $('#salaryCalculatorPayType')?.value || 'hourly';
    const enteredRate = Number($('#salaryCalculatorRate')?.value || 0);
    const hoursPerWeek = Number($('#salaryCalculatorHours')?.value || 0);
    const daysPerWeek = Number($('#salaryCalculatorDays')?.value || 0);
    const monthlyDays = daysPerWeek * (52 / 12);
    const monthlyTotal = payType === 'monthly' ? enteredRate : enteredRate * hoursPerWeek * (52 / 12);
    const hourlyRate = payType === 'monthly'
      ? (hoursPerWeek > 0 ? monthlyTotal / (hoursPerWeek * (52 / 12)) : 0)
      : enteredRate;
    const convertedTotal = currency === 'USD' ? monthlyTotal * 58 : monthlyTotal / 58;
    const convertedHourly = currency === 'USD' ? hourlyRate * 58 : hourlyRate / 58;
    const convertedCurrency = currency === 'USD' ? 'PHP' : 'USD';
    const money = (amount, code) => code === 'USD'
      ? `$${Math.round(amount).toLocaleString()}`
      : `₱${Math.round(amount).toLocaleString()}`;
    $('#salaryCalculatorRateLabel').textContent = payType === 'monthly' ? 'Monthly salary' : 'Hourly rate';
    $('#salaryCalculatorRate').placeholder = currency === 'USD'
      ? (payType === 'monthly' ? 'e.g. 1,700' : 'e.g. 10')
      : (payType === 'monthly' ? 'e.g. 98,600' : 'e.g. 580');
    $('#salaryCalculatorMonthlyDays').textContent = `${monthlyDays.toFixed(1)} days`;
    $('#salaryCalculatorMonthlyTotal').textContent = money(monthlyTotal, currency);
    $('#salaryCalculatorConversionLabel').textContent = `Converted monthly (${convertedCurrency})`;
    $('#salaryCalculatorHourlyLabel').textContent = `Hourly equivalent (${convertedCurrency})`;
    $('#salaryCalculatorConversion').textContent = currency === 'USD'
      ? money(convertedTotal, 'PHP')
      : money(convertedTotal, 'USD');
    $('#salaryCalculatorHourlyConversion').textContent = currency === 'USD'
      ? money(convertedHourly, 'PHP')
      : money(convertedHourly, 'USD');
  }

  ['salaryCalculatorCurrency', 'salaryCalculatorPayType', 'salaryCalculatorRate', 'salaryCalculatorHours', 'salaryCalculatorDays'].forEach(id => {
    $(`#${id}`)?.addEventListener('input', updateSalaryCalculator);
    $(`#${id}`)?.addEventListener('change', updateSalaryCalculator);
  });

  $('#scriptForm').addEventListener('submit', saveScript);
  $('#addScriptButton').addEventListener('click', () => openScriptForm());
  $('#cancelScriptButton').addEventListener('click', resetScriptForm);

  renderDocumentTemplateOptions();
  renderTemplateTesterPreview();
  updateSalaryCalculator();

  document.addEventListener('click', event => {
    const personalDeleteButton = event.target.closest('[data-personal-delete]');
    const personalOpenButton = event.target.closest('[data-personal-open]');
    const scriptEditButton = event.target.closest('[data-script-edit]');
    const scriptDeleteButton = event.target.closest('[data-script-delete]');
    const scriptDetailEditButton = event.target.closest('[data-script-detail-edit]');
    const scriptDetailCloseButton = event.target.closest('[data-script-detail-close]');
    const scriptRow = event.target.closest('[data-script-open]');
    const workLinkEditButton = event.target.closest('[data-work-link-edit]');
    const workLinkDeleteButton = event.target.closest('[data-work-link-delete]');
    const addWorkLinkButton = event.target.closest('#addWorkLinkButton');
    const cancelWorkLinkButton = event.target.closest('#cancelWorkLinkButton');
    const saveWorkLinkButton = event.target.closest('#saveWorkLinkButton');
    const documentsTab = event.target.closest('[data-documents-tab]');

    if (personalDeleteButton) {
      removePersonalDocument(personalDeleteButton.dataset.personalDelete);
      return;
    }
    if (personalOpenButton) {
      $$('.personal-document-card').forEach(card => card.classList.remove('selected'));
      personalOpenButton.classList.add('selected');
      if (event.detail >= 2) openPersonalDocument(personalOpenButton.dataset.personalOpen);
      return;
    }
    if (scriptEditButton) {
      openScriptForm(scriptEditButton.dataset.scriptEdit);
      return;
    }
    if (scriptDeleteButton) {
      deleteScript(scriptDeleteButton.dataset.scriptDelete);
      return;
    }
    if (scriptDetailEditButton) {
      $('#scriptDetailDialog').close();
      openScriptForm(scriptDetailEditButton.dataset.scriptDetailEdit);
      return;
    }
    if (scriptDetailCloseButton) {
      $('#scriptDetailDialog').close();
      return;
    }
    if (scriptRow) {
      openScriptDetails(scriptRow.dataset.scriptOpen);
      return;
    }
    if (workLinkEditButton) {
      openWorkLinkForm(workLinkEditButton.dataset.workLinkEdit);
      return;
    }
    if (workLinkDeleteButton) {
      deleteWorkLink(workLinkDeleteButton.dataset.workLinkDelete);
      return;
    }
    if (addWorkLinkButton) {
      openWorkLinkForm();
      return;
    }
    if (cancelWorkLinkButton) {
      resetWorkLinkForm();
      return;
    }
    if (saveWorkLinkButton) saveWorkLink();
    if (documentsTab) {
      const selectedPanel = documentsTab.dataset.documentsTab;
      $$('[data-documents-tab]').forEach(tab => {
        const active = tab.dataset.documentsTab === selectedPanel;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
      });
      $$('[data-documents-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.documentsPanel !== selectedPanel));
      $('#uploadDocumentButton').hidden = selectedPanel !== 'documents' || !(data.personalDocuments || []).length;
    }
  });

  document.addEventListener('keydown', event => {
    const scriptRow = event.target.closest('[data-script-open]');
    if (!scriptRow || event.target !== scriptRow || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    openScriptDetails(scriptRow.dataset.scriptOpen);
  });
  document.addEventListener('keydown', event => {
    const personalDocument = event.target.closest?.('[data-personal-open]');
    if (!personalDocument || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    openPersonalDocument(personalDocument.dataset.personalOpen);
  });

  // Weekly reporting is isolated from the dashboard so reporting changes cannot affect client, email, or billing flows.
  const WEEKLY_REPORT_SEEN_KEY = 'jeff-va-weekly-report-seen-v1';
  let weeklyReportOffset = 0;
  let weeklyReportActivityFilter = 'all';
  let weeklyReportScrollFrame = 0;

  function weekRange(offset = 0) {
    const end = new Date();
    end.setHours(12, 0, 0, 0);
    const start = new Date(end);
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
    start.setDate(start.getDate() + offset * 7);
    if (offset !== 0) {
      end.setTime(start.getTime());
      end.setDate(end.getDate() + 6);
    }
    return { start: localDateKey(start), end: localDateKey(end) };
  }

  function weeklyRangeLabel(range) {
    const start = new Date(`${range.start}T12:00:00`);
    const end = new Date(`${range.end}T12:00:00`);
    const format = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    return `${format.format(start)} – ${format.format(end)}, ${end.getFullYear()}`;
  }

  function weeklyHistoryOffsets() {
    const currentRange = weekRange();
    const activityDates = [
      ...data.applications.map(item => item.appliedDate),
      ...data.applications.filter(item => item.status === 'Active client').map(item => item.activeAt),
      ...data.applications.map(item => item.interviewDate),
      ...data.applications.map(item => item.followUpDate),
      ...(data.invoices || []).map(item => item.sentAt),
      ...data.emails.map(item => item.date)
    ].map(dateKey).filter(date => date && date < currentRange.start);
    const offsets = activityDates.map(date => {
      const activityDate = new Date(`${date}T12:00:00`);
      const daysSinceMonday = (activityDate.getDay() + 6) % 7;
      activityDate.setDate(activityDate.getDate() - daysSinceMonday);
      return Math.round((activityDate - new Date(`${currentRange.start}T12:00:00`)) / 86400000 / 7);
    }).filter(offset => offset < 0);
    const oldestOffset = offsets.length ? Math.min(...offsets) : 0;
    return Array.from({ length: Math.abs(oldestOffset) }, (_, index) => -(index + 1));
  }

  function weeklyHistoryOptions() {
    const options = weeklyHistoryOffsets().map(offset => {
      const range = weekRange(offset);
      return `<option value="${offset}">${escapeHtml(weeklyRangeLabel(range).replace(' – ', ' to '))}</option>`;
    }).join('');
    return `<option value="0">This week · ${escapeHtml(weeklyRangeLabel(weekRange()))}</option>${options}`;
  }

  function isInWeeklyRange(value, range) {
    const date = dateKey(value);
    return Boolean(date && date >= range.start && date <= range.end);
  }

  function weeklyEmailType(email) {
    const subject = String(email.subject || '');
    if (/^invoice\b/i.test(subject)) return 'Invoice';
    if (/^follow-up:/i.test(subject)) return 'Follow-up';
    if (/updated (contract|document)/i.test(subject)) return 'Updated contract';
    if (/contract/i.test(subject)) return 'Contract';
    return 'Other';
  }

  function weeklyReportData(offset = weeklyReportOffset) {
    const range = weekRange(offset);
    const applications = data.applications.filter(item => isInWeeklyRange(item.appliedDate, range));
    const invoices = (data.invoices || []).filter(item => isInWeeklyRange(item.sentAt, range));
    const clients = data.applications.filter(item => item.status === 'Active client' && isInWeeklyRange(item.activeAt, range));
    const emails = data.emails.filter(item => item.direction === 'sent' && isInWeeklyRange(item.date, range));
    const applicationEmails = emails.filter(email => {
      const type = weeklyEmailType(email);
      return !['Invoice', 'Follow-up', 'Contract', 'Updated contract'].includes(type)
        && matchApplicationsForEmail(email).length > 0;
    });
    const replies = data.emails.filter(email => email.direction !== 'sent'
      && email.source !== 'sent'
      && isInWeeklyRange(email.date, range)
      && matchApplicationsForEmail(email).length > 0);
    const interviews = data.applications.filter(item => isInWeeklyRange(item.interviewDate, range));
    const followUps = data.applications.filter(item => item.followUpDate
      && isInWeeklyRange(item.followUpDate, range)
      && item.status !== 'Active client'
      && item.status !== 'Not selected');
    const applicationsWithSentEmails = new Set(applicationEmails.flatMap(email => matchApplicationsForEmail(email).map(item => item.id)));
    const applicationsWithReplies = new Set(replies.flatMap(email => matchApplicationsForEmail(email).map(item => item.id)));
    const repliedApplicationCount = [...applicationsWithReplies].filter(id => applicationsWithSentEmails.has(id)).length;
    const responseRate = applicationsWithSentEmails.size
      ? Math.round((repliedApplicationCount / applicationsWithSentEmails.size) * 100)
      : null;
    const emailTypes = emails.reduce((counts, email) => {
      const type = weeklyEmailType(email);
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, {});
    const platformCounts = applications.reduce((counts, item) => {
      const platform = item.platform || 'Not specified';
      counts[platform] ||= { count: 0, replied: 0 };
      counts[platform].count += 1;
      if (applicationsWithReplies.has(item.id)) counts[platform].replied += 1;
      return counts;
    }, {});
    const topPlatform = Object.entries(platformCounts).sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))[0] || ['No applications', { count: 0, replied: 0 }];
    const sources = Object.entries(platformCounts)
      .map(([platform, counts]) => ({ platform, ...counts, replyRate: counts.count ? Math.round((counts.replied / counts.count) * 100) : null }))
      .sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform));
    const outcomeCounts = applications.reduce((counts, item) => {
      const status = item.status || 'Unknown';
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, {});
    const outcomes = Object.entries(outcomeCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const matchedApplication = email => matchApplicationsForEmail(email)[0] || null;
    const activities = [
      ...applications.map(item => ({ date: item.appliedDate, type: 'Application', company: item.clientName || 'Untitled application', platform: item.platform || '', status: item.status || '', details: item.role || '' })),
      ...clients.map(item => ({ date: item.activeAt, type: 'Client', company: item.clientName || 'Unnamed client', platform: item.platform || '', status: item.status || 'Active client', details: 'Client activated' })),
      ...invoices.map(item => ({ date: item.sentAt, type: 'Invoice', company: item.clientName || item.companyName || 'Client', platform: '', status: 'Sent', details: item.invoiceNumber || item.fileName || 'Invoice sent' })),
      ...emails.map(email => {
        const application = matchedApplication(email);
        return { date: email.date, type: 'Email', company: application?.clientName || '', platform: application?.platform || '', status: application?.status || 'Sent', details: email.subject || `${weeklyEmailType(email)} email sent` };
      }),
      ...replies.map(email => {
        const application = matchedApplication(email);
        return { date: email.date, type: 'Reply', company: application?.clientName || '', platform: application?.platform || '', status: application?.status || 'Replied', details: email.subject || 'Incoming application email' };
      }),
      ...interviews.map(item => ({ date: item.interviewDate, type: 'Interview', company: item.clientName || 'Unnamed application', platform: item.platform || '', status: item.status || '', details: item.role || '' })),
      ...followUps.map(item => ({ date: item.followUpDate, type: 'Follow-up', company: item.clientName || 'Unnamed application', platform: item.platform || '', status: item.followUpSentAt ? 'Sent' : 'Due', details: item.role || '' }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));
    const offers = applications.filter(item => item.status === 'Offer');
    const notes = applications.filter(item => String(item.notes || '').trim());
    return {
      range, applications, invoices, clients, emails, applicationEmails, replies, interviews, followUps,
      responseRate, emailTypes, topPlatform, sources, outcomes, offers, notes, activities
    };
  }

  function weeklyReportStatus(report, offset = weeklyReportOffset) {
    if (offset < 0) return 'Viewing past week';
    return new Date(`${report.range.end}T12:00:00`).getDay() === 0 ? 'Final' : 'In progress';
  }

  function weeklyEmptyRow(message, columns) {
    return `<tr><td class="weekly-report-empty-cell" colspan="${columns}">${escapeHtml(message)}</td></tr>`;
  }

  function weeklyStatusBadge(status) {
    return status ? statusPill(status) : '<span class="weekly-report-muted">—</span>';
  }

  function weeklyChange(current, previous) {
    if (current == null || previous == null) return '<span class="weekly-report-change neutral">No baseline</span>';
    if (previous === 0) return current === 0
      ? '<span class="weekly-report-change neutral">No change</span>'
      : '<span class="weekly-report-change positive" title="No activity in the previous week">↑ New</span>';
    const change = Math.round(((current - previous) / previous) * 100);
    if (!change) return '<span class="weekly-report-change neutral">No change</span>';
    const direction = change > 0 ? 'positive' : 'negative';
    return `<span class="weekly-report-change ${direction}">${change > 0 ? '↑' : '↓'} ${Math.abs(change)}% vs last week</span>`;
  }

  function weeklyStatCard(label, value, previous, title = '', trendValue = typeof value === 'number' ? value : null) {
    return `<article class="weekly-report-stat-card"${title ? ` title="${escapeHtml(title)}"` : ''}><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong>${weeklyChange(trendValue, previous)}</article>`;
  }

  function renderWeeklyReportActivities(report) {
    const activities = weeklyReportActivityFilter === 'all'
      ? report.activities
      : report.activities.filter(activity => activity.type === weeklyReportActivityFilter
        || (weeklyReportActivityFilter === 'Email' && activity.type === 'Reply'));
    $('#weeklyReportActivityCount').textContent = plural(activities.length, 'activity');
    $('#weeklyReportActivities').innerHTML = activities.length
      ? activities.map(activity => `<tr><td>${escapeHtml(formatDate(dateKey(activity.date)))}</td><td>${escapeHtml(activity.type)}</td><td>${escapeHtml(activity.company || '—')}</td><td>${escapeHtml(activity.platform || '—')}</td><td>${weeklyStatusBadge(activity.status)}</td></tr>`).join('')
      : weeklyEmptyRow(weeklyReportActivityFilter === 'all' ? 'No applications or tracked activity this week yet.' : `No ${weeklyReportActivityFilter.toLowerCase()} activity this week.`, 5);
  }

  function renderWeeklyReportDetails(report) {
    $('#weeklyReportApplicationCount').textContent = plural(report.applications.length, 'application');
    $('#weeklyReportApplicationRows').innerHTML = report.applications.length
      ? report.applications.map(item => `<tr><td>${escapeHtml(formatDate(dateKey(item.appliedDate)))}</td><td>${escapeHtml(item.clientName || 'Untitled application')}</td><td>${escapeHtml(item.platform || '—')}</td><td>${weeklyStatusBadge(item.status)}</td></tr>`).join('')
      : weeklyEmptyRow('No applications this week yet. Add an application to start building your report.', 4);
    $('#weeklyReportReplyTotal').textContent = plural(report.replies.length, 'reply');
    $('#weeklyReportEmailRows').innerHTML = [...report.emails.map(email => ({ email, type: 'Sent' })), ...report.replies.map(email => ({ email, type: 'Reply' }))]
      .sort((a, b) => new Date(b.email.date) - new Date(a.email.date))
      .map(({ email, type }) => {
        const application = matchApplicationsForEmail(email)[0];
        return `<tr><td>${escapeHtml(formatDate(dateKey(email.date)))}</td><td>${escapeHtml(type)}</td><td>${escapeHtml(application?.clientName || '—')}</td><td>${escapeHtml(email.subject || '(No subject)')}</td></tr>`;
      }).join('') || weeklyEmptyRow('No application emails or replies this week.', 4);
    $('#weeklyReportInterviewRows').innerHTML = report.interviews.length
      ? report.interviews.map(item => `<tr><td>${escapeHtml(formatDate(dateKey(item.interviewDate)))}</td><td>${escapeHtml(item.clientName || 'Unnamed application')}</td><td>${escapeHtml(item.role || '—')}</td><td>${weeklyStatusBadge(item.status)}</td></tr>`).join('')
      : weeklyEmptyRow('No interviews scheduled this week.', 4);
    $('#weeklyReportFollowUpRows').innerHTML = report.followUps.length
      ? report.followUps.map(item => `<tr><td>${escapeHtml(formatDate(dateKey(item.followUpDate)))}</td><td>${escapeHtml(item.clientName || 'Unnamed application')}</td><td>${weeklyStatusBadge(item.followUpSentAt ? 'Sent' : 'Due')}</td></tr>`).join('')
      : weeklyEmptyRow('No follow-ups due this week.', 3);
    $('#weeklyReportSourceRows').innerHTML = report.sources.length
      ? report.sources.map(source => `<tr><td>${escapeHtml(source.platform)}</td><td class="numeric">${source.count}</td><td class="numeric">${source.replied}</td><td class="numeric">${source.replyRate == null ? '—' : `${source.replyRate}%`}</td></tr>`).join('')
      : weeklyEmptyRow('No application sources to compare yet.', 4);
    $('#weeklyReportNotesList').innerHTML = report.notes.length
      ? report.notes.map(item => `<article class="weekly-report-note"><div><strong>${escapeHtml(item.clientName || 'Untitled application')}</strong><span>${escapeHtml(item.platform || 'Platform not specified')}</span></div><p>${escapeHtml(item.notes)}</p></article>`).join('')
      : '<p class="weekly-report-empty">No notes on this week’s applications.</p>';
    $('#weeklyReportOutcomeCount').textContent = plural(report.applications.length, 'application');
    $('#weeklyReportOutcomes').innerHTML = report.outcomes.length
      ? report.outcomes.map(([status, count]) => `<tr><td>${weeklyStatusBadge(status)}</td><td class="numeric">${count}</td></tr>`).join('')
      : weeklyEmptyRow('No applications this week yet.', 2);
  }

  function renderWeeklyReport() {
    const report = weeklyReportData();
    const previousReport = weeklyReportData(weeklyReportOffset - 1);
    $('#weeklyReportDate').textContent = weeklyRangeLabel(report.range);
    $('#weeklyReportStatus').textContent = weeklyReportStatus(report);
    $('#weeklyReportStatus').className = `weekly-report-status ${weeklyReportOffset < 0 ? 'past' : weeklyReportStatus(report) === 'Final' ? 'final' : 'in-progress'}`;
    $('#showCurrentWeeklyReport').disabled = weeklyReportOffset === 0;
    $('#nextWeeklyReport').disabled = weeklyReportOffset === 0;
    $('#weeklyReportHistory').innerHTML = weeklyHistoryOptions();
    $('#weeklyReportHistory').value = String(weeklyReportOffset);
    const metricCards = [
      weeklyStatCard('Applications', report.applications.length, previousReport.applications.length),
      weeklyStatCard('Application emails', report.applicationEmails.length, previousReport.applicationEmails.length),
      weeklyStatCard('Replies', report.replies.length, previousReport.replies.length),
      weeklyStatCard('Interviews', report.interviews.length, previousReport.interviews.length),
      weeklyStatCard('Offers', report.offers.length, previousReport.offers.length, 'Applications submitted this week currently marked as Offer.'),
      weeklyStatCard('Response rate', report.responseRate == null ? '—' : `${report.responseRate}%`, previousReport.responseRate, 'Applications with an incoming reply divided by applications with a matched sent application email.', report.responseRate)
    ].join('');
    $('#weeklyReportMetrics').innerHTML = metricCards;
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dailyCounts = weekdays.map((day, index) => {
      const date = new Date(`${report.range.start}T12:00:00`);
      date.setDate(date.getDate() + index);
      const key = localDateKey(date);
      const count = report.activities.filter(activity => dateKey(activity.date) === key).length;
      return { day, key, count };
    });
    const dailyMax = Math.max(1, ...dailyCounts.map(item => item.count));
    $('#weeklyReportDailyChart').innerHTML = dailyCounts.map(item => `<div class="weekly-report-day" title="${escapeHtml(formatDate(item.key))}: ${plural(item.count, 'activity')}" aria-label="${escapeHtml(formatDate(item.key))}: ${plural(item.count, 'activity')}"><div class="weekly-report-day-track"><i style="height:${Math.max(item.count ? 8 : 0, (item.count / dailyMax) * 100)}%"></i></div><strong>${item.count}</strong><span>${item.day}</span></div>`).join('');
    $('#weeklyReportGoals').innerHTML = '<p class="weekly-report-empty">Weekly goal tracking is not configured yet.</p>';
    const outcomeMax = Math.max(1, ...report.outcomes.map(([, count]) => count));
    $('#weeklyReportChart').innerHTML = report.outcomes.length
      ? report.outcomes.map(([status, count]) => `<div class="weekly-report-stage"><div><span>${weeklyStatusBadge(status)}</span><strong>${count}</strong></div><i style="width:${(count / outcomeMax) * 100}%;--stage-color:${escapeHtml(STATUS_COLORS[status] || '#69717d')}"></i></div>`).join('')
      : '<p class="weekly-report-empty">No applications this week yet.</p>';
    $('#weeklyReportSourceEffectiveness').innerHTML = report.sources.length
      ? report.sources.slice(0, 6).map(source => `<div class="weekly-report-source"><span title="${escapeHtml(source.platform)}">${escapeHtml(source.platform)}</span><i><b style="width:${Math.max(4, (source.count / Math.max(1, report.sources[0].count)) * 100)}%"></b></i><strong>${source.count}</strong><small>${source.replyRate == null ? '—' : `${source.replyRate}% reply rate`}</small></div>`).join('')
      : '<p class="weekly-report-empty">No application sources to compare yet.</p>';
    $('#weeklyReportEmailTotal').textContent = plural(report.emails.length, 'email');
    $('#weeklyReportEmailBreakdown').innerHTML = Object.keys(report.emailTypes).length
      ? Object.entries(report.emailTypes).sort((a, b) => b[1] - a[1]).map(([type, count]) => `<span>${escapeHtml(type)} · ${count}</span>`).join('')
      : '<p class="weekly-report-empty">No emails sent in this period.</p>';
    renderWeeklyReportDetails(report);
    renderWeeklyReportActivities(report);
    requestAnimationFrame(() => observeWeeklyReportSections());
    return report;
  }

  function weeklyReportScrollContainer() {
    const modal = $('#weeklyReportModal');
    const form = $('.weekly-report-form', modal);
    return form.scrollHeight > form.clientHeight && ['auto', 'scroll'].includes(getComputedStyle(form).overflowY)
      ? form
      : modal;
  }

  function updateWeeklyReportActiveSection() {
    if (weeklyReportScrollFrame) return;
    weeklyReportScrollFrame = requestAnimationFrame(() => {
      weeklyReportScrollFrame = 0;
      const modal = $('#weeklyReportModal');
      if (!modal.open) return;
      const scrollContainer = weeklyReportScrollContainer();
      const sections = $$('.weekly-report-section', $('#weeklyReportContent'));
      if (!sections.length) return;
      const containerTop = scrollContainer.getBoundingClientRect().top;
      const headerHeight = $('.weekly-report-header').offsetHeight;
      const navBottom = $('.weekly-report-nav').getBoundingClientRect().bottom;
      modal.style.setProperty('--weekly-report-header-height', `${headerHeight}px`);
      const activeLine = Math.max(containerTop + headerHeight, navBottom) + 12;
      let activeSection = sections[0];
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= activeLine) activeSection = section;
        else break;
      }
      if (scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 2) {
        activeSection = sections[sections.length - 1];
      }
      $$('.weekly-report-nav [data-report-target]').forEach(button => {
        if (button.dataset.reportTarget === activeSection.id) button.setAttribute('aria-current', 'location');
        else button.removeAttribute('aria-current');
      });
    });
  }

  function observeWeeklyReportSections() {
    const modal = $('#weeklyReportModal');
    const form = $('.weekly-report-form', modal);
    if (!modal.open) return;
    modal.removeEventListener('scroll', updateWeeklyReportActiveSection);
    form.removeEventListener('scroll', updateWeeklyReportActiveSection);
    window.removeEventListener('resize', updateWeeklyReportActiveSection);
    modal.addEventListener('scroll', updateWeeklyReportActiveSection, { passive: true });
    form.addEventListener('scroll', updateWeeklyReportActiveSection, { passive: true });
    window.addEventListener('resize', updateWeeklyReportActiveSection, { passive: true });
    updateWeeklyReportActiveSection();
  }

  function scrollToWeeklyReportSection(section) {
    const scrollContainer = weeklyReportScrollContainer();
    const navBottom = $('.weekly-report-nav').getBoundingClientRect().bottom;
    const offset = section.getBoundingClientRect().top - navBottom - 8;
    scrollContainer.scrollTo({
      top: Math.max(0, scrollContainer.scrollTop + offset),
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    });
  }

  function selectWeeklyReportWeek(offset) {
    weeklyReportOffset = Math.min(0, offset);
    renderWeeklyReport();
    weeklyReportScrollContainer().scrollTo({ top: 0, behavior: 'smooth' });
  }

  function weeklyCsvCell(value) {
    let text = String(value ?? '');
    if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function downloadWeeklyCsv(allWeeks = false) {
    try {
      const reports = allWeeks
        ? [...weeklyHistoryOffsets(), 0].map(offset => weeklyReportData(offset))
        : [weeklyReportData()];
      const rows = [
        ['Week', 'Date', 'Type', 'Company', 'Platform', 'Status', 'Details'],
        ...reports.flatMap(report => report.activities.map(activity => [
          weeklyRangeLabel(report.range),
          formatDate(dateKey(activity.date)),
          activity.type,
          activity.company,
          activity.platform,
          activity.status,
          activity.details
        ]))
      ];
      const csv = `\uFEFF${rows.map(row => row.map(weeklyCsvCell).join(',')).join('\r\n')}`;
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = allWeeks
        ? 'jeff-va-weekly-reports-all-weeks.csv'
        : `jeff-va-weekly-report-${weeklyReportData().range.end}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showActionResult({ title: 'Report downloaded', message: allWeeks ? 'Your all-weeks CSV report was downloaded.' : 'Your weekly CSV report was downloaded.' });
    } catch (error) {
      console.error('Weekly report CSV export failed:', error);
      showActionResult({ title: 'Could not generate report', message: 'The weekly report CSV could not be generated. Try again.', status: 'error' });
    }
  }

  function openWeeklyReport() {
    weeklyReportOffset = 0;
    renderWeeklyReport();
    $('#weeklyReportModal').showModal();
    requestAnimationFrame(() => observeWeeklyReportSections());
  }

  function renderWeeklyReportAvailability() {
    const range = weekRange();
    const reportKey = `${range.start}|${range.end}`;
    if (!currentUser || !dataReady || !supabaseDataLoaded || localStorage.getItem(WEEKLY_REPORT_SEEN_KEY) === reportKey) return;
    localStorage.setItem(WEEKLY_REPORT_SEEN_KEY, reportKey);
    setTimeout(openWeeklyReport, 250);
  }

  function pdfRgb(hex) {
    const value = hex.replace('#', '');
    return [0, 2, 4].map(index => Number.parseInt(value.slice(index, index + 2), 16));
  }

  function weeklyPdfStatusColor(status) {
    if (STATUS_COLORS[status]) return STATUS_COLORS[status];
    if (status === 'Due') return '#8a6331';
    if (status === 'Sent') return '#187443';
    return '#69717d';
  }

  function drawWeeklyReportPdf(pdf, reports, allWeeks = false) {
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 14;
    const contentWidth = pageWidth - margin * 2;
    const footerTop = pageHeight - 15;
    const ink = '#202b43';
    const navy = '#1b2244';
    const muted = '#667085';
    const border = '#dce1e8';
    const pale = '#f3f5f8';
    let cursorY = 0;

    const setText = (color = ink) => pdf.setTextColor(...pdfRgb(color));
    const setFill = color => pdf.setFillColor(...pdfRgb(color));
    const setLine = color => pdf.setDrawColor(...pdfRgb(color));
    const textLines = (value, width, fontSize = 9) => {
      pdf.setFontSize(fontSize);
      return pdf.splitTextToSize(String(value ?? '—'), Math.max(2, width));
    };
    const drawBand = (title, rangeLabel, badge, continuation = false) => {
      setFill(navy);
      pdf.rect(0, 0, pageWidth, continuation ? 27 : 39, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      setText('#d9e1f1');
      pdf.text('JEFF VA', margin, 9);
      pdf.setFontSize(continuation ? 13 : 18);
      setText('#ffffff');
      pdf.text(title, margin, continuation ? 18 : 21);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      setText('#e3e8f2');
      pdf.text(rangeLabel, margin, continuation ? 24 : 31);
      const badgeWidth = Math.min(61, Math.max(25, pdf.getTextWidth(badge) + 8));
      const badgeX = pageWidth - margin - badgeWidth;
      setFill('#ffffff');
      pdf.roundedRect(badgeX, continuation ? 8 : 13, badgeWidth, 9, 2, 2, 'F');
      setText(navy);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.text(badge, badgeX + 4, continuation ? 14 : 19);
      cursorY = continuation ? 34 : 46;
    };
    const beginPage = (title, rangeLabel, badge, continuation = false) => {
      pdf.addPage();
      drawBand(title, rangeLabel, badge, continuation);
    };
    const drawHeading = title => {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      setText(navy);
      pdf.text(title, margin, cursorY + 4);
      cursorY += 9;
    };
    const drawMetricCards = (items, columns = 3) => {
      const gap = 3;
      const rows = Math.ceil(items.length / columns);
      const cardWidth = (contentWidth - gap * (columns - 1)) / columns;
      const cardHeight = 19;
      items.forEach(([label, value], index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = margin + column * (cardWidth + gap);
        const y = cursorY + row * (cardHeight + gap);
        setFill('#f6f7fa');
        setLine(border);
        pdf.roundedRect(x, y, cardWidth, cardHeight, 2, 2, 'FD');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(16);
        setText(navy);
        pdf.text(String(value), x + 3, y + 8);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        setText(muted);
        pdf.text(String(label), x + 3, y + 15);
      });
      cursorY += rows * (cardHeight + gap) + 2;
    };
    const drawOutcomeChart = report => {
      drawHeading('Pipeline outcomes');
      if (!report.outcomes.length) {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        setText(muted);
        pdf.text('No applications this week yet.', margin, cursorY + 2);
        cursorY += 9;
        return;
      }
      const labelWidth = 31;
      const countWidth = 10;
      const barWidth = contentWidth - labelWidth - countWidth;
      const maxCount = Math.max(1, ...report.outcomes.map(([, count]) => count));
      report.outcomes.forEach(([status, count]) => {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        setText(ink);
        pdf.text(status, margin, cursorY + 3.6);
        setFill(pale);
        pdf.roundedRect(margin + labelWidth, cursorY, barWidth, 4.5, 1, 1, 'F');
        setFill(weeklyPdfStatusColor(status));
        pdf.roundedRect(margin + labelWidth, cursorY, Math.max(2, barWidth * count / maxCount), 4.5, 1, 1, 'F');
        pdf.setFont('helvetica', 'bold');
        setText(ink);
        pdf.text(String(count), pageWidth - margin, cursorY + 3.6, { align: 'right' });
        cursorY += 6;
      });
      cursorY += 2;
    };
    const drawTrendChart = weekReports => {
      const chartReports = weekReports.slice(-12);
      drawHeading('Activity trend');
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      setText(muted);
      pdf.text('Applications and other tracked activities by week (most recent 12 weeks).', margin, cursorY + 1);
      cursorY += 7;
      const chartHeight = 31;
      const labelHeight = 8;
      const slotWidth = contentWidth / Math.max(1, chartReports.length);
      const barWidth = Math.min(9, Math.max(3, slotWidth * .54));
      const maxActivity = Math.max(1, ...chartReports.map(report => report.activities.length));
      const baseline = cursorY + chartHeight;
      setLine(border);
      pdf.setLineWidth(.25);
      pdf.line(margin, baseline, pageWidth - margin, baseline);
      chartReports.forEach((report, index) => {
        const x = margin + index * slotWidth + (slotWidth - barWidth) / 2;
        const appCount = report.applications.length;
        const otherCount = Math.max(0, report.activities.length - appCount);
        const appHeight = Math.max(0, chartHeight * appCount / maxActivity);
        const otherHeight = Math.max(0, chartHeight * otherCount / maxActivity);
        setFill('#2563a6');
        if (appHeight) pdf.rect(x, baseline - appHeight, barWidth, appHeight, 'F');
        setFill('#1b2244');
        if (otherHeight) pdf.rect(x, baseline - appHeight - otherHeight, barWidth, otherHeight, 'F');
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        setText(ink);
        pdf.text(String(report.activities.length), x + barWidth / 2, baseline - appHeight - otherHeight - 2, { align: 'center' });
        const rangeStart = new Date(`${report.range.start}T12:00:00`);
        const label = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(rangeStart);
        pdf.text(label, margin + index * slotWidth + slotWidth / 2, baseline + labelHeight - 1, { align: 'center' });
      });
      cursorY = baseline + labelHeight + 2;
      pdf.setFontSize(9);
      setFill('#2563a6');
      pdf.rect(margin, cursorY, 3, 3, 'F');
      pdf.setFont('helvetica', 'normal');
      setText(muted);
      pdf.text('Applications', margin + 5, cursorY + 2.7);
      setFill('#1b2244');
      pdf.rect(margin + 34, cursorY, 3, 3, 'F');
      pdf.text('Other tracked activities', margin + 39, cursorY + 2.7);
      cursorY += 8;
    };
    const drawTable = (report, title, columns, rows) => {
      if (cursorY + 19 > footerTop) {
        beginPage('Weekly report', weeklyRangeLabel(report.range), weeklyReportStatus(report, report.offset), true);
      }
      drawHeading(title);
      const tableX = margin;
      const tableWidth = contentWidth;
      const widths = columns.map(column => tableWidth * column.ratio);
      const drawTableHeader = () => {
        setFill('#e9edf3');
        pdf.rect(tableX, cursorY, tableWidth, 7, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        setText(ink);
        let x = tableX;
        columns.forEach((column, index) => {
          const labelX = column.align === 'right' ? x + widths[index] - 2 : x + 2;
          pdf.text(column.label, labelX, cursorY + 4.8, { align: column.align || 'left' });
          x += widths[index];
        });
        cursorY += 7;
      };
      drawTableHeader();
      const sourceRows = rows.length ? rows : [[{ text: 'No records for this period.', span: true }]];
      sourceRows.forEach((row, rowIndex) => {
        const cells = row.map((value, index) => {
          const cell = typeof value === 'object' && value !== null ? value : { text: value };
          const availableWidth = cell.span ? tableWidth - 4 : widths[index] - 4;
          return { ...cell, lines: textLines(cell.text, availableWidth, 9) };
        });
        const rowHeight = Math.max(7, ...cells.map(cell => cell.lines.length * 4.2 + 3));
        const maximumRowHeight = footerTop - 3 - (34 + 9 + 7);
        if (rowHeight > maximumRowHeight) {
          throw new Error('A report entry is too long to fit on one PDF page. Shorten the note or subject and try again.');
        }
        if (cursorY + rowHeight > footerTop - 3) {
          beginPage('Weekly report', weeklyRangeLabel(report.range), weeklyReportStatus(report, report.offset), true);
          drawHeading(`${title} (continued)`);
          drawTableHeader();
        }
        if (rowIndex % 2 === 1) {
          setFill('#fafbfc');
          pdf.rect(tableX, cursorY, tableWidth, rowHeight, 'F');
        }
        setLine(border);
        pdf.setLineWidth(.2);
        pdf.line(tableX, cursorY + rowHeight, tableX + tableWidth, cursorY + rowHeight);
        let x = tableX;
        cells.forEach((cell, index) => {
          if (cell.status) {
            const statusColor = weeklyPdfStatusColor(cell.status);
            const statusRgb = pdfRgb(statusColor);
            const tint = statusRgb.map(channel => Math.round(channel * .12 + 255 * .88));
            setFill(`#${tint.map(value => value.toString(16).padStart(2, '0')).join('')}`);
            pdf.roundedRect(x + 1.5, cursorY + 1.2, Math.min(widths[index] - 3, pdf.getTextWidth(cell.text) + 5), 5.2, 1.2, 1.2, 'F');
            setText(statusColor);
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(9);
            pdf.text(cell.text, x + 4, cursorY + 4.8);
          } else {
            setText(muted);
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(9);
            const textX = cell.span ? x + 2 : cell.align === 'right' ? x + widths[index] - 2 : x + 2;
            pdf.text(cell.lines, textX, cursorY + 4.7, { align: cell.align || 'left' });
          }
          x += widths[index] || 0;
        });
        cursorY += rowHeight;
      });
      cursorY += 5;
    };
    const renderWeeklyDetails = report => {
      report.offset = report.offset ?? 0;
      if (pdf.getNumberOfPages() === 1 && cursorY === 0) {
        drawBand('Weekly report', weeklyRangeLabel(report.range), weeklyReportStatus(report, report.offset));
      } else {
        beginPage('Weekly report', weeklyRangeLabel(report.range), weeklyReportStatus(report, report.offset));
      }
      drawMetricCards([
        ['Total activities', report.activities.length],
        ['Applications', report.applications.length],
        ['Application emails', report.applicationEmails.length],
        ['Replies', report.replies.length],
        ['Interviews', report.interviews.length],
        ['Offers', report.offers.length],
        ['Response rate', report.responseRate == null ? '—' : `${report.responseRate}%`]
      ]);
      drawOutcomeChart(report);
      const applicationRows = report.applications.map(item => [
        formatDate(dateKey(item.appliedDate)),
        item.clientName || 'Untitled application',
        item.platform || '—',
        { text: STATUS_LABELS[item.status] || item.status || '—', status: item.status }
      ]);
      drawTable(report, 'Applications', [
        { label: 'Date', ratio: .18 },
        { label: 'Company', ratio: .38 },
        { label: 'Platform', ratio: .25 },
        { label: 'Status', ratio: .19 }
      ], applicationRows);
      const emailRows = [...report.emails.map(email => ({ email, direction: 'Sent' })), ...report.replies.map(email => ({ email, direction: 'Reply' }))]
        .sort((first, second) => new Date(second.email.date) - new Date(first.email.date))
        .map(({ email, direction }) => [
          formatDate(dateKey(email.date)),
          direction,
          matchApplicationsForEmail(email)[0]?.clientName || '—',
          email.subject || '(No subject)'
        ]);
      drawTable(report, 'Emails', [
        { label: 'Date', ratio: .18 },
        { label: 'Type', ratio: .15 },
        { label: 'Company', ratio: .27 },
        { label: 'Subject', ratio: .40 }
      ], emailRows);
      drawTable(report, 'Interviews', [
        { label: 'Date', ratio: .18 },
        { label: 'Company', ratio: .36 },
        { label: 'Role', ratio: .28 },
        { label: 'Status', ratio: .18 }
      ], report.interviews.map(item => [
        formatDate(dateKey(item.interviewDate)),
        item.clientName || 'Unnamed application',
        item.role || '—',
        { text: STATUS_LABELS[item.status] || item.status || '—', status: item.status }
      ]));
      drawTable(report, 'Follow-ups', [
        { label: 'Date', ratio: .2 },
        { label: 'Company', ratio: .5 },
        { label: 'Status', ratio: .3 }
      ], report.followUps.map(item => [
        formatDate(dateKey(item.followUpDate)),
        item.clientName || 'Unnamed application',
        { text: item.followUpSentAt ? 'Sent' : 'Due', status: item.followUpSentAt ? 'Sent' : 'Due' }
      ]));
      drawTable(report, 'Sources', [
        { label: 'Platform', ratio: .46 },
        { label: 'Applications', ratio: .18, align: 'right' },
        { label: 'Replies', ratio: .16, align: 'right' },
        { label: 'Reply rate', ratio: .2, align: 'right' }
      ], report.sources.map(source => [source.platform, source.count, source.replied, source.replyRate == null ? '—' : `${source.replyRate}%`]));
      drawTable(report, 'Outcomes', [
        { label: 'Status', ratio: .7 },
        { label: 'Applications', ratio: .3, align: 'right' }
      ], report.outcomes.map(([status, count]) => [
        { text: STATUS_LABELS[status] || status, status },
        count
      ]));
      drawTable(report, 'Notes', [
        { label: 'Company / platform', ratio: .34 },
        { label: 'Note', ratio: .66 }
      ], report.notes.map(item => [`${item.clientName || 'Untitled application'} / ${item.platform || 'Platform not specified'}`, item.notes]));
      drawTable(report, 'Activity log', [
        { label: 'Date', ratio: .13 },
        { label: 'Type', ratio: .12 },
        { label: 'Company', ratio: .2 },
        { label: 'Platform', ratio: .15 },
        { label: 'Status', ratio: .12 },
        { label: 'Details', ratio: .28 }
      ], report.activities.map(activity => [
        formatDate(dateKey(activity.date)),
        activity.type,
        activity.company || '—',
        activity.platform || '—',
        { text: STATUS_LABELS[activity.status] || activity.status || '—', status: activity.status },
        activity.details || '—'
      ]));
    };

    if (allWeeks) {
      const oldest = reports[0]?.range;
      const newest = reports[reports.length - 1]?.range;
      const fullDateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      const overallRange = oldest && newest
        ? `${fullDateFormatter.format(new Date(`${oldest.start}T12:00:00`))} – ${fullDateFormatter.format(new Date(`${newest.end}T12:00:00`))}`
        : 'No report periods available';
      const totals = reports.reduce((result, report) => ({
        activities: result.activities + report.activities.length,
        applications: result.applications + report.applications.length,
        emails: result.emails + report.applicationEmails.length,
        replies: result.replies + report.replies.length,
        interviews: result.interviews + report.interviews.length,
        offers: result.offers + report.offers.length
      }), { activities: 0, applications: 0, emails: 0, replies: 0, interviews: 0, offers: 0 });
      drawBand('All-weeks report', overallRange, 'All weeks');
      drawMetricCards([
        ['Total activities', totals.activities],
        ['Applications', totals.applications],
        ['Application emails', totals.emails],
        ['Replies', totals.replies],
        ['Interviews', totals.interviews],
        ['Offers', totals.offers]
      ]);
      drawTrendChart(reports);
      const tocPages = [];
      drawHeading('Table of contents');
      let headerY = cursorY + 1;
      let rowsY = headerY + 7;
      let rowsPerPage = Math.max(1, Math.floor((footerTop - rowsY) / 7));
      let nextWeekIndex = rowsPerPage;
      tocPages.push({ page: 1, headerY, rowsY, rowsPerPage, startIndex: 0 });
      let remainingWeeks = Math.max(0, reports.length - rowsPerPage);
      while (remainingWeeks > 0) {
        beginPage('All-weeks report', overallRange, 'Contents', true);
        cursorY = 37;
        drawHeading('Table of contents');
        headerY = cursorY + 1;
        rowsY = headerY + 7;
        rowsPerPage = Math.max(1, Math.floor((footerTop - rowsY) / 7));
        tocPages.push({ page: pdf.getNumberOfPages(), headerY, rowsY, rowsPerPage, startIndex: nextWeekIndex });
        nextWeekIndex += rowsPerPage;
        remainingWeeks -= rowsPerPage;
      }
      const weeklyPageNumbers = [];
      reports.forEach(report => {
        report.offset = report.offset ?? 0;
        const firstPage = pdf.getNumberOfPages() + 1;
        renderWeeklyDetails(report);
        weeklyPageNumbers.push(firstPage);
      });
      reports.forEach((report, index) => {
        const tocPage = tocPages.find(item => index >= item.startIndex && index < item.startIndex + item.rowsPerPage);
        const rowIndex = index - tocPage.startIndex;
        pdf.setPage(tocPage.page);
        cursorY = tocPage.rowsY + rowIndex * 7;
        if (rowIndex === 0) {
          setFill('#e9edf3');
          pdf.rect(margin, tocPage.headerY, contentWidth, 7, 'F');
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(9);
          setText(ink);
          pdf.text('Week', margin + 2, tocPage.headerY + 4.8);
          pdf.text('Applications', pageWidth - margin - 39, tocPage.headerY + 4.8, { align: 'right' });
          pdf.text('Activities', pageWidth - margin - 20, tocPage.headerY + 4.8, { align: 'right' });
          pdf.text('Page', pageWidth - margin - 2, tocPage.headerY + 4.8, { align: 'right' });
        }
        if (index % 2 === 1) {
          setFill('#fafbfc');
          pdf.rect(margin, cursorY, contentWidth, 7, 'F');
        }
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        setText(muted);
        pdf.text(weeklyRangeLabel(report.range), margin + 2, cursorY + 4.8);
        pdf.text(String(report.applications.length), pageWidth - margin - 39, cursorY + 4.8, { align: 'right' });
        pdf.text(String(report.activities.length), pageWidth - margin - 20, cursorY + 4.8, { align: 'right' });
        pdf.text(String(weeklyPageNumbers[index]), pageWidth - margin - 2, cursorY + 4.8, { align: 'right' });
        setLine(border);
        pdf.line(margin, cursorY + 7, pageWidth - margin, cursorY + 7);
      });
    } else {
      renderWeeklyDetails(reports[0]);
    }
    const generatedOn = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'Asia/Manila' }).format(new Date());
    const totalPages = pdf.getNumberOfPages();
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      pdf.setPage(pageNumber);
      setLine(border);
      pdf.setLineWidth(.25);
      pdf.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      setText(muted);
      pdf.text(`Generated on ${generatedOn}`, margin, pageHeight - 7);
      const period = allWeeks ? 'All weeks' : weeklyRangeLabel(reports[0].range);
      pdf.text(period, pageWidth / 2, pageHeight - 7, { align: 'center' });
      pdf.text(`Page ${pageNumber} of ${totalPages}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
    }
  }

  function downloadWeeklyReport(allWeeks = false) {
    const button = $(allWeeks ? '#downloadAllWeeksPdf' : '#downloadWeeklyReport');
    const pdfLib = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!pdfLib) {
      toast('PDF export is still loading, try again in a moment');
      return;
    }
    const previousLabel = button.textContent;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.classList.add('weekly-report-pdf-loading');
    button.textContent = 'Preparing PDF...';
    $('#weeklyReportDownloadOptions').hidden = false;
    $('#weeklyReportDownloadMenuButton').setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => {
      try {
        const offsets = allWeeks ? [...weeklyHistoryOffsets(), 0] : [weeklyReportOffset];
        const reports = offsets.map(offset => {
          const report = weeklyReportData(offset);
          report.offset = offset;
          return report;
        });
        const pdf = new pdfLib({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        drawWeeklyReportPdf(pdf, reports, allWeeks);
        pdf.save(allWeeks
          ? 'jeff-va-weekly-reports-all-weeks.pdf'
          : `jeff-va-weekly-report-${reports[0].range.end}.pdf`);
        showActionResult({ title: 'Report downloaded', message: allWeeks ? 'Your all-weeks PDF report was downloaded.' : 'Your weekly report PDF was downloaded.' });
      } catch (error) {
        console.error('Weekly report PDF export failed:', error);
        showActionResult({
          title: 'Could not generate report',
          message: error instanceof Error ? error.message : 'The weekly report PDF could not be generated. Try again.',
          status: 'error'
        });
      } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.classList.remove('weekly-report-pdf-loading');
        button.textContent = previousLabel;
        $('#weeklyReportDownloadOptions').hidden = true;
        $('#weeklyReportDownloadMenuButton').setAttribute('aria-expanded', 'false');
      }
    });
  }

  $('#openWeeklyReport').addEventListener('click', openWeeklyReport);
  $('#weeklyReportHistory').innerHTML = weeklyHistoryOptions();
  $('#weeklyReportHistory').addEventListener('change', event => {
    selectWeeklyReportWeek(Number(event.target.value));
  });
  $('#previousWeeklyReport').addEventListener('click', () => {
    selectWeeklyReportWeek(weeklyReportOffset - 1);
  });
  $('#nextWeeklyReport').addEventListener('click', () => {
    selectWeeklyReportWeek(weeklyReportOffset + 1);
  });
  $('#showCurrentWeeklyReport').addEventListener('click', () => {
    selectWeeklyReportWeek(0);
  });
  $$('.weekly-report-nav [data-report-target]').forEach(button => button.addEventListener('click', () => {
    const section = $(`#${button.dataset.reportTarget}`);
    if (!section) return;
    button.setAttribute('aria-current', 'location');
    scrollToWeeklyReportSection(section);
    updateWeeklyReportActiveSection();
  }));
  $$('#weeklyReportActivityFilters [data-activity-filter]').forEach(button => button.addEventListener('click', () => {
    weeklyReportActivityFilter = button.dataset.activityFilter;
    $$('#weeklyReportActivityFilters [data-activity-filter]').forEach(filterButton => {
      const selected = filterButton === button;
      filterButton.classList.toggle('active', selected);
      filterButton.setAttribute('aria-pressed', String(selected));
    });
    renderWeeklyReportActivities(weeklyReportData());
  }));
  $('#weeklyReportDownloadMenuButton').addEventListener('click', () => {
    const options = $('#weeklyReportDownloadOptions');
    const open = options.hidden;
    options.hidden = !open;
    $('#weeklyReportDownloadMenuButton').setAttribute('aria-expanded', String(open));
  });
  $('#weeklyReportDownloadOptions').addEventListener('click', event => {
    const action = event.target.closest('[data-report-download]')?.dataset.reportDownload;
    if (action && action !== 'pdf' && action !== 'all-weeks-pdf') {
      $('#weeklyReportDownloadOptions').hidden = true;
      $('#weeklyReportDownloadMenuButton').setAttribute('aria-expanded', 'false');
    }
    if (action === 'pdf') {
      downloadWeeklyReport();
    } else if (action === 'all-weeks-pdf') {
      downloadWeeklyReport(true);
    } else if (action === 'csv' || action === 'all-weeks') {
      downloadWeeklyCsv(action === 'all-weeks');
    }
  });
  document.addEventListener('click', event => {
    const menu = $('#weeklyReportDownloadMenu');
    if (menu && !menu.contains(event.target)) {
      $('#weeklyReportDownloadOptions').hidden = true;
      $('#weeklyReportDownloadMenuButton').setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('#weeklyReportDownloadOptions').hidden) {
      event.preventDefault();
      $('#weeklyReportDownloadOptions').hidden = true;
      $('#weeklyReportDownloadMenuButton').setAttribute('aria-expanded', 'false');
      $('#weeklyReportDownloadMenuButton').focus();
    }
  });

  const walletAccountNames = { maribank: 'MariBank', gcash: 'GCash', wise: 'Wise', unassigned: 'Other / unassigned' };
  const walletTypeNames = { income: 'Income', expense: 'Expense', payable: 'To be paid', salary: 'Salary', opening: 'Opening balance' };
  const walletMoney = cents => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(cents / 100);
  const walletEntryTypeDetail = entry => entry.type === 'payable' && entry.payee ? `To be paid · Pay to ${entry.payee}` : (walletTypeNames[entry.type] || entry.type);

  function syncWalletPayeeField() {
    const isPayable = $('#walletEntryType').value === 'payable';
    $('#walletPayeeField').hidden = !isPayable;
    $('#walletEntryPayee').required = isPayable;
    $('#walletEntryPayee').disabled = !isPayable;
    $('#walletAccountField').hidden = isPayable;
    $('#walletEntryAccount').disabled = isPayable;
    $('#walletEntryDateLabel').textContent = isPayable ? 'Payment deadline' : 'Date';
    if (!isPayable && !['maribank', 'gcash', 'wise'].includes($('#walletEntryAccount').value)) $('#walletEntryAccount').value = 'maribank';
  }

  function walletTotals(entries) {
    const totals = { income: 0, expense: 0, payable: 0, salary: 0, balance: 0, available: 0, accounts: { maribank: 0, gcash: 0, wise: 0, unassigned: 0 } };
    entries.forEach(entry => {
      if (!Object.hasOwn(walletAccountNames, entry.account) || !Object.hasOwn(walletTypeNames, entry.type) || !Number.isSafeInteger(entry.cents) || entry.cents <= 0) return;
      if (entry.type === 'payable') { totals.payable += entry.cents; return; }
      const signed = entry.type === 'expense' ? -entry.cents : entry.cents;
      totals.accounts[entry.account] += signed;
      totals.balance += signed;
      if (entry.type !== 'opening') totals[entry.type] += entry.cents;
    });
    totals.available = totals.balance - totals.payable;
    return totals;
  }

  function walletInvoiceAccount(invoice) {
    if (Object.hasOwn(walletAccountNames, invoice.walletAccount)) return invoice.walletAccount;
    const method = String(invoice.paymentMethod || '').trim().toLowerCase();
    return ['maribank', 'gcash', 'wise'].includes(method) ? method : 'unassigned';
  }

  function walletInvoiceEntries() {
    const seen = new Set();
    return (data.invoices || []).flatMap(invoice => {
      if (!invoice.id || seen.has(invoice.id) || invoicePaymentStatus(invoice) !== 'Paid') return [];
      seen.add(invoice.id);
      const php = invoice.amountReceivedPhp;
      const amount = php !== '' && php != null ? Number(php)
        : String(invoice.paymentCurrency || 'USD').toUpperCase() === 'PHP' && invoice.amountReceived !== '' && invoice.amountReceived != null ? Number(invoice.amountReceived) : NaN;
      const cents = Math.round(amount * 100);
      const client = (data.applications || []).find(item => item.id === invoice.clientId);
      return [{ id: `invoice:${invoice.id}`, invoiceId: invoice.id, type: 'salary', account: walletInvoiceAccount(invoice), cents: Number.isSafeInteger(cents) && cents >= 0 ? cents : null, description: `${client?.clientName || 'Client'} · Invoice ${invoice.invoiceNumber || invoice.id}`, date: parseInvoiceDate(invoice.paidAt), createdAt: invoice.sentAt || '' }];
    });
  }

  function renderWallet() {
    // Derive payments from invoices instead of copying them: edits and unpaid status stay in sync.
    const invoiceEntries = walletInvoiceEntries();
    const entries = [...(data.walletEntries || []), ...invoiceEntries];
    const totals = walletTotals(entries);
    $('#walletSummary').innerHTML = [
      ['balance', 'Total balance', 'All recorded PHP balances', 'fa-wallet'],
      ['income', 'Income', 'Other earnings · all time', 'fa-arrow-trend-up'],
      ['salary', 'Salary', 'Salary received · all time', 'fa-briefcase'],
      ['payable', 'To be paid', `After payments: ${walletMoney(totals.available)}`, 'fa-calendar-check'],
      ['expense', 'Expenses', 'Spending · all time', 'fa-arrow-trend-down']
    ].map(([key, label, detail, icon]) => `<article class="wallet-stat wallet-stat-${key}"><span><i class="fa-solid ${icon}" aria-hidden="true"></i> ${label}</span><strong>${walletMoney(totals[key])}</strong><small>${detail}</small></article>`).join('');
    $('#walletAccounts').innerHTML = Object.entries(walletAccountNames).filter(([key]) => key !== 'unassigned' || entries.some(entry => entry.account === key && entry.type !== 'payable')).map(([key, name]) => `<article class="wallet-account wallet-account-${key}"><div><span class="wallet-account-mark" aria-hidden="true">${name[0]}</span><h4>${name}</h4></div><strong>${walletMoney(totals.accounts[key])}</strong><span>Recorded balance · PHP</span></article>`).join('');
    const missingPhp = invoiceEntries.filter(entry => entry.cents === null).length;
    $('#walletInvoiceNotice').textContent = missingPhp ? `${missingPhp} paid invoice(s) need an amount received in PHP. They appear below but are excluded from PHP totals until you edit the payment.` : 'Paid invoices appear automatically as salary. Edit their payment details to update the amount or receiving account; do not add the same payment manually.';
    $('#walletClientRates').innerHTML = hiredClients().filter(isActiveContract).map(client => `<article class="wallet-account"><h4>${escapeHtml(client.clientName || 'Client')}</h4><strong>${escapeHtml(clientDashboardRate(client) || 'Rate not set')}</strong><span>Contract rate · counted as received only after payment</span></article>`).join('') || '<p class="wallet-hint">No active client contracts.</p>';
    const account = $('#walletAccountFilter').value;
    const visible = entries.filter(entry => account === 'all' || entry.account === account).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
    $('#walletTransactionList').innerHTML = visible.length ? `<div class="wallet-table-scroll"><table class="wallet-table"><thead><tr><th scope="col">Transaction</th><th scope="col">Date</th><th scope="col">Account</th><th scope="col">Amount</th><th scope="col">Actions</th></tr></thead><tbody>${visible.map(entry => `<tr><td><strong>${escapeHtml(entry.description)}</strong><small>${escapeHtml(walletEntryTypeDetail(entry))}</small></td><td>${entry.type === 'payable' ? `<strong>${escapeHtml(formatDate(entry.date))}</strong><small class="${entry.date < today() ? 'wallet-deadline-overdue' : ''}">${entry.date < today() ? 'Overdue' : entry.date === today() ? 'Due today' : 'Deadline'}</small>` : escapeHtml(entry.date)}</td><td>${entry.type === 'payable' ? '—' : escapeHtml(walletAccountNames[entry.account] || entry.account)}</td><td class="wallet-amount ${entry.type === 'expense' ? 'wallet-outgoing' : entry.type === 'payable' ? 'wallet-pending' : 'wallet-incoming'}">${entry.type === 'expense' ? '−' : entry.type === 'payable' ? 'Due ' : '+'}${entry.cents === null ? 'Needs PHP amount' : walletMoney(entry.cents)}</td><td><div class="wallet-row-actions">${entry.invoiceId ? `<button type="button" class="button button-secondary" data-wallet-invoice="${escapeHtml(entry.invoiceId)}">Edit payment</button>` : `<button type="button" class="button button-secondary" data-wallet-actions="${escapeHtml(entry.id)}" aria-haspopup="dialog" aria-label="Actions for ${escapeHtml(entry.description)}">Actions</button>`}</div></td></tr>`).join('')}</tbody></table></div>` : '<div class="wallet-empty"><i class="fa-solid fa-wallet" aria-hidden="true"></i><h4>No transactions yet</h4><p>Add an opening balance, income, salary, expense, or upcoming payment to start tracking.</p></div>';
  }

  function openWalletEntry(entry = null) {
    $('#walletEntryForm').reset();
    $('#walletEntryId').value = entry?.id || '';
    $('#walletEntryTitle').textContent = entry ? 'Edit transaction' : 'Add transaction';
    $('#walletEntryType').value = entry?.type || 'expense';
    $('#walletEntryAccount').value = entry?.account || 'maribank';
    $('#walletEntryAmount').value = entry ? (entry.cents / 100).toFixed(2) : '';
    $('#walletEntryDate').value = entry?.date || today();
    $('#walletEntryDescription').value = entry?.description || '';
    $('#walletEntryPayee').value = entry?.payee || '';
    syncWalletPayeeField();
    $('#walletEntryPanel').showModal();
    $('#walletEntryType').focus();
  }

  let walletActionId = null;
  function closeWalletActions() {
    const panel = $('#walletActionsPanel');
    if (panel?.open) panel.close();
    walletActionId = null;
  }
  function openWalletActions(id) {
    const entry = (data.walletEntries || []).find(item => item.id === id);
    const panel = $('#walletActionsPanel');
    if (!entry || !panel) return;
    walletActionId = id;
    $('#walletActionsSubtitle').textContent = entry.description || 'Wallet transaction';
    panel.showModal();
    $('#walletEditAction')?.focus();
  }

  $('#walletAddEntry').addEventListener('click', () => openWalletEntry());
  $('#walletEntryType').addEventListener('change', syncWalletPayeeField);
  $('#walletCancelEntry').addEventListener('click', () => { $('#walletEntryPanel').close(); $('#walletAddEntry').focus(); });
  $('#walletAccountFilter').addEventListener('change', renderWallet);
  $('#walletCancelActions')?.addEventListener('click', closeWalletActions);
  $('#walletEditAction')?.addEventListener('click', () => {
    const entry = (data.walletEntries || []).find(item => item.id === walletActionId);
    closeWalletActions();
    if (entry) openWalletEntry(entry);
  });
  $('#walletDeleteAction')?.addEventListener('click', async () => {
    const id = walletActionId;
    closeWalletActions();
    if (!id) return;
    const entry = (data.walletEntries || []).find(item => item.id === id);
    if (!entry || !await appConfirm('Delete this transaction? Its amount will be removed from your wallet totals.', { title: 'Delete transaction', confirmLabel: 'Delete', danger: true })) return;
    data.walletEntries = (data.walletEntries || []).filter(item => item.id !== id);
    renderWallet();
    renderAlerts();
    if (await persist()) toast('Wallet transaction deleted.');
  });
  $('#walletAmountKeypad').addEventListener('click', event => {
    const key = event.target.closest('[data-wallet-key]')?.dataset.walletKey;
    const amount = $('#walletEntryAmount');
    if (!key || !amount) return;
    const current = String(amount.value || '');
    if (key === 'clear') amount.value = '';
    else if (key === 'backspace') amount.value = current.slice(0, -1);
    else if (key === '.' && !current.includes('.')) amount.value = current ? `${current}.` : '0.';
    else if (/^\d$/.test(key) && current.length < 12 && !(current === '0' && key === '0')) amount.value = current === '0' ? key : `${current}${key}`;
    amount.focus();
    amount.dispatchEvent(new Event('input', { bubbles: true }));
  });
  $('#walletEntryForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    if (!dataReady || !supabaseDataLoaded || !currentUser) { toast('Wait for your workspace to finish loading.'); return; }
    const cents = Math.round(Number($('#walletEntryAmount').value) * 100);
    const description = $('#walletEntryDescription').value.trim();
    const type = $('#walletEntryType').value;
    const payee = type === 'payable' ? $('#walletEntryPayee').value.trim() : '';
    if (!Number.isSafeInteger(cents) || cents <= 0 || !description) { toast('Enter a valid amount and description.'); return; }
    if (type === 'payable' && !payee) { toast('Enter who this payment is for.'); $('#walletEntryPayee').focus(); return; }
    const entries = data.walletEntries || [];
    const id = $('#walletEntryId').value;
    const existing = entries.find(entry => entry.id === id);
    if (id && !existing) { toast('This transaction no longer exists. Cancel and add a new entry.'); return; }
    const entry = { id: existing?.id || crypto.randomUUID(), type, account: type === 'payable' ? 'unassigned' : $('#walletEntryAccount').value, cents, description, payee, date: $('#walletEntryDate').value, createdAt: existing?.createdAt || new Date().toISOString() };
    data.walletEntries = existing ? entries.map(item => item.id === id ? entry : item) : [...entries, entry];
    $('#walletEntryPanel').close();
    renderWallet();
    renderAlerts();
    if (await persist()) toast('Wallet transaction saved.');
  });
  $('#walletTransactionList').addEventListener('click', async event => {
    const invoiceButton = event.target.closest('[data-wallet-invoice]');
    if (invoiceButton) { openInvoicePayment(invoiceButton.dataset.walletInvoice); return; }
    const actions = event.target.closest('[data-wallet-actions]');
    if (actions) { openWalletActions(actions.dataset.walletActions); return; }
    const edit = event.target.closest('[data-wallet-edit]');
    const remove = event.target.closest('[data-wallet-delete]');
    const id = edit?.dataset.walletEdit || remove?.dataset.walletDelete;
    if (!id) return;
    const entry = (data.walletEntries || []).find(item => item.id === id);
    if (!entry) return;
    if (edit) { openWalletEntry(entry); return; }
    if (!await appConfirm('Delete this transaction? Its amount will be removed from your wallet totals.', { title: 'Delete transaction', confirmLabel: 'Delete', danger: true })) return;
    data.walletEntries = (data.walletEntries || []).filter(item => item.id !== id);
    if ($('#walletEntryId').value === id) $('#walletEntryPanel').close();
    renderWallet();
    renderAlerts();
    if (await persist()) toast('Wallet transaction deleted.');
  });

  let newsPage = 1;
  let newsArticles = [];
  let newsLoading = false;
  let newsRequest = 0;
  let newsLastLoaded = 0;
  let newsHasMore = false;
  const gatheredNewsStorageKey = 'jeff-va-gathered-news-v1';

  const newsCategoryNames = { all: 'All news', 'business-markets': 'Business: UK, AU, US & Canada', 'va-philippines': 'VA Philippines', 'remote-work': 'Remote work', ai: 'Artificial intelligence', 'ai-tools': 'AI tools', 'virtual-assistants': 'Virtual assistants', automation: 'Automation', 'crm-business': 'CRM & business tools', web: 'Web development', marketing: 'Digital marketing', 'social-trends': 'Social media trends' };
  const newsUrlKey = value => {
    try {
      const url = new URL(value);
      url.hash = '';
      [...url.searchParams.keys()].forEach(key => { if (/^(utm_.+|fbclid|gclid|dclid|mc_cid|mc_eid|ref|referrer|source)$/i.test(key)) url.searchParams.delete(key); });
      url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
      url.pathname = url.pathname.replace(/\/+$/, '') || '/';
      url.searchParams.sort();
      return url.toString();
    } catch { return String(value || '').toLowerCase(); }
  };
  const newsTitleKey = value => String(value || '').normalize('NFKD').toLowerCase().replace(/&(?:amp|#0*38);/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const uniqueNewsArticles = articles => {
    const urls = new Set();
    const titles = new Set();
    return articles.filter(article => {
      const urlKey = newsUrlKey(article.url);
      const titleKey = newsTitleKey(article.title);
      if ((urlKey && urls.has(urlKey)) || (titleKey && titles.has(titleKey))) return false;
      if (urlKey) urls.add(urlKey);
      if (titleKey) titles.add(titleKey);
      return true;
    });
  };
  const readGatheredNews = () => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(gatheredNewsStorageKey) || '[]');
      return Array.isArray(stored) ? uniqueNewsArticles(stored.filter(article => article?.url && article?.title)).slice(0, 100) : [];
    } catch { return []; }
  };
  let gatheredNewsArticles = readGatheredNews();
  const rememberGatheredNews = articles => {
    gatheredNewsArticles = uniqueNewsArticles([...articles, ...gatheredNewsArticles])
      .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0))
      .slice(0, 100);
    try { sessionStorage.setItem(gatheredNewsStorageKey, JSON.stringify(gatheredNewsArticles)); } catch {}
  };
  const relativeNewsTime = date => {
    const time = Date.parse(date || '');
    if (!Number.isFinite(time)) return 'Date unavailable';
    const minutes = Math.max(1, Math.round((Date.now() - time) / 60000));
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
    return `${Math.round(minutes / 1440)}d ago`;
  };
  const newsDate = date => { const time = Date.parse(date || ''); return Number.isFinite(time) ? new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Publication date unavailable'; };
  const renderGnewsUsage = usage => {
    const indicator = $('#gnewsUsage');
    if (!indicator || !usage) return;
    indicator.classList.remove('is-warning', 'is-exhausted', 'is-unavailable');
    if (!usage.configured) {
      indicator.textContent = 'GNews not connected';
      indicator.title = 'Add GNEWS_API_KEY to the production Worker.';
      indicator.classList.add('is-unavailable');
      return;
    }
    const used = Math.max(0, Number(usage.used) || 0);
    const limit = Math.max(1, Number(usage.limit) || 100);
    const remaining = Math.max(0, limit - used);
    const resetTime = Date.parse(usage.resetAt || '');
    const resetLabel = Number.isFinite(resetTime) ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(resetTime) : '00:00 UTC';
    indicator.textContent = `GNews ${used} / ${limit}`;
    indicator.title = `App-tracked usage today · ${remaining} remaining · resets ${resetLabel}`;
    if (!remaining) indicator.classList.add('is-exhausted');
    else if (remaining <= Math.max(10, Math.ceil(limit * .1))) indicator.classList.add('is-warning');
  };
  const refreshGnewsUsage = async token => {
    if (!token) return;
    try {
      const response = await fetch('/api/news/usage', { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return;
      const payload = await response.json();
      renderGnewsUsage(payload.gnews);
    } catch {}
  };
  const newsFallback = category => `<span class="news-card-fallback"><i class="fa-solid ${category === 'automation' ? 'fa-gears' : category === 'web' ? 'fa-code' : 'fa-newspaper'}" aria-hidden="true"></i></span>`;
  const newsCard = (article, variant = '') => `<article class="news-card ${variant}"><a class="news-card-media" href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(article.title)} in a new tab">${article.image ? `<img src="${escapeHtml(article.image)}" alt="" loading="lazy" data-news-fallback="${escapeHtml(article.category)}" />` : newsFallback(article.category)}</a><div class="news-card-body"><div class="news-card-meta"><span class="news-card-source">${escapeHtml(article.source || 'News source')}</span><time datetime="${escapeHtml(article.publishedAt || '')}" title="${escapeHtml(newsDate(article.publishedAt))}">${escapeHtml(relativeNewsTime(article.publishedAt))}</time></div><h3><a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title || 'Untitled article')}</a></h3><p>${escapeHtml(article.description || 'Open the original article for full details.')}</p><span class="news-card-category">${escapeHtml(newsCategoryNames[article.category] || 'News')}</span><a class="news-card-link" href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">Read article <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a></div></article>`;

  function renderNewsCategoryLoading(category) {
    const grid = $('#newsLiveGrid');
    const status = $('#newsLiveStatus');
    const loadMore = $('#loadMoreNews');
    if (!grid) return;
    const label = newsCategoryNames[category] || 'news';
    grid.setAttribute('aria-busy', 'true');
    grid.innerHTML = `<div class="news-category-loader" role="status"><span class="news-category-loader-ring" aria-hidden="true"></span><h2>Loading ${escapeHtml(label)}</h2><p>Getting the latest published stories</p><span class="news-category-loader-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>`;
    if (status) status.textContent = '';
    if (loadMore) loadMore.hidden = true;
  }

  function renderNewsArticles() {
    const grid = $('#newsLiveGrid');
    const status = $('#newsLiveStatus');
    const loadMore = $('#loadMoreNews');
    if (!grid || !status) return;
    grid.setAttribute('aria-busy', 'false');
    if (!newsArticles.length) { grid.innerHTML = '<div class="news-empty"><i class="fa-regular fa-newspaper" aria-hidden="true"></i><h2>No news available</h2><p>Try another topic or check back later.</p></div>'; status.textContent = ''; loadMore.hidden = true; return; }
    const [featured, ...rest] = newsArticles;
    const sideStories = rest.slice(0, 3);
    const highlights = rest.slice(3, 5);
    const latest = rest.slice(5);
    grid.innerHTML = `<div class="news-lead-layout"><div class="news-featured-story">${newsCard(featured, 'news-card-featured')}</div>${sideStories.length ? `<div class="news-side-stories" aria-label="More headlines">${sideStories.map(article => newsCard(article, 'news-card-compact')).join('')}</div>` : ''}</div>${highlights.length ? `<div class="news-highlights" aria-label="Featured articles">${highlights.map(article => newsCard(article, 'news-card-highlight')).join('')}</div>` : ''}${latest.length ? `<div class="news-trending-heading"><h4>Latest articles</h4><span>Newest first</span></div><div class="news-trending-grid">${latest.map(article => newsCard(article, 'news-card-trending')).join('')}</div>` : ''}`;
    grid.querySelectorAll('[data-news-fallback]').forEach(image => { image.addEventListener('error', () => { image.replaceWith(document.createRange().createContextualFragment(newsFallback(image.dataset.newsFallback))); }, { once: true }); });
    status.textContent = `${newsArticles.length} published ${newsArticles.length === 1 ? 'story' : 'stories'} · ${newsCategoryNames[$('#newsCategory').value] || 'News'}`;
    loadMore.hidden = !newsHasMore;
  }

  async function loadNews({ reset = false } = {}) {
    if (!currentUser || !$('#newsLiveGrid')) return;
    if (newsLoading && !reset) return;
    const focus = $('#newsTopicFocus');
    const topicFocus = {
      'social-trends': 'Business content inspiration: social media marketing, brand campaigns, product launches, and consumer trends across platforms.',
      'business-markets': 'Business challenges in the UK, US, Canada, and Australia: staffing, workload, customer service, costs, productivity, and growth. Look for opportunities to help owners with VA support.'
    }[$('#newsCategory').value] || '';
    if (focus) { focus.textContent = topicFocus; focus.hidden = !topicFocus; }
    const requestId = ++newsRequest;
    if (reset) {
      newsPage = 1;
      const category = $('#newsCategory').value;
      const hasSearch = Boolean($('#newsSearch').value.trim());
      newsArticles = category === 'all' && !hasSearch ? [...gatheredNewsArticles] : [];
      if (category !== 'all') renderNewsCategoryLoading(category);
      else renderNewsArticles();
    }
    newsLoading = true;
    const status = $('#newsLiveStatus');
    if (status) status.textContent = 'Loading published stories…';
    let token = '';
    try {
      const session = await supabaseClient.auth.getSession();
      token = session.data?.session?.access_token;
      if (!token) throw new Error('Sign in to view news.');
      const params = new URLSearchParams({ category: $('#newsCategory').value, q: $('#newsSearch').value.trim(), page: String(newsPage), pageSize: '10' });
      const response = await fetch(`/api/news?${params}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The news API is not running on this server. Use the Cloudflare deployment or Wrangler for live news.');
      const payload = await response.json();
      if (requestId !== newsRequest) return;
      if (!response.ok) throw new Error(payload.error || 'News could not be loaded.');
      const fetchedArticles = payload.articles || [];
      rememberGatheredNews(fetchedArticles);
      const showGathered = $('#newsCategory').value === 'all' && !$('#newsSearch').value.trim();
      newsArticles = uniqueNewsArticles([...newsArticles, ...(showGathered ? gatheredNewsArticles : fetchedArticles)]);
      newsArticles.sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
      newsHasMore = Boolean(payload.hasMore);
      newsLastLoaded = Date.now();
      $('#newsUpdatedAt').textContent = payload.updatedAt ? `Updated ${relativeNewsTime(payload.updatedAt)}` : 'Updated just now';
      renderGnewsUsage(payload.usage?.gnews);
      if (payload.errors?.length && !newsArticles.length) throw new Error(payload.errors.join(' '));
      renderNewsArticles();
    } catch (error) {
      if (requestId !== newsRequest) return;
      if (newsArticles.length) renderNewsArticles();
      else {
        $('#newsLiveGrid').setAttribute('aria-busy', 'false');
        $('#newsLiveGrid').innerHTML = '<div class="news-empty"><i class="fa-regular fa-newspaper" aria-hidden="true"></i><h2>No news available</h2><p>Please try again later.</p></div>';
      }
      $('#newsLiveStatus').textContent = error.message || 'News could not be loaded.';
      $('#loadMoreNews').hidden = true;
    } finally {
      if (requestId === newsRequest) newsLoading = false;
      if (token) refreshGnewsUsage(token);
    }
  }

  $('#newsSearch')?.addEventListener('keydown', event => { if (event.key === 'Enter') loadNews({ reset: true }); });
  $('#newsCategory')?.addEventListener('change', () => loadNews({ reset: true }));
  $('#refreshNews')?.addEventListener('click', () => loadNews({ reset: true }));
  $('#loadMoreNews')?.addEventListener('click', () => { newsPage += 1; loadNews(); });
  setInterval(() => { if (activeView === "news" && currentUser && !document.hidden && !newsLoading && Date.now() - newsLastLoaded >= 3600000) loadNews({ reset: true }); }, 60000);

  const SOCIAL_TREND_PLATFORMS = ['TikTok', 'Instagram', 'YouTube', 'Facebook', 'Other'];
  let socialTrendDrawerOpen = false;
  let socialTrendDrawerReturnFocus = null;

  function socialTrendItems() {
    data.socialTrends = Array.isArray(data.socialTrends) ? data.socialTrends : [];
    return data.socialTrends;
  }

  function socialTrendNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
  }

  function socialTrendMetric(value) {
    return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(socialTrendNumber(value));
  }

  function socialTrendPlatformClass(platform) {
    return String(platform || 'Other').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  function socialTrendPlatformIcon(platform) {
    if (platform === 'TikTok') return 'fa-brands fa-tiktok';
    if (platform === 'Instagram') return 'fa-brands fa-instagram';
    if (platform === 'YouTube') return 'fa-brands fa-youtube';
    if (platform === 'Facebook') return 'fa-brands fa-facebook-f';
    return 'fa-solid fa-hashtag';
  }

  function socialTrendSafeUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function socialTrendFilteredItems() {
    const query = ($('#socialTrendSearch')?.value || '').trim().toLowerCase();
    const platform = $('#socialTrendPlatformFilter')?.value || 'all';
    return socialTrendItems().filter(item => {
      const searchable = `${item.name || ''} ${item.platform || ''} ${item.notes || ''}`.toLowerCase();
      return (platform === 'all' || item.platform === platform) && (!query || searchable.includes(query));
    }).sort((a, b) => String(b.observedAt || b.updatedAt || '').localeCompare(String(a.observedAt || a.updatedAt || '')));
  }

  function renderSocialTrends() {
    const items = socialTrendItems();
    const visible = socialTrendFilteredItems();
    const totalViews = items.reduce((sum, item) => sum + socialTrendNumber(item.views), 0);
    const totalUses = items.reduce((sum, item) => sum + socialTrendNumber(item.uses), 0);
    const platformCounts = items.reduce((counts, item) => {
      const platform = SOCIAL_TREND_PLATFORMS.includes(item.platform) ? item.platform : 'Other';
      counts[platform] = (counts[platform] || 0) + 1;
      return counts;
    }, {});
    const topPlatform = Object.entries(platformCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
    $('#socialTrendCount').textContent = String(items.length);
    $('#socialTrendViews').textContent = socialTrendMetric(totalViews);
    $('#socialTrendViews').title = totalViews.toLocaleString();
    $('#socialTrendUses').textContent = socialTrendMetric(totalUses);
    $('#socialTrendUses').title = totalUses.toLocaleString();
    $('#socialTrendTopPlatform').textContent = topPlatform;

    const grid = $('#socialTrendGrid');
    if (!visible.length) {
      const hasItems = items.length > 0;
      grid.innerHTML = `<div class="social-trend-empty"><span><i class="fa-solid ${hasItems ? 'fa-filter' : 'fa-arrow-trend-up'}" aria-hidden="true"></i></span><h3>${hasItems ? 'No trends match these filters' : 'No trends tracked yet'}</h3><p>${hasItems ? 'Try another search or platform.' : 'Add a trend to track its views and how many videos or posts are using it.'}</p>${hasItems ? '' : '<button class="button button-primary" type="button" data-social-trend-add>Add trend</button>'}</div>`;
      return;
    }

    grid.innerHTML = visible.map(item => {
      const platform = SOCIAL_TREND_PLATFORMS.includes(item.platform) ? item.platform : 'Other';
      const scopeLabel = item.scope === 'sample' ? 'Observed sample' : 'Exact total';
      return `<article class="social-trend-card">
        <header><span class="social-trend-platform platform-${escapeHtml(socialTrendPlatformClass(platform))}"><i class="${socialTrendPlatformIcon(platform)}" aria-hidden="true"></i>${escapeHtml(platform)}</span><span class="social-trend-scope${item.scope === 'sample' ? ' is-sample' : ''}">${scopeLabel}</span></header>
        <div class="social-trend-card-copy"><h3>${escapeHtml(item.name || 'Untitled trend')}</h3>${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : '<p>No notes added.</p>'}</div>
        <div class="social-trend-metrics"><div><span>Video views</span><strong title="${socialTrendNumber(item.views).toLocaleString()}">${socialTrendMetric(item.views)}</strong></div><div><span>Videos / posts using it</span><strong title="${socialTrendNumber(item.uses).toLocaleString()}">${socialTrendMetric(item.uses)}</strong></div></div>
        <footer><span>Checked ${escapeHtml(item.observedAt ? formatDate(item.observedAt) : '—')}</span><div>${socialTrendSafeUrl(item.url) ? `<a class="button button-secondary" href="${escapeHtml(socialTrendSafeUrl(item.url))}" target="_blank" rel="noopener noreferrer">Open source <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>` : ''}<button class="icon-button" type="button" data-social-trend-edit="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.name || 'trend')}"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button></div></footer>
      </article>`;
    }).join('');
  }

  function fillSocialTrendForm(item = null) {
    const form = $('#socialTrendForm');
    form.reset();
    $('#socialTrendId').value = item?.id || '';
    $('#socialTrendDrawerTitle').textContent = item ? 'Edit trend' : 'Add trend';
    $('#socialTrendName').value = item?.name || '';
    $('#socialTrendPlatform').value = SOCIAL_TREND_PLATFORMS.includes(item?.platform) ? item.platform : 'TikTok';
    $('#socialTrendUrl').value = item?.url || '';
    $('#socialTrendViewCount').value = item ? socialTrendNumber(item.views) : '';
    $('#socialTrendUseCount').value = item ? socialTrendNumber(item.uses) : '';
    $('#socialTrendScope').value = item?.scope === 'sample' ? 'sample' : 'exact';
    $('#socialTrendObservedAt').value = item?.observedAt || today();
    $('#socialTrendNotes').value = item?.notes || '';
    $('#deleteSocialTrend').hidden = !item;
  }

  function openSocialTrendDrawer(item = null, trigger = $('#addSocialTrend')) {
    socialTrendDrawerReturnFocus = trigger;
    fillSocialTrendForm(item);
    const layer = $('#socialTrendDrawerLayer');
    layer.hidden = false;
    layer.setAttribute('aria-hidden', 'false');
    socialTrendDrawerOpen = true;
    document.body.classList.add('client-task-drawer-open');
    requestAnimationFrame(() => {
      layer.classList.add('is-open');
      $('#socialTrendName').focus();
    });
  }

  function closeSocialTrendDrawer() {
    if (!socialTrendDrawerOpen) return;
    const layer = $('#socialTrendDrawerLayer');
    socialTrendDrawerOpen = false;
    layer.classList.remove('is-open');
    layer.classList.add('is-closing');
    const finish = () => {
      layer.hidden = true;
      layer.setAttribute('aria-hidden', 'true');
      layer.classList.remove('is-closing');
      document.body.classList.remove('client-task-drawer-open');
      socialTrendDrawerReturnFocus?.focus();
      socialTrendDrawerReturnFocus = null;
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else setTimeout(finish, 270);
  }

  $('#addSocialTrend')?.addEventListener('click', event => openSocialTrendDrawer(null, event.currentTarget));
  $('#socialTrendDrawerBackdrop')?.addEventListener('click', closeSocialTrendDrawer);
  $('#cancelSocialTrend')?.addEventListener('click', closeSocialTrendDrawer);
  $('#deleteSocialTrend')?.addEventListener('click', async () => {
    const id = $('#socialTrendId').value;
    const item = socialTrendItems().find(trend => trend.id === id);
    if (!item || !(await appConfirm(`Delete “${item.name}”?`, { title: 'Delete social trend', confirmLabel: 'Delete trend', danger: true, showCloseButton: false }))) return;
    data.socialTrends = data.socialTrends.filter(trend => trend.id !== id);
    persist();
    renderSocialTrends();
    closeSocialTrendDrawer();
  });
  $('#socialTrendSearch')?.addEventListener('input', renderSocialTrends);
  $('#socialTrendPlatformFilter')?.addEventListener('change', renderSocialTrends);
  $('#socialTrendUrl')?.addEventListener('input', event => event.currentTarget.setCustomValidity(''));

  $('#socialTrendForm')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const urlField = $('#socialTrendUrl');
    const safeUrl = socialTrendSafeUrl(urlField.value.trim());
    urlField.setCustomValidity(safeUrl ? '' : 'Enter a complete http or https source link.');
    if (!form.reportValidity()) return;
    const id = $('#socialTrendId').value;
    const existing = socialTrendItems().find(item => item.id === id);
    const now = new Date().toISOString();
    const next = {
      id: existing?.id || uid(),
      name: $('#socialTrendName').value.trim(),
      platform: $('#socialTrendPlatform').value,
      url: safeUrl,
      views: socialTrendNumber($('#socialTrendViewCount').value),
      uses: socialTrendNumber($('#socialTrendUseCount').value),
      scope: $('#socialTrendScope').value === 'sample' ? 'sample' : 'exact',
      observedAt: $('#socialTrendObservedAt').value,
      notes: $('#socialTrendNotes').value.trim(),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    if (existing) Object.assign(existing, next);
    else data.socialTrends.push(next);
    persist();
    renderSocialTrends();
    closeSocialTrendDrawer();
    showActionResult({ title: existing ? 'Trend updated' : 'Trend added', message: `${next.name} is now included in Social Trends.` });
  });

  document.addEventListener('click', async event => {
    const addButton = event.target.closest('[data-social-trend-add]');
    if (addButton) {
      openSocialTrendDrawer(null, addButton);
      return;
    }
    const editButton = event.target.closest('[data-social-trend-edit]');
    if (!editButton) return;
    const item = socialTrendItems().find(trend => trend.id === editButton.dataset.socialTrendEdit);
    if (!item) return;
    openSocialTrendDrawer(item, editButton);
  });

  document.addEventListener('keydown', event => {
    if (!socialTrendDrawerOpen || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeSocialTrendDrawer();
  }, true);


  let subscriptionSaving = false;

  function subscriptionToday() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }

  function subscriptionDateValue(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return NaN;
    const [year, month, day] = value.split('-').map(Number), time = Date.UTC(year, month - 1, day);
    return year >= 1900 && new Date(time).toISOString().slice(0, 10) === value ? time : NaN;
  }

  function subscriptionStatus(item = {}, reference = subscriptionToday()) {
    item = item || {};
    if (item.tracking === 'cancelled') return { key: 'cancelled', label: 'Cancelled', detail: 'No longer tracked for renewal' };
    const expiry = subscriptionDateValue(item.expiryDate), current = subscriptionDateValue(reference);
    if (!Number.isFinite(expiry) || !Number.isFinite(current)) return { key: 'date-needed', label: 'Date needed', detail: 'Add an expiry date' };
    const days = Math.round((expiry - current) / 86400000);
    return days < 0 ? { key: 'expired', label: 'Expired', detail: `Expired ${plural(-days, 'day')} ago` }
      : days <= 7 ? { key: 'soon', label: days === 0 ? 'Expires today' : 'Expiring soon', detail: days === 0 ? 'Subscription ends today' : `${plural(days, 'day')} remaining` }
        : { key: 'active', label: 'Active', detail: `${plural(days, 'day')} remaining` };
  }

  function validateSubscriptionDraft(input, records = [], editingId = '') {
    const name = String(input.name || '').trim(), account = String(input.account || '').trim();
    if (!name || name.length > 120) return { error: 'Enter an account type or service name within 120 characters.' };
    if (account.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) return { error: 'Enter a valid email address for this account.' };
    const identity = value => String(value || '').normalize('NFKC').trim().toLowerCase();
    if (records.some(item => item && item.id !== editingId && identity(item.name) === identity(name) && identity(item.account) === identity(account))) return { error: 'This service and account are already saved. Edit the existing subscription.' };
    if (!Number.isFinite(subscriptionDateValue(input.expiryDate))) return { error: 'Choose a valid subscription end date.' };
    return { value: { name, account, expiryDate: input.expiryDate } };
  }

  function renderSubscriptions() {
    const records = (data.subscriptions || []).filter(item => item?.id);
    const states = records.map(item => subscriptionStatus(item));
    $('#subscriptionSummary').innerHTML = [['Active', states.filter(state => ['active', 'soon'].includes(state.key)).length, 'Accounts still in their paid period'],
      ['Expiring soon', states.filter(state => state.key === 'soon').length, 'Today or within the next 7 days'],
      ['Expired', states.filter(state => state.key === 'expired').length, 'Subscriptions past their end date']]
      .map(([label, count, detail]) => `<article><span>${label}</span><strong>${count}</strong><small>${detail}</small></article>`).join('');
    const query = $('#subscriptionSearch').value.trim().toLowerCase(), filter = $('#subscriptionFilter').value;
    const visible = records.filter(item => [item.name, item.account].join(' ').toLowerCase().includes(query))
      .filter(item => filter === 'all' || (filter === 'active' ? ['active', 'soon'].includes(subscriptionStatus(item).key) : subscriptionStatus(item).key === filter))
      .sort((a, b) => Number(a.tracking === 'cancelled') - Number(b.tracking === 'cancelled') || String(a.expiryDate || '9999').localeCompare(String(b.expiryDate || '9999')) || String(a.name).localeCompare(String(b.name)));
    $('#subscriptionCount').textContent = `${plural(visible.length, 'subscription')}${query || filter !== 'all' ? ' shown' : ''}`;
    $('#subscriptionList').innerHTML = visible.length ? visible.map(item => {
      const status = subscriptionStatus(item);
      return `<article class="subscription-card" data-state="${status.key}"><div class="subscription-card-heading"><div><h2>${escapeHtml(item.name || 'Untitled account')}</h2><p>${escapeHtml(item.account || 'Account not specified')}</p></div><span class="subscription-status">${status.label}</span></div>
        <div class="subscription-expiry"><span>End of subscription</span><strong>${Number.isFinite(subscriptionDateValue(item.expiryDate)) ? escapeHtml(formatDate(item.expiryDate)) : 'Not set'}</strong><small>${escapeHtml(status.detail)}</small></div>
        <footer><div><button class="button button-secondary" type="button" data-subscription-edit="${escapeHtml(item.id)}" aria-haspopup="dialog">Manage</button></div></footer></article>`;
    }).join('') : `<div class="subscriptions-empty"><i class="fa-regular fa-credit-card" aria-hidden="true"></i><h2>${records.length ? 'No subscriptions found' : 'No subscriptions yet'}</h2><p>${records.length ? 'Try another search or status filter.' : 'Add a paid account to track its expiry and plan your next renewal.'}</p></div>`;
  }

  function openSubscriptionEditor(id = '') {
    if (subscriptionSaving) return;
    const item = (data.subscriptions || []).find(record => record.id === id);
    if (id && !item) return;
    const form = $('#subscriptionForm'); form.reset();
    form.dataset.userId = currentUser?.id || '';
    $('#subscriptionId').value = item?.id || '';
    $('#subscriptionEditorTitle').textContent = item ? 'Manage subscription' : 'Add subscription';
    for (const [field, value] of Object.entries({ Name: item?.name || '', Account: item?.account || '', Expiry: item?.expiryDate || '' })) $('#subscription' + field).value = value;
    $('#subscriptionFormError').hidden = true;
    $('#deleteSubscription').hidden = !item; $('#saveSubscription').textContent = 'Save subscription';
    const dialog = $('#subscriptionEditor'); if (!dialog.open) dialog.showModal();
    $('#subscriptionName').focus();
  }

  function subscriptionFormError(message) {
    $('#subscriptionFormError').textContent = message; $('#subscriptionFormError').hidden = false;
  }

  function setSubscriptionSaving(value) {
    subscriptionSaving = value;
    ['saveSubscription', 'deleteSubscription', 'closeSubscriptionEditor', 'cancelSubscriptionEditor'].forEach(id => { $('#' + id).disabled = value; });
    $('#subscriptionForm').setAttribute('aria-busy', String(value));
  }

  $('#addSubscription').addEventListener('click', () => openSubscriptionEditor());
  $('#subscriptionSearch').addEventListener('input', renderSubscriptions);
  $('#subscriptionFilter').addEventListener('change', renderSubscriptions);
  ['closeSubscriptionEditor', 'cancelSubscriptionEditor'].forEach(id => $('#' + id).addEventListener('click', () => { if (!subscriptionSaving) $('#subscriptionEditor').close(); }));
  $('#subscriptionEditor').addEventListener('cancel', event => { if (subscriptionSaving) event.preventDefault(); });
  $('#subscriptionList').addEventListener('click', event => {
    const edit = event.target.closest('[data-subscription-edit]');
    if (edit) openSubscriptionEditor(edit.dataset.subscriptionEdit);
  });
  $('#subscriptionForm').addEventListener('submit', async event => {
    event.preventDefault(); if (subscriptionSaving || !event.currentTarget.reportValidity()) return;
    if (!currentUser || event.currentTarget.dataset.userId !== currentUser.id) { subscriptionFormError('Your account changed. Close this form and reopen it.'); return; }
    const workspace = data, userId = currentUser.id, id = $('#subscriptionId').value;
    const existing = (workspace.subscriptions || []).find(item => item.id === id);
    if (id && !existing) { subscriptionFormError('This subscription is no longer available. Reopen the page.'); return; }
    const input = Object.fromEntries(['Name', 'Account', 'Expiry'].map(field => [field === 'Expiry' ? 'expiryDate' : field.toLowerCase(), $('#subscription' + field).value]));
    const validated = validateSubscriptionDraft(input, workspace.subscriptions || [], id);
    if (validated.error) { subscriptionFormError(validated.error); return; }
    const now = new Date().toISOString(), record = { ...existing, ...validated.value, id: id || uid(), createdAt: existing?.createdAt || now, updatedAt: now };
    const previous = workspace.subscriptions || [];
    workspace.subscriptions = id ? previous.map(item => item.id === id ? record : item) : [...previous, record];
    setSubscriptionSaving(true);
    let saved = false; try { saved = await persist(); } catch { /* Retain the form for retry. */ } finally { setSubscriptionSaving(false); }
    if (currentUser?.id !== userId || data !== workspace) return;
    if (!saved) { workspace.subscriptions = previous; subscriptionFormError('The subscription could not be saved. Please try again.'); return; }
    $('#subscriptionEditor').close(); renderAll();
    toast(id ? 'Subscription updated' : 'Subscription added');
  });
  $('#deleteSubscription').addEventListener('click', async () => {
    if (subscriptionSaving) return;
    const workspace = data, userId = currentUser?.id, id = $('#subscriptionId').value;
    if (!userId || $('#subscriptionForm').dataset.userId !== userId) return;
    const item = (workspace.subscriptions || []).find(record => record.id === id);
    if (!item || !(await appConfirm(`Remove ${item.name} from your subscription tracker?`, { title: 'Delete subscription', confirmLabel: 'Delete', danger: true }))) return;
    if (currentUser?.id !== userId || data !== workspace || subscriptionSaving) return;
    const previous = workspace.subscriptions; workspace.subscriptions = previous.filter(record => record.id !== id);
    setSubscriptionSaving(true);
    let saved = false; try { saved = await persist(); } catch { /* Restore on failure. */ } finally { setSubscriptionSaving(false); }
    if (currentUser?.id !== userId || data !== workspace) return;
    if (!saved) { workspace.subscriptions = previous; subscriptionFormError('The subscription could not be deleted. Please try again.'); return; }
    $('#subscriptionEditor').close(); renderAll(); toast('Subscription deleted');
  });

  // Login screen, explicit logout, and application startup.
  const loginForm = $('#loginForm');
  const loginError = $('#loginError');
  const loginUsername = $('#loginUsername');
  const loginPassword = $('#loginPassword');
  const loginSubmitButton = $('.login-submit', loginForm);
  setAuthenticated(false);
  loginSubmitButton.disabled = true;
  $('#loginGoogleButton').disabled = true;
  $('#loginGoogleStatus').textContent = 'Checking for your saved session…';

  loginForm?.addEventListener('submit', async event => {
    event.preventDefault();
    event.stopPropagation();
    const identity = loginUsername.value.trim();
    const password = loginPassword.value;
    if (!supabaseConfigured()) {
      loginError.textContent = 'Sign-in is unavailable. Check the app configuration.';
      return;
    }
    const email = identity.includes('@') ? identity : (window.SUPABASE_LOGIN_EMAIL || '');
    if (!email) {
      loginError.textContent = 'Enter your account email to sign in.';
      loginPassword.value = '';
      return;
    }
    loginError.textContent = '';
    activeAuthProvider = 'email';
    sessionStorage.setItem(AUTH_PROVIDER_SESSION_KEY, activeAuthProvider);
    setButtonLoading(loginSubmitButton, true);
    try {
      const client = requireSupabase();
      const { data: authData, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      loginForm.reset();
      await initializeSupabaseForUser(authData.user, { recordSignIn: true, showOverview: true });
    } catch (error) {
      activeAuthProvider = null;
      sessionStorage.removeItem(AUTH_PROVIDER_SESSION_KEY);
      console.error(error);
      const message = error?.message?.trim() || '';
      loginError.textContent = /invalid login credentials/i.test(message)
        ? 'The account email or password is incorrect.'
        : message
          ? `Sign-in failed: ${message}`
          : 'Sign-in failed. Check your connection and try again.';
      loginPassword.value = '';
      loginPassword.focus();
    } finally {
      if (!currentUser) setButtonLoading(loginSubmitButton, false);
    }
  });
  $('#loginGoogleButton').addEventListener('click', loginWithGoogle);
  $('#sendPasswordResetLinkButton').addEventListener('click', async () => {
    const email = currentUser?.email;
    if (!email) {
      showActionResult({ title: 'Account email unavailable', message: 'Your account email could not be read. Check your account details and try again.', status: 'error' });
      return;
    }
    const button = $('#sendPasswordResetLinkButton');
    button.disabled = true;
    try {
      const redirectTo = `${window.location.origin}${window.location.pathname}`;
      const { error } = await requireSupabase().auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      showActionResult({ title: 'Check your email', message: 'If password recovery is available for this address, a reset link has been sent.' });
    } catch (error) {
      console.error('Could not request password recovery:', error);
      showActionResult({ title: 'Could not send reset link', message: 'Check your connection and email recovery settings, then try again.', status: 'error' });
    } finally {
      button.disabled = false;
    }
  });
  $('#changePasswordForm').addEventListener('submit', async event => {
    if (event.submitter?.value === 'cancel') return;
    event.preventDefault();
    const password = $('#newPassword').value;
    const confirmation = $('#confirmNewPassword').value;
    const requiresCurrentPassword = !$('#currentPasswordField').hidden;
    const alreadyHasPassword = userHasPasswordIdentity();
    const currentPassword = $('#currentPassword').value;
    if (password.length < 8) {
      $('#changePasswordError').textContent = 'Use at least 8 characters for your new password.';
      $('#newPassword').focus();
      return;
    }
    if (requiresCurrentPassword && !currentPassword) {
      $('#changePasswordError').textContent = 'Enter your current password.';
      $('#currentPassword').focus();
      return;
    }
    if (password !== confirmation) {
      $('#changePasswordError').textContent = 'The passwords do not match.';
      $('#confirmNewPassword').focus();
      return;
    }
    const saveButton = $('#saveNewPasswordButton');
    saveButton.disabled = true;
    $('#changePasswordError').textContent = '';
    try {
      const attributes = { password };
      if (requiresCurrentPassword) attributes.current_password = currentPassword;
      const { data: updatedUser, error } = await requireSupabase().auth.updateUser(attributes);
      if (error) throw error;
      if (updatedUser.user) currentUser = updatedUser.user;
      $('#changePasswordForm').reset();
      setPasswordRecoveryMode(false);
      renderPasswordPage();
      showActionResult({
        title: alreadyHasPassword ? 'Password changed' : 'Password set',
        message: alreadyHasPassword
          ? 'Your account password has been updated.'
          : 'You can now sign in with your email and password.'
      });
    } catch (error) {
      console.error('Could not update account password:', error);
      $('#changePasswordError').textContent = 'Could not change the password. Check your current password and try again.';
    } finally {
      saveButton.disabled = false;
    }
  });
  $('#logoutButton')?.addEventListener('click', async () => {
    startAuthTransition('Signing you out…', 'Ending your session securely.');
    if (gmailSyncTimer) {
      clearInterval(gmailSyncTimer);
      gmailSyncTimer = null;
    }
    if (currentUser?.id) localStorage.removeItem(`${GMAIL_CREDENTIALS_KEY}${currentUser.id}`);
    gmailAccessToken = null;
    gmailReconnectRequired = false;
    sessionStorage.removeItem(GMAIL_TOKEN_SESSION_KEY);
    sessionStorage.removeItem(GMAIL_CONNECTED_KEY);
    sessionStorage.removeItem(GMAIL_RECONNECT_REQUIRED_KEY);
    updateLoginGoogleUI(false, 'Use your Google account to open the dashboard.');
    updateGmailConnectionUI(false);
    setGmailStatus('Gmail ready — log in with Google to sync your inbox');
    if (currentUser?.id) sessionStorage.removeItem(`${WORKSPACE_READY_NOTICE_KEY}:${currentUser.id}`);
    try {
      if (supabaseClient) {
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;
      }
    } catch (error) {
      console.error(error);
      try {
        if (supabaseClient) {
          const { error: localSignOutError } = await supabaseClient.auth.signOut({ scope: 'local' });
          if (localSignOutError) console.error('Could not clear the local Supabase session:', localSignOutError);
        }
      } catch (localSignOutError) {
        console.error('Could not clear the local Supabase session:', localSignOutError);
      }
    }
    currentUser = null;
    activeAuthProvider = null;
    sessionStorage.removeItem(AUTH_PROVIDER_SESSION_KEY);
    renderAccountAccess();
    if (appStateChannel && supabaseClient) {
      supabaseClient.removeChannel(appStateChannel);
      appStateChannel = null;
    }
    if (applyReminderTimer) {
      clearInterval(applyReminderTimer);
      applyReminderTimer = null;
    }
    stopNotificationRefreshTimer();
    stopSavedEmailAiChecks();
    dataReady = false;
    supabaseDataLoaded = false;
    data = emptyData();
    setAuthenticated(false);
    applicationDateFilter = '';
    $('#applicationDateFilter').value = applicationDateFilter;
    applicationDateSort = 'all';
    $('#applicationDateSort').value = 'all';
    renderAll();
    await finishWelcomeTransition();
    setButtonLoading(loginSubmitButton, false);
    $('#loginUsername').focus();
  });

  applicationDateFilter = '';
  $('#applicationDateFilter').value = applicationDateFilter;
  applicationDateSort = 'all';
  $('#applicationDateSort').value = 'all';
  renderAll();
  window.addEventListener('online', renderAccountPage);
  window.addEventListener('offline', renderAccountPage);
  const initialView = appViewFromLocation() || 'dashboard';
  showView(initialView, { updateUrl: false });
  const legacyHashView = window.location.hash.slice(1);
  if (APP_VIEW_SET.has(legacyHashView)) {
    window.history.replaceState({ view: initialView }, document.title, appViewPath(initialView));
  }
  window.addEventListener('popstate', () => {
    showView(appViewFromLocation() || 'dashboard', { updateUrl: false });
  });
  // Restore the remembered session, including a Google callback or refresh.
  restoreSupabaseSession().finally(() => {
    loginSubmitButton.disabled = Boolean(currentUser);
    initGmail();
  });

// Task management belongs to the selected Active Client and is persisted with the app state.
const CLIENT_TASK_CATEGORIES = ['Graphic Design', 'Social Media', 'Email Marketing', 'Digital Marketing', 'Web Development', 'Other'];
const CLIENT_TASK_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
let clientTaskEditingId = '';
let clientTaskDrawerReturnFocus = null;
let clientTaskDrawerOpen = false;
let clientTaskDrawerClosing = false;
let clientTaskDrawerCloseTimer = null;
let clientTaskDraftEntries = [];
let clientTaskTickTimer = null;
let clientTaskDrawerMode = 'form';
let clientTaskActionId = '';

function getClientTasks(clientId = hiredEditingId) {
  data.clientTasks = Array.isArray(data.clientTasks) ? data.clientTasks : [];
  return data.clientTasks.filter(task => task.clientId === clientId);
}

function clientTaskIsEnded(clientId = hiredEditingId) {
  const client = data.applications.find(application => application.id === clientId);
  return Boolean(client && (client.contractStatus === 'Contract Ended' || isContractEnded(client)));
}

function saveClientTasks() {
  persist().catch(error => console.error('Could not save Active Client tasks:', error));
  renderAlerts();
}

function clientTaskLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function clientTaskClockMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  return (Number(match[1]) * 60) + Number(match[2]);
}

function clientTaskScheduledMinutes(startTime, endTime) {
  const start = clientTaskClockMinutes(startTime);
  const end = clientTaskClockMinutes(endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const adjustedEnd = end <= start ? end + (24 * 60) : end;
  return adjustedEnd - start;
}

function clientTaskSelectedWeekdays() {
  return $$('#clientTaskWeekdays input:checked').map(input => Number(input.value)).sort((a, b) => a - b);
}

function clientTaskWorkdayCount(startDate, endDate, weekdays = [1, 2, 3, 4, 5]) {
  if (!startDate || !endDate || endDate < startDate) return 0;
  const selectedDays = new Set(weekdays);
  const cursor = new Date(`${startDate}T12:00:00`);
  const last = new Date(`${endDate}T12:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return 0;
  let count = 0;
  while (cursor <= last) {
    const day = cursor.getDay();
    if (selectedDays.has(day)) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function clientTaskFirstWorkday(startDate, endDate, weekdays = [1, 2, 3, 4, 5]) {
  if (!startDate || !endDate || endDate < startDate) return '';
  const selectedDays = new Set(weekdays);
  const cursor = new Date(`${startDate}T12:00:00`);
  for (let offset = 0; offset < 7 && clientTaskLocalDateKey(cursor) <= endDate; offset += 1) {
    const day = cursor.getDay();
    if (selectedDays.has(day)) return clientTaskLocalDateKey(cursor);
    cursor.setDate(cursor.getDate() + 1);
  }
  return '';
}

function clientTaskWeekdaysInRange(startDate, endDate) {
  const weekdays = new Set();
  if (!startDate || !endDate || endDate < startDate) return weekdays;
  const cursor = new Date(`${startDate}T12:00:00`);
  const last = new Date(`${endDate}T12:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return weekdays;
  while (cursor <= last && weekdays.size < 5) {
    const day = cursor.getDay();
    if (day >= 1 && day <= 5) weekdays.add(day);
    cursor.setDate(cursor.getDate() + 1);
  }
  return weekdays;
}

function syncClientTaskWorkdaysToRange() {
  const availableDays = clientTaskWeekdaysInRange(
    $('#clientTaskScheduleStartDate').value,
    $('#clientTaskScheduleEndDate').value
  );
  if (!availableDays.size) return;
  $('#clientTaskWeekdays').querySelectorAll('input').forEach(input => {
    input.checked = availableDays.has(Number(input.value));
  });
  updateClientTaskRepeatFields();
}

function clientTaskTimeLabel(value) {
  const minutes = clientTaskClockMinutes(value);
  if (!Number.isFinite(minutes)) return '';
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function updateClientTaskSchedule() {
  if (clientTaskOneOffMode) return;
  const startDate = $('#clientTaskScheduleStartDate').value;
  const endDate = $('#clientTaskScheduleEndDate').value;
  const startTime = $('#clientTaskScheduleStartTime').value;
  const endTime = $('#clientTaskScheduleEndTime').value;
  const weekdays = clientTaskSelectedWeekdays();
  const minutesPerDay = clientTaskScheduledMinutes(startTime, endTime);
  const workdays = clientTaskWorkdayCount(startDate, endDate, weekdays);
  const totalMinutes = minutesPerDay * workdays;
  $('#clientTaskDueDate').value = clientTaskFirstWorkday(startDate, endDate, weekdays);
  $('#clientTaskEstimate').value = minutesPerDay ? String(minutesPerDay) : '';
  $('#clientTaskScheduleDailyMinutes').textContent = minutesPerDay ? `${minutesPerDay.toLocaleString()} minutes / day` : 'Set working hours';
  const summary = $('#clientTaskScheduleSummary');
  if (startDate && endDate && endDate < startDate) {
    summary.textContent = 'The end date must be on or after the start date.';
    return;
  }
  if (!weekdays.length) {
    summary.textContent = 'Choose at least one work day.';
    return;
  }
  if (!startDate || !endDate || !minutesPerDay) {
    summary.textContent = 'Choose the start and end dates to calculate the schedule.';
    return;
  }
  const overnight = clientTaskClockMinutes(endTime) <= clientTaskClockMinutes(startTime);
  const selectedLabels = weekdays.map(day => CLIENT_TASK_WEEKDAYS[day].slice(0, 3)).join(', ');
  summary.innerHTML = `<strong>${workdays} workday${workdays === 1 ? '' : 's'} · ${totalMinutes.toLocaleString()} total minutes</strong><br>${escapeHtml(clientTaskTimeLabel(startTime))}–${escapeHtml(clientTaskTimeLabel(endTime))}${overnight ? ' overnight' : ''} · ${escapeHtml(selectedLabels)}.`;
}

function clientTaskTimeEntries(task) {
  return Array.isArray(task.timeEntries) ? task.timeEntries : [];
}

function clientTaskElapsed(entry, now = Date.now()) {
  if (Number.isFinite(entry.durationMs)) return Math.max(0, entry.durationMs);
  const start = new Date(entry.start || '').getTime();
  const end = new Date(entry.end || '').getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

function clientTaskTotalMs(task, now = Date.now()) {
  const entries = clientTaskTimeEntries(task).reduce((total, entry) => total + clientTaskElapsed(entry, now), 0);
  const startedAt = new Date(task.timerStartedAt || '').getTime();
  return entries + (Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : 0);
}

function clientTaskFormatDuration(milliseconds) {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m` : `${seconds}s`;
}

function clientTaskClock(milliseconds) {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function clientTaskMonthlyMs(tasks, now = new Date()) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  let total = 0;
  tasks.forEach(task => {
    clientTaskTimeEntries(task).forEach(entry => {
      const start = new Date(entry.start || '').getTime();
      const end = new Date(entry.end || '').getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end)) return;
      total += Math.max(0, Math.min(end, nextMonth) - Math.max(start, monthStart));
    });
    const running = new Date(task.timerStartedAt || '').getTime();
    if (Number.isFinite(running)) total += Math.max(0, Math.min(now.getTime(), nextMonth) - Math.max(running, monthStart));
  });
  return total;
}

function clientTaskWeekEnd() {
  const current = new Date();
  current.setHours(12, 0, 0, 0);
  current.setDate(current.getDate() + (7 - current.getDay()) % 7);
  return clientTaskLocalDateKey(current);
}

function clientTaskFiltered(tasks) {
  const query = $('#clientTaskSearch').value.trim().toLowerCase();
  const status = $('#clientTaskStatusFilter').value;
  const priority = $('#clientTaskPriorityFilter').value;
  return tasks.filter(task => {
    const taskStatus = task.status === 'done' || task.completedAt ? 'done' : task.status || 'todo';
    const content = `${task.title || ''} ${task.category || ''} ${task.notes || ''}`.toLowerCase();
    return (status === 'all' || taskStatus === status)
      && (priority === 'all' || task.priority === priority)
      && (!query || content.includes(query));
  });
}

function clientTaskDueLabel(task) {
  if (!task.dueDate) return '<span class="client-task-due no-date">No due date</span>';
  const overdue = task.dueDate < today() && task.status !== 'done' && !task.completedAt;
  return `<time class="client-task-due${overdue ? ' is-overdue' : ''}" datetime="${escapeHtml(task.dueDate)}">${overdue ? '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ' : ''}${escapeHtml(formatDate(task.dueDate))}</time>`;
}

function clientTaskRenderRow(task, ended) {
  const done = task.status === 'done' || Boolean(task.completedAt);
  const running = Boolean(task.timerStartedAt);
  const priority = ['Low', 'Medium', 'High'].includes(task.priority) ? task.priority : 'Medium';
  const time = clientTaskTotalMs(task);
  const createdAt = task.createdAt ? new Date(task.createdAt) : null;
  const createdLabel = createdAt && !Number.isNaN(createdAt.getTime())
    ? `<time datetime="${escapeHtml(createdAt.toISOString())}" title="${escapeHtml(createdAt.toString())}">Created ${escapeHtml(createdAt.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }))}</time>`
    : 'Created time unavailable';
  const repeatIcon = task.repeat?.frequency && task.repeat.frequency !== 'none'
    ? '<span class="client-task-recurring" title="Recurring task" aria-label="Recurring task"><i class="fa-solid fa-repeat" aria-hidden="true"></i></span>'
    : '';
  const scheduleLabel = task.scheduleStartTime && task.scheduleEndTime
    ? `<span class="client-task-schedule-label"><i class="fa-regular fa-clock" aria-hidden="true"></i>${escapeHtml(clientTaskTimeLabel(task.scheduleStartTime))}–${escapeHtml(clientTaskTimeLabel(task.scheduleEndTime))}</span>`
    : '';
  return `<article class="client-task-row${done ? ' is-complete' : ''}${running ? ' is-running' : ''}" data-client-task-row="${escapeHtml(task.id)}">
    <label class="client-task-complete-control"><input type="checkbox" data-client-task-complete="${escapeHtml(task.id)}" ${done ? 'checked' : ''} aria-label="${done ? 'Reopen' : 'Complete'} task: ${escapeHtml(task.title || 'Untitled task')}" /><span class="sr-only">${done ? 'Completed' : 'Mark complete'}</span></label>
    <div class="client-task-row-main">
      <div class="client-task-row-title-line"><button class="client-task-title-button" type="button" data-client-task-edit="${escapeHtml(task.id)}">${escapeHtml(task.title || 'Untitled task')}</button><span class="client-task-category">${escapeHtml(CLIENT_TASK_CATEGORIES.includes(task.category) ? task.category : 'Other')}</span></div>
      <div class="client-task-row-meta"><span class="client-task-priority priority-${priority.toLowerCase()}"><i aria-hidden="true"></i>${priority}</span>${clientTaskDueLabel(task)}${scheduleLabel}${repeatIcon}${task.sourceEmailId ? `<button class="text-button task-source-email" type="button" data-task-source-email="${escapeHtml(task.id)}" title="${escapeHtml(`${task.sourceEmailFrom || ""}: ${task.sourceEmailSubject || ""}`)}">View email</button>` : ""}<span class="client-task-status-text">${done ? 'Done' : task.status === 'in-progress' ? 'In progress' : 'To do'}</span></div>
      <div class="client-task-created">${createdLabel}${task.automaticallyCreated ? ' · Automatically created from email' : ''}</div>
    </div>
    <span class="client-task-time-logged" data-client-task-time="${escapeHtml(task.id)}">${escapeHtml(clientTaskFormatDuration(time))}</span>
    <span class="client-task-live-clock${running ? ' is-visible' : ''}" data-client-task-clock="${escapeHtml(task.id)}">${running ? clientTaskClock(time) : ''}</span>
    <button class="client-task-timer-button${running ? ' is-running' : ''}" type="button" data-client-task-timer="${escapeHtml(task.id)}" ${ended || done ? 'disabled' : ''} aria-label="${running ? 'Pause timer' : 'Start timer'} for ${escapeHtml(task.title || 'task')}" title="${ended ? 'Timers are disabled for ended contracts' : running ? 'Pause timer' : 'Start timer'}"><i class="fa-solid ${running ? 'fa-pause' : 'fa-play'}" aria-hidden="true"></i></button>
    <div class="client-task-menu-wrap">
      <button class="client-task-menu-button" type="button" data-client-task-menu="${escapeHtml(task.id)}" aria-label="Open actions for ${escapeHtml(task.title || 'task')}" aria-haspopup="dialog"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button>
    </div>
  </article>`;
}

function clientTaskGroupMarkup(group, tasks, ended, open = true) {
  if (!tasks.length) return '';
  const rows = tasks.sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'))
    || String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .map(task => clientTaskRenderRow(task, ended)).join('');
  const completed = group === 'Completed';
  return `<details class="client-task-group${completed ? ' is-completed-group' : ''}" data-client-task-group="${group}" ${completed ? (open ? 'open' : '') : 'open'}>
    <summary><span>${group}</span><span class="client-task-group-count">${tasks.length}</span></summary>
    <div class="client-task-group-rows">${rows}</div>
  </details>`;
}

function renderClientTasks(clientId = hiredEditingId) {
  if (!clientId) return;
  const tasks = getClientTasks(clientId);
  const now = new Date();
  const day = today();
  const weekEnd = clientTaskWeekEnd();
  const openTasks = tasks.filter(task => (task.status || 'todo') !== 'done' && !task.completedAt);
  const overdueCount = openTasks.filter(task => task.dueDate && task.dueDate < day).length;
  const weekCount = openTasks.filter(task => task.dueDate && task.dueDate >= day && task.dueDate <= weekEnd).length;
  $('#clientTaskOpenCount').textContent = String(openTasks.length);
  $('#clientTaskWeekCount').textContent = String(weekCount);
  const monthHours = clientTaskMonthlyMs(tasks, now);
  $('#clientTaskMonthHours').textContent = clientTaskFormatDuration(monthHours);
  const overdueSummary = $('#clientTaskOverdueCount');
  overdueSummary.textContent = String(overdueCount);
  overdueSummary.classList.toggle('has-overdue', overdueCount > 0);
  $('#clientTaskTabCount').textContent = String(openTasks.length);
  $('#clientTasksContractNotice').hidden = !clientTaskIsEnded(clientId);

  const target = $('#clientTaskGroups');
  const priorCompletedOpen = target.querySelector('[data-client-task-group="Completed"]')?.open;
  const visible = clientTaskFiltered(tasks);
  if (!visible.length) {
    const hasAnyTasks = tasks.length > 0;
    target.innerHTML = `<div class="client-task-empty"><i class="fa-regular ${hasAnyTasks ? 'fa-filter' : 'fa-clipboard'}" aria-hidden="true"></i><h3>${hasAnyTasks ? 'No tasks match these filters' : 'No tasks for this client yet'}</h3><p>${hasAnyTasks ? 'Try adjusting the search or filters.' : 'Use Actions → New task to schedule work for this client.'}</p></div>`;
    return;
  }

  const done = visible.filter(task => task.status === 'done' || task.completedAt);
  const active = visible.filter(task => !done.includes(task));
  const groups = {
    Overdue: active.filter(task => task.dueDate && task.dueDate < day),
    Today: active.filter(task => task.dueDate === day),
    'This week': active.filter(task => task.dueDate > day && task.dueDate <= weekEnd),
    Later: active.filter(task => !task.dueDate || task.dueDate > weekEnd),
    Completed: done
  };
  target.innerHTML = Object.entries(groups)
    .map(([name, entries]) => clientTaskGroupMarkup(name, entries, clientTaskIsEnded(clientId), name === 'Completed' ? Boolean(priorCompletedOpen) : true))
    .join('');
}

let clientTaskOneOffMode = false;

function clientTaskRepeatValue() {
  if (clientTaskOneOffMode) return { frequency: 'none', weekdays: [], dayOfMonth: null };
  return { frequency: 'weekly', weekdays: clientTaskSelectedWeekdays(), dayOfMonth: null };
}

function updateClientTaskRepeatFields() {
  if (clientTaskOneOffMode) {
    $('#clientTaskRepeatPreview').textContent = 'One-time task from email';
    return;
  }
  $('#clientTaskWeekdays').hidden = false;
  $('#clientTaskMonthDayField').hidden = true;
  const selected = clientTaskSelectedWeekdays().map(day => CLIENT_TASK_WEEKDAYS[day]);
  $('#clientTaskRepeatPreview').textContent = selected.length
    ? `A new task occurrence is created every ${selected.join(', ')} until the end date.`
    : 'Choose at least one work day.';
}

function fillClientTaskDrawer(task = null) {
  const form = $('#clientTaskForm');
  form.reset();
  clientTaskOneOffMode = task?.repeat?.frequency === 'none';
  $('#clientTaskScheduleSection').hidden = clientTaskOneOffMode;
  $('#clientTaskOneOffFields').hidden = !clientTaskOneOffMode;
  $('#clientTaskScheduleSection').querySelectorAll('input').forEach(input => { input.disabled = clientTaskOneOffMode; });
  $('#clientTaskDueDate').value = task?.dueDate || '';
  $('#clientTaskEstimate').value = task?.estimateMinutes ?? '';
  $('#clientTaskDueDate').setCustomValidity('');
  $('#clientTaskManualEnd').setCustomValidity('');
  clientTaskEditingId = task?.id || '';
  clientTaskDraftEntries = task ? clientTaskTimeEntries(task).map(entry => ({ ...entry })) : [];
  $('#clientTaskDrawerTitle').textContent = task ? 'Edit task' : 'New task';
  $('#clientTaskDrawerClientName').textContent = data.applications.find(item => item.id === hiredEditingId)?.clientName || '';
  $('#clientTaskTitle').value = task?.title || '';
  $('#clientTaskCategory').value = CLIENT_TASK_CATEGORIES.includes(task?.category) ? task.category : 'Graphic Design';
  $('#clientTaskPriority').value = ['Low', 'Medium', 'High'].includes(task?.priority) ? task.priority : 'Medium';
  const client = data.applications.find(item => item.id === hiredEditingId);
  const scheduleStartDate = task?.dueDate || task?.scheduleStartDate || today();
  const contractEndDate = client?.contractEndDate && client.contractEndDate >= scheduleStartDate ? client.contractEndDate : scheduleStartDate;
  $('#clientTaskScheduleStartDate').value = scheduleStartDate;
  $('#clientTaskScheduleEndDate').value = task?.scheduleEndDate || contractEndDate;
  $('#clientTaskScheduleStartTime').value = task?.scheduleStartTime || '20:00';
  $('#clientTaskScheduleEndTime').value = task?.scheduleEndTime || '05:00';
  $('#clientTaskNotes').value = task?.notes || '';
  $('#clientTaskRepeat').value = 'weekly';
  const savedWeekdays = Array.isArray(task?.repeat?.weekdays)
    ? task.repeat.weekdays.filter(day => day >= 1 && day <= 5)
    : [];
  const selectedWeekdays = savedWeekdays.length ? savedWeekdays : [1, 2, 3, 4, 5];
  $('#clientTaskWeekdays').querySelectorAll('input').forEach(input => {
    input.checked = selectedWeekdays.includes(Number(input.value));
  });
  $('#clientTaskMonthDay').value = String(task?.repeat?.dayOfMonth || Number(task?.dueDate?.slice(-2)) || 1);
  $('#clientTaskTimeEditor').hidden = !task;
  $('#saveClientTaskButton').textContent = task ? 'Save changes' : 'Save task';
  updateClientTaskRepeatFields();
  updateClientTaskSchedule();
  renderClientTaskEntries();
  form.dataset.initialSnapshot = clientTaskFormSnapshot();
}

function showClientTaskDrawer(trigger, focusTarget) {
  const layer = $('#clientTaskDrawerLayer');
  clearTimeout(clientTaskDrawerCloseTimer);
  if (!clientTaskDrawerOpen) clientTaskDrawerReturnFocus = trigger;
  clientTaskDrawerOpen = true;
  clientTaskDrawerClosing = false;
  layer.classList.remove('is-closing');
  layer.hidden = false;
  layer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('client-task-drawer-open');
  requestAnimationFrame(() => {
    if (!clientTaskDrawerOpen) return;
    layer.classList.add('is-open');
    focusTarget?.focus();
  });
}

function showClientTaskForm(task = null) {
  clientTaskDrawerMode = 'form';
  clientTaskActionId = '';
  $('#clientTaskActionsView').hidden = true;
  $('#clientTaskForm').hidden = false;
  fillClientTaskDrawer(task);
}

function openClientTaskDrawer(task = null, trigger = $('#activeClientActionsButton')) {
  if (clientTaskIsEnded() && !task) return;
  showClientTaskForm(task);
  showClientTaskDrawer(trigger, $('#clientTaskTitle'));
}

function openClientTaskActionsDrawer(taskId, trigger) {
  const task = data.clientTasks.find(item => item.id === taskId && item.clientId === hiredEditingId);
  if (!task) return;
  clientTaskDrawerMode = 'actions';
  clientTaskActionId = task.id;
  $('#clientTaskForm').hidden = true;
  const actionView = $('#clientTaskActionsView');
  actionView.hidden = false;
  $('#clientTaskDrawerTitle').textContent = 'Task actions';
  $('#clientTaskDrawerClientName').textContent = task.title || 'Untitled task';
  const duplicateButton = actionView.querySelector('[data-client-task-drawer-action="duplicate"]');
  duplicateButton.disabled = clientTaskIsEnded();
  duplicateButton.title = clientTaskIsEnded() ? 'New tasks are disabled for ended contracts' : '';
  showClientTaskDrawer(trigger, actionView.querySelector('button:not([disabled])'));
}

async function closeClientTaskDrawer() {
  if (!clientTaskDrawerOpen || clientTaskDrawerClosing) return;
  const form = $('#clientTaskForm');
  const isDirty = clientTaskDrawerMode === 'form' && clientTaskFormSnapshot() !== form.dataset.initialSnapshot;
  if (isDirty && !(await appConfirm('Discard your unsaved task changes?', { title: 'Discard task changes', confirmLabel: 'Discard changes', danger: true }))) return;
  clientTaskDrawerOpen = false;
  clientTaskDrawerClosing = true;
  const layer = $('#clientTaskDrawerLayer');
  layer.classList.remove('is-open');
  layer.classList.add('is-closing');
  const finishClose = () => {
    layer.hidden = true;
    layer.setAttribute('aria-hidden', 'true');
    layer.classList.remove('is-closing');
    document.body.classList.remove('client-task-drawer-open');
    clientTaskDrawerClosing = false;
    clientTaskDrawerMode = 'form';
    clientTaskActionId = '';
    clientTaskDrawerReturnFocus?.focus();
    clientTaskDrawerReturnFocus = null;
  };
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finishClose();
  else clientTaskDrawerCloseTimer = setTimeout(finishClose, 270);
}

function clientTaskFormSnapshot() {
  return JSON.stringify({
    title: $('#clientTaskTitle').value,
    category: $('#clientTaskCategory').value,
    priority: $('#clientTaskPriority').value,
    dueDate: $('#clientTaskDueDate').value,
    estimate: $('#clientTaskEstimate').value,
    scheduleStartDate: $('#clientTaskScheduleStartDate').value,
    scheduleEndDate: $('#clientTaskScheduleEndDate').value,
    scheduleStartTime: $('#clientTaskScheduleStartTime').value,
    scheduleEndTime: $('#clientTaskScheduleEndTime').value,
    notes: $('#clientTaskNotes').value,
    manualStart: $('#clientTaskManualStart').value,
    manualEnd: $('#clientTaskManualEnd').value,
    repeat: clientTaskRepeatValue(),
    entries: clientTaskDraftEntries
  });
}

function openClientTaskEditor(taskId) {
  const task = data.clientTasks.find(item => item.id === taskId && item.clientId === hiredEditingId);
  if (!task) return;
  openClientTaskDrawer(task, $('#clientTasksTab'));
}

function renderClientTaskEntries() {
  const entries = clientTaskDraftEntries;
  const current = data.clientTasks.find(task => task.id === clientTaskEditingId);
  const liveTime = current?.timerStartedAt ? Math.max(0, Date.now() - new Date(current.timerStartedAt).getTime()) : 0;
  $('#clientTaskTotalTime').textContent = `${clientTaskFormatDuration(entries.reduce((sum, entry) => sum + clientTaskElapsed(entry), liveTime))} total`;
  $('#clientTaskTimeEntryList').innerHTML = entries.length
    ? entries.slice().reverse().map(entry => `<div class="client-task-time-entry"><span>${escapeHtml(formatDate(dateKey(entry.start)))} · ${escapeHtml(emailTime(entry.start))}–${escapeHtml(emailTime(entry.end))}</span><strong>${escapeHtml(clientTaskFormatDuration(clientTaskElapsed(entry)))}</strong><button type="button" data-client-task-entry-delete="${escapeHtml(entry.id)}" aria-label="Delete time entry" title="Delete time entry"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button></div>`).join('')
    : '<p class="client-task-time-empty">No time entries yet.</p>';
}

function clientTaskOccurrenceKey(seriesId, dueDate) {
  return `${seriesId}:${dueDate}`;
}

function clientTaskNextDueDate(task) {
  if (!task.dueDate) return '';
  const due = new Date(`${task.dueDate}T12:00:00`);
  const recurrence = task.repeat || {};
  if (recurrence.frequency === 'daily') {
    due.setDate(due.getDate() + 1);
    return clientTaskLocalDateKey(due);
  }
  if (recurrence.frequency === 'weekly') {
    const weekdays = Array.isArray(recurrence.weekdays) && recurrence.weekdays.length
      ? recurrence.weekdays
      : [due.getDay()];
    for (let offset = 1; offset <= 7; offset += 1) {
      const candidate = new Date(due);
      candidate.setDate(candidate.getDate() + offset);
      if (weekdays.includes(candidate.getDay())) {
        const candidateDate = clientTaskLocalDateKey(candidate);
        return task.scheduleEndDate && candidateDate > task.scheduleEndDate ? '' : candidateDate;
      }
    }
  }
  if (recurrence.frequency === 'monthly') {
    const firstNextMonth = new Date(due.getFullYear(), due.getMonth() + 1, 1, 12);
    const targetDay = Math.max(1, Math.min(31, Number(recurrence.dayOfMonth) || due.getDate()));
    const lastDay = new Date(firstNextMonth.getFullYear(), firstNextMonth.getMonth() + 1, 0).getDate();
    firstNextMonth.setDate(Math.min(targetDay, lastDay));
    return clientTaskLocalDateKey(firstNextMonth);
  }
  return '';
}

function createNextClientTaskOccurrence(task) {
  const nextDueDate = clientTaskNextDueDate(task);
  if (!nextDueDate) return false;
  const seriesId = task.recurrenceSeriesId || task.id;
  const occurrenceKey = clientTaskOccurrenceKey(seriesId, nextDueDate);
  if (data.clientTasks.some(item => item.recurrenceOccurrenceKey === occurrenceKey)) return false;
  data.clientTasks.push({
    ...task,
    id: uid(),
    dueDate: nextDueDate,
    status: 'todo',
    completedAt: '',
    recurrenceSeriesId: seriesId,
    recurrenceOccurrenceKey: occurrenceKey,
    generatedFromTaskId: task.id,
    timerStartedAt: '',
    timeEntries: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  return true;
}

function stopClientTaskTimer(task) {
  if (!task?.timerStartedAt) return false;
  const start = new Date(task.timerStartedAt);
  const end = new Date();
  const durationMs = Math.max(0, end.getTime() - start.getTime());
  task.timeEntries = clientTaskTimeEntries(task);
  if (durationMs > 0) task.timeEntries.push({ id: uid(), start: start.toISOString(), end: end.toISOString(), durationMs });
  task.timerStartedAt = '';
  task.updatedAt = end.toISOString();
  return true;
}

async function toggleClientTaskTimer(taskId) {
  if (clientTaskIsEnded()) return;
  const task = data.clientTasks.find(item => item.id === taskId && item.clientId === hiredEditingId);
  if (!task || task.status === 'done') return;
  if (task.timerStartedAt) {
    stopClientTaskTimer(task);
  } else {
    data.clientTasks.forEach(item => {
      if (item.timerStartedAt) stopClientTaskTimer(item);
    });
    task.timerStartedAt = new Date().toISOString();
    if (task.status !== 'in-progress') task.status = 'in-progress';
  }
  saveClientTasks();
  renderClientTasks(hiredEditingId);
}

async function toggleClientTaskComplete(taskId, complete) {
  const task = data.clientTasks.find(item => item.id === taskId && item.clientId === hiredEditingId);
  if (!task) return;
  if (complete) {
    stopClientTaskTimer(task);
    task.status = 'done';
    task.completedAt = new Date().toISOString();
    task.updatedAt = task.completedAt;
    if (task.repeat?.frequency && task.repeat.frequency !== 'none') createNextClientTaskOccurrence(task);
  } else {
    task.status = 'todo';
    task.completedAt = '';
    task.updatedAt = new Date().toISOString();
  }
  saveClientTasks();
  renderClientTasks(hiredEditingId);
}

function updateClientTaskTick() {
  if (!$('#clientTasksPanel') || $('#clientTasksPanel').hidden) return;
  const tasks = getClientTasks();
  const now = Date.now();
  tasks.forEach(task => {
    const elapsed = clientTaskTotalMs(task, now);
    const logged = $(`[data-client-task-time="${CSS.escape(task.id)}"]`);
    const clock = $(`[data-client-task-clock="${CSS.escape(task.id)}"]`);
    if (logged) logged.textContent = clientTaskFormatDuration(elapsed);
    if (clock) {
      clock.textContent = task.timerStartedAt ? clientTaskClock(elapsed) : '';
      clock.classList.toggle('is-visible', Boolean(task.timerStartedAt));
    }
  });
  $('#clientTaskMonthHours').textContent = clientTaskFormatDuration(clientTaskMonthlyMs(tasks, new Date(now)));
}

function startClientTaskTick() {
  if (clientTaskTickTimer) return;
  clientTaskTickTimer = setInterval(updateClientTaskTick, 1000);
}

function initClientTaskDrawer() {
  const monthDay = $('#clientTaskMonthDay');
  monthDay.innerHTML = Array.from({ length: 31 }, (_, index) => `<option value="${index + 1}">${index + 1}${[1, 21, 31].includes(index + 1) ? 'st' : [2, 22].includes(index + 1) ? 'nd' : [3, 23].includes(index + 1) ? 'rd' : 'th'}</option>`).join('');
  $('#clientTaskForm').dataset.initialSnapshot = clientTaskFormSnapshot();
  $('#clientTaskDrawerBackdrop').addEventListener('click', closeClientTaskDrawer);
  $('#closeClientTaskDrawer')?.addEventListener('click', closeClientTaskDrawer);
  $('#cancelClientTaskDrawer').addEventListener('click', closeClientTaskDrawer);
  $('#clientTaskRepeat').addEventListener('change', updateClientTaskRepeatFields);
  $('#clientTaskWeekdays').addEventListener('change', () => {
    updateClientTaskRepeatFields();
    updateClientTaskSchedule();
  });
  $('#clientTaskMonthDay').addEventListener('change', updateClientTaskRepeatFields);
  ['#clientTaskScheduleStartDate', '#clientTaskScheduleEndDate'].forEach(selector => {
    $(selector).addEventListener('input', () => {
      syncClientTaskWorkdaysToRange();
      updateClientTaskSchedule();
    });
    $(selector).addEventListener('change', () => {
      syncClientTaskWorkdaysToRange();
      updateClientTaskSchedule();
    });
  });
  ['#clientTaskScheduleStartTime', '#clientTaskScheduleEndTime'].forEach(selector => {
    $(selector).addEventListener('input', updateClientTaskSchedule);
    $(selector).addEventListener('change', updateClientTaskSchedule);
  });
  ['input', 'change'].forEach(type => {
    $('#clientTaskForm').addEventListener(type, () => {
      $('#clientTaskForm').dataset.dirtySnapshot = clientTaskFormSnapshot();
    });
  });
  $('#clientTaskForm').addEventListener('submit', event => {
    event.preventDefault();
    if (clientTaskIsEnded() && !clientTaskEditingId) return;
    updateClientTaskSchedule();
    const title = $('#clientTaskTitle').value.trim();
    const repeat = clientTaskRepeatValue();
    const dueField = $('#clientTaskDueDate');
    const scheduleStartDate = $('#clientTaskScheduleStartDate').value;
    const scheduleEndDate = $('#clientTaskScheduleEndDate').value;
    const scheduleEndField = $('#clientTaskScheduleEndDate');
    const selectedWeekdays = clientTaskSelectedWeekdays();
    const scheduleHasWorkday = clientTaskWorkdayCount(scheduleStartDate, scheduleEndDate, selectedWeekdays) > 0;
    scheduleEndField.setCustomValidity(!clientTaskOneOffMode && scheduleStartDate && scheduleEndDate && scheduleEndDate < scheduleStartDate
      ? 'Choose an end date on or after the start date.'
      : !clientTaskOneOffMode && scheduleStartDate && scheduleEndDate && selectedWeekdays.length && !scheduleHasWorkday
        ? 'Choose a date range containing at least one Monday–Friday workday.'
        : '');
    if (!$('#clientTaskForm').reportValidity()) return;
    if (repeat.frequency !== 'none' && !dueField.value) {
      dueField.setCustomValidity('A due date is required for recurring tasks.');
      dueField.reportValidity();
      dueField.addEventListener('input', () => dueField.setCustomValidity(''), { once: true });
      return;
    }
    if (repeat.frequency === 'weekly' && !repeat.weekdays.length) {
      $('#clientTaskWeekdays').querySelector('input').focus();
      return;
    }
    const existing = data.clientTasks.find(task => task.id === clientTaskEditingId && task.clientId === hiredEditingId);
    const now = new Date().toISOString();
    const task = {
      ...existing,
      id: existing?.id || uid(),
      clientId: hiredEditingId,
      title,
      category: $('#clientTaskCategory').value,
      priority: $('#clientTaskPriority').value,
      dueDate: dueField.value,
      estimateMinutes: $('#clientTaskEstimate').value ? Number($('#clientTaskEstimate').value) : '',
      scheduleStartDate: clientTaskOneOffMode ? '' : scheduleStartDate,
      scheduleEndDate: clientTaskOneOffMode ? '' : scheduleEndDate,
      scheduleStartTime: clientTaskOneOffMode ? '' : $('#clientTaskScheduleStartTime').value,
      scheduleEndTime: clientTaskOneOffMode ? '' : $('#clientTaskScheduleEndTime').value,
      scheduledMinutesPerDay: Number($('#clientTaskEstimate').value) || 0,
      scheduleTotalMinutes: (Number($('#clientTaskEstimate').value) || 0) * clientTaskWorkdayCount(scheduleStartDate, scheduleEndDate, repeat.weekdays),
      notes: $('#clientTaskNotes').value.trim(),
      repeat,
      status: existing?.status || 'todo',
      completedAt: existing?.completedAt || '',
      timeEntries: clientTaskDraftEntries,
      timerStartedAt: existing?.timerStartedAt || '',
      recurrenceSeriesId: existing?.recurrenceSeriesId || '',
      recurrenceOccurrenceKey: existing?.recurrenceOccurrenceKey || '',
      generatedFromTaskId: existing?.generatedFromTaskId || '',
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    if (existing) {
      Object.assign(existing, task);
    } else {
      data.clientTasks.push(task);
    }
    if (task.repeat.frequency !== 'none' && !task.recurrenceSeriesId) task.recurrenceSeriesId = task.id;
    $('#clientTaskForm').dataset.initialSnapshot = clientTaskFormSnapshot();
    saveClientTasks();
    clientTaskDrawerOpen = false;
    clientTaskDrawerClosing = true;
    const layer = $('#clientTaskDrawerLayer');
    layer.classList.remove('is-open');
    layer.classList.add('is-closing');
    const finish = () => {
      layer.hidden = true;
      layer.setAttribute('aria-hidden', 'true');
      layer.classList.remove('is-closing');
      document.body.classList.remove('client-task-drawer-open');
      clientTaskDrawerClosing = false;
      clientTaskDrawerMode = 'form';
      clientTaskActionId = '';
      clientTaskDrawerReturnFocus?.focus();
      clientTaskDrawerReturnFocus = null;
      renderClientTasks(hiredEditingId);
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else clientTaskDrawerCloseTimer = setTimeout(finish, 270);
  });
  $('#addClientTaskTimeEntry').addEventListener('click', () => {
    const startValue = $('#clientTaskManualStart').value;
    const endValue = $('#clientTaskManualEnd').value;
    const start = new Date(startValue);
    const end = new Date(endValue);
    if (!startValue || !endValue || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      $('#clientTaskManualEnd').setCustomValidity('Choose an end time after the start time.');
      $('#clientTaskManualEnd').reportValidity();
      $('#clientTaskManualEnd').addEventListener('input', event => event.currentTarget.setCustomValidity(''), { once: true });
      return;
    }
    clientTaskDraftEntries.push({ id: uid(), start: start.toISOString(), end: end.toISOString(), durationMs: end.getTime() - start.getTime() });
    $('#clientTaskManualStart').value = '';
    $('#clientTaskManualEnd').value = '';
    renderClientTaskEntries();
    $('#clientTaskForm').dataset.dirtySnapshot = clientTaskFormSnapshot();
  });

  document.addEventListener('keydown', event => {
    if (!clientTaskDrawerOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeClientTaskDrawer();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = $$('#clientTaskDrawer button:not([disabled]), #clientTaskDrawer input:not([disabled]), #clientTaskDrawer select:not([disabled]), #clientTaskDrawer textarea:not([disabled])')
      .filter(element => !element.closest('[hidden]') && element.getClientRects().length);
    if (!focusable.length) {
      event.preventDefault();
      $('#clientTaskDrawer').focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !$('#clientTaskDrawer').contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !$('#clientTaskDrawer').contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }, true);

  document.addEventListener('change', event => {
    const checkbox = event.target.closest('[data-client-task-complete]');
    if (checkbox) toggleClientTaskComplete(checkbox.dataset.clientTaskComplete, checkbox.checked);
  });

  document.addEventListener('input', event => {
    if (event.target.matches('#clientTaskSearch')) renderClientTasks(hiredEditingId);
  });
  ['#clientTaskStatusFilter', '#clientTaskPriorityFilter'].forEach(selector => {
    $(selector).addEventListener('change', () => renderClientTasks(hiredEditingId));
  });

  document.addEventListener('click', async event => {
    const menuButton = event.target.closest('[data-client-task-menu]');
    if (menuButton) {
      openClientTaskActionsDrawer(menuButton.dataset.clientTaskMenu, menuButton);
      return;
    }
    const drawerAction = event.target.closest('[data-client-task-drawer-action]');
    if (drawerAction) {
      if (drawerAction.dataset.clientTaskDrawerAction === 'cancel') {
        await closeClientTaskDrawer();
        return;
      }
      const task = data.clientTasks.find(item => item.id === clientTaskActionId && item.clientId === hiredEditingId);
      if (!task) return;
      if (drawerAction.dataset.clientTaskDrawerAction === 'edit') {
        showClientTaskForm(task);
        $('#clientTaskTitle').focus();
        return;
      }
      if (drawerAction.dataset.clientTaskDrawerAction === 'duplicate') {
        if (clientTaskIsEnded()) return;
        const duplicate = { ...task, id: uid(), recurrenceSeriesId: '', recurrenceOccurrenceKey: '', generatedFromTaskId: '', status: 'todo', completedAt: '', timerStartedAt: '', timeEntries: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        data.clientTasks.push(duplicate);
        saveClientTasks();
        renderClientTasks(hiredEditingId);
        showClientTaskForm(duplicate);
        $('#clientTaskTitle').focus();
        return;
      }
      if (drawerAction.dataset.clientTaskDrawerAction === 'delete') {
        if (!(await appConfirm(`Delete “${task.title}”?`, { title: 'Delete client task', confirmLabel: 'Delete task', danger: true }))) return;
        stopClientTaskTimer(task);
        data.clientTasks = data.clientTasks.filter(item => item.id !== task.id);
        saveClientTasks();
        renderClientTasks(hiredEditingId);
        await closeClientTaskDrawer();
        return;
      }
    }
    const editButton = event.target.closest('[data-client-task-edit]');
    if (editButton) {
      openClientTaskEditor(editButton.dataset.clientTaskEdit);
      return;
    }
    const timerButton = event.target.closest('[data-client-task-timer]');
    if (timerButton) {
      await toggleClientTaskTimer(timerButton.dataset.clientTaskTimer);
      return;
    }
    const deleteEntryButton = event.target.closest('[data-client-task-entry-delete]');
    if (deleteEntryButton) {
      clientTaskDraftEntries = clientTaskDraftEntries.filter(entry => entry.id !== deleteEntryButton.dataset.clientTaskEntryDelete);
      renderClientTaskEntries();
      $('#clientTaskForm').dataset.dirtySnapshot = clientTaskFormSnapshot();
      return;
    }
  });
}

initClientTaskDrawer();
startClientTaskTick();

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  const dialog = document.activeElement.closest?.('dialog[open]')
    || [...document.querySelectorAll('dialog[open]')].pop();
  if (!dialog) return;
  event.preventDefault();
  dialog.close();
});

})();
