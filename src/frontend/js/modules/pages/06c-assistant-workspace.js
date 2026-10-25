  // Workspace access is limited to an explicitly requested task or one application.
  function assistantWorkspaceRequest(prompt, selectedMode) {
    const normalized = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}@]+/gu, ' ').trim();
    const question = ' ' + normalized(prompt) + ' ';
    let mode = selectedMode;
    if (mode === 'reasoning' && /\b(task|to.do)\b/i.test(prompt) && /\b(make|create|add|schedule|remind)\b/i.test(prompt)) mode = 'task';
    if (mode === 'reasoning' && /\b(application|applied|updates?|repl(?:y|ies)|received|receieved)\b/i.test(prompt)) mode = 'application';
    if (mode === 'task') return { mode, workspace: { today: today() } };
    if (mode !== 'application') return { mode };
    let candidates = (data.applications || []).filter(app =>
      [app.clientName, app.email].some(value => normalized(value).length >= 3 && question.includes(' ' + normalized(value) + ' ')));
    if (candidates.length > 1) {
      const roles = candidates.filter(app => normalized(app.role).length >= 3 && question.includes(' ' + normalized(app.role) + ' '));
      if (roles.length === 1) candidates = roles;
    }
    if (candidates.length !== 1) {
      return { error: candidates.length
        ? 'More than one application matches. Include the company and exact role in your question: ' + candidates.slice(0, 5).map(app => (app.clientName || 'Unnamed') + ' — ' + (app.role || 'No role')).join('; ') + '.'
        : 'Include the company name or application email in your question so I can check the right application.' };
    }
    const app = candidates[0];
    const clip = (value, length) => String(value || '').slice(0, length);
    const emails = matchingEmailsForApplication(app).filter(email => !isSentEmail(email))
      .sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
    return { mode, scope: 'application:' + app.id, workspace: { application: { company: clip(app.clientName, 200), role: clip(app.role, 200),
      status: clip(app.status, 100), applied: clip(app.appliedDate || app.dateApplied, 100), followUp: clip(app.followUpDate, 100) },
      emails: emails.map(email => ({ subject: clip(email.subject, 300), from: clip(email.from, 300), date: clip(email.date, 100),
        excerpt: clip(String(email.body || email.snippet || '').replace(/<[^>]*>/g, ' '), 1200) })) },
      notices: ['Checked ' + app.clientName + ' · ' + (app.role || 'No role') + '. Uses up to 5 latest matched incoming emails saved in the app; no live Gmail check.'] };
  }

  function validAssistantTaskDraft(draft) {
    return draft && typeof draft.title === 'string' && draft.title.trim() && draft.title.length <= 200
      && /^\d{4}-\d{2}-\d{2}$/.test(draft.taskDate) && Number.isFinite(Date.parse(draft.taskDate))
      && new Date(draft.taskDate).toISOString().slice(0, 10) === draft.taskDate
      && typeof draft.notes === 'string' && draft.notes.length <= 2000;
  }

  function renderAssistantTaskAction(message) {
    if (!validAssistantTaskDraft(message.taskDraft) || !message.actionId) return '';
    const exists = (data.dailyTasks || []).some(task => task.assistantActionId === message.actionId);
    return '<div class="research-task-draft"><span class="research-message-label">' + (exists || message.taskAdded ? 'Task added' : 'Daily task draft')
      + '</span><strong>' + escapeHtml(message.taskDraft.title) + '</strong><span>Due ' + escapeHtml(message.taskDraft.taskDate)
      + '</span>' + (message.taskDraft.notes ? '<p>' + escapeHtml(message.taskDraft.notes) + '</p>' : '')
      + '<button type="button" class="button button-primary" data-assistant-add-task="' + escapeHtml(message.actionId) + '"'
      + (exists || message.taskAdded ? ' disabled>Added ✓' : '>Add task') + '</button></div>';
  }

  function addAssistantDailyTask(actionId) {
    const chat = currentResearchChat();
    if (!currentUser || !dataReady || chat?.busy) return;
    const message = chat?.messages.find(item => item.role === 'assistant' && item.actionId === actionId);
    if (!message || message.taskAdded || !validAssistantTaskDraft(message.taskDraft)) return;
    data.dailyTasks = data.dailyTasks || [];
    if (data.dailyTasks.some(task => task.assistantActionId === actionId)) return;
    // Catch the same draft requested again in another conversation.
    const duplicate = data.dailyTasks.some(task => task.taskDate === message.taskDraft.taskDate
      && task.title.trim().toLowerCase() === message.taskDraft.title.trim().toLowerCase());
    if (duplicate) { chat.error = 'A task with this title and date already exists. Check Daily Tasks.'; renderResearchChat(); return; }
    data.dailyTasks.push({ id: uid(), ...message.taskDraft, type: 'task', relatedType: '', relatedId: '', relatedName: '',
      destination: '', checklist: [], createdAt: new Date().toISOString(), completedAt: '', assistantActionId: actionId });
    message.taskAdded = true;
    persist(); saveResearchChat(currentUser.id, chat); renderAll(); renderResearchChat();
  }

  $('#researchMessages')?.addEventListener('click', event => {
    const button = event.target.closest('[data-assistant-add-task]');
    if (button) addAssistantDailyTask(button.dataset.assistantAddTask);
  });
