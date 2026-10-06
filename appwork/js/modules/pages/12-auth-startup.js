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
    renderAll();
    $('#loginUsername').focus();
  });

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
