(() => {
  'use strict';

  const STORAGE_KEY = 'client-compass-data-v1'; // Legacy key name retained only for migration detection; app data is no longer stored in localStorage.
  const SUPABASE_BUCKET = 'client-documents';
  const AUTH_PROVIDER_SESSION_KEY = 'jeff-va-auth-provider-v1';
  const emptyData = () => ({ applications: [], toApply: [], dailyTasks: [], emails: [], deletedGmailIds: [], alerts: [], emailTemplates: [], personalDocuments: [], invoices: [], scripts: [], workLinks: [], accountSignInHistory: [] });
  let supabaseClient = null;
  let currentUser = null;
  let activeAuthProvider = null;
  let appStateChannel = null;
  let gmailSyncTimer = null;
  let gmailSyncInFlight = false;
  let applyReminderTimer = null;
  let initializingUserId = null;
  let persistChain = Promise.resolve();
  let dataReady = false;
  let supabaseDataLoaded = false;
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

  function showActionResult({ title = 'Action complete', message = '', status = 'success', label = '', actionLabel = '', onAction = null } = {}) {
    const modal = $('#emailActionResultModal');
    if (!modal) {
      toast(message);
      return;
    }
    if (modal.open) {
      actionResultQueue.push({ title, message, status, label, actionLabel, onAction });
      return;
    }
    const isError = status === 'error';
    const isInfo = status === 'info';
    modal.dataset.status = isError ? 'error' : isInfo ? 'info' : 'success';
    $('#emailActionResultEyebrow').textContent = label || (isError ? 'ACTION FAILED' : isInfo ? 'NOTICE' : 'SUCCESS');
    $('#emailActionResultTitle').textContent = title;
    $('#emailActionResultMessage').textContent = message;
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
    $('#accountNavGroup').hidden = !hasAccountSettingsAccess();
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
    $('#accountLastSignIn').textContent = formatAccountTimestamp(currentUser.last_sign_in_at);
    $('#accountCreatedAt').textContent = formatAccountTimestamp(currentUser.created_at);
    $('#accountGmailAction').hidden = !gmailConfigured() || !window.google?.accounts?.oauth2 || !navigator.onLine;
    $('#accountGmailAction').textContent = gmailAccessToken
      ? gmailNeedsAttention ? 'Reconnect' : 'Disconnect'
      : sessionStorage.getItem(GMAIL_CONNECTED_KEY) ? 'Reconnect' : 'Connect Gmail';

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
  const APPLICATION_WEEK_FILTER_KEY = 'jeff-va-application-week-filter-v1';
  const EMAIL_WEEK_FILTER_KEY = 'jeff-va-email-week-filter-v1';
  let data = emptyData();
  let activeView = 'dashboard';
  let emailViewFilter = 'client';
  let applicationDateSort = localStorage.getItem(APPLICATION_WEEK_FILTER_KEY) || '0';
  let hiredDateSort = 'newest';
  let emailDateSort = localStorage.getItem(EMAIL_WEEK_FILTER_KEY) || '0';
  let applicationDateFilter = '';
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
      supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          storage: window.sessionStorage,
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
      emails: dedupeEmails(Array.isArray(saved.emails) ? saved.emails : []).filter(item => !(item.source === 'gmail' && deletedGmailIdSet.has(item.gmailId))),
      deletedGmailIds,
      accountSignInHistory: Array.isArray(saved.accountSignInHistory) ? saved.accountSignInHistory : [],
      alerts: Array.isArray(saved.alerts) ? saved.alerts : [],
      emailTemplates: Array.isArray(saved.emailTemplates) ? saved.emailTemplates : [],
      personalDocuments: Array.isArray(saved.personalDocuments) ? saved.personalDocuments : [],
      invoices: Array.isArray(saved.invoices) ? saved.invoices : [],
      scripts: Array.isArray(saved.scripts) ? saved.scripts : [],
      workLinks: Array.isArray(saved.workLinks) ? saved.workLinks : []
    };
  }

  function persist() {
    if (!currentUser || !supabaseClient || !dataReady || !supabaseDataLoaded) return Promise.resolve();
    const snapshot = JSON.parse(JSON.stringify(data));
    const userId = currentUser.id;
    const client = supabaseClient;
    persistChain = persistChain.then(async () => {
      if (!client || !userId) return;
      const { error } = await client.from('app_state').upsert({
        user_id: userId,
        data: snapshot,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
      if (error) {
        console.error('Supabase save failed:', error);
        showActionResult({ title: 'Cloud save failed', message: 'Your change could not be saved to your account. Check your connection and try again.', status: 'error' });
        throw error;
      }
    }).catch(() => {});
    // Keep the local Documents Excel copy current too. The function debounces
    // rapid edits, so this does not create a file for every keystroke.
    queueDocumentsBackup({ immediate: true });
    return persistChain;
  }

  async function initializeSupabaseForUser(user, { showSuccess = true, recordSignIn = false, showOverview = false } = {}) {
    if (!user || initializingUserId === user.id) return;
    initializingUserId = user.id;
    currentUser = user;
    renderAccountAccess();
    dataReady = false;
    supabaseDataLoaded = false;
    setAuthenticated(true);
    if (showOverview) showView('dashboard');
    subscribeToAppState(user.id);
    if (!applyReminderTimer) applyReminderTimer = setInterval(() => {
      if (!currentUser) return;
      processDueApplyReminders();
      processDueInterviews();
      processDueDocumentEmailReminders();
      processContractEndedAlerts();
    }, 60000);
    const loginStatus = $('#loginGoogleStatus');
    if (loginStatus) loginStatus.textContent = 'Signed in successfully. Loading your dashboard…';
    try {
      data = await loadDataFromSupabase();
      if (recordSignIn) recordAccountSignIn(user, activeAuthProvider);
      supabaseDataLoaded = true;
      dataReady = true;
      await processDueFollowUps();
      processDueApplyReminders();
      processDueInterviews();
      processDueDocumentEmailReminders();
      processContractEndedAlerts();
      renderAll();
      renderAccountPage();
      if (gmailAccessToken) await syncGmail(true);
      await persist();
      scheduleAutomaticBackup();
      if (showSuccess) showActionResult({ title: 'Signed in successfully', message: 'Your workspace is ready.' });
    } catch (error) {
      console.error(error);
      data = emptyData();
      supabaseDataLoaded = false;
      showActionResult({ title: 'Could not load workspace', message: 'Your account data could not be loaded. Check your connection and try again.', status: 'error' });
      dataReady = true;
      renderAll();
      renderAccountPage();
    } finally {
      initializingUserId = null;
    }
  }

  function subscribeToAppState(userId) {
    if (!supabaseClient || !userId) return;
    if (appStateChannel) supabaseClient.removeChannel(appStateChannel);
    appStateChannel = supabaseClient.channel(`app-state-${userId}`).on('postgres_changes', {
      event: '*', schema: 'public', table: 'app_state', filter: `user_id=eq.${userId}`
    }, async () => {
      if (!dataReady || !currentUser || currentUser.id !== userId) return;
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
        }
        const isFreshSignIn = event === 'SIGNED_IN' && !isPasswordRecovery;
        initializeSupabaseForUser(session.user, {
          showSuccess: isAuthenticationCallback && !isPasswordRecovery || activeAuthProvider === 'email',
          recordSignIn: isFreshSignIn,
          showOverview: isFreshSignIn
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
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date) ? value : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  }

  function relativeDate(value) {
    if (!value) return 'No date';
    const date = new Date(value);
    if (Number.isNaN(date)) return value;
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  }

  function emailDate(value) {
    if (!value) return 'No date';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
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

  function sortedPipelineApplications() {
    return sortByDate(pipelineApplications(), item => item.appliedDate || applicationAddedDate(item));
  }


  // --- Client email matching ---
  // Compares each imported/synced email's "From" header, subject and body against the name,
  // company, email, and role/service saved on an application, so the match is only counted when
  // several signals line up rather than a single loose one. Matching runs in stages:
  //   1) Email address must be an EXACT match to the address saved on the application (a header can
  //      no longer just "contain" it). This alone used to let one shared address (a job board or
  //      agency inbox that emails many different applicants) falsely tag every application that had
  //      that address saved, even the ones that never actually got a reply.
  //   2) If that exact address is saved on more than one application, the address alone is no longer
  //      proof of which one replied — the company/client name or the role/service you entered must
  //      also appear in the sender name, subject, or body before it counts for a specific application.
  //   3) If there's no saved email to match against (or the sender's address doesn't match), we fall
  //      back to the sender's display name — but only as a whole word (so "Jan" can't match inside
  //      "Jandro"), and only when the subject/body also reference the company name or the role, so a
  //      name that merely resembles the sender, with no other context, is no longer enough on its own.
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

  function escapeForRegExp(value) {
    return (value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function containsWholeWord(haystack, needle) {
    if (!needle) return false;
    return new RegExp(`\\b${escapeForRegExp(needle)}\\b`, 'i').test(haystack || '');
  }

  function isDirectClientApplication(application) {
    const platform = String(application.platform || '').trim().toLowerCase();
    return platform === 'direct client' || platform === 'direct apply';
  }

  function emailHasApplicationUpdateSignal(emailItem) {
    const source = `${emailItem.subject || ''} ${emailItem.body || ''}`.toLowerCase();
    if (!source.trim()) return false;
    const submissionReceipt = [
      /\bapplication(?: form)?\s+(?:(?:has|was)\s+)?(?:been\s+)?(?:successfully\s+)?submitted\b/,
      /\b(?:successfully\s+)?submitted\s+(?:your|the|an?)\s+application(?: form)?\b/,
      /\b(?:we(?:'ve| have)?\s+)?received\s+your\s+application\b/,
      /\bapplication(?: form)?\s+(?:has been\s+|was\s+)?received\b/,
      /\bapplication submission\s+(?:was\s+)?(?:successful|received|confirmed)\b/
    ].some(pattern => pattern.test(source));
    const actionableSignals = [
      /\b(interview|screening|phone call|video call|meeting|recruiter call)\b/,
      /\b(next steps?|proceed|moving forward|move forward|shortlist(?:ed)?|offer|assessment|test task|assignment)\b/,
      /\b(schedule(?:d)?|availability|available for|time slot|calendar invite|proposed time|set up (?:a|an) (?:call|meeting|interview)|confirm (?:a|the) time)\b/,
      /\b(additional information|more information|questions?|follow[- ]?up)\b/
    ];
    if (submissionReceipt && !actionableSignals.some(pattern => pattern.test(source))) return false;
    const strongSignals = [
      /application\s+(status|update|review|progress|decision|process)/,
      /status\s+update/,
      ...actionableSignals
    ];
    return strongSignals.some(pattern => pattern.test(source));
  }

  function matchApplicationsForEmail(emailItem) {
    const fromAddress = extractEmailAddress(emailItem.from);
    const senderName = extractSenderName(emailItem.from);
    const directClientMatches = data.applications.filter(app => {
      if (!isDirectClientApplication(app)) return false;
      const emailCandidate = (app.email || '').trim().toLowerCase();
      const clientName = (app.clientName || '').trim().toLowerCase();
      const contact = (app.contact || '').trim().toLowerCase();

      if (fromAddress && emailCandidate && emailCandidate === fromAddress) return true;
      const nameCandidates = [contact, clientName].filter(name => name.length >= 3);
      return nameCandidates.some(name => containsWholeWord(senderName, name));
    });
    if (directClientMatches.length) return directClientMatches;

    if (!emailHasApplicationUpdateSignal(emailItem)) return [];

    const contentLower = `${emailItem.subject || ''} ${emailItem.body || ''}`.toLowerCase();

    // Every application that has this exact address saved — used below to detect a shared/generic
    // inbox (job board, staffing agency, etc.) that more than one application was given.
    const exactEmailOwnerCount = fromAddress
      ? data.applications.filter(app => (app.email || '').trim().toLowerCase() === fromAddress).length
      : 0;

    return data.applications.filter(app => {
      const emailCandidate = (app.email || '').trim().toLowerCase();
      const clientName = (app.clientName || '').trim().toLowerCase();
      const contact = (app.contact || '').trim().toLowerCase();
      const role = (app.role || '').trim().toLowerCase();
      const clientNameReferenced = clientName.length >= 3 && (senderName.includes(clientName) || contentLower.includes(clientName));
      const roleReferenced = role.length >= 3 && contentLower.includes(role);

      // Step 1 — is the email address correct?
      const emailIsExact = Boolean(emailCandidate) && emailCandidate === fromAddress;
      if (emailIsExact) {
        // Shared address — step 2 (company/client) or step 3 (role/service) must also match.
        return (exactEmailOwnerCount <= 1) ? true : (clientNameReferenced || roleReferenced);
      }

      // No saved email matched this sender — fall back to the display name, but only as a whole
      // word, and only with subject/body context confirming the company or the role.
      const nameCandidates = [contact, clientName].filter(name => name.length >= 3);
      const senderNameMatches = nameCandidates.some(name => containsWholeWord(senderName, name));
      if (!senderNameMatches) return false;
      return clientNameReferenced || roleReferenced;
    });
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

  function matchingEmailsForApplication(app) {
    return data.emails.filter(emailItem => matchApplicationsForEmail(emailItem).some(match => match.id === app.id));
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
    const matches = matchingEmailsForApplication(app).filter(emailItem => emailItem.direction !== 'sent' && emailItem.source !== 'sent');
    if (!matches.length) return '';
    return ` <button class="match-badge" type="button" data-application-emails="${escapeHtml(app.id)}" aria-label="View ${plural(matches.length, 'matching email')} for ${escapeHtml(app.clientName)}" title="View matching application emails"><i class="fa-regular fa-envelope" aria-hidden="true"></i> ${plural(matches.length, 'email')}</button>`;
  }

  function renderDashboard() {
    const applications = data.applications;
    const pipelineCount = pipelineApplications().length;
    const active = applications.filter(item => item.status === 'Active client').length;
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
    return `<option value="all">All weeks</option><option value="0">This week</option>${options}`;
  }

  function renderApplications() {
    const query = $('#applicationSearch').value.trim().toLowerCase();
    const status = $('#statusFilter').value;
    const platform = $('#platformFilter').value;
    const dateFilter = $('#applicationDateFilter').value;
    updatePlatformFilter();
    const weekOffset = Number(applicationDateSort);
    const weekRangeFilter = applicationDateSort === 'all' ? null : weekRange(weekOffset);
    $('#applicationWeekDate').textContent = applicationDateSort === 'all' ? 'All weeks' : weeklyRangeLabel(weekRangeFilter).replace(' – ', ' to ');
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
      const weekMatches = alwaysVisibleStatus || applicationDateSort === 'all' || isInWeeklyRange(applicationAddedDate(item), weekRangeFilter);
      return (!query || text.includes(query)) && statusMatches && (!platform || item.platform === platform) && dateMatches && weekMatches;
    });
    $('#applicationListLabel').textContent = `${plural(filtered.length, 'application')}${filtered.length !== pipeline.length ? ` of ${pipeline.length}` : ''}`;
    const target = $('#applicationList');
    if (!filtered.length) {
      const isFiltered = pipeline.length > 0;
      target.innerHTML = `<div class="application-empty"><h3>${isFiltered ? 'No matching applications' : 'Start your client pipeline'}</h3><p>${isFiltered ? 'Try a different search or filter.' : 'Track each application, where you applied, and the next step all in one private workspace.'}</p>${isFiltered ? '' : '<button class="button button-primary" type="button" data-open-add>+ Add your first client</button>'}</div>`;
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
    const emails = data.emails
      .filter(item => [item.from, item.to, item.subject, item.body, item.date].join(' ').toLowerCase().includes(query))
      .filter(item => !emailDateFilter || dateKey(item.date) === emailDateFilter)
      .filter(item => emailDateSort === 'all' || isInWeeklyRange(item.date, weekRangeFilter))
      .filter(item => applicationsRelatedToEmail(item).length > 0);
    const clientEmails = emails.filter(item => item.direction !== 'sent' && item.source !== 'sent');
    const sentEmails = emails.filter(item => item.direction === 'sent');
    const visibleEmails = sortByDate(emailViewFilter === 'sent' ? sentEmails : clientEmails, item => item.date);
    $('#emailCountLabel').textContent = `${plural(visibleEmails.length, 'email')}${query ? ' shown' : ''}`;
    $$('.email-view-tab').forEach(tab => {
      const selected = tab.dataset.emailView === emailViewFilter;
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-selected', String(selected));
    });
    const target = $('#emailList');
    const sectionClass = `email-section${emailViewFilter === 'sent' ? ' email-section-sent' : ''}`;
    const sectionLabel = emailViewFilter === 'sent' ? 'Your sent messages' : 'Messages from clients';
    const sectionEyebrow = emailViewFilter === 'sent' ? 'SENT BY YOU' : 'CLIENT EMAILS';
    const sectionHeading = `<div class="email-section-heading"><div><p class="eyebrow">${sectionEyebrow}</p><h3>${sectionLabel}</h3></div></div>`;
    const listHead = `<div class="email-list-head"><span aria-hidden="true"></span><span>Subject / sender</span><span>${emailViewFilter === 'sent' ? 'Sent' : 'Received'}</span><span>Actions</span></div>`;
    if (!visibleEmails.length) {
      const allReceivedEmails = receivedEmails();
      const hasRelevantReceivedEmails = allReceivedEmails.some(item => applicationsRelatedToEmail(item).length > 0);
      const hasFilters = Boolean(query || emailDateFilter || emailDateSort !== 'all');
      const title = emailViewFilter === 'sent'
        ? (hasFilters ? 'No matching sent emails' : 'No application-linked sent emails yet')
        : hasFilters
          ? 'No matching client emails'
          : allReceivedEmails.length && !hasRelevantReceivedEmails
            ? 'No relevant client updates yet'
            : hasRelevantReceivedEmails
              ? 'No matching client emails'
              : 'No client emails yet';
      const copy = hasFilters
        ? 'Try another search term or date range.'
        : emailViewFilter === 'sent'
          ? 'Sent messages linked to an application or saved client will appear here.'
          : allReceivedEmails.length && !hasRelevantReceivedEmails
            ? 'Messages appear here when the sender and email details match an application or client update.'
            : 'Relevant client messages received through Gmail will appear here.';
      target.innerHTML = `<section class="${sectionClass}">${sectionHeading}${listHead}<div class="email-empty"><h3>${title}</h3><p>${copy}</p></div></section>`;
      return;
    }
    const renderEmailRows = items => items.map(item => {
      const initial = (item.from || '?').trim().charAt(0).toUpperCase();
      const matches = applicationsRelatedToEmail(item);
      const matchTag = matches.length ? `<span class="client-match-tag">✉ ${escapeHtml(matches.map(app => `${app.clientName} · Applied ${emailDate(app.appliedDate)}`).join(', '))}</span>` : '';
      const recipient = extractEmailAddress(item.from);
      const canCompose = matches.length && isEmailAddress(recipient);
      const sentClass = item.direction === 'sent' ? ' sent' : '';
      const sentBadge = item.direction === 'sent' ? '<span class="sent-email-badge">SENT</span>' : '';
      const dateLabel = item.direction === 'sent' ? 'Sent' : 'Received';
      return `<article class="email-row${sentClass}" data-email-detail="${escapeHtml(item.id)}"><span class="email-avatar">${escapeHtml(initial)}</span><div><h3 class="email-subject" title="${escapeHtml(item.subject)}">${escapeHtml(item.subject || '(No subject)')} ${sentBadge}</h3><p class="email-from">${escapeHtml(item.from || 'Unknown sender')}</p>${matchTag}</div><time class="email-date"><span>${dateLabel}</span>${emailDate(item.date)}</time><div class="email-row-actions"><div class="email-action-menu"><button class="email-actions-trigger" type="button" data-email-action-trigger="${escapeHtml(item.id)}" aria-haspopup="true" aria-expanded="false">Actions</button><div class="email-actions-menu hidden" data-email-actions-menu="${escapeHtml(item.id)}" role="menu">${canCompose ? `<button type="button" role="menuitem" data-email-action="compose" data-email-id="${escapeHtml(item.id)}">Send email</button>` : ''}<button type="button" role="menuitem" class="email-action-delete" data-email-action="delete" data-email-id="${escapeHtml(item.id)}">Delete email</button></div></div></div></article>`;
    }).join('');
    target.innerHTML = `<section class="${sectionClass}">${sectionHeading}${listHead}${renderEmailRows(visibleEmails)}</section>`;
  }

  function hiredClients() {
    return sortedApplications().filter(item => item.status === 'Active client' && !item.activePendingDocument && !item.activePendingEmail);
  }

  function normalizeUrl(value) {
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  }

  function formatFileSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function isContractEnded(item) {
    return Boolean(item.contractEndDate && dateKey(item.contractEndDate) < today());
  }

  function renderHired() {
    const query = $('#hiredSearch').value.trim().toLowerCase();
    const filter = $('#hiredStatusFilter')?.value || 'all';
    const dateFilter = $('#hiredDateFilter').value;
    const allHired = sortByDate(hiredClients(), activeSinceDate, hiredDateSort);
    const clients = allHired.filter(item => {
      const contractStatus = isContractEnded(item) ? 'Contract Ended' : (item.contractStatus || 'Active');
      const text = [item.clientName, item.email, item.phone, item.website, item.socialMedia, item.location, contractStatus].join(' ').toLowerCase();
      const statusMatch = filter === 'all' || contractStatus === filter;
      return statusMatch && (!query || text.includes(query)) && (!dateFilter || dateKey(activeSinceDate(item)) === dateFilter);
    });
    $('#hiredCountLabel').textContent = `${plural(clients.length, 'client')}${clients.length !== allHired.length ? ` of ${allHired.length}` : ''}`;
    const target = $('#hiredList');
    const detailPanel = $('#hiredDetailPanel');
    const hiredView = $('#hiredView');

    // Once a client is selected, keep the workspace focused on that one client.
    const selected = hiredEditingId ? clients.find(item => item.id === hiredEditingId) : null;
    if (selected) {
      hiredView.classList.add('client-focused');
      target.innerHTML = '';
      detailPanel.classList.remove('hidden');
      renderHiredDetail(selected, false);
      return;
    }
    hiredView.classList.remove('client-focused');

    if (!clients.length) {
      const hasAny = allHired.length > 0;
      target.innerHTML = `<div class="application-empty"><h3>${hasAny ? 'No matching clients' : 'No active clients yet'}</h3><p>${hasAny ? 'Try another search or contract status.' : 'Mark an application as “Active client” in your tracker and it will appear here.'}</p>${hasAny ? '' : '<button class="button button-primary" type="button" data-go-to="applications">Go to applications</button>'}</div>`;
      closeHiredDetail(false);
      return;
    }
    target.innerHTML = clients.map(item => {
      const docs = item.documents || [];
      const contractEnded = isContractEnded(item);
      const contractStatus = contractEnded ? 'Contract Ended' : (item.contractStatus || 'Active');
      const statusClass = contractEnded ? 'contract-ended' : (contractStatus === 'Not active' ? 'not-active' : 'contract-active');
      return `<article class="hired-card${contractEnded ? ' contract-ended-card' : ''}" data-hired-select="${escapeHtml(item.id)}" tabindex="0" role="button">
        <span class="hired-card-head"><span><strong class="client-card-title">${escapeHtml(item.clientName)}</strong><span class="client-card-subtitle">${escapeHtml(item.role || 'No role added')}</span></span><span class="hired-card-arrow" aria-hidden="true">→</span></span>
        <span class="client-contract-status ${statusClass}">${escapeHtml(contractStatus)}${item.contractEndDate ? ` · ends ${escapeHtml(formatDate(item.contractEndDate))}` : ''}</span>
        ${matchBadge(item) ? `<span>${matchBadge(item)}</span>` : ''}
        <span class="hired-card-meta">${item.email ? escapeHtml(item.email) : 'No email added'} · ${escapeHtml(item.employmentType || 'Employment type not set')} · Active since ${emailDate(activeSinceDate(item))} · Added ${emailDate(applicationAddedDate(item))}${docs.length ? ` · ${plural(docs.length, 'file')}` : ''}</span>
        ${item.website ? `<span class="hired-card-website"><a href="${escapeHtml(normalizeUrl(item.website))}" target="_blank" rel="noopener">${escapeHtml(item.website)}</a></span>` : ''}
        <span class="view-details-label">View details →</span>
      </article>`;
    }).join('');
    detailPanel.classList.add('hidden');
  }

  function renderHiredDetail(item, scroll = true) {
    if (!item) return;
    hiredEditingId = item.id;
    $('#hiredView').classList.add('client-focused');
    $('#hiredList').innerHTML = '';
    $('#hiredDetailPanel').classList.remove('hidden');
    const contractEnded = isContractEnded(item);
    const salaryLabel = item.salaryType === 'monthly' && Number(item.salaryAmount) > 0
      ? `$${Number(item.salaryAmount).toLocaleString()} / month`
      : item.salaryType === 'hourly' && Number(item.salaryAmount) > 0 && Number(item.hoursPerWeek) > 0
        ? `$${Math.round(Number(item.salaryAmount) * Number(item.hoursPerWeek) * 4).toLocaleString()} / month`
        : item.salaryType === 'hourly' && Number(item.salaryAmount) > 0
          ? `$${Number(item.salaryAmount).toLocaleString()} / hour`
          : 'Salary not set';
    $('#hiredDetailTitle').innerHTML = `${escapeHtml(contractEnded ? `${item.clientName} | Contract Ended` : item.clientName)} <span class="hired-detail-salary">${escapeHtml(salaryLabel)}</span>`;
    $('#hiredDetailSubtitle').textContent = item.role || 'Active client';
    const contractStatus = contractEnded ? 'Contract Ended' : (item.contractStatus || 'Active');
    $('#hiredDetailGrid').innerHTML = `
      <div><dt>Contact</dt><dd>${item.contact ? escapeHtml(item.contact) : '—'}</dd></div>
      <div><dt>Application</dt><dd><span class="status-pill active-client">Active client</span></dd></div>
      <div><dt>Contract status</dt><dd><span class="status-pill ${contractEnded ? 'contract-ended' : (contractStatus === 'Not active' ? 'not-active' : 'contract-active')}" >${escapeHtml(contractStatus)}</span></dd></div>
      ${contractEnded ? `<div><dt>Contract Ended Email Sent</dt><dd><span class="status-pill ${item.contractEndedEmailSentAt ? 'contract-active' : 'not-active'}">${item.contractEndedEmailSentAt ? 'Done' : 'Not sent'}</span></dd></div>` : ''}
      <div><dt>Contract end</dt><dd>${item.contractEndDate ? escapeHtml(formatDate(item.contractEndDate)) : 'No end date'}</dd></div>
      <div><dt>Email</dt><dd>${item.email ? `<a href="mailto:${escapeHtml(item.email)}">${escapeHtml(item.email)}</a>` : '—'}</dd></div>
      <div><dt>Phone</dt><dd>${item.phone ? escapeHtml(item.phone) : '—'}</dd></div>
      <div><dt>Website</dt><dd>${item.website ? `<a href="${escapeHtml(normalizeUrl(item.website))}" target="_blank" rel="noopener">${escapeHtml(item.website)}</a>` : '—'}</dd></div>
      <div><dt>Social</dt><dd>${item.socialMedia ? escapeHtml(item.socialMedia) : '—'}</dd></div>
      <div><dt>Location</dt><dd>${item.location ? escapeHtml(item.location) : '—'}</dd></div>
      <div><dt>Platform</dt><dd>${item.platform ? escapeHtml(item.platform) : '—'}</dd></div>
      <div><dt>Employment type</dt><dd>${item.employmentType ? escapeHtml(item.employmentType) : '—'}</dd></div>
      <div><dt>Applied</dt><dd>${escapeHtml(emailDate(item.appliedDate))}</dd></div>
      <div><dt>Added</dt><dd>${escapeHtml(emailDate(applicationAddedDate(item)))}</dd></div>
      <div><dt>Active since</dt><dd>${escapeHtml(emailDate(activeSinceDate(item)))}</dd></div>
      <div class="hired-detail-wide"><dt>Notes</dt><dd class="hired-notes">${item.notes ? escapeHtml(item.notes) : '—'}</dd></div>
      <div class="hired-detail-wide hired-client-actions">
        <div class="hired-actions-menu">
          <button class="button button-secondary hired-actions-trigger" type="button" id="activeClientActionsButton" aria-haspopup="true" aria-expanded="false">Actions</button>
          <div class="document-menu hired-actions-dropdown hidden">
            <button type="button" id="sendActiveClientEmailButton">Send email</button>
            <button type="button" id="editActiveClientButton">Edit details</button>
          </div>
        </div>
      </div>`;
    const invoiceRows = (data.invoices || []).filter(invoice => invoice.clientId === item.id).sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
    $('#hiredUploadSection').innerHTML = `
      <div class="active-client-two-column">
        <section class="invoice-send-panel${contractEnded ? ' contract-ended-readonly' : ''}">
          <div class="invoice-send-heading"><div><p class="eyebrow">BILLING</p><h3>Send invoice</h3></div><span class="invoice-sent-count" aria-label="${plural(invoiceRows.length, 'invoice')} sent">${plural(invoiceRows.length, 'invoice')} sent</span></div>
          <p>${contractEnded ? 'Invoice sending is unavailable while this contract is ended.' : 'Upload an invoice, check the detected invoice number, and send it through Gmail.'}</p>
          ${contractEnded ? '' : '<button class="button button-primary" type="button" id="sendInvoiceButton">+ Upload and send invoice</button>'}
          <div class="client-invoice-history">
            <p class="eyebrow">SENT INVOICES</p>
            <div class="client-invoice-list">${invoiceRows.length ? invoiceRows.map(invoice => `<div class="client-invoice-item"><strong>${escapeHtml(invoice.invoiceNumber)}</strong><span>${escapeHtml(invoice.fileName)}</span><small>${emailDate(invoice.sentAt)} · ${escapeHtml(invoice.service || 'Invoice')}</small></div>`).join('') : '<p class="client-invoice-empty">No invoices sent yet.</p>'}</div>
          </div>
        </section>
        <section class="active-document-box${contractEnded ? ' contract-ended-readonly' : ''}">
          <div class="active-document-box-head"><div><p class="eyebrow">CLIENT FILES</p><h3>Documents</h3></div>${contractEnded ? '<span class="details-readonly-label">Read only</span>' : '<div><button class="button button-secondary active-document-upload-button" type="button" id="hiredDetailUploadButton">+ Upload file</button><input id="hiredDetailDocumentInput" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden /></div>'}</div>
          <div id="hiredDocumentWorkspace"></div>
        </section>
      </div>
      ${renderHiredEmailHistory(item)}
      <div class="documents-folder-status" id="documentsFolderStatus" aria-live="polite">Files are stored securely in your account.</div>`;
    renderHiredDocumentWorkspace(item);
    if (scroll) $('#hiredDetailPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeHiredDetail(render = true) {
    hiredEditingId = null;
    $('#hiredView').classList.remove('client-focused');
    $('#hiredDetailPanel').classList.add('hidden');
    if (render) renderHired();
  }

  function updateWeekNavigationCounts() {
    const applicationRange = applicationDateSort === 'all' ? null : weekRange(Number(applicationDateSort));
    const emailRange = emailDateSort === 'all' ? null : weekRange(Number(emailDateSort));
    const relevantReceivedEmails = receivedEmails().filter(item => matchApplicationsForEmail(item).length > 0);
    $('#navApplicationCount').textContent = applicationDateSort === 'all'
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

  function renderAll() {
    processContractEndedAlerts();
    renderDashboard();
    renderApplications();
    renderToApplyList();
    renderDailyTasks();
    renderHired();
    renderEmails();
    renderScripts();
    renderWorkLinks();
    renderPersonalDocuments();
    renderInvoiceList();
    updateWeekNavigationCounts();
    $('#navToApplyCount').textContent = (data.toApply || []).filter(item => item.dueDate === today()).length;
    updateToApplyAttention();
    $('#navHiredCount').textContent = hiredClients().length;
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
    if (updateUrl && window.location.hash !== `#${view}`) {
      window.history.pushState({ view }, '', `${window.location.pathname}${window.location.search}#${view}`);
    }
    activeView = view;
    if (view === 'applications') {
      renderApplications();
    }
    if (view === 'daily-task') renderDailyTasks();
    if (view === 'account') {
      renderPasswordPage();
      renderAccountPage();
    }
    const labels = { dashboard: ['YOUR PIPELINE', 'Client overview'], 'daily-task': ['', 'Daily Task'], applications: ['', 'Applications'], 'to-apply': ['', 'To Apply'], hired: ['', 'Active Clients'], inbox: ['', 'Email'], documents: ['PRIVATE TOOLS', 'Tools'], account: ['', 'Account'] };
    $('#pageEyebrow').textContent = labels[view][0];
    $('#pageTitle').textContent = labels[view][1];
    $('#pageEyebrow').hidden = !labels[view][0];
    $('#pageTitle').hidden = false;
    $('#applicationWeekDate').hidden = view !== 'applications';
    $('#emailWeekDate').hidden = view !== 'inbox';
    if (view === 'inbox') {
      renderEmails();
    }
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

  function openClientModal(id = null, viewOnly = false, activeClientOnly = false) {
    const form = $('#clientForm');
    form.reset();
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
    $('#clientModal').showModal();
    updateClientActionLabel();
    setTimeout(() => $('#clientName').focus(), 30);
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
      ? `<div class="client-follow-up-history-list">${historicalFollowUp.map(email => `<div><span>${escapeHtml(email.subject || 'Follow-up')}</span><small>${escapeHtml(emailDate(email.date))}</small></div>`).join('')}</div>`
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
      ? sentEmails.map(email => `<button type="button" class="client-email-history-item" data-email-detail="${escapeHtml(email.id)}"><span><strong>${escapeHtml(email.subject || '(No subject)')}</strong><small>${escapeHtml(emailContentText(email.body).slice(0, 150) || 'No message preview')}</small></span><time>${escapeHtml(emailDate(email.date))}</time></button>`).join('')
      : `<p>${emptyMessage}</p>`;
  }

  function renderHiredEmailHistory(item) {
    const sentEmails = sentEmailsForApplication(item);
    return `<section class="client-email-history hired-email-history" aria-live="polite">
      <div class="client-email-history-head"><div><p class="eyebrow">EMAIL HISTORY</p><h3>Sent to this client</h3></div><strong>${plural(sentEmails.length, 'email')}</strong></div>
      <div class="client-email-history-list">${renderSentEmailHistoryItems(sentEmails, 'No emails have been sent to this client.')}</div>
    </section>`;
  }

  function updateClientActionLabel() {
    const button = $('#saveClientButton');
    if (!button) return;
    const activeClient = $('#clientStatus').value === 'Active client';
    button.textContent = activeClient ? 'Next' : (editingId ? 'Save changes' : 'Save application');
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
    $('#sendEmailMenuButton').hidden = viewingClientDetails;
    $('#sendClientEmailButton').hidden = false;
    $('#sendEmailMenu').classList.add('hidden');
    $('#sendEmailMenuButton').setAttribute('aria-expanded', 'false');
    $('#nextStepField').classList.toggle('hidden', $('#clientStatus').value !== 'To Proceed');
    $('#sendProceedEmailButton').hidden = viewingClientDetails || $('#clientStatus').value !== 'To Proceed';
  }

  async function saveClient(event) {
    const submitter = event.submitter;
    if (submitter?.value === 'cancel') return;
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
      if (existing) application.documents = existing.documents;
      const index = data.applications.findIndex(item => item.id === editingId);
      if (index >= 0) data.applications[index] = application;
    } else {
      data.applications.push(application);
    }
    persist();
    $('#clientModal').close();
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
    if (!(await appConfirm(`Delete ${item.clientName}? This removes the application and any attached documents from this browser. This cannot be undone unless you've exported a backup.`, { title: 'Delete client application', confirmLabel: 'Delete', danger: true }))) return;
    data.applications = data.applications.filter(application => application.id !== id);
    persist();
    (item.documents || []).forEach(doc => { deleteDocumentBlob(doc.storagePath || doc.id).catch(() => {}); });
    $('#clientModal')?.close();
    editingId = null;
    if (fromActive) closeHiredDetail(false);
    renderAll();
    showActionResult({ title: 'Client deleted', message: 'The client and its attached documents were removed.' });
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
      <article class="script-item">
        <div class="script-item-head"><div><h3>${escapeHtml(script.title)}</h3><small>Updated ${emailDate(script.updatedAt || script.createdAt)}</small></div><div class="script-item-actions"><button class="button button-secondary" type="button" data-script-view="${escapeHtml(script.id)}">View</button><button class="button button-secondary" type="button" data-script-edit="${escapeHtml(script.id)}">Edit</button><button class="icon-button" type="button" data-script-delete="${escapeHtml(script.id)}" aria-label="Delete ${escapeHtml(script.title)}" title="Delete script">×</button></div></div>
        <pre class="script-content hidden" data-script-content="${escapeHtml(script.id)}">${escapeHtml(script.content)}</pre>
      </article>`).join('') : '<div class="application-empty"><h3>No scripts yet</h3><p>Add a reusable script for outreach, follow-ups, or client communication.</p></div>';
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

    const preview = unique.slice(0, 3).map(({ emailItem, app }) => `${app.clientName}: ${emailItem.subject || '(No subject)'}`).join('\n');
    const extra = unique.length > 3 ? `\n+${unique.length - 3} more matching emails` : '';

    data.alerts = data.alerts || [];
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
      message: `${plural(unique.length, 'new email')} matched to your applications.\n${preview}${extra}`,
      status: 'info',
      label: 'CLIENT EMAIL ALERT',
      actionLabel: 'Open inbox',
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
            <span class="notification-item-dot"></span>
            <span class="notification-item-copy"><strong>${escapeHtml(alert.clientName)}</strong><span>${escapeHtml(alert.subject)}</span><small>${escapeHtml(alert.from)} · ${relativeDate(alert.date)}</small></span>
          </button>
        `).join('')}
      </div>
    `).join('');
  }

  function updateTabNotification(unread) {
    const favicon = $('#tabFavicon');
    if (!favicon) return;
    const baseTitle = 'Jeff VA';
    document.title = unread ? `(${unread > 9 ? '9+' : unread}) ${baseTitle}` : baseTitle;
    if (!unread) {
      favicon.href = 'image/tab.png';
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
      alert.from = 'Reconnect Gmail to retry';
      alert.emailSent = false;
      persist();
      renderAlerts();
      if (!previousFailureWasReported) {
        showActionResult({ title: 'Contract email could not be sent', message: 'Reconnect Gmail and review the client alert before retrying.', status: 'error' });
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
      if (alert && !item.contractEndedEmailSentAt) sendContractEndedEmail(item, alert);
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
      const alertId = `follow-up|${item.id}|${item.followUpDate}`;
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
    renderAlerts();
    if (followUpAlertsAdded || automaticEmailsSent) {
      const summary = [
        automaticEmailsSent ? `${plural(automaticEmailsSent, 'automatic follow-up email')} sent` : '',
        automaticEmailsFailed ? `${plural(automaticEmailsFailed, 'automatic follow-up email')} could not be sent; reconnect Gmail and review the alert` : '',
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
  let sentHistoryAddressSignature = '';
  const GMAIL_CONNECTED_KEY = 'jeff-va-gmail-connected-v1';
  const GMAIL_TOKEN_SESSION_KEY = 'jeff-va-gmail-token-session-v1';

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

  function openPlainClientEmailComposer(application) {
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
    $('#emailComposeModal').showModal();
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
      const activatingClient = composeActivationClientId && data.applications.find(item => item.id === composeActivationClientId);
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
      persist();
      renderAll();
      if ($('#clientModal').open && sentEmailRecord.applicationId === editingId) {
        const application = data.applications.find(item => item.id === editingId);
        if (application) renderClientEmailHistory(application);
      }
      $('#emailComposeModal').close();
      let successMessage = 'Email sent successfully through Gmail.';
      if (activatingClient) {
        showView('hired');
        renderHiredDetail(activatingClient);
        successMessage = 'Email sent successfully. Client moved to Active Clients.';
      } else if (updatingClient) {
        showView('hired');
        renderHiredDetail(updatingClient);
        successMessage = 'Updated document email sent successfully.';
      }
      if (composeInvoiceDraft) {
        successMessage = 'Invoice sent successfully and added to this client\'s history.';
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
      const failureMessage = `${error.message} Google authorization may be required.`;
      setEmailComposeStatus(failureMessage, 'error');
      showEmailActionResult({ title: 'Email could not be sent', message: failureMessage, status: 'error' });
    } finally {
      sendButton.disabled = false;
    }
  }

  function gmailConfigured() {
    const clientId = window.GMAIL_CLIENT_ID;
    return Boolean(clientId && !clientId.includes('YOUR_CLIENT_ID'));
  }

  function updateGmailConnectionUI() {}

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
      setGmailStatus('Gmail authorized previously — log in with Google to sync');
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

  function disconnectGmail({ notify = true } = {}) {
    const token = gmailAccessToken;
    gmailAccessToken = null;
    sessionStorage.removeItem(GMAIL_TOKEN_SESSION_KEY);
    sessionStorage.removeItem(GMAIL_CONNECTED_KEY);
    try {
      if (token && window.google?.accounts?.oauth2?.revoke) google.accounts.oauth2.revoke(token, () => {});
    } catch (error) {
      console.warn('Could not revoke Gmail access token:', error);
    }
    if (gmailSyncTimer) { clearInterval(gmailSyncTimer); gmailSyncTimer = null; }
    updateGmailConnectionUI(false);
    updateLoginGoogleUI(false, 'Use your Google account to open the dashboard.');
    setGmailStatus('Gmail ready — log in with Google to sync your inbox');
    if (notify) showActionResult({ title: 'Gmail disconnected', message: 'Gmail access was disconnected for this browser session.' });
  }

  $('#accountGmailAction')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      if (gmailAccessToken && button.textContent === 'Disconnect') {
        disconnectGmail();
        return;
      }
      if (gmailAccessToken) {
        gmailAccessToken = null;
        sessionStorage.removeItem(GMAIL_TOKEN_SESSION_KEY);
      }
      await ensureGmailAccessToken();
      setGmailStatus('Connected — syncing…');
      startGmailSyncTimer();
      await syncGmail(true);
    } catch (error) {
      setGmailStatus(`Gmail connection failed: ${error?.message || 'Check your Google authorization.'}`);
      showActionResult({ title: 'Gmail connection failed', message: error?.message || 'Check your Google authorization and try again.', status: 'error' });
    } finally {
      button.disabled = false;
      renderAccountPage();
    }
  });

  function handleGmailAuthorizationFailure() {
    gmailAccessToken = null;
    sessionStorage.removeItem(GMAIL_TOKEN_SESSION_KEY);
    sessionStorage.removeItem(GMAIL_CONNECTED_KEY);
    if (gmailSyncTimer) { clearInterval(gmailSyncTimer); gmailSyncTimer = null; }
    updateGmailConnectionUI(false);
    updateLoginGoogleUI(false, 'Google authorization expired. Use Gmail reconnect in the dashboard.');
    setGmailStatus('Gmail authorization expired — log in with Google again');
  }

  function startGmailSyncTimer() {
    if (gmailSyncTimer) clearInterval(gmailSyncTimer);
    gmailSyncTimer = setInterval(() => {
      if (currentUser && gmailAccessToken) syncGmail(true);
    }, 10000);
  }

  async function syncGmail(silent = false) {
    // Do not let a restored Gmail session sync against the empty startup state.
    // The authenticated startup flow triggers the first sync after saved deletions load.
    if (gmailSyncInFlight || !gmailAccessToken || !currentUser || !dataReady || !supabaseDataLoaded) return;
    gmailSyncInFlight = true;
    try {
      const fetchMessageList = async params => {
        const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, {
          headers: { Authorization: `Bearer ${gmailAccessToken}` }
        });
        if (response.status === 401 || response.status === 403) {
          handleGmailAuthorizationFailure();
          throw new Error('Gmail authorization expired. Log in with Google again.');
        }
        if (!response.ok) throw new Error('list failed');
        return response.json();
      };
      const directClientEmailList = [...new Set(data.applications
        .filter(isDirectClientApplication)
        .map(application => String(application.email || '').trim().toLowerCase())
        .filter(isEmailAddress))].sort();
      const directClientEmails = new Set(directClientEmailList);
      const loadSentHistory = directClientEmails.size > 0
        && directClientEmailList.join('|') !== sentHistoryAddressSignature;
      const inboxParams = new URLSearchParams({ maxResults: '30', labelIds: 'INBOX' });
      const inboxList = await fetchMessageList(inboxParams);
      const listedMessages = [...(inboxList.messages || [])];
      if (directClientEmails.size) {
        const sentQuery = `{${[...directClientEmails].map(email => `to:${email}`).join(' ')}}`;
        let pageToken = '';
        do {
          const sentParams = new URLSearchParams({ maxResults: loadSentHistory ? '500' : '30', labelIds: 'SENT', q: sentQuery });
          if (pageToken) sentParams.set('pageToken', pageToken);
          const sentList = await fetchMessageList(sentParams);
          listedMessages.push(...(sentList.messages || []));
          pageToken = loadSentHistory ? sentList.nextPageToken || '' : '';
        } while (pageToken);
        sentHistoryAddressSignature = directClientEmailList.join('|');
      }
      const deletedGmailIds = new Set(data.deletedGmailIds || []);
      const ids = [...new Set(listedMessages.map(message => message.id))].filter(id => !deletedGmailIds.has(id));
      const previousGmailIds = new Set(data.emails.filter(item => item.source === 'gmail').map(item => item.gmailId));
      const newIds = ids.filter(id => !previousGmailIds.has(id));
      let matchedExistingSentMessages = false;
      const fetchedNewMessages = (await Promise.all(newIds.map(async id => {
        const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
          headers: { Authorization: `Bearer ${gmailAccessToken}` }
        });
        if (!res.ok) throw new Error(`message fetch failed (${res.status})`);
        const msg = await res.json();
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
      }))).filter(Boolean);
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
      if (newOnes.length || matchedExistingSentMessages || data.emails.length !== emailCountBeforeMerge) {
        persist();
        renderAll();
      }
      updateGmailConnectionUI(true);
      sessionStorage.setItem(GMAIL_CONNECTED_KEY, '1');
      setGmailStatus(`Connected — ${plural(activeIds.length, 'message')}${newOnes.length ? ` · ${plural(newOnes.length, 'new message')} just now` : ''}`);
      if (!silent && !alertNewMatches(newOnes)) showActionResult({ title: 'Gmail synced', message: `${plural(activeIds.length, 'message')} are available in the inbox.` });
      if (silent) alertNewMatches(newOnes);
    } catch (error) {
      const message = error?.message || 'Unknown Gmail API error';
      setGmailStatus(`Gmail sync failed: ${message}`);
      if (!silent) showActionResult({ title: 'Gmail sync failed', message, status: 'error' });
    } finally {
      gmailSyncInFlight = false;
    }
  }


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
      } else if ((alert?.type === 'contract-ended' || alert?.type === 'document-email-reminder') && alert.applicationId) {
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
  $('#settingsButton').addEventListener('click', () => $('#settingsModal').showModal());
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
  });
  $('#salaryType').addEventListener('change', updateSalaryFields);
  $('#salaryCurrency').addEventListener('change', updateSalaryFields);
  $('#salaryAmount').addEventListener('input', updateSalaryFields);
  $('#salaryHoursPerWeek').addEventListener('input', updateSalaryFields);
  $('#clientCountry').addEventListener('change', updateClientLocation);
  $('#clientRegion').addEventListener('change', updateClientLocation);
  $('#clientForm').addEventListener('submit', saveClient);
  $('#deleteClientButton').addEventListener('click', () => deleteClient(editingId));
  $('#clientStatus').addEventListener('change', updateClientActionLabel);
  $('#automaticFollowUp').addEventListener('change', event => {
    if (event.target.checked && !$('#followUpDate').value) $('#followUpDate').value = addDays(today(), 7);
  });
  $('#applicationSearch').addEventListener('input', renderApplications);
  $('#applicationDateFilter').addEventListener('change', event => {
    applicationDateFilter = event.target.value;
    renderApplications();
  });
  $('#applicationDateSort').addEventListener('change', event => {
    applicationDateSort = event.target.value;
    localStorage.setItem(APPLICATION_WEEK_FILTER_KEY, applicationDateSort);
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
        <div><span>Status</span><strong class="daily-task-detail-status${completed ? ' is-complete' : ''}">${completed ? 'Completed' : 'In progress'}</strong></div>
        ${relatedName ? `<div><span>${relatedLabel}</span><strong>${escapeHtml(relatedName)}</strong></div>` : ''}
        ${task.destination ? `<div><span>Apply destination</span><strong>${escapeHtml(task.destination)}</strong></div>` : ''}
      </div>
      ${task.notes ? `<section class="daily-task-detail-notes"><span>Notes or content</span><p>${escapeHtml(task.notes)}</p></section>` : ''}
      <button class="button ${completed ? 'button-secondary' : 'button-primary'} daily-task-detail-complete" type="button" data-daily-task-toggle="${escapeHtml(task.id)}"><i class="fa-solid ${completed ? 'fa-rotate-left' : 'fa-check'}" aria-hidden="true"></i> ${completed ? 'Reopen task' : 'Complete task'}</button>`;
    renderDailyTaskChecklist(task);
  }

  function openDailyTaskDetails(taskId) {
    const task = (data.dailyTasks || []).find(item => item.id === taskId);
    if (!task) return;
    activeDailyTaskId = task.id;
    renderDailyTaskDetails(task);
    $('#dailyTaskDetailModal').showModal();
  }

  function renderDailyTaskItem(task, history = false, number = 1) {
    const completed = Boolean(task.completedAt);
    const relatedName = dailyTaskRelatedName(task);
    const relationLabel = task.relatedType === 'client' ? 'Client' : 'Application';
    const actionLabel = completed ? 'Reopen' : 'Complete';
    const actionIcon = completed ? 'fa-rotate-left' : 'fa-check';
    return `
      <article class="daily-task-item${completed ? ' is-complete' : ''}">
        <button class="daily-task-row-open" type="button" data-daily-task-open="${escapeHtml(task.id)}" aria-label="View details for ${escapeHtml(task.title || 'task')}">
          <span class="daily-task-item-number" aria-hidden="true">${String(number).padStart(2, '0')}</span>
          <span class="daily-task-item-copy">
            <span class="daily-task-item-title">${escapeHtml(task.title || 'Untitled task')}</span>
            <span class="daily-task-item-meta"><span class="daily-task-type daily-task-type-${escapeHtml(task.type || 'task')}">${escapeHtml(DAILY_TASK_TYPES[task.type] || DAILY_TASK_TYPES.task)}</span>${relatedName ? `<span><i class="fa-solid ${task.relatedType === 'client' ? 'fa-user-tie' : 'fa-briefcase'}" aria-hidden="true"></i> ${relationLabel}: ${escapeHtml(relatedName)}</span>` : ''}${task.destination ? `<span><i class="fa-solid fa-location-arrow" aria-hidden="true"></i> ${escapeHtml(task.destination)}</span>` : ''}</span>
            ${task.checklist?.length ? `<span class="daily-task-checklist-progress"><i class="fa-solid fa-list-check" aria-hidden="true"></i> ${task.checklist.filter(item => item.completed).length}/${task.checklist.length} checked</span>` : ''}
            ${task.notes ? `<span class="daily-task-item-notes">${escapeHtml(task.notes)}</span>` : ''}
            ${history ? `<time datetime="${escapeHtml(task.completedAt || '')}">Completed ${escapeHtml(relativeDate(task.completedAt))}</time>` : ''}
          </span>
        </button>
        <div class="daily-task-item-actions"><button class="daily-task-action" type="button" data-daily-task-toggle="${escapeHtml(task.id)}" aria-label="${actionLabel}: ${escapeHtml(task.title || 'task')}" title="${actionLabel}"><i class="fa-solid ${actionIcon}" aria-hidden="true"></i></button><button class="daily-task-delete" type="button" data-daily-task-delete="${escapeHtml(task.id)}" aria-label="Delete: ${escapeHtml(task.title || 'task')}" title="Delete task"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button></div>
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
    const tasks = (data.dailyTasks || []).filter(task => task.taskDate === selectedDate)
      .sort((first, second) => Number(Boolean(first.completedAt)) - Number(Boolean(second.completedAt)) || String(first.createdAt || '').localeCompare(String(second.createdAt || '')));
    $('#navDailyTaskCount').textContent = (data.dailyTasks || []).filter(task => task.taskDate === today()).length;
    $('#dailyTaskListTitle').textContent = `Tasks for ${formatDate(selectedDate)}`;
    $('#dailyTaskCount').textContent = plural(tasks.length, 'task');
    $('#dailyTaskList').innerHTML = tasks.length
      ? tasks.map((task, index) => renderDailyTaskItem(task, false, index + 1)).join('')
      : '<div class="daily-task-empty"><span aria-hidden="true"><i class="fa-regular fa-calendar-check"></i></span><strong>No tasks planned</strong><p>Add a task for this day to get your list started.</p></div>';

    const historyTasks = (data.dailyTasks || []).filter(task => task.completedAt && dateKey(task.completedAt) === historyDate.value)
      .sort((first, second) => String(second.completedAt).localeCompare(String(first.completedAt)));
    $('#dailyTaskHistoryList').innerHTML = historyTasks.length
      ? historyTasks.map((task, index) => renderDailyTaskItem(task, true, index + 1)).join('')
      : '<div class="daily-task-history-empty">No completed tasks for this date.</div>';
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
    if (!task || !text) return;
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
  document.addEventListener('click', event => {
    const deleteActiveButton = event.target.closest('#deleteActiveClient');
    const activeClientActionsButton = event.target.closest('#activeClientActionsButton');
    const editActiveButton = event.target.closest('#editActiveClientButton');
    const closeHiredDetailAction = event.target.closest('#closeHiredDetailAction');
    const sendActiveClientEmailButton = event.target.closest('#sendActiveClientEmailButton');
    const sendInvoiceButton = event.target.closest('#sendInvoiceButton');
    const hiredSelectButton = event.target.closest('[data-hired-select]');
    const docOpenButton = event.target.closest('[data-doc-open]');
    const docRemoveButton = event.target.closest('[data-doc-remove]');
    const docEmailButton = event.target.closest('[data-doc-email]');
    const documentMenuButton = event.target.closest('.document-menu-button');

    if (activeClientActionsButton) {
      const menu = activeClientActionsButton.nextElementSibling;
      const willOpen = menu.classList.contains('hidden');
      document.querySelectorAll('.document-menu').forEach(item => item.classList.add('hidden'));
      document.querySelectorAll('[aria-haspopup="true"]').forEach(item => item.setAttribute('aria-expanded', 'false'));
      menu.classList.toggle('hidden', !willOpen);
      activeClientActionsButton.setAttribute('aria-expanded', String(willOpen));
      return;
    }

    if (deleteActiveButton) {
      deleteClient(hiredEditingId, true);
      return;
    }
    if (editActiveButton) {
      openClientModal(hiredEditingId, false, true);
      return;
    }
    if (closeHiredDetailAction) {
      closeHiredDetail();
      return;
    }
    if (sendActiveClientEmailButton) {
      const item = data.applications.find(application => application.id === hiredEditingId);
      if (item) openPlainClientEmailComposer(item);
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
    if (!event.target.closest('.document-row-menu, .hired-actions-menu')) {
      document.querySelectorAll('.document-menu').forEach(item => item.classList.add('hidden'));
      document.querySelectorAll('.document-menu-button').forEach(item => item.setAttribute('aria-expanded', 'false'));
      $('#activeClientActionsButton')?.setAttribute('aria-expanded', 'false');
    }
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
  $('#closeHiredDetail').addEventListener('click', () => closeHiredDetail());

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
  document.addEventListener('click', async event => {
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
        data.emails = data.emails.filter(item => item.id !== emailId);
        if (email.source === 'gmail' && email.gmailId) {
          data.deletedGmailIds = [...new Set([...(data.deletedGmailIds || []), email.gmailId])];
          data.emails = data.emails.filter(item => !(item.source === 'gmail' && item.gmailId === email.gmailId));
        }
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
  $$('[data-email-view]').forEach(tab => tab.addEventListener('click', () => {
    emailViewFilter = tab.dataset.emailView;
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
    const hourlyRate = Number($('#salaryCalculatorRate')?.value || 0);
    const hoursPerWeek = Number($('#salaryCalculatorHours')?.value || 0);
    const daysPerWeek = Number($('#salaryCalculatorDays')?.value || 0);
    const monthlyDays = daysPerWeek * (52 / 12);
    const monthlyTotal = hourlyRate * hoursPerWeek * (52 / 12);
    const convertedTotal = currency === 'USD' ? monthlyTotal * 58 : monthlyTotal / 58;
    const convertedHourly = currency === 'USD' ? hourlyRate * 58 : hourlyRate / 58;
    const money = (amount, code) => code === 'USD'
      ? `$${Math.round(amount).toLocaleString()}`
      : `₱${Math.round(amount).toLocaleString()}`;
    $('#salaryCalculatorMonthlyDays').textContent = `${monthlyDays.toFixed(1)} days`;
    $('#salaryCalculatorMonthlyTotal').textContent = money(monthlyTotal, currency);
    $('#salaryCalculatorConversion').textContent = currency === 'USD'
      ? money(convertedTotal, 'PHP')
      : money(convertedTotal, 'USD');
    $('#salaryCalculatorHourlyConversion').textContent = currency === 'USD'
      ? money(convertedHourly, 'PHP')
      : money(convertedHourly, 'USD');
  }

  ['salaryCalculatorCurrency', 'salaryCalculatorRate', 'salaryCalculatorHours', 'salaryCalculatorDays'].forEach(id => {
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
    const scriptViewButton = event.target.closest('[data-script-view]');
    const scriptEditButton = event.target.closest('[data-script-edit]');
    const scriptDeleteButton = event.target.closest('[data-script-delete]');
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
    if (scriptViewButton) {
      const content = $(`[data-script-content="${scriptViewButton.dataset.scriptView}"]`);
      const isHidden = content?.classList.toggle('hidden');
      scriptViewButton.textContent = isHidden ? 'View' : 'Hide';
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
    $('#weeklyReportPeriod').textContent = `${weeklyReportOffset === 0 ? 'Current week' : 'Selected week'}: ${weeklyRangeLabel(report.range)}`;
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
    if (period) period.textContent = `Current week: ${weeklyRangeLabel(range)}`;
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
    disconnectGmail({ notify: false });
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
    if (gmailSyncTimer) {
      clearInterval(gmailSyncTimer);
      gmailSyncTimer = null;
    }
    if (applyReminderTimer) {
      clearInterval(applyReminderTimer);
      applyReminderTimer = null;
    }
    dataReady = false;
    supabaseDataLoaded = false;
    data = emptyData();
    setAuthenticated(false);
    renderAll();
    $('#loginUsername').focus();
  });

  renderAll();
  window.addEventListener('online', renderAccountPage);
  window.addEventListener('offline', renderAccountPage);
  const initialView = window.location.hash.slice(1) || 'dashboard';
  showView(initialView, { updateUrl: false });
  window.addEventListener('popstate', () => {
    showView(window.location.hash.slice(1) || 'dashboard', { updateUrl: false });
  });
  initGmail();
  restoreSupabaseSession();

})();
