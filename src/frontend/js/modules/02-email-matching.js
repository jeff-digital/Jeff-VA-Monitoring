  // --- Application/email matching ---
  const PLATFORM_SENDER_EMAILS = Object.freeze({
    '20four7va': 'info@20four7va.com',
    indeed: 'donotreply@jobalert.indeed.com',
    jobstreet: 'noreply@e.jobstreet.com',
    multiplymii: 'info@multiplymii.com',
    'onlinejobs.ph': 'support@onlinejobs.ph',
    'remote work ph': 'support@remotework.ph',
    zirtual: 'noreply@candidates.workablemail.com'
  });
  const PLATFORM_DISPLAY_NAMES = Object.freeze({
    '20four7va': '20four7VA',
    indeed: 'Indeed',
    jobstreet: 'Jobstreet',
    multiplymii: 'MultiplyMii',
    'onlinejobs.ph': 'OnlineJobs.ph',
    'remote work ph': 'Remote Work PH',
    zirtual: 'Zirtual'
  });
  let applicationEmailMatchesCache = new WeakMap();
  let applicationEmailSummaryCache = null;
  let applicationMatchIndex = [];
  let applicationMatchIndexSignature = '';
  let activeClientDetailsModalEdit = false;

  function applicationMatchSignature(applications = data.applications || []) {
    return (applications || []).map(application => [
      application.id || '',
      application.updatedAt || '',
      application.email || '',
      application.contact || '',
      application.clientName || '',
      application.role || ''
    ].join('|')).join('~');
  }

  // perf: precompute the application fields used by matching once per application snapshot instead of rescanning every row on each email.
  function buildApplicationMatchIndex(applications = data.applications || []) {
    const signature = applicationMatchSignature(applications);
    if (signature === applicationMatchIndexSignature && applicationMatchIndex.length === applications.length) return applicationMatchIndex;
    applicationMatchIndex = (applications || []).map(application => {
      const email = String(application.email || '').trim().toLowerCase();
      const contact = String(application.contact || '').trim().toLowerCase();
      const clientName = String(application.clientName || '').trim().toLowerCase();
      const role = String(application.role || '').trim().toLowerCase();
      return { application, email, contact, clientName, role };
    });
    applicationMatchIndexSignature = signature;
    return applicationMatchIndex;
  }

  function invalidateApplicationMatchCaches(applications = data.applications || []) {
    const nextSignature = applicationMatchSignature(applications);
    if (nextSignature !== applicationMatchIndexSignature) {
      applicationEmailMatchesCache = new WeakMap();
      applicationEmailSummaryCache = null;
      buildApplicationMatchIndex(applications);
    }
  }

  function platformSenderEmail(platform) {
    return PLATFORM_SENDER_EMAILS[String(platform || '').trim().toLowerCase()] || '';
  }

  function platformNameForSender(fromHeader) {
    const senderAddress = extractEmailAddress(fromHeader);
    const platform = Object.keys(PLATFORM_SENDER_EMAILS)
      .find(name => PLATFORM_SENDER_EMAILS[name] === senderAddress);
    return platform ? PLATFORM_DISPLAY_NAMES[platform] : '';
  }

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

  function isDirectClientApplication(application) {
    const platform = String(application.platform || '').trim().toLowerCase();
    return platform === 'direct client' || platform === 'direct apply';
  }

  function containsWholeWord(haystack, needle) {
    if (!needle) return false;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack || '');
  }

  function matchApplicationsForEmail(emailItem) {
    const cachedMatches = applicationEmailMatchesCache.get(emailItem);
    if (cachedMatches) return cachedMatches;
    const fromAddress = extractEmailAddress(emailItem.from);
    const senderName = extractSenderName(emailItem.from);
    const contentLower = `${emailItem.subject || ''} ${emailItem.body || ''}`.toLowerCase();
    const matches = [];
    for (const item of buildApplicationMatchIndex(data.applications)) {
      const { application, email, contact, clientName, role } = item;
      const roleReferenced = role.length >= 3 && contentLower.includes(role);
      const companyReferenced = clientName.length >= 3 && containsWholeWord(contentLower, clientName);
      if (email && email === fromAddress) {
        matches.push(application);
        continue;
      }
      if (!roleReferenced && !companyReferenced) continue;
      if ([contact, clientName].filter(name => name.length >= 3).some(name => containsWholeWord(senderName, name))) {
        matches.push(application);
      }
    }
    applicationEmailMatchesCache.set(emailItem, matches);
    return matches;
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

  function buildApplicationEmailSummary() {
    const summary = new Map((data.applications || []).map(application => [application.id, []]));
    for (const emailItem of data.emails || []) {
      for (const application of matchApplicationsForEmail(emailItem)) {
        summary.get(application.id)?.push(emailItem);
      }
    }
    return summary;
  }

  function matchingEmailsForApplication(application) {
    if (!applicationEmailSummaryCache) applicationEmailSummaryCache = buildApplicationEmailSummary();
    return applicationEmailSummaryCache.get(application.id) || [];
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
    const matches = matchingEmailsForApplication(app)
      .filter(emailItem => emailItem.direction !== 'sent' && emailItem.source !== 'sent');
    if (!matches.length) return '';
    return ` <button class="match-badge" type="button" data-application-emails="${escapeHtml(app.id)}" aria-label="View ${plural(matches.length, 'matching email')} for ${escapeHtml(app.clientName)}" title="View matching application emails">${matches.length}</button>`;
  }

  function renderDashboard() {
    const applications = data.applications;
    const pipelineCount = pipelineApplications().length;
    const active = hiredClients().filter(isActiveContract).length;
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

  function renderClientDashboard() {
    const clients = hiredClients();
    const activeClients = clients.filter(isActiveContract).length;
    const endedContracts = clients.filter(isContractEnded).length;
    $('#clientDashboardCount').textContent = activeClients;
    $('#clientDashboardDetail').textContent = activeClients
      ? `${plural(activeClients, 'client')} with an active contract`
      : 'No active contracts';
    $('#clientDashboardEndedCount').textContent = endedContracts;
    $('#clientDashboardEndedDetail').textContent = endedContracts
      ? `${plural(endedContracts, 'contract')} ended`
      : 'No ended contracts';
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
      target.innerHTML = `<div class="application-empty"><h3>${isFiltered ? 'No matching applications' : 'Start your client pipeline'}</h3><p>${isFiltered ? 'Try a different search or filter.' : 'Track each application, where you applied, and the next step all in one private workspace.'}</p>${isFiltered ? '' : '<button class="button button-primary" type="button" data-open-add>Add your first client</button>'}</div>`;
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
    const savingInDrawer = isActiveClientDrawerView('edit');
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
    const received = receivedEmails();
    const sent = data.emails.filter(item => (item.direction === 'sent' || item.source === 'sent')
      && applicationsRelatedToEmail(item).length > 0);
    $('#emailReceivedCount').textContent = received.length;
    $('#emailSentCount').textContent = sent.length;
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
    $$('.email-summary-item').forEach(button => {
      const selected = button.dataset.emailView === emailViewFilter;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const target = $('#emailList');
    const sectionClass = `email-section${emailViewFilter === 'sent' ? ' email-section-sent' : ''}${emailSelectionMode ? ' email-selection-mode' : ''}`;
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
      const matches = applicationsRelatedToEmail(item);
      const matchTag = matches.length ? `<span class="client-match-tag" aria-label="${matches.length} application matches" title="Matched to ${matches.length} applications">${matches.length}</span>` : '';
      const rawSender = (item.from || 'Unknown sender').trim();
      const platformName = item.direction !== 'sent' && item.source !== 'sent' ? platformNameForSender(item.from) : '';
      const sender = platformName || (rawSender.includes('<')
        ? rawSender.slice(0, rawSender.indexOf('<')).replace(/["']/g, '').trim() || rawSender
        : rawSender);
      const initial = sender.trim().charAt(0).toUpperCase() || '?';
      const bodyPreview = emailContentText(item.body).replace(/\s+/g, ' ').trim();
      const preview = bodyPreview.length > 110 ? `${bodyPreview.slice(0, 110).trimEnd()}...` : bodyPreview;
      const previewTitle = `${item.subject || '(No subject)'}${preview ? ` - ${preview}` : ''}`;
      const recipient = extractEmailAddress(item.from);
      const canCompose = matches.length > 0 && isEmailAddress(recipient);
      const sentClass = item.direction === 'sent' ? ' sent' : '';
      const sentBadge = item.direction === 'sent' ? '<span class="sent-email-badge">SENT</span>' : '';
      const dateLabel = item.direction === 'sent' ? 'Sent' : 'Received';
      const sentTime = emailTime(item.date);
      const selectionLabel = platformName ? `${platformName} email` : (item.subject || 'email');
      const selectionCheckbox = emailSelectionMode ? `<input class="email-select-checkbox" type="checkbox" data-email-select value="${escapeHtml(item.id)}" aria-label="Select ${escapeHtml(selectionLabel)}" />` : '';
      const previewMarkup = platformName ? '' : `<p class="email-preview" title="${escapeHtml(previewTitle)}"><strong class="email-subject">${escapeHtml(item.subject || '(No subject)')}</strong>${sentBadge}<span class="email-snippet">${preview ? ` - ${escapeHtml(preview)}` : ''}</span></p>`;
      return `<article class="email-row${sentClass}${platformName ? ' platform-email-row' : ''}" data-email-detail="${escapeHtml(item.id)}">${selectionCheckbox}<span class="email-avatar">${escapeHtml(initial)}</span><div class="email-row-content"><div class="email-sender-line"><h3 class="email-from" title="${escapeHtml(sender)}">${escapeHtml(sender)}</h3>${matchTag}</div>${previewMarkup}</div><time class="email-date" title="${dateLabel}"><span>${escapeHtml(emailDate(item.date))}</span>${sentTime ? `<span class="email-time">${escapeHtml(sentTime)}</span>` : ''}</time><div class="email-row-actions"><div class="email-action-menu"><button class="email-actions-trigger" type="button" data-email-action-trigger="${escapeHtml(item.id)}" aria-haspopup="true" aria-expanded="false">Actions</button><div class="email-actions-menu hidden" data-email-actions-menu="${escapeHtml(item.id)}" role="menu">${canCompose ? `<button type="button" role="menuitem" data-email-action="compose" data-email-id="${escapeHtml(item.id)}">Send email</button>` : ''}<button type="button" role="menuitem" class="email-action-delete" data-email-action="delete" data-email-id="${escapeHtml(item.id)}">Delete email</button></div></div></div></article>`;
    }).join('');
    target.innerHTML = `<section class="${sectionClass}">${renderEmailRows(visibleEmails)}</section>`;
  }

  function hiredClients() {
    return sortedApplications().filter(item => item.status === 'Active client' && !item.activePendingDocument && !item.activePendingEmail);
  }

  function normalizeUrl(value) {
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  }

  function clientInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return parts.length > 1
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
      : (parts[0]?.slice(0, 2) || '?').toUpperCase();
  }

  function clientAvatarHue(name) {
    return [...String(name || '')].reduce((hue, character) => hue + character.charCodeAt(0), 0) % 6;
  }

  const hiredClientAvatarUrls = new Map();
  const hiredClientAvatarLoads = new Map();

  function cacheHiredClientAvatar(clientId, storagePath, blob) {
    const current = hiredClientAvatarUrls.get(clientId);
    if (current) URL.revokeObjectURL(current.url);
    const url = URL.createObjectURL(blob);
    hiredClientAvatarUrls.set(clientId, { storagePath, url });
  }

  function clearHiredClientAvatar(clientId) {
    const current = hiredClientAvatarUrls.get(clientId);
    if (current) URL.revokeObjectURL(current.url);
    hiredClientAvatarUrls.delete(clientId);
  }

  function renderHiredClientAvatars() {
    $$('.hired-card-avatar-image[data-client-avatar-path]').forEach(async image => {
      const clientId = image.dataset.clientAvatarId;
      const storagePath = image.dataset.clientAvatarPath;
      const cached = hiredClientAvatarUrls.get(clientId);
      if (cached?.storagePath === storagePath) {
        image.src = cached.url;
        image.hidden = false;
        return;
      }
      try {
        const loadKey = `${clientId}:${storagePath}`;
        let load = hiredClientAvatarLoads.get(loadKey);
        if (!load) {
          load = getDocumentBlob(storagePath).then(blob => {
            const item = data.applications.find(application => application.id === clientId);
            if (!item || item.profileImage?.storagePath !== storagePath) return '';
            cacheHiredClientAvatar(clientId, storagePath, blob);
            return hiredClientAvatarUrls.get(clientId).url;
          }).finally(() => hiredClientAvatarLoads.delete(loadKey));
          hiredClientAvatarLoads.set(loadKey, load);
        }
        const url = await load;
        if (!url || !image.isConnected || image.dataset.clientAvatarPath !== storagePath) return;
        image.src = url;
        image.hidden = false;
      } catch (error) {
        console.error('Could not load client profile photo:', error);
        showActionResult({
          title: 'Profile photo could not be loaded',
          message: 'The client photo is unavailable. The initials avatar will remain visible.',
          status: 'error'
        });
      }
    });
  }

  function formatFileSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function isContractEnded(item) {
    return String(item.contractStatus || '').trim().toLowerCase() === 'contract ended'
      || Boolean(item.contractEndDate && dateKey(item.contractEndDate) < today());
  }

  function isActiveContract(item) {
    return item.status === 'Active client'
      && !isContractEnded(item)
      && String(item.contractStatus || 'Active').trim().toLowerCase() === 'active';
  }

  function contractEndingLabel(item) {
    if (!item.contractEndDate || isContractEnded(item)) return '';
    const endDate = new Date(`${dateKey(item.contractEndDate)}T12:00:00`);
    const currentDate = new Date(`${today()}T12:00:00`);
    const daysRemaining = Math.round((endDate - currentDate) / 86400000);
    if (daysRemaining < 0 || daysRemaining > 7) return '';
    if (daysRemaining === 0) return 'Ends today';
    return `Ends in ${plural(daysRemaining, 'day')}`;
  }

  function clientOnlineStatus(item, now = new Date()) {
    const timeZone = clientTimeZones.get(item.id);
    if (!timeZone) return { className: 'unknown', text: 'Time zone not set', localTime: '', utcOffset: '' };
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
        hourCycle: 'h23'
      }).formatToParts(now);
      const part = type => parts.find(value => value.type === type)?.value;
      const weekday = part('weekday');
      const hour = Number(part('hour'));
      if (!weekday || !Number.isInteger(hour)) return { className: 'unknown', text: 'Time zone not set', localTime: '', utcOffset: '' };
      const localTime = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: 'numeric',
        minute: '2-digit'
      }).format(now);
      const offsetLabel = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'longOffset'
      }).formatToParts(now).find(value => value.type === 'timeZoneName')?.value || 'GMT';
      const utcOffset = offsetLabel === 'GMT' || offsetLabel === 'UTC'
        ? 'UTC+00:00'
        : offsetLabel.replace(/^GMT/, 'UTC');
      const isOnline = !['Sat', 'Sun'].includes(weekday) && hour >= 9 && hour < 17;
      return {
        className: isOnline ? 'online' : 'offline',
        text: `${isOnline ? 'Online now' : 'Offline'} · ${localTime} · ${utcOffset}`,
        localTime,
        utcOffset
      };
    } catch (error) {
      if (error instanceof RangeError) return { className: 'unknown', text: 'Time zone not set', localTime: '', utcOffset: '' };
      throw error;
    }
  }

  function renderClientOnlineStatus(item, includeLabel = true) {
    const status = clientOnlineStatus(item);
    return `<span class="client-online-status ${status.className}${includeLabel ? '' : ' status-dot-only'}" title="${includeLabel ? 'Estimated from weekdays, 9 AM–5 PM client local time' : escapeHtml(status.text)}" aria-label="${escapeHtml(status.text)}" data-client-online-status="${escapeHtml(item.id)}" data-status-dot-only="${!includeLabel}">${includeLabel ? escapeHtml(status.text) : ''}</span>`;
  }

  function updateClientOnlineIndicators() {
    document.querySelectorAll('[data-client-online-status]').forEach(indicator => {
      const item = data.applications.find(application => application.id === indicator.dataset.clientOnlineStatus);
      if (!item) return;
      const status = clientOnlineStatus(item);
      indicator.className = `client-online-status ${status.className}${indicator.dataset.statusDotOnly === 'true' ? ' status-dot-only' : ''}`;
      if (indicator.classList.contains('status-dot-only')) {
        indicator.textContent = '';
        indicator.title = status.text;
        indicator.setAttribute('aria-label', status.text);
        const timeZoneText = indicator.closest('.hired-card-timezone')?.querySelector('[data-client-timezone-text]');
        if (timeZoneText && status.localTime) timeZoneText.textContent = `${status.localTime} (${status.utcOffset})`;
      } else {
        indicator.textContent = status.text;
        indicator.title = 'Estimated from weekdays, 9 AM–5 PM client local time';
      }
    });
  }

  setInterval(updateClientOnlineIndicators, 60000);
  window.addEventListener('focus', updateClientOnlineIndicators);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateClientOnlineIndicators();
  });

  let showingHiredClientList = false;

  function renderHired() {
    const allHired = sortByDate(hiredClients(), activeSinceDate, hiredDateSort);
    const query = $('#hiredSearch').value.trim().toLowerCase();
    const filter = $('#hiredStatusFilter').value;
    const dateFilter = $('#hiredDateFilter').value;
    const clients = allHired.filter(item => {
      const contractStatus = isContractEnded(item) ? 'Contract Ended' : (item.contractStatus || 'Active');
      const searchableText = [
        item.clientName, item.email, item.phone, item.website, item.socialMedia, item.location,
        item.companyName, item.company, item.role, contractStatus
      ].join(' ').toLowerCase();
      return (filter === 'all' || contractStatus === filter)
        && (!query || searchableText.includes(query))
        && (!dateFilter || dateKey(activeSinceDate(item)) === dateFilter);
    });
    const nonEndedClients = clients.filter(item => !isContractEnded(item));
    const endedClients = clients.filter(isContractEnded);
    const target = $('#hiredList');
    const detailPanel = $('#hiredDetailPanel');
    const hiredView = $('#hiredView');
    const panel = target.closest('.hired-panel');
    const allActiveClients = allHired.filter(isActiveContract);
    const allEndedClients = allHired.filter(isContractEnded);
    $('#hiredCountLabel').textContent = `${allHired.length} ${allHired.length === 1 ? 'client' : 'clients'}`;
    $('#hiredActiveSummary').textContent = String(allActiveClients.length);
    $('#hiredEndedSummary').textContent = String(allEndedClients.length);
    const selected = allHired.find(item => item.id === hiredEditingId)
      || allActiveClients[0];
    if (!selected && allHired.length) showingHiredClientList = true;

    if (showingHiredClientList) {
      hiredView.classList.remove('client-focused');
      $('#hiredCountLabel').hidden = false;
      detailPanel.classList.add('hidden');
      detailPanel.dataset.clientId = '';
      panel.hidden = false;
      target.innerHTML = clients.length
        ? [
          ...nonEndedClients.map(renderActiveClientCard),
          ...(endedClients.length ? ['<h3 class="hired-ended-heading">Ended</h3>', ...endedClients.map(renderActiveClientCard)] : [])
        ].join('')
        : `<div class="application-empty"><h3>${allHired.length ? 'No matching clients' : 'No clients yet'}</h3><p>${allHired.length ? 'Try changing your search or filters.' : 'Clients marked as active in your tracker will appear here.'}</p></div>`;
      renderHiredClientAvatars();
      return;
    }
    if (selected) {
      renderHiredDetail(selected, false);
      return;
    }
    hiredView.classList.remove('client-focused');
    $('#hiredCountLabel').hidden = false;
    target.innerHTML = '<div class="application-empty"><h3>No active clients yet</h3><p>Clients with an active contract will appear here.</p></div>';
    panel.hidden = false;
    detailPanel.classList.add('hidden');
    detailPanel.dataset.clientId = '';
  }

  function renderActiveClientCard(item) {
    const docs = item.documents || [];
    const contractEnded = isContractEnded(item);
    const contractStatus = contractEnded ? 'Contract Ended' : (item.contractStatus || 'Active');
    const endingLabel = contractEnded ? 'Contract ended' : contractEndingLabel(item);
    const statusLabel = endingLabel || (contractStatus === 'Not active' ? 'Not active' : 'Active');
    const statusPillClass = contractEnded ? 'contract-ended'
      : (endingLabel ? 'contract-ending-soon' : (contractStatus === 'Not active' ? 'not-active' : 'contract-active'));
    const contractDetails = [
      item.employmentType,
      activeSinceDate(item) ? `Since ${emailDate(activeSinceDate(item))}` : ''
    ].filter(Boolean).map(escapeHtml).join(' · ');
    const initials = clientInitials(item.clientName);
    const avatarTone = clientAvatarHue(item.clientName);
    const emailMarkup = item.email ? `<span class="hired-card-email" title="${escapeHtml(item.email)}">${escapeHtml(item.email)}</span>` : '';
    const websiteMarkup = item.website ? `<a class="hired-card-website" href="${escapeHtml(normalizeUrl(item.website))}" target="_blank" rel="noopener"><i class="fa-solid fa-globe" aria-hidden="true"></i><span>${escapeHtml(item.website)}</span></a>` : '';
    const companyMarkup = item.companyName || item.company
      ? `<span class="hired-card-company">${escapeHtml(item.companyName || item.company)}</span>`
      : websiteMarkup;
    const matchCount = matchingEmailsForApplication(item)
      .filter(emailItem => emailItem.direction !== 'sent' && emailItem.source !== 'sent').length;
    const matchMarkup = matchCount
      ? `<span class="hired-card-match"><i class="fa-regular fa-envelope" title="Emails" aria-label="Emails"></i>${matchBadge(item).replace('title="View matching application emails"', `title="${matchCount} matching incoming emails"`)}</span>`
      : '';
    const timeZone = clientTimeZones.has(item.id) ? clientOnlineStatus(item) : null;
    const timeZoneMarkup = timeZone?.localTime
      ? `<span class="hired-card-timezone">${!contractEnded ? renderClientOnlineStatus(item, false) : ''}<span class="hired-card-timezone-separator" aria-hidden="true">·</span><span data-client-timezone-text>${escapeHtml(`${timeZone.localTime} (${timeZone.utcOffset})`)}</span></span>`
      : '';
    const avatarPath = item.profileImage?.storagePath || '';
    return `<article class="hired-card${contractEnded ? ' contract-ended-card' : ''}" data-hired-select="${escapeHtml(item.id)}" tabindex="0" role="button">
      <span class="hired-card-heading"><span class="hired-card-profile"><span class="hired-card-avatar" style="--avatar-tone:${avatarTone}"><span aria-hidden="true">${escapeHtml(initials)}</span>${avatarPath ? `<img class="hired-card-avatar-image" data-client-avatar-id="${escapeHtml(item.id)}" data-client-avatar-path="${escapeHtml(avatarPath)}" alt="${escapeHtml(item.clientName)} profile photo" hidden />` : ''}<button class="hired-card-avatar-upload" type="button" data-client-avatar-upload="${escapeHtml(item.id)}" aria-label="${avatarPath ? 'Change' : 'Upload'} profile photo for ${escapeHtml(item.clientName)}" title="${avatarPath ? 'Change profile photo' : 'Upload profile photo'}"><i class="fa-solid fa-camera" aria-hidden="true"></i></button><input class="hired-card-avatar-input" type="file" accept=".jpg,.jpeg,.jpe,.png,.webp,image/jpeg,image/jpg,image/pjpeg,image/png,image/x-png,image/webp" data-client-avatar-input="${escapeHtml(item.id)}" aria-label="Choose a profile photo for ${escapeHtml(item.clientName)}" hidden /></span><span class="hired-card-identity"><strong class="client-card-title">${escapeHtml(item.clientName)}</strong>${item.role ? `<span class="client-card-subtitle">${escapeHtml(item.role)}</span>` : ''}</span></span><span class="client-contract-status ${statusPillClass}">${escapeHtml(statusLabel)}</span></span>
      ${emailMarkup ? `<span class="hired-card-email-line">${emailMarkup}</span>` : ''}
      ${companyMarkup || timeZoneMarkup ? `<span class="hired-card-contact">${companyMarkup}${timeZoneMarkup}</span>` : ''}
      ${contractDetails ? `<span class="hired-card-contract"><i class="fa-regular fa-calendar" aria-hidden="true"></i>${contractDetails}</span>` : ''}
      <span class="hired-card-footer">${docs.length ? `<span class="hired-card-files" title="${escapeHtml(plural(docs.length, 'file'))}"><i class="fa-regular fa-file" aria-hidden="true"></i>${escapeHtml(plural(docs.length, 'file'))}</span>` : ''}${matchMarkup}<span class="view-details-label">View Details <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></span></span>
    </article>`;
  }

  $('#backToHiredList').addEventListener('click', () => {
    showingHiredClientList = true;
    renderHired();
  });
  $('#hiredSearch').addEventListener('input', renderHired);
  $('#hiredDateFilter').addEventListener('change', event => {
    hiredDateFilter = event.target.value;
    renderHired();
  });
  $('#hiredDateSort').addEventListener('change', event => {
    hiredDateSort = event.target.value;
    renderHired();
  });
  $('#hiredStatusFilter').addEventListener('change', renderHired);

  function renderHiredDetail(item, scroll = true) {
    if (!item) return;
    showingHiredClientList = false;
    $('#hiredCountLabel').hidden = true;
    hiredEditingId = item.id;
    $('#hiredView').classList.add('client-focused');
    $('#hiredList').innerHTML = '';
    $('#hiredList').closest('.hired-panel').hidden = true;
    const detailPanel = $('#hiredDetailPanel');
    detailPanel.classList.remove('hidden');
    if (detailPanel.dataset.clientId !== item.id) {
      detailPanel.dataset.clientId = item.id;
      selectClientDetailTab('overview');
    }
    const contractEnded = isContractEnded(item);
    const contractStatus = contractEnded ? 'Contract Ended' : (item.contractStatus || 'Active');
    const contractStatusClass = contractEnded ? 'contract-ended' : (contractStatus === 'Not active' ? 'not-active' : 'contract-active');
    const salaryLabel = item.salaryType === 'monthly' && Number(item.salaryAmount) > 0
      ? `$${Number(item.salaryAmount).toLocaleString()} / month`
      : item.salaryType === 'hourly' && Number(item.salaryAmount) > 0 && Number(item.hoursPerWeek) > 0
        ? `$${Math.round(Number(item.salaryAmount) * Number(item.hoursPerWeek) * 4).toLocaleString()} / month`
        : item.salaryType === 'hourly' && Number(item.salaryAmount) > 0
          ? `$${Number(item.salaryAmount).toLocaleString()} / hour`
          : '';
    $('#hiredDetailTitle').textContent = item.clientName || 'Active client';
    $('#hiredDetailSubtitle').textContent = item.role || 'Client workspace';
    $('#hiredDetailStatus').className = `status-pill ${contractStatusClass}`;
    $('#hiredDetailStatus').textContent = contractStatus;
    const onlineStatus = $('#hiredDetailOnlineStatus');
    onlineStatus.dataset.clientOnlineStatus = item.id;
    const clientStatus = clientOnlineStatus(item);
    onlineStatus.className = `client-online-status ${clientStatus.className}`;
    onlineStatus.textContent = clientStatus.text;
    onlineStatus.title = 'Estimated from weekdays, 9 AM–5 PM client local time';
    const contactDetails = [
      item.email ? `<a href="mailto:${escapeHtml(item.email)}">${escapeHtml(item.email)}</a>` : '',
      item.phone ? `<a href="tel:${escapeHtml(item.phone)}">${escapeHtml(item.phone)}</a>` : ''
    ].filter(Boolean);
    $('#hiredDetailContact').innerHTML = contactDetails.length
      ? `<span class="hired-detail-contact-separator" aria-hidden="true">·</span>${contactDetails.join('<span class="hired-detail-contact-separator" aria-hidden="true">·</span>')}`
      : '';
    const invoices = (data.invoices || []).filter(invoice => invoice.clientId === item.id).sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
    const sentEmails = sentEmailsForApplication(item);
    const latestInvoice = invoices[0];
    const latestEmail = sentEmails[0];
    $('#clientOverviewSummary').innerHTML = `
      <div class="client-overview-summary-item"><span>Contract</span><strong>${escapeHtml(contractStatus)}</strong><small>${item.contractEndDate ? `Ends ${escapeHtml(formatDate(item.contractEndDate))}` : 'No end date set'}</small></div>
      <div class="client-overview-summary-item"><span>Onboarding</span><strong id="clientOverviewOnboardingStatus">Checking status</strong><small>Client form response</small></div>
      <div class="client-overview-summary-item"><span>Invoices</span><strong>${escapeHtml(plural(invoices.length, 'invoice'))}</strong><small>${latestInvoice ? `Last sent ${escapeHtml(emailDate(latestInvoice.sentAt))}` : 'No invoices sent yet'}</small></div>
      <div class="client-overview-summary-item"><span>Email History</span><strong>${escapeHtml(plural(sentEmails.length, 'email'))}</strong><small>${latestEmail ? `Last sent ${escapeHtml(emailDate(latestEmail.date))}` : 'No emails sent yet'}</small></div>`;
    const detailsMarkup = fields => fields.filter(([, value]) => value).map(([label, value]) => `
      <div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`).join('');
    const contactFields = detailsMarkup([
      ['Contact', item.contact && escapeHtml(item.contact)],
      ['Email', item.email && `<a href="mailto:${escapeHtml(item.email)}">${escapeHtml(item.email)}</a>`],
      ['Phone', item.phone && `<a href="tel:${escapeHtml(item.phone)}">${escapeHtml(item.phone)}</a>`],
      ['Website', item.website && `<a href="${escapeHtml(normalizeUrl(item.website))}" target="_blank" rel="noopener">${escapeHtml(item.website)}</a>`],
      ['Social', item.socialMedia && escapeHtml(item.socialMedia)],
      ['Location', item.location && escapeHtml(item.location)]
    ]);
    const workFields = detailsMarkup([
      ['Position', item.role && escapeHtml(item.role)],
      ['Platform', item.platform && escapeHtml(item.platform)],
      ['Employment type', item.employmentType && escapeHtml(item.employmentType)],
      ['Compensation', salaryLabel && escapeHtml(salaryLabel)],
      ['Hours per week', Number(item.hoursPerWeek) > 0 && escapeHtml(String(item.hoursPerWeek))]
    ]);
    $('#hiredDetailGrid').innerHTML = `
      <section class="hired-detail-info-group">
        <h4>Contact Information</h4>
        ${contactFields ? `<dl>${contactFields}</dl>` : '<p class="client-detail-empty-copy">No contact information has been added.</p>'}
      </section>
      <section class="hired-detail-info-group">
        <h4>Work Information</h4>
        ${workFields ? `<dl>${workFields}</dl>` : '<p class="client-detail-empty-copy">No work information has been added.</p>'}
      </section>
      <section class="hired-detail-info-group hired-detail-timeline">
        <h4>Client History</h4>
        <dl>${detailsMarkup([
          ['Applied', item.appliedDate && escapeHtml(emailDate(item.appliedDate))],
          ['Added', escapeHtml(emailDate(applicationAddedDate(item)))],
          ['Active since', escapeHtml(emailDate(activeSinceDate(item)))]
        ])}</dl>
      </section>
      ${item.notes ? `<section class="hired-detail-info-group hired-detail-notes"><h4>Notes</h4><p>${escapeHtml(item.notes)}</p></section>` : ''}`;
    $('#clientContractSummary').innerHTML = `
      <dl class="client-contract-facts">
        <div><dt>Status</dt><dd><span class="status-pill ${contractStatusClass}">${escapeHtml(contractStatus)}</span></dd></div>
        <div><dt>Active since</dt><dd>${escapeHtml(emailDate(activeSinceDate(item)))}</dd></div>
        <div><dt>End date</dt><dd>${item.contractEndDate ? escapeHtml(formatDate(item.contractEndDate)) : 'No end date set'}</dd></div>
        ${item.contractEndDate && contractDuration(item) ? `<div><dt>Duration</dt><dd>${escapeHtml(contractDuration(item))}</dd></div>` : ''}
        ${contractEnded ? `<div><dt>Contract ended email</dt><dd><span class="status-pill ${item.contractEndedEmailSentAt ? 'contract-active' : 'not-active'}">${item.contractEndedEmailSentAt ? 'Sent' : 'Not sent'}</span></dd></div>` : ''}
      </dl>`;
    $('#clientInvoiceWorkspace').innerHTML = `
      <section class="invoice-send-panel client-invoice-panel${contractEnded ? ' contract-ended-readonly' : ''}" aria-labelledby="clientInvoicesTitle">
        <div class="invoice-send-heading"><div><p class="eyebrow">BILLING</p><h3 id="clientInvoicesTitle">Invoices</h3></div><span class="invoice-sent-count">${escapeHtml(plural(invoices.length, 'invoice'))} sent</span></div>
        <div class="client-invoice-actions">${contractEnded ? '<p class="client-invoice-notice">Invoice sending is unavailable while this contract is ended.</p>' : '<p>Invoices sent to this client appear here.</p><button class="button button-primary" type="button" id="sendInvoiceButton">Send Invoice</button>'}</div>
        ${invoices.length ? `<div class="client-invoice-list" role="list">${invoices.map(invoice => `
          <article class="client-invoice-item" role="listitem">
            <div class="client-invoice-main"><strong>${escapeHtml(invoice.invoiceNumber || 'Invoice')}</strong><span>${escapeHtml(invoice.fileName || 'Invoice document')}</span></div>
            <div class="client-invoice-meta"><span>${escapeHtml(invoice.service || 'Invoice')}</span>${invoice.billingPeriod ? `<span>${escapeHtml(invoice.billingPeriod)}</span>` : ''}${invoice.dueDate ? `<span>Due ${escapeHtml(formatDate(invoice.dueDate))}</span>` : ''}</div>
            <div class="client-invoice-date"><span class="status-pill contract-active">Sent</span><time>${escapeHtml(emailDate(invoice.sentAt))}</time></div>
          </article>`).join('')}</div>` : `<div class="client-section-empty"><h4>No invoices yet</h4><p>${contractEnded ? 'No invoices have been sent to this client.' : 'Send an invoice to keep billing history together.'}</p>${contractEnded ? '' : '<button class="button button-secondary" type="button" id="sendInvoiceButton">Send Invoice</button>'}</div>`}
      </section>`;
    $('#clientEmailHistoryWorkspace').innerHTML = renderHiredEmailHistory(item);
    $('#clientDocumentActions').innerHTML = contractEnded
      ? '<span class="details-readonly-label">Read only</span>'
      : '<button class="button button-secondary active-document-upload-button" type="button" id="hiredDetailUploadButton">Upload file</button><input id="hiredDetailDocumentInput" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden />';
    $('#clientDocumentBox').classList.toggle('contract-ended-readonly', contractEnded);
    $('#documentsFolderStatus').textContent = 'Files are stored securely in your account.';
    renderHiredDocumentWorkspace(item);
    loadClientOnboardingSubmission(item);
    renderClientTasks(item.id);
    if (scroll) $('#hiredDetailPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function loadClientOnboardingSubmission(item) {
    const target = $('#activeOnboardingResponse');
    if (!target) return;
    target.dataset.clientId = item.id;
    updateClientOnboardingStatus('Checking status', 'pending');
    target.innerHTML = '<p class="client-onboarding-loading">Loading onboarding details…</p>';
    try {
      const { data: submission, error } = await requireSupabase().rpc('get_client_onboarding_submission', {
        p_client_id: item.id
      });
      if (error) throw error;
      if (target.dataset.clientId !== item.id || hiredEditingId !== item.id) return;
      if (!submission) {
        clientTimeZones.delete(item.id);
        updateClientOnlineIndicators();
        updateClientOnboardingStatus('Not submitted', 'empty');
        target.innerHTML = '<div class="client-section-empty"><h4>No onboarding submission yet</h4><p>Use Actions → Send onboarding form to invite this client.</p></div>';
        return;
      }
      if (submission.timezone) clientTimeZones.set(item.id, submission.timezone);
      else clientTimeZones.delete(item.id);
      updateClientOnlineIndicators();
      const onboardingParts = [
        {
          title: 'Part 1: About you',
          details: [
            ['Client contact', submission.contact_name],
            ['Email', submission.client_email],
            ['Phone', submission.phone],
            ['Company or business name', submission.details?.companyName],
            ['Role or title', submission.details?.role]
          ]
        },
        {
          title: 'Part 2: Services and communication',
          details: [
            ['Services needed', Array.isArray(submission.details?.services) ? submission.details.services.join(', ') : ''],
            ['Expected hours per week', submission.details?.hoursPerWeek],
            ['Desired start date', submission.details?.startDate],
            ['Communication channel', submission.details?.preferredChannel],
            ['Expected response time', submission.details?.responseTime]
          ]
        },
        {
          title: 'Part 3: Schedule',
          details: [
            ['Time zone', submission.timezone],
            ['Availability and preferred working hours', submission.availability],
            ['Holidays or blackout dates', submission.details?.blackoutDates]
          ]
        },
        {
          title: 'Part 4: Tools and contacts',
          details: [
            ['Tools or platforms', submission.tools],
            ['First-week priorities', submission.priorities],
            ['Access sharing method', submission.details?.accessMethod],
            ['Backup contact name', submission.details?.backupName],
            ['Backup contact email', submission.details?.backupEmail],
            ['Backup contact phone', submission.details?.backupPhone],
            ['Approval preferences', submission.details?.approval],
            ['Confidentiality and terms agreement', submission.details?.agreement ? 'Agreed' : '']
          ]
        }
      ];
      target.replaceChildren();
      updateClientOnboardingStatus('Submitted', 'complete');
      const submittedAt = document.createElement('p');
      submittedAt.className = 'active-client-onboarding-submitted';
      submittedAt.textContent = `Submitted ${new Date(submission.submitted_at).toLocaleString()}`;
      const parts = document.createElement('div');
      parts.className = 'active-client-onboarding-parts';
      onboardingParts.forEach(part => {
        const section = document.createElement('section');
        section.className = 'active-client-onboarding-part';
        const heading = document.createElement('h4');
        heading.textContent = part.title;
        const list = document.createElement('dl');
        list.className = 'active-client-onboarding-details';
        part.details.forEach(([label, value]) => {
          const wrapper = document.createElement('div');
          const term = document.createElement('dt');
          const description = document.createElement('dd');
          term.textContent = label;
          description.textContent = value || 'Not provided';
          wrapper.append(term, description);
          list.append(wrapper);
        });
        section.append(heading, list);
        parts.append(section);
      });
      target.append(submittedAt, parts);
    } catch (error) {
      console.error('Could not load client onboarding response:', error);
      if (target.dataset.clientId === item.id && hiredEditingId === item.id) {
        updateClientOnboardingStatus('Unavailable', 'error');
        target.innerHTML = '<div class="client-section-empty"><h4>Onboarding could not be loaded</h4><p>Check your connection and try again.</p></div>';
      }
    }
  }

  function updateClientOnboardingStatus(label, state) {
    ['#clientOverviewOnboardingStatus', '#clientOnboardingStatus'].forEach(selector => {
      const status = $(selector);
      if (!status) return;
      status.className = `client-onboarding-status ${state}`;
      status.textContent = label;
    });
  }

  function selectClientDetailTab(tabName, focus = false) {
    const detailPanel = $('#hiredDetailPanel');
    if (!detailPanel) return;
    detailPanel.querySelectorAll('[data-client-detail-tab]').forEach(tab => {
      const isSelected = tab.dataset.clientDetailTab === tabName;
      tab.classList.toggle('active', isSelected);
      tab.setAttribute('aria-selected', String(isSelected));
      tab.tabIndex = isSelected ? 0 : -1;
      if (isSelected && focus) tab.focus();
    });
    detailPanel.querySelectorAll('[data-client-detail-panel]').forEach(panel => {
      panel.hidden = panel.dataset.clientDetailPanel !== tabName;
    });
    if (tabName === 'tasks') renderClientTasks(hiredEditingId);
  }

  function closeHiredDetail(render = true) {
    hiredEditingId = null;
    $('#hiredView').classList.remove('client-focused');
    $('#hiredDetailPanel').classList.add('hidden');
    $('#hiredDetailPanel').dataset.clientId = '';
    if (render) renderHired();
  }

  function updateWeekNavigationCounts() {
    const applicationRange = applicationDateSort && applicationDateSort !== 'all' ? weekRange(Number(applicationDateSort)) : null;
    const emailRange = emailDateSort === 'all' ? null : weekRange(Number(emailDateSort));
    const relevantReceivedEmails = receivedEmails();
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

  function renderCurrentView() {
    const viewName = typeof activeView !== 'undefined' ? activeView : (localStorage.getItem(ACTIVE_VIEW_KEY) || 'dashboard');
    switch (viewName) {
      case 'dashboard':
        renderClientDashboard();
        renderDashboard();
        break;
      case 'daily-task':
        renderDailyTasks();
        break;
      case 'applications':
        renderApplications();
        break;
      case 'to-apply':
        renderToApplyList();
        break;
      case 'hired':
        renderHired();
        break;
      case 'inbox':
        renderEmails();
        break;
      case 'documents':
        renderPersonalDocuments();
        renderScripts();
        renderWorkLinks();
        renderInvoiceList();
        break;
      case 'account':
        renderAccountPage();
        break;
    }
  }

  function renderAll() {
    // perf: keep match caches until the application snapshot changes, instead of blowing them away on every rerender.
    invalidateApplicationMatchCaches();
    processContractEndedAlerts();
    renderCurrentView();
    updateWeekNavigationCounts();
    $('#navToApplyCount').textContent = (data.toApply || []).filter(item => item.dueDate === today()).length;
    updateToApplyAttention();
    $('#navHiredCount').textContent = hiredClients().filter(isActiveContract).length;
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
    // perf: render the requested view on entry while renderAll skips inactive pages.
    renderCurrentView();
    if (view === 'account') {
      renderPasswordPage();
      renderAccountPage();
      refreshAccountStorageUsage();
    }
    const labels = { dashboard: [activeDashboardTab === 'client' ? 'CLIENT WORKSPACE' : 'YOUR PIPELINE', activeDashboardTab === 'client' ? 'Client Dashboard' : 'Application Dashboard'], 'daily-task': ['', 'Daily Tasks'], applications: ['', 'Applications'], 'to-apply': ['', 'To Apply'], hired: ['', 'Active Clients'], inbox: ['', 'Email'], documents: ['PRIVATE TOOLS', 'Tools'], account: ['', 'Account'] };
    $('#pageEyebrow').textContent = labels[view][0];
    $('#pageTitle').textContent = labels[view][1];
    $('#pageEyebrow').hidden = !labels[view][0];
    $('#pageTitle').hidden = false;
    $('#applicationWeekDate').hidden = view !== 'applications';
    $('#emailWeekDate').hidden = view !== 'inbox';
    $('#dailyTaskHeaderDate').hidden = view !== 'daily-task';
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

  function openClientModal(id = null, viewOnly = false, activeClientOnly = false, drawerEdit = false, activeClientDetailsEdit = false) {
    const form = $('#clientForm');
    form.reset();
    activeClientDetailsModalEdit = activeClientDetailsEdit;
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
    if (drawerEdit) {
      showActiveClientDrawerView('edit');
      $('#closeClientDetailsButton').textContent = 'Cancel';
      markActiveClientDrawerFormClean('edit');
    } else {
      $('#clientModal').showModal();
    }
    updateClientActionLabel();
    if (drawerEdit) $('#clientName').focus();
    else setTimeout(() => $('#clientName').focus(), 30);
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
      ? sentEmails.map(email => `<button type="button" class="client-email-history-item" data-email-detail="${escapeHtml(email.id)}" aria-label="Open email: ${escapeHtml(email.subject || 'No subject')}, sent ${escapeHtml(emailDate(email.date))}"><span class="client-email-history-copy"><strong title="${escapeHtml(email.subject || '(No subject)')}">${escapeHtml(email.subject || '(No subject)')}</strong><small>To ${escapeHtml(email.to || 'client')}</small><small class="client-email-history-preview">${escapeHtml(emailContentText(email.body).slice(0, 150) || 'No message preview')}</small></span><span class="client-email-history-meta"><span class="client-email-direction">Sent</span><time>${escapeHtml(emailDate(email.date))}</time></span></button>`).join('')
      : `<p>${emptyMessage}</p>`;
  }

  function renderHiredEmailHistory(item) {
    const sentEmails = sentEmailsForApplication(item);
    return `<section class="client-email-history hired-email-history" aria-live="polite">
      <div class="client-email-history-head"><div><p class="eyebrow">CLIENT COMMUNICATION</p><h3>Email History</h3><span>Sent to this client</span></div><strong>${plural(sentEmails.length, 'email')}</strong></div>
      <div class="client-email-history-list">${renderSentEmailHistoryItems(sentEmails, 'No emails have been sent to this client.')}</div>
    </section>`;
  }

  function updateClientActionLabel() {
    const button = $('#saveClientButton');
    if (!button) return;
    const activeClient = $('#clientStatus').value === 'Active client';
    const activeClientDrawerEdit = isActiveClientDrawerView('edit');
    button.textContent = activeClient && !activeClientDrawerEdit && !activeClientDetailsModalEdit ? 'Next' : (editingId ? 'Save changes' : 'Save application');
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
    $('#sendEmailMenuButton').hidden = viewingClientDetails || activeClientDrawerEdit;
    $('#sendClientEmailButton').hidden = false;
    $('#sendEmailMenu').classList.add('hidden');
    $('#sendEmailMenuButton').setAttribute('aria-expanded', 'false');
    $('#deleteClientButton').hidden = !editingId || viewingClientDetails || activeClientDrawerEdit;
    $('#closeClientDetailsButton').hidden = !viewingClientDetails && !activeClientDrawerEdit;
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
      if (existing) {
        application.documents = existing.documents;
        application.profileImage = existing.profileImage;
      }
      const index = data.applications.findIndex(item => item.id === editingId);
      if (index >= 0) data.applications[index] = application;
    } else {
      data.applications.push(application);
    }
    persist();
    if (!editingId) localStorage.removeItem(`${APPLICATION_DRAFT_KEY}:${currentUser?.id || 'anonymous'}`);
    if ($('#clientModal').open) $('#clientModal').close();
    if (savingInDrawer) closeActiveClientActionsDrawer(true);
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
    if (!(await appConfirm(`Delete ${item.clientName}? This removes the application, profile photo, and attached documents. This cannot be undone unless you've exported a backup.`, { title: 'Delete client application', confirmLabel: 'Delete', danger: true }))) return;
    data.applications = data.applications.filter(application => application.id !== id);
    persist();
    (item.documents || []).forEach(doc => { deleteDocumentBlob(doc.storagePath || doc.id).catch(() => {}); });
    if (item.profileImage?.storagePath) {
      deleteDocumentBlob(item.profileImage.storagePath).catch(error => console.error('Could not remove the deleted client profile photo:', error));
    }
    $('#clientModal')?.close();
    if (isActiveClientDrawerOpen()) closeActiveClientActionsDrawer(true);
    editingId = null;
    if (fromActive) closeHiredDetail(false);
    renderAll();
    showActionResult({ title: 'Client deleted', message: 'The client, profile photo, and attached documents were removed.' });
  }
