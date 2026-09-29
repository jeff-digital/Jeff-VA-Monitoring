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
  let emailSelectionMode = false;
  let applicationDateSort = localStorage.getItem(APPLICATION_WEEK_FILTER_KEY) || '0';
  let hiredDateSort = 'newest';
  let emailDateSort = localStorage.getItem(EMAIL_WEEK_FILTER_KEY) || 'all';
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
      if (gmailAccessToken) {
        startGmailSyncTimer();
        await syncGmail(true);
      }
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

