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
      loginError.textContent = 'Supabase is not configured yet. Fill in js/supabase-config.js first.';
      return;
    }
    const email = identity.includes('@') ? identity : (window.SUPABASE_LOGIN_EMAIL || '');
    if (!email) {
      loginError.textContent = 'Use the Supabase account email, or set SUPABASE_LOGIN_EMAIL in js/supabase-config.js.';
      loginPassword.value = '';
      return;
    }
    loginError.textContent = '';
    try {
      const client = requireSupabase();
      const { data: authData, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      loginForm.reset();
      await initializeSupabaseForUser(authData.user);
    } catch (error) {
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
  $('#logoutButton')?.addEventListener('click', async () => {
    try {
      if (supabaseClient) await supabaseClient.auth.signOut();
    } catch (error) {
      console.error(error);
    }
    currentUser = null;
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
  const initialView = window.location.hash.slice(1) || 'dashboard';
  showView(initialView, { updateUrl: false });
  window.addEventListener('popstate', () => {
    showView(window.location.hash.slice(1) || 'dashboard', { updateUrl: false });
  });
  initGmail();
  restoreSupabaseSession();
