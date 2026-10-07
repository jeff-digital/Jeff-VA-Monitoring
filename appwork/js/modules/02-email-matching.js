  // --- Client email matching ---
  // A saved sender address is a direct match; name-based matches also require client or role context.
  function extractEmailAddress(fromHeader) {
    const match = (fromHeader || '').match(/<([^>]+)>/);
    return (match ? match[1] : (fromHeader || '')).trim().toLowerCase();
  }

  function isEmailAddress(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '');
  }

  function extractSenderName(fromHeader) {
    return (fromHeader || '').split('<')[0].replace(/["']/g, '').trim().toLowerCase();
  }

  function escapeForRegExp(value) {
    return (value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function containsWholeWord(haystack, needle) {
    if (!needle) return false;
    return new RegExp(`\\b${escapeForRegExp(needle)}\\b`, 'i').test(haystack || '');
  }

  function isDirectClientApplication(application) {
    const platform = String(application.platform || '').trim().toLowerCase();
    return platform === 'direct client' || platform === 'direct apply';
  }

  function emailHasApplicationUpdateSignal(emailItem) {
    const source = `${emailItem.subject || ''} ${emailItem.body || ''}`.toLowerCase();
    if (!source.trim()) return false;
    const submissionReceipt = [
      /\bapplication(?: form)?\s+(?:(?:has|was)\s+)?(?:been\s+)?(?:successfully\s+)?submitted\b/,
      /\b(?:successfully\s+)?submitted\s+(?:your|the|an?)\s+application(?: form)?\b/,
      /\b(?:we(?:'ve| have)?\s+)?received\s+your\s+application\b/,
      /\bapplication(?: form)?\s+(?:has been\s+|was\s+)?received\b/,
      /\bapplication submission\s+(?:was\s+)?(?:successful|received|confirmed)\b/
    ].some(pattern => pattern.test(source));
    const actionableSignals = [
      /\b(interview|screening|phone call|video call|meeting|recruiter call)\b/,
      /\b(next steps?|proceed|moving forward|move forward|shortlist(?:ed)?|offer|assessment|test task|assignment)\b/,
      /\b(schedule(?:d)?|availability|available for|time slot|calendar invite|proposed time|set up (?:a|an) (?:call|meeting|interview)|confirm (?:a|the) time)\b/,
      /\b(additional information|more information|questions?|follow[- ]?up)\b/
    ];
    if (submissionReceipt && !actionableSignals.some(pattern => pattern.test(source))) return false;
    const strongSignals = [
      /application\s+(status|update|review|progress|decision|process)/,
      /status\s+update/,
      ...actionableSignals
    ];
    return strongSignals.some(pattern => pattern.test(source));
  }

  function matchApplicationsForEmail(emailItem) {
    const fromAddress = extractEmailAddress(emailItem.from);
    const senderName = extractSenderName(emailItem.from);
    const contentLower = `${emailItem.subject || ''} ${emailItem.body || ''}`.toLowerCase();

    return data.applications.filter(app => {
      const emailCandidate = (app.email || '').trim().toLowerCase();
      const contact = (app.contact || '').trim().toLowerCase();
      const clientName = (app.clientName || '').trim().toLowerCase();
      const role = (app.role || '').trim().toLowerCase();
      const roleReferenced = role.length >= 3 && contentLower.includes(role);
      const companyReferenced = clientName.length >= 3 && containsWholeWord(contentLower, clientName);
      if (emailCandidate && emailCandidate === fromAddress) return true;
      if (!roleReferenced && !companyReferenced) return false;

      const nameCandidates = [contact, clientName].filter(name => name.length >= 3);
      return nameCandidates.some(name => containsWholeWord(senderName, name));
    });
  }

  function applicationsRelatedToEmail(emailItem) {
    if (emailItem.direction !== 'sent' && emailItem.source !== 'sent') return matchApplicationsForEmail(emailItem);
    const linkedApplication = data.applications.find(application => application.id === emailItem.applicationId);
    if (linkedApplication) return [linkedApplication];
    const recipient = extractEmailAddress(emailItem.to);
    return isEmailAddress(recipient)
      ? data.applications.filter(application => (application.email || '').trim().toLowerCase() === recipient)
      : [];
  }

  function matchingEmailsForApplication(app) {
    return data.emails.filter(emailItem => matchApplicationsForEmail(emailItem).some(match => match.id === app.id));
  }

  function openApplicationEmailsModal(applicationId) {
    const application = data.applications.find(item => item.id === applicationId);
    if (!application) return;
    const emails = matchingEmailsForApplication(application)
      .filter(emailItem => emailItem.direction !== 'sent' && emailItem.source !== 'sent')
      .sort((first, second) => new Date(second.date) - new Date(first.date));
    if (!emails.length) return;
    $('#applicationEmailsTitle').textContent = `${application.clientName} · Emails`;
    $('#applicationEmailsSummary').textContent = plural(emails.length, 'matching email');
    $('#applicationEmailsList').innerHTML = emails.map(emailItem => `
      <article class="application-email-message">
        <header class="application-email-message-heading">
          <div><h3>${escapeHtml(emailItem.subject || '(No subject)')}</h3><p>${escapeHtml(emailItem.from || 'Unknown sender')}</p></div>
          <time>${escapeHtml(emailDate(emailItem.date))}</time>
        </header>
        <div class="application-email-message-body">${escapeHtml(emailContentText(emailItem.body) || 'No message body available.')}</div>
      </article>`).join('');
    $('#applicationEmailsModal').showModal();
  }

  function interviewDateFromEmail(emailItem) {
    const source = `${emailItem.subject || ''} ${emailItem.body || ''}`;
    const match = source.match(/\b(\d{4}-\d{1,2}-\d{1,2}|[A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?|\d{1,2}\/\d{1,2}\/\d{2,4})\b/);
    if (!match) return '';
    const parsed = new Date(match[1]);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
  }

  function isInterviewEmail(emailItem) {
    const source = `${emailItem.subject || ''} ${emailItem.body || ''}`;
    return /\b(interview|meeting|video call|phone call|screening)\b/i.test(source);
  }

  function matchBadge(app) {
    const matches = matchingEmailsForApplication(app).filter(emailItem => emailItem.direction !== 'sent' && emailItem.source !== 'sent');
    if (!matches.length) return '';
    return ` <button class="match-badge" type="button" data-application-emails="${escapeHtml(app.id)}" aria-label="View ${plural(matches.length, 'matching email')} for ${escapeHtml(app.clientName)}" title="View matching application emails">${matches.length}</button>`;
  }

  function renderDashboard() {
    const applications = data.applications;
    const pipelineCount = pipelineApplications().length;
    const active = applications.filter(item => item.status === 'Active client').length;
    const appliedToday = pipelineApplications().filter(item => dateKey(item.appliedDate) === today()).length;
    const followUp = applications.filter(item => item.followUpDate && item.followUpDate <= today() && item.status !== 'Active client' && item.status !== 'Not selected').length;
    $('#totalApplications').textContent = pipelineCount;
    $('#activeClients').textContent = active;
    $('#conversationClients').textContent = appliedToday;
    $('#followUpClients').textContent = followUp;
    $('#applicationsDetail').textContent = pipelineCount ? `${plural(pipelineCount, 'application')} in your tracker` : 'No applications tracked yet';
    $('#activeDetail').textContent = active ? `${plural(active, 'client')} currently in progress` : 'Clients currently in progress';
    $('#conversationDetail').textContent = appliedToday ? `${plural(appliedToday, 'application')} submitted today` : 'Applications submitted today';
    $('#followUpDetail').textContent = followUp ? `${plural(followUp, 'application')} due for a follow-up` : 'Applications to revisit soon';
    renderPlatformBreakdown(applications);
    renderStatusChart(applications);
    renderInterviewCalendar();
    renderRecentApplications();
  }

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
        <td>${escapeHtml(item.platform)}</td><td>${statusPill(item.status)}${matchBadge(item)}</td><td>${formatDate(item.appliedDate)}</td>
        <td><button class="icon-button list-icon-button" type="button" data-edit-id="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.clientName)}" title="Edit application">✎</button></td>
      </tr>
    `).join('');
  }

  function applicationWeekOptions() {
    const currentRange = weekRange();
    const applicationDates = pipelineApplications().map(applicationAddedDate).map(dateKey).filter(Boolean);
    const offsets = [...new Set(applicationDates.map(date => {
      const applicationDate = new Date(`${date}T12:00:00`);
      const daysSinceMonday = (applicationDate.getDay() + 6) % 7;
      applicationDate.setDate(applicationDate.getDate() - daysSinceMonday);
      return Math.round((applicationDate - new Date(`${currentRange.start}T12:00:00`)) / 86400000 / 7);
    }).filter(offset => offset < 0))].sort((first, second) => second - first);
    const options = offsets.map(offset => {
      const range = weekRange(offset);
      return `<option value="${offset}">${escapeHtml(weeklyRangeLabel(range).replace(' – ', ' to '))}</option>`;
    }).join('');
    return `<option value="">- Select -</option><option value="all">All weeks</option><option value="0">This week</option>${options}`;
  }

  function renderApplications() {
    const query = $('#applicationSearch').value.trim().toLowerCase();
    const status = $('#statusFilter').value;
    const platform = $('#platformFilter').value;
    const dateFilter = $('#applicationDateFilter').value;
    updatePlatformFilter();
    const weekOffset = Number(applicationDateSort);
    const weekRangeFilter = applicationDateSort && applicationDateSort !== 'all' ? weekRange(weekOffset) : null;
    $('#applicationWeekDate').textContent = !applicationDateSort
      ? 'Select a week'
      : applicationDateSort === 'all' ? 'All weeks' : weeklyRangeLabel(weekRangeFilter).replace(' – ', ' to ');
    $('#applicationDateSort').innerHTML = applicationWeekOptions();
    $('#applicationDateSort').value = applicationDateSort;
    const pipeline = pipelineApplications();
    const filtered = pipeline.filter(item => {
      const text = [item.clientName, item.contact, item.role, item.platform, item.nextStep, item.notes].join(' ').toLowerCase();
      const statusMatches = status
        ? (status === 'To Proceed' ? isToProceedStatus(item) : status === 'Ongoing' ? item.status === 'Ongoing' : item.status === status)
        : item.status !== 'Not selected';
      const alwaysVisibleStatus = isToProceedStatus(item) || item.status === 'Interview' || item.status === 'Ongoing';
      const dateMatches = alwaysVisibleStatus || !dateFilter || dateKey(item.appliedDate) === dateFilter;
      const weekMatches = alwaysVisibleStatus || !applicationDateSort || applicationDateSort === 'all' || isInWeeklyRange(applicationAddedDate(item), weekRangeFilter);
      return (!query || text.includes(query)) && statusMatches && (!platform || item.platform === platform) && dateMatches && weekMatches;
    });
    $('#applicationListLabel').textContent = `${plural(filtered.length, 'application')}${filtered.length !== pipeline.length ? ` of ${pipeline.length}` : ''}`;
    const platformCounts = new Map();
    filtered.forEach(item => {
      const name = String(item.platform || 'Unspecified').trim() || 'Unspecified';
      platformCounts.set(name, (platformCounts.get(name) || 0) + 1);
    });
    $('#applicationPlatformCounts').innerHTML = [...platformCounts]
      .sort(([first], [second]) => first.localeCompare(second, undefined, { sensitivity: 'base' }))
      .map(([name, count]) => `<span class="application-platform-count">${escapeHtml(name)} - ${count}</span>`)
      .join('');
    const target = $('#applicationList');
    if (!filtered.length) {
      const isFiltered = pipeline.length > 0;
      target.innerHTML = `<div class="application-empty"><h3>${isFiltered ? 'No matching applications' : 'Start your client pipeline'}</h3><p>${isFiltered ? 'Try a different search or filter.' : 'Track each application, where you applied, and the next step all in one private workspace.'}</p>${isFiltered ? '' : '<button class="button button-primary" type="button" data-open-add>+ Add your first client</button>'}</div>`;
      return;
    }
    const renderRows = items => items.map(item => {
      const currency = item.salaryCurrency || 'USD';
      const salaryText = item.salaryType === 'monthly' && Number(item.salaryAmount) > 0
        ? `${formatSalaryAmount(item.salaryAmount, currency, 'monthly')} `
        : item.salaryType === 'hourly' && Number(item.salaryAmount) > 0
          ? Number(item.hoursPerWeek) > 0
            ? `${formatSalaryAmount(item.salaryAmount, currency, 'hourly', item.hoursPerWeek)} · ${formatSalaryAmount(item.salaryAmount, currency, 'hourly')}`
            : `${formatSalaryAmount(item.salaryAmount, currency, 'hourly')}`
          : 'Salary not set';
      return `
      <article class="application-row${isInterviewToday(item) ? ' interview-today' : ''}" data-view-details="${escapeHtml(item.id)}" tabindex="0" role="button" aria-label="View details for ${escapeHtml(item.clientName)}">
        <div><h3 class="client-card-title">${escapeHtml(item.clientName)}</h3><p class="client-card-subtitle">${escapeHtml(item.role || item.contact || item.nextStep || item.notes || 'No extra details')}</p>${item.website ? `<a class="client-card-website" href="${escapeHtml(normalizeUrl(item.website))}" target="_blank" rel="noopener">${escapeHtml(item.website)}</a>` : ''}${item.interviewLink ? `<a class="interview-link-button" href="${escapeHtml(normalizeUrl(item.interviewLink))}" target="_blank" rel="noopener"><span aria-hidden="true">↗</span> Join interview</a>` : ''}</div>
        <div class="application-meta">${escapeHtml(item.platform)}<small>${escapeHtml(item.employmentType || 'Employment type not set')}</small><small class="application-salary">${escapeHtml(salaryText)}</small></div>
        <div>${statusPill(item.status)}${item.interviewPriority ? '<span class="interview-priority-badge">INTERVIEW</span>' : ''}${matchBadge(item)}</div>
        <div class="application-meta">${emailDate(item.appliedDate)}<small>Applied${item.interviewDate ? ` · Interview ${formatDate(item.interviewDate)}` : ''}${item.followUpDate ? ` · Follow up ${formatDate(item.followUpDate)}` : ''}</small><small>Added ${emailDate(applicationAddedDate(item))}</small></div>
        <button class="icon-button list-icon-button update-row-button" type="button" data-edit-id="${escapeHtml(item.id)}" aria-label="Update ${escapeHtml(item.clientName)}" title="Update application">Update</button>
      </article>
    `; }).join('');
    const newestFirst = sortByDate(filtered, applicationAddedDate);
    const ongoing = newestFirst.filter(item => item.status === 'Ongoing');
    const interviews = newestFirst.filter(item => item.status === 'Interview');
    const toProceed = newestFirst.filter(item => isToProceedStatus(item));
    const applications = newestFirst.filter(item => item.status !== 'Ongoing' && item.status !== 'Interview' && !isToProceedStatus(item));
    target.innerHTML = [
      ongoing.length ? `<section class="application-group application-group-ongoing"><div class="application-group-heading"><h3><i class="fa-regular fa-clock" aria-hidden="true"></i> Ongoing</h3><span>${plural(ongoing.length, 'application')}</span></div>${renderRows(ongoing)}</section>` : '',
      interviews.length ? `<section class="application-group"><div class="application-group-heading"><h3><i class="fa-regular fa-calendar-check" aria-hidden="true"></i> Interviews</h3><span>${plural(interviews.length, 'interview')}</span></div>${renderRows(interviews)}</section>` : '',
      toProceed.length ? `<section class="application-group application-group-to-proceed"><div class="application-group-heading"><h3><i class="fa-solid fa-arrow-right" aria-hidden="true"></i> To proceed</h3><span>${plural(toProceed.length, 'application')}</span></div>${renderRows(toProceed)}</section>` : '',
      applications.length ? `<section class="application-group"><div class="application-group-heading"><h3><i class="fa-regular fa-paper-plane" aria-hidden="true"></i> Applications</h3><span>${plural(applications.length, 'application')}</span></div>${renderRows(applications)}</section>` : ''
    ].join('');
  }

  function emailWeekOptions() {
    const currentRange = weekRange();
    const emailDates = data.emails.map(item => dateKey(item.date)).filter(Boolean);
    const offsets = [...new Set(emailDates.map(date => {
      const emailDate = new Date(`${date}T12:00:00`);
      const daysSinceMonday = (emailDate.getDay() + 6) % 7;
      emailDate.setDate(emailDate.getDate() - daysSinceMonday);
      return Math.round((emailDate - new Date(`${currentRange.start}T12:00:00`)) / 86400000 / 7);
    }).filter(offset => offset < 0))].sort((first, second) => second - first);
    const options = offsets.map(offset => {
      const range = weekRange(offset);
      return `<option value="${offset}">${escapeHtml(weeklyRangeLabel(range).replace(' – ', ' to '))}</option>`;
    }).join('');
    return `<option value="all">All weeks</option><option value="0">This week</option>${options}`;
  }

  function renderToApplyList() {
    const target = $('#toApplyList');
    if (!target) return;
    const allReminders = data.toApply || [];
    const query = $('#toApplySearch').value.trim().toLowerCase();
    const sort = $('#toApplySort').value;
    const reminders = allReminders.filter(item => [item.title, item.link, item.notes].join(' ').toLowerCase().includes(query));
    reminders.sort((first, second) => {
      if (sort === 'title-asc') return String(first.title || '').localeCompare(String(second.title || ''), undefined, { sensitivity: 'base' });
      const dateOrder = String(first.dueDate || '').localeCompare(String(second.dueDate || ''));
      return sort === 'due-latest' ? -dateOrder : dateOrder;
    });
    $('#toApplyCountLabel').textContent = reminders.length === allReminders.length
      ? plural(reminders.length, 'reminder')
      : `${plural(reminders.length, 'reminder')} of ${plural(allReminders.length, 'reminder')}`;
    target.classList.toggle('is-empty', !reminders.length);
    if (!reminders.length) {
      target.innerHTML = `<div class="to-apply-empty">${allReminders.length ? 'No matching reminders.' : 'No application reminders yet.'}</div>`;
      return;
    }
    const currentDate = today();
    target.innerHTML = `<div class="to-apply-list-head"><span>Title &amp; link</span><span>Apply by</span><span>Actions</span></div>${reminders.map(item => {
      const overdue = item.dueDate < currentDate;
      const dueToday = item.dueDate === currentDate;
      return `<article class="to-apply-row${overdue ? ' overdue' : dueToday ? ' due-today' : ''}">
        <div class="to-apply-title"><strong>${escapeHtml(item.title)}</strong><a href="${escapeHtml(normalizeUrl(item.link))}" target="_blank" rel="noopener">${escapeHtml(item.link)}</a></div>
        <time class="to-apply-date"><span>${overdue ? 'Missed' : dueToday ? 'Apply today' : 'Apply by'}</span>${escapeHtml(formatDate(item.dueDate))}</time>
        <div class="to-apply-actions"><div class="to-apply-row-menu"><button class="button button-secondary to-apply-actions-trigger" type="button" data-to-apply-menu aria-haspopup="true" aria-expanded="false" aria-label="Actions for ${escapeHtml(item.title)}">Actions</button><div class="to-apply-menu-panel hidden" role="menu"><button type="button" role="menuitem" data-edit-to-apply="${escapeHtml(item.id)}">Edit</button><button type="button" role="menuitem" data-delete-to-apply="${escapeHtml(item.id)}">Delete</button></div></div></div>
      </article>`;
    }).join('')}`;
  }

  function processDueApplyReminders() {
    const currentDate = today();
    data.toApply = data.toApply || [];
    data.alerts = data.alerts || [];
    let changed = false;
    let remindersDue = 0;
    data.toApply.forEach(item => {
      if (item.dueDate !== currentDate) return;
      const alertId = `to-apply|due|${item.id}|${item.dueDate}`;
      if (data.alerts.some(alert => alert.id === alertId)) return;
      data.alerts.unshift({
        id: alertId,
        clientName: 'To apply',
        subject: `Apply today: ${item.title}`,
        from: 'Application reminder',
        date: new Date().toISOString(),
        unread: true
      });
      changed = true;
      remindersDue += 1;
    });
    if (changed) {
      data.alerts = data.alerts.slice(0, 30);
      persist();
      renderAlerts();
      showActionResult({
        title: 'Application reminders due',
        message: `${plural(remindersDue, 'application reminder')} are due today.`,
        status: 'info',
        label: 'APPLICATION REMINDER',
        actionLabel: 'Open To Apply',
        onAction: () => showView('to-apply')
      });
    }
  }

  function openToApplyModal(id = null) {
    const item = (data.toApply || []).find(reminder => reminder.id === id);
    $('#toApplyForm').reset();
    $('#toApplyId').value = id || '';
    $('#toApplyModalTitle').textContent = id ? 'Edit reminder' : 'Add reminder';
    $('#deleteToApplyButton').hidden = !id;
    if (item) {
      $('#toApplyTitle').value = item.title || '';
      $('#toApplyLink').value = item.link || '';
      $('#toApplyDate').value = item.dueDate || '';
      $('#toApplyNotes').value = item.notes || '';
    }
    $('#toApplyModal').showModal();
    setTimeout(() => $('#toApplyTitle').focus(), 30);
  }

  function saveToApply(event) {
    if (event.submitter?.value === 'cancel') return;
    event.preventDefault();
    const form = $('#toApplyForm');
    if (!form.reportValidity()) return;
    data.toApply = data.toApply || [];
    const id = $('#toApplyId').value || uid();
    const reminder = { id, title: $('#toApplyTitle').value.trim(), link: $('#toApplyLink').value.trim(), dueDate: $('#toApplyDate').value, notes: $('#toApplyNotes').value.trim() };
    data.alerts = (data.alerts || []).filter(alert => !alert.id.startsWith(`to-apply|due|${id}|`));
    const existingIndex = data.toApply.findIndex(item => item.id === id);
    if (existingIndex >= 0) data.toApply[existingIndex] = reminder;
    else data.toApply.push(reminder);
    $('#toApplyModal').close();
    processDueApplyReminders();
    persist();
    renderAll();
  }

  async function deleteToApply(id) {
    const item = (data.toApply || []).find(reminder => reminder.id === id);
    if (!item || !(await appConfirm(`Delete the application reminder “${item.title}”?`, { title: 'Delete reminder', confirmLabel: 'Delete', danger: true }))) return;
    data.toApply = data.toApply.filter(reminder => reminder.id !== id);
    data.alerts = (data.alerts || []).filter(alert => !alert.id.startsWith(`to-apply|${id}|`));
    persist();
    renderAll();
  }

  function updatePlatformFilter() {
    const select = $('#platformFilter');
    const selected = select.value;
    const platforms = [...new Set(pipelineApplications().map(item => item.platform).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    select.innerHTML = '<option value="">All platforms</option>' + platforms.map(platform => `<option value="${escapeHtml(platform)}">${escapeHtml(platform)}</option>`).join('');
    select.value = platforms.includes(selected) ? selected : '';
  }

  function renderEmails() {
    const query = $('#emailSearch').value.trim().toLowerCase();
    const weekOffset = Number(emailDateSort);
    const weekRangeFilter = emailDateSort === 'all' ? null : weekRange(weekOffset);
    $('#emailWeekDate').textContent = emailDateSort === 'all' ? 'All weeks' : weeklyRangeLabel(weekRangeFilter).replace(' – ', ' to ');
    $('#emailDateSort').innerHTML = emailWeekOptions();
    $('#emailDateSort').value = emailDateSort;
    const emails = data.emails
      .filter(item => [item.from, item.to, item.subject, item.body, item.date].join(' ').toLowerCase().includes(query))
      .filter(item => !emailDateFilter || dateKey(item.date) === emailDateFilter)
      .filter(item => emailDateSort === 'all' || isInWeeklyRange(item.date, weekRangeFilter))
      .filter(item => emailViewFilter === 'sent'
        ? (item.direction === 'sent' || item.source === 'sent') && applicationsRelatedToEmail(item).length > 0
        : item.direction !== 'sent' && item.source !== 'sent');
    const clientEmails = emails.filter(item => item.direction !== 'sent' && item.source !== 'sent');
    const sentEmails = emails.filter(item => item.direction === 'sent');
    const visibleEmails = sortByDate(emailViewFilter === 'sent' ? sentEmails : clientEmails, item => item.date);
    $('#emailCountLabel').textContent = `${plural(visibleEmails.length, 'email')}${query ? ' shown' : ''}`;
    $$('.email-view-tab').forEach(tab => {
      const selected = tab.dataset.emailView === emailViewFilter;
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-selected', String(selected));
    });
    const target = $('#emailList');
    const sectionClass = `email-section${emailViewFilter === 'sent' ? ' email-section-sent' : ''}${emailSelectionMode ? ' email-selection-mode' : ''}`;
    const sectionLabel = emailViewFilter === 'sent' ? 'Your sent messages' : 'All received email';
    const sectionEyebrow = emailViewFilter === 'sent' ? 'SENT BY YOU' : 'INBOX';
    $('#emailSectionLabel').textContent = sectionLabel;
    $('#emailSectionEyebrow').textContent = sectionEyebrow;
    const selectionActions = emailSelectionMode
      ? '<div class="email-bulk-actions"><label class="email-select-all-control"><input type="checkbox" data-email-select-all aria-label="Select all visible emails" /><span>Select all</span></label><span class="email-selection-count" data-email-selection-count aria-live="polite">0 selected</span><button class="email-selection-cancel" type="button" data-email-selection-toggle>Cancel</button><button class="button button-danger email-bulk-delete" type="button" data-email-bulk-delete disabled><i class="fa-regular fa-trash-can" aria-hidden="true"></i> Delete</button></div>'
      : '<button class="button button-secondary email-selection-trigger" type="button" data-email-selection-toggle><i class="fa-regular fa-square-check" aria-hidden="true"></i><span>Select emails</span></button>';
    $('#emailSelectionActions').innerHTML = selectionActions;
    if (!visibleEmails.length) {
      const hasFilters = Boolean(query || emailDateFilter || emailDateSort !== 'all');
      const title = emailViewFilter === 'sent'
        ? (hasFilters ? 'No matching sent emails' : 'No application-linked sent emails yet')
        : hasFilters
          ? 'No matching client emails'
          : 'No emails received yet';
      const copy = hasFilters
        ? 'Try another search term or date range.'
        : emailViewFilter === 'sent'
          ? 'Sent messages linked to an application or saved client will appear here.'
          : 'Received messages from Gmail will appear here.';
      target.innerHTML = `<section class="${sectionClass}"><div class="email-empty"><h3>${title}</h3><p>${copy}</p></div></section>`;
      return;
    }
    const renderEmailRows = items => items.map(item => {
      const initial = (item.from || '?').trim().charAt(0).toUpperCase();
      const matches = applicationsRelatedToEmail(item);
      const matchTag = matches.length ? `<span class="client-match-tag" aria-label="${matches.length} application matches" title="Matched to ${matches.length} applications">${matches.length}</span>` : '';
      const rawSender = (item.from || 'Unknown sender').trim();
      const sender = rawSender.includes('<')
        ? rawSender.slice(0, rawSender.indexOf('<')).replace(/["']/g, '').trim() || rawSender
        : rawSender;
      const bodyPreview = emailContentText(item.body).replace(/\s+/g, ' ').trim();
      const preview = bodyPreview.length > 110 ? `${bodyPreview.slice(0, 110).trimEnd()}...` : bodyPreview;
      const previewTitle = `${item.subject || '(No subject)'}${preview ? ` - ${preview}` : ''}`;
      const recipient = extractEmailAddress(item.from);
      const canCompose = matches.length && isEmailAddress(recipient);
      const sentClass = item.direction === 'sent' ? ' sent' : '';
      const sentBadge = item.direction === 'sent' ? '<span class="sent-email-badge">SENT</span>' : '';
      const dateLabel = item.direction === 'sent' ? 'Sent' : 'Received';
      const sentTime = emailTime(item.date);
      const selectionCheckbox = emailSelectionMode ? `<input class="email-select-checkbox" type="checkbox" data-email-select value="${escapeHtml(item.id)}" aria-label="Select ${escapeHtml(item.subject || 'email')}" />` : '';
      return `<article class="email-row${sentClass}" data-email-detail="${escapeHtml(item.id)}">${selectionCheckbox}<span class="email-avatar">${escapeHtml(initial)}</span><div class="email-row-content"><div class="email-sender-line"><h3 class="email-from" title="${escapeHtml(sender)}">${escapeHtml(sender)}</h3>${matchTag}</div><p class="email-preview" title="${escapeHtml(previewTitle)}"><strong class="email-subject">${escapeHtml(item.subject || '(No subject)')}</strong>${sentBadge}<span class="email-snippet">${preview ? ` - ${escapeHtml(preview)}` : ''}</span></p></div><time class="email-date" title="${dateLabel}"><span>${escapeHtml(emailDate(item.date))}</span>${sentTime ? `<span class="email-time">${escapeHtml(sentTime)}</span>` : ''}</time><div class="email-row-actions"><div class="email-action-menu"><button class="email-actions-trigger" type="button" data-email-action-trigger="${escapeHtml(item.id)}" aria-haspopup="true" aria-expanded="false">Actions</button><div class="email-actions-menu hidden" data-email-actions-menu="${escapeHtml(item.id)}" role="menu">${canCompose ? `<button type="button" role="menuitem" data-email-action="compose" data-email-id="${escapeHtml(item.id)}">Send email</button>` : ''}<button type="button" role="menuitem" class="email-action-delete" data-email-action="delete" data-email-id="${escapeHtml(item.id)}">Delete email</button></div></div></div></article>`;
    }).join('');
    target.innerHTML = `<section class="${sectionClass}">${renderEmailRows(visibleEmails)}</section>`;
  }

  function hiredClients() {
    return sortedApplications().filter(item => item.status === 'Active client' && !item.activePendingDocument && !item.activePendingEmail);
  }

  function normalizeUrl(value) {
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  }

  function formatFileSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function isContractEnded(item) {
    return Boolean(item.contractEndDate && dateKey(item.contractEndDate) < today());
  }

  function renderHired() {
    const query = $('#hiredSearch').value.trim().toLowerCase();
    const filter = $('#hiredStatusFilter')?.value || 'all';
    const dateFilter = $('#hiredDateFilter').value;
    const allHired = sortByDate(hiredClients(), activeSinceDate, hiredDateSort);
    const clients = allHired.filter(item => {
      const contractStatus = isContractEnded(item) ? 'Contract Ended' : (item.contractStatus || 'Active');
      const text = [item.clientName, item.email, item.phone, item.website, item.socialMedia, item.location, contractStatus].join(' ').toLowerCase();
      const statusMatch = filter === 'all' || contractStatus === filter;
      return statusMatch && (!query || text.includes(query)) && (!dateFilter || dateKey(activeSinceDate(item)) === dateFilter);
    });
    $('#hiredCountLabel').textContent = `${plural(clients.length, 'client')}${clients.length !== allHired.length ? ` of ${allHired.length}` : ''}`;
    const target = $('#hiredList');
    const detailPanel = $('#hiredDetailPanel');
    const hiredView = $('#hiredView');

    // Once a client is selected, keep the workspace focused on that one client.
    const selected = hiredEditingId ? clients.find(item => item.id === hiredEditingId) : null;
    if (selected) {
      hiredView.classList.add('client-focused');
      target.innerHTML = '';
      detailPanel.classList.remove('hidden');
      renderHiredDetail(selected, false);
      return;
    }
    hiredView.classList.remove('client-focused');

    if (!clients.length) {
      const hasAny = allHired.length > 0;
      target.innerHTML = `<div class="application-empty"><h3>${hasAny ? 'No matching clients' : 'No active clients yet'}</h3><p>${hasAny ? 'Try another search or contract status.' : 'Mark an application as “Active client” in your tracker and it will appear here.'}</p>${hasAny ? '' : '<button class="button button-primary" type="button" data-go-to="applications">Go to applications</button>'}</div>`;
      closeHiredDetail(false);
      return;
    }
    target.innerHTML = clients.map(item => {
      const docs = item.documents || [];
      const contractEnded = isContractEnded(item);
      const contractStatus = contractEnded ? 'Contract Ended' : (item.contractStatus || 'Active');
      const statusClass = contractEnded ? 'contract-ended' : (contractStatus === 'Not active' ? 'not-active' : 'contract-active');
      return `<article class="hired-card${contractEnded ? ' contract-ended-card' : ''}" data-hired-select="${escapeHtml(item.id)}" tabindex="0" role="button">
        <span class="hired-card-head"><span><strong class="client-card-title">${escapeHtml(item.clientName)}</strong><span class="client-card-subtitle">${escapeHtml(item.role || 'No role added')}</span></span><span class="hired-card-arrow" aria-hidden="true">→</span></span>
        <span class="client-contract-status ${statusClass}">${escapeHtml(contractStatus)}${item.contractEndDate ? ` · ends ${escapeHtml(formatDate(item.contractEndDate))}` : ''}</span>
        ${matchBadge(item) ? `<span>${matchBadge(item)}</span>` : ''}
        <span class="hired-card-meta">${item.email ? escapeHtml(item.email) : 'No email added'} · ${escapeHtml(item.employmentType || 'Employment type not set')} · Active since ${emailDate(activeSinceDate(item))} · Added ${emailDate(applicationAddedDate(item))}${docs.length ? ` · ${plural(docs.length, 'file')}` : ''}</span>
        ${item.website ? `<span class="hired-card-website"><a href="${escapeHtml(normalizeUrl(item.website))}" target="_blank" rel="noopener">${escapeHtml(item.website)}</a></span>` : ''}
        <span class="view-details-label">View details →</span>
      </article>`;
    }).join('');
    detailPanel.classList.add('hidden');
  }

  function renderHiredDetail(item, scroll = true) {
    if (!item) return;
    hiredEditingId = item.id;
    $('#hiredView').classList.add('client-focused');
    $('#hiredList').innerHTML = '';
    $('#hiredDetailPanel').classList.remove('hidden');
    const contractEnded = isContractEnded(item);
    const salaryLabel = item.salaryType === 'monthly' && Number(item.salaryAmount) > 0
      ? `$${Number(item.salaryAmount).toLocaleString()} / month`
      : item.salaryType === 'hourly' && Number(item.salaryAmount) > 0 && Number(item.hoursPerWeek) > 0
        ? `$${Math.round(Number(item.salaryAmount) * Number(item.hoursPerWeek) * 4).toLocaleString()} / month`
        : item.salaryType === 'hourly' && Number(item.salaryAmount) > 0
          ? `$${Number(item.salaryAmount).toLocaleString()} / hour`
          : 'Salary not set';
    $('#hiredDetailTitle').innerHTML = `${escapeHtml(contractEnded ? `${item.clientName} | Contract Ended` : item.clientName)} <span class="hired-detail-salary">${escapeHtml(salaryLabel)}</span>`;
    $('#hiredDetailSubtitle').textContent = item.role || 'Active client';
    const contractStatus = contractEnded ? 'Contract Ended' : (item.contractStatus || 'Active');
    $('#hiredDetailGrid').innerHTML = `
      <div><dt>Contact</dt><dd>${item.contact ? escapeHtml(item.contact) : '—'}</dd></div>
      <div><dt>Application</dt><dd><span class="status-pill active-client">Active client</span></dd></div>
      <div><dt>Contract status</dt><dd><span class="status-pill ${contractEnded ? 'contract-ended' : (contractStatus === 'Not active' ? 'not-active' : 'contract-active')}" >${escapeHtml(contractStatus)}</span></dd></div>
      ${contractEnded ? `<div><dt>Contract Ended Email Sent</dt><dd><span class="status-pill ${item.contractEndedEmailSentAt ? 'contract-active' : 'not-active'}">${item.contractEndedEmailSentAt ? 'Done' : 'Not sent'}</span></dd></div>` : ''}
      <div><dt>Contract end</dt><dd>${item.contractEndDate ? escapeHtml(formatDate(item.contractEndDate)) : 'No end date'}</dd></div>
      <div><dt>Email</dt><dd>${item.email ? `<a href="mailto:${escapeHtml(item.email)}">${escapeHtml(item.email)}</a>` : '—'}</dd></div>
      <div><dt>Phone</dt><dd>${item.phone ? escapeHtml(item.phone) : '—'}</dd></div>
      <div><dt>Website</dt><dd>${item.website ? `<a href="${escapeHtml(normalizeUrl(item.website))}" target="_blank" rel="noopener">${escapeHtml(item.website)}</a>` : '—'}</dd></div>
      <div><dt>Social</dt><dd>${item.socialMedia ? escapeHtml(item.socialMedia) : '—'}</dd></div>
      <div><dt>Location</dt><dd>${item.location ? escapeHtml(item.location) : '—'}</dd></div>
      <div><dt>Platform</dt><dd>${item.platform ? escapeHtml(item.platform) : '—'}</dd></div>
      <div><dt>Employment type</dt><dd>${item.employmentType ? escapeHtml(item.employmentType) : '—'}</dd></div>
      <div><dt>Applied</dt><dd>${escapeHtml(emailDate(item.appliedDate))}</dd></div>
      <div><dt>Added</dt><dd>${escapeHtml(emailDate(applicationAddedDate(item)))}</dd></div>
      <div><dt>Active since</dt><dd>${escapeHtml(emailDate(activeSinceDate(item)))}</dd></div>
      <div class="hired-detail-wide"><dt>Notes</dt><dd class="hired-notes">${item.notes ? escapeHtml(item.notes) : '—'}</dd></div>
      `;
    const invoiceRows = (data.invoices || []).filter(invoice => invoice.clientId === item.id).sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
    $('#hiredUploadSection').innerHTML = `
      <div class="active-client-two-column">
        <section class="invoice-send-panel${contractEnded ? ' contract-ended-readonly' : ''}">
          <div class="invoice-send-heading"><div><p class="eyebrow">BILLING</p><h3>Send invoice</h3></div><span class="invoice-sent-count" aria-label="${plural(invoiceRows.length, 'invoice')} sent">${plural(invoiceRows.length, 'invoice')} sent</span></div>
          <p>${contractEnded ? 'Invoice sending is unavailable while this contract is ended.' : 'Upload an invoice, check the detected invoice number, and send it through Gmail.'}</p>
          ${contractEnded ? '' : '<button class="button button-primary" type="button" id="sendInvoiceButton">+ Upload and send invoice</button>'}
          <div class="client-invoice-history">
            <p class="eyebrow">SENT INVOICES</p>
            <div class="client-invoice-list">${invoiceRows.length ? invoiceRows.map(invoice => `<div class="client-invoice-item"><strong>${escapeHtml(invoice.invoiceNumber)}</strong><span>${escapeHtml(invoice.fileName)}</span><small>${emailDate(invoice.sentAt)} · ${escapeHtml(invoice.service || 'Invoice')}</small></div>`).join('') : '<p class="client-invoice-empty">No invoices sent yet.</p>'}</div>
          </div>
        </section>
        <section class="active-document-box${contractEnded ? ' contract-ended-readonly' : ''}">
          <div class="active-document-box-head"><div><p class="eyebrow">CLIENT FILES</p><h3>Documents</h3></div>${contractEnded ? '<span class="details-readonly-label">Read only</span>' : '<div><button class="button button-secondary active-document-upload-button" type="button" id="hiredDetailUploadButton">+ Upload file</button><input id="hiredDetailDocumentInput" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden /></div>'}</div>
          <div id="hiredDocumentWorkspace"></div>
        </section>
      </div>
      ${renderHiredEmailHistory(item)}
      <div class="documents-folder-status" id="documentsFolderStatus" aria-live="polite">Files are stored securely in your account.</div>`;
    renderHiredDocumentWorkspace(item);
    loadClientOnboardingSubmission(item);
    if (scroll) $('#hiredDetailPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function loadClientOnboardingSubmission(item) {
    const target = $('#activeOnboardingResponse');
    if (!target) return;
    target.dataset.clientId = item.id;
    target.textContent = 'Loading onboarding status...';
    try {
      const { data: submission, error } = await requireSupabase().rpc('get_client_onboarding_submission', {
        p_client_id: item.id
      });
      if (error) throw error;
      if (target.dataset.clientId !== item.id || hiredEditingId !== item.id) return;
      if (!submission) {
        target.textContent = 'No onboarding response has been submitted yet. Use Actions → Send onboarding form to invite this client.';
        return;
      }
      const details = [
        ['Client contact', submission.contact_name],
        ['Email', submission.client_email],
        ['Phone', submission.phone],
        ['Time zone', submission.timezone],
        ['Availability and preferred working hours', submission.availability],
        ['Tools or platforms', submission.tools],
        ['First-week priorities', submission.priorities]
      ];
      target.replaceChildren();
      const submittedAt = document.createElement('p');
      submittedAt.className = 'active-client-onboarding-submitted';
      submittedAt.textContent = `Submitted ${new Date(submission.submitted_at).toLocaleString()}`;
      const list = document.createElement('dl');
      list.className = 'active-client-onboarding-details';
      details.forEach(([label, value]) => {
        const wrapper = document.createElement('div');
        const term = document.createElement('dt');
        const description = document.createElement('dd');
        term.textContent = label;
        description.textContent = value || 'Not provided';
        wrapper.append(term, description);
        list.append(wrapper);
      });
      target.append(submittedAt, list);
      document.querySelectorAll('#sendClientOnboardingLinkButton').forEach(button => { button.hidden = true; });
    } catch (error) {
      console.error('Could not load client onboarding response:', error);
      if (target.dataset.clientId === item.id && hiredEditingId === item.id) {
        target.textContent = 'Could not load onboarding status. Check your connection and try again.';
      }
    }
  }

  function closeHiredDetail(render = true) {
    hiredEditingId = null;
    $('#hiredView').classList.remove('client-focused');
    $('#hiredDetailPanel').classList.add('hidden');
    if (render) renderHired();
  }

  function updateWeekNavigationCounts() {
    const applicationRange = applicationDateSort && applicationDateSort !== 'all' ? weekRange(Number(applicationDateSort)) : null;
    const emailRange = emailDateSort === 'all' ? null : weekRange(Number(emailDateSort));
    const relevantReceivedEmails = receivedEmails().filter(item => matchApplicationsForEmail(item).length > 0);
    $('#navApplicationCount').textContent = !applicationDateSort || applicationDateSort === 'all'
      ? pipelineApplications().length
      : pipelineApplications().filter(item => isInWeeklyRange(applicationAddedDate(item), applicationRange)).length;
    $('#navEmailCount').textContent = emailDateSort === 'all'
      ? relevantReceivedEmails.length
      : relevantReceivedEmails.filter(item => isInWeeklyRange(item.date, emailRange)).length;
  }

  function updateToApplyAttention() {
    const hasUnfinishedApplications = (data.toApply || []).some(item => item.dueDate && item.dueDate <= today());
    const link = $('[data-view="to-apply"]');
    link.classList.toggle('to-apply-attention', hasUnfinishedApplications);
    link.setAttribute('aria-label', hasUnfinishedApplications ? 'To Apply - action needed' : 'To Apply');
  }

  function renderAll() {
    processContractEndedAlerts();
    renderDashboard();
    renderApplications();
    renderToApplyList();
    renderDailyTasks();
    renderHired();
    renderEmails();
    renderScripts();
    renderWorkLinks();
    renderPersonalDocuments();
    renderInvoiceList();
    updateWeekNavigationCounts();
    $('#navToApplyCount').textContent = (data.toApply || []).filter(item => item.dueDate === today()).length;
    updateToApplyAttention();
    $('#navHiredCount').textContent = hiredClients().length;
    $('#settingsAppCount').textContent = data.applications.length;
    $('#settingsEmailCount').textContent = receivedEmails().length;
    const autoBackupFrequency = $('#autoBackupFrequency');
    if (autoBackupFrequency) autoBackupFrequency.value = localStorage.getItem('jeff-va-auto-backup-frequency-v1') || 'off';
    renderAlerts();
    renderWeeklyReportAvailability();
  }

  function showView(view, { updateUrl = true } = {}) {
    if (view === 'password') view = 'account';
    const validViews = ['dashboard', 'daily-task', 'applications', 'to-apply', 'hired', 'inbox', 'documents', 'account'];
    if (!validViews.includes(view)) view = 'dashboard';
    if (view === 'account' && !hasAccountSettingsAccess()) view = 'dashboard';
    else if (view === 'account') {
      localStorage.setItem(ACTIVE_VIEW_KEY, view);
      if (updateUrl && window.location.hash !== '#account') {
        window.history.pushState({ view }, '', `${window.location.pathname}${window.location.search}#account`);
      }
      openWorkspaceSettings();
      return;
    }
    if (updateUrl && window.location.hash !== `#${view}`) {
      window.history.pushState({ view }, '', `${window.location.pathname}${window.location.search}#${view}`);
    }
    localStorage.setItem(ACTIVE_VIEW_KEY, view);
    activeView = view;
    if (view === 'applications') {
      renderApplications();
    }
    if (view === 'daily-task') renderDailyTasks();
    if (view === 'account') {
      renderPasswordPage();
      renderAccountPage();
      refreshAccountStorageUsage();
    }
    const labels = { dashboard: ['YOUR PIPELINE', 'Client overview'], 'daily-task': ['', 'Daily Task'], applications: ['', 'Applications'], 'to-apply': ['', 'To Apply'], hired: ['', 'Active Clients'], inbox: ['', 'Email'], documents: ['PRIVATE TOOLS', 'Tools'], account: ['', 'Account'] };
    $('#pageEyebrow').textContent = labels[view][0];
    $('#pageTitle').textContent = labels[view][1];
    $('#pageEyebrow').hidden = !labels[view][0];
    $('#pageTitle').hidden = false;
    $('#applicationWeekDate').hidden = view !== 'applications';
    $('#emailWeekDate').hidden = view !== 'inbox';
    if (view === 'inbox') {
      renderEmails();
    }
    $$('.view').forEach(panel => panel.classList.toggle('active', panel.dataset.viewPanel === view));
    $$('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.view === view));
    // The header Add client action belongs exclusively to the Applications view.
    // Keep it hidden everywhere else, including when navigating from the sidebar.
    const addClientButton = $('#openAddModal');
    addClientButton.hidden = activeView !== 'applications';
    addClientButton.setAttribute('aria-hidden', String(activeView !== 'applications'));
    const gmailHeaderActions = $('#gmailHeaderActions');
    gmailHeaderActions?.classList.toggle('hidden', activeView !== 'inbox');
    closeMobileSidebar({ restoreFocus: window.matchMedia('(max-width: 720px)').matches });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (view === 'inbox' && currentUser && gmailAccessToken) syncGmail(true);
  }

  function saveNewClientApplicationDraft() {
    const draft = {};
    $$('#clientForm input[id], #clientForm select[id], #clientForm textarea[id]').forEach(field => {
      if (field.id === 'clientId' || field.type === 'file') return;
      draft[field.id] = field.type === 'checkbox' ? field.checked : field.value;
    });
    localStorage.setItem(`${APPLICATION_DRAFT_KEY}:${currentUser?.id || 'anonymous'}`, JSON.stringify(draft));
  }

  function restoreNewClientApplicationDraft() {
    const savedDraft = localStorage.getItem(`${APPLICATION_DRAFT_KEY}:${currentUser?.id || 'anonymous'}`);
    if (!savedDraft) return false;

    let draft;
    try {
      draft = JSON.parse(savedDraft);
    } catch (error) {
      console.error('Could not restore the unfinished application:', error);
      showActionResult({ title: 'Unfinished application could not be restored', message: 'The saved draft is invalid and has been kept in browser storage.', status: 'error' });
      return false;
    }
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
      console.error('Could not restore the unfinished application: saved draft has an invalid format.');
      showActionResult({ title: 'Unfinished application could not be restored', message: 'The saved draft has an invalid format and has been kept in browser storage.', status: 'error' });
      return false;
    }

    Object.entries(draft).forEach(([id, value]) => {
      const field = document.getElementById(id);
      if (!field || field.closest('#clientForm') !== $('#clientForm')) return;
      if (field.type === 'checkbox') field.checked = value === true;
      else field.value = String(value ?? '');
    });
    $('#clientPlatform').dispatchEvent(new Event('change'));
    $('#clientCountry').dispatchEvent(new Event('change'));
    if ($('#clientRegion').value) $('#clientRegion').dispatchEvent(new Event('change'));
    updateSalaryFields();
    updateClientActionLabel();
    return true;
  }

  function openClientModal(id = null, viewOnly = false, activeClientOnly = false) {
    const form = $('#clientForm');
    form.reset();
    $$('#clientForm input, #clientForm select, #clientForm textarea').forEach(field => { field.disabled = false; });
    editingId = id;
    viewingClientDetails = viewOnly;
    $('#clientId').value = id || '';
    $('#appliedDate').value = id ? '' : today();
    $('#automaticFollowUp').checked = false;
    $('#appliedDate').disabled = false;
    $('#followUpDate').disabled = false;
    $('#automaticFollowUp').disabled = false;
    $('#followUpDate').closest('.form-field')?.classList.remove('hidden');
    $('#automaticFollowUp').closest('.follow-up-option')?.classList.remove('hidden');
    $('#customPlatformField').classList.add('hidden');
    $('#customPlatform').required = false;
    $('#clientCountry').value = '';
    $('#clientRegion').value = '';
    $('#clientRegionField').classList.add('hidden');
    $('#deleteClientButton').hidden = !id;
    $('#clientFollowUpHistory').classList.add('hidden');
    $('#clientEmailHistory').classList.add('hidden');
    if (id) {
      const item = data.applications.find(application => application.id === id);
      if (!item) return;
      $('#modalEyebrow').textContent = viewOnly ? 'VIEW DETAILS' : 'EDIT RECORD';
      $('#clientModalTitle').textContent = viewOnly ? 'Application details' : 'Update client application';
      $('#saveClientButton').textContent = 'Save changes';
      $('#clientName').value = item.clientName;
      $('#contactName').value = item.contact || '';
      $('#clientRole').value = item.role || '';
      $('#employmentType').value = item.employmentType || '';
      $('#hiredEmail').value = item.email || '';
      $('#hiredPhone').value = item.phone || '';
      $('#hiredWebsite').value = item.website || '';
      $('#hiredSocial').value = item.socialMedia || '';
      $('#hiredLocation').value = item.location || '';
      const savedLocation = String(item.location || '');
      const savedCountry = [...$('#clientCountry').options].find(option => savedLocation === option.text || savedLocation.startsWith(`${option.text},`));
      if (savedCountry) {
        $('#clientCountry').value = savedCountry.value;
        $('#clientCountry').dispatchEvent(new Event('change'));
        const savedRegion = [...$('#clientRegion').options].find(option => savedLocation.includes(option.text));
        if (savedRegion) $('#clientRegion').value = savedRegion.value;
      }
      $('#clientStatus').value = ['Ongoing', 'Applied', 'To Proceed', 'Interview', 'Active client', 'Not selected'].includes(item.status) ? item.status : 'Applied';
      $('#nextStep').value = item.nextStep || '';
      if (activeClientOnly && item.status !== 'Active client') return;
      $('#contractEndDate').value = item.contractEndDate || '';
      $('#appliedDate').value = item.appliedDate || '';
      $('#interviewDate').value = item.interviewDate || '';
      $('#interviewLink').value = item.interviewLink || '';
      $('#followUpDate').value = item.followUpDate || '';
      $('#automaticFollowUp').checked = Boolean(item.automaticFollowUp);
      $('#clientNotes').value = item.notes || '';
      renderClientFollowUpHistory(item, viewOnly);
      renderClientEmailHistory(item);
      const listedPlatforms = [...$('#clientPlatform').options].map(option => option.value);
      if (listedPlatforms.includes(item.platform)) {
        $('#clientPlatform').value = item.platform;
      } else {
        $('#clientPlatform').value = 'Other';
        $('#customPlatformField').classList.remove('hidden');
        $('#customPlatform').required = true;
        $('#customPlatform').value = item.platform;
      }
    } else {
      $('#modalEyebrow').textContent = 'NEW RECORD';
      $('#clientModalTitle').textContent = 'Add a client application';
      $('#saveClientButton').textContent = 'Save application';
      $('#salaryType').value = '';
      $('#salaryCurrency').value = 'USD';
      $('#salaryAmount').value = '';
      $('#salaryHoursPerWeek').value = '';
      updateSalaryFields();
    }
    if (id) {
      const item = data.applications.find(application => application.id === id);
      if (item) {
        $('#salaryType').value = item.salaryType || '';
        $('#salaryCurrency').value = item.salaryCurrency || 'USD';
        $('#salaryAmount').value = item.salaryAmount ?? '';
        $('#salaryHoursPerWeek').value = item.hoursPerWeek ?? '';
        updateSalaryFields();
      }
    }
    if (!id && !viewOnly) restoreNewClientApplicationDraft();
    $$('#clientForm input, #clientForm select, #clientForm textarea').forEach(field => { field.disabled = viewOnly; });
    if (activeClientOnly) {
      $('#clientStatus').value = 'Active client';
      $('#clientStatus').disabled = true;
    }
    $('#deleteClientButton').hidden = !id || viewOnly;
    $('#saveClientButton').hidden = viewOnly;
    $('#closeClientDetailsButton').hidden = !viewOnly;
    $('#clientForm').classList.toggle('view-details-form', viewOnly);
    const activeClientEdit = Boolean(id && data.applications.find(application => application.id === id)?.status === 'Active client' && !viewOnly);
    $('#appliedDate').disabled = activeClientEdit;
    $('#followUpDate').disabled = activeClientEdit;
    $('#automaticFollowUp').disabled = activeClientEdit;
    $('#followUpDate').closest('.form-field')?.classList.toggle('hidden', activeClientEdit);
    $('#automaticFollowUp').closest('.follow-up-option')?.classList.toggle('hidden', activeClientEdit);
    $('#clientModal').showModal();
    updateClientActionLabel();
    setTimeout(() => $('#clientName').focus(), 30);
  }

  function renderClientFollowUpHistory(item, viewOnly) {
    const target = $('#clientFollowUpHistory');
    if (!target || !viewOnly) return;
    const clientEmail = String(item.email || '').trim().toLowerCase();
    const followUps = data.emails.filter(email => email.direction === 'sent'
      && (email.applicationId === item.id || (clientEmail && String(email.to || '').trim().toLowerCase() === clientEmail && /^follow-up:/i.test(email.subject || ''))))
      .sort((first, second) => new Date(second.date) - new Date(first.date));
    const historicalFollowUp = !followUps.length && item.followUpSentAt
      ? [{ date: item.followUpSentAt, subject: `Follow-up: ${item.clientName}`, historical: true }]
      : followUps;
    target.classList.remove('hidden');
    target.innerHTML = `<div class="client-follow-up-history-head"><span>FOLLOW-UPS SENT</span><strong>${plural(historicalFollowUp.length, 'email')}</strong></div>${historicalFollowUp.length
      ? `<div class="client-follow-up-history-list">${historicalFollowUp.map(email => `<div><span title="${escapeHtml(email.subject || 'Follow-up')}">${escapeHtml(email.subject || 'Follow-up')}</span><small>${escapeHtml(emailDate(email.date))}</small></div>`).join('')}</div>`
      : '<p>No follow-up emails have been sent to this application.</p>'}`;
  }

  function renderClientEmailHistory(item) {
    const target = $('#clientEmailHistory');
    const list = $('#clientEmailHistoryList');
    const count = $('#clientEmailHistoryCount');
    if (!target || !list || !count) return;
    const sentEmails = sentEmailsForApplication(item);
    target.classList.remove('hidden');
    count.textContent = `${sentEmails.length} ${sentEmails.length === 1 ? 'email' : 'emails'}`;
    list.innerHTML = renderSentEmailHistoryItems(sentEmails, 'No emails have been sent to this application.');
  }

  function sentEmailsForApplication(item) {
    const clientEmail = String(item.email || '').trim().toLowerCase();
    return data.emails
      .filter(email => email.direction === 'sent'
        && (email.applicationId === item.id || (!email.applicationId && clientEmail && String(email.to || '').trim().toLowerCase() === clientEmail)))
      .sort((first, second) => new Date(second.date) - new Date(first.date));
  }

  function renderSentEmailHistoryItems(sentEmails, emptyMessage) {
    return sentEmails.length
      ? sentEmails.map(email => `<button type="button" class="client-email-history-item" data-email-detail="${escapeHtml(email.id)}"><span><strong>${escapeHtml(email.subject || '(No subject)')}</strong><small>${escapeHtml(emailContentText(email.body).slice(0, 150) || 'No message preview')}</small></span><time>${escapeHtml(emailDate(email.date))}</time></button>`).join('')
      : `<p>${emptyMessage}</p>`;
  }

  function renderHiredEmailHistory(item) {
    const sentEmails = sentEmailsForApplication(item);
    return `<section class="client-email-history hired-email-history" aria-live="polite">
      <div class="client-email-history-head"><div><p class="eyebrow">EMAIL HISTORY</p><h3>Sent to this client</h3></div><strong>${plural(sentEmails.length, 'email')}</strong></div>
      <div class="client-email-history-list">${renderSentEmailHistoryItems(sentEmails, 'No emails have been sent to this client.')}</div>
    </section>`;
  }

  function updateClientActionLabel() {
    const button = $('#saveClientButton');
    if (!button) return;
    const activeClient = $('#clientStatus').value === 'Active client';
    button.textContent = activeClient ? 'Next' : (editingId ? 'Save changes' : 'Save application');
    $$('.contract-field').forEach(field => field.classList.toggle('hidden', !activeClient));
    const activeClientEdit = Boolean(editingId && activeClient && !viewingClientDetails);
    $('#appliedDate').disabled = activeClientEdit;
    $('#followUpDate').disabled = activeClientEdit;
    $('#automaticFollowUp').disabled = activeClientEdit;
    $('#followUpDate').closest('.form-field')?.classList.toggle('hidden', activeClientEdit);
    $('#automaticFollowUp').closest('.follow-up-option')?.classList.toggle('hidden', activeClientEdit);
    const isInterview = $('#clientStatus').value === 'Interview';
    $$('.interview-field').forEach(field => field.classList.toggle('hidden', !isInterview));
    const interviewDate = $('#interviewDate');
    const interviewLink = $('#interviewLink');
    [interviewDate, interviewLink].forEach(field => {
      if (!field) return;
      field.required = isInterview;
      field.setCustomValidity(isInterview ? '' : '');
    });
    $('#sendEmailMenuButton').hidden = viewingClientDetails;
    $('#sendClientEmailButton').hidden = false;
    $('#sendEmailMenu').classList.add('hidden');
    $('#sendEmailMenuButton').setAttribute('aria-expanded', 'false');
    $('#nextStepField').classList.toggle('hidden', $('#clientStatus').value !== 'To Proceed');
    $('#sendProceedEmailButton').hidden = viewingClientDetails || $('#clientStatus').value !== 'To Proceed';
  }

  async function saveClient(event) {
    const submitter = event.submitter;
    if (submitter?.value === 'cancel') {
      if (!editingId) localStorage.removeItem(`${APPLICATION_DRAFT_KEY}:${currentUser?.id || 'anonymous'}`);
      return;
    }
    event.preventDefault();
    const form = $('#clientForm');
    if (!form.reportValidity()) return;
    if ($('#automaticFollowUp').checked && !$('#followUpDate').value) {
      $('#followUpDate').value = addDays(today(), 7);
    }
    const platformChoice = $('#clientPlatform').value;
    const existing = editingId ? data.applications.find(item => item.id === editingId) : null;
    const isActiveClient = $('#clientStatus').value === 'Active client';
    const contractEndDate = $('#contractEndDate').value;
    if (isActiveClient && contractEndDate && dateKey(contractEndDate) < today()
      && !(await appConfirm(`This contract end date has already passed (${formatDate(contractEndDate)}). Saving it will mark ${$('#clientName').value.trim() || 'this client'} as expired. Do you want to continue?`, { title: 'Contract date has passed', confirmLabel: 'Save anyway' }))) return;
    if (isActiveClient && (!existing || existing.status !== 'Active client')) beginActivationRollback(editingId || uid(), existing);
    const activeClientEmailPending = isActiveClient && (!existing || existing.status !== 'Active client' || Boolean(existing.activePendingEmail));
    const application = {
      id: editingId || (pendingActivation?.applicationId || uid()),
      clientName: $('#clientName').value.trim(),
      contact: $('#contactName').value.trim(),
      role: $('#clientRole').value.trim(),
      email: $('#hiredEmail').value.trim(),
      phone: $('#hiredPhone').value.trim(),
      website: $('#hiredWebsite').value.trim(),
      socialMedia: $('#hiredSocial').value.trim(),
      location: $('#hiredLocation').value.trim(),
      platform: platformChoice === 'Other' ? $('#customPlatform').value.trim() : platformChoice,
      employmentType: $('#employmentType').value,
      salaryType: $('#salaryType').value,
      salaryCurrency: $('#salaryCurrency').value || 'USD',
      salaryAmount: $('#salaryAmount').value === '' ? '' : Number($('#salaryAmount').value),
      hoursPerWeek: $('#salaryHoursPerWeek').value === '' ? '' : Number($('#salaryHoursPerWeek').value),
      status: $('#clientStatus').value,
      nextStep: $('#clientStatus').value === 'To Proceed' ? $('#nextStep').value.trim() : '',
      // Moving an application into Active Clients always requires a newly
      // confirmed contract for the activation email. Existing client files are
      // preserved, but they cannot accidentally skip this one-time step.
      activePendingDocument: isActiveClient && (!existing || existing.status !== 'Active client'),
      activePendingEmail: activeClientEmailPending,
      appliedDate: $('#appliedDate').value,
      interviewDate: $('#interviewDate').value,
      interviewLink: $('#interviewLink').value.trim(),
      interviewAlertDate: editingId && data.applications.find(item => item.id === editingId)?.interviewDate === $('#interviewDate').value ? (data.applications.find(item => item.id === editingId)?.interviewAlertDate || '') : '',
      createdAt: editingId ? (data.applications.find(item => item.id === editingId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
      activeAt: editingId ? (data.applications.find(item => item.id === editingId)?.activeAt || ($('#clientStatus').value === 'Active client' ? new Date().toISOString() : '')) : ($('#clientStatus').value === 'Active client' ? new Date().toISOString() : ''),
      followUpDate: $('#followUpDate').value,
      automaticFollowUp: $('#automaticFollowUp').checked,
      followUpProcessedAt: editingId && data.applications.find(item => item.id === editingId)?.followUpDate === $('#followUpDate').value ? (data.applications.find(item => item.id === editingId)?.followUpProcessedAt || '') : '',
      followUpSentAt: editingId && data.applications.find(item => item.id === editingId)?.followUpDate === $('#followUpDate').value ? (data.applications.find(item => item.id === editingId)?.followUpSentAt || '') : '',
      notes: $('#clientNotes').value.trim(),
      contractStatus: editingId ? (data.applications.find(item => item.id === editingId)?.contractStatus || 'Active') : 'Active',
      contractEndDate: isActiveClient ? contractEndDate : '',
      updatedAt: new Date().toISOString()
    };
    if (editingId) {
      // Document metadata lives in Supabase and is managed from the Active Clients page — carry the references forward.
      if (existing) application.documents = existing.documents;
      const index = data.applications.findIndex(item => item.id === editingId);
      if (index >= 0) data.applications[index] = application;
    } else {
      data.applications.push(application);
    }
    persist();
    if (!editingId) localStorage.removeItem(`${APPLICATION_DRAFT_KEY}:${currentUser?.id || 'anonymous'}`);
    $('#clientModal').close();
    renderAll();
    if (application.status === 'Active client' && application.activePendingDocument) {
      pendingActiveClientId = application.id;
      openClientDocumentPicker(application);
      toast('Next step: select or upload a client document');
    } else if (application.status === 'Active client' && application.activePendingEmail) {
      if (pendingActivation) pendingActivation.stage = 'email';
      openClientEmailComposer(application);
      toast('Next step: send the activation email');
    } else if (application.status === 'Active client') {
      showView('hired');
      renderHiredDetail(application);
    } else {
      showActionResult({ title: editingId ? 'Application updated' : 'Application added', message: editingId ? 'Your application changes were saved.' : 'The application was added to your workspace.' });
    }
    processDueInterviews();
    await processDueFollowUps();
  }

  async function deleteClient(id, fromActive = false) {
    const item = data.applications.find(application => application.id === id);
    if (!item) return;
    if (!(await appConfirm(`Delete ${item.clientName}? This removes the application and any attached documents from this browser. This cannot be undone unless you've exported a backup.`, { title: 'Delete client application', confirmLabel: 'Delete', danger: true }))) return;
    data.applications = data.applications.filter(application => application.id !== id);
    persist();
    (item.documents || []).forEach(doc => { deleteDocumentBlob(doc.storagePath || doc.id).catch(() => {}); });
    $('#clientModal')?.close();
    editingId = null;
    if (fromActive) closeHiredDetail(false);
    renderAll();
    showActionResult({ title: 'Client deleted', message: 'The client and its attached documents were removed.' });
  }
