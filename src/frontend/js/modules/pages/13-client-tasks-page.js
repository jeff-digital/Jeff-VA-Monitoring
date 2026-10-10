// Task management belongs to the selected Active Client and is persisted with the app state.
const CLIENT_TASK_CATEGORIES = ['Graphic Design', 'Social Media', 'Email Marketing', 'Digital Marketing', 'Web Development', 'Other'];
const CLIENT_TASK_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
let clientTaskEditingId = '';
let clientTaskDrawerReturnFocus = null;
let clientTaskDrawerOpen = false;
let clientTaskDrawerClosing = false;
let clientTaskDrawerCloseTimer = null;
let clientTaskDraftEntries = [];
let clientTaskTickTimer = null;
let clientTaskMenuOpenId = '';

function getClientTasks(clientId = hiredEditingId) {
  data.clientTasks = Array.isArray(data.clientTasks) ? data.clientTasks : [];
  return data.clientTasks.filter(task => task.clientId === clientId);
}

function clientTaskIsEnded(clientId = hiredEditingId) {
  const client = data.applications.find(application => application.id === clientId);
  return Boolean(client && (client.contractStatus === 'Contract Ended' || isContractEnded(client)));
}

function saveClientTasks() {
  persist().catch(error => console.error('Could not save Active Client tasks:', error));
}

function clientTaskLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function clientTaskTimeEntries(task) {
  return Array.isArray(task.timeEntries) ? task.timeEntries : [];
}

function clientTaskElapsed(entry, now = Date.now()) {
  if (Number.isFinite(entry.durationMs)) return Math.max(0, entry.durationMs);
  const start = new Date(entry.start || '').getTime();
  const end = new Date(entry.end || '').getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

function clientTaskTotalMs(task, now = Date.now()) {
  const entries = clientTaskTimeEntries(task).reduce((total, entry) => total + clientTaskElapsed(entry, now), 0);
  const startedAt = new Date(task.timerStartedAt || '').getTime();
  return entries + (Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : 0);
}

function clientTaskFormatDuration(milliseconds) {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m` : `${seconds}s`;
}

function clientTaskClock(milliseconds) {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function clientTaskMonthlyMs(tasks, now = new Date()) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  let total = 0;
  tasks.forEach(task => {
    clientTaskTimeEntries(task).forEach(entry => {
      const start = new Date(entry.start || '').getTime();
      const end = new Date(entry.end || '').getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end)) return;
      total += Math.max(0, Math.min(end, nextMonth) - Math.max(start, monthStart));
    });
    const running = new Date(task.timerStartedAt || '').getTime();
    if (Number.isFinite(running)) total += Math.max(0, Math.min(now.getTime(), nextMonth) - Math.max(running, monthStart));
  });
  return total;
}

function clientTaskWeekEnd() {
  const current = new Date();
  current.setHours(12, 0, 0, 0);
  current.setDate(current.getDate() + (7 - current.getDay()) % 7);
  return clientTaskLocalDateKey(current);
}

function clientTaskFiltered(tasks) {
  const query = $('#clientTaskSearch').value.trim().toLowerCase();
  const status = $('#clientTaskStatusFilter').value;
  const priority = $('#clientTaskPriorityFilter').value;
  return tasks.filter(task => {
    const taskStatus = task.status === 'done' || task.completedAt ? 'done' : task.status || 'todo';
    const content = `${task.title || ''} ${task.category || ''} ${task.notes || ''}`.toLowerCase();
    return (status === 'all' || taskStatus === status)
      && (priority === 'all' || task.priority === priority)
      && (!query || content.includes(query));
  });
}

function clientTaskDueLabel(task) {
  if (!task.dueDate) return '<span class="client-task-due no-date">No due date</span>';
  const overdue = task.dueDate < today() && task.status !== 'done' && !task.completedAt;
  return `<time class="client-task-due${overdue ? ' is-overdue' : ''}" datetime="${escapeHtml(task.dueDate)}">${overdue ? '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ' : ''}${escapeHtml(formatDate(task.dueDate))}</time>`;
}

function clientTaskRenderRow(task, ended) {
  const done = task.status === 'done' || Boolean(task.completedAt);
  const running = Boolean(task.timerStartedAt);
  const priority = ['Low', 'Medium', 'High'].includes(task.priority) ? task.priority : 'Medium';
  const time = clientTaskTotalMs(task);
  const repeatIcon = task.repeat?.frequency && task.repeat.frequency !== 'none'
    ? '<span class="client-task-recurring" title="Recurring task" aria-label="Recurring task"><i class="fa-solid fa-repeat" aria-hidden="true"></i></span>'
    : '';
  const menuOpen = clientTaskMenuOpenId === task.id;
  return `<article class="client-task-row${done ? ' is-complete' : ''}${running ? ' is-running' : ''}" data-client-task-row="${escapeHtml(task.id)}">
    <label class="client-task-complete-control"><input type="checkbox" data-client-task-complete="${escapeHtml(task.id)}" ${done ? 'checked' : ''} aria-label="${done ? 'Reopen' : 'Complete'} task: ${escapeHtml(task.title || 'Untitled task')}" /><span class="sr-only">${done ? 'Completed' : 'Mark complete'}</span></label>
    <div class="client-task-row-main">
      <div class="client-task-row-title-line"><button class="client-task-title-button" type="button" data-client-task-edit="${escapeHtml(task.id)}">${escapeHtml(task.title || 'Untitled task')}</button><span class="client-task-category">${escapeHtml(CLIENT_TASK_CATEGORIES.includes(task.category) ? task.category : 'Other')}</span></div>
      <div class="client-task-row-meta"><span class="client-task-priority priority-${priority.toLowerCase()}"><i aria-hidden="true"></i>${priority}</span>${clientTaskDueLabel(task)}${repeatIcon}<span class="client-task-status-text">${done ? 'Done' : task.status === 'in-progress' ? 'In progress' : 'To do'}</span></div>
    </div>
    <span class="client-task-time-logged" data-client-task-time="${escapeHtml(task.id)}">${escapeHtml(clientTaskFormatDuration(time))}</span>
    <span class="client-task-live-clock${running ? ' is-visible' : ''}" data-client-task-clock="${escapeHtml(task.id)}">${running ? clientTaskClock(time) : ''}</span>
    <button class="client-task-timer-button${running ? ' is-running' : ''}" type="button" data-client-task-timer="${escapeHtml(task.id)}" ${ended || done ? 'disabled' : ''} aria-label="${running ? 'Pause timer' : 'Start timer'} for ${escapeHtml(task.title || 'task')}" title="${ended ? 'Timers are disabled for ended contracts' : running ? 'Pause timer' : 'Start timer'}"><i class="fa-solid ${running ? 'fa-pause' : 'fa-play'}" aria-hidden="true"></i></button>
    <div class="client-task-menu-wrap">
      <button class="client-task-menu-button" type="button" data-client-task-menu="${escapeHtml(task.id)}" aria-label="Task actions for ${escapeHtml(task.title || 'task')}" aria-expanded="${menuOpen}"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button>
      <div class="client-task-menu${menuOpen ? '' : ' hidden'}" role="menu">
        <button type="button" role="menuitem" data-client-task-edit="${escapeHtml(task.id)}">Edit</button>
        <button type="button" role="menuitem" data-client-task-duplicate="${escapeHtml(task.id)}" ${ended ? 'disabled title="New tasks are disabled for ended contracts"' : ''}>Duplicate</button>
        <button type="button" role="menuitem" class="is-danger" data-client-task-delete="${escapeHtml(task.id)}">Delete</button>
      </div>
    </div>
  </article>`;
}

function clientTaskGroupMarkup(group, tasks, ended, open = true) {
  if (!tasks.length) return '';
  const rows = tasks.sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'))
    || String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .map(task => clientTaskRenderRow(task, ended)).join('');
  const completed = group === 'Completed';
  return `<details class="client-task-group${completed ? ' is-completed-group' : ''}" data-client-task-group="${group}" ${completed ? (open ? 'open' : '') : 'open'}>
    <summary><span>${group}</span><span class="client-task-group-count">${tasks.length}</span></summary>
    <div class="client-task-group-rows">${rows}</div>
  </details>`;
}

function renderClientTasks(clientId = hiredEditingId) {
  if (!clientId) return;
  const tasks = getClientTasks(clientId);
  const now = new Date();
  const day = today();
  const weekEnd = clientTaskWeekEnd();
  const openTasks = tasks.filter(task => (task.status || 'todo') !== 'done' && !task.completedAt);
  const overdueCount = openTasks.filter(task => task.dueDate && task.dueDate < day).length;
  const weekCount = openTasks.filter(task => task.dueDate && task.dueDate >= day && task.dueDate <= weekEnd).length;
  $('#clientTaskOpenCount').textContent = String(openTasks.length);
  $('#clientTaskWeekCount').textContent = String(weekCount);
  const monthHours = clientTaskMonthlyMs(tasks, now);
  $('#clientTaskMonthHours').textContent = clientTaskFormatDuration(monthHours);
  const overdueSummary = $('#clientTaskOverdueCount');
  overdueSummary.textContent = String(overdueCount);
  overdueSummary.classList.toggle('has-overdue', overdueCount > 0);
  $('#clientTaskTabCount').textContent = String(openTasks.length);
  $('#clientTasksContractNotice').hidden = !clientTaskIsEnded(clientId);
  $('#newClientTaskButton').disabled = clientTaskIsEnded(clientId);
  $('#newClientTaskButton').title = clientTaskIsEnded(clientId) ? 'New tasks are disabled for ended contracts' : '';

  const target = $('#clientTaskGroups');
  const priorCompletedOpen = target.querySelector('[data-client-task-group="Completed"]')?.open;
  const visible = clientTaskFiltered(tasks);
  if (!visible.length) {
    const hasAnyTasks = tasks.length > 0;
    target.innerHTML = `<div class="client-task-empty"><i class="fa-regular ${hasAnyTasks ? 'fa-filter' : 'fa-clipboard'}" aria-hidden="true"></i><h3>${hasAnyTasks ? 'No tasks match these filters' : 'No tasks for this client yet'}</h3><p>${hasAnyTasks ? 'Try adjusting the search or filters.' : 'Keep this client’s work organized in one place.'}</p>${hasAnyTasks ? '' : `<button class="button button-primary" type="button" data-client-task-new ${clientTaskIsEnded(clientId) ? 'disabled' : ''}><i class="fa-solid fa-plus" aria-hidden="true"></i> New task</button>`}</div>`;
    return;
  }

  const done = visible.filter(task => task.status === 'done' || task.completedAt);
  const active = visible.filter(task => !done.includes(task));
  const groups = {
    Overdue: active.filter(task => task.dueDate && task.dueDate < day),
    Today: active.filter(task => task.dueDate === day),
    'This week': active.filter(task => task.dueDate > day && task.dueDate <= weekEnd),
    Later: active.filter(task => !task.dueDate || task.dueDate > weekEnd),
    Completed: done
  };
  target.innerHTML = Object.entries(groups)
    .map(([name, entries]) => clientTaskGroupMarkup(name, entries, clientTaskIsEnded(clientId), name === 'Completed' ? Boolean(priorCompletedOpen) : true))
    .join('');
}

function clientTaskRepeatValue() {
  const frequency = $('#clientTaskRepeat').value;
  if (frequency === 'weekly') {
    const weekdays = $$('#clientTaskWeekdays input:checked').map(input => Number(input.value)).sort((a, b) => a - b);
    return { frequency, weekdays };
  }
  if (frequency === 'monthly') return { frequency, dayOfMonth: Number($('#clientTaskMonthDay').value) };
  return { frequency, weekdays: [], dayOfMonth: null };
}

function updateClientTaskRepeatFields() {
  const frequency = $('#clientTaskRepeat').value;
  $('#clientTaskWeekdays').hidden = frequency !== 'weekly';
  $('#clientTaskMonthDayField').hidden = frequency !== 'monthly';
  const preview = $('#clientTaskRepeatPreview');
  if (frequency === 'daily') preview.textContent = 'Repeats every day.';
  else if (frequency === 'weekly') {
    const selected = $$('#clientTaskWeekdays input:checked').map(input => CLIENT_TASK_WEEKDAYS[Number(input.value)]);
    preview.textContent = selected.length ? `Repeats every ${selected.join(', ')}.` : 'Choose one or more weekdays.';
  } else if (frequency === 'monthly') preview.textContent = `Repeats on day ${$('#clientTaskMonthDay').value} of each month.`;
  else preview.textContent = 'This task will not repeat.';
}

function fillClientTaskDrawer(task = null) {
  const form = $('#clientTaskForm');
  form.reset();
  $('#clientTaskDueDate').setCustomValidity('');
  $('#clientTaskManualEnd').setCustomValidity('');
  clientTaskEditingId = task?.id || '';
  clientTaskDraftEntries = task ? clientTaskTimeEntries(task).map(entry => ({ ...entry })) : [];
  $('#clientTaskDrawerTitle').textContent = task ? 'Edit task' : 'New task';
  $('#clientTaskDrawerClientName').textContent = data.applications.find(item => item.id === hiredEditingId)?.clientName || '';
  $('#clientTaskTitle').value = task?.title || '';
  $('#clientTaskCategory').value = CLIENT_TASK_CATEGORIES.includes(task?.category) ? task.category : 'Graphic Design';
  $('#clientTaskPriority').value = ['Low', 'Medium', 'High'].includes(task?.priority) ? task.priority : 'Medium';
  $('#clientTaskDueDate').value = task?.dueDate || '';
  $('#clientTaskEstimate').value = task?.estimateMinutes ?? '';
  $('#clientTaskNotes').value = task?.notes || '';
  $('#clientTaskRepeat').value = task?.repeat?.frequency || 'none';
  $('#clientTaskWeekdays').querySelectorAll('input').forEach(input => {
    input.checked = Array.isArray(task?.repeat?.weekdays) && task.repeat.weekdays.includes(Number(input.value));
  });
  $('#clientTaskMonthDay').value = String(task?.repeat?.dayOfMonth || Number(task?.dueDate?.slice(-2)) || 1);
  $('#clientTaskTimeEditor').hidden = !task;
  $('#saveClientTaskButton').textContent = task ? 'Save changes' : 'Save task';
  updateClientTaskRepeatFields();
  renderClientTaskEntries();
  form.dataset.initialSnapshot = clientTaskFormSnapshot();
}

function openClientTaskDrawer(task = null, trigger = $('#newClientTaskButton')) {
  if (clientTaskDrawerOpen || (clientTaskIsEnded() && !task)) return;
  clientTaskDrawerReturnFocus = trigger;
  fillClientTaskDrawer(task);
  const layer = $('#clientTaskDrawerLayer');
  clearTimeout(clientTaskDrawerCloseTimer);
  clientTaskDrawerOpen = true;
  clientTaskDrawerClosing = false;
  layer.classList.remove('is-closing');
  layer.hidden = false;
  layer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('client-task-drawer-open');
  requestAnimationFrame(() => {
    if (!clientTaskDrawerOpen) return;
    layer.classList.add('is-open');
    $('#clientTaskTitle').focus();
  });
}

async function closeClientTaskDrawer() {
  if (!clientTaskDrawerOpen || clientTaskDrawerClosing) return;
  const form = $('#clientTaskForm');
  const isDirty = clientTaskFormSnapshot() !== form.dataset.initialSnapshot;
  if (isDirty && !(await appConfirm('Discard your unsaved task changes?', { title: 'Discard task changes', confirmLabel: 'Discard changes', danger: true }))) return;
  clientTaskDrawerOpen = false;
  clientTaskDrawerClosing = true;
  const layer = $('#clientTaskDrawerLayer');
  layer.classList.remove('is-open');
  layer.classList.add('is-closing');
  const finishClose = () => {
    layer.hidden = true;
    layer.classList.remove('is-closing');
    document.body.classList.remove('client-task-drawer-open');
    clientTaskDrawerClosing = false;
    clientTaskMenuOpenId = '';
    clientTaskDrawerReturnFocus?.focus();
    clientTaskDrawerReturnFocus = null;
  };
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finishClose();
  else clientTaskDrawerCloseTimer = setTimeout(finishClose, 270);
}

function clientTaskFormSnapshot() {
  return JSON.stringify({
    title: $('#clientTaskTitle').value,
    category: $('#clientTaskCategory').value,
    priority: $('#clientTaskPriority').value,
    dueDate: $('#clientTaskDueDate').value,
    estimate: $('#clientTaskEstimate').value,
    notes: $('#clientTaskNotes').value,
    manualStart: $('#clientTaskManualStart').value,
    manualEnd: $('#clientTaskManualEnd').value,
    repeat: clientTaskRepeatValue(),
    entries: clientTaskDraftEntries
  });
}

function openClientTaskEditor(taskId) {
  const task = data.clientTasks.find(item => item.id === taskId && item.clientId === hiredEditingId);
  if (!task) return;
  clientTaskMenuOpenId = '';
  renderClientTasks(hiredEditingId);
  openClientTaskDrawer(task, $('#newClientTaskButton'));
}

function renderClientTaskEntries() {
  const entries = clientTaskDraftEntries;
  const current = data.clientTasks.find(task => task.id === clientTaskEditingId);
  const liveTime = current?.timerStartedAt ? Math.max(0, Date.now() - new Date(current.timerStartedAt).getTime()) : 0;
  $('#clientTaskTotalTime').textContent = `${clientTaskFormatDuration(entries.reduce((sum, entry) => sum + clientTaskElapsed(entry), liveTime))} total`;
  $('#clientTaskTimeEntryList').innerHTML = entries.length
    ? entries.slice().reverse().map(entry => `<div class="client-task-time-entry"><span>${escapeHtml(formatDate(dateKey(entry.start)))} · ${escapeHtml(emailTime(entry.start))}–${escapeHtml(emailTime(entry.end))}</span><strong>${escapeHtml(clientTaskFormatDuration(clientTaskElapsed(entry)))}</strong><button type="button" data-client-task-entry-delete="${escapeHtml(entry.id)}" aria-label="Delete time entry" title="Delete time entry"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button></div>`).join('')
    : '<p class="client-task-time-empty">No time entries yet.</p>';
}

function clientTaskOccurrenceKey(seriesId, dueDate) {
  return `${seriesId}:${dueDate}`;
}

function clientTaskNextDueDate(task) {
  if (!task.dueDate) return '';
  const due = new Date(`${task.dueDate}T12:00:00`);
  const recurrence = task.repeat || {};
  if (recurrence.frequency === 'daily') {
    due.setDate(due.getDate() + 1);
    return clientTaskLocalDateKey(due);
  }
  if (recurrence.frequency === 'weekly') {
    const weekdays = Array.isArray(recurrence.weekdays) && recurrence.weekdays.length
      ? recurrence.weekdays
      : [due.getDay()];
    for (let offset = 1; offset <= 7; offset += 1) {
      const candidate = new Date(due);
      candidate.setDate(candidate.getDate() + offset);
      if (weekdays.includes(candidate.getDay())) return clientTaskLocalDateKey(candidate);
    }
  }
  if (recurrence.frequency === 'monthly') {
    const firstNextMonth = new Date(due.getFullYear(), due.getMonth() + 1, 1, 12);
    const targetDay = Math.max(1, Math.min(31, Number(recurrence.dayOfMonth) || due.getDate()));
    const lastDay = new Date(firstNextMonth.getFullYear(), firstNextMonth.getMonth() + 1, 0).getDate();
    firstNextMonth.setDate(Math.min(targetDay, lastDay));
    return clientTaskLocalDateKey(firstNextMonth);
  }
  return '';
}

function createNextClientTaskOccurrence(task) {
  const nextDueDate = clientTaskNextDueDate(task);
  if (!nextDueDate) return false;
  const seriesId = task.recurrenceSeriesId || task.id;
  const occurrenceKey = clientTaskOccurrenceKey(seriesId, nextDueDate);
  if (data.clientTasks.some(item => item.recurrenceOccurrenceKey === occurrenceKey)) return false;
  data.clientTasks.push({
    ...task,
    id: uid(),
    dueDate: nextDueDate,
    status: 'todo',
    completedAt: '',
    recurrenceSeriesId: seriesId,
    recurrenceOccurrenceKey: occurrenceKey,
    generatedFromTaskId: task.id,
    timerStartedAt: '',
    timeEntries: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  return true;
}

function stopClientTaskTimer(task) {
  if (!task?.timerStartedAt) return false;
  const start = new Date(task.timerStartedAt);
  const end = new Date();
  const durationMs = Math.max(0, end.getTime() - start.getTime());
  task.timeEntries = clientTaskTimeEntries(task);
  if (durationMs > 0) task.timeEntries.push({ id: uid(), start: start.toISOString(), end: end.toISOString(), durationMs });
  task.timerStartedAt = '';
  task.updatedAt = end.toISOString();
  return true;
}

async function toggleClientTaskTimer(taskId) {
  if (clientTaskIsEnded()) return;
  const task = data.clientTasks.find(item => item.id === taskId && item.clientId === hiredEditingId);
  if (!task || task.status === 'done') return;
  if (task.timerStartedAt) {
    stopClientTaskTimer(task);
  } else {
    data.clientTasks.forEach(item => {
      if (item.timerStartedAt) stopClientTaskTimer(item);
    });
    task.timerStartedAt = new Date().toISOString();
    if (task.status !== 'in-progress') task.status = 'in-progress';
  }
  saveClientTasks();
  renderClientTasks(hiredEditingId);
}

async function toggleClientTaskComplete(taskId, complete) {
  const task = data.clientTasks.find(item => item.id === taskId && item.clientId === hiredEditingId);
  if (!task) return;
  if (complete) {
    stopClientTaskTimer(task);
    task.status = 'done';
    task.completedAt = new Date().toISOString();
    task.updatedAt = task.completedAt;
    if (task.repeat?.frequency && task.repeat.frequency !== 'none') createNextClientTaskOccurrence(task);
  } else {
    task.status = 'todo';
    task.completedAt = '';
    task.updatedAt = new Date().toISOString();
  }
  saveClientTasks();
  renderClientTasks(hiredEditingId);
}

function updateClientTaskTick() {
  if (!$('#clientTasksPanel') || $('#clientTasksPanel').hidden) return;
  const tasks = getClientTasks();
  const now = Date.now();
  tasks.forEach(task => {
    const elapsed = clientTaskTotalMs(task, now);
    const logged = $(`[data-client-task-time="${CSS.escape(task.id)}"]`);
    const clock = $(`[data-client-task-clock="${CSS.escape(task.id)}"]`);
    if (logged) logged.textContent = clientTaskFormatDuration(elapsed);
    if (clock) {
      clock.textContent = task.timerStartedAt ? clientTaskClock(elapsed) : '';
      clock.classList.toggle('is-visible', Boolean(task.timerStartedAt));
    }
  });
  $('#clientTaskMonthHours').textContent = clientTaskFormatDuration(clientTaskMonthlyMs(tasks, new Date(now)));
}

function startClientTaskTick() {
  if (clientTaskTickTimer) return;
  clientTaskTickTimer = setInterval(updateClientTaskTick, 1000);
}

function initClientTaskDrawer() {
  const monthDay = $('#clientTaskMonthDay');
  monthDay.innerHTML = Array.from({ length: 31 }, (_, index) => `<option value="${index + 1}">${index + 1}${[1, 21, 31].includes(index + 1) ? 'st' : [2, 22].includes(index + 1) ? 'nd' : [3, 23].includes(index + 1) ? 'rd' : 'th'}</option>`).join('');
  $('#clientTaskForm').dataset.initialSnapshot = clientTaskFormSnapshot();
  $('#newClientTaskButton').addEventListener('click', event => openClientTaskDrawer(null, event.currentTarget));
  $('#clientTaskDrawerBackdrop').addEventListener('click', closeClientTaskDrawer);
  $('#closeClientTaskDrawer').addEventListener('click', closeClientTaskDrawer);
  $('#cancelClientTaskDrawer').addEventListener('click', closeClientTaskDrawer);
  $('#clientTaskRepeat').addEventListener('change', updateClientTaskRepeatFields);
  $('#clientTaskWeekdays').addEventListener('change', updateClientTaskRepeatFields);
  $('#clientTaskMonthDay').addEventListener('change', updateClientTaskRepeatFields);
  ['input', 'change'].forEach(type => {
    $('#clientTaskForm').addEventListener(type, () => {
      $('#clientTaskForm').dataset.dirtySnapshot = clientTaskFormSnapshot();
    });
  });
  $('#clientTaskForm').addEventListener('submit', event => {
    event.preventDefault();
    if (clientTaskIsEnded() && !clientTaskEditingId) return;
    const title = $('#clientTaskTitle').value.trim();
    const repeat = clientTaskRepeatValue();
    const dueField = $('#clientTaskDueDate');
    if (repeat.frequency !== 'none' && !dueField.value) {
      dueField.setCustomValidity('A due date is required for recurring tasks.');
      dueField.reportValidity();
      dueField.addEventListener('input', () => dueField.setCustomValidity(''), { once: true });
      return;
    }
    if (repeat.frequency === 'weekly' && !repeat.weekdays.length) {
      $('#clientTaskWeekdays').querySelector('input').focus();
      return;
    }
    const existing = data.clientTasks.find(task => task.id === clientTaskEditingId && task.clientId === hiredEditingId);
    const now = new Date().toISOString();
    const task = {
      id: existing?.id || uid(),
      clientId: hiredEditingId,
      title,
      category: $('#clientTaskCategory').value,
      priority: $('#clientTaskPriority').value,
      dueDate: dueField.value,
      estimateMinutes: $('#clientTaskEstimate').value ? Number($('#clientTaskEstimate').value) : '',
      notes: $('#clientTaskNotes').value.trim(),
      repeat,
      status: existing?.status || 'todo',
      completedAt: existing?.completedAt || '',
      timeEntries: clientTaskDraftEntries,
      timerStartedAt: existing?.timerStartedAt || '',
      recurrenceSeriesId: existing?.recurrenceSeriesId || '',
      recurrenceOccurrenceKey: existing?.recurrenceOccurrenceKey || '',
      generatedFromTaskId: existing?.generatedFromTaskId || '',
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    if (existing) {
      Object.assign(existing, task);
    } else {
      data.clientTasks.push(task);
    }
    if (task.repeat.frequency !== 'none' && !task.recurrenceSeriesId) task.recurrenceSeriesId = task.id;
    $('#clientTaskForm').dataset.initialSnapshot = clientTaskFormSnapshot();
    saveClientTasks();
    clientTaskDrawerOpen = false;
    clientTaskDrawerClosing = true;
    const layer = $('#clientTaskDrawerLayer');
    layer.classList.remove('is-open');
    layer.classList.add('is-closing');
    const finish = () => {
      layer.hidden = true;
      layer.classList.remove('is-closing');
      document.body.classList.remove('client-task-drawer-open');
      clientTaskDrawerClosing = false;
      clientTaskDrawerReturnFocus?.focus();
      clientTaskDrawerReturnFocus = null;
      renderClientTasks(hiredEditingId);
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else clientTaskDrawerCloseTimer = setTimeout(finish, 270);
  });
  $('#addClientTaskTimeEntry').addEventListener('click', () => {
    const startValue = $('#clientTaskManualStart').value;
    const endValue = $('#clientTaskManualEnd').value;
    const start = new Date(startValue);
    const end = new Date(endValue);
    if (!startValue || !endValue || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      $('#clientTaskManualEnd').setCustomValidity('Choose an end time after the start time.');
      $('#clientTaskManualEnd').reportValidity();
      $('#clientTaskManualEnd').addEventListener('input', event => event.currentTarget.setCustomValidity(''), { once: true });
      return;
    }
    clientTaskDraftEntries.push({ id: uid(), start: start.toISOString(), end: end.toISOString(), durationMs: end.getTime() - start.getTime() });
    $('#clientTaskManualStart').value = '';
    $('#clientTaskManualEnd').value = '';
    renderClientTaskEntries();
    $('#clientTaskForm').dataset.dirtySnapshot = clientTaskFormSnapshot();
  });

  document.addEventListener('keydown', event => {
    if (!clientTaskDrawerOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeClientTaskDrawer();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = $$('#clientTaskDrawer button:not([disabled]), #clientTaskDrawer input:not([disabled]), #clientTaskDrawer select:not([disabled]), #clientTaskDrawer textarea:not([disabled])')
      .filter(element => !element.closest('[hidden]') && element.getClientRects().length);
    if (!focusable.length) {
      event.preventDefault();
      $('#clientTaskDrawer').focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !$('#clientTaskDrawer').contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !$('#clientTaskDrawer').contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }, true);

  document.addEventListener('change', event => {
    const checkbox = event.target.closest('[data-client-task-complete]');
    if (checkbox) toggleClientTaskComplete(checkbox.dataset.clientTaskComplete, checkbox.checked);
  });

  document.addEventListener('input', event => {
    if (event.target.matches('#clientTaskSearch')) renderClientTasks(hiredEditingId);
  });
  ['#clientTaskStatusFilter', '#clientTaskPriorityFilter'].forEach(selector => {
    $(selector).addEventListener('change', () => renderClientTasks(hiredEditingId));
  });

  document.addEventListener('click', async event => {
    const newTaskButton = event.target.closest('[data-client-task-new]');
    if (newTaskButton) {
      if (clientTaskIsEnded()) return;
      openClientTaskDrawer(null, newTaskButton);
      return;
    }
    const menuButton = event.target.closest('[data-client-task-menu]');
    if (menuButton) {
      clientTaskMenuOpenId = clientTaskMenuOpenId === menuButton.dataset.clientTaskMenu ? '' : menuButton.dataset.clientTaskMenu;
      renderClientTasks(hiredEditingId);
      $(`[data-client-task-menu="${CSS.escape(clientTaskMenuOpenId)}"]`)?.focus();
      return;
    }
    const editButton = event.target.closest('[data-client-task-edit]');
    if (editButton) {
      openClientTaskEditor(editButton.dataset.clientTaskEdit);
      return;
    }
    const duplicateButton = event.target.closest('[data-client-task-duplicate]');
    if (duplicateButton) {
      if (clientTaskIsEnded()) return;
      const original = data.clientTasks.find(task => task.id === duplicateButton.dataset.clientTaskDuplicate && task.clientId === hiredEditingId);
      if (!original) return;
      const duplicate = { ...original, id: uid(), recurrenceSeriesId: '', recurrenceOccurrenceKey: '', generatedFromTaskId: '', status: 'todo', completedAt: '', timerStartedAt: '', timeEntries: [], createdAt: new Date().toISOString() };
      data.clientTasks.push(duplicate);
      saveClientTasks();
      clientTaskMenuOpenId = '';
      renderClientTasks(hiredEditingId);
      openClientTaskEditor(duplicate.id);
      return;
    }
    const deleteButton = event.target.closest('[data-client-task-delete]');
    if (deleteButton) {
      const task = data.clientTasks.find(item => item.id === deleteButton.dataset.clientTaskDelete && item.clientId === hiredEditingId);
      if (!task || !(await appConfirm(`Delete “${task.title}”?`, { title: 'Delete client task', confirmLabel: 'Delete task', danger: true }))) return;
      stopClientTaskTimer(task);
      data.clientTasks = data.clientTasks.filter(item => item.id !== task.id);
      saveClientTasks();
      clientTaskMenuOpenId = '';
      renderClientTasks(hiredEditingId);
      return;
    }
    const timerButton = event.target.closest('[data-client-task-timer]');
    if (timerButton) {
      await toggleClientTaskTimer(timerButton.dataset.clientTaskTimer);
      return;
    }
    const deleteEntryButton = event.target.closest('[data-client-task-entry-delete]');
    if (deleteEntryButton) {
      clientTaskDraftEntries = clientTaskDraftEntries.filter(entry => entry.id !== deleteEntryButton.dataset.clientTaskEntryDelete);
      renderClientTaskEntries();
      $('#clientTaskForm').dataset.dirtySnapshot = clientTaskFormSnapshot();
      return;
    }
    if (clientTaskMenuOpenId && !event.target.closest('.client-task-menu-wrap')) {
      clientTaskMenuOpenId = '';
      renderClientTasks(hiredEditingId);
    }
  });
}

initClientTaskDrawer();
startClientTaskTick();
