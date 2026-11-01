  const loginActivityCache = new Map();
  async function requestLoginActivity(method = 'GET') {
    const userId = currentUser?.id;
    if (!userId) return;
    const { data: sessionData } = await requireSupabase().auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error('Sign in to view login activity.');
    const response = await fetch('/api/auth/activity', { method, headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Login activity is unavailable.');
    if (currentUser?.id !== userId) return;
    return payload;
  }
  function renderLoginActivity(events) {
    const list = $('#accountLoginActivity');
    list.replaceChildren();
    const labels = { successful: 'Successful', failed: 'Failed password', interrupted: 'Interrupted', not_completed: 'Not completed', rate_limited: 'Blocked (rate limit)' };
    for (const event of events) {
      const row = document.createElement('tr');
      for (const value of [formatAccountTimestamp(event.at), labels[event.result] || 'Unknown', event.provider,
        event.ip || 'Unavailable', event.device || 'Unknown device']) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      list.append(row);
    }
    $('#accountLoginActivityStatus').textContent = events.length ? `${events.length} recent attempts · Times shown in your local timezone.` : 'No tracked login attempts yet.';
  }
  async function loadLoginActivity(force = false) {
    const userId = currentUser?.id;
    if (!userId) return;
    const cached = loginActivityCache.get(userId);
    if (cached?.pending) return;
    if (!force && cached && Date.now() - cached.at < 30000) {
      if (cached.events) renderLoginActivity(cached.events);
      return;
    }
    loginActivityCache.set(userId, { ...cached, pending: true, at: Date.now() });
    $('#accountLoginActivity').replaceChildren();
    $('#accountLoginActivityRefresh').disabled = true;
    $('#accountLoginActivityStatus').textContent = 'Loading secure login activity…';
    try {
      const payload = await requestLoginActivity();
      if (!payload || currentUser?.id !== userId) return;
      const events = Array.isArray(payload.events) ? payload.events : [];
      loginActivityCache.set(userId, { events, at: Date.now(), pending: false });
      renderLoginActivity(events);
    } catch {
      if (currentUser?.id === userId) $('#accountLoginActivityStatus').textContent = 'Login activity is unavailable. The updated server must be deployed; use Refresh to retry.';
    } finally {
      const entry = loginActivityCache.get(userId);
      if (entry) entry.pending = false;
      if (currentUser?.id === userId) $('#accountLoginActivityRefresh').disabled = false;
    }
  }
  async function recordVerifiedLoginActivity() {
    try { await requestLoginActivity('POST'); if (currentUser) loginActivityCache.delete(currentUser.id); }
    catch { /* Server password attempts are recorded independently of workspace state. */ }
  }
  $('#accountLoginActivityRefresh').addEventListener('click', () => loadLoginActivity(true));
