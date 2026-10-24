  function renderDashboard() {
    const applications = data.applications;
    const pipelineCount = pipelineApplications().length;
    const appliedToday = pipelineApplications().filter(item => dateKey(item.appliedDate) === today()).length;
    const followUp = applications.filter(item => item.followUpDate && item.followUpDate <= today() && item.status !== 'Active client' && item.status !== 'Not selected').length;
    const interviewsToday = applications.filter(item => item.status === 'Interview' && dateKey(item.interviewDate) === today()).length;
    const toApplyToday = (data.toApply || []).filter(item => item.dueDate && item.dueDate <= today()).length;
    $('#totalApplications').textContent = pipelineCount;
    $('#conversationClients').textContent = appliedToday;
    $('#followUpClients').textContent = followUp;
    $('#applicationsDetail').textContent = pipelineCount ? `${plural(pipelineCount, 'application')} in your tracker` : 'No applications tracked yet';
    $('#conversationDetail').textContent = appliedToday ? `${plural(appliedToday, 'application')} submitted today` : 'Applications submitted today';
    $('#followUpDetail').textContent = followUp ? `${plural(followUp, 'application')} due for a follow-up` : 'Applications to revisit soon';
    $('#todayFollowUps').textContent = followUp;
    $('#todayInterviews').textContent = interviewsToday;
    $('#todayToApply').textContent = toApplyToday;
    const weeklyApplicationCount = weeklyReportData().applications.length;
    const weeklyGoal = normalizeWeeklyActivityGoal(data.weeklyActivityGoal) || 0;
    $('#dashboardWeeklyActivity').textContent = weeklyGoal
      ? `${weeklyApplicationCount} of ${weeklyGoal} ${weeklyGoal === 1 ? 'application' : 'applications'}`
      : plural(weeklyApplicationCount, 'application');
    $('#dashboardWeeklyGoalLabel').textContent = weeklyGoal ? 'Weekly application goal' : 'Weekly goal not set';
    const weeklyProgress = $('#dashboardWeeklyProgress');
    weeklyProgress.hidden = !weeklyGoal;
    weeklyProgress.max = weeklyGoal || 1;
    weeklyProgress.value = Math.min(weeklyApplicationCount, weeklyGoal || 1);
    weeklyProgress.setAttribute('aria-valuemin', '0');
    weeklyProgress.setAttribute('aria-valuemax', String(weeklyGoal || 1));
    weeklyProgress.setAttribute('aria-valuenow', String(Math.min(weeklyApplicationCount, weeklyGoal || 1)));
    $('#openWeeklyGoalDialog').textContent = weeklyGoal ? 'Edit goal' : 'Set goal';
    renderPlatformBreakdown(applications);
    renderStatusChart(applications);
    renderInterviewCalendar();
    renderRecentApplications();
  }

  let clientDashboardSort = 'name';
  let clientDashboardSortDirection = 'asc';
  let clientDashboardSelectedId = '';
  let clientDashboardAction = '';
  let clientDashboardDrawerReturnFocus = null;

  function clientDashboardDaysLeft(item) {
    if (!item.contractEndDate || isContractEnded(item)) return null;
    const end = new Date(`${dateKey(item.contractEndDate)}T12:00:00`);
    const current = new Date(`${today()}T12:00:00`);
    return Number.isNaN(end.getTime()) ? null : Math.round((end - current) / 86400000);
  }

  function clientDashboardStatus(item) {
    if (isContractEnded(item)) return { key: 'ended', label: 'Ended' };
    if (String(item.contractStatus || '').toLowerCase() === 'not active'
      || String(item.contractStatus || '').toLowerCase() === 'paused') return { key: 'paused', label: 'Paused' };
    const daysLeft = clientDashboardDaysLeft(item);
    if (isActiveContract(item) && daysLeft !== null && daysLeft <= 30) return { key: 'ending', label: 'Ending soon' };
    return { key: 'active', label: 'Active' };
  }

  function clientDashboardLastContact(item) {
    const emailAddress = String(item.email || '').trim().toLowerCase();
    const matching = (data.emails || []).filter(email => email.applicationId === item.id
      || (emailAddress && [email.to, email.from].some(address => String(address || '').trim().toLowerCase() === emailAddress)));
    return matching.reduce((latest, email) => {
      const date = email.date || '';
      return dateKey(date) && (!latest || new Date(date) > new Date(latest)) ? date : latest;
    }, '');
  }

  function clientDashboardRate(item) {
    const amount = Number(item.salaryAmount);
    if (!(amount > 0) || !['monthly', 'hourly'].includes(item.salaryType)) return '';
    const symbol = item.salaryCurrency === 'PHP' ? '₱' : '$';
    return `${symbol}${amount.toLocaleString()} / ${item.salaryType === 'monthly' ? 'month' : 'hour'}`;
  }

  function clientDashboardMonthlyAmount(item) {
    const amount = Number(item.salaryAmount);
    if (!(amount > 0)) return 0;
    if (item.salaryType === 'monthly') return amount;
    if (item.salaryType === 'hourly' && Number(item.hoursPerWeek) > 0) return amount * Number(item.hoursPerWeek) * 4;
    return 0;
  }

  function clientDashboardMoneyByCurrency(clients) {
    const totals = new Map();
    clients.filter(isActiveContract).forEach(item => {
      const amount = clientDashboardMonthlyAmount(item);
      if (!amount) return;
      const currency = item.salaryCurrency === 'PHP' ? 'PHP' : 'USD';
      totals.set(currency, (totals.get(currency) || 0) + amount);
    });
    return [...totals].map(([currency, amount]) => `${currency === 'PHP' ? '₱' : '$'}${Math.round(amount).toLocaleString()}`).join(' · ');
  }

  function clientDashboardMatchesStatus(item, filter) {
    return filter === 'all' || clientDashboardStatus(item).key === filter;
  }

  function clientDashboardTableValue(item, key) {
    const daysLeft = clientDashboardDaysLeft(item);
    switch (key) {
      case 'name': return String(item.clientName || '').toLowerCase();
      case 'status': return clientDashboardStatus(item).label;
      case 'start': return dateKey(item.activeAt || item.appliedDate) || '';
      case 'end': return dateKey(item.contractEndDate) || '';
      case 'days': return daysLeft ?? Number.POSITIVE_INFINITY;
      case 'rate': return Number(item.salaryAmount) || 0;
      case 'contact': return clientDashboardLastContact(item) || '';
      default: return '';
    }
  }

  function renderClientDashboardTable(clients) {
    const query = $('#clientDashboardSearch').value.trim().toLowerCase();
    const filter = $('#clientDashboardStatusFilter').value;
    const filtered = clients.filter(item => {
      const haystack = [item.clientName, item.contact, item.email, item.role, item.companyName, item.company].join(' ').toLowerCase();
      return (!query || haystack.includes(query)) && clientDashboardMatchesStatus(item, filter);
    });
    const multiplier = clientDashboardSortDirection === 'asc' ? 1 : -1;
    filtered.sort((first, second) => {
      const a = clientDashboardTableValue(first, clientDashboardSort);
      const b = clientDashboardTableValue(second, clientDashboardSort);
      return (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))) * multiplier;
    });
    $('#clientDashboardListCount').textContent = plural(filtered.length, 'client');
    $$('#clientDashboardPanel [data-client-sort]').forEach(button => {
      button.closest('th')?.setAttribute('aria-sort', button.dataset.clientSort === clientDashboardSort
        ? (clientDashboardSortDirection === 'asc' ? 'ascending' : 'descending')
        : 'none');
    });
    const tbody = $('#clientDashboardTableBody');
    const empty = $('#clientDashboardEmpty');
    empty.hidden = filtered.length > 0;
    if (!filtered.length) {
      const hasClients = clients.length > 0;
      $('#clientDashboardEmptyTitle').textContent = hasClients ? 'No matching clients' : 'No clients yet';
      $('#clientDashboardEmptyMessage').textContent = hasClients
        ? 'Try changing your search or status filter.'
        : 'Clients you add from Applications will appear here for tracking.';
      tbody.innerHTML = '';
      return;
    }
    tbody.innerHTML = filtered.map(item => {
      const status = clientDashboardStatus(item);
      const daysLeft = clientDashboardDaysLeft(item);
      const lastContact = clientDashboardLastContact(item);
      const startDate = item.activeAt || item.appliedDate;
      const initials = clientInitials(item.clientName);
      const rate = clientDashboardRate(item);
      return `<tr data-client-row="${escapeHtml(item.id)}" tabindex="0" aria-label="Open details for ${escapeHtml(item.clientName || 'client')}">
        <td data-label="Client name"><button class="client-dashboard-name" type="button" data-client-dashboard-open="${escapeHtml(item.id)}"><span class="client-dashboard-avatar" aria-hidden="true">${escapeHtml(initials)}</span><span>${escapeHtml(item.clientName || 'Untitled client')}<small>${escapeHtml(item.role || item.companyName || item.company || 'Client')}</small></span></button></td>
        <td data-label="Status"><span class="client-dashboard-status is-${status.key}">${status.label}</span></td>
        <td data-label="Contract start">${startDate ? escapeHtml(formatDate(startDate)) : '—'}</td>
        <td data-label="Contract end">${item.contractEndDate ? escapeHtml(formatDate(item.contractEndDate)) : '—'}</td>
        <td data-label="Days left">${daysLeft === null ? '—' : daysLeft < 0 ? 'Ended' : plural(daysLeft, 'day')}</td>
        <td data-label="Rate">${escapeHtml(rate || '—')}</td>
        <td data-label="Last contact">${lastContact ? escapeHtml(formatDate(lastContact)) : '—'}</td>
        <td data-label="Actions"><button class="client-dashboard-row-action" type="button" data-client-dashboard-open="${escapeHtml(item.id)}" aria-label="Open ${escapeHtml(item.clientName || 'client')} details"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i><span>View</span></button></td>
      </tr>`;
    }).join('');
  }

  function clientDashboardRecentActivity(clients) {
    const activity = [];
    const recentThreshold = new Date();
    recentThreshold.setMonth(recentThreshold.getMonth() - 6);
    const thresholdKey = localDateKey(recentThreshold);
    clients.forEach(item => {
      const addedAt = item.createdAt || item.activeAt;
      if (addedAt) activity.push({ date: addedAt, title: 'Client added', detail: item.clientName || 'Client', icon: 'fa-user-plus', tone: 'blue' });
      if (item.contractStatus === 'Contract Ended' || (item.contractEndDate && dateKey(item.contractEndDate) < today())) {
        activity.push({ date: item.contractEndDate || item.updatedAt || item.activeAt, title: 'Contract ended', detail: item.clientName || 'Client', icon: 'fa-circle-check', tone: 'gray' });
      }
      (item.dashboardActivity || []).forEach(entry => activity.push(entry));
    });
    (data.clientTasks || []).filter(task => task.status === 'done' && task.completedAt).forEach(task => {
      const client = clients.find(item => item.id === task.clientId);
      if (client) activity.push({ date: task.completedAt, title: 'Task completed', detail: `${client.clientName || 'Client'} · ${task.title || 'Task'}`, icon: 'fa-check', tone: 'green' });
    });
    (data.dailyTasks || []).filter(task => task.completedAt && task.relatedType === 'client').forEach(task => {
      const client = clients.find(item => item.id === task.relatedId);
      if (client) activity.push({ date: task.completedAt, title: 'Task completed', detail: `${client.clientName || 'Client'} · ${task.title || 'Task'}`, icon: 'fa-check', tone: 'green' });
    });
    return activity.filter(item => dateKey(item.date) >= thresholdKey)
      .sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8);
  }

  function renderClientDashboardActivity(clients) {
    const activity = clientDashboardRecentActivity(clients);
    $('#clientDashboardActivityList').innerHTML = activity.length
      ? activity.map(item => `<article class="client-dashboard-activity-item"><span class="client-dashboard-activity-icon is-${escapeHtml(item.tone || 'blue')}"><i class="fa-solid ${escapeHtml(item.icon || 'fa-bolt')}" aria-hidden="true"></i></span><span><strong>${escapeHtml(item.title || 'Client update')}</strong><small>${escapeHtml(item.detail || '')}</small></span><time>${escapeHtml(formatDate(item.date))}</time></article>`).join('')
      : '<p class="client-dashboard-inline-empty">Client updates and completed tasks will appear here.</p>';
  }

  function clientDashboardMonthKeys() {
    return Array.from({ length: 6 }, (_, index) => {
      const date = new Date();
      date.setDate(1);
      date.setMonth(date.getMonth() - (5 - index));
      return { key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, label: new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date) };
    });
  }

  function renderClientDashboardHours() {
    const months = clientDashboardMonthKeys();
    const totals = new Map(months.map(month => [month.key, 0]));
    (data.clientTasks || []).forEach(task => {
      (task.timeEntries || []).forEach(entry => {
        const date = dateKey(entry.start);
        if (!date) return;
        const key = date.slice(0, 7);
        if (!totals.has(key)) return;
        const start = new Date(entry.start || '').getTime();
        const end = new Date(entry.end || '').getTime();
        const duration = Number(entry.durationMs) || (Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0);
        totals.set(key, totals.get(key) + duration / 3600000);
      });
    });
    (data.applications || []).forEach(item => {
      (item.dashboardLoggedHours || []).forEach(entry => {
        const key = dateKey(entry.date).slice(0, 7);
        if (totals.has(key)) totals.set(key, totals.get(key) + (Number(entry.hours) || 0));
      });
    });
    const values = months.map(month => totals.get(month.key) || 0);
    const chart = $('#clientDashboardHoursChart');
    if (!values.some(value => value > 0)) {
      chart.innerHTML = '<text x="300" y="106" text-anchor="middle" class="client-dashboard-chart-empty">Logged client hours will appear here.</text>';
      return;
    }
    const max = Math.max(...values, 1);
    const points = values.map((value, index) => `${48 + index * 100},${160 - value / max * 112}`).join(' ');
    chart.innerHTML = `<line x1="34" y1="160" x2="566" y2="160" class="client-dashboard-chart-axis"></line><polyline points="${points}" class="client-dashboard-chart-line"></polyline>${values.map((value, index) => {
      const x = 48 + index * 100;
      const y = 160 - value / max * 112;
      return `<circle cx="${x}" cy="${y}" r="4" class="client-dashboard-chart-point"><title>${value.toFixed(1)} hours</title></circle><text x="${x}" y="190" text-anchor="middle" class="client-dashboard-chart-label">${months[index].label}</text><text x="${x}" y="${Math.max(y - 10, 20)}" text-anchor="middle" class="client-dashboard-chart-value">${value.toFixed(value % 1 ? 1 : 0)}</text>`;
    }).join('')}`;
  }

  function renderClientDashboardAttention(clients) {
    const entries = [];
    clients.forEach(item => {
      const daysLeft = clientDashboardDaysLeft(item);
      if (isActiveContract(item) && daysLeft !== null && daysLeft >= 0 && daysLeft <= 30) {
        entries.push({ id: item.id, type: 'renew', title: 'Contract ending soon', detail: `${item.clientName || 'Client'} · ${plural(daysLeft, 'day')} left`, action: 'Renew', tone: 'amber' });
      }
      const lastContact = clientDashboardLastContact(item);
      const followUpBasis = lastContact || item.activeAt || item.createdAt;
      if (isActiveContract(item) && followUpBasis && Math.floor((new Date(`${today()}T12:00:00`) - new Date(dateKey(followUpBasis) + 'T12:00:00')) / 86400000) >= 14) {
        entries.push({ id: item.id, type: 'message', title: 'Follow-up due', detail: `${item.clientName || 'Client'} · ${lastContact ? `Last contacted ${formatDate(lastContact)}` : 'No contact recorded'}`, action: 'Message', tone: 'blue' });
      }
    });
    (data.clientTasks || []).filter(task => task.status !== 'done' && task.dueDate && dateKey(task.dueDate) < today()).forEach(task => {
      const item = clients.find(client => client.id === task.clientId);
      if (item) entries.push({ id: task.id, clientId: item.id, type: 'client-task', title: 'Overdue client task', detail: `${item.clientName || 'Client'} · ${task.title || 'Task'}`, action: 'Mark done', tone: 'red' });
    });
    (data.dailyTasks || []).filter(task => !task.completedAt && task.taskDate < today() && task.relatedType === 'client').forEach(task => {
      const item = clients.find(client => client.id === task.relatedId);
      if (item) entries.push({ id: task.id, clientId: item.id, type: 'daily-task', title: 'Overdue task', detail: `${item.clientName || 'Client'} · ${task.title || 'Task'}`, action: 'Mark done', tone: 'red' });
    });
    $('#clientDashboardAttentionCount').textContent = entries.length ? plural(entries.length, 'item') : 'All caught up';
    $('#clientDashboardAttentionList').innerHTML = entries.length
      ? entries.slice(0, 8).map(entry => `<article class="client-dashboard-attention-item"><span class="client-dashboard-attention-dot is-${entry.tone}" aria-hidden="true"></span><span class="client-dashboard-attention-copy"><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(entry.detail)}</small></span><button class="button button-secondary" type="button" data-client-dashboard-attention="${entry.type}" data-client-id="${escapeHtml(entry.clientId || entry.id)}" data-item-id="${escapeHtml(entry.id)}">${entry.action}</button></article>`).join('')
      : '<p class="client-dashboard-inline-empty">No contracts, follow-ups, or tasks need attention.</p>';
  }

  function renderClientDashboardDrawer(client) {
    const content = $('#clientDashboardDrawerContent');
    if (!client || !content) return;
    const status = clientDashboardStatus(client);
    const tasks = [
      ...(data.clientTasks || []).filter(task => task.clientId === client.id),
      ...(data.dailyTasks || []).filter(task => task.relatedType === 'client' && task.relatedId === client.id)
    ].sort((a, b) => new Date(a.dueDate || a.taskDate || 0) - new Date(b.dueDate || b.taskDate || 0)).slice(0, 5);
    const startDate = client.activeAt || client.appliedDate;
    const salary = clientDashboardRate(client);
    content.innerHTML = `
      <div class="client-dashboard-drawer-profile"><span class="client-dashboard-avatar is-large" aria-hidden="true">${escapeHtml(clientInitials(client.clientName))}</span><div><h3>${escapeHtml(client.clientName || 'Untitled client')}</h3><span class="client-dashboard-status is-${status.key}">${status.label}</span></div></div>
      <section class="client-dashboard-drawer-section"><h3>Contract information</h3><dl><div><dt>Position</dt><dd>${escapeHtml(client.role || 'Not set')}</dd></div><div><dt>Start date</dt><dd>${startDate ? escapeHtml(formatDate(startDate)) : 'Not set'}</dd></div><div><dt>End date</dt><dd>${client.contractEndDate ? escapeHtml(formatDate(client.contractEndDate)) : 'Not set'}</dd></div><div><dt>Rate</dt><dd>${escapeHtml(salary || 'Not set')}</dd></div><div><dt>Contact</dt><dd>${escapeHtml(client.contact || 'Not set')}</dd></div>${client.email ? `<div><dt>Email</dt><dd><a href="mailto:${escapeHtml(client.email)}">${escapeHtml(client.email)}</a></dd></div>` : ''}${client.phone ? `<div><dt>Phone</dt><dd><a href="tel:${escapeHtml(client.phone)}">${escapeHtml(client.phone)}</a></dd></div>` : ''}${client.companyName || client.company ? `<div><dt>Company</dt><dd>${escapeHtml(client.companyName || client.company)}</dd></div>` : ''}</dl></section>
      <section class="client-dashboard-drawer-section"><h3>Notes</h3><p class="client-dashboard-drawer-notes">${escapeHtml(client.notes || 'No notes yet.')}</p></section>
      <section class="client-dashboard-drawer-section"><h3>Linked tasks <span>${tasks.length}</span></h3>${tasks.length ? `<ul class="client-dashboard-drawer-tasks">${tasks.map(task => `<li><span>${escapeHtml(task.title || 'Untitled task')}</span><small>${escapeHtml(task.status === 'done' || task.completedAt ? 'Done' : (task.dueDate || task.taskDate) ? formatDate(task.dueDate || task.taskDate) : 'No due date')}</small></li>`).join('')}</ul>` : '<p class="client-dashboard-inline-empty">No tasks linked to this client yet.</p>'}</section>
      <div class="client-dashboard-drawer-actions"><button class="button button-secondary" type="button" data-client-dashboard-drawer-action="message"><i class="fa-regular fa-envelope" aria-hidden="true"></i> Message</button><button class="button button-primary" type="button" data-client-dashboard-edit="${escapeHtml(client.id)}"><i class="fa-solid fa-pen" aria-hidden="true"></i> Edit details</button></div>`;
  }

  function renderClientDashboard() {
    const clients = hiredClients();
    const loading = !dataReady;
    $('#clientDashboardLoading').hidden = !loading;
    $('#clientDashboardContent').hidden = loading;
    if (loading) {
      $('#clientDashboardCount').textContent = '—';
      $('#clientDashboardDetail').textContent = 'Loading clients…';
      return;
    }
    const activeClients = clients.filter(isActiveContract).length;
    const endingSoon = clients.filter(item => isActiveContract(item) && clientDashboardDaysLeft(item) !== null && clientDashboardDaysLeft(item) >= 0 && clientDashboardDaysLeft(item) <= 30).length;
    const endedContracts = clients.filter(isContractEnded).length;
    const income = clientDashboardMoneyByCurrency(clients);
    $('#clientDashboardCount').textContent = Number.isFinite(activeClients) ? String(activeClients) : '—';
    $('#clientDashboardDetail').textContent = activeClients ? plural(activeClients, 'client') : 'No active contracts';
    $('#clientDashboardEndingCount').textContent = String(endingSoon);
    $('#clientDashboardEndedCount').textContent = String(endedContracts);
    $('#clientDashboardEndedDetail').textContent = endedContracts ? plural(endedContracts, 'contract') : 'No ended contracts';
    $('#clientDashboardIncomeCard').hidden = !income;
    $('#clientDashboardIncome').textContent = income || '—';
    $('#clientDashboardPanel .client-dashboard-stat-grid').classList.toggle('has-income', Boolean(income));
    $('#clientDashboardActionClient').innerHTML = clients.length
      ? clients.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.clientName || 'Untitled client')}</option>`).join('')
      : '<option value="">Add a client to get started</option>';
    $$('#clientDashboardQuickActions [data-client-dashboard-action]').forEach(button => { button.disabled = !clients.length; });
    renderClientDashboardTable(clients);
    renderClientDashboardAttention(clients);
    renderClientDashboardActivity(clients);
    renderClientDashboardHours();
    if (clientDashboardSelectedId) {
      const selected = clients.find(item => item.id === clientDashboardSelectedId);
      if (selected && !$('#clientDashboardDrawer').hidden) renderClientDashboardDrawer(selected);
      else closeClientDashboardDrawer();
    }
  }

  function closeClientDashboardDrawer() {
    const drawer = $('#clientDashboardDrawer');
    if (!drawer || drawer.hidden) return;
    drawer.hidden = true;
    drawer.setAttribute('aria-hidden', 'true');
    $('#clientDashboardBackdrop').hidden = true;
    document.body.classList.remove('client-dashboard-drawer-open');
    clientDashboardSelectedId = '';
    clientDashboardDrawerReturnFocus?.focus();
    clientDashboardDrawerReturnFocus = null;
  }

  function openClientDashboardDrawer(clientId, trigger) {
    const client = hiredClients().find(item => item.id === clientId);
    if (!client) return;
    clientDashboardSelectedId = client.id;
    clientDashboardDrawerReturnFocus = trigger;
    $('#clientDashboardDrawerTitle').textContent = client.clientName || 'Client';
    renderClientDashboardDrawer(client);
    const drawer = $('#clientDashboardDrawer');
    drawer.hidden = false;
    drawer.setAttribute('aria-hidden', 'false');
    $('#clientDashboardBackdrop').hidden = false;
    document.body.classList.add('client-dashboard-drawer-open');
    requestAnimationFrame(() => drawer.querySelector('button, a, input, select, textarea')?.focus());
  }

  function renderClientDashboardEditForm(client) {
    const status = client.contractStatus === 'Contract Ended' ? 'Contract Ended' : client.contractStatus === 'Not active' ? 'Not active' : 'Active';
    $('#clientDashboardDrawerContent').innerHTML = `<form class="client-dashboard-edit-form" data-client-dashboard-save="${escapeHtml(client.id)}">
      <label class="form-field">Client name<input name="clientName" required maxlength="180" value="${escapeHtml(client.clientName || '')}" /></label>
      <label class="form-field">Position<input name="role" maxlength="180" value="${escapeHtml(client.role || '')}" /></label>
      <label class="form-field">Contact name<input name="contact" maxlength="180" value="${escapeHtml(client.contact || '')}" /></label>
      <label class="form-field">Contract status<select name="contractStatus"><option${status === 'Active' ? ' selected' : ''}>Active</option><option${status === 'Not active' ? ' selected' : ''}>Not active</option><option${status === 'Contract Ended' ? ' selected' : ''}>Contract Ended</option></select></label>
      <label class="form-field">Contract start<input name="activeAt" type="date" value="${escapeHtml(dateKey(client.activeAt || client.appliedDate))}" /></label>
      <label class="form-field">Contract end<input name="contractEndDate" type="date" value="${escapeHtml(dateKey(client.contractEndDate))}" /></label>
      <label class="form-field">Rate amount<input name="salaryAmount" type="number" min="0" step="0.01" value="${escapeHtml(client.salaryAmount ?? '')}" /></label>
      <label class="form-field">Rate type<select name="salaryType"><option value="">Not set</option><option value="hourly"${client.salaryType === 'hourly' ? ' selected' : ''}>Hourly</option><option value="monthly"${client.salaryType === 'monthly' ? ' selected' : ''}>Monthly</option></select></label>
      <label class="form-field">Currency<select name="salaryCurrency"><option value="USD"${client.salaryCurrency !== 'PHP' ? ' selected' : ''}>USD ($)</option><option value="PHP"${client.salaryCurrency === 'PHP' ? ' selected' : ''}>PHP (₱)</option></select></label>
      <label class="form-field">Hours per week<input name="hoursPerWeek" type="number" min="0" step="0.5" value="${escapeHtml(client.hoursPerWeek ?? '')}" /></label>
      <label class="form-field">Contact email<input name="email" type="email" value="${escapeHtml(client.email || '')}" /></label>
      <label class="form-field">Phone<input name="phone" type="tel" maxlength="80" value="${escapeHtml(client.phone || '')}" /></label>
      <label class="form-field client-dashboard-edit-notes">Notes<textarea name="notes" rows="5" maxlength="4000">${escapeHtml(client.notes || '')}</textarea></label>
      <div class="client-dashboard-drawer-actions"><button class="button button-secondary" type="button" data-client-dashboard-cancel-edit>Cancel</button><button class="button button-primary" type="submit">Save changes</button></div>
    </form>`;
    $('#clientDashboardDrawerContent').querySelector('input')?.focus();
  }

  function openClientDashboardAction(action) {
    const client = hiredClients().find(item => item.id === $('#clientDashboardActionClient').value);
    if (!client) return;
    if (action === 'message') {
      openPlainClientEmailComposer(client);
      return;
    }
    clientDashboardAction = action;
    const title = action === 'hours' ? 'Log client hours' : action === 'task' ? 'Add a client task' : 'Add a client note';
    $('#clientDashboardActionTitle').textContent = `${title} · ${client.clientName || 'Client'}`;
    $('#clientDashboardActionFields').innerHTML = action === 'hours'
      ? '<label class="form-field">Hours worked<input name="hours" type="number" min="0.25" step="0.25" required autofocus /></label><label class="form-field">Date<input name="date" type="date" required /></label>'
      : action === 'task'
        ? '<label class="form-field">Task title<input name="title" maxlength="180" required autofocus /></label><label class="form-field">Due date<input name="date" type="date" /></label>'
        : '<label class="form-field">Note<textarea name="note" rows="5" maxlength="2000" required autofocus placeholder="Add a note for this client"></textarea></label>';
    const dateInput = $('#clientDashboardActionFields [name="date"]');
    if (dateInput) dateInput.value = today();
    $('#clientDashboardActionDialog').showModal();
    requestAnimationFrame(() => $('#clientDashboardActionFields').querySelector('input, textarea')?.focus());
  }

  async function saveClientDashboardAction(event) {
    event.preventDefault();
    const client = hiredClients().find(item => item.id === $('#clientDashboardActionClient').value);
    if (!client) return;
    const formData = new FormData(event.currentTarget);
    const now = new Date().toISOString();
    if (clientDashboardAction === 'hours') {
      client.dashboardLoggedHours = Array.isArray(client.dashboardLoggedHours) ? client.dashboardLoggedHours : [];
      client.dashboardLoggedHours.push({ id: uid(), hours: Number(formData.get('hours')), date: String(formData.get('date') || today()), createdAt: now });
      client.dashboardActivity = [...(client.dashboardActivity || []), { date: now, title: 'Hours logged', detail: `${client.clientName || 'Client'} · ${Number(formData.get('hours'))} hours`, icon: 'fa-clock', tone: 'blue' }].slice(-100);
    } else if (clientDashboardAction === 'task') {
      data.dailyTasks = Array.isArray(data.dailyTasks) ? data.dailyTasks : [];
      data.dailyTasks.push({
        id: uid(),
        title: String(formData.get('title') || '').trim(),
        type: 'task',
        taskDate: String(formData.get('date') || today()),
        relatedType: 'client',
        relatedId: client.id,
        relatedName: client.clientName || '',
        destination: '',
        notes: '',
        checklist: [],
        createdAt: now,
        completedAt: ''
      });
      client.dashboardActivity = [...(client.dashboardActivity || []), { date: now, title: 'Task added', detail: `${client.clientName || 'Client'} · ${String(formData.get('title') || '').trim()}`, icon: 'fa-list-check', tone: 'blue' }].slice(-100);
    } else {
      const note = String(formData.get('note') || '').trim();
      client.notes = [client.notes, note].filter(Boolean).join('\n\n');
      client.dashboardActivity = [...(client.dashboardActivity || []), { date: now, title: 'Note added', detail: client.clientName || 'Client', icon: 'fa-note-sticky', tone: 'gray' }].slice(-100);
    }
    const action = clientDashboardAction;
    try {
      if (!(await persist())) throw new Error('Cloud save failed.');
    } catch (error) {
      console.error('Could not save client dashboard action:', error);
      showActionResult({ title: 'Could not save client update', message: error.message || 'Check your connection and try again.', status: 'error' });
      return;
    }
    $('#clientDashboardActionDialog').close();
    renderAll();
    if (action === 'task') showView('daily-task');
    else if (clientDashboardSelectedId) openClientDashboardDrawer(client.id, clientDashboardDrawerReturnFocus);
    toast(action === 'hours' ? 'Client hours saved.' : action === 'task' ? 'Task added to Daily Tasks.' : 'Client note saved.');
  }

  $('#clientDashboardSearch').addEventListener('input', () => renderClientDashboardTable(hiredClients()));
  $('#clientDashboardStatusFilter').addEventListener('change', () => renderClientDashboardTable(hiredClients()));
  $('#clientDashboardActionForm').addEventListener('submit', saveClientDashboardAction);
  $('#clientDashboardClients').addEventListener('click', event => {
    const sortButton = event.target.closest('[data-client-sort]');
    if (sortButton) {
      if (clientDashboardSort === sortButton.dataset.clientSort) clientDashboardSortDirection = clientDashboardSortDirection === 'asc' ? 'desc' : 'asc';
      else {
        clientDashboardSort = sortButton.dataset.clientSort;
        clientDashboardSortDirection = 'asc';
      }
      renderClientDashboardTable(hiredClients());
      return;
    }
    const openButton = event.target.closest('[data-client-dashboard-open]');
    if (openButton) openClientDashboardDrawer(openButton.dataset.clientDashboardOpen, openButton);
    else {
      const row = event.target.closest('[data-client-row]');
      if (row && !event.target.closest('button, a, input, select, textarea')) {
        openClientDashboardDrawer(row.dataset.clientRow, row);
      }
    }
  });
  $('#clientDashboardPanel').addEventListener('click', event => {
    const actionButton = event.target.closest('[data-client-dashboard-action]');
    const closeButton = event.target.closest('[data-client-dashboard-close], [data-client-dashboard-action-close]');
    const drawerMessage = event.target.closest('[data-client-dashboard-drawer-action="message"]');
    const editButton = event.target.closest('[data-client-dashboard-edit]');
    const cancelEditButton = event.target.closest('[data-client-dashboard-cancel-edit]');
    const attentionButton = event.target.closest('[data-client-dashboard-attention]');
    if (actionButton) {
      openClientDashboardAction(actionButton.dataset.clientDashboardAction);
    } else if (closeButton) {
      if (closeButton.closest('#clientDashboardActionDialog')) $('#clientDashboardActionDialog').close();
      else closeClientDashboardDrawer();
    } else if (drawerMessage) {
      const client = hiredClients().find(item => item.id === clientDashboardSelectedId);
      if (client) openPlainClientEmailComposer(client);
    } else if (editButton) {
      const client = hiredClients().find(item => item.id === editButton.dataset.clientDashboardEdit);
      if (client) renderClientDashboardEditForm(client);
    } else if (cancelEditButton) {
      const client = hiredClients().find(item => item.id === clientDashboardSelectedId);
      if (client) renderClientDashboardDrawer(client);
    } else if (attentionButton) {
      const client = hiredClients().find(item => item.id === attentionButton.dataset.clientId);
      if (attentionButton.dataset.clientDashboardAttention === 'renew' && client) {
        openClientModal(client.id, false, true, false, true);
      } else if (attentionButton.dataset.clientDashboardAttention === 'message' && client) {
        openPlainClientEmailComposer(client);
      } else if (attentionButton.dataset.clientDashboardAttention === 'client-task') {
        const task = (data.clientTasks || []).find(item => item.id === attentionButton.dataset.itemId);
        if (task) {
          const now = new Date();
          if (task.timerStartedAt) {
            const start = new Date(task.timerStartedAt);
            const durationMs = Math.max(0, now.getTime() - start.getTime());
            task.timeEntries = Array.isArray(task.timeEntries) ? task.timeEntries : [];
            if (durationMs) task.timeEntries.push({ id: uid(), start: start.toISOString(), end: now.toISOString(), durationMs });
            task.timerStartedAt = '';
          }
          Object.assign(task, { status: 'done', completedAt: now.toISOString(), updatedAt: now.toISOString() });
        }
        persist().catch(error => {
          console.error('Could not complete overdue client task:', error);
          showActionResult({ title: 'Could not update task', message: error.message || 'Check your connection and try again.', status: 'error' });
        });
        renderAll();
      } else if (attentionButton.dataset.clientDashboardAttention === 'daily-task') {
        const task = (data.dailyTasks || []).find(item => item.id === attentionButton.dataset.itemId);
        if (task) task.completedAt = new Date().toISOString();
        persist().catch(error => {
          console.error('Could not complete overdue daily task:', error);
          showActionResult({ title: 'Could not update task', message: error.message || 'Check your connection and try again.', status: 'error' });
        });
        renderAll();
      }
    }
  });
  $('#clientDashboardPanel').addEventListener('submit', async event => {
    const form = event.target.closest('[data-client-dashboard-save]');
    if (!form) return;
    event.preventDefault();
    const client = hiredClients().find(item => item.id === form.dataset.clientDashboardSave);
    if (!client) return;
    const previousClient = JSON.parse(JSON.stringify(client));
    const fields = new FormData(form);
    Object.assign(client, {
      clientName: String(fields.get('clientName') || '').trim(),
      role: String(fields.get('role') || '').trim(),
      contact: String(fields.get('contact') || '').trim(),
      contractStatus: String(fields.get('contractStatus') || 'Active'),
      activeAt: String(fields.get('activeAt') || ''),
      contractEndDate: String(fields.get('contractEndDate') || ''),
      salaryAmount: fields.get('salaryAmount') === '' ? '' : Number(fields.get('salaryAmount')),
      salaryType: String(fields.get('salaryType') || ''),
      salaryCurrency: String(fields.get('salaryCurrency') || 'USD'),
      hoursPerWeek: fields.get('hoursPerWeek') === '' ? '' : Number(fields.get('hoursPerWeek')),
      email: String(fields.get('email') || '').trim(),
      phone: String(fields.get('phone') || '').trim(),
      notes: String(fields.get('notes') || '').trim(),
      updatedAt: new Date().toISOString()
    });
    try {
      if (!(await persist())) {
        Object.assign(client, previousClient);
        throw new Error('Cloud save failed.');
      }
      renderClientDashboard();
      toast('Client details saved.');
    } catch (error) {
      console.error('Could not save client dashboard details:', error);
      showActionResult({ title: 'Could not save client details', message: error.message || 'Check your connection and try again.', status: 'error' });
    }
  });
  $('#clientDashboardBackdrop').addEventListener('click', closeClientDashboardDrawer);
  $('#clientDashboardDrawer').addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeClientDashboardDrawer();
    } else if (event.key === 'Tab') {
      const focusable = [...event.currentTarget.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])')];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
  $('#clientDashboardActionDialog').addEventListener('click', event => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  $('#clientDashboardActionDialog').addEventListener('close', () => { clientDashboardAction = ''; });
  $('#clientDashboardPanel').addEventListener('keydown', event => {
    const sortButton = event.target.closest('[data-client-sort]');
    if (sortButton && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      sortButton.click();
      return;
    }
    const row = event.target.closest('[data-client-row]');
    if (row && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openClientDashboardDrawer(row.dataset.clientRow, row);
    }
  });
  renderClientDashboard();

  function renderInterviewCalendar() {
    const target = $('#interviewCalendar');
    const monthLabel = $('#interviewCalendarMonth');
    if (!target || !monthLabel) return;
    const year = interviewCalendarMonth.getFullYear();
    const month = interviewCalendarMonth.getMonth();
    monthLabel.textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(interviewCalendarMonth);
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const interviews = data.applications.filter(item => item.status === 'Interview' && item.interviewDate);
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const cells = weekdays.map(day => `<div class="calendar-weekday">${day}</div>`);
    for (let index = 0; index < 42; index += 1) {
      const dayOffset = index - firstDay;
      const date = new Date(year, month, dayOffset + 1);
      const inMonth = dayOffset >= 0 && dayOffset < daysInMonth;
      const dateValue = localDateKey(date);
      const dayInterviews = interviews.filter(item => dateKey(item.interviewDate) === dateValue);
      cells.push(`<div class="calendar-day${inMonth ? '' : ' other-month'}${dateValue === today() ? ' today' : ''}"><span class="calendar-day-number">${date.getDate()}</span><div class="calendar-interviews">${dayInterviews.map(item => `<button class="calendar-interview" type="button" data-calendar-client="${escapeHtml(item.id)}" title="${escapeHtml(item.clientName)}">${escapeHtml(item.clientName)}</button>`).join('')}</div></div>`);
    }
    target.innerHTML = cells.join('');
  }

  function renderPlatformBreakdown(applications) {
    const target = $('#platformBreakdown');
    const counts = applications.reduce((result, item) => {
      const key = item.platform || 'Not specified';
      result[key] = (result[key] || 0) + 1;
      return result;
    }, {});
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (!entries.length) {
      target.innerHTML = '<div class="empty-chart">Add an application to see your platform mix.</div>';
      return;
    }
    const maximum = Math.max(...entries.map(([, count]) => count));
    target.innerHTML = entries.map(([name, count]) => `
      <div class="platform-row"><span class="platform-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span><span class="platform-track"><i style="width:${(count / maximum) * 100}%"></i></span><strong>${count}</strong></div>
    `).join('');
  }

  function renderStatusChart(applications) {
    const target = $('#statusLegend');
    const statusEntries = Object.entries(STATUS_COLORS).map(([status, color]) => [status, applications.filter(item => item.status === status).length, color]).filter(([, count]) => count > 0);
    $('#donutValue').textContent = applications.length;
    if (!statusEntries.length) {
      $('#statusDonut').style.background = 'conic-gradient(#eff0ec 0 100%)';
      target.innerHTML = '<span class="empty-chart" style="padding:13px 8px">Status mix will appear here.</span>';
      return;
    }
    let total = 0;
    const stops = statusEntries.map(([, count, color]) => {
      const from = total;
      total += (count / applications.length) * 100;
      return `${color} ${from}% ${total}%`;
    });
    $('#statusDonut').style.background = `conic-gradient(${stops.join(',')})`;
    target.innerHTML = statusEntries.map(([status, count, color]) => `
      <span class="legend-item"><i class="legend-dot" style="background:${color}"></i><span>${escapeHtml(STATUS_LABELS[status] || status)}</span><strong>${count}</strong></span>
    `).join('');
  }

  function renderRecentApplications() {
    const target = $('#recentApplications');
    const applications = sortedPipelineApplications().slice(0, 5);
    if (!applications.length) {
      target.innerHTML = '<tr><td colspan="5"><div class="application-empty"><h3>Your tracker is ready</h3><p>Add your first client or application from the Applications tab and Jeff VA will organize the rest.</p><button class="button button-primary" type="button" data-go-to="applications">Go to applications</button></div></td></tr>';
      return;
    }
    target.innerHTML = applications.map(item => `
      <tr>
        <td><div class="table-client">${escapeHtml(item.clientName)}<small>${escapeHtml(item.role || item.contact || 'No role added')}</small></div></td>
        <td>${escapeHtml(item.platform)}</td><td><span class="application-stage-email-count">${statusPill(item.status)}${matchBadge(item)}</span></td><td>${formatDate(item.appliedDate)}</td>
        <td><button class="icon-button list-icon-button" type="button" data-edit-id="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.clientName)}" title="Edit application">✎</button></td>
      </tr>
    `).join('');
  }

