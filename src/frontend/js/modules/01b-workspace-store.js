  // All pages use this contract; database-specific code stays on the Worker.
  const workspaceStore = (() => {
    const fields = ['applications', 'toApply', 'dailyTasks', 'clientTasks', 'socialTrends', 'emails', 'deletedGmailIds', 'alerts', 'clearedNotificationKeys', 'onboardingSubmissionIds', 'emailTemplates', 'personalDocuments', 'invoices', 'scripts', 'workLinks', 'walletEntries', 'subscriptions', 'accountSignInHistory', 'weeklyActivityGoal', 'emailTaskAiUsage'];
    const pageCollections = Object.freeze({
      dashboard: ['applications', 'emails', 'alerts', 'dailyTasks', 'clientTasks', 'toApply', 'invoices', 'walletEntries', 'weeklyActivityGoal'],
      'daily-task': ['dailyTasks', 'clientTasks', 'applications', 'toApply'],
      applications: ['applications', 'emails', 'alerts'],
      'to-apply': ['toApply', 'applications', 'alerts'],
      hired: ['applications', 'emails', 'clientTasks', 'invoices', 'walletEntries', 'alerts', 'onboardingSubmissionIds'],
      inbox: ['emails', 'applications', 'alerts', 'deletedGmailIds', 'emailTemplates', 'clientTasks', 'emailTaskAiUsage'],
      documents: ['personalDocuments', 'invoices', 'scripts', 'workLinks', 'emailTemplates', 'applications', 'walletEntries'],
      wallet: ['walletEntries', 'applications', 'invoices'],
      subscriptions: ['subscriptions'],
      'social-trends': ['socialTrends'], news: [],
      account: ['accountSignInHistory', 'applications', 'emails', 'weeklyActivityGoal']
    });
    const copy = value => JSON.parse(JSON.stringify(value));
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
    const records = value => Array.isArray(value) && value.every(item => item && typeof item === 'object' && !Array.isArray(item) && typeof item.id === 'string' && item.id) && new Set(value.map(item => item.id)).size === value.length;
    let owner = null, raw = {}, baseline = {}, loaded = false;
    async function request(method = 'GET', body, suffix = '') {
      const userId = currentUser?.id;
      if (!userId) throw new Error('Sign in to access your workspace.');
      const auth = requireSupabase().auth;
      let session = (await auth.getSession()).data?.session;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!session?.access_token || (session.user?.id && session.user.id !== userId)) throw new Error('Sign in again to access your workspace.');
        if (currentUser?.id !== userId) throw new Error('Your account changed.');
        const response = await fetch('/api/workspace' + suffix, { method,
          headers: { authorization: `Bearer ${session.access_token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
        if (currentUser?.id !== userId) throw new Error('Your account changed.');
        if (response.status === 401 && attempt === 0) { session = (await auth.refreshSession()).data?.session; continue; }
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload) throw Object.assign(new Error(payload?.error || 'Workspace storage is unavailable. Deploy the updated server before using this page.'), { status: response.status });
        return payload;
      }
    }
    function adopt(saved, userId) {
      if (currentUser?.id !== userId) throw new Error('Your account changed.');
      owner = userId;
      raw = copy(saved);
      baseline = copy(normalizeSavedWorkspace(saved));
      loaded = true;
      return copy(baseline);
    }
    function changesFor(snapshot) {
      const changes = [];
      for (const key of fields) {
        if (!has(snapshot, key) || same(snapshot[key], baseline[key])) continue;
        const previous = baseline[key], next = snapshot[key], original = raw[key];
        if (records(previous) && records(next) && records(original || [])) {
          const beforeIds = new Set(previous.map(item => item.id)), afterIds = new Set(next.map(item => item.id));
          const reordered = !same(previous.filter(item => afterIds.has(item.id)).map(item => item.id), next.filter(item => beforeIds.has(item.id)).map(item => item.id));
          const old = new Map(previous.map(item => [item.id, item]));
          const originals = new Map((original || []).map(item => [item.id, item]));
          for (let index = next.length - 1; index >= 0; index--) {
            const item = next[index];
            if (!same(item, old.get(item.id))) changes.push({ key, type: 'put', id: item.id, base: originals.get(item.id) || null, value: item, beforeId: next[index + 1]?.id || null });
          }
          for (const item of previous) if (!afterIds.has(item.id)) changes.push({ key, type: 'remove', id: item.id, base: originals.get(item.id) || null });
          if (reordered) changes.push({ key, type: 'order', base: previous.map(item => item.id), value: next.map(item => item.id) });
        } else changes.push({ key, type: 'set', base: original ?? null, value: next });
      }
      return changes;
    }
    function acknowledge(change) {
      if (change.type === 'set') { raw[change.key] = copy(change.value); return; }
      const rows = Array.isArray(raw[change.key]) ? raw[change.key] : [];
      if (change.type === 'order') {
        const byId = new Map(rows.map(item => [item.id, item]));
        const wanted = new Set(change.value);
        raw[change.key] = [...change.value.flatMap(id => byId.has(id) ? [byId.get(id)] : []), ...rows.filter(item => !wanted.has(item.id))];
        return;
      }
      const index = rows.findIndex(item => item.id === change.id);
      if (change.type === 'remove') { raw[change.key] = rows.filter(item => item.id !== change.id); return; }
      if (index >= 0) rows[index] = copy(change.value);
      else {
        const anchor = rows.findIndex(item => item.id === change.beforeId);
        rows.splice(anchor >= 0 ? anchor : rows.length, 0, copy(change.value));
      }
      raw[change.key] = rows;
    }
    return {
      pageCollections,
      activatePage(page) { if (!has(pageCollections, page)) throw new Error('Unknown workspace page.'); return [...pageCollections[page]]; },
      async load() {
        const userId = currentUser?.id;
        const payload = await request();
        if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) throw new Error('The workspace response is invalid.');
        return adopt(payload.data, userId);
      },
      adopt,
      async save(snapshot, userId) {
        if (!loaded || owner !== userId || currentUser?.id !== userId) throw new Error('Reload your workspace before saving.');
        const changes = changesFor(snapshot);
        let batch = [], size = 0;
        async function flush() {
          if (!batch.length) return;
          const payload = await request('PATCH', { changes: batch });
          if (owner !== userId || currentUser?.id !== userId) throw new Error('Your account changed.');
          batch.forEach(acknowledge);
          baseline = copy(normalizeSavedWorkspace(raw));
          if (payload.revision) rememberLocalWriteStamp(payload.revision);
          batch = []; size = 0;
        }
        for (const change of changes) {
          const length = new TextEncoder().encode(JSON.stringify(change)).length;
          if (length > 7 * 1024 * 1024) throw new Error('One record is too large to save. Export a full backup before editing it.');
          if (batch.length >= 100 || (batch.length && size + length > 512 * 1024)) await flush();
          batch.push(change); size += length;
        }
        await flush();
      },
      async record(collection, id) { return (await request('GET', undefined, '?' + new URLSearchParams({ collection, id }))).record; },
      async onboarding(action, parameters = {}) { return (await request('POST', { action, parameters }, '/onboarding')).data; },
      async clear() { await request('DELETE'); this.reset(); },
      reset() { owner = null; raw = {}; baseline = {}; loaded = false; },
      backup(snapshot, userId) {
        if (!loaded || owner !== userId || currentUser?.id !== userId) throw new Error('Load your account before creating a backup.');
        return { format: 'jeff-va-workspace', version: 1, userId, exportedAt: new Date().toISOString(), attachedFilesIncluded: false, data: { ...copy(raw), ...copy(snapshot) } };
      }
    };
  })();
