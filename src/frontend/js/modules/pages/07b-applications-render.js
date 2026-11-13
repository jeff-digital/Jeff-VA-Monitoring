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
    if (!date) return '';
    const days = Math.round((Date.parse(date) - Date.parse(followUpLocalDate(item) || today())) / 86400000);
    const pending = !['Active client', 'Not selected'].includes(item.status) && state !== 'sent';
    const relative = pending && Number.isFinite(days)
      ? days < 0 ? 'Overdue' : days === 0 ? 'Today' : `in ${plural(days, 'day')}`
      : emailDate(date);
    const tone = pending && days <= 0 ? 'due' : state;
    const description = state === 'sent' ? 'Follow-up sent successfully' : state === 'due' ? 'Due today' : 'Scheduled follow-up';
    return `<span class="application-follow-up${tone ? ` is-${tone}` : ''}" title="${escapeHtml(description + ' · ' + emailDate(date))}"><span>${escapeHtml(relative)}</span>${state === 'sent' ? '<span class="follow-up-check" aria-label="Sent successfully">✓</span>' : ''}</span>`;
  }

  let applicationPage = 0;
  let applicationFilterSignature = '';
  const applicationPageSize = 25;

  function renderApplications() {
    const query = $('#applicationSearch').value.trim().toLowerCase();
    const status = $('#statusFilter').value;
    const platform = $('#platformFilter').value;
    const employment = $('#applicationEmploymentFilter').value;
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
    const matchesStatus = (item, value) => !value || (value === 'To Proceed' ? isToProceedStatus(item) : item.status === value);
    const eligible = pipeline.filter(item => {
      const text = [item.clientName, item.contact, item.role, item.platform, item.nextStep, item.notes].join(' ').toLowerCase();
      const alwaysVisibleStatus = isToProceedStatus(item) || item.status === 'Interview' || item.status === 'Ongoing';
      const dateMatches = alwaysVisibleStatus || !dateFilter || dateKey(item.appliedDate) === dateFilter;
      const weekMatches = alwaysVisibleStatus || !applicationDateSort || applicationDateSort === 'all' || isInWeeklyRange(applicationAppliedDate(item), weekRangeFilter);
      return (!query || text.includes(query)) && (!platform || item.platform === platform)
        && (!employment || item.employmentType === employment) && dateMatches && weekMatches;
    });
    const filtered = eligible.filter(item => matchesStatus(item, status));
    $('#applicationListLabel').textContent = String(filtered.length);
    $('#applicationListLabel').setAttribute('aria-label', `${filtered.length} of ${pipeline.length} applications`);
    const chips = [['', 'All'], ['Applied', 'Applied'], ['Interview', 'Interview'], ['Offer', 'Offer'], ['Not selected', 'Rejected']];
    const chipGroup = $('#applicationStatusChips');
    if (!chipGroup.children.length) chipGroup.innerHTML = chips.map(([value, label]) =>
      `<button type="button" data-application-status-chip="${value}">${label} <span></span></button>`).join('');
    for (const chip of chipGroup.children) {
      chip.setAttribute('aria-pressed', String(chip.dataset.applicationStatusChip === status));
      chip.firstElementChild.textContent = eligible.filter(item => matchesStatus(item, chip.dataset.applicationStatusChip)).length;
    }
    $('#applicationsView').dispatchEvent(new Event('application-controls-refresh'));
    const signature = JSON.stringify([query, status, platform, employment, dateFilter, applicationDateSort, $('#applicationOrderSort').value, applicationViewMode]);
    if (signature !== applicationFilterSignature) applicationPage = 0;
    applicationFilterSignature = signature;
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
      employment ? ['employment', `Employment: ${employment}`] : null,
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
      target.innerHTML = `<div class="application-empty"><h3>${isFiltered ? 'No matching applications' : 'No applications yet'}</h3>${isFiltered ? '<button class="button button-secondary" type="button" data-clear-application-filters>Clear filters</button>' : '<button class="button button-primary" type="button" data-open-add>Add application</button>'}</div>`;
      return;
    }
    const sortedApplications = sortApplicationList(filtered, $('#applicationOrderSort').value);
    if (applicationViewMode === 'board') {
      const stages = ['To Proceed', 'Ongoing', 'Applied', 'Interview', ...(sortedApplications.some(item => item.status === 'Offer') ? ['Offer'] : []), 'Active client', 'Not selected'];
      target.innerHTML = `<div class="application-board">${stages.map(stage => {
        const cards = sortedApplications.filter(item => stage === 'To Proceed' ? isToProceedStatus(item) : item.status === stage);
        return `<section class="application-board-column" data-application-drop-status="${escapeHtml(stage)}"><header><h3>${escapeHtml(stage === 'Not selected' ? 'Rejected' : stage)}</h3><span>${cards.length}</span></header><div class="application-board-cards">${cards.map(item => `<article class="application-board-card" draggable="${stage !== 'Active client'}" data-application-card="${escapeHtml(item.id)}">${applicationSelectionMode ? `<input type="checkbox" data-application-select="${escapeHtml(item.id)}" aria-label="Select ${escapeHtml(item.clientName)}"${selectedApplicationIds.has(item.id) ? ' checked' : ''} />` : ''}<button type="button" class="application-board-card-open" data-view-details="${escapeHtml(item.id)}"><strong>${escapeHtml(item.clientName)}</strong><span>${escapeHtml(item.role || item.contact || 'Role not set')}</span><small>${escapeHtml(item.platform || 'Source not set')} · ${escapeHtml(emailDate(item.appliedDate))}</small></button>${statusPill(item.status)}<button class="icon-button" type="button" data-edit-id="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.clientName)}">⋯</button></article>`).join('') || '<p class="application-board-empty">No applications</p>'}</div></section>`;
      }).join('')}</div>`;
      return;
    }
    const pageCount = Math.ceil(sortedApplications.length / applicationPageSize);
    applicationPage = Math.min(applicationPage, pageCount - 1);
    const offset = applicationPage * applicationPageSize;
    const displayValue = value => /^(?:n\/?a|—|-)$/i.test(String(value || '').trim()) ? '' : String(value || '').trim();
    target.innerHTML = `<div class="application-table-wrap"><table class="application-data-table" aria-label="Applications"><thead><tr>${applicationSelectionMode ? '<th scope="col"><span class="sr-only">Select</span></th>' : ''}<th scope="col">Client / role</th><th scope="col">Platform</th><th scope="col">Employment type</th><th scope="col">Status</th><th scope="col">Date applied</th><th scope="col">Follow-up</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${sortedApplications.slice(offset, offset + applicationPageSize).map(item => {
      const salaryAmount = Number(item.salaryAmount);
      const salary = Number.isFinite(salaryAmount) && salaryAmount > 0 && ['monthly', 'hourly'].includes(item.salaryType)
        ? `<small>${escapeHtml(salaryCurrencySymbol(item.salaryCurrency) + Math.round(salaryAmount).toLocaleString())} / ${item.salaryType === 'hourly' ? 'hour' : 'month'}</small>` : '';
      const name = displayValue(item.clientName) || 'Unnamed application';
      const role = displayValue(item.role) || displayValue(item.contact);
      const id = escapeHtml(item.id);
      return `<tr data-view-details="${id}">${applicationSelectionMode ? `<td><input type="checkbox" data-application-select="${id}" aria-label="Select ${escapeHtml(name)}"${selectedApplicationIds.has(item.id) ? ' checked' : ''} /></td>` : ''}
        <td class="application-client-cell"><button type="button" class="application-client-open" data-view-details="${id}" aria-label="View details for ${escapeHtml(name)}"><span class="application-client-avatar" aria-hidden="true">${escapeHtml(clientInitials(name))}</span><span class="application-client-copy"><strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong>${role ? `<small title="${escapeHtml(role)}">${escapeHtml(role)}</small>` : ''}</span></button></td>
        <td class="application-table-muted">${escapeHtml(displayValue(item.platform))}</td><td class="application-table-muted">${escapeHtml(displayValue(item.employmentType))}${salary}</td>
        <td><span class="application-stage-email-count">${statusPill(item.status)}${matchBadge(item)}</span></td>
        <td class="application-table-muted">${item.appliedDate ? escapeHtml(emailDate(item.appliedDate)) : ''}</td><td>${applicationFollowUpMarkup(item)}</td>
        <td><button class="icon-button application-actions-trigger" type="button" aria-label="More actions for ${escapeHtml(name)}" aria-haspopup="dialog" data-open-application-actions="${id}">⋯</button></td></tr>`;
    }).join('')}</tbody></table></div>${pageCount > 1 ? `<nav class="application-pagination" aria-label="Applications pages"><span aria-live="polite">${offset + 1}–${Math.min(offset + applicationPageSize, sortedApplications.length)} of ${sortedApplications.length}</span><button type="button" data-application-page="-1"${applicationPage === 0 ? ' disabled' : ''}>Previous</button><button type="button" data-application-page="1"${applicationPage === pageCount - 1 ? ' disabled' : ''}>Next</button></nav>` : ''}`;
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

