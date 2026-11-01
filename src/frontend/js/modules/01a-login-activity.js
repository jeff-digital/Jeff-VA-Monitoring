  const loginActivityCache = new Map();
  let loginActivityOwner = null;
  async function requestLoginActivity(method = 'GET', scope = 'account') {
    const userId = currentUser?.id;
    if (!userId) return;
    const { data: sessionData } = await requireSupabase().auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error('Sign in to view login activity.');
    const response = await fetch('/api/auth/activity' + (scope === 'all' ? '?scope=all' : ''), { method, headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Login activity is unavailable.');
    if (currentUser?.id !== userId) return;
    return payload;
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
      $('#accountLoginActivityAll').hidden = true;
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
      $('#accountLoginActivityAll').hidden = payload.canViewAll !== true;
      const events = Array.isArray(payload.events) ? payload.events : [];
      loginActivityCache.set(cacheKey, { events, at: Date.now(), pending: false });
      renderLoginActivity(events);
    } catch {
      if (currentUser?.id === userId) $('#accountLoginActivityStatus').textContent = 'Login activity is unavailable. The updated server must be deployed; use Refresh to retry.';
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
