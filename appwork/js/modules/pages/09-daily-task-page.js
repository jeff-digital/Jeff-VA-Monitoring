  const DAILY_TASK_TYPES = {
    task: 'General task',
    client: 'Client work',
    application: 'Application',
    apply: 'Apply somewhere',
    content: 'Content'
  };
  let activeDailyTaskId = '';
  let pendingDailyTaskChecklist = [];

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
        <div><span>Status</span><strong class="daily-task-detail-status${completed ? ' is-complete' : ''}">${completed ? 'Completed' : 'In progress'}</strong></div>
        ${relatedName ? `<div><span>${relatedLabel}</span><strong>${escapeHtml(relatedName)}</strong></div>` : ''}
        ${task.destination ? `<div><span>Apply destination</span><strong>${escapeHtml(task.destination)}</strong></div>` : ''}
      </div>
      ${task.notes ? `<section class="daily-task-detail-notes"><span>Notes or content</span><p>${escapeHtml(task.notes)}</p></section>` : ''}
      <button class="button ${completed ? 'button-secondary' : 'button-primary'} daily-task-detail-complete" type="button" data-daily-task-toggle="${escapeHtml(task.id)}"><i class="fa-solid ${completed ? 'fa-rotate-left' : 'fa-check'}" aria-hidden="true"></i> ${completed ? 'Reopen task' : 'Complete task'}</button>`;
    renderDailyTaskChecklist(task);
  }

  function openDailyTaskDetails(taskId) {
    const task = (data.dailyTasks || []).find(item => item.id === taskId);
    if (!task) return;
    activeDailyTaskId = task.id;
    renderDailyTaskDetails(task);
    $('#dailyTaskDetailModal').showModal();
  }

  function renderDailyTaskItem(task, history = false, number = 1) {
    const completed = Boolean(task.completedAt);
    const relatedName = dailyTaskRelatedName(task);
    const relationLabel = task.relatedType === 'client' ? 'Client' : 'Application';
    const actionLabel = completed ? 'Reopen' : 'Complete';
    const actionIcon = completed ? 'fa-rotate-left' : 'fa-check';
    return `
      <article class="daily-task-item${completed ? ' is-complete' : ''}">
        <button class="daily-task-row-open" type="button" data-daily-task-open="${escapeHtml(task.id)}" aria-label="View details for ${escapeHtml(task.title || 'task')}">
          <span class="daily-task-item-number" aria-hidden="true">${String(number).padStart(2, '0')}</span>
          <span class="daily-task-item-copy">
            <span class="daily-task-item-title">${escapeHtml(task.title || 'Untitled task')}</span>
            <span class="daily-task-item-meta"><span class="daily-task-type daily-task-type-${escapeHtml(task.type || 'task')}">${escapeHtml(DAILY_TASK_TYPES[task.type] || DAILY_TASK_TYPES.task)}</span>${relatedName ? `<span><i class="fa-solid ${task.relatedType === 'client' ? 'fa-user-tie' : 'fa-briefcase'}" aria-hidden="true"></i> ${relationLabel}: ${escapeHtml(relatedName)}</span>` : ''}${task.destination ? `<span><i class="fa-solid fa-location-arrow" aria-hidden="true"></i> ${escapeHtml(task.destination)}</span>` : ''}</span>
            ${task.checklist?.length ? `<span class="daily-task-checklist-progress"><i class="fa-solid fa-list-check" aria-hidden="true"></i> ${task.checklist.filter(item => item.completed).length}/${task.checklist.length} checked</span>` : ''}
            ${task.notes ? `<span class="daily-task-item-notes">${escapeHtml(task.notes)}</span>` : ''}
            ${history ? `<time datetime="${escapeHtml(task.completedAt || '')}">Completed ${escapeHtml(relativeDate(task.completedAt))}</time>` : ''}
          </span>
        </button>
        <div class="daily-task-item-actions"><button class="daily-task-action" type="button" data-daily-task-toggle="${escapeHtml(task.id)}" aria-label="${actionLabel}: ${escapeHtml(task.title || 'task')}" title="${actionLabel}"><i class="fa-solid ${actionIcon}" aria-hidden="true"></i></button><button class="daily-task-delete" type="button" data-daily-task-delete="${escapeHtml(task.id)}" aria-label="Delete: ${escapeHtml(task.title || 'task')}" title="Delete task"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button></div>
      </article>`;
  }

  function renderDailyTasks() {
    const planDate = $('#dailyTaskDate');
    const historyDate = $('#dailyTaskHistoryDate');
    if (!planDate || !historyDate) return;
    if (!planDate.value) planDate.value = today();
    if (!historyDate.value) historyDate.value = addDays(today(), -1);
    dailyTaskRelatedOptions();
    const selectedDate = planDate.value;
    const tasks = (data.dailyTasks || []).filter(task => task.taskDate === selectedDate)
      .sort((first, second) => Number(Boolean(first.completedAt)) - Number(Boolean(second.completedAt)) || String(first.createdAt || '').localeCompare(String(second.createdAt || '')));
    $('#navDailyTaskCount').textContent = (data.dailyTasks || []).filter(task => task.taskDate === today()).length;
    $('#dailyTaskListTitle').textContent = `Tasks for ${formatDate(selectedDate)}`;
    $('#dailyTaskCount').textContent = plural(tasks.length, 'task');
    $('#dailyTaskList').innerHTML = tasks.length
      ? tasks.map((task, index) => renderDailyTaskItem(task, false, index + 1)).join('')
      : '<div class="daily-task-empty"><span aria-hidden="true"><i class="fa-regular fa-calendar-check"></i></span><strong>No tasks planned</strong><p>Add a task for this day to get your list started.</p></div>';

    const historyTasks = (data.dailyTasks || []).filter(task => task.completedAt && dateKey(task.completedAt) === historyDate.value)
      .sort((first, second) => String(second.completedAt).localeCompare(String(first.completedAt)));
    $('#dailyTaskHistoryList').innerHTML = historyTasks.length
      ? historyTasks.map((task, index) => renderDailyTaskItem(task, true, index + 1)).join('')
      : '<div class="daily-task-history-empty">No completed tasks for this date.</div>';
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
  $('#dailyTaskDate').addEventListener('change', renderDailyTasks);
  $('#dailyTaskHistoryDate').addEventListener('change', renderDailyTasks);
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
    if (!task || !text) return;
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
      if (!(await appConfirm('Delete this task and its completion history?', { title: 'Delete task', confirmLabel: 'Delete task', danger: true }))) return;
      data.dailyTasks = (data.dailyTasks || []).filter(item => item.id !== deleteButton.dataset.dailyTaskDelete);
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