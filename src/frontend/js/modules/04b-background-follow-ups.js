  let backgroundFollowUpOwner = null;
  let backgroundFollowUpLoadedAt = 0;
  let backgroundFollowUpPending = null;
  async function backgroundFollowUpRequest(method = 'GET', body) {
    const userId = currentUser?.id;
    if (!userId) throw new Error('Sign in to manage background follow-ups.');
    const auth = requireSupabase().auth;
    let session = (await auth.getSession()).data?.session;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!session?.access_token) throw new Error('Sign in again to manage background follow-ups.');
      if (currentUser?.id !== userId || (session.user?.id && session.user.id !== userId)) return null;
      const response = await fetch('/api/follow-up/background', {
        method, headers: { authorization: `Bearer ${session.access_token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000)
      });
      if (currentUser?.id !== userId) return null;
      if (response.status === 401 && attempt === 0) { session = (await auth.refreshSession()).data?.session; continue; }
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) throw new Error(payload?.error || 'Background follow-ups are unavailable on this server.');
      return payload;
    }
  }
  function renderBackgroundFollowUpStatus(payload) {
    const enabled = payload.enabled === true;
    const monthlyEnabled = payload.walletMonthlyReportEnabled === true;
    const enable = $('#enableBackgroundFollowUps');
    enable.hidden = enabled;
    enable.disabled = !payload.configured;
    $('#disableBackgroundFollowUps').hidden = !enabled && payload.status !== 'reconnect';
    const reconnect = payload.status === 'reconnect' || !readGmailCredentials()?.refreshToken;
    $('#reconnectBackgroundGmail').hidden = !payload.configured || !reconnect || (enabled && payload.status !== 'reconnect' && !monthlyEnabled);
    $('#backgroundFollowUpStatus').textContent = payload.message || (!payload.configured
      ? 'Server setup is required before enabling background sending.'
      : enabled ? `Enabled${payload.email ? ' · ' + payload.email : ''}${payload.lastCheckedAt ? ' · Checked ' + formatAccountTimestamp(payload.lastCheckedAt) : ' · First check within a minute'}`
        : 'Off · Enable to send without keeping this page open.');
    const walletStatus = $('#walletMonthlyEmailStatus');
    if (walletStatus) {
      walletStatus.textContent = payload.status === 'reconnect' && monthlyEnabled
        ? 'Google access ended. Reconnect Gmail to resume month-end reports.'
        : monthlyEnabled && payload.walletMonthlyReportLastStatus === 'pending'
          ? 'On · Gmail is confirming or retrying the scheduled month-end report.'
          : monthlyEnabled && payload.status === 'retry'
            ? 'On · Gmail is temporarily unavailable. The month-end report will retry automatically.'
        : monthlyEnabled
          ? `On · Sent to ${payload.email || 'your account email'} on the last day of each month${payload.walletMonthlyReportLastSentAt ? ` · Last sent ${formatAccountTimestamp(payload.walletMonthlyReportLastSentAt)}` : ''}.`
          : payload.configured
            ? 'Off · Turn this on to email your report on the last day of every month.'
            : 'Background email needs server setup before month-end reports can be sent.';
      const toggle = $('#walletMonthlyEmailToggle');
      if (toggle) { toggle.textContent = monthlyEnabled ? 'Turn off' : 'Turn on'; toggle.setAttribute('aria-pressed', String(monthlyEnabled)); toggle.disabled = !payload.configured || (!monthlyEnabled && payload.status === 'reconnect'); }
    }
    const list = $('#backgroundFollowUpHistory');
    list.replaceChildren();
    const labels = { sent: 'Sent', retry: 'Will retry', review: 'Needs review' };
    for (const item of payload.recent || []) {
      const row = document.createElement('li');
      const title = document.createElement('span');
      title.textContent = data.applications?.find(app => app.id === item.applicationId)?.clientName || 'Application';
      const status = document.createElement('strong');
      status.textContent = labels[item.status] || 'Pending';
      const detail = document.createElement('small');
      detail.textContent = item.message || formatAccountTimestamp(item.sentAt || item.updatedAt);
      row.append(title, status, detail);
      list.append(row);
    }
  }
  async function loadBackgroundFollowUpStatus(force = false) {
    if (!currentUser || !$('#backgroundFollowUpStatus')) return;
    const userId = currentUser.id;
    if (backgroundFollowUpOwner !== userId) {
      backgroundFollowUpOwner = userId;
      backgroundFollowUpLoadedAt = 0;
      $('#backgroundFollowUpHistory').replaceChildren();
      $('#backgroundFollowUpStatus').textContent = 'Checking…';
      $('#enableBackgroundFollowUps').disabled = true;
      $('#disableBackgroundFollowUps').hidden = true;
      $('#reconnectBackgroundGmail').hidden = true;
    }
    if (backgroundFollowUpPending === userId || (!force && Date.now() - backgroundFollowUpLoadedAt < 30000)) return;
    backgroundFollowUpPending = userId;
    try {
      const payload = await backgroundFollowUpRequest();
      if (payload && currentUser?.id === userId) { renderBackgroundFollowUpStatus(payload); backgroundFollowUpLoadedAt = Date.now(); }
    } catch (error) {
      if (currentUser?.id === userId) $('#backgroundFollowUpStatus').textContent = error.message || 'Background follow-ups could not be loaded.';
    } finally { if (backgroundFollowUpPending === userId) backgroundFollowUpPending = null; }
  }
  async function changeBackgroundFollowUps(enabled) {
    const userId = currentUser?.id;
    const button = $(enabled ? '#enableBackgroundFollowUps' : '#disableBackgroundFollowUps');
    button.disabled = true;
    try {
      const refreshToken = enabled ? readGmailCredentials()?.refreshToken : null;
      if (enabled && !refreshToken) {
        $('#reconnectBackgroundGmail').hidden = false;
        throw new Error('Reconnect Gmail, then enable background sending.');
      }
      const result = await backgroundFollowUpRequest(enabled ? 'POST' : 'DELETE', enabled ? { refreshToken } : undefined);
      if (result && currentUser?.id === userId) await loadBackgroundFollowUpStatus(true);
    } catch (error) {
      if (currentUser?.id === userId) $('#backgroundFollowUpStatus').textContent = error.message || 'Background settings could not be saved.';
    } finally { if (currentUser?.id === userId) button.disabled = false; }
  }
  async function changeWalletMonthlyEmail(enabled) {
    const userId = currentUser?.id;
    const button = $('#walletMonthlyEmailToggle');
    if (!userId || !button) return;
    button.disabled = true;
    try {
      const refreshToken = enabled ? readGmailCredentials()?.refreshToken : undefined;
      if (enabled && !refreshToken) {
        $('#walletMonthlyEmailStatus').textContent = 'Reconnect Gmail to allow month-end sending while you are away.';
        $('#reconnectBackgroundGmail').hidden = false;
        await reconnectGmailWithGoogle();
        return;
      }
      const result = await backgroundFollowUpRequest('POST', { walletMonthlyReportEnabled: enabled, ...(refreshToken ? { refreshToken } : {}) });
      if (result && currentUser?.id === userId) await loadBackgroundFollowUpStatus(true);
    } catch (error) {
      if (currentUser?.id === userId) $('#walletMonthlyEmailStatus').textContent = error.message || 'Month-end email settings could not be saved.';
    } finally { if (currentUser?.id === userId) button.disabled = false; }
  }
  $('#enableBackgroundFollowUps')?.addEventListener('click', () => changeBackgroundFollowUps(true));
  $('#disableBackgroundFollowUps')?.addEventListener('click', () => changeBackgroundFollowUps(false));
  $('#refreshBackgroundFollowUps')?.addEventListener('click', () => loadBackgroundFollowUpStatus(true));
  $('#reconnectBackgroundGmail')?.addEventListener('click', reconnectGmailWithGoogle);
  $('#walletMonthlyEmailToggle')?.addEventListener('click', event => changeWalletMonthlyEmail(event.currentTarget.getAttribute('aria-pressed') !== 'true'));
