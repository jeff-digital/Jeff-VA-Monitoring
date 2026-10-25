  const researchChats = new Map();
  let researchRenderedUserId = null;
  const RESEARCH_CHAT_KEY = 'jeff-va-research-chat-v1:';

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

  function renderResearchMessage(message) {
    const sources = Array.isArray(message.sources) ? message.sources.filter(source => source && researchSourceUrl(source.url)).slice(0, 6) : [];
    let content = escapeHtml(message.content);
    if (message.role === 'assistant') {
      content = content.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[(\d+)\]/g, (match, id) => {
        const source = sources.find(item => String(item.id) === id);
        return source ? '<a href="' + escapeHtml(researchSourceUrl(source.url)) + '" target="_blank" rel="noopener noreferrer">[' + id + ']</a>' : match;
      });
    }
    return '<article class="research-message is-' + message.role + '"><span class="research-message-label">' + (message.role === 'user' ? 'You' : 'GPT-OSS 120B')
      + '</span><div class="research-message-text">' + content + '</div>'
      + (sources.length ? '<details class="research-sources"><summary>Retrieved sources · ' + sources.length + '</summary><ol>' + sources.map(source => '<li><a href="' + escapeHtml(researchSourceUrl(source.url)) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(source.title) + '</a><small>' + escapeHtml(source.provider || 'Source') + '</small></li>').join('') + '</ol></details>' : '')
      + (Array.isArray(message.notices) ? message.notices.map(note => '<p class="research-source-note">' + escapeHtml(note) + '</p>').join('') : '') + '</article>';
  }

  function refreshResearchChatAccount() {
    if (researchRenderedUserId !== (currentUser?.id || null)) renderResearchChat();
  }

  function renderResearchChat() {
    if (researchRenderedUserId !== (currentUser?.id || null)) { $('#researchPrompt').value = ''; researchRenderedUserId = currentUser?.id || null; }
    const chat = currentResearchChat();
    const messages = $('#researchMessages');
    if (!messages) return;
    const welcome = '<div class="research-welcome"><span class="research-welcome-icon" aria-hidden="true">✦</span><h3>What would you like to work through?</h3><p>Research a topic, compare options, or think through a problem.</p><div class="research-suggestions"><button type="button" data-research-prompt="Help me plan a social media campaign for a small business.">Plan a campaign</button><button type="button" data-research-prompt="Compare hourly and monthly freelance pricing, with examples.">Compare options</button><button type="button" data-research-prompt="Help me reason through a difficult client request.">Think through a problem</button></div></div>';
    messages.innerHTML = chat?.messages.length ? chat.messages.map(renderResearchMessage).join('') : welcome;
    if (chat?.busy) messages.innerHTML += '<div class="research-working" role="status"><span class="news-category-loader-ring" aria-hidden="true"></span> Preparing your answer…</div>';
    $('#researchError').textContent = chat?.error || '';
    $('#researchError').hidden = !chat?.error;
    $('#researchSend').disabled = !currentUser || !dataReady || Boolean(chat?.busy);
    $('#researchSend').textContent = chat?.busy ? 'Working…' : 'Send';
    $('#researchNewChat').disabled = !chat || chat.busy || !chat.messages.length;
    $('#researchPrompt').disabled = !currentUser || !dataReady || Boolean(chat?.busy);
    $('#researchStatus').textContent = !currentUser ? 'Sign in to use the assistant.' : chat?.busy ? 'You can close this window and return while the answer is prepared.' : 'Conversation stays in this browser tab. Your workspace records are not included.';
    messages.scrollTop = messages.scrollHeight;
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
    if (ai) renderResearchChat();
    requestAnimationFrame(() => (ai ? $('#researchPrompt') : $('#quickSearchInput')).focus());
  }

  async function submitResearchQuestion(event) {
    event.preventDefault();
    const userId = currentUser?.id;
    const chat = currentResearchChat();
    const prompt = $('#researchPrompt').value.trim();
    if (!chat || chat.busy || !dataReady || !prompt) return;
    if (prompt.length > 4000) { chat.error = 'Keep your question under 4,000 characters.'; renderResearchChat(); return; }
    const mode = $('#researchSourceMode').value;
    const effort = $('#researchEffort').value;
    chat.error = '';
    chat.messages.push({ role: 'user', content: prompt });
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
      for (const message of [...chat.messages].reverse().slice(0, 12)) {
        const content = message.content.slice(0, 4000);
        if (size + content.length > 20000) break;
        history.unshift({ role: message.role, content }); size += content.length;
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        if (currentUser?.id !== userId || session?.user?.id !== userId) return;
        const response = await fetch('/api/research', { method: 'POST', headers: { authorization: 'Bearer ' + session.access_token, 'content-type': 'application/json' },
          body: JSON.stringify({ messages: history, mode, effort }), signal: AbortSignal.timeout(65000) });
        const result = await response.json().catch(() => ({}));
        if (currentUser?.id !== userId) return;
        if (response.status === 401 && attempt === 0) { session = await renewEmailAiSession(auth, userId); continue; }
        if (!response.ok || typeof result.answer !== 'string' || !result.answer.trim()) throw new Error(result.error || 'The assistant could not answer. Please try again.');
        chat.messages.push({ role: 'assistant', content: result.answer, sources: result.sources, notices: result.notices });
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
  $('#researchNewChat')?.addEventListener('click', () => {
    const chat = currentResearchChat();
    if (!chat || chat.busy) return;
    chat.messages = []; chat.error = ''; $('#researchPrompt').value = '';
    saveResearchChat(currentUser.id, chat); renderResearchChat(); $('#researchPrompt').focus();
  });
