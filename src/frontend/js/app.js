(() => {
  'use strict';

  const STORAGE_KEY = 'client-compass-data-v1'; // Legacy key name retained only for migration detection; app data is no longer stored in localStorage.
  const ACTIVE_VIEW_KEY = 'jeff-va-active-view-v1';
  const APPLICATION_DRAFT_KEY = 'jeff-va-new-application-draft-v1';
  const SUPABASE_BUCKET = 'client-documents';
  const STORAGE_PLAN_KEY = 'jeff-va-storage-plan-v1';
  const CUSTOM_STORAGE_QUOTA_KEY = 'jeff-va-custom-storage-quota-gb-v1';
  const AUTH_PROVIDER_SESSION_KEY = 'jeff-va-auth-provider-v1';
  const emptyData = () => ({ applications: [], toApply: [], dailyTasks: [], clientTasks: [], emails: [], deletedGmailIds: [], alerts: [], onboardingSubmissionIds: [], emailTemplates: [], personalDocuments: [], invoices: [], scripts: [], workLinks: [], accountSignInHistory: [] });
  let supabaseClient = null;
  let currentUser = null;
  let activeAuthProvider = null;
  let appStateChannel = null;
  let gmailSyncTimer = null;
  let gmailSyncInFlight = false;
  let applyReminderTimer = null;
  let initializingUserId = null;
  let persistChain = Promise.resolve();
  let persistWritePending = false;
  const MAX_LOCAL_WRITE_STAMPS = 20;
  const lastLocalWriteStamps = new Set();
  let dataReady = false;
  let supabaseDataLoaded = false;
  let projectStorageUsedBytes = null;
  let projectStorageFileCount = 0;
  let passwordRecoveryMode = false;
  const STATUS_COLORS = {
    Ongoing: '#1d8a89', Applied: '#8a9b8e', 'To Proceed': '#2f6f8f', Interview: '#c28a52', 'Active client': '#5a956a', 'Not selected': '#c36e73'
  };
  const STATUS_CLASS = { Ongoing: 'ongoing', Applied: 'applied', 'To Proceed': 'to-proceed', 'To Proceeding': 'to-proceed', Interview: 'interview', 'Active client': 'active-client', 'Not selected': 'not-selected' };
  const STATUS_LABELS = { 'Not selected': 'Rejected', 'To Proceeding': 'To Proceed' };
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  let appConfirmResolve = null;
  function appConfirm(message, { title = 'Confirm action', confirmLabel = 'Continue', danger = false } = {}) {
    return new Promise(resolve => {
      const modal = $('#appConfirmModal');
      if (modal.open) {
        resolve(false);
        return;
      }
      $('#appConfirmTitle').textContent = title;
      $('#appConfirmMessage').textContent = message;
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

  function showActionResult({ title = 'Action complete', message = '', status = 'success', label = '', actionLabel = '', onAction = null, details = [] } = {}) {
    const modal = $('#emailActionResultModal');
    if (!modal) {
      toast(message);
      return;
    }
    if (modal.open) {
      actionResultQueue.push({ title, message, status, label, actionLabel, onAction, details });
      return;
    }
    const isError = status === 'error';
    const isInfo = status === 'info';
    modal.dataset.status = isError ? 'error' : isInfo ? 'info' : 'success';
    $('#emailActionResultEyebrow').textContent = label || (isError ? 'ACTION FAILED' : isInfo ? 'NOTICE' : 'SUCCESS');
    $('#emailActionResultTitle').textContent = title;
    $('#emailActionResultMessage').textContent = message;
    const detailList = $('#emailActionResultDetails');
    detailList.replaceChildren(...details.map(detail => {
      const item = document.createElement('article');
      item.className = 'client-email-alert-item';
      item.setAttribute('role', 'listitem');

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
        sender.textContent = `From ${detail.from || 'Unknown sender'}`;
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
    const gmailNeedsAttention = /failed|expired|not set up/i.test(gmailSyncMessage);
    const gmailStatus = !navigator.onLine
      ? 'Offline'
      : !gmailConfigured()
        ? 'Not configured'
        : !window.google?.accounts?.oauth2
          ? 'Unavailable'
          : gmailNeedsAttention
            ? 'Needs attention'
            : gmailAccessToken
              ? 'Authorized this session'
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
  let data = emptyData();
  let clientTimeZones = new Map();
  let activeView = 'dashboard';
  let activeDashboardTab = 'client';
  let emailViewFilter = 'client';
  let emailSelectionMode = false;
  let applicationDateSort = '0';
  let hiredDateSort = 'newest';
  let emailDateSort = localStorage.getItem(EMAIL_WEEK_FILTER_KEY) || 'all';
  let applicationDateFilter = today();
  let hiredDateFilter = '';
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

  function requireSupabase() {
    if (!supabaseConfigured()) throw new Error('Account sign-in is unavailable. Check the app configuration.');
    if (!supabaseClient) {
      const authStorage = {
        getItem(key) {
          try {
            const storedValue = window.localStorage.getItem(key);
            if (storedValue !== null) return storedValue;
          } catch {}
          const sessionValue = window.sessionStorage.getItem(key);
          if (sessionValue !== null) {
            try {
              window.localStorage.setItem(key, sessionValue);
              window.sessionStorage.removeItem(key);
            } catch {}
          }
          return sessionValue;
        },
        setItem(key, value) {
          try {
            window.localStorage.setItem(key, value);
            window.sessionStorage.removeItem(key);
          } catch {
            window.sessionStorage.setItem(key, value);
          }
        },
        removeItem(key) {
          try { window.localStorage.removeItem(key); } catch {}
          window.sessionStorage.removeItem(key);
        }
      };
      supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          storage: authStorage,
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
    return {
      applications: Array.isArray(saved.applications) ? saved.applications : [],
      toApply: Array.isArray(saved.toApply) ? saved.toApply : [],
      dailyTasks: Array.isArray(saved.dailyTasks) ? saved.dailyTasks : [],
      clientTasks: Array.isArray(saved.clientTasks) ? saved.clientTasks : [],
      emails: dedupeEmails(Array.isArray(saved.emails) ? saved.emails : []).filter(item => !(item.source === 'gmail' && deletedGmailIdSet.has(item.gmailId))),
      deletedGmailIds,
      accountSignInHistory: Array.isArray(saved.accountSignInHistory) ? saved.accountSignInHistory : [],
      alerts: Array.isArray(saved.alerts) ? saved.alerts : [],
      onboardingSubmissionIds: Array.isArray(saved.onboardingSubmissionIds) ? saved.onboardingSubmissionIds : [],
      emailTemplates: Array.isArray(saved.emailTemplates) ? saved.emailTemplates : [],
      personalDocuments: Array.isArray(saved.personalDocuments) ? saved.personalDocuments : [],
      invoices: Array.isArray(saved.invoices) ? saved.invoices : [],
      scripts: Array.isArray(saved.scripts) ? saved.scripts : [],
      workLinks: Array.isArray(saved.workLinks) ? saved.workLinks : []
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

  function persist() {
    if (!currentUser || !supabaseClient || !dataReady || !supabaseDataLoaded) return Promise.resolve();
    const snapshot = JSON.parse(JSON.stringify(data));
    const userId = currentUser.id;
    const client = supabaseClient;
    const updatedAt = new Date().toISOString();
    // perf: remember our own writes so repeat realtime echoes do not trigger a reload loop.
    rememberLocalWriteStamp(updatedAt);
    persistWritePending = true;
    persistChain = persistChain.then(async () => {
      if (!client || !userId) return;
      const { error } = await client.from('app_state').upsert({
        user_id: userId,
        data: snapshot,
        updated_at: updatedAt
      }, { onConflict: 'user_id' });
      if (error) {
        console.error('Supabase save failed:', error);
        showActionResult({ title: 'Cloud save failed', message: 'Your change could not be saved to your account. Check your connection and try again.', status: 'error' });
        throw error;
      }
    }).catch(() => {}).finally(() => {
      persistWritePending = false;
    });
    // Keep the local Documents Excel copy current too. The function debounces
    // rapid edits, so this does not create a file for every keystroke.
    queueDocumentsBackup({ immediate: true });
    return persistChain;
  }

  async function initializeSupabaseForUser(user, { showSuccess = true, recordSignIn = false, showOverview = false } = {}) {
    if (!user || initializingUserId === user.id) return;
    initializingUserId = user.id;
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
      data = await loadDataFromSupabase();
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
      initializingUserId = null;
      renderAll();
      renderAccountPage();
      return;
    }

    supabaseDataLoaded = true;
    dataReady = true;
    let startupStage = 'preparing workspace data';
    try {
      if (recordSignIn) recordAccountSignIn(user, activeAuthProvider);
      const autoRejectedApplications = processStaleApplications();
      startupStage = 'rendering the workspace';
      renderAll();
      renderAccountPage();
      startupStage = 'processing workspace reminders';
      await processDueFollowUps();
      processDueApplyReminders();
      processDueInterviews();
      processDueDocumentEmailReminders();
      processContractEndedAlerts();
      startupStage = 'rendering updated workspace data';
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
      else if (showSuccess) showActionResult({ title: 'Signed in successfully', message: 'Your workspace is ready.' });
      if (localStorage.getItem(`${APPLICATION_DRAFT_KEY}:${user.id}`)) openClientModal();
    } catch (error) {
      console.error(`Workspace startup failed while ${startupStage}; saved data was loaded:`, error);
      showActionResult({
        title: 'Workspace startup incomplete',
        message: `Your saved data was loaded, but ${startupStage} failed${error?.message ? `: ${error.message}` : '.'}`,
        status: 'error'
      });
    } finally {
      initializingUserId = null;
    }
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
    const callbackParams = new URLSearchParams(`${window.location.search}&${window.location.hash.slice(1)}`);
    const isPasswordRecovery = callbackParams.get('type') === 'recovery';
    const isAuthenticationCallback = callbackParams.has('code')
      || (callbackParams.has('access_token') && callbackParams.has('refresh_token'));
    const callbackKeys = ['error', 'error_description', 'access_token', 'refresh_token', 'code', 'type'];
    if (callbackKeys.some(key => callbackParams.has(key))) {
      window.history.replaceState({}, document.title, `${window.location.pathname}#dashboard`);
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
      client.auth.onAuthStateChange((event, session) => {
        if (event !== 'SIGNED_IN' || !session?.user || currentUser) return;
        activeAuthProvider = resolveAuthProvider(session);
        if (session.provider_token) {
          gmailAccessToken = session.provider_token;
          sessionStorage.setItem(GMAIL_TOKEN_SESSION_KEY, gmailAccessToken);
          sessionStorage.setItem(GMAIL_CONNECTED_KEY, '1');
          sessionStorage.removeItem(GMAIL_RECONNECT_REQUIRED_KEY);
          gmailReconnectRequired = false;
        }
        const isFreshSignIn = event === 'SIGNED_IN' && !isPasswordRecovery;
        initializeSupabaseForUser(session.user, {
          showSuccess: isAuthenticationCallback && !isPasswordRecovery || activeAuthProvider === 'email',
          recordSignIn: isFreshSignIn,
          showOverview: false
        });
      });
      const accessToken = callbackParams.get('access_token');
      const refreshToken = callbackParams.get('refresh_token');
      const callbackCode = callbackParams.get('code');
      let { data: sessionData, error } = await client.auth.getSession();
      if (error) throw error;
      if (!sessionData.session && accessToken && refreshToken) {
        const callbackResult = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (callbackResult.error) throw callbackResult.error;
        ({ data: sessionData, error } = await client.auth.getSession());
        if (error) throw error;
      }
      if (!sessionData.session && callbackCode) {
        const exchangeResult = await client.auth.exchangeCodeForSession(callbackCode);
        if (exchangeResult.error) throw exchangeResult.error;
        ({ data: sessionData, error } = await client.auth.getSession());
        if (error) throw error;
      }
      if (sessionData.session?.provider_token) {
        gmailAccessToken = sessionData.session.provider_token;
        sessionStorage.setItem(GMAIL_TOKEN_SESSION_KEY, gmailAccessToken);
        sessionStorage.setItem(GMAIL_CONNECTED_KEY, '1');
        sessionStorage.removeItem(GMAIL_RECONNECT_REQUIRED_KEY);
        gmailReconnectRequired = false;
        startGmailSyncTimer();
      }
      if (sessionData.session?.user) {
        activeAuthProvider = isPasswordRecovery ? 'email' : resolveAuthProvider(sessionData.session);
        await initializeSupabaseForUser(sessionData.session.user, {
          showSuccess: isAuthenticationCallback && !isPasswordRecovery,
          recordSignIn: isAuthenticationCallback && !isPasswordRecovery,
          showOverview: isAuthenticationCallback && !isPasswordRecovery
        });
        if (isPasswordRecovery) openPasswordPage({ recovery: true });
      }
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
    if (/^\d{4}-\d{2}-\d{2}/.test(String(value))) return String(value).slice(0, 10);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }

  function plural(number, word) { return `${number} ${word}${number === 1 ? '' : 's'}`; }

  function receivedEmails() {
    const deletedGmailIds = new Set(data.deletedGmailIds || []);
    return data.emails.filter(item => item.direction !== 'sent'
      && item.source !== 'sent'
      && !(item.source === 'gmail' && deletedGmailIds.has(item.gmailId)));
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
    return sortByDate(pipelineApplications(), item => item.appliedDate || applicationAddedDate(item));
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
  let applicationMatchIndex = [];
  let applicationMatchIndexSignature = '';
  let activeClientDetailsModalEdit = false;

  function applicationMatchSignature(applications = data.applications || []) {
    return (applications || []).map(application => [
      application.id || '',
      application.updatedAt || '',
      application.email || '',
      application.contact || '',
      application.clientName || '',
      application.role || ''
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
      return { application, email, contact, clientName, role };
    });
    applicationMatchIndexSignature = signature;
    return applicationMatchIndex;
  }

  function invalidateApplicationMatchCaches(applications = data.applications || []) {
    const nextSignature = applicationMatchSignature(applications);
    if (nextSignature !== applicationMatchIndexSignature) {
      applicationEmailMatchesCache = new WeakMap();
      applicationEmailSummaryCache = null;
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

  function matchApplicationsForEmail(emailItem) {
    const cachedMatches = applicationEmailMatchesCache.get(emailItem);
    if (cachedMatches) return cachedMatches;
    const fromAddress = extractEmailAddress(emailItem.from);
    const senderName = extractSenderName(emailItem.from);
    const contentLower = `${emailItem.subject || ''} ${emailItem.body || ''}`.toLowerCase();
    const matches = [];
    for (const item of buildApplicationMatchIndex(data.applications)) {
      const { application, email, contact, clientName, role } = item;
      const roleReferenced = role.length >= 3 && contentLower.includes(role);
      const companyReferenced = clientName.length >= 3 && containsWholeWord(contentLower, clientName);
      if (email && email === fromAddress) {
        matches.push(application);
        continue;
      }
      if (!roleReferenced && !companyReferenced) continue;
      if ([contact, clientName].filter(name => name.length >= 3).some(name => containsWholeWord(senderName, name))) {
        matches.push(application);
      }
    }
    applicationEmailMatchesCache.set(emailItem, matches);
    return matches;
  }

  function applicationsRelatedToEmail(emailItem) {
    if (emailItem.direction !== 'sent' && emailItem.source !== 'sent') return matchApplicationsForEmail(emailItem);
    const linkedApplication = data.applications.find(application => application.id === emailItem.applicationId);
    if (linkedApplication) return [linkedApplication];
    const recipient = extractEmailAddress(emailItem.to);
    return isEmailAddress(recipient)
      ? data.applications.filter(application => (application.email || '').trim().toLowerCase() === recipient)
      : [];
  }

  function buildApplicationEmailSummary() {
    const summary = new Map((data.applications || []).map(application => [application.id, []]));
    for (const emailItem of data.emails || []) {
      for (const application of matchApplicationsForEmail(emailItem)) {
        summary.get(application.id)?.push(emailItem);
      }
    }
    return summary;
  }

  function matchingEmailsForApplication(application) {
    if (!applicationEmailSummaryCache) applicationEmailSummaryCache = buildApplicationEmailSummary();
    return applicationEmailSummaryCache.get(application.id) || [];
  }

  function openApplicationEmailsModal(applicationId) {
    const application = data.applications.find(item => item.id === applicationId);
    if (!application) return;
    const emails = matchingEmailsForApplication(application)
      .filter(emailItem => emailItem.direction !== 'sent' && emailItem.source !== 'sent')
      .sort((first, second) => new Date(second.date) - new Date(first.date));
    if (!emails.length) return;
    $('#applicationEmailsTitle').textContent = `${application.clientName} · Emails`;
    $('#applicationEmailsSummary').textContent = plural(emails.length, 'matching email');
    $('#applicationEmailsList').innerHTML = emails.map(emailItem => `
      <article class="application-email-message">
        <header class="application-email-message-heading">
          <div><h3>${escapeHtml(emailItem.subject || '(No subject)')}</h3><p>${escapeHtml(emailItem.from || 'Unknown sender')}</p></div>
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
    const source = `${emailItem.subject || ''} ${emailItem.body || ''}`;
    return /\b(interview|meeting|video call|phone call|screening)\b/i.test(source);
  }

  function matchBadge(app) {
    const matches = matchingEmailsForApplication(app)
      .filter(emailItem => emailItem.direction !== 'sent' && emailItem.source !== 'sent');
    if (!matches.length) return '';
    return ` <button class="match-badge" type="button" data-application-emails="${escapeHtml(app.id)}" aria-label="View ${plural(matches.length, 'matching email')} for ${escapeHtml(app.clientName)}" title="View matching application emails">${matches.length}</button>`;
  }

  function renderDashboard() {
    const applications = data.applications;
    const pipelineCount = pipelineApplications().length;
    const active = hiredClients().filter(isActiveContract).length;
    const appliedToday = pipelineApplications().filter(item => dateKey(item.appliedDate) === today()).length;
    const followUp = applications.filter(item => item.followUpDate && item.followUpDate <= today() && item.status !== 'Active client' && item.status !== 'Not selected').length;
    $('#totalApplications').textContent = pipelineCount;
    $('#activeClients').textContent = active;
    $('#conversationClients').textContent = appliedToday;
    $('#followUpClients').textContent = followUp;
    $('#applicationsDetail').textContent = pipelineCount ? `${plural(pipelineCount, 'application')} in your tracker` : 'No applications tracked yet';
    $('#activeDetail').textContent = active ? `${plural(active, 'client')} currently in progress` : 'Clients currently in progress';
    $('#conversationDetail').textContent = appliedToday ? `${plural(appliedToday, 'application')} submitted today` : 'Applications submitted today';
    $('#followUpDetail').textContent = followUp ? `${plural(followUp, 'application')} due for a follow-up` : 'Applications to revisit soon';
    renderPlatformBreakdown(applications);
    renderStatusChart(applications);
    renderInterviewCalendar();
    renderRecentApplications();
  }

  function renderClientDashboard() {
    const clients = hiredClients();
    const activeClients = clients.filter(isActiveContract).length;
    const endedContracts = clients.filter(isContractEnded).length;
    $('#clientDashboardCount').textContent = activeClients;
    $('#clientDashboardDetail').textContent = activeClients
      ? `${plural(activeClients, 'client')} with an active contract`
      : 'No active contracts';
    $('#clientDashboardEndedCount').textContent = endedContracts;
    $('#clientDashboardEndedDetail').textContent = endedContracts
      ? `${plural(endedContracts, 'contract')} ended`
      : 'No ended contracts';
  }

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
        <td>${escapeHtml(item.platform)}</td><td>${statusPill(item.status)}${matchBadge(item)}</td><td>${formatDate(item.appliedDate)}</td>
        <td><button class="icon-button list-icon-button" type="button" data-edit-id="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.clientName)}" title="Edit application">✎</button></td>
      </tr>
    `).join('');
  }

  function applicationWeekOptions() {
    const currentRange = weekRange();
    const applicationDates = pipelineApplications().map(applicationAddedDate).map(dateKey).filter(Boolean);
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
        : item.status !== 'Not selected';
      const alwaysVisibleStatus = isToProceedStatus(item) || item.status === 'Interview' || item.status === 'Ongoing';
      const dateMatches = alwaysVisibleStatus || !dateFilter || dateKey(item.appliedDate) === dateFilter;
      const weekMatches = alwaysVisibleStatus || !applicationDateSort || applicationDateSort === 'all' || isInWeeklyRange(applicationAddedDate(item), weekRangeFilter);
      return (!query || text.includes(query)) && statusMatches && (!platform || item.platform === platform) && dateMatches && weekMatches;
    });
    $('#applicationListLabel').textContent = `${plural(filtered.length, 'application')}${filtered.length !== pipeline.length ? ` of ${pipeline.length}` : ''}`;
    const platformCounts = new Map();
    filtered.forEach(item => {
      const name = String(item.platform || 'Unspecified').trim() || 'Unspecified';
      platformCounts.set(name, (platformCounts.get(name) || 0) + 1);
    });
    $('#applicationPlatformCounts').innerHTML = [...platformCounts]
      .sort(([first], [second]) => first.localeCompare(second, undefined, { sensitivity: 'base' }))
      .map(([name, count]) => `<span class="application-platform-count">${escapeHtml(name)} - ${count}</span>`)
      .join('');
    const target = $('#applicationList');
    if (!filtered.length) {
      const isFiltered = pipeline.length > 0;
      target.innerHTML = `<div class="application-empty"><h3>${isFiltered ? 'No matching applications' : 'Start your client pipeline'}</h3><p>${isFiltered ? 'Try a different search or filter.' : 'Track each application, where you applied, and the next step all in one private workspace.'}</p>${isFiltered ? '' : '<button class="button button-primary" type="button" data-open-add>Add your first client</button>'}</div>`;
      return;
    }
    const renderRows = items => items.map(item => {
      const currency = item.salaryCurrency || 'USD';
      const salaryText = item.salaryType === 'monthly' && Number(item.salaryAmount) > 0
        ? `${formatSalaryAmount(item.salaryAmount, currency, 'monthly')} `
        : item.salaryType === 'hourly' && Number(item.salaryAmount) > 0
          ? Number(item.hoursPerWeek) > 0
            ? `${formatSalaryAmount(item.salaryAmount, currency, 'hourly', item.hoursPerWeek)} · ${formatSalaryAmount(item.salaryAmount, currency, 'hourly')}`
            : `${formatSalaryAmount(item.salaryAmount, currency, 'hourly')}`
          : 'Salary not set';
      return `
      <article class="application-row${isInterviewToday(item) ? ' interview-today' : ''}" data-view-details="${escapeHtml(item.id)}" tabindex="0" role="button" aria-label="View details for ${escapeHtml(item.clientName)}">
        <div><h3 class="client-card-title">${escapeHtml(item.clientName)}</h3><p class="client-card-subtitle">${escapeHtml(item.role || item.contact || item.nextStep || item.notes || 'No extra details')}</p>${item.website ? `<a class="client-card-website" href="${escapeHtml(normalizeUrl(item.website))}" target="_blank" rel="noopener">${escapeHtml(item.website)}</a>` : ''}${item.interviewLink ? `<a class="interview-link-button" href="${escapeHtml(normalizeUrl(item.interviewLink))}" target="_blank" rel="noopener"><span aria-hidden="true">↗</span> Join interview</a>` : ''}</div>
        <div class="application-meta">${escapeHtml(item.platform)}<small>${escapeHtml(item.employmentType || 'Employment type not set')}</small><small class="application-salary">${escapeHtml(salaryText)}</small></div>
        <div>${statusPill(item.status)}${item.interviewPriority ? '<span class="interview-priority-badge">INTERVIEW</span>' : ''}${matchBadge(item)}</div>
        <div class="application-meta">${emailDate(item.appliedDate)}<small>Applied${item.interviewDate ? ` · Interview ${formatDate(item.interviewDate)}` : ''}${item.followUpDate ? ` · Follow up ${formatDate(item.followUpDate)}` : ''}</small><small>Added ${emailDate(applicationAddedDate(item))}</small></div>
        <button class="icon-button list-icon-button update-row-button" type="button" data-edit-id="${escapeHtml(item.id)}" aria-label="Update ${escapeHtml(item.clientName)}" title="Update application">Update</button>
      </article>
    `; }).join('');
    const newestFirst = sortByDate(filtered, applicationAddedDate);
    const ongoing = newestFirst.filter(item => item.status === 'Ongoing');
    const interviews = newestFirst.filter(item => item.status === 'Interview');
    const toProceed = newestFirst.filter(item => isToProceedStatus(item));
    const applications = newestFirst.filter(item => item.status !== 'Ongoing' && item.status !== 'Interview' && !isToProceedStatus(item));
    target.innerHTML = [
      ongoing.length ? `<section class="application-group application-group-ongoing"><div class="application-group-heading"><h3><i class="fa-regular fa-clock" aria-hidden="true"></i> Ongoing</h3><span>${plural(ongoing.length, 'application')}</span></div>${renderRows(ongoing)}</section>` : '',
      interviews.length ? `<section class="application-group"><div class="application-group-heading"><h3><i class="fa-regular fa-calendar-check" aria-hidden="true"></i> Interviews</h3><span>${plural(interviews.length, 'interview')}</span></div>${renderRows(interviews)}</section>` : '',
      toProceed.length ? `<section class="application-group application-group-to-proceed"><div class="application-group-heading"><h3><i class="fa-solid fa-arrow-right" aria-hidden="true"></i> To proceed</h3><span>${plural(toProceed.length, 'application')}</span></div>${renderRows(toProceed)}</section>` : '',
      applications.length ? `<section class="application-group"><div class="application-group-heading"><h3><i class="fa-regular fa-paper-plane" aria-hidden="true"></i> Applications</h3><span>${plural(applications.length, 'application')}</span></div>${renderRows(applications)}</section>` : ''
    ].join('');
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
    target.innerHTML = `<div class="to-apply-list-head"><span>Title &amp; link</span><span>Apply by</span><span>Actions</span></div>${reminders.map(item => {
      const overdue = item.dueDate < currentDate;
      const dueToday = item.dueDate === currentDate;
      return `<article class="to-apply-row${overdue ? ' overdue' : dueToday ? ' due-today' : ''}">
        <div class="to-apply-title"><strong>${escapeHtml(item.title)}</strong><a href="${escapeHtml(normalizeUrl(item.link))}" target="_blank" rel="noopener">${escapeHtml(item.link)}</a></div>
        <time class="to-apply-date"><span>${overdue ? 'Missed' : dueToday ? 'Apply today' : 'Apply by'}</span>${escapeHtml(formatDate(item.dueDate))}</time>
        <div class="to-apply-actions"><div class="to-apply-row-menu"><button class="button button-secondary to-apply-actions-trigger" type="button" data-to-apply-menu aria-haspopup="true" aria-expanded="false" aria-label="Actions for ${escapeHtml(item.title)}">Actions</button><div class="to-apply-menu-panel hidden" role="menu"><button type="button" role="menuitem" data-edit-to-apply="${escapeHtml(item.id)}">Edit</button><button type="button" role="menuitem" data-delete-to-apply="${escapeHtml(item.id)}">Delete</button></div></div></div>
      </article>`;
    }).join('')}`;
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
      data.alerts = data.alerts.slice(0, 30);
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
    $('#deleteToApplyButton').hidden = !id;
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
    const query = $('#emailSearch').value.trim().toLowerCase();
    const weekOffset = Number(emailDateSort);
    const weekRangeFilter = emailDateSort === 'all' ? null : weekRange(weekOffset);
    $('#emailWeekDate').textContent = emailDateSort === 'all' ? 'All weeks' : weeklyRangeLabel(weekRangeFilter).replace(' – ', ' to ');
    $('#emailDateSort').innerHTML = emailWeekOptions();
    $('#emailDateSort').value = emailDateSort;
    const received = receivedEmails();
    const sent = data.emails.filter(item => (item.direction === 'sent' || item.source === 'sent')
      && applicationsRelatedToEmail(item).length > 0);
    $('#emailReceivedCount').textContent = received.length;
    $('#emailSentCount').textContent = sent.length;
    const emails = data.emails
      .filter(item => [item.from, item.to, item.subject, item.body, item.date].join(' ').toLowerCase().includes(query))
      .filter(item => !emailDateFilter || dateKey(item.date) === emailDateFilter)
      .filter(item => emailDateSort === 'all' || isInWeeklyRange(item.date, weekRangeFilter))
      .filter(item => emailViewFilter === 'sent'
        ? (item.direction === 'sent' || item.source === 'sent') && applicationsRelatedToEmail(item).length > 0
        : item.direction !== 'sent' && item.source !== 'sent');
    const clientEmails = emails.filter(item => item.direction !== 'sent' && item.source !== 'sent');
    const sentEmails = emails.filter(item => item.direction === 'sent');
    const visibleEmails = sortByDate(emailViewFilter === 'sent' ? sentEmails : clientEmails, item => item.date);
    $('#emailCountLabel').textContent = `${plural(visibleEmails.length, 'email')}${query ? ' shown' : ''}`;
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
        ? (hasFilters ? 'No matching sent emails' : 'No application-linked sent emails yet')
        : hasFilters
          ? 'No matching client emails'
          : 'No emails received yet';
      const copy = hasFilters
        ? 'Try another search term or date range.'
        : emailViewFilter === 'sent'
          ? 'Sent messages linked to an application or saved client will appear here.'
          : 'Received messages from Gmail will appear here.';
      target.innerHTML = `<section class="${sectionClass}"><div class="email-empty"><h3>${title}</h3><p>${copy}</p></div></section>`;
      return;
    }
    const renderEmailRows = items => items.map(item => {
      const matches = applicationsRelatedToEmail(item);
      const matchTag = matches.length ? `<span class="client-match-tag" aria-label="${matches.length} application matches" title="Matched to ${matches.length} applications">${matches.length}</span>` : '';
      const rawSender = (item.from || 'Unknown sender').trim();
      const platformName = item.direction !== 'sent' && item.source !== 'sent' ? platformNameForSender(item.from) : '';
      const sender = platformName || (rawSender.includes('<')
        ? rawSender.slice(0, rawSender.indexOf('<')).replace(/["']/g, '').trim() || rawSender
        : rawSender);
      const initial = sender.trim().charAt(0).toUpperCase() || '?';
      const bodyPreview = emailContentText(item.body).replace(/\s+/g, ' ').trim();
      const preview = bodyPreview.length > 110 ? `${bodyPreview.slice(0, 110).trimEnd()}...` : bodyPreview;
      const previewTitle = `${item.subject || '(No subject)'}${preview ? ` - ${preview}` : ''}`;
      const recipient = extractEmailAddress(item.from);
      const canCompose = matches.length > 0 && isEmailAddress(recipient);
      const sentClass = item.direction === 'sent' ? ' sent' : '';
      const sentBadge = item.direction === 'sent' ? '<span class="sent-email-badge">SENT</span>' : '';
      const dateLabel = item.direction === 'sent' ? 'Sent' : 'Received';
      const sentTime = emailTime(item.date);
      const selectionLabel = platformName ? `${platformName} email` : (item.subject || 'email');
      const selectionCheckbox = emailSelectionMode ? `<input class="email-select-checkbox" type="checkbox" data-email-select value="${escapeHtml(item.id)}" aria-label="Select ${escapeHtml(selectionLabel)}" />` : '';
      const previewMarkup = platformName ? '' : `<p class="email-preview" title="${escapeHtml(previewTitle)}"><strong class="email-subject">${escapeHtml(item.subject || '(No subject)')}</strong>${sentBadge}<span class="email-snippet">${preview ? ` - ${escapeHtml(preview)}` : ''}</span></p>`;
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
    $$('.hired-card-avatar-image[data-client-avatar-path]').forEach(async image => {
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
    if (!timeZone) return { className: 'unknown', text: 'Time zone not set', localTime: '', utcOffset: '' };
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
      if (!weekday || !Number.isInteger(hour)) return { className: 'unknown', text: 'Time zone not set', localTime: '', utcOffset: '' };
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
      const isOnline = !['Sat', 'Sun'].includes(weekday) && hour >= 9 && hour < 17;
      return {
        className: isOnline ? 'online' : 'offline',
        text: `${isOnline ? 'Online now' : 'Offline'} · ${localTime} · ${utcOffset}`,
        localTime,
        utcOffset
      };
    } catch (error) {
      if (error instanceof RangeError) return { className: 'unknown', text: 'Time zone not set', localTime: '', utcOffset: '' };
      throw error;
    }
  }

  function renderClientOnlineStatus(item, includeLabel = true) {
    const status = clientOnlineStatus(item);
    return `<span class="client-online-status ${status.className}${includeLabel ? '' : ' status-dot-only'}" title="${includeLabel ? 'Estimated from weekdays, 9 AM–5 PM client local time' : escapeHtml(status.text)}" aria-label="${escapeHtml(status.text)}" data-client-online-status="${escapeHtml(item.id)}" data-status-dot-only="${!includeLabel}">${includeLabel ? escapeHtml(status.text) : ''}</span>`;
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
        if (timeZoneText && status.localTime) timeZoneText.textContent = `${status.localTime} (${status.utcOffset})`;
      } else {
        indicator.textContent = status.text;
        indicator.title = 'Estimated from weekdays, 9 AM–5 PM client local time';
      }
    });
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
    const dateFilter = $('#hiredDateFilter').value;
    const clients = allHired.filter(item => {
      const contractStatus = isContractEnded(item) ? 'Contract Ended' : (item.contractStatus || 'Active');
      const searchableText = [
        item.clientName, item.email, item.phone, item.website, item.socialMedia, item.location,
        item.companyName, item.company, item.role, contractStatus
      ].join(' ').toLowerCase();
      return (filter === 'all' || contractStatus === filter)
        && (!query || searchableText.includes(query))
        && (!dateFilter || dateKey(activeSinceDate(item)) === dateFilter);
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
      .filter(emailItem => emailItem.direction !== 'sent' && emailItem.source !== 'sent').length;
    const matchMarkup = matchCount
      ? `<span class="hired-card-match"><i class="fa-regular fa-envelope" title="Emails" aria-label="Emails"></i>${matchBadge(item).replace('title="View matching application emails"', `title="${matchCount} matching incoming emails"`)}</span>`
      : '';
    const timeZone = clientTimeZones.has(item.id) ? clientOnlineStatus(item) : null;
    const timeZoneMarkup = timeZone?.localTime
      ? `<span class="hired-card-timezone">${!contractEnded ? renderClientOnlineStatus(item, false) : ''}<span class="hired-card-timezone-separator" aria-hidden="true">·</span><span data-client-timezone-text>${escapeHtml(`${timeZone.localTime} (${timeZone.utcOffset})`)}</span></span>`
      : '';
    const avatarPath = item.profileImage?.storagePath || '';
    return `<article class="hired-card${contractEnded ? ' contract-ended-card' : ''}" data-hired-select="${escapeHtml(item.id)}" tabindex="0" role="button">
      <span class="hired-card-heading"><span class="hired-card-profile"><span class="hired-card-avatar" style="--avatar-tone:${avatarTone}"><span aria-hidden="true">${escapeHtml(initials)}</span>${avatarPath ? `<img class="hired-card-avatar-image" data-client-avatar-id="${escapeHtml(item.id)}" data-client-avatar-path="${escapeHtml(avatarPath)}" alt="${escapeHtml(item.clientName)} profile photo" hidden />` : ''}<button class="hired-card-avatar-upload" type="button" data-client-avatar-upload="${escapeHtml(item.id)}" aria-label="${avatarPath ? 'Change' : 'Upload'} profile photo for ${escapeHtml(item.clientName)}" title="${avatarPath ? 'Change profile photo' : 'Upload profile photo'}"><i class="fa-solid fa-camera" aria-hidden="true"></i></button><input class="hired-card-avatar-input" type="file" accept=".jpg,.jpeg,.jpe,.png,.webp,image/jpeg,image/jpg,image/pjpeg,image/png,image/x-png,image/webp" data-client-avatar-input="${escapeHtml(item.id)}" aria-label="Choose a profile photo for ${escapeHtml(item.clientName)}" hidden /></span><span class="hired-card-identity"><strong class="client-card-title">${escapeHtml(item.clientName)}</strong>${item.role ? `<span class="client-card-subtitle">${escapeHtml(item.role)}</span>` : ''}</span></span><span class="client-contract-status ${statusPillClass}">${escapeHtml(statusLabel)}</span></span>
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
  $('#hiredDateFilter').addEventListener('change', event => {
    hiredDateFilter = event.target.value;
    renderHired();
  });
  $('#hiredDateSort').addEventListener('change', event => {
    hiredDateSort = event.target.value;
    renderHired();
  });
  $('#hiredStatusFilter').addEventListener('change', renderHired);

  function renderHiredDetail(item, scroll = true) {
    if (!item) return;
    showingHiredClientList = false;
    $('#hiredCountLabel').hidden = true;
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
      ? `$${Number(item.salaryAmount).toLocaleString()} / month`
      : item.salaryType === 'hourly' && Number(item.salaryAmount) > 0 && Number(item.hoursPerWeek) > 0
        ? `$${Math.round(Number(item.salaryAmount) * Number(item.hoursPerWeek) * 4).toLocaleString()} / month`
        : item.salaryType === 'hourly' && Number(item.salaryAmount) > 0
          ? `$${Number(item.salaryAmount).toLocaleString()} / hour`
          : '';
    $('#hiredDetailTitle').textContent = item.clientName || 'Active client';
    $('#hiredDetailSubtitle').textContent = item.role || 'Client workspace';
    $('#hiredDetailStatus').className = `status-pill ${contractStatusClass}`;
    $('#hiredDetailStatus').textContent = contractStatus;
    const onlineStatus = $('#hiredDetailOnlineStatus');
    onlineStatus.dataset.clientOnlineStatus = item.id;
    const clientStatus = clientOnlineStatus(item);
    onlineStatus.className = `client-online-status ${clientStatus.className}`;
    onlineStatus.textContent = clientStatus.text;
    onlineStatus.title = 'Estimated from weekdays, 9 AM–5 PM client local time';
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
    $('#clientOverviewSummary').innerHTML = `
      <div class="client-overview-summary-item"><span>Contract</span><strong>${escapeHtml(contractStatus)}</strong><small>${item.contractEndDate ? `Ends ${escapeHtml(formatDate(item.contractEndDate))}` : 'No end date set'}</small></div>
      <div class="client-overview-summary-item"><span>Onboarding</span><strong id="clientOverviewOnboardingStatus">Checking status</strong><small>Client form response</small></div>
      <div class="client-overview-summary-item"><span>Invoices</span><strong>${escapeHtml(plural(invoices.length, 'invoice'))}</strong><small>${latestInvoice ? `Last sent ${escapeHtml(emailDate(latestInvoice.sentAt))}` : 'No invoices sent yet'}</small></div>
      <div class="client-overview-summary-item"><span>Email History</span><strong>${escapeHtml(plural(sentEmails.length, 'email'))}</strong><small>${latestEmail ? `Last sent ${escapeHtml(emailDate(latestEmail.date))}` : 'No emails sent yet'}</small></div>`;
    const detailsMarkup = fields => fields.filter(([, value]) => value).map(([label, value]) => `
      <div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`).join('');
    const contactFields = detailsMarkup([
      ['Contact', item.contact && escapeHtml(item.contact)],
      ['Email', item.email && `<a href="mailto:${escapeHtml(item.email)}">${escapeHtml(item.email)}</a>`],
      ['Phone', item.phone && `<a href="tel:${escapeHtml(item.phone)}">${escapeHtml(item.phone)}</a>`],
      ['Website', item.website && `<a href="${escapeHtml(normalizeUrl(item.website))}" target="_blank" rel="noopener">${escapeHtml(item.website)}</a>`],
      ['Social', item.socialMedia && escapeHtml(item.socialMedia)],
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
        <div class="invoice-send-heading"><div><p class="eyebrow">BILLING</p><h3 id="clientInvoicesTitle">Invoices</h3></div><span class="invoice-sent-count">${escapeHtml(plural(invoices.length, 'invoice'))} sent</span></div>
        <div class="client-invoice-actions">${contractEnded ? '<p class="client-invoice-notice">Invoice sending is unavailable while this contract is ended.</p>' : '<p>Invoices sent to this client appear here.</p><button class="button button-primary" type="button" id="sendInvoiceButton">Send Invoice</button>'}</div>
        ${invoices.length ? `<div class="client-invoice-list" role="list">${invoices.map(invoice => `
          <article class="client-invoice-item" role="listitem">
            <div class="client-invoice-main"><strong>${escapeHtml(invoice.invoiceNumber || 'Invoice')}</strong><span>${escapeHtml(invoice.fileName || 'Invoice document')}</span></div>
            <div class="client-invoice-meta"><span>${escapeHtml(invoice.service || 'Invoice')}</span>${invoice.billingPeriod ? `<span>${escapeHtml(invoice.billingPeriod)}</span>` : ''}${invoice.dueDate ? `<span>Due ${escapeHtml(formatDate(invoice.dueDate))}</span>` : ''}</div>
            <div class="client-invoice-date"><span class="status-pill contract-active">Sent</span><time>${escapeHtml(emailDate(invoice.sentAt))}</time></div>
          </article>`).join('')}</div>` : `<div class="client-section-empty"><h4>No invoices yet</h4><p>${contractEnded ? 'No invoices have been sent to this client.' : 'Send an invoice to keep billing history together.'}</p>${contractEnded ? '' : '<button class="button button-secondary" type="button" id="sendInvoiceButton">Send Invoice</button>'}</div>`}
      </section>`;
    $('#clientEmailHistoryWorkspace').innerHTML = renderHiredEmailHistory(item);
    $('#clientDocumentActions').innerHTML = contractEnded
      ? '<span class="details-readonly-label">Read only</span>'
      : '<button class="button button-secondary active-document-upload-button" type="button" id="hiredDetailUploadButton">Upload file</button><input id="hiredDetailDocumentInput" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden />';
    $('#clientDocumentBox').classList.toggle('contract-ended-readonly', contractEnded);
    $('#documentsFolderStatus').textContent = 'Files are stored securely in your account.';
    renderHiredDocumentWorkspace(item);
    loadClientOnboardingSubmission(item);
    renderClientTasks(item.id);
    if (scroll) $('#hiredDetailPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      : pipelineApplications().filter(item => isInWeeklyRange(applicationAddedDate(item), applicationRange)).length;
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
      case 'account':
        renderAccountPage();
        break;
    }
  }

  function renderAll() {
    // perf: keep match caches until the application snapshot changes, instead of blowing them away on every rerender.
    invalidateApplicationMatchCaches();
    processContractEndedAlerts();
    renderCurrentView();
    updateWeekNavigationCounts();
    $('#navToApplyCount').textContent = (data.toApply || []).filter(item => item.dueDate === today()).length;
    updateToApplyAttention();
    $('#navHiredCount').textContent = hiredClients().filter(isActiveContract).length;
    $('#settingsAppCount').textContent = data.applications.length;
    $('#settingsEmailCount').textContent = receivedEmails().length;
    const autoBackupFrequency = $('#autoBackupFrequency');
    if (autoBackupFrequency) autoBackupFrequency.value = localStorage.getItem('jeff-va-auto-backup-frequency-v1') || 'off';
    renderAlerts();
    renderWeeklyReportAvailability();
  }

  function showView(view, { updateUrl = true } = {}) {
    if (view === 'password') view = 'account';
    const validViews = ['dashboard', 'daily-task', 'applications', 'to-apply', 'hired', 'inbox', 'documents', 'account'];
    if (!validViews.includes(view)) view = 'dashboard';
    if (view === 'account' && !hasAccountSettingsAccess()) view = 'dashboard';
    else if (view === 'account') {
      localStorage.setItem(ACTIVE_VIEW_KEY, view);
      if (updateUrl && window.location.hash !== '#account') {
        window.history.pushState({ view }, '', `${window.location.pathname}${window.location.search}#account`);
      }
      openWorkspaceSettings();
      return;
    }
    if (updateUrl && window.location.hash !== `#${view}`) {
      window.history.pushState({ view }, '', `${window.location.pathname}${window.location.search}#${view}`);
    }
    localStorage.setItem(ACTIVE_VIEW_KEY, view);
    activeView = view;
    // perf: render the requested view on entry while renderAll skips inactive pages.
    renderCurrentView();
    if (view === 'account') {
      renderPasswordPage();
      renderAccountPage();
      refreshAccountStorageUsage();
    }
    const labels = { dashboard: [activeDashboardTab === 'client' ? 'CLIENT WORKSPACE' : 'YOUR PIPELINE', activeDashboardTab === 'client' ? 'Client Dashboard' : 'Application Dashboard'], 'daily-task': ['', 'Daily Tasks'], applications: ['', 'Applications'], 'to-apply': ['', 'To Apply'], hired: ['', 'Active Clients'], inbox: ['', 'Email'], documents: ['PRIVATE TOOLS', 'Tools'], account: ['', 'Account'] };
    $('#pageEyebrow').textContent = labels[view][0];
    $('#pageTitle').textContent = labels[view][1];
    $('#pageEyebrow').hidden = !labels[view][0];
    $('#pageTitle').hidden = false;
    $('#applicationWeekDate').hidden = view !== 'applications';
    $('#emailWeekDate').hidden = view !== 'inbox';
    $('#dailyTaskHeaderDate').hidden = view !== 'daily-task';
    $$('.view').forEach(panel => panel.classList.toggle('active', panel.dataset.viewPanel === view));
    $$('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.view === view));
    // The header Add client action belongs exclusively to the Applications view.
    // Keep it hidden everywhere else, including when navigating from the sidebar.
    const addClientButton = $('#openAddModal');
    addClientButton.hidden = activeView !== 'applications';
    addClientButton.setAttribute('aria-hidden', String(activeView !== 'applications'));
    const gmailHeaderActions = $('#gmailHeaderActions');
    gmailHeaderActions?.classList.toggle('hidden', activeView !== 'inbox');
    closeMobileSidebar({ restoreFocus: window.matchMedia('(max-width: 720px)').matches });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (view === 'inbox' && currentUser && gmailAccessToken) syncGmail(true);
  }

  function saveNewClientApplicationDraft() {
    const draft = {};
    $$('#clientForm input[id], #clientForm select[id], #clientForm textarea[id]').forEach(field => {
      if (field.id === 'clientId' || field.type === 'file') return;
      draft[field.id] = field.type === 'checkbox' ? field.checked : field.value;
    });
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
    activeClientDetailsModalEdit = activeClientDetailsEdit;
    $$('#clientForm input, #clientForm select, #clientForm textarea').forEach(field => { field.disabled = false; });
    editingId = id;
    viewingClientDetails = viewOnly;
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
    $('#deleteClientButton').hidden = !id;
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
      $('#hiredSocial').value = item.socialMedia || '';
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
    $$('#clientForm input, #clientForm select, #clientForm textarea').forEach(field => { field.disabled = viewOnly; });
    if (activeClientOnly) {
      $('#clientStatus').value = 'Active client';
      $('#clientStatus').disabled = true;
    }
    $('#deleteClientButton').hidden = !id || viewOnly;
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
    if (drawerEdit) $('#clientName').focus();
    else setTimeout(() => $('#clientName').focus(), 30);
  }

  function renderClientFollowUpHistory(item, viewOnly) {
    const target = $('#clientFollowUpHistory');
    if (!target || !viewOnly) return;
    const clientEmail = String(item.email || '').trim().toLowerCase();
    const followUps = data.emails.filter(email => email.direction === 'sent'
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
      .filter(email => email.direction === 'sent'
        && (email.applicationId === item.id || (!email.applicationId && clientEmail && String(email.to || '').trim().toLowerCase() === clientEmail)))
      .sort((first, second) => new Date(second.date) - new Date(first.date));
  }

  function renderSentEmailHistoryItems(sentEmails, emptyMessage) {
    return sentEmails.length
      ? sentEmails.map(email => `<button type="button" class="client-email-history-item" data-email-detail="${escapeHtml(email.id)}" aria-label="Open email: ${escapeHtml(email.subject || 'No subject')}, sent ${escapeHtml(emailDate(email.date))}"><span class="client-email-history-copy"><strong title="${escapeHtml(email.subject || '(No subject)')}">${escapeHtml(email.subject || '(No subject)')}</strong><small>To ${escapeHtml(email.to || 'client')}</small><small class="client-email-history-preview">${escapeHtml(emailContentText(email.body).slice(0, 150) || 'No message preview')}</small></span><span class="client-email-history-meta"><span class="client-email-direction">Sent</span><time>${escapeHtml(emailDate(email.date))}</time></span></button>`).join('')
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
    $('#sendEmailMenuButton').hidden = viewingClientDetails || activeClientDrawerEdit;
    $('#sendClientEmailButton').hidden = false;
    $('#sendEmailMenu').classList.add('hidden');
    $('#sendEmailMenuButton').setAttribute('aria-expanded', 'false');
    $('#deleteClientButton').hidden = !editingId || viewingClientDetails || activeClientDrawerEdit;
    $('#closeClientDetailsButton').hidden = !viewingClientDetails && !activeClientDrawerEdit;
    $('#nextStepField').classList.toggle('hidden', $('#clientStatus').value !== 'To Proceed');
    $('#sendProceedEmailButton').hidden = viewingClientDetails || $('#clientStatus').value !== 'To Proceed';
  }

  async function saveClient(event) {
    const submitter = event.submitter;
    if (submitter?.value === 'cancel') {
      if (!editingId) localStorage.removeItem(`${APPLICATION_DRAFT_KEY}:${currentUser?.id || 'anonymous'}`);
      return;
    }
    event.preventDefault();
    const form = $('#clientForm');
    if (!form.reportValidity()) return;
    if ($('#automaticFollowUp').checked && !$('#followUpDate').value) {
      $('#followUpDate').value = addDays(today(), 7);
    }
    const platformChoice = $('#clientPlatform').value;
    const existing = editingId ? data.applications.find(item => item.id === editingId) : null;
    const isActiveClient = $('#clientStatus').value === 'Active client';
    const contractEndDate = $('#contractEndDate').value;
    if (isActiveClient && contractEndDate && dateKey(contractEndDate) < today()
      && !(await appConfirm(`This contract end date has already passed (${formatDate(contractEndDate)}). Saving it will mark ${$('#clientName').value.trim() || 'this client'} as expired. Do you want to continue?`, { title: 'Contract date has passed', confirmLabel: 'Save anyway' }))) return;
    if (isActiveClient && (!existing || existing.status !== 'Active client')) beginActivationRollback(editingId || uid(), existing);
    const activeClientEmailPending = isActiveClient && (!existing || existing.status !== 'Active client' || Boolean(existing.activePendingEmail));
    const application = {
      id: editingId || (pendingActivation?.applicationId || uid()),
      clientName: $('#clientName').value.trim(),
      contact: $('#contactName').value.trim(),
      role: $('#clientRole').value.trim(),
      email: $('#hiredEmail').value.trim(),
      phone: $('#hiredPhone').value.trim(),
      website: $('#hiredWebsite').value.trim(),
      socialMedia: $('#hiredSocial').value.trim(),
      location: $('#hiredLocation').value.trim(),
      platform: platformChoice === 'Other' ? $('#customPlatform').value.trim() : platformChoice,
      employmentType: $('#employmentType').value,
      salaryType: $('#salaryType').value,
      salaryCurrency: $('#salaryCurrency').value || 'USD',
      salaryAmount: $('#salaryAmount').value === '' ? '' : Number($('#salaryAmount').value),
      hoursPerWeek: $('#salaryHoursPerWeek').value === '' ? '' : Number($('#salaryHoursPerWeek').value),
      status: $('#clientStatus').value,
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
      const index = data.applications.findIndex(item => item.id === editingId);
      if (index >= 0) data.applications[index] = application;
    } else {
      data.applications.push(application);
    }
    persist();
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
    if (!(await appConfirm(`Delete ${item.clientName}? This removes the application, profile photo, and attached documents. This cannot be undone unless you've exported a backup.`, { title: 'Delete client application', confirmLabel: 'Delete', danger: true }))) return;
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
      return `<article class="invoice-email-row">
        <span class="invoice-email-icon">PDF</span>
        <div class="invoice-email-main"><strong>${escapeHtml(invoice.invoiceNumber || '')}</strong><span>${escapeHtml(client?.clientName || 'Client unavailable')}</span></div>
        <div class="invoice-email-subject"><strong>${escapeHtml(invoice.fileName || 'Invoice')}</strong><span>${escapeHtml(invoice.service || 'Invoice')}</span></div>
        <div class="invoice-email-meta"><strong>${emailDate(invoice.sentAt)}</strong><span>Sent invoice</span></div>
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

  function extractInvoiceField(content, labelPattern) {
    if (!content) return '';
    const labels = '(?:Invoice\\s*(?:Number|No\\.?|#)|Date\\s+of\\s+Issue|Billing\\s+Period|Due\\s+Date)';
    const match = content.match(new RegExp(`${labelPattern}\\s*[:#-]?\\s*(.*?)(?=\\s+${labels}\\s*[:#-]?|$)`, 'i'));
    return (match?.[1] || '').replace(/\s+/g, ' ').trim();
  }

  function extractInvoiceDetails(content) {
    return {
      invoiceNumber: extractInvoiceField(content, '(?:Invoice\\s*(?:Number|No\\.?|#))'),
      issueDate: extractInvoiceField(content, 'Date\\s+of\\s+Issue'),
      billingPeriod: extractInvoiceField(content, 'Billing\\s+Period'),
      dueDate: extractInvoiceField(content, 'Due\\s+Date')
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

  function renderPendingDocumentPreview(item) {
    const workspace = $('#hiredDocumentWorkspace');
    if (!workspace || !pendingDocumentFile) return;
    const file = pendingDocumentFile;
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
            <button class="button button-primary" type="button" id="savePendingDocument">Save file</button>
          </div>
        </div>
        <div class="document-inline-viewer" id="pendingInlineDocumentViewer">
          ${isPdf
            ? `<iframe src="${pendingDocumentPreviewUrl}" title="Preview of ${escapeHtml(file.name)}"></iframe>`
            : `<div class="word-preview"><div class="word-preview-icon">DOC</div><h4>${escapeHtml(file.name)}</h4><p>Your Word file is selected and ready to save. The browser cannot render .doc/.docx directly here, but you can open it after saving.</p></div>`}
        </div>
        <p class="doc-note save-file-note">Choose <strong>Save file</strong> to attach it to this client. It's stored securely in your account and ready to preview anytime.</p>
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
          <span class="doc-empty">Use Upload file above to attach the first document.</span>
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
              <button type="button" data-doc-email="${escapeHtml(doc.id)}">Send Email</button>
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
    if (!item || !file) return;
    const docId = uid();
    try {
      const storagePath = await saveDocumentBlob(docId, file);
      item.documents = item.documents || [];
      item.documents.push({ id: docId, storagePath, name: file.name, type: file.type, size: file.size, addedAt: new Date().toISOString() });
      const activationEmailPending = Boolean(item.activePendingEmail);
      item.activePendingDocument = false;
      item.documentEmailPending = !activationEmailPending;
      item.documentEmailReminderDate = '';
      item.documentEmailReminderAlertedDate = '';
      item.updatedAt = new Date().toISOString();
      persist();
      clearPendingDocumentPreview();
      renderAll();
      if (activationEmailPending) openClientEmailComposer(item);
      const status = $('#documentsFolderStatus');
      if (status) status.textContent = 'Saved — ready to preview anytime.';
      showActionResult({ title: 'Document saved', message: activationEmailPending ? 'The file was saved. Send the client email to finish activation.' : 'The file was saved. You can send the updated version now or later.' });
    } catch (error) {
      console.error(error);
      const message = error?.message || 'The secure file store rejected the upload';
      const status = $('#documentsFolderStatus');
      if (status) status.textContent = `Upload failed: ${message}`;
      showActionResult({ title: 'Document save failed', message: `Could not save ${file.name}: ${message}`, status: 'error' });
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
    if (added) data.alerts = data.alerts.slice(0, 30);
    return added;
  }

  function alertNewMatches(newEmails) {
    const matches = [];
    newEmails.forEach(emailItem => {
      const applications = matchApplicationsForEmail(emailItem);
      applications.forEach(app => matches.push({ emailItem, app }));
    });
    if (!matches.length) return false;

    const unique = [];
    const seen = new Set();
    matches.forEach(match => {
      const key = `${match.emailItem.gmailId || match.emailItem.id}|${match.app.id}`;
      if (!seen.has(key)) { seen.add(key); unique.push(match); }
    });

    unique.forEach(({ emailItem, app }) => {
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
        const interview = isInterviewEmail(emailItem);
        const interviewDate = interviewDateFromEmail(emailItem);
        const sameDay = Boolean(app.interviewSameDay);
        data.alerts.unshift({
          id: alertId,
          clientName: app.clientName,
          subject: interview ? `${sameDay ? 'Interview date confirmed' : 'Interview with client'}: ${emailItem.subject || '(No subject)'}` : (emailItem.subject || '(No subject)'),
          from: emailItem.from || 'Unknown sender',
          date: emailItem.date || new Date().toISOString(),
          interviewDate: interviewDate || app.interviewDate || '',
          unread: true
        });
      }
    });
    data.alerts = data.alerts.slice(0, 30);
    persist();
    renderAlerts();

    showActionResult({
      title: 'New client email',
      message: `${plural(unique.length, 'new email')} matched to your applications.`,
      status: 'info',
      label: 'CLIENT EMAIL ALERT',
      actionLabel: 'Open inbox',
      details: unique.map(({ emailItem, app }) => ({
        clientName: app.clientName,
        subject: emailItem.subject || '(No subject)',
        from: emailItem.from || 'Unknown sender',
        date: emailItem.date || ''
      })),
      onAction: () => showView('inbox')
    });
    return true;
  }

  function renderAlerts() {
    const alerts = [...(data.alerts || [])].sort((first, second) => new Date(second.date) - new Date(first.date));
    const unread = alerts.filter(alert => alert.unread).length;
    const badge = $('#notificationBadge');
    if (badge) { badge.textContent = unread > 9 ? '9+' : String(unread); badge.hidden = unread === 0; }
    updateTabNotification(unread);
    const list = $('#notificationList');
    if (!list) return;
    if (!alerts.length) {
      list.innerHTML = '<div class="notification-empty">No recent client alerts.</div>';
      return;
    }

    const todayAlerts = alerts.filter(alert => dateKey(alert.date) === today());
    const thisWeekAlerts = alerts.filter(alert => {
      if (dateKey(alert.date) === today()) return false;
      const alertDate = new Date(`${alert.date || new Date().toISOString()}T12:00:00`);
      const weekStart = new Date(`${today()}T12:00:00`);
      const mondayOffset = (weekStart.getDay() + 6) % 7;
      weekStart.setDate(weekStart.getDate() - mondayOffset);
      weekStart.setHours(0, 0, 0, 0);
      return alertDate >= weekStart;
    });
    const recentAlertIds = new Set([...todayAlerts, ...thisWeekAlerts].map(alert => alert.id));
    const earlierAlerts = alerts.filter(alert => !recentAlertIds.has(alert.id));

    const sectionMap = [
      { label: 'Today', items: todayAlerts },
      { label: 'This Week', items: thisWeekAlerts },
      { label: 'Earlier', items: earlierAlerts }
    ].filter(section => section.items.length);

    let remaining = 7;
    const grouped = sectionMap.map(section => {
      const items = section.items.slice(0, remaining);
      remaining -= items.length;
      return { label: section.label, items };
    }).filter(section => section.items.length);

    if (!grouped.length) {
      list.innerHTML = '<div class="notification-empty">No recent client alerts.</div>';
      return;
    }

    list.innerHTML = grouped.map(section => `
      <div class="notification-section">
        <div class="notification-section-title">${section.label}</div>
        ${section.items.map(alert => `
          <button type="button" class="notification-item ${alert.unread ? 'unread' : ''}" data-alert-open="${escapeHtml(alert.id)}">
            <span class="notification-item-dot" aria-hidden="true"></span>
            <span class="notification-item-copy">
              <span class="notification-item-heading"><strong>${escapeHtml(alert.clientName)}</strong><time>${relativeDate(alert.date)}</time></span>
              <span class="notification-item-subject">${escapeHtml(alert.subject || '(No subject)')}</span>
              <small>From ${escapeHtml(alert.from || 'Unknown sender')}</small>
            </span>
          </button>
        `).join('')}
      </div>
    `).join('');
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
        data.alerts = data.alerts.slice(0, 30);
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
      data.alerts = data.alerts.slice(0, 30);
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
    data.alerts = data.alerts.slice(0, 30);
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
    data.alerts = data.alerts.slice(0, 30);
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
    const due = data.applications.filter(item => item.followUpDate && item.followUpDate <= today() && item.status !== 'Active client' && item.status !== 'Not selected' && (!item.followUpProcessedAt || (item.automaticFollowUp && !item.followUpSentAt && gmailAccessToken)));
    if (!due.length) return;
    data.alerts = data.alerts || [];
    let followUpAlertsAdded = 0;
    let automaticEmailsSent = 0;
    let automaticEmailsFailed = 0;
    let followUpsNeedingReview = 0;
    for (const item of due) {
      const scheduledFollowUpDate = item.followUpDate;
      const template = buildDocumentEmailTemplate('follow-up', item);
      const subject = template.subject;
      const body = template.body;
      let sent = false;
      if (item.automaticFollowUp && gmailAccessToken && isEmailAddress(item.email)) {
        try {
          const rawMessage = buildRawEmailMessage({ to: item.email, subject, body });
          await sendGmailRaw(rawMessage);
          sent = true;
          automaticEmailsSent += 1;
        } catch (error) {
          console.error('Automatic follow-up failed:', error);
          automaticEmailsFailed += 1;
        }
      }
      item.followUpProcessedAt = new Date().toISOString();
      item.followUpSentAt = sent ? item.followUpProcessedAt : '';
      if (sent) {
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
        data.emails.unshift({ id: uid(), applicationId: item.id, emailType: 'follow-up', from: 'You', to: item.email, subject, body, date: new Date().toISOString(), importedAt: new Date().toISOString(), source: 'sent', direction: 'sent' });
      } else if (!item.automaticFollowUp || !gmailAccessToken || !isEmailAddress(item.email)) {
        followUpsNeedingReview += 1;
      }
    }
    data.alerts = data.alerts.slice(0, 30);
    persist();
    if (automaticEmailsSent && activeView === 'applications') renderApplications();
    if (automaticEmailsSent && activeView === 'dashboard') renderDashboard();
    renderAlerts();
    if (followUpAlertsAdded || automaticEmailsSent) {
      const summary = [
        automaticEmailsSent ? `${plural(automaticEmailsSent, 'automatic follow-up email')} sent` : '',
          automaticEmailsFailed ? `${plural(automaticEmailsFailed, 'automatic follow-up email')} could not be sent; sign in with Google again and review the alert` : '',
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

  function openNotifications() {
    const panel = $('#notificationPanel');
    const willOpen = panel.classList.contains('hidden');
    renderAlerts();
    panel.classList.toggle('hidden', !willOpen);
    $('#notificationButton').setAttribute('aria-expanded', String(willOpen));
  }

  function markAlertsRead() {
    (data.alerts || []).forEach(alert => { alert.unread = false; });
    persist();
    renderAlerts();
  }

  async function clearAlerts() {
    if (!(data.alerts || []).length) return;
    if (!(await appConfirm('Clear all recent alerts? This will not delete your applications or emails.', { title: 'Clear recent alerts', confirmLabel: 'Clear alerts', danger: true }))) return;
    data.alerts = [];
    persist();
    renderAlerts();
  }

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
      body: 'Hi {{contact}},\n\nPlease find attached the updated Contract Of Agreement for your records.\n\nBest regards,\nJeffrey S. Almocera\nalmocerajeffreys@gmail.com | +63 975-683-4839'
    }
  };
  let gmailTokenClient = null;
  let gmailAccessToken = null;
  let composeAttachment = null;
  let composeAttachmentFile = null;
  let composeClientId = null;
  let composeActivationClientId = null;
  let composeInvoiceDraft = null;
  let composeDocumentUpdateClientId = null;
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
    const roleName = application.role || 'your project';
    const duration = additional.duration || contractDuration(application) || 'the project period';
    const invoiceNumber = additional.invoiceNumber || 'INV-000';
    const billingPeriod = additional.billingPeriod || 'this period';
    const issueDate = additional.issueDate || new Date().toISOString().slice(0, 10);
    const dueDate = additional.dueDate || new Date().toISOString().slice(0, 10);
    const subject = (additional.subject || template.subject)
      .replace(/{{clientName}}/g, clientName)
      .replace(/{{contact}}/g, contactName)
      .replace(/{{role}}/g, roleName)
      .replace(/{{duration}}/g, duration)
      .replace(/{{invoiceNumber}}/g, invoiceNumber)
      .replace(/{{billingPeriod}}/g, billingPeriod)
      .replace(/{{issueDate}}/g, issueDate)
      .replace(/{{dueDate}}/g, dueDate);
    const body = (additional.body || template.body)
      .replace(/{{clientName}}/g, clientName)
      .replace(/{{contact}}/g, contactName)
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

  function openPlainClientEmailComposer(application, preferDrawer = false) {
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
    composeAttachment = document;
    composeAttachmentFile = null;
    composeRequiresConfirmation = false;
    $('#composeAttachmentInput').value = '';
    const template = buildDocumentEmailTemplate('updated-contract', application);
    $('#composeTo').value = application.email || '';
    $('#composeSubject').value = template.subject;
    $('#composeBody').value = template.body;
    $('#emailTemplateName').value = '';
    setEmailComposeStatus(gmailAccessToken ? `Review the updated document email, then send through Gmail. Attachment: ${document.name}` : 'Gmail will connect automatically when you send.');
    renderEmailTemplateOptions();
    $('#emailComposeModal').showModal();
    $('#composeBody').focus();
  }

  function openEmailDetail(emailId) {
    const emailItem = data.emails.find(item => item.id === emailId);
    if (!emailItem) return;
    if ($('#applicationEmailsModal').open) $('#applicationEmailsModal').close();
    if ($('#clientModal').open) $('#clientModal').close();
    const isSent = emailItem.direction === 'sent';
    const recipient = isSent ? emailItem.to : extractEmailAddress(emailItem.from);
    $('#emailDetailEyebrow').textContent = isSent ? 'SENT EMAIL' : 'EMAIL DETAILS';
    $('#emailDetailTitle').textContent = emailItem.subject || '(No subject)';
    $('#emailDetailFrom').textContent = isSent ? 'You' : (emailItem.from || 'Unknown sender');
    $('#emailDetailTo').textContent = recipient || 'Not available';
    $('#emailDetailDateLabel').textContent = isSent ? 'Sent' : 'Received';
    $('#emailDetailDate').textContent = emailDate(emailItem.date);
    $('#emailDetailBody').textContent = `${emailContentText(emailItem.body) || 'This inbox sync stores message headers only. Open the message in Gmail to read its full content.'}${emailItem.attachmentName ? `\n\nAttachment: ${emailItem.attachmentName}` : ''}`;
    $('#emailDetailStatus').textContent = isSent ? 'This message was sent from Jeff VA.' : 'Reply from this client directly through Gmail.';
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
    parsed.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6').forEach(node => node.append('\n'));
    return (parsed.body?.textContent || '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function gmailMessageBody(payload) {
    if (!payload) return '';
    if (payload.body?.data) return emailContentText(decodeGmailBody(payload.body.data));
    for (const part of payload.parts || []) {
      const body = gmailMessageBody(part);
      if (body && part.mimeType === 'text/plain') return body;
    }
    for (const part of payload.parts || []) {
      const body = gmailMessageBody(part);
      if (body) return emailContentText(body);
    }
    return '';
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
          sessionStorage.setItem(GMAIL_TOKEN_SESSION_KEY, response.access_token);
          sessionStorage.setItem(GMAIL_CONNECTED_KEY, '1');
          sessionStorage.removeItem(GMAIL_RECONNECT_REQUIRED_KEY);
          gmailReconnectRequired = false;
          updateGmailConnectionUI(true);
          updateLoginGoogleUI(true, 'Google account connected for this browser session.');
          resolve(response.access_token);
        }
      });
      tokenClient.requestAccessToken({ prompt });
    }).finally(() => { gmailTokenRequest = null; });
    return gmailTokenRequest;
  }

  async function ensureGmailAccessToken() {
    if (gmailAccessToken) return gmailAccessToken;
    try {
      return await requestGmailAccessToken('');
    } catch {
      return requestGmailAccessToken('consent');
    }
  }

  async function sendGmailRaw(rawMessage) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await ensureGmailAccessToken();
      const response = await fetch(GMAIL_SEND_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${gmailAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: encodeBase64Url(rawMessage) })
      });
      if (response.ok) return response.json();
      if ((response.status === 401 || response.status === 403) && attempt === 0) {
        gmailAccessToken = null;
        await requestGmailAccessToken('');
        continue;
      }
      if (response.status === 401 || response.status === 403) handleGmailAuthorizationFailure();
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Gmail returned ${response.status}`);
    }
    throw new Error('Gmail could not send the message.');
  }

  async function sendComposedEmail() {
    const to = $('#composeTo').value.trim();
    const subject = $('#composeSubject').value.trim().replace(/[\r\n]+/g, ' ');
    const body = $('#composeBody').value.trim();
    if (!to || !subject || !body || !isEmailAddress(to)) {
      setEmailComposeStatus('Enter a valid recipient, subject, and message.', 'error');
      return;
    }
    if (composeDocumentUpdateClientId && !(await appConfirm('Send the updated document to this client now?', { title: 'Send updated document', confirmLabel: 'Send' }))) return;
    if (composeRequiresConfirmation && !(await appConfirm(`Send this application email to ${to}?`, { title: 'Confirm email', confirmLabel: 'Send' }))) return;
    const sendButton = $('#sendEmailButton');
    sendButton.disabled = true;
    setEmailComposeStatus('Sending through Gmail...');
    let gmailAccepted = false;
    try {
      let rawMessage;
      if (composeAttachment || composeAttachmentFile) {
        const attachmentBlob = composeAttachmentFile || await getDocumentBlob(composeAttachment.storagePath || composeAttachment.id);
        const attachmentBytes = new Uint8Array(await attachmentBlob.arrayBuffer());
        const attachmentName = composeAttachment?.name || composeAttachmentFile?.name || 'attachment';
        const attachmentType = composeAttachment?.type || attachmentBlob.type || 'application/octet-stream';
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
        applicationId: composeClientId || composeActivationClientId || composeDocumentUpdateClientId || '',
        from: 'You',
        to,
        subject,
        body,
        date: new Date().toISOString(),
        importedAt: new Date().toISOString(),
        source: gmailId ? 'gmail' : 'sent',
        direction: 'sent',
        attachmentName: composeAttachment?.name || composeAttachmentFile?.name || ''
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
      const updatingClient = composeDocumentUpdateClientId && data.applications.find(item => item.id === composeDocumentUpdateClientId);
      if (activatingClient?.activePendingEmail) {
        activatingClient.activePendingEmail = false;
        activatingClient.updatedAt = new Date().toISOString();
        clearActivationRollback();
      }
      if (updatingClient?.documentEmailPending) {
        updatingClient.documentEmailPending = false;
        updatingClient.documentEmailReminderDate = '';
        updatingClient.documentEmailReminderAlertedDate = '';
        updatingClient.updatedAt = new Date().toISOString();
      }
      const savePromise = persist();
      let successMessage = 'Email sent successfully through Gmail.';
      if (activatingClient) {
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
        composeRequiresConfirmation = false;
      }
      sendButton.disabled = false;
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

  function setGmailStatus(message) {
    const status = $('#gmailStatus');
    if (status) status.textContent = message;
    const accountStatus = $('#accountGmailSyncStatus');
    if (accountStatus) accountStatus.textContent = message;
    renderAccountPage();
  }

  function initGmail() {
    gmailReconnectRequired = sessionStorage.getItem(GMAIL_RECONNECT_REQUIRED_KEY) === '1';
    updateGmailConnectionUI(false);
    updateLoginGoogleUI(false, 'Use your Google account to open the dashboard.');
    const loginGoogleButton = $('#loginGoogleButton');
    loginGoogleButton.disabled = !supabaseConfigured();
    if (!window.google?.accounts?.oauth2) {
      setTimeout(initGmail, 300);
      return;
    }
    if (!gmailConfigured()) {
      setGmailStatus('Gmail not set up yet — you can still log in with Google to open the dashboard.');
      loginGoogleButton.disabled = !supabaseConfigured();
      return;
    }
    $('#gmailReconnectButton').onclick = async () => {
      const reconnectButton = $('#gmailReconnectButton');
      reconnectButton.disabled = true;
      setGmailStatus('Reconnecting Gmail…');
      try {
        await requestGmailAccessToken('');
        gmailReconnectRequired = false;
        sessionStorage.removeItem(GMAIL_RECONNECT_REQUIRED_KEY);
        startGmailSyncTimer();
        await syncGmail(true);
      } catch (error) {
        handleGmailAuthorizationFailure(error);
      } finally {
        reconnectButton.disabled = false;
      }
    };
    gmailTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: window.GMAIL_CLIENT_ID,
      scope: GMAIL_SCOPE,
      callback: response => {
        if (response.error) {
          const message = response.error_description || response.error;
          setGmailStatus(`Gmail connection failed: ${message}`);
          showActionResult({ title: 'Gmail connection failed', message, status: 'error' });
          return;
        }
        gmailAccessToken = response.access_token;
        sessionStorage.setItem(GMAIL_TOKEN_SESSION_KEY, response.access_token);
        sessionStorage.setItem(GMAIL_CONNECTED_KEY, '1');
        sessionStorage.removeItem(GMAIL_RECONNECT_REQUIRED_KEY);
        gmailReconnectRequired = false;
        updateLoginGoogleUI(true, 'Google account selected. Log in to load your Gmail inbox.');
        setGmailStatus('Connected — syncing…');
        processContractEndedAlerts();
        processDueFollowUps();
        syncGmail();
        startGmailSyncTimer();
      }
    });
    loginGoogleButton.disabled = false;
    const savedSessionToken = sessionStorage.getItem(GMAIL_TOKEN_SESSION_KEY);
    if (savedSessionToken) {
      gmailAccessToken = savedSessionToken;
      updateGmailConnectionUI(true);
      updateLoginGoogleUI(true, 'Google account connected for this browser session.');
      setGmailStatus('Gmail connected — session restored');
      processContractEndedAlerts();
      syncGmail();
      startGmailSyncTimer();
      return;
    }
    if (sessionStorage.getItem(GMAIL_CONNECTED_KEY)) {
      setGmailStatus(gmailReconnectRequired
        ? 'Gmail needs to reconnect. Use the Reconnect Gmail button; your dashboard session is still active.'
        : 'Gmail authorized previously — log in with Google to sync');
    } else {
      setGmailStatus('Gmail ready — log in with Google to sync your inbox');
    }
  }

  async function loginWithGoogle() {
    if (!supabaseConfigured()) {
      $('#loginError').textContent = 'Sign-in is unavailable. Check the app configuration.';
      return;
    }
    $('#loginGoogleButton').disabled = true;
    $('#loginGoogleStatus').textContent = 'Opening Google sign-in…';
    activeAuthProvider = 'google';
    sessionStorage.setItem(AUTH_PROVIDER_SESSION_KEY, activeAuthProvider);
    try {
      if (!gmailAccessToken && gmailConfigured()) {
        try {
          await requestGmailAccessToken('');
        } catch (gmailError) {
          console.info('Gmail token was not restored before Google sign-in; continuing with the requested Gmail scopes.', gmailError);
        }
      }
      const { error } = await requireSupabase().auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}${window.location.pathname}`,
          scopes: GMAIL_SCOPE
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
      $('#loginGoogleButton').disabled = false;
    }
  }

  function handleGmailAuthorizationFailure() {
    gmailAccessToken = null;
    sessionStorage.removeItem(GMAIL_TOKEN_SESSION_KEY);
    gmailReconnectRequired = true;
    sessionStorage.setItem(GMAIL_RECONNECT_REQUIRED_KEY, '1');
    updateGmailConnectionUI(false);
    updateLoginGoogleUI(false, 'Gmail needs to reconnect. Your dashboard session is still active.');
    setGmailStatus('Gmail needs to reconnect. Use the Reconnect Gmail button; your dashboard session is still active.');
  }

  function startGmailSyncTimer() {
    if (gmailSyncTimer) clearInterval(gmailSyncTimer);
    gmailSyncTimer = setInterval(() => {
      if (currentUser && gmailAccessToken && !gmailReconnectRequired) syncGmail(true);
    }, 30000);
  }

  function scheduleGmailSync({ silent = true } = {}) {
    if (!currentUser || !gmailAccessToken || gmailReconnectRequired || gmailSyncInFlight) return;
    if (gmailSyncTriggerTimer) clearTimeout(gmailSyncTriggerTimer);
    gmailSyncTriggerTimer = setTimeout(() => {
      gmailSyncTriggerTimer = null;
      syncGmail(silent);
    }, 200);
  }

  async function refreshGmailAuthorization() {
    if (gmailAuthorizationRecovery) return gmailAuthorizationRecovery;
    gmailAuthorizationRecovery = requestGmailAccessToken('')
      .catch(error => {
        handleGmailAuthorizationFailure(error);
        throw error;
      })
      .finally(() => { gmailAuthorizationRecovery = null; });
    return gmailAuthorizationRecovery;
  }

  async function fetchGmailJson(url) {
    const makeRequest = () => fetch(url, {
      headers: { Authorization: `Bearer ${gmailAccessToken}` }
    });
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
    if (gmailSyncInFlight || !gmailAccessToken || gmailReconnectRequired || !currentUser || !dataReady || !supabaseDataLoaded) return;
    gmailSyncInFlight = true;
    try {
      const fetchMessageList = async params => {
        return fetchGmailJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`);
      };
      const directClientEmailList = [...new Set(data.applications
        .filter(isDirectClientApplication)
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
      let matchedExistingSentMessages = false;
      const fetchedResults = await Promise.allSettled(newIds.map(async id => {
        const msg = await fetchGmailJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`);
        const headers = msg.payload?.headers || [];
        const header = name => headers.find(item => item.name === name)?.value || '';
        const rawDate = header('Date');
        const date = rawDate && !Number.isNaN(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : new Date().toISOString();
        const to = header('To');
        const isSent = (msg.labelIds || []).includes('SENT');
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
            matchedExistingSentMessages = true;
            return null;
          }
        }
        return {
          id: `gmail-${id}`,
          gmailId: id,
          from: header('From') || 'Unknown sender',
          to,
          subject,
          body,
          date,
          importedAt: new Date().toISOString(),
          source: 'gmail',
          direction: isSent ? 'sent' : 'received'
        };
      }));
      if (fetchedResults.some(result => result.status === 'rejected' && result.reason?.status === 401)) {
        handleGmailAuthorizationFailure();
        throw new Error('Gmail authorization needs to be refreshed.');
      }
      const failedMessageFetches = fetchedResults.filter(result => result.status === 'rejected');
      const fetchedNewMessages = fetchedResults
        .filter(result => result.status === 'fulfilled')
        .map(result => result.value)
        .filter(Boolean);
      // A user can delete an email while this sync is fetching message details.
      // Re-read the deletion list before merging so an older response cannot revive it.
      const currentDeletedGmailIds = new Set(data.deletedGmailIds || []);
      const activeIds = ids.filter(id => !currentDeletedGmailIds.has(id));
      const existingGmailMessages = data.emails.filter(item => item.source === 'gmail' && activeIds.includes(item.gmailId));
      const newOnes = fetchedNewMessages.filter(item => !currentDeletedGmailIds.has(item.gmailId));
      const emailCountBeforeMerge = data.emails.length;
      data.emails = dedupeEmails([
        ...data.emails.filter(item => item.source !== 'gmail' || (!activeIds.includes(item.gmailId) && !currentDeletedGmailIds.has(item.gmailId))),
        ...existingGmailMessages,
        ...newOnes
      ]).filter(item => !(item.source === 'gmail' && currentDeletedGmailIds.has(item.gmailId)));
      const portfolioAlertsAdded = alertPortfolioSubmissionEmails(data.emails);
      const savedGmailIds = new Set(data.emails.filter(item => item.source === 'gmail').map(item => item.gmailId));
      inboxHistoryQueue = inboxHistoryQueue.filter(id => !savedGmailIds.has(id) && !currentDeletedGmailIds.has(id));
      sentHistoryQueue = sentHistoryQueue.filter(id => !savedGmailIds.has(id) && !currentDeletedGmailIds.has(id));
      if (newOnes.length || matchedExistingSentMessages || data.emails.length !== emailCountBeforeMerge || portfolioAlertsAdded) {
        persist();
        renderAll();
      }
      updateGmailConnectionUI(true);
      sessionStorage.setItem(GMAIL_CONNECTED_KEY, '1');
      setGmailStatus(`Connected — ${plural(activeIds.length, 'message')}${newOnes.length ? ` · ${plural(newOnes.length, 'new message')} just now` : ''}${failedMessageFetches.length ? ` · ${plural(failedMessageFetches.length, 'message')} failed to load` : ''}`);
      if (!silent) {
        const hasNewMatches = alertNewMatches(newOnes);
        if (failedMessageFetches.length) {
          showActionResult({ title: 'Gmail sync incomplete', message: `${plural(failedMessageFetches.length, 'message')} could not be loaded. Gmail will retry on the next sync.`, status: 'error' });
        } else if (!hasNewMatches) {
          showActionResult({ title: 'Gmail synced', message: `${plural(activeIds.length, 'message')} are available in the inbox.` });
        }
      }
      if (silent) alertNewMatches(newOnes);
    } catch (error) {
      const message = error?.message || 'Unknown Gmail API error';
      if (!gmailReconnectRequired) setGmailStatus(`Gmail sync failed: ${message}`);
      if (!silent) showActionResult({ title: 'Gmail sync failed', message, status: 'error' });
    } finally {
      gmailSyncInFlight = false;
    }
  }

  // perf: debounce visibility, focus, and online events so one queued Gmail sync replaces a burst of duplicate triggers.
  window.addEventListener('online', () => scheduleGmailSync({ silent: true }));
  window.addEventListener('focus', () => scheduleGmailSync({ silent: true }));
  document.addEventListener('visibilitychange', () => {
    if (currentUser && document.visibilityState === 'visible') scheduleGmailSync({ silent: true });
  });

  // --- Excel export/restore ---
  // Uses SheetJS (loaded via CDN in index.html) to read/write real .xlsx workbooks in the
  // browser. Application records and tool data are exported as separate sheets. Document binaries stay in private
  // Supabase Storage and are never included in the sheet — only their names/sizes/metadata travel
  // with the sheet. A restore therefore restores records, not document binaries or email history.
  const APPLICATION_COLUMNS = ['id', 'clientName', 'status', 'contractStatus', 'contractEndDate', 'contractEndedEmailSentAt', 'platform', 'employmentType', 'salaryType', 'salaryAmount', 'hoursPerWeek', 'contact', 'role', 'appliedDate', 'createdAt', 'activeAt', 'activePendingDocument', 'activePendingEmail', 'documentEmailPending', 'documentEmailReminderDate', 'documentEmailReminderAlertedDate', 'interviewPriority', 'interviewDate', 'interviewLink', 'interviewAlertDate', 'followUpDate', 'automaticFollowUp', 'followUpProcessedAt', 'followUpSentAt', 'notes', 'email', 'phone', 'website', 'socialMedia', 'location', 'documents', 'updatedAt'];
  const TO_APPLY_COLUMNS = ['id', 'title', 'link', 'dueDate', 'notes'];
  const DAILY_TASK_COLUMNS = ['id', 'title', 'type', 'taskDate', 'relatedType', 'relatedId', 'relatedName', 'destination', 'notes', 'checklist', 'createdAt', 'completedAt'];
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
      row[key] = key === 'documents' ? JSON.stringify(item.documents || []) : (item[key] ?? '');
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

  function createDataSheet(records, columns, widths = {}) {
    const sheet = XLSX.utils.json_to_sheet(records || [], { header: columns });
    sheet['!cols'] = columns.map(column => ({ wch: widths[column] || (column === 'content' || column === 'notes' ? 48 : column.length + 4) }));
    return sheet;
  }

  function rowToApplication(row) {
    let documents = [];
    try { documents = row.documents ? JSON.parse(row.documents) : []; } catch { documents = []; }
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
      socialMedia: String(row.socialMedia || ''),
      location: String(row.location || ''),
      createdAt: String(row.createdAt || row.updatedAt || new Date().toISOString()),
      activeAt: String(row.activeAt || (row.status === 'Active client' ? row.appliedDate || '' : '')),
      documents,
      updatedAt: String(row.updatedAt || new Date().toISOString())
    };
  }

  function buildBackupWorkbook() {
    const workbook = XLSX.utils.book_new();
    const applicationWidths = { id: 38, clientName: 24, status: 16, contractStatus: 16, contractEndDate: 16, contractEndedEmailSentAt: 24, platform: 18, employmentType: 16, salaryType: 16, salaryAmount: 18, hoursPerWeek: 18, contact: 22, role: 24, appliedDate: 16, createdAt: 24, activeAt: 24, activePendingDocument: 20, activePendingEmail: 18, documentEmailPending: 20, documentEmailReminderDate: 20, documentEmailReminderAlertedDate: 24, interviewPriority: 18, interviewDate: 16, interviewLink: 36, interviewAlertDate: 24, followUpDate: 16, automaticFollowUp: 18, followUpProcessedAt: 24, followUpSentAt: 24, notes: 48, email: 30, phone: 18, website: 32, socialMedia: 24, location: 24, documents: 48, updatedAt: 24 };
    const applicationsSheet = createDataSheet(pipelineApplications().map(applicationToRow), APPLICATION_COLUMNS, applicationWidths);
    const activeClientsSheet = createDataSheet(hiredClients().map(applicationToRow), APPLICATION_COLUMNS, applicationWidths);
    const invoiceColumns = ['id', 'clientId', 'invoiceNumber', 'issueDate', 'billingPeriod', 'dueDate', 'service', 'startDate', 'endDate', 'fileName', 'sentAt'];
    XLSX.utils.book_append_sheet(workbook, applicationsSheet, 'Applications');
    XLSX.utils.book_append_sheet(workbook, activeClientsSheet, 'Active clients');
    XLSX.utils.book_append_sheet(workbook, createDataSheet(data.invoices || [], invoiceColumns, { id: 38, clientId: 38, invoiceNumber: 18, issueDate: 18, billingPeriod: 24, dueDate: 18, service: 34, startDate: 16, endDate: 16, fileName: 34, sentAt: 24 }), 'Invoices');
    XLSX.utils.book_append_sheet(workbook, createDataSheet(data.toApply || [], TO_APPLY_COLUMNS, { id: 38, title: 28, link: 48, dueDate: 16, notes: 48 }), 'To apply');
    XLSX.utils.book_append_sheet(workbook, createDataSheet((data.dailyTasks || []).map(dailyTaskToRow), DAILY_TASK_COLUMNS, { id: 38, title: 40, type: 18, taskDate: 16, relatedType: 18, relatedId: 38, relatedName: 28, destination: 40, notes: 60, checklist: 60, createdAt: 24, completedAt: 24 }), 'Daily tasks');
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
      const invoices = workbook.Sheets.Invoices ? XLSX.utils.sheet_to_json(workbook.Sheets.Invoices, { defval: '' }) : data.invoices || [];
      const toApply = workbook.Sheets['To apply'] ? XLSX.utils.sheet_to_json(workbook.Sheets['To apply'], { defval: '' }) : data.toApply || [];
      const dailyTasks = workbook.Sheets['Daily tasks'] ? XLSX.utils.sheet_to_json(workbook.Sheets['Daily tasks'], { defval: '' }).map(rowToDailyTask) : data.dailyTasks || [];
      const workLinks = workbook.Sheets.Links ? XLSX.utils.sheet_to_json(workbook.Sheets.Links, { defval: '' }) : data.workLinks || [];
      const scripts = workbook.Sheets.Scripts ? XLSX.utils.sheet_to_json(workbook.Sheets.Scripts, { defval: '' }) : data.scripts || [];
      const restoredApplications = [...applications, ...activeClients.filter(active => !applications.some(application => application.id === active.id))];
      if (!(await appConfirm(`Replace the current application data with ${applications.length} applications and ${activeClients.length} active clients? Tool data and email history will also be restored.`, { title: 'Replace workspace data', confirmLabel: 'Replace data', danger: true }))) return;
      data = { applications: restoredApplications, toApply, dailyTasks, emails: data.emails, deletedGmailIds: data.deletedGmailIds || [], accountSignInHistory: data.accountSignInHistory || [], alerts: [], emailTemplates: data.emailTemplates || [], personalDocuments: data.personalDocuments || [], invoices, scripts, workLinks };
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
    const alertOpenButton = event.target.closest('[data-alert-open]');

    if (dashboardTab) {
      activeDashboardTab = dashboardTab.dataset.dashboardTab;
      $$('[data-dashboard-tab]').forEach(tab => {
        const selected = tab === dashboardTab;
        tab.classList.toggle('active', selected);
        tab.setAttribute('aria-selected', String(selected));
      });
      $$('[data-dashboard-panel]').forEach(panel => {
        panel.hidden = panel.dataset.dashboardPanel !== activeDashboardTab;
      });
      $('#pageEyebrow').textContent = activeDashboardTab === 'client' ? 'CLIENT WORKSPACE' : 'YOUR PIPELINE';
      $('#pageTitle').textContent = activeDashboardTab === 'client' ? 'Client Dashboard' : 'Application Dashboard';
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

  // Applications page and its Active Client activation flow are intentionally
  // contained here. Nothing on the inbox, tools, or active-clients page can
  // advance or cancel this transaction.
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

  document.addEventListener('click', event => {
    if (!event.target.closest('.send-email-menu')) {
      $('#sendEmailMenu')?.classList.add('hidden');
      $('#sendEmailMenuButton')?.setAttribute('aria-expanded', 'false');
    }
    const addButton = event.target.closest('[data-open-add]');
    const editButton = event.target.closest('[data-edit-id]');
    const applicationEmailsButton = event.target.closest('[data-application-emails]');
    const viewDetailsButton = event.target.closest('[data-view-details]');
    const clientDocumentAttachButton = event.target.closest('[data-client-document-attach]');
    const sendEmailMenuButton = event.target.closest('#sendEmailMenuButton');
    const sendClientEmailButton = event.target.closest('#sendClientEmailButton');
    const sendProceedEmailButton = event.target.closest('#sendProceedEmailButton');
    if (sendEmailMenuButton) {
      const menu = $('#sendEmailMenu');
      const willOpen = menu.classList.contains('hidden');
      menu.classList.toggle('hidden', !willOpen);
      sendEmailMenuButton.setAttribute('aria-expanded', String(willOpen));
      return;
    }
    if (addButton) {
      openClientModal();
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
    if (viewDetailsButton && !event.target.closest('button, a')) {
      openClientModal(viewDetailsButton.dataset.viewDetails, true);
      return;
    }
    if (clientDocumentAttachButton) attachPersonalDocumentToClient(clientDocumentAttachButton.dataset.clientDocumentAttach);
    if (sendClientEmailButton) {
      $('#sendEmailMenu').classList.add('hidden');
      $('#sendEmailMenuButton').setAttribute('aria-expanded', 'false');
      const application = data.applications.find(item => item.id === editingId);
      if (application) openPlainClientEmailComposer(application);
      else toast('Save the application first, then open it again to send an email.');
      return;
    }
    if (sendProceedEmailButton) {
      $('#sendEmailMenu').classList.add('hidden');
      $('#sendEmailMenuButton').setAttribute('aria-expanded', 'false');
      const application = data.applications.find(item => item.id === editingId);
      if (application) openProceedEmailComposer(application);
      else toast('Save the application first, then open it again to send the proceed email.');
      return;
    }
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
    $('#clientForm').addEventListener(eventName, () => {
      if ($('#clientModal').open && !editingId && !viewingClientDetails) saveNewClientApplicationDraft();
    });
  });
  $('#deleteClientButton').addEventListener('click', () => deleteClient(editingId));
  $('#clientStatus').addEventListener('change', updateClientActionLabel);
  $('#automaticFollowUp').addEventListener('change', event => {
    if (event.target.checked && !$('#followUpDate').value) $('#followUpDate').value = addDays(today(), 7);
  });
  $('#applicationSearch').addEventListener('input', renderApplications);
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
    if (pendingActivation?.stage === 'email') rollbackActivation();
  });

  // To Apply page controls.
  $('#addToApplyButton').addEventListener('click', () => openToApplyModal());
  $('#toApplySearch').addEventListener('input', renderToApplyList);
  $('#toApplySort').addEventListener('change', renderToApplyList);
  $('#toApplyForm').addEventListener('submit', saveToApply);
  $('#deleteToApplyButton').addEventListener('click', () => deleteToApply($('#toApplyId').value));
  function closeToApplyActionMenus(restoreFocus = false) {
    document.querySelectorAll('[data-to-apply-menu][aria-expanded="true"]').forEach(button => {
      button.setAttribute('aria-expanded', 'false');
      button.nextElementSibling.classList.add('hidden');
      button.nextElementSibling.classList.remove('opens-up');
      if (restoreFocus) button.focus();
    });
  }

  document.addEventListener('click', event => {
    const menuButton = event.target.closest('[data-to-apply-menu]');
    const editButton = event.target.closest('[data-edit-to-apply]');
    const deleteButton = event.target.closest('[data-delete-to-apply]');
    if (menuButton) {
      const menu = menuButton.nextElementSibling;
      const willOpen = menu.classList.contains('hidden');
      closeToApplyActionMenus();
      if (willOpen) {
        const listBounds = menuButton.closest('.to-apply-list').getBoundingClientRect();
        const buttonBounds = menuButton.getBoundingClientRect();
        menu.classList.toggle('opens-up', listBounds.bottom - buttonBounds.bottom < 84);
        menu.classList.remove('hidden');
        menuButton.setAttribute('aria-expanded', 'true');
      }
      return;
    }
    if (editButton) {
      closeToApplyActionMenus();
      openToApplyModal(editButton.dataset.editToApply);
      return;
    }
    if (deleteButton) {
      closeToApplyActionMenus();
      deleteToApply(deleteButton.dataset.deleteToApply);
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

  function dailyTaskDateStatus(task) {
    if (task.completedAt) {
      return `<span class="daily-task-status is-complete">Completed</span>`;
    }
    if (task.taskDate < today()) {
      return `<span class="daily-task-status is-overdue">Overdue · ${escapeHtml(formatDate(task.taskDate))}</span>`;
    }
    if (task.taskDate === today()) {
      return '<span class="daily-task-status is-due-today">Pending · Due today</span>';
    }
    return `<span class="daily-task-status">Pending · Due ${escapeHtml(formatDate(task.taskDate))}</span>`;
  }

  function dailyTaskRelatedOptions() {
    const selected = $('#dailyTaskRelated').value;
    const clients = data.applications.filter(item => item.status === 'Active client');
    const applications = data.applications.filter(item => item.status !== 'Active client');
    const option = (item, type) => {
      const name = item.clientName || item.role || 'Untitled record';
      const detail = item.role && item.clientName ? ` - ${item.role}` : '';
      return `<option value="${type}:${escapeHtml(item.id)}">${escapeHtml(name + detail)}</option>`;
    };
    const groups = [
      clients.length ? `<optgroup label="Active clients">${clients.map(item => option(item, 'client')).join('')}</optgroup>` : '',
      applications.length ? `<optgroup label="Applications">${applications.map(item => option(item, 'application')).join('')}</optgroup>` : ''
    ].join('');
    $('#dailyTaskRelated').innerHTML = `<option value="">No linked record</option>${groups}`;
    if ([...$('#dailyTaskRelated').options].some(item => item.value === selected)) $('#dailyTaskRelated').value = selected;
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
    const relatedName = dailyTaskRelatedName(task);
    const relationLabel = task.relatedType === 'client' ? 'Client' : 'Application';
    const completed = Boolean(task.completedAt);
    const actionLabel = completed ? 'Mark incomplete' : 'Mark complete';
    const actionIcon = completed ? 'fa-rotate-left' : 'fa-check';
    return `
      <article class="daily-task-item${completed ? ' is-complete' : ''}${history ? ' is-history' : ''}">
        <button class="daily-task-action" type="button" data-daily-task-toggle="${escapeHtml(task.id)}" aria-label="${actionLabel}: ${escapeHtml(task.title || 'task')}" title="${actionLabel}"><i class="fa-solid ${actionIcon}" aria-hidden="true"></i></button>
        <button class="daily-task-row-open" type="button" data-daily-task-open="${escapeHtml(task.id)}" aria-label="View details for ${escapeHtml(task.title || 'task')}">
          <span class="daily-task-item-copy">
            <span class="daily-task-item-topline"><span class="daily-task-item-title">${escapeHtml(task.title || 'Untitled task')}</span>${dailyTaskDateStatus(task)}</span>
            <span class="daily-task-item-meta"><span class="daily-task-type daily-task-type-${escapeHtml(task.type || 'task')}">${escapeHtml(DAILY_TASK_TYPES[task.type] || DAILY_TASK_TYPES.task)}</span>${relatedName ? `<span class="daily-task-meta-detail"><i class="fa-solid ${task.relatedType === 'client' ? 'fa-user-tie' : 'fa-briefcase'}" aria-hidden="true"></i><span>${relationLabel}:</span> ${escapeHtml(relatedName)}</span>` : ''}${task.destination ? `<span class="daily-task-meta-detail"><i class="fa-solid fa-location-arrow" aria-hidden="true"></i><span>Destination:</span> ${escapeHtml(task.destination)}</span>` : ''}</span>
            ${task.notes ? `<span class="daily-task-item-notes"><span>Notes</span>${escapeHtml(task.notes)}</span>` : ''}
            <span class="daily-task-item-bottomline">${task.checklist?.length ? `<span class="daily-task-checklist-progress"><i class="fa-solid fa-list-check" aria-hidden="true"></i> ${task.checklist.filter(item => item.completed).length} of ${task.checklist.length} steps</span>` : ''}${history ? `<time datetime="${escapeHtml(task.completedAt || '')}">Completed ${escapeHtml(relativeDate(task.completedAt))}${emailTime(task.completedAt) ? ` · ${escapeHtml(emailTime(task.completedAt))}` : ''}</time>` : ''}</span>
          </span>
        </button>
        <button class="daily-task-delete" type="button" data-daily-task-delete="${escapeHtml(task.id)}" aria-label="Delete task: ${escapeHtml(task.title || 'task')}" title="Delete task"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>
      </article>`;
  }

  function renderDailyTasks() {
    const planDate = $('#dailyTaskDate');
    const historyDate = $('#dailyTaskHistoryDate');
    if (!planDate || !historyDate) return;
    if (!planDate.value) planDate.value = today();
    if (!historyDate.value) historyDate.value = addDays(today(), -1);
    dailyTaskRelatedOptions();
    const selectedDate = planDate.value;
    const allTasks = data.dailyTasks || [];
    const dateTasks = allTasks.filter(task => task.taskDate === selectedDate);
    const overdueTasks = allTasks.filter(task => !task.completedAt && task.taskDate < today());
    const completedCount = dateTasks.filter(task => task.completedAt).length;
    const remainingCount = dateTasks.length - completedCount;
    const headerDate = new Date(`${selectedDate}T12:00:00`);
    $('#dailyTaskHeaderDate').textContent = Number.isNaN(headerDate.getTime())
      ? selectedDate
      : new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(headerDate);
    $('#dailyTaskScheduledCount').textContent = dateTasks.length;
    $('#dailyTaskCompletedCount').textContent = completedCount;
    $('#dailyTaskRemainingCount').textContent = remainingCount;
    $('#dailyTaskOverdueCount').textContent = overdueTasks.length;
    const overdueButton = $('#dailyTaskOverdueFilter');
    overdueButton.classList.toggle('has-overdue', overdueTasks.length > 0);
    overdueButton.classList.toggle('is-active', dailyTaskFilter === 'overdue');
    const overdueIds = new Set(overdueTasks.map(task => task.id));
    const sortTasks = tasks => tasks.sort((first, second) => String(first.createdAt || '').localeCompare(String(second.createdAt || '')));
    const selectedTasks = dateTasks.filter(task => dailyTaskFilter === 'completed'
      ? Boolean(task.completedAt)
      : dailyTaskFilter === 'remaining'
        ? !task.completedAt
        : true);
    const tasks = dailyTaskFilter === 'overdue'
      ? sortTasks([...overdueTasks])
      : dailyTaskFilter === 'all'
        ? [...sortTasks([...overdueTasks]), ...sortTasks(selectedTasks.filter(task => !overdueIds.has(task.id)))]
        : sortTasks(selectedTasks);
    $('#navDailyTaskCount').textContent = allTasks.filter(task => task.taskDate === today()).length;
    $('#dailyTaskListTitle').textContent = 'Tasks';
    const overdueGroup = dailyTaskFilter === 'all' && overdueTasks.length
      ? `<h4 class="daily-task-overdue-heading">Overdue</h4>${sortTasks([...overdueTasks]).map(task => renderDailyTaskItem(task)).join('')}`
      : '';
    const nonOverdueTasks = dailyTaskFilter === 'all'
      ? tasks.filter(task => !overdueIds.has(task.id))
      : dailyTaskFilter === 'overdue' ? [] : tasks;
    const taskMarkup = `${overdueGroup}${nonOverdueTasks.map(task => renderDailyTaskItem(task)).join('')}`;
    $('#dailyTaskList').innerHTML = tasks.length
      ? taskMarkup
      : `<div class="daily-task-empty">${dailyTaskFilter === 'all' && selectedDate === today() || dailyTaskFilter === 'overdue' ? 'All caught up' : dailyTaskFilter === 'completed' ? 'No completed tasks' : dailyTaskFilter === 'remaining' ? 'No remaining tasks' : 'No tasks for this date'}</div>`;

    const historyTasks = (data.dailyTasks || []).filter(task => task.completedAt && dateKey(task.completedAt) === historyDate.value)
      .sort((first, second) => String(second.completedAt).localeCompare(String(first.completedAt)));
    $('#dailyTaskHistoryCount').textContent = historyTasks.length;
    $('#dailyTaskHistoryList').innerHTML = historyTasks.length
      ? historyTasks.map(task => renderDailyTaskItem(task, true)).join('')
      : '<div class="daily-task-history-empty">No completed tasks</div>';
    if ($('#dailyTaskDetailModal').open) {
      const activeTask = (data.dailyTasks || []).find(task => task.id === activeDailyTaskId);
      if (activeTask) renderDailyTaskDetails(activeTask);
      else $('#dailyTaskDetailModal').close();
    }
  }

  $('#dailyTaskType').addEventListener('change', event => {
    $('#dailyTaskDestinationField').classList.toggle('hidden', event.target.value !== 'apply');
  });
  $('#openDailyTaskAddModal').addEventListener('click', () => {
    resetDailyTaskDraft();
    $('#dailyTaskAddModal').showModal();
    $('#dailyTaskTitle').focus();
  });
  $('#closeDailyTaskAddModal').addEventListener('click', closeDailyTaskAddModal);
  $('#cancelDailyTaskAddModal').addEventListener('click', closeDailyTaskAddModal);
  $('#dailyTaskAddModal').addEventListener('close', resetDailyTaskDraft);
  $('#dailyTaskAddChecklistButton').addEventListener('click', addDailyTaskDraftChecklistItem);
  $('#dailyTaskChecklistInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addDailyTaskDraftChecklistItem();
    }
  });
  $('#dailyTaskDate').addEventListener('change', renderDailyTasks);
  $('#dailyTaskHistoryDate').addEventListener('change', renderDailyTasks);
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
  $('#closeDailyTaskDetails').addEventListener('click', () => $('#dailyTaskDetailModal').close());
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
      if (!(await appConfirm('Delete this task and its completion history?', { title: 'Delete task', confirmLabel: 'Delete task', danger: true }))) return;
      data.dailyTasks = (data.dailyTasks || []).filter(item => item.id !== deleteButton.dataset.dailyTaskDelete);
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
    const client = data.applications.find(application => application.id === hiredEditingId);
    if (!layer || !client) return;
    activeClientDrawerView = view;
    $('#activeClientDrawerList').hidden = view !== 'list';
    $('#activeClientDrawerEmailView').hidden = view !== 'email';
    $('#activeClientDrawerOnboardingView').hidden = view !== 'onboarding';
    $('#activeClientDrawerEditView').hidden = view !== 'edit';
    back.hidden = view === 'list';
    title.textContent = view === 'list'
      ? 'Actions'
      : view === 'email'
        ? 'Send email'
        : view === 'onboarding'
          ? 'Request corrected onboarding details'
          : 'Edit details';
    $('#activeClientDrawerClientName').textContent = client.clientName || 'Active client';
    if (view === 'email') mountActiveClientDrawerForm('emailComposeForm', 'activeClientDrawerEmailSlot');
    if (view === 'edit') mountActiveClientDrawerForm('clientForm', 'activeClientDrawerClientFormSlot');
    layer.dataset.view = view;
  }

  function openActiveClientActionsDrawer(trigger) {
    const client = data.applications.find(application => application.id === hiredEditingId);
    if (!client) return;
    const layer = $('#activeClientDrawerLayer');
    activeClientDrawerReturnFocus = trigger;
    activeClientDrawerOpen = true;
    activeClientDrawerView = 'list';
    clearTimeout(activeClientDrawerCloseTimer);
    layer.hidden = false;
    layer.setAttribute('aria-hidden', 'false');
    layer.classList.remove('closing');
    document.body.classList.add('active-client-drawer-open');
    $('#activeClientGeneratedLink').hidden = true;
    $('#activeClientOnboardingUrl').value = '';
    $('#activeClientOnboardingStatus').textContent = '';
    showActiveClientDrawerView('list');
    requestAnimationFrame(() => {
      if (!activeClientDrawerOpen) return;
      layer.classList.add('open');
      $('#activeClientDrawerList [data-active-client-action]')?.focus();
    });
  }

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
      restoreActiveClientDrawerForms();
      updateClientActionLabel();
      activeClientDrawerReturnFocus?.focus();
      activeClientDrawerReturnFocus = null;
      onClosed?.();
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 270);
  }

  function drawerTabStops() {
    return $$('#activeClientDrawer button:not([disabled]), #activeClientDrawer input:not([disabled]), #activeClientDrawer select:not([disabled]), #activeClientDrawer textarea:not([disabled]), #activeClientDrawer a[href]')
      .filter(element => !element.closest('[hidden]') && element.getClientRects().length);
  }

  $('#closeActiveClientDrawer').addEventListener('click', () => closeActiveClientActionsDrawer());
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
    avatarUploadButton.closest('.hired-card')?.querySelector('[data-client-avatar-input]')?.click();
  }, true);

  document.addEventListener('click', async event => {
    const clientDetailTab = event.target.closest('#hiredDetailPanel [data-client-detail-tab]');
    if (clientDetailTab) {
      selectClientDetailTab(clientDetailTab.dataset.clientDetailTab);
      return;
    }
    const deleteActiveButton = event.target.closest('#deleteActiveClient');
    const activeClientActionsButton = event.target.closest('#activeClientActionsButton');
    const sendInvoiceButton = event.target.closest('#sendInvoiceButton');
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
      if (actionRow.dataset.activeClientAction === 'email') {
        const item = data.applications.find(application => application.id === hiredEditingId);
        if (item) openPlainClientEmailComposer(item, true);
      } else if (actionRow.dataset.activeClientAction === 'onboarding') {
        showActiveClientDrawerView('onboarding');
        $('#generateClientOnboardingLinkButton').focus();
      } else if (actionRow.dataset.activeClientAction === 'edit') {
        const clientId = hiredEditingId;
        closeActiveClientActionsDrawer(false, () => openClientModal(clientId, false, true, false, true));
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
    if (sendInvoiceButton) {
      const item = data.applications.find(application => application.id === hiredEditingId);
      if (item) openInvoiceDocumentPicker(item);
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
    const card = document.querySelector(`[data-hired-select="${CSS.escape(clientId)}"]`);
    const button = card?.querySelector('[data-client-avatar-upload]');
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
  $('#cancelClientAvatarCrop').addEventListener('click', closeClientAvatarCrop);
  $('#cancelClientAvatarCropAction').addEventListener('click', closeClientAvatarCrop);
  $('#clientAvatarCropModal').addEventListener('close', () => {
    if (clientAvatarCropObjectUrl) URL.revokeObjectURL(clientAvatarCropObjectUrl);
    clientAvatarCropObjectUrl = '';
    clientAvatarCropState = null;
    $('#clientAvatarCropImage').removeAttribute('src');
  });
  $('#useClientAvatarCrop').addEventListener('click', async event => {
    if (!clientAvatarCropState) return;
    const button = event.currentTarget;
    button.disabled = true;
    $('#clientAvatarCropStatus').textContent = 'Cropping and uploading photo…';
    const clientId = clientAvatarCropState.clientId;
    try {
      const croppedFile = await makeClientAvatarCropBlob();
      closeClientAvatarCrop();
      await uploadClientAvatar(clientId, croppedFile);
    } catch (error) {
      console.error('Could not crop client profile photo:', error);
      $('#clientAvatarCropStatus').textContent = error.message || 'The photo could not be cropped.';
      button.disabled = false;
      return;
    }
    button.disabled = false;
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
    openClientAvatarCrop(clientId, file);
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

  $('#cancelDocumentEmailReminder').addEventListener('click', closeDocumentEmailReminder);
  $('#cancelDocumentEmailReminderAction').addEventListener('click', closeDocumentEmailReminder);

  document.addEventListener('change', event => {
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
      pickHiredDocumentFile();
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
    if (event.target.closest('[data-email-refresh]')) {
      if (!gmailAccessToken) {
        showActionResult({ title: 'Gmail not connected', message: 'Connect Gmail from Account settings before refreshing your inbox.', status: 'error' });
        return;
      }
      await syncGmail(false);
      return;
    }

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
    return Object.fromEntries(coverLetterFields.map(field => [field.dataset.coverLetterField, field.value.trim()]));
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
    const recipientAddress = recipientName && recipientName.toLowerCase() !== defaultRecipient.toLowerCase() ? recipientName : '';
    $('#coverLetterPreview').innerHTML = `
      <header class="cover-letter-page-header">
        <img src="images/tab.png" alt="Jeff VA logo" />
        <div><h1>Jeffrey S. Almocera</h1><div class="cover-letter-contact">${escapeHtml(contact)}</div></div>
      </header>
      <p class="cover-letter-date">${coverLetterDate()}</p>
      ${recipientAddress ? `<p class="cover-letter-recipient">${escapeHtml(recipientAddress)}</p>` : ''}
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
    const button = $('#downloadCoverLetterPdf');
    button.disabled = true;
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
      showActionResult({ title: 'Cover letter downloaded', message: 'Your cover letter PDF is ready.' });
    } catch (error) {
      console.error('Cover letter PDF export failed:', error);
      showActionResult({ title: 'Could not create PDF', message: 'The cover letter PDF could not be generated. Try again.', status: 'error' });
    } finally {
      button.disabled = false;
    }
  }

  async function downloadCoverLetterWord() {
    const docx = window.docx;
    if (!docx) {
      showActionResult({ title: 'Word export unavailable', message: 'The Word document tool could not load. Check your connection and try again.', status: 'error' });
      return;
    }
    const button = $('#downloadCoverLetterWord');
    button.disabled = true;
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
      const recipientAddress = recipientName && recipientName.toLowerCase() !== defaultRecipient.toLowerCase() ? recipientName : '';
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
        ...(recipientAddress ? [textParagraph(recipientAddress, { spacing: { after: 200 } })] : []),
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
      showActionResult({ title: 'Cover letter downloaded', message: 'Your Word document is ready.' });
    } catch (error) {
      console.error('Cover letter Word export failed:', error);
      showActionResult({ title: 'Could not create Word document', message: 'The Word document could not be generated. Try again.', status: 'error' });
    } finally {
      button.disabled = false;
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

  function weekRange(offset = 0) {
    const end = new Date();
    end.setHours(12, 0, 0, 0);
    const start = new Date(end);
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
    start.setDate(start.getDate() + offset * 7);
    if (offset !== 0) {
      end.setTime(start.getTime());
      end.setDate(end.getDate() + 4);
    }
    return { start: localDateKey(start), end: localDateKey(end) };
  }

  function weeklyRangeLabel(range) {
    const start = new Date(`${range.start}T12:00:00`);
    const end = new Date(`${range.end}T12:00:00`);
    const format = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    return `${format.format(start)} – ${format.format(end)}, ${end.getFullYear()}`;
  }

  function weeklyHistoryOptions() {
    const currentRange = weekRange();
    const activityDates = [
      ...data.applications.map(item => item.appliedDate),
      ...data.applications.filter(item => item.status === 'Active client').map(item => item.activeAt),
      ...(data.invoices || []).map(item => item.sentAt),
      ...data.emails.filter(item => item.direction === 'sent').map(item => item.date)
    ].map(dateKey).filter(date => date && date < currentRange.start);
    const offsets = [...new Set(activityDates.map(date => {
      const activityDate = new Date(`${date}T12:00:00`);
      const daysSinceMonday = (activityDate.getDay() + 6) % 7;
      activityDate.setDate(activityDate.getDate() - daysSinceMonday);
      return Math.round((activityDate - new Date(`${currentRange.start}T12:00:00`)) / 86400000 / 7);
    }))].sort((first, second) => second - first);
    const options = offsets.map(offset => {
      const range = weekRange(offset);
      return `<option value="${offset}">${escapeHtml(weeklyRangeLabel(range).replace(' – ', ' to '))}</option>`;
    }).join('');
    return `<option value="0">Choose a previous week</option>${options}`;
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

  function weeklyReportData() {
    const range = weekRange(weeklyReportOffset);
    const applications = data.applications.filter(item => isInWeeklyRange(item.appliedDate, range));
    const invoices = (data.invoices || []).filter(item => isInWeeklyRange(item.sentAt, range));
    const clients = data.applications.filter(item => item.status === 'Active client' && isInWeeklyRange(item.activeAt, range));
    const emails = data.emails.filter(item => item.direction === 'sent' && isInWeeklyRange(item.date, range));
    const emailTypes = emails.reduce((counts, email) => {
      const type = weeklyEmailType(email);
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, {});
    const platformCounts = applications.reduce((counts, item) => {
      const platform = item.platform || 'Not specified';
      counts[platform] = (counts[platform] || 0) + 1;
      return counts;
    }, {});
    const topPlatform = Object.entries(platformCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || ['No applications', 0];
    const activities = [
      ...applications.map(item => ({ date: item.appliedDate, label: `Applied: ${item.clientName || 'Untitled application'}`, type: 'Application' })),
      ...clients.map(item => ({ date: item.activeAt, label: `Client activated: ${item.clientName || 'Unnamed client'}`, type: 'Client' })),
      ...invoices.map(item => ({ date: item.sentAt, label: `Invoice sent: ${item.invoiceNumber || item.fileName || 'Invoice'}`, type: 'Invoice' })),
      ...emails.map(item => ({ date: item.date, label: `${weeklyEmailType(item)} email: ${item.subject || '(No subject)'}`, type: 'Email' }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));
    return { range, applications, invoices, clients, emails, emailTypes, topPlatform, activities };
  }

  function renderWeeklyReport() {
    const report = weeklyReportData();
    $('#weeklyReportDate').textContent = `${weeklyReportOffset === 0 ? 'Week in progress' : 'Selected week'} ${weeklyRangeLabel(report.range)}`;
    $('#weeklyReportPeriod').textContent = weeklyRangeLabel(report.range);
    $('#showCurrentWeeklyReport').disabled = weeklyReportOffset === 0;
    $('#weeklyReportHistory').innerHTML = weeklyHistoryOptions();
    $('#weeklyReportHistory').value = String(weeklyReportOffset);
    const metrics = [
      ['Applications', report.applications.length],
      ['Invoices sent', report.invoices.length],
      ['New clients', report.clients.length],
      ['Emails sent', report.emails.length]
    ];
    $('#weeklyReportMetrics').innerHTML = `${metrics.map(([label, value]) => `<div class="weekly-report-metric"><strong>${value}</strong><span>${label}</span></div>`).join('')}<div class="weekly-report-metric weekly-report-platform"><strong title="${escapeHtml(report.topPlatform[0])}">${escapeHtml(report.topPlatform[0])}</strong><span>Most applied platform${report.topPlatform[1] ? ` · ${report.topPlatform[1]}` : ''}</span></div>`;
    const max = Math.max(1, ...metrics.map(([, value]) => value));
    $('#weeklyReportChart').innerHTML = metrics.map(([label, value]) => `<div class="weekly-report-bar"><i style="height:${Math.max(3, (value / max) * 100)}%"></i><strong>${value}</strong><span>${escapeHtml(label)}</span></div>`).join('');
    $('#weeklyReportEmailTotal').textContent = plural(report.emails.length, 'email');
    $('#weeklyReportEmailBreakdown').innerHTML = Object.keys(report.emailTypes).length
      ? Object.entries(report.emailTypes).sort((a, b) => b[1] - a[1]).map(([type, count]) => `<span>${escapeHtml(type)} · ${count}</span>`).join('')
      : '<p class="weekly-report-empty">No emails sent in this period.</p>';
    $('#weeklyReportActivityCount').textContent = plural(report.activities.length, 'activity');
    $('#weeklyReportActivities').innerHTML = report.activities.length
      ? report.activities.slice(0, 30).map(activity => `<div class="weekly-report-activity"><span>${escapeHtml(activity.label)}</span><small>${escapeHtml(formatDate(dateKey(activity.date)))}</small></div>`).join('')
      : '<p class="weekly-report-empty">No tracked activity in this period.</p>';
    return report;
  }

  function openWeeklyReport() {
    weeklyReportOffset = 0;
    renderWeeklyReport();
    $('#weeklyReportModal').showModal();
  }

  function renderWeeklyReportAvailability() {
    const range = weekRange();
    const period = $('#weeklyReportPeriod');
    if (period) period.textContent = weeklyRangeLabel(range);
    const reportKey = `${range.start}|${range.end}`;
    if (!currentUser || !dataReady || !supabaseDataLoaded || localStorage.getItem(WEEKLY_REPORT_SEEN_KEY) === reportKey) return;
    localStorage.setItem(WEEKLY_REPORT_SEEN_KEY, reportKey);
    setTimeout(openWeeklyReport, 250);
  }

  function downloadWeeklyReport() {
    const modal = $('#weeklyReportModal');
    const button = $('#downloadWeeklyReport');
    const report = weeklyReportData();
    const pdfLib = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!modal || !window.html2canvas || !pdfLib) {
      toast('PDF export is still loading, try again in a moment');
      return;
    }

    const previousLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Preparing PDF...';

    window.html2canvas(modal, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      scrollX: 0,
      scrollY: 0
    }).then(canvas => {
      const pdf = new pdfLib({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 12;
      const maxWidth = pageWidth - (margin * 2);
      const maxHeight = pageHeight - (margin * 2);
      const aspectRatio = canvas.width / canvas.height;
      let imgWidth = maxWidth;
      let imgHeight = imgWidth / aspectRatio;
      if (imgHeight > maxHeight) {
        imgHeight = maxHeight;
        imgWidth = imgHeight * aspectRatio;
      }
      const imgData = canvas.toDataURL('image/png');
      const x = (pageWidth - imgWidth) / 2;
      const y = (pageHeight - imgHeight) / 2;
      pdf.addImage(imgData, 'PNG', x, y, imgWidth, imgHeight);
      pdf.save(`jeff-va-weekly-report-${report.range.end}.pdf`);
      showActionResult({ title: 'Report downloaded', message: 'Your weekly report PDF was downloaded.' });
    }).catch(error => {
      console.error('Weekly report PDF export failed:', error);
      showActionResult({ title: 'Could not generate report', message: 'The weekly report PDF could not be generated. Try again.', status: 'error' });
    }).finally(() => {
      button.disabled = false;
      button.textContent = previousLabel;
    });
  }

  $('#openWeeklyReport').addEventListener('click', openWeeklyReport);
  $('#weeklyReportHistory').innerHTML = weeklyHistoryOptions();
  $('#weeklyReportHistory').addEventListener('change', event => {
    weeklyReportOffset = Number(event.target.value);
    renderWeeklyReport();
  });
  $('#showCurrentWeeklyReport').addEventListener('click', () => {
    weeklyReportOffset = 0;
    renderWeeklyReport();
  });
  $('#downloadWeeklyReport').addEventListener('click', downloadWeeklyReport);

  // Authentication stays isolated from page interactions. Its login behavior is
  // unchanged; this file only owns the login screen and application startup.
  const loginForm = $('#loginForm');
  const loginError = $('#loginError');
  const loginUsername = $('#loginUsername');
  const loginPassword = $('#loginPassword');
  setAuthenticated(false);

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
    if (gmailSyncTimer) {
      clearInterval(gmailSyncTimer);
      gmailSyncTimer = null;
    }
    gmailAccessToken = null;
    gmailReconnectRequired = false;
    sessionStorage.removeItem(GMAIL_TOKEN_SESSION_KEY);
    sessionStorage.removeItem(GMAIL_CONNECTED_KEY);
    sessionStorage.removeItem(GMAIL_RECONNECT_REQUIRED_KEY);
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
    dataReady = false;
    supabaseDataLoaded = false;
    data = emptyData();
    setAuthenticated(false);
    applicationDateFilter = today();
    $('#applicationDateFilter').value = applicationDateFilter;
    renderAll();
    $('#loginUsername').focus();
  });

  applicationDateFilter = today();
  $('#applicationDateFilter').value = applicationDateFilter;
  renderAll();
  window.addEventListener('online', renderAccountPage);
  window.addEventListener('offline', renderAccountPage);
  const initialView = window.location.hash.slice(1) || localStorage.getItem(ACTIVE_VIEW_KEY) || 'dashboard';
  showView(initialView, { updateUrl: false });
  window.addEventListener('popstate', () => {
    showView(window.location.hash.slice(1) || 'dashboard', { updateUrl: false });
  });
  initGmail();
  restoreSupabaseSession();

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
let clientTaskMenuOpenId = '';

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
}

function clientTaskLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  const repeatIcon = task.repeat?.frequency && task.repeat.frequency !== 'none'
    ? '<span class="client-task-recurring" title="Recurring task" aria-label="Recurring task"><i class="fa-solid fa-repeat" aria-hidden="true"></i></span>'
    : '';
  const menuOpen = clientTaskMenuOpenId === task.id;
  return `<article class="client-task-row${done ? ' is-complete' : ''}${running ? ' is-running' : ''}" data-client-task-row="${escapeHtml(task.id)}">
    <label class="client-task-complete-control"><input type="checkbox" data-client-task-complete="${escapeHtml(task.id)}" ${done ? 'checked' : ''} aria-label="${done ? 'Reopen' : 'Complete'} task: ${escapeHtml(task.title || 'Untitled task')}" /><span class="sr-only">${done ? 'Completed' : 'Mark complete'}</span></label>
    <div class="client-task-row-main">
      <div class="client-task-row-title-line"><button class="client-task-title-button" type="button" data-client-task-edit="${escapeHtml(task.id)}">${escapeHtml(task.title || 'Untitled task')}</button><span class="client-task-category">${escapeHtml(CLIENT_TASK_CATEGORIES.includes(task.category) ? task.category : 'Other')}</span></div>
      <div class="client-task-row-meta"><span class="client-task-priority priority-${priority.toLowerCase()}"><i aria-hidden="true"></i>${priority}</span>${clientTaskDueLabel(task)}${repeatIcon}<span class="client-task-status-text">${done ? 'Done' : task.status === 'in-progress' ? 'In progress' : 'To do'}</span></div>
    </div>
    <span class="client-task-time-logged" data-client-task-time="${escapeHtml(task.id)}">${escapeHtml(clientTaskFormatDuration(time))}</span>
    <span class="client-task-live-clock${running ? ' is-visible' : ''}" data-client-task-clock="${escapeHtml(task.id)}">${running ? clientTaskClock(time) : ''}</span>
    <button class="client-task-timer-button${running ? ' is-running' : ''}" type="button" data-client-task-timer="${escapeHtml(task.id)}" ${ended || done ? 'disabled' : ''} aria-label="${running ? 'Pause timer' : 'Start timer'} for ${escapeHtml(task.title || 'task')}" title="${ended ? 'Timers are disabled for ended contracts' : running ? 'Pause timer' : 'Start timer'}"><i class="fa-solid ${running ? 'fa-pause' : 'fa-play'}" aria-hidden="true"></i></button>
    <div class="client-task-menu-wrap">
      <button class="client-task-menu-button" type="button" data-client-task-menu="${escapeHtml(task.id)}" aria-label="Task actions for ${escapeHtml(task.title || 'task')}" aria-expanded="${menuOpen}"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button>
      <div class="client-task-menu${menuOpen ? '' : ' hidden'}" role="menu">
        <button type="button" role="menuitem" data-client-task-edit="${escapeHtml(task.id)}">Edit</button>
        <button type="button" role="menuitem" data-client-task-duplicate="${escapeHtml(task.id)}" ${ended ? 'disabled title="New tasks are disabled for ended contracts"' : ''}>Duplicate</button>
        <button type="button" role="menuitem" class="is-danger" data-client-task-delete="${escapeHtml(task.id)}">Delete</button>
      </div>
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
  $('#newClientTaskButton').disabled = clientTaskIsEnded(clientId);
  $('#newClientTaskButton').title = clientTaskIsEnded(clientId) ? 'New tasks are disabled for ended contracts' : '';

  const target = $('#clientTaskGroups');
  const priorCompletedOpen = target.querySelector('[data-client-task-group="Completed"]')?.open;
  const visible = clientTaskFiltered(tasks);
  if (!visible.length) {
    const hasAnyTasks = tasks.length > 0;
    target.innerHTML = `<div class="client-task-empty"><i class="fa-regular ${hasAnyTasks ? 'fa-filter' : 'fa-clipboard'}" aria-hidden="true"></i><h3>${hasAnyTasks ? 'No tasks match these filters' : 'No tasks for this client yet'}</h3><p>${hasAnyTasks ? 'Try adjusting the search or filters.' : 'Keep this client’s work organized in one place.'}</p>${hasAnyTasks ? '' : `<button class="button button-primary" type="button" data-client-task-new ${clientTaskIsEnded(clientId) ? 'disabled' : ''}><i class="fa-solid fa-plus" aria-hidden="true"></i> New task</button>`}</div>`;
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

function clientTaskRepeatValue() {
  const frequency = $('#clientTaskRepeat').value;
  if (frequency === 'weekly') {
    const weekdays = $$('#clientTaskWeekdays input:checked').map(input => Number(input.value)).sort((a, b) => a - b);
    return { frequency, weekdays };
  }
  if (frequency === 'monthly') return { frequency, dayOfMonth: Number($('#clientTaskMonthDay').value) };
  return { frequency, weekdays: [], dayOfMonth: null };
}

function updateClientTaskRepeatFields() {
  const frequency = $('#clientTaskRepeat').value;
  $('#clientTaskWeekdays').hidden = frequency !== 'weekly';
  $('#clientTaskMonthDayField').hidden = frequency !== 'monthly';
  const preview = $('#clientTaskRepeatPreview');
  if (frequency === 'daily') preview.textContent = 'Repeats every day.';
  else if (frequency === 'weekly') {
    const selected = $$('#clientTaskWeekdays input:checked').map(input => CLIENT_TASK_WEEKDAYS[Number(input.value)]);
    preview.textContent = selected.length ? `Repeats every ${selected.join(', ')}.` : 'Choose one or more weekdays.';
  } else if (frequency === 'monthly') preview.textContent = `Repeats on day ${$('#clientTaskMonthDay').value} of each month.`;
  else preview.textContent = 'This task will not repeat.';
}

function fillClientTaskDrawer(task = null) {
  const form = $('#clientTaskForm');
  form.reset();
  $('#clientTaskDueDate').setCustomValidity('');
  $('#clientTaskManualEnd').setCustomValidity('');
  clientTaskEditingId = task?.id || '';
  clientTaskDraftEntries = task ? clientTaskTimeEntries(task).map(entry => ({ ...entry })) : [];
  $('#clientTaskDrawerTitle').textContent = task ? 'Edit task' : 'New task';
  $('#clientTaskDrawerClientName').textContent = data.applications.find(item => item.id === hiredEditingId)?.clientName || '';
  $('#clientTaskTitle').value = task?.title || '';
  $('#clientTaskCategory').value = CLIENT_TASK_CATEGORIES.includes(task?.category) ? task.category : 'Graphic Design';
  $('#clientTaskPriority').value = ['Low', 'Medium', 'High'].includes(task?.priority) ? task.priority : 'Medium';
  $('#clientTaskDueDate').value = task?.dueDate || '';
  $('#clientTaskEstimate').value = task?.estimateMinutes ?? '';
  $('#clientTaskNotes').value = task?.notes || '';
  $('#clientTaskRepeat').value = task?.repeat?.frequency || 'none';
  $('#clientTaskWeekdays').querySelectorAll('input').forEach(input => {
    input.checked = Array.isArray(task?.repeat?.weekdays) && task.repeat.weekdays.includes(Number(input.value));
  });
  $('#clientTaskMonthDay').value = String(task?.repeat?.dayOfMonth || Number(task?.dueDate?.slice(-2)) || 1);
  $('#clientTaskTimeEditor').hidden = !task;
  $('#saveClientTaskButton').textContent = task ? 'Save changes' : 'Save task';
  updateClientTaskRepeatFields();
  renderClientTaskEntries();
  form.dataset.initialSnapshot = clientTaskFormSnapshot();
}

function openClientTaskDrawer(task = null, trigger = $('#newClientTaskButton')) {
  if (clientTaskDrawerOpen || (clientTaskIsEnded() && !task)) return;
  clientTaskDrawerReturnFocus = trigger;
  fillClientTaskDrawer(task);
  const layer = $('#clientTaskDrawerLayer');
  clearTimeout(clientTaskDrawerCloseTimer);
  clientTaskDrawerOpen = true;
  clientTaskDrawerClosing = false;
  layer.classList.remove('is-closing');
  layer.hidden = false;
  layer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('client-task-drawer-open');
  requestAnimationFrame(() => {
    if (!clientTaskDrawerOpen) return;
    layer.classList.add('is-open');
    $('#clientTaskTitle').focus();
  });
}

async function closeClientTaskDrawer() {
  if (!clientTaskDrawerOpen || clientTaskDrawerClosing) return;
  const form = $('#clientTaskForm');
  const isDirty = clientTaskFormSnapshot() !== form.dataset.initialSnapshot;
  if (isDirty && !(await appConfirm('Discard your unsaved task changes?', { title: 'Discard task changes', confirmLabel: 'Discard changes', danger: true }))) return;
  clientTaskDrawerOpen = false;
  clientTaskDrawerClosing = true;
  const layer = $('#clientTaskDrawerLayer');
  layer.classList.remove('is-open');
  layer.classList.add('is-closing');
  const finishClose = () => {
    layer.hidden = true;
    layer.classList.remove('is-closing');
    document.body.classList.remove('client-task-drawer-open');
    clientTaskDrawerClosing = false;
    clientTaskMenuOpenId = '';
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
  clientTaskMenuOpenId = '';
  renderClientTasks(hiredEditingId);
  openClientTaskDrawer(task, $('#newClientTaskButton'));
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
      if (weekdays.includes(candidate.getDay())) return clientTaskLocalDateKey(candidate);
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
  $('#newClientTaskButton').addEventListener('click', event => openClientTaskDrawer(null, event.currentTarget));
  $('#clientTaskDrawerBackdrop').addEventListener('click', closeClientTaskDrawer);
  $('#closeClientTaskDrawer').addEventListener('click', closeClientTaskDrawer);
  $('#cancelClientTaskDrawer').addEventListener('click', closeClientTaskDrawer);
  $('#clientTaskRepeat').addEventListener('change', updateClientTaskRepeatFields);
  $('#clientTaskWeekdays').addEventListener('change', updateClientTaskRepeatFields);
  $('#clientTaskMonthDay').addEventListener('change', updateClientTaskRepeatFields);
  ['input', 'change'].forEach(type => {
    $('#clientTaskForm').addEventListener(type, () => {
      $('#clientTaskForm').dataset.dirtySnapshot = clientTaskFormSnapshot();
    });
  });
  $('#clientTaskForm').addEventListener('submit', event => {
    event.preventDefault();
    if (clientTaskIsEnded() && !clientTaskEditingId) return;
    const title = $('#clientTaskTitle').value.trim();
    const repeat = clientTaskRepeatValue();
    const dueField = $('#clientTaskDueDate');
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
      id: existing?.id || uid(),
      clientId: hiredEditingId,
      title,
      category: $('#clientTaskCategory').value,
      priority: $('#clientTaskPriority').value,
      dueDate: dueField.value,
      estimateMinutes: $('#clientTaskEstimate').value ? Number($('#clientTaskEstimate').value) : '',
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
      layer.classList.remove('is-closing');
      document.body.classList.remove('client-task-drawer-open');
      clientTaskDrawerClosing = false;
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
    const newTaskButton = event.target.closest('[data-client-task-new]');
    if (newTaskButton) {
      if (clientTaskIsEnded()) return;
      openClientTaskDrawer(null, newTaskButton);
      return;
    }
    const menuButton = event.target.closest('[data-client-task-menu]');
    if (menuButton) {
      clientTaskMenuOpenId = clientTaskMenuOpenId === menuButton.dataset.clientTaskMenu ? '' : menuButton.dataset.clientTaskMenu;
      renderClientTasks(hiredEditingId);
      $(`[data-client-task-menu="${CSS.escape(clientTaskMenuOpenId)}"]`)?.focus();
      return;
    }
    const editButton = event.target.closest('[data-client-task-edit]');
    if (editButton) {
      openClientTaskEditor(editButton.dataset.clientTaskEdit);
      return;
    }
    const duplicateButton = event.target.closest('[data-client-task-duplicate]');
    if (duplicateButton) {
      if (clientTaskIsEnded()) return;
      const original = data.clientTasks.find(task => task.id === duplicateButton.dataset.clientTaskDuplicate && task.clientId === hiredEditingId);
      if (!original) return;
      const duplicate = { ...original, id: uid(), recurrenceSeriesId: '', recurrenceOccurrenceKey: '', generatedFromTaskId: '', status: 'todo', completedAt: '', timerStartedAt: '', timeEntries: [], createdAt: new Date().toISOString() };
      data.clientTasks.push(duplicate);
      saveClientTasks();
      clientTaskMenuOpenId = '';
      renderClientTasks(hiredEditingId);
      openClientTaskEditor(duplicate.id);
      return;
    }
    const deleteButton = event.target.closest('[data-client-task-delete]');
    if (deleteButton) {
      const task = data.clientTasks.find(item => item.id === deleteButton.dataset.clientTaskDelete && item.clientId === hiredEditingId);
      if (!task || !(await appConfirm(`Delete “${task.title}”?`, { title: 'Delete client task', confirmLabel: 'Delete task', danger: true }))) return;
      stopClientTaskTimer(task);
      data.clientTasks = data.clientTasks.filter(item => item.id !== task.id);
      saveClientTasks();
      clientTaskMenuOpenId = '';
      renderClientTasks(hiredEditingId);
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
    if (clientTaskMenuOpenId && !event.target.closest('.client-task-menu-wrap')) {
      clientTaskMenuOpenId = '';
      renderClientTasks(hiredEditingId);
    }
  });
}

initClientTaskDrawer();
startClientTaskTick();

})();
