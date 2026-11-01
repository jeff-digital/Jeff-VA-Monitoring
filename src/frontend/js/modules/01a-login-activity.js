  const loginActivityCache = new Map();
  let loginActivityOwner = null;
  function setLoginActivityAdminOption(allowed) {
    // Older open pages can have the scope selector without the admin option.
    // Recreate it when needed instead of stopping account activity loading.
    const scope = $('#accountLoginActivityScope');
    let option = $('#accountLoginActivityAll');
    if (!option && allowed) {
      option = document.createElement('option');
      option.id = 'accountLoginActivityAll';
      option.value = 'all';
      option.textContent = 'All submitted attempts (admin)';
      scope.append(option);
    }
    if (option) { option.hidden = !allowed; option.disabled = !allowed; }
    if (!allowed && scope.value === 'all') scope.value = 'account';
  }
  async function renewLoginActivitySession(auth, userId) {
    if (typeof renewEmailAiSession === 'function') return renewEmailAiSession(auth, userId);
    const renewed = await auth.refreshSession();
    if (renewed.error || !renewed.data?.session?.access_token) throw new Error('Your session has expired. Sign in again to view login attempts.');
    return renewed.data.session;
  }
  async function requestLoginActivity(method = 'GET', scope = 'account') {
    const userId = currentUser?.id;
    if (!userId) return;
    const auth = requireSupabase().auth;
    const current = await auth.getSession();
    let session = current.data?.session;
    if (current.error || !session?.access_token || (session.expires_at && session.expires_at <= Date.now() / 1000 + 60)) session = await renewLoginActivitySession(auth, userId);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (currentUser?.id !== userId || (session.user?.id && session.user.id !== userId)) return;
      const response = await fetch('/api/auth/activity' + (scope === 'all' ? '?scope=all' : ''), { method, headers: { authorization: `Bearer ${session.access_token}` }, signal: AbortSignal.timeout(15000) });
      const payload = await response.json().catch(() => null);
      if (currentUser?.id !== userId) return;
      if (response.status === 401 && attempt === 0) { session = await renewLoginActivitySession(auth, userId); continue; }
      if (response.status === 401) throw new Error('Your session has expired. Sign in again to view login attempts.');
      if (response.status === 403) throw new Error(payload?.error || 'Cloudflare blocked the login-activity request. Refresh the page and retry.');
      if (!payload && response.status >= 500) throw new Error(`The login-activity server is temporarily unavailable (HTTP ${response.status}). Use Refresh to retry.`);
      if (!payload || response.status === 404) throw new Error('This server is not serving the login-activity API. Open the published app or start the local app server.');
      if (!response.ok) throw new Error(payload.error || 'Login activity is temporarily unavailable. Use Refresh to retry.');
      if (!Array.isArray(payload.events) && method === 'GET') throw new Error('The server returned an invalid login-activity response. Use Refresh to retry.');
      return payload;
    }
  }
  function renderLoginActivity(events) {
    const list = $('#accountLoginActivity');
    list.replaceChildren();
    const labels = { successful: 'Successful', failed: 'Unrecognized credentials', invalid_input: 'Invalid or empty input', interrupted: 'Interrupted', not_completed: 'Not completed', rate_limited: 'Blocked (rate limit)' };
    for (const event of events) {
      const row = document.createElement('li');
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      const method = document.createElement('span');
      method.textContent = `${event.provider || 'Sign-in'} · ${labels[event.result] || 'Unknown'}`;
      const timestamp = document.createElement('time');
      timestamp.dateTime = event.at || '';
      timestamp.textContent = formatAccountTimestamp(event.at);
      summary.append(method, timestamp);
      const metadata = document.createElement('dl');
      for (const [label, value] of [['IP address', event.ip || 'Unavailable'], ['Browser / device', event.device || 'Unknown device'], ['Account reference', event.accountRef || 'This account']]) {
        const term = document.createElement('dt');
        term.textContent = label;
        const description = document.createElement('dd');
        description.textContent = value;
        metadata.append(term, description);
      }
      details.append(summary, metadata);
      row.append(details);
      list.append(row);
    }
    $('#accountLoginActivityStatus').textContent = events.length ? `${events.length} recent attempts · Times shown in your local timezone.` : 'No tracked login attempts yet.';
  }
  async function loadLoginActivity(force = false) {
    const userId = currentUser?.id;
    if (!userId) return;
    if (loginActivityOwner !== userId) {
      loginActivityOwner = userId;
      $('#accountLoginActivityScope').value = 'account';
      setLoginActivityAdminOption(false);
    }
    const scope = $('#accountLoginActivityScope').value === 'all' ? 'all' : 'account';
    const cacheKey = `${userId}:${scope}`;
    const cached = loginActivityCache.get(cacheKey);
    if (cached?.pending) return;
    if (!force && cached && Date.now() - cached.at < 30000) {
      if (cached.events) renderLoginActivity(cached.events);
      return;
    }
    loginActivityCache.set(cacheKey, { ...cached, pending: true, at: Date.now() });
    $('#accountLoginActivity').replaceChildren();
    $('#accountLoginActivityRefresh').disabled = true;
    $('#accountLoginActivityStatus').textContent = 'Loading secure login activity…';
    try {
      const payload = await requestLoginActivity('GET', scope);
      if (!payload || currentUser?.id !== userId || $('#accountLoginActivityScope').value !== scope) return;
      setLoginActivityAdminOption(payload.canViewAll === true);
      const events = Array.isArray(payload.events) ? payload.events : [];
      loginActivityCache.set(cacheKey, { events, at: Date.now(), pending: false });
      renderLoginActivity(events);
    } catch (error) {
      if (currentUser?.id === userId) $('#accountLoginActivityStatus').textContent = error.name === 'AbortError' || error.name === 'TimeoutError'
        ? 'Loading login attempts timed out. Use Refresh to retry.'
        : error instanceof TypeError ? 'Login activity could not connect to the server. Check your connection and use Refresh.'
          : error.message || 'Login activity is temporarily unavailable. Use Refresh to retry.';
    } finally {
      const entry = loginActivityCache.get(cacheKey);
      if (entry) entry.pending = false;
      if (currentUser?.id === userId) $('#accountLoginActivityRefresh').disabled = false;
    }
  }
  async function recordVerifiedLoginActivity() {
    try { await requestLoginActivity('POST'); if (currentUser) loginActivityCache.delete(`${currentUser.id}:account`); }
    catch { /* Server password attempts are recorded independently of workspace state. */ }
  }
  $('#accountLoginActivityRefresh').addEventListener('click', () => loadLoginActivity(true));
  $('#accountLoginActivityScope').addEventListener('change', () => loadLoginActivity(true));
