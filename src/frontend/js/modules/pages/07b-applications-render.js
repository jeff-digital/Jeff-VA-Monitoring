  function applicationWeekOptions() {
    const currentRange = weekRange();
    const applicationDates = pipelineApplications().map(applicationAppliedDate).map(dateKey).filter(Boolean);
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

  function sortApplicationList(items, order = 'newest') {
    const timestamp = value => {
      const result = new Date(value || 0).getTime();
      return Number.isFinite(result) ? result : 0;
    };
    const direction = order === 'oldest' ? 1 : -1;
    return [...items].sort((first, second) => direction * (
      timestamp(applicationAppliedDate(first)) - timestamp(applicationAppliedDate(second))
      || timestamp(first.createdAt) - timestamp(second.createdAt)
    ));
  }

  function confirmedApplicationFollowUpSentAt(item) {
    const scheduledDate = dateKey(item.followUpDate);
    const recipient = extractEmailAddress(item.email || '');
    const sameRecipient = recipient ? data.applications.filter(app => extractEmailAddress(app.email || '') === recipient) : [];
    const expectedSubject = `follow-up: ${String(item.clientName || '').trim()}`.toLowerCase();
    const newSubject = ('Follow-up application: ' + (String(item.role || '').trim() || 'position') + (String(item.platform || '').trim() ? ' — ' + item.platform.trim() : '')).toLowerCase();
    const uniqueRolePlatform = sameRecipient.filter(app => String(app.role || '').trim().toLowerCase() === String(item.role || '').trim().toLowerCase()
      && String(app.platform || '').trim().toLowerCase() === String(item.platform || '').trim().toLowerCase()).length === 1;
    const sentDates = [item.followUpSentAt, ...data.emails.filter(email => {
      if (!isSentEmail(email)) return false;
      const subject = String(email.subject || '').trim().replace(/^(?:(?:re|fw|fwd):\s*)+/i, '');
      const roleOnlyFollowUp = [String(item.role || '').trim() || 'position', 'Application for ' + (String(item.role || '').trim() || 'position')].some(value => value.toLowerCase() === subject.toLowerCase())
        && /I wanted to follow up on my application/i.test(email.body || '');
      if (email.emailType !== 'follow-up' && !/^follow(?:ing)?[\s-]*up\b/i.test(subject) && !roleOnlyFollowUp) return false;
      if (email.applicationId) return email.applicationId === item.id;
      if (!recipient || extractEmailAddress(email.to || '') !== recipient) return false;
      // Shared recruiter addresses need a company-specific subject; a generic
      // follow-up to that address must not complete every application.
      return (sameRecipient.length === 1 && sameRecipient[0].id === item.id)
        || (String(item.clientName || '').trim() && subject.toLowerCase() === expectedSubject)
        || (uniqueRolePlatform && subject.toLowerCase() === newSubject)
        || (roleOnlyFollowUp && sameRecipient.filter(app => String(app.role || '').trim().toLowerCase() === String(item.role || '').trim().toLowerCase()).length === 1);
    }).map(email => email.date)].filter(value => {
      if (!Number.isFinite(new Date(value).getTime())) return false;
      const date = followUpLocalDate(item, new Date(value)) || dateKey(value);
      return date && (!scheduledDate || date >= scheduledDate)
        && (!item.appliedDate || date >= dateKey(item.appliedDate))
        && Number.isFinite(new Date(value).getTime());
    });
    return sentDates.sort((a, b) => new Date(b) - new Date(a))[0] || '';
  }

  function applicationFollowUpState(item) {
    const scheduledDate = dateKey(item.followUpDate);
    if (confirmedApplicationFollowUpSentAt(item)) return 'sent';
    if (scheduledDate === (followUpLocalDate(item) || today()) && !['Active client', 'Not selected'].includes(item.status)) return 'due';
    return '';
  }

  function applicationFollowUpMarkup(item) {
    const state = applicationFollowUpState(item);
    const date = state === 'sent' ? dateKey(confirmedApplicationFollowUpSentAt(item)) : dateKey(item.followUpDate);
    if (!date) return '—';
    const label = state === 'sent' ? 'Follow-up sent successfully' : state === 'due' ? 'Follow-up due today — not sent yet' : 'Scheduled follow-up';
    return `<span class="application-follow-up${state ? ` is-${state}` : ''}" title="${escapeHtml(label)}"><span>${escapeHtml(emailDate(date))}</span>${state === 'sent' ? '<span class="follow-up-check" aria-label="Sent successfully">✓</span>' : state === 'due' ? '<span class="follow-up-due-label">Due today</span>' : ''}</span>`;
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
        : true;
      const alwaysVisibleStatus = isToProceedStatus(item) || item.status === 'Interview' || item.status === 'Ongoing';
      const dateMatches = alwaysVisibleStatus || !dateFilter || dateKey(item.appliedDate) === dateFilter;
      const weekMatches = alwaysVisibleStatus || !applicationDateSort || applicationDateSort === 'all' || isInWeeklyRange(applicationAppliedDate(item), weekRangeFilter);
      return (!query || text.includes(query)) && statusMatches && (!platform || item.platform === platform) && dateMatches && weekMatches;
    });
    $('#applicationListLabel').textContent = `${plural(filtered.length, 'application')}${filtered.length !== pipeline.length ? ` of ${pipeline.length}` : ''}`;
    const platformCounts = new Map();
    filtered.forEach(item => {
      const name = String(item.platform || 'Unspecified').trim() || 'Unspecified';
      platformCounts.set(name, (platformCounts.get(name) || 0) + 1);
    });
    const sourceBreakdown = [...platformCounts]
      .sort(([first], [second]) => first.localeCompare(second, undefined, { sensitivity: 'base' }))
      .map(([name, count]) => `<span class="application-source-row"><span>${escapeHtml(name)}</span><strong>${count}</strong></span>`)
      .join('');
    $('#applicationPlatformCounts').innerHTML = `<span class="application-source-heading"><span>Applications by source</span><strong>${filtered.length}</strong></span><span class="application-source-caption">Current filtered results</span><span class="application-source-list">${sourceBreakdown || '<span class="application-source-empty">No applications in this view</span>'}</span>`;
    const target = $('#applicationList');
    const filterChips = [
      query ? ['search', `Search: ${query}`] : null,
      dateFilter ? ['date', `Date: ${emailDate(dateFilter)}`] : null,
      status && status !== 'Applied' ? ['status', `Stage: ${status === 'Not selected' ? 'Rejected' : status}`] : null,
      platform ? ['platform', `Source: ${platform}`] : null,
      applicationDateSort && applicationDateSort !== '0' && applicationDateSort !== 'all' ? ['week', `Week: ${$('#applicationWeekDate').textContent}`] : null
    ].filter(Boolean);
    $('#applicationFilterChips').innerHTML = filterChips.map(([key, label]) => `<button class="filter-chip" type="button" data-remove-application-filter="${key}">${escapeHtml(label)} <span aria-hidden="true">×</span><span class="sr-only">Remove filter</span></button>`).join('');
    $('#clearApplicationFilters').hidden = filterChips.length === 0 && applicationDateSort !== '0' && status !== 'Applied';
    $$('[data-application-view]').forEach(button => {
      const selected = button.dataset.applicationView === applicationViewMode;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const selectionToggle = $('#toggleApplicationSelection');
    selectionToggle.classList.toggle('active', applicationSelectionMode);
    selectionToggle.setAttribute('aria-pressed', String(applicationSelectionMode));
    selectionToggle.textContent = applicationSelectionMode ? 'Done' : 'Select';
    target.classList.toggle('application-board-mode', applicationViewMode === 'board');
    target.classList.toggle('selection-mode', applicationSelectionMode);
    selectedApplicationIds.forEach(id => {
      if (!filtered.some(item => item.id === id)) selectedApplicationIds.delete(id);
    });
    $('#applicationBulkActions').hidden = !applicationSelectionMode || selectedApplicationIds.size === 0;
    $('#applicationSelectionCount').textContent = `${selectedApplicationIds.size} selected`;
    if (!filtered.length) {
      const isFiltered = pipeline.length > 0;
      target.innerHTML = `<div class="application-empty"><h3>${isFiltered ? 'No matching applications' : 'Start your client pipeline'}</h3><p>${isFiltered ? 'Try a different search or filter.' : 'Track each application, where you applied, and the next step all in one private workspace.'}</p>${isFiltered ? '' : '<button class="button button-primary" type="button" data-open-add>Add your first client</button>'}</div>`;
      return;
    }
    const sortedApplications = sortApplicationList(filtered, $('#applicationOrderSort').value);
    if (applicationViewMode === 'board') {
      const stages = ['To Proceed', 'Ongoing', 'Applied', 'Interview', 'Active client', 'Not selected'];
      target.innerHTML = `<div class="application-board">${stages.map(stage => {
        const cards = sortedApplications.filter(item => stage === 'To Proceed' ? isToProceedStatus(item) : item.status === stage);
        return `<section class="application-board-column" data-application-drop-status="${escapeHtml(stage)}"><header><h3>${escapeHtml(stage === 'Not selected' ? 'Rejected' : stage)}</h3><span>${cards.length}</span></header><div class="application-board-cards">${cards.map(item => `<article class="application-board-card" draggable="${stage !== 'Active client'}" data-application-card="${escapeHtml(item.id)}">${applicationSelectionMode ? `<input type="checkbox" data-application-select="${escapeHtml(item.id)}" aria-label="Select ${escapeHtml(item.clientName)}"${selectedApplicationIds.has(item.id) ? ' checked' : ''} />` : ''}<button type="button" class="application-board-card-open" data-view-details="${escapeHtml(item.id)}"><strong>${escapeHtml(item.clientName)}</strong><span>${escapeHtml(item.role || item.contact || 'Role not set')}</span><small>${escapeHtml(item.platform || 'Source not set')} · ${escapeHtml(emailDate(item.appliedDate))}</small></button>${statusPill(item.status)}<button class="icon-button" type="button" data-edit-id="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.clientName)}">⋯</button></article>`).join('') || '<p class="application-board-empty">No applications</p>'}</div></section>`;
      }).join('')}</div>`;
      return;
    }
    const salaryAmountWidth = Math.max(5, ...sortedApplications.map(item => {
      const value = Number(item.salaryAmount);
      return Number.isFinite(value) && value > 0 ? Math.round(value).toLocaleString().length + 1 : 0;
    }));
    target.innerHTML = `<div class="application-table-wrap"><table class="application-data-table" style="--salary-amount-width: ${salaryAmountWidth}ch"><thead><tr>${applicationSelectionMode ? '<th scope="col"><span class="sr-only">Select</span></th>' : ''}<th scope="col">Client / role</th><th scope="col">Source</th><th scope="col">Stage</th><th scope="col">Salary</th><th scope="col">Applied</th><th scope="col">Follow-up</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${sortedApplications.map(item => {
      const salaryAmount = Number(item.salaryAmount);
      const salary = Number.isFinite(salaryAmount) && salaryAmount > 0 && ['monthly', 'hourly'].includes(item.salaryType)
        ? `<span class="application-salary-value"><span class="application-salary-amount"><span class="application-salary-currency">${escapeHtml(salaryCurrencySymbol(item.salaryCurrency))}</span><span class="application-salary-number">${escapeHtml(Math.round(salaryAmount).toLocaleString())}</span></span><span class="application-salary-period">/ ${item.salaryType === 'hourly' ? 'hour' : 'month'}</span></span>`
        : '—';
      return `<tr class="${applicationFollowUpState(item) === 'due' ? 'application-follow-up-due' : ''}" data-view-details="${escapeHtml(item.id)}">${applicationSelectionMode ? `<td><input type="checkbox" data-application-select="${escapeHtml(item.id)}" aria-label="Select ${escapeHtml(item.clientName)}"${selectedApplicationIds.has(item.id) ? ' checked' : ''} /></td>` : ''}<td><strong>${escapeHtml(item.clientName)}</strong><small>${escapeHtml(item.role || item.contact || 'Role not set')}</small></td><td>${escapeHtml(item.platform || 'Not specified')}</td><td><span class="application-stage-email-count">${statusPill(item.status)}${matchBadge(item)}</span></td><td class="application-salary-cell">${salary}</td><td>${escapeHtml(emailDate(item.appliedDate))}</td><td>${applicationFollowUpMarkup(item)}</td><td><button class="icon-button application-actions-trigger" type="button" aria-label="More actions for ${escapeHtml(item.clientName)}" aria-haspopup="dialog" data-open-application-actions="${escapeHtml(item.id)}">⋯</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
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

