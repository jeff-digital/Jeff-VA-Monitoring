  const researchChats = new Map();
  let researchRenderedUserId = null;
  const RESEARCH_CHAT_KEY = 'jeff-va-research-chat-v1:';
  const researchUsageByUser = new Map();

  function rememberResearchUsage(userId, usage) {
    if (!usage || usage.scope !== 'assistant-requests' || !Number.isInteger(usage.used) || usage.used < 0
      || !Number.isInteger(usage.limit) || usage.limit < 1 || !Number.isFinite(Date.parse(usage.resetsAt))) return;
    const previous = researchUsageByUser.get(userId);
    const used = previous?.usage?.day === usage.day ? Math.max(previous.usage.used, usage.used) : usage.used;
    researchUsageByUser.set(userId, { ...previous, usage: { ...usage, used, remaining: Math.max(0, usage.limit - used) }, at: Date.now(), error: '' });
  }

  function researchLimitReached() {
    const usage = researchUsageByUser.get(currentUser?.id)?.usage;
    return Boolean(usage && Date.parse(usage.resetsAt) > Date.now() && usage.used >= usage.limit);
  }

  function researchUsageReady() {
    const usage = researchUsageByUser.get(currentUser?.id)?.usage;
    return Boolean(usage && Date.parse(usage.resetsAt) > Date.now());
  }

  function renderResearchUsage() {
    const entry = researchUsageByUser.get(currentUser?.id);
    const usage = entry?.usage && Date.parse(entry.usage.resetsAt) > Date.now() ? entry.usage : null;
    const indicator = $('#researchUsageCount');
    const bar = $('#researchUsageProgress');
    if (!indicator || !bar) return;
    indicator.textContent = !currentUser ? 'Sign in to check usage' : usage ? usage.used + ' / ' + usage.limit + ' requests' : entry?.error ? 'Usage unavailable' : 'Checking usage…';
    bar.hidden = !usage;
    if (usage) { bar.max = usage.limit; bar.value = Math.min(usage.used, usage.limit); }
    const limited = Boolean(usage && usage.remaining === 0);
    const warning = Boolean(usage && usage.remaining <= Math.ceil(usage.limit * .2));
    $('#researchUsagePanel').classList.toggle('is-warning', warning);
    $('#researchUsagePanel').classList.toggle('is-exhausted', limited);
    const note = $('#researchUsageNote');
    note.textContent = entry?.error ? (usage ? 'Usage refresh failed. Try again.' : 'Sending paused. Refresh to check usage.')
      : limited ? 'Daily limit reached. Available again at 8 AM.' : warning ? usage.remaining + ' requests left today.' : '';
    note.hidden = !note.textContent;
    $('#researchUsageReset').textContent = 'Resets 8 AM · PH';
    $('#researchSend').disabled = !currentUser || !dataReady || Boolean(currentResearchChat()?.busy) || !usage || limited;
    $('#refreshResearchUsage').disabled = !currentUser || Boolean(entry?.pending);
  }

  async function refreshResearchUsage(force = false) {
    const userId = currentUser?.id;
    if (!userId || !dataReady) { renderResearchUsage(); return; }
    let entry = researchUsageByUser.get(userId) || { at: 0 };
    if (entry.pending) return entry.promise;
    if (!force && Date.now() - entry.at < 60000 && Date.parse(entry.usage?.resetsAt) > Date.now()) return;
    entry.pending = true;
    researchUsageByUser.set(userId, entry);
    renderResearchUsage();
    const run = async () => { try {
      const auth = requireSupabase().auth;
      const current = await auth.getSession();
      let session = current.data?.session;
      if (current.error || !session?.access_token || (session.expires_at && session.expires_at <= Date.now() / 1000 + 60)) session = await renewEmailAiSession(auth, userId);
      for (let attempt = 0; attempt < 2; attempt++) {
        if (currentUser?.id !== userId || session?.user?.id !== userId) return;
        const response = await fetch('/api/research/usage', { headers: { authorization: 'Bearer ' + session.access_token }, signal: AbortSignal.timeout(12000) });
        const result = await response.json().catch(() => ({}));
        if (currentUser?.id !== userId) return;
        if (response.status === 401 && attempt === 0) { session = await renewEmailAiSession(auth, userId); continue; }
        if (!response.ok || result.scope !== 'assistant-requests') throw new Error('Could not check usage. Sending stays paused until the limit can be verified.');
        rememberResearchUsage(userId, result);
        break;
      }
    } catch (error) {
      entry = researchUsageByUser.get(userId) || entry;
      entry.error = error.message || 'Usage could not be checked.';
      researchUsageByUser.set(userId, entry);
    } finally {
      const latest = researchUsageByUser.get(userId);
      if (latest) latest.pending = false;
      if (currentUser?.id === userId) renderResearchUsage();
    } };
    entry.promise = run();
    return entry.promise;
  }

  function currentResearchChat() {
    const id = currentUser?.id;
    if (!id) return null;
    if (!researchChats.has(id)) {
      let messages = [];
      try {
        const saved = JSON.parse(sessionStorage.getItem(RESEARCH_CHAT_KEY + id) || '[]');
        if (Array.isArray(saved)) messages = saved.filter(item => ['user', 'assistant'].includes(item?.role) && typeof item.content === 'string').slice(-20);
      } catch {}
      researchChats.set(id, { messages, busy: false, error: '' });
    }
    return researchChats.get(id);
  }

  function saveResearchChat(userId, chat) {
    try { sessionStorage.setItem(RESEARCH_CHAT_KEY + userId, JSON.stringify(chat.messages.slice(-20))); } catch {}
  }

  function researchSourceUrl(value) {
    try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
  }

  function cleanResearchAnswerText(value) {
    const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n');
    const result = [];
    let inCode = false;
    const divider = line => /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
    const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
    const plain = line => line
      .replace(/^\s{0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/, '$1')
      .replace(/^\s*>\s?/, '')
      .replace(/^\s*[-*+]\s+/, '')
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/__([^_\n]+)__/g, '$1')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, '$1$2')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/!?\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)');
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (/^\s*(?:```|~~~)/.test(line)) { inCode = !inCode; continue; }
      if (inCode) { result.push(line); continue; }
      if (line.includes('|') && index + 1 < lines.length && divider(lines[index + 1])) {
        const headers = cells(line).map(plain);
        index++;
        while (index + 1 < lines.length && lines[index + 1].includes('|') && cells(lines[index + 1]).length === headers.length) {
          const row = cells(lines[++index]).map(plain);
          if (divider(lines[index])) continue;
          result.push(row[0]);
          row.slice(1).forEach((cell, column) => { if (cell) result.push((headers[column + 1] ? headers[column + 1] + ': ' : '') + cell); });
          result.push('');
        }
        continue;
      }
      if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line) || /^\s*#{1,6}\s*$/.test(line) || /^\s*(?:\|\s*){2,}$/.test(line)) continue;
      result.push(plain(line));
    }
    return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function renderResearchMessage(message) {
    const sources = Array.isArray(message.sources) ? message.sources.filter(source => source && researchSourceUrl(source.url)).slice(0, 6) : [];
    let content = escapeHtml(message.role === 'assistant' ? cleanResearchAnswerText(message.content) : message.content);
    if (message.role === 'assistant') {
      content = content.replace(/\[(\d+)\]/g, (match, id) => {
        const source = sources.find(item => String(item.id) === id);
        return source ? '<a href="' + escapeHtml(researchSourceUrl(source.url)) + '" target="_blank" rel="noopener noreferrer">[' + id + ']</a>' : match;
      });
    }
    return '<article class="research-message is-' + message.role + '"><span class="research-message-label">' + (message.role === 'user' ? 'You' : 'GPT-OSS 120B')
      + '</span><div class="research-message-text">' + content + '</div>'
      + (sources.length ? '<details class="research-sources"><summary>Retrieved sources · ' + sources.length + '</summary><ol>' + sources.map(source => '<li><a href="' + escapeHtml(researchSourceUrl(source.url)) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(source.title) + '</a><small>' + (escapeHtml(source.provider || 'Source') + (source.publishedAt ? ' · Published ' + escapeHtml(source.publishedAt) : '')) + '</small></li>').join('') + '</ol></details>' : '')
      + (Array.isArray(message.notices) ? message.notices.map(note => '<p class="research-source-note">' + escapeHtml(note) + '</p>').join('') : '')
      + (message.role === 'assistant' ? renderAssistantTaskAction(message) : '') + '</article>';
  }

  function refreshResearchChatAccount() {
    if (researchRenderedUserId !== (currentUser?.id || null)) renderResearchChat();
  }

  function renderResearchChat() {
    if (researchRenderedUserId !== (currentUser?.id || null)) { $('#researchPrompt').value = ''; researchRenderedUserId = currentUser?.id || null; }
    const chat = currentResearchChat();
    const messages = $('#researchMessages');
    if (!messages) return;
    const welcome = '<div class="research-welcome"><span class="research-welcome-icon" aria-hidden="true">✦</span><h3>What would you like to work through?</h3><p>Plan your work, check an application, or research a topic.</p><div class="research-suggestions"><button type="button" data-research-prompt="Create a daily task for tomorrow: finish the client video.">Create a task</button><button type="button" data-research-prompt="Compare hourly and monthly freelance pricing, with examples.">Compare options</button><button type="button" data-research-prompt="Have I received any updates on my application?">Check an application</button></div></div>';
    messages.innerHTML = chat?.messages.length ? chat.messages.map(renderResearchMessage).join('') : welcome;
    if (chat?.busy) messages.innerHTML += '<div class="research-working" role="status"><span class="news-category-loader-ring" aria-hidden="true"></span> Preparing your answer…</div>';
    $('#researchError').textContent = chat?.error || '';
    $('#researchError').hidden = !chat?.error;
    $('#researchSend').disabled = !currentUser || !dataReady || Boolean(chat?.busy);
    $('#researchSend').textContent = chat?.busy ? 'Working…' : 'Send';
    $('#researchNewChat').disabled = !chat || chat.busy || !chat.messages.length;
    $('#researchPrompt').disabled = !currentUser || !dataReady || Boolean(chat?.busy);
    $('#researchStatus').textContent = !currentUser ? 'Sign in to use the assistant.' : chat?.busy ? 'You can close this window and return while the answer is prepared.' : 'Tasks need confirmation. Application checks use only the selected record and saved matched emails.';
    messages.scrollTop = chat?.messages.length ? messages.scrollHeight : 0;
    renderResearchUsage();
  }

  function setQuickSearchMode(mode) {
    const ai = mode === 'ai';
    $('#quickSearchModal').classList.toggle('is-research', ai);
    $('#quickAppSearchPanel').hidden = ai;
    $('#researchPanel').hidden = !ai;
    $('#quickSearchTitle').textContent = ai ? 'Research & reasoning' : 'Search your workspace';
    $('#researchModelLabel').hidden = !ai;
    $('#researchModeTab').setAttribute('aria-selected', String(ai));
    $('#appSearchModeTab').setAttribute('aria-selected', String(!ai));
    if (ai) { renderResearchChat(); refreshResearchUsage(); }
    requestAnimationFrame(() => (ai ? $('#researchPrompt') : $('#quickSearchInput')).focus());
  }

  async function submitResearchQuestion(event) {
    event.preventDefault();
    const userId = currentUser?.id;
    const chat = currentResearchChat();
    const prompt = $('#researchPrompt').value.trim();
    if (!chat || chat.busy || !dataReady || !prompt) return;
    const workspaceRequest = assistantWorkspaceRequest(prompt, $('#researchSourceMode').value);
    if (workspaceRequest.error) { chat.error = workspaceRequest.error; renderResearchChat(); return; }
    if (!researchUsageReady()) {
      await refreshResearchUsage(true);
      if (currentUser?.id !== userId) return;
      if (!researchUsageReady()) { chat.error = 'Usage could not be verified. Your question has not been sent.'; renderResearchChat(); return; }
      if (chat.busy) return;
    }
    if (researchLimitReached()) { chat.error = 'Your daily assistant limit is reached. It resets at 8:00 AM Philippine time.'; renderResearchChat(); return; }
    if (prompt.length > 4000) { chat.error = 'Keep your question under 4,000 characters.'; renderResearchChat(); return; }
    const { mode, workspace } = workspaceRequest;
    const effort = $('#researchEffort').value;
    chat.error = '';
    const scope = workspaceRequest.scope || (mode === 'task' ? 'task' : 'general');
    chat.messages.push({ role: 'user', content: prompt, scope });
    chat.messages = chat.messages.slice(-20);
    chat.busy = true;
    $('#researchPrompt').value = '';
    saveResearchChat(userId, chat);
    renderResearchChat();
    try {
      const auth = requireSupabase().auth;
      const sessionResult = await auth.getSession();
      let session = sessionResult.data?.session;
      if (sessionResult.error || !session?.access_token || (session.expires_at && session.expires_at <= Date.now() / 1000 + 60)) session = await renewEmailAiSession(auth, userId);
      const history = [];
      let size = 0;
      const scopedMessages = chat.messages.filter(message => (message.scope || 'general') === scope);
      for (const message of [...(mode === 'application' ? scopedMessages.slice(-1) : scopedMessages)].reverse().slice(0, 12)) {
        const content = message.content.slice(0, 4000);
        if (size + content.length > 20000) break;
        history.unshift({ role: message.role, content }); size += content.length;
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        if (currentUser?.id !== userId || session?.user?.id !== userId) return;
        const response = await fetch('/api/research', { method: 'POST', headers: { authorization: 'Bearer ' + session.access_token, 'content-type': 'application/json' },
          body: JSON.stringify({ messages: history, mode, effort, ...(workspace ? { workspace } : {}) }), signal: AbortSignal.timeout(65000) });
        const result = await response.json().catch(() => ({}));
        if (currentUser?.id !== userId) return;
        if (result.usage) rememberResearchUsage(userId, result.usage);
        if (response.status === 401 && attempt === 0) { session = await renewEmailAiSession(auth, userId); continue; }
        if (!response.ok || typeof result.answer !== 'string' || !result.answer.trim()) throw new Error(result.error || 'The assistant could not answer. Please try again.');
        chat.messages.push({ role: 'assistant', content: cleanResearchAnswerText(result.answer), scope, sources: result.sources,
          notices: [...(result.notices || []), ...(workspaceRequest.notices || [])],
          ...(mode === 'task' && validAssistantTaskDraft(result.taskDraft) ? { taskDraft: result.taskDraft, actionId: uid() } : {}) });
        saveResearchChat(userId, chat);
        break;
      }
    } catch (error) {
      chat.messages.pop();
      chat.error = error.name === 'TimeoutError' || error.name === 'AbortError' ? 'The answer took too long. Your question is still below; try Quick reasoning or send again.' : error.message;
      if (currentUser?.id === userId) $('#researchPrompt').value = prompt;
      saveResearchChat(userId, chat);
    } finally { chat.busy = false; renderResearchChat(); }
  }

  $('#researchModeTab')?.addEventListener('click', () => setQuickSearchMode('ai'));
  $('#appSearchModeTab')?.addEventListener('click', () => setQuickSearchMode('app'));
  $('#closeQuickSearch')?.addEventListener('click', () => $('#quickSearchModal').close());
  $('#quickSearchModal')?.addEventListener('close', () => $('#openQuickSearch').focus());
  $('#researchForm')?.addEventListener('submit', submitResearchQuestion);
  $('#researchPrompt')?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('#researchForm').requestSubmit(); }
  });
  $('#researchMessages')?.addEventListener('click', event => {
    const button = event.target.closest('[data-research-prompt]');
    if (button) { $('#researchPrompt').value = button.dataset.researchPrompt; $('#researchPrompt').focus(); }
  });
  function startNewResearchChat() {
    const chat = currentResearchChat();
    if (!chat || chat.busy) return;
    chat.messages = []; chat.error = ''; $('#researchPrompt').value = '';
    saveResearchChat(currentUser.id, chat); renderResearchChat(); $('#researchPrompt').focus();
  }
  $('#researchNewChat')?.addEventListener('click', startNewResearchChat);
  $('#refreshResearchUsage')?.addEventListener('click', () => refreshResearchUsage(true));
  if (typeof setInterval === 'function') setInterval(() => {
    if ($('#quickSearchModal')?.open && !$('#researchPanel')?.hidden && !document.hidden) refreshResearchUsage();
  }, 60000);
