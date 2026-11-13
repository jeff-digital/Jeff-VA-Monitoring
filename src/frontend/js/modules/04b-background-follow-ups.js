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
    const enable = $('#enableBackgroundFollowUps');
    enable.hidden = enabled;
    enable.disabled = !payload.configured;
    $('#disableBackgroundFollowUps').hidden = !enabled && payload.status !== 'reconnect';
    const reconnect = payload.status === 'reconnect' || !readGmailCredentials()?.refreshToken;
    $('#reconnectBackgroundGmail').hidden = enabled || !payload.configured || !reconnect;
    $('#backgroundFollowUpStatus').textContent = payload.message || (!payload.configured
      ? 'Server setup is required before enabling background sending.'
      : enabled ? `Enabled${payload.email ? ' · ' + payload.email : ''}${payload.lastCheckedAt ? ' · Checked ' + formatAccountTimestamp(payload.lastCheckedAt) : ' · First check within a minute'}`
        : 'Off · Enable to send without keeping this page open.');
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
  $('#enableBackgroundFollowUps')?.addEventListener('click', () => changeBackgroundFollowUps(true));
  $('#disableBackgroundFollowUps')?.addEventListener('click', () => changeBackgroundFollowUps(false));
  $('#refreshBackgroundFollowUps')?.addEventListener('click', () => loadBackgroundFollowUpStatus(true));
  $('#reconnectBackgroundGmail')?.addEventListener('click', reconnectGmailWithGoogle);
