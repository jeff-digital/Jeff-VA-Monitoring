  const DAILY_TASK_TYPES = {
    task: 'General task',
    client: 'Client work',
    application: 'Application',
    apply: 'Apply somewhere',
    content: 'Content'
  };
  let activeDailyTaskId = '';
  let pendingDailyTaskChecklist = [];
  let dailyTaskFilter = 'all';
  let dailyTaskUndoTimer = null;
  let pendingDailyTaskUndo = null;

  function dailyTaskDateStatus(task) {
    if (task.completedAt) {
      return '<span class="daily-task-status is-complete">Done</span>';
    }
    if (task.taskDate < today()) {
      return '<span class="daily-task-status is-overdue">Overdue</span>';
    }
    if (task.taskDate === today()) {
      return '<span class="daily-task-status is-due-today">Due today</span>';
    }
    return '<span class="daily-task-status is-upcoming">Upcoming</span>';
  }

  function dailyTaskRelatedOptions() {
    const selected = $('#dailyTaskRelated').value;
    const clients = data.applications.filter(item => item.status === 'Active client');
    const applications = data.applications.filter(item => item.status !== 'Active client');
    const option = (item, type) => {
      const name = item.clientName || item.role || 'Untitled record';
      const detail = item.role && item.clientName ? ` - ${item.role}` : '';
      return `<option value="${type}:${escapeHtml(item.id)}">${escapeHtml(name + detail)}</option>`;
    };
    const groups = [
      clients.length ? `<optgroup label="Active clients">${clients.map(item => option(item, 'client')).join('')}</optgroup>` : '',
      applications.length ? `<optgroup label="Applications">${applications.map(item => option(item, 'application')).join('')}</optgroup>` : ''
    ].join('');
    $('#dailyTaskRelated').innerHTML = `<option value="">No linked record</option>${groups}`;
    if ([...$('#dailyTaskRelated').options].some(item => item.value === selected)) $('#dailyTaskRelated').value = selected;
  }

  function dailyTaskRelatedName(task) {
    const related = data.applications.find(item => item.id === task.relatedId);
    return related ? related.clientName || related.role || task.relatedName : task.relatedName;
  }

  function renderDailyTaskChecklist(task) {
    const checklist = Array.isArray(task.checklist) ? task.checklist : [];
    const completedCount = checklist.filter(item => item.completed).length;
    $('#dailyTaskDetailChecklistCount').textContent = `${completedCount} of ${checklist.length}`;
    $('#dailyTaskDetailChecklist').innerHTML = checklist.length
      ? checklist.map((item, index) => `<div class="daily-task-check-item${item.completed ? ' is-checked' : ''}"><span class="daily-task-check-number" aria-hidden="true">${index + 1}</span><label><input type="checkbox" data-daily-task-check="${escapeHtml(item.id)}" data-task-id="${escapeHtml(task.id)}" ${item.completed ? 'checked' : ''} /><span>${escapeHtml(item.text)}</span></label><button class="daily-task-check-delete" type="button" data-daily-task-check-delete="${escapeHtml(item.id)}" data-task-id="${escapeHtml(task.id)}" aria-label="Remove checklist item: ${escapeHtml(item.text)}" title="Remove item"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button></div>`).join('')
      : '<p class="daily-task-checklist-empty">No checklist items yet.</p>';
  }

  function renderDailyTaskDraftChecklist() {
    $('#dailyTaskDraftChecklistCount').textContent = plural(pendingDailyTaskChecklist.length, 'item');
    $('#dailyTaskDraftChecklist').innerHTML = pendingDailyTaskChecklist.map((item, index) => `<li><span>${escapeHtml(item.text)}</span><button type="button" data-daily-task-draft-delete="${escapeHtml(item.id)}" aria-label="Remove checklist item: ${escapeHtml(item.text)}" title="Remove item"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button></li>`).join('');
  }

  function addDailyTaskDraftChecklistItem() {
    const input = $('#dailyTaskChecklistInput');
    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }
    pendingDailyTaskChecklist.push({ id: uid(), text, completed: false });
    input.value = '';
    renderDailyTaskDraftChecklist();
    input.focus();
  }

  function resetDailyTaskDraft() {
    $('#dailyTaskForm').reset();
    pendingDailyTaskChecklist = [];
    $('#dailyTaskDestinationField').classList.add('hidden');
    renderDailyTaskDraftChecklist();
  }

  function closeDailyTaskAddModal() {
    $('#dailyTaskAddModal').close();
  }

  function renderDailyTaskDetails(task) {
    const relatedName = dailyTaskRelatedName(task);
    const relatedLabel = task.relatedType === 'client' ? 'Client' : task.relatedType === 'application' ? 'Application' : '';
    const completed = Boolean(task.completedAt);
    $('#dailyTaskDetailTitle').textContent = task.title || 'Untitled task';
    $('#dailyTaskDetailSummary').innerHTML = `
      <div class="daily-task-detail-facts">
        <div><span>Type</span><strong>${escapeHtml(DAILY_TASK_TYPES[task.type] || DAILY_TASK_TYPES.task)}</strong></div>
        <div><span>Planned for</span><strong>${escapeHtml(formatDate(task.taskDate))}</strong></div>
        <div><span>Status</span><strong class="daily-task-detail-status${completed ? ' is-complete' : ''}">${completed ? 'Completed' : 'Pending'}</strong></div>
        ${relatedName ? `<div><span>${relatedLabel}</span><strong>${escapeHtml(relatedName)}</strong></div>` : ''}
        ${task.destination ? `<div><span>Apply destination</span><strong>${escapeHtml(task.destination)}</strong></div>` : ''}
      </div>
      ${task.notes ? `<section class="daily-task-detail-notes"><span>Notes or content</span><p>${escapeHtml(task.notes)}</p></section>` : ''}
      <button class="button ${completed ? 'button-secondary' : 'button-primary'} daily-task-detail-complete" type="button" data-daily-task-toggle="${escapeHtml(task.id)}"><i class="fa-solid ${completed ? 'fa-rotate-left' : 'fa-check'}" aria-hidden="true"></i> ${completed ? 'Reopen task' : 'Complete task'}</button>`;
    $('#dailyTaskChecklistForm').hidden = completed;
    $('#dailyTaskChecklistLocked').hidden = !completed;
    renderDailyTaskChecklist(task);
  }

  function openDailyTaskDetails(taskId) {
    const task = (data.dailyTasks || []).find(item => item.id === taskId);
    if (!task) return;
    activeDailyTaskId = task.id;
    renderDailyTaskDetails(task);
    $('#dailyTaskDetailModal').showModal();
  }

  function renderDailyTaskItem(task, history = false) {
    const completed = Boolean(task.completedAt);
    const actionLabel = completed ? 'Mark incomplete' : 'Mark complete';
    return `
      <article class="daily-task-item${completed ? ' is-complete' : ''}${history ? ' is-history' : ''}">
        <button class="daily-task-action" type="button" data-daily-task-toggle="${escapeHtml(task.id)}" aria-label="${actionLabel}: ${escapeHtml(task.title || 'task')}" aria-pressed="${completed}" title="${actionLabel}"><i class="fa-solid fa-check" aria-hidden="true"></i></button>
        <button class="daily-task-row-open" type="button" data-daily-task-open="${escapeHtml(task.id)}" aria-label="View details for ${escapeHtml(task.title || 'task')}">
          <span class="daily-task-item-title">${escapeHtml(task.title || 'Untitled task')}</span>
        </button>
        ${dailyTaskDateStatus(task)}
        <button class="daily-task-delete" type="button" data-daily-task-delete="${escapeHtml(task.id)}" aria-label="Delete task: ${escapeHtml(task.title || 'task')}" title="Delete task"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>
      </article>`;
  }

  function renderDailyTasks() {
    const planDate = $('#dailyTaskDate');
    const historyDate = $('#dailyTaskHistoryDate');
    if (!planDate || !historyDate) return;
    if (!planDate.value) planDate.value = today();
    if (!historyDate.value) historyDate.value = planDate.value;
    dailyTaskRelatedOptions();
    const selectedDate = planDate.value;
    const allTasks = data.dailyTasks || [];
    const dateTasks = allTasks.filter(task => task.taskDate === selectedDate);
    const overdueTasks = allTasks.filter(task => !task.completedAt && task.taskDate < today());
    const completedCount = dateTasks.filter(task => task.completedAt).length;
    const remainingCount = dateTasks.length - completedCount;
    const dateLabel = formatDate(selectedDate);
    $('#dailyTaskHeaderDate').textContent = dateLabel;
    $('#dailyTaskDateLabel').textContent = dateLabel;
    $('#dailyTaskToday').disabled = selectedDate === today();
    $('#dailyTaskScheduledCount').textContent = dateTasks.length;
    $('#dailyTaskCompletedCount').textContent = completedCount;
    $('#dailyTaskRemainingCount').textContent = remainingCount;
    $('#dailyTaskOverdueCount').textContent = overdueTasks.length;
    const overdueButton = $('#dailyTaskOverdueFilter');
    overdueButton.hidden = overdueTasks.length === 0;
    overdueButton.classList.toggle('has-overdue', overdueTasks.length > 0);
    overdueButton.classList.toggle('is-active', dailyTaskFilter === 'overdue');
    $('#dailyTaskProgressLabel').textContent = `${completedCount} of ${dateTasks.length} done`;
    const progress = $('#dailyTaskProgress');
    progress.setAttribute('aria-valuemax', String(dateTasks.length));
    progress.setAttribute('aria-valuenow', String(completedCount));
    progress.querySelector('span').style.width = `${dateTasks.length ? Math.round(completedCount / dateTasks.length * 100) : 0}%`;
    const overdueIds = new Set(overdueTasks.map(task => task.id));
    const query = $('#dailyTaskSearch').value.trim().toLowerCase();
    const matchesSearch = task => !query || [
      task.title, task.notes, task.destination, task.relatedName,
      DAILY_TASK_TYPES[task.type] || task.type,
      dailyTaskRelatedName(task)
    ].join(' ').toLowerCase().includes(query);
    const visibleOverdueTasks = overdueTasks.filter(matchesSearch);
    const sortTasks = tasks => tasks.sort((first, second) => String(first.createdAt || '').localeCompare(String(second.createdAt || '')));
    const selectedTasks = dateTasks.filter(task => dailyTaskFilter === 'completed'
      ? Boolean(task.completedAt)
      : dailyTaskFilter === 'remaining'
        ? !task.completedAt
        : true).filter(matchesSearch);
    const tasks = dailyTaskFilter === 'overdue'
      ? sortTasks([...visibleOverdueTasks])
      : dailyTaskFilter === 'all'
        ? [...sortTasks([...visibleOverdueTasks]), ...sortTasks(selectedTasks.filter(task => !overdueIds.has(task.id)))]
        : sortTasks(selectedTasks);
    $('#navDailyTaskCount').textContent = allTasks.filter(task => task.taskDate === today()).length;
    $('#dailyTaskListTitle').textContent = 'Tasks';
    const overdueGroup = (dailyTaskFilter === 'all' || dailyTaskFilter === 'overdue') && visibleOverdueTasks.length
      ? `<h4 class="daily-task-overdue-heading">Overdue</h4>${sortTasks([...visibleOverdueTasks]).map(task => renderDailyTaskItem(task)).join('')}`
      : '';
    const nonOverdueTasks = dailyTaskFilter === 'all'
      ? tasks.filter(task => !overdueIds.has(task.id))
      : dailyTaskFilter === 'overdue' ? [] : tasks;
    const taskMarkup = `${overdueGroup}${nonOverdueTasks.map(task => renderDailyTaskItem(task)).join('')}`;
    $('#dailyTaskList').innerHTML = tasks.length
      ? taskMarkup
      : `<div class="daily-task-empty"><i class="fa-regular ${query ? 'fa-face-frown' : 'fa-circle-check'}" aria-hidden="true"></i><span>${query ? 'No tasks match your search.' : dailyTaskFilter === 'all' && selectedDate === today() || dailyTaskFilter === 'overdue' ? 'You’re all caught up.' : dailyTaskFilter === 'completed' ? 'No completed tasks for this date.' : dailyTaskFilter === 'remaining' ? 'No remaining tasks for this date.' : 'No tasks planned for this date.'}</span></div>`;

    const historyTasks = (data.dailyTasks || []).filter(task => task.completedAt && dateKey(task.completedAt) === historyDate.value)
      .filter(matchesSearch)
      .sort((first, second) => String(second.completedAt).localeCompare(String(first.completedAt)));
    $('#dailyTaskHistoryCount').textContent = historyTasks.length;
    $('#dailyTaskHistoryList').innerHTML = historyTasks.length
      ? historyTasks.map(task => renderDailyTaskItem(task, true)).join('')
      : '<div class="daily-task-history-empty"><i class="fa-regular fa-calendar-check" aria-hidden="true"></i><span>No completed tasks for this date yet.</span></div>';
    if ($('#dailyTaskDetailModal').open) {
      const activeTask = (data.dailyTasks || []).find(task => task.id === activeDailyTaskId);
      if (activeTask) renderDailyTaskDetails(activeTask);
      else $('#dailyTaskDetailModal').close();
    }
  }

  $('#dailyTaskType').addEventListener('change', event => {
    $('#dailyTaskDestinationField').classList.toggle('hidden', event.target.value !== 'apply');
  });
  $('#openDailyTaskAddModal').addEventListener('click', () => {
    resetDailyTaskDraft();
    $('#dailyTaskAddModal').showModal();
    $('#dailyTaskTitle').focus();
  });
  $('#closeDailyTaskAddModal').addEventListener('click', closeDailyTaskAddModal);
  $('#cancelDailyTaskAddModal').addEventListener('click', closeDailyTaskAddModal);
  $('#dailyTaskAddModal').addEventListener('close', resetDailyTaskDraft);
  $('#dailyTaskAddChecklistButton').addEventListener('click', addDailyTaskDraftChecklistItem);
  $('#dailyTaskChecklistInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addDailyTaskDraftChecklistItem();
    }
  });
  $('#dailyTaskDate').addEventListener('change', () => {
    $('#dailyTaskHistoryDate').value = $('#dailyTaskDate').value;
    renderDailyTasks();
  });
  $('#dailyTaskDateLabel').addEventListener('click', () => {
    const input = $('#dailyTaskDate');
    if (typeof input.showPicker === 'function') input.showPicker();
    else input.click();
  });
  $('#dailyTaskPreviousDate').addEventListener('click', () => {
    $('#dailyTaskDate').value = addDays($('#dailyTaskDate').value, -1);
    $('#dailyTaskHistoryDate').value = $('#dailyTaskDate').value;
    renderDailyTasks();
  });
  $('#dailyTaskNextDate').addEventListener('click', () => {
    $('#dailyTaskDate').value = addDays($('#dailyTaskDate').value, 1);
    $('#dailyTaskHistoryDate').value = $('#dailyTaskDate').value;
    renderDailyTasks();
  });
  $('#dailyTaskToday').addEventListener('click', () => {
    $('#dailyTaskDate').value = today();
    $('#dailyTaskHistoryDate').value = today();
    renderDailyTasks();
  });
  $('#dailyTaskHistoryDate').addEventListener('change', renderDailyTasks);
  $('#dailyTaskSearch').addEventListener('input', renderDailyTasks);
  $('#dailyTaskQuickAdd').addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.value = '';
      renderDailyTasks();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const title = event.currentTarget.value.trim();
      if (!title) return;
      data.dailyTasks = data.dailyTasks || [];
      data.dailyTasks.push({
        id: uid(),
        title,
        type: 'task',
        taskDate: $('#dailyTaskDate').value || today(),
        relatedType: '',
        relatedId: '',
        relatedName: '',
        destination: '',
        notes: '',
        checklist: [],
        createdAt: new Date().toISOString(),
        completedAt: ''
      });
      event.currentTarget.value = '';
      persist();
      renderDailyTasks();
      event.currentTarget.focus();
    }
  });
  $('#dailyTaskFilter').addEventListener('change', event => {
    dailyTaskFilter = event.target.value;
    renderDailyTasks();
  });
  $('#dailyTaskOverdueFilter').addEventListener('click', () => {
    dailyTaskFilter = 'overdue';
    $('#dailyTaskFilter').value = 'overdue';
    renderDailyTasks();
  });
  $('#dailyTaskForm').addEventListener('submit', event => {
    event.preventDefault();
    const title = $('#dailyTaskTitle').value.trim();
    if (!title) return;
    const [relatedType = '', relatedId = ''] = $('#dailyTaskRelated').value.split(':');
    const relatedRecord = relatedId ? data.applications.find(item => item.id === relatedId) : null;
    data.dailyTasks = data.dailyTasks || [];
    data.dailyTasks.push({
      id: uid(),
      title,
      type: $('#dailyTaskType').value,
      taskDate: $('#dailyTaskDate').value || today(),
      relatedType,
      relatedId,
      relatedName: relatedRecord?.clientName || relatedRecord?.role || '',
      destination: $('#dailyTaskType').value === 'apply' ? $('#dailyTaskDestination').value.trim() : '',
      notes: $('#dailyTaskNotes').value.trim(),
      checklist: pendingDailyTaskChecklist.map(item => ({ ...item })),
      createdAt: new Date().toISOString(),
      completedAt: ''
    });
    persist();
    closeDailyTaskAddModal();
    renderDailyTasks();
    $('#openDailyTaskAddModal').focus();
  });
  $('#dailyTaskDetailModal').addEventListener('close', () => { activeDailyTaskId = ''; });
  $('#closeDailyTaskDetails').addEventListener('click', () => $('#dailyTaskDetailModal').close());
  $('#closeDailyTaskDetailsAction').addEventListener('click', () => $('#dailyTaskDetailModal').close());
  $('#dailyTaskChecklistForm').addEventListener('submit', event => {
    event.preventDefault();
    const task = (data.dailyTasks || []).find(item => item.id === activeDailyTaskId);
    const text = $('#dailyTaskChecklistItemInput').value.trim();
    if (!task || task.completedAt || !text) return;
    task.checklist = task.checklist || [];
    task.checklist.push({ id: uid(), text, completed: false });
    persist();
    event.currentTarget.reset();
    renderDailyTasks();
    $('#dailyTaskChecklistItemInput').focus();
  });

  document.addEventListener('change', event => {
    const checkbox = event.target.closest('[data-daily-task-check]');
    if (!checkbox) return;
    const task = (data.dailyTasks || []).find(item => item.id === checkbox.dataset.taskId);
    const checklistItem = task?.checklist?.find(item => item.id === checkbox.dataset.dailyTaskCheck);
    if (!checklistItem) return;
    checklistItem.completed = checkbox.checked;
    persist();
    renderDailyTasks();
  });

  document.addEventListener('click', async event => {
    const openButton = event.target.closest('[data-daily-task-open]');
    if (openButton) {
      openDailyTaskDetails(openButton.dataset.dailyTaskOpen);
      return;
    }
    const checklistDeleteButton = event.target.closest('[data-daily-task-check-delete]');
    if (checklistDeleteButton) {
      const task = (data.dailyTasks || []).find(item => item.id === checklistDeleteButton.dataset.taskId);
      if (!task) return;
      task.checklist = (task.checklist || []).filter(item => item.id !== checklistDeleteButton.dataset.dailyTaskCheckDelete);
      persist();
      renderDailyTasks();
      return;
    }
    const historyShortcut = event.target.closest('[data-task-history-offset]');
    if (historyShortcut) {
      $('#dailyTaskHistoryDate').value = addDays(today(), Number(historyShortcut.dataset.taskHistoryOffset));
      renderDailyTasks();
      return;
    }
    const undoButton = event.target.closest('#undoDailyTaskDelete');
    if (undoButton && pendingDailyTaskUndo) {
      clearTimeout(dailyTaskUndoTimer);
      const { task, index } = pendingDailyTaskUndo;
      data.dailyTasks = data.dailyTasks || [];
      data.dailyTasks.splice(Math.min(index, data.dailyTasks.length), 0, task);
      pendingDailyTaskUndo = null;
      $('#dailyTaskUndoToast').hidden = true;
      persist();
      renderDailyTasks();
      return;
    }
    const toggleButton = event.target.closest('[data-daily-task-toggle]');
    if (toggleButton) {
      const task = (data.dailyTasks || []).find(item => item.id === toggleButton.dataset.dailyTaskToggle);
      if (!task) return;
      task.completedAt = task.completedAt ? '' : new Date().toISOString();
      persist();
      renderDailyTasks();
      return;
    }
    const deleteButton = event.target.closest('[data-daily-task-delete]');
    if (deleteButton) {
      const index = (data.dailyTasks || []).findIndex(item => item.id === deleteButton.dataset.dailyTaskDelete);
      if (index < 0) return;
      const [task] = data.dailyTasks.splice(index, 1);
      pendingDailyTaskUndo = { task, index };
      const undoToast = $('#dailyTaskUndoToast');
      undoToast.hidden = false;
      clearTimeout(dailyTaskUndoTimer);
      dailyTaskUndoTimer = setTimeout(() => {
        pendingDailyTaskUndo = null;
        undoToast.hidden = true;
      }, 5000);
      persist();
      renderDailyTasks();
    }
  });
  document.addEventListener('click', event => {
    const deleteDraftButton = event.target.closest('[data-daily-task-draft-delete]');
    if (!deleteDraftButton) return;
    pendingDailyTaskChecklist = pendingDailyTaskChecklist.filter(item => item.id !== deleteDraftButton.dataset.dailyTaskDraftDelete);
    renderDailyTaskDraftChecklist();
  });

  document.addEventListener('keydown', event => {
    if (!$('#dailyTaskView').classList.contains('active') || $('#dailyTaskAddModal').open || $('#dailyTaskDetailModal').open) return;
    const target = event.target;
    const editing = target instanceof HTMLElement
      && (target.matches('input, textarea, select, [contenteditable="true"]') || target.closest('[contenteditable="true"]'));
    if ((event.key === 'n' || event.key === 'N') && !editing && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      $('#dailyTaskQuickAdd').focus();
      return;
    }
    const taskButton = target instanceof Element ? target.closest('[data-daily-task-open]') : null;
    if (taskButton && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      const task = (data.dailyTasks || []).find(item => item.id === taskButton.dataset.dailyTaskOpen);
      if (!task) return;
      task.completedAt = task.completedAt ? '' : new Date().toISOString();
      persist();
      renderDailyTasks();
      document.querySelector(`[data-daily-task-open="${CSS.escape(task.id)}"]`)?.focus();
    }
  });

  renderDailyTasks();