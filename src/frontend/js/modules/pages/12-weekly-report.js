  // Weekly reporting is isolated from the dashboard so reporting changes cannot affect client, email, or billing flows.
  const WEEKLY_REPORT_SEEN_KEY = 'jeff-va-weekly-report-seen-v1';
  let weeklyReportOffset = 0;
  let weeklyReportActivityFilter = 'all';
  let weeklyReportScrollFrame = 0;

  function weekRange(offset = 0) {
    const end = new Date();
    end.setHours(12, 0, 0, 0);
    const start = new Date(end);
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
    start.setDate(start.getDate() + offset * 7);
    if (offset !== 0) {
      end.setTime(start.getTime());
      end.setDate(end.getDate() + 6);
    }
    return { start: localDateKey(start), end: localDateKey(end) };
  }

  function weeklyRangeLabel(range) {
    const start = new Date(`${range.start}T12:00:00`);
    const end = new Date(`${range.end}T12:00:00`);
    const format = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    return `${format.format(start)} – ${format.format(end)}, ${end.getFullYear()}`;
  }

  function weeklyHistoryOffsets() {
    const currentRange = weekRange();
    const activityDates = [
      ...data.applications.map(item => item.appliedDate),
      ...data.applications.filter(item => item.status === 'Active client').map(item => item.activeAt),
      ...data.applications.map(item => item.interviewDate),
      ...data.applications.map(item => item.followUpDate),
      ...(data.invoices || []).map(item => item.sentAt),
      ...data.emails.map(item => item.date)
    ].map(dateKey).filter(date => date && date < currentRange.start);
    const offsets = activityDates.map(date => {
      const activityDate = new Date(`${date}T12:00:00`);
      const daysSinceMonday = (activityDate.getDay() + 6) % 7;
      activityDate.setDate(activityDate.getDate() - daysSinceMonday);
      return Math.round((activityDate - new Date(`${currentRange.start}T12:00:00`)) / 86400000 / 7);
    }).filter(offset => offset < 0);
    const oldestOffset = offsets.length ? Math.min(...offsets) : 0;
    return Array.from({ length: Math.abs(oldestOffset) }, (_, index) => -(index + 1));
  }

  function weeklyHistoryOptions() {
    const options = weeklyHistoryOffsets().map(offset => {
      const range = weekRange(offset);
      return `<option value="${offset}">${escapeHtml(weeklyRangeLabel(range).replace(' – ', ' to '))}</option>`;
    }).join('');
    return `<option value="0">This week · ${escapeHtml(weeklyRangeLabel(weekRange()))}</option>${options}`;
  }

  function isInWeeklyRange(value, range) {
    const date = dateKey(value);
    return Boolean(date && date >= range.start && date <= range.end);
  }

  function weeklyEmailType(email) {
    const subject = String(email.subject || '');
    if (/^invoice\b/i.test(subject)) return 'Invoice';
    if (/^follow-up:/i.test(subject)) return 'Follow-up';
    if (/updated (contract|document)/i.test(subject)) return 'Updated contract';
    if (/contract/i.test(subject)) return 'Contract';
    return 'Other';
  }

  function weeklyReportData(offset = weeklyReportOffset) {
    const range = weekRange(offset);
    const applications = data.applications.filter(item => isInWeeklyRange(item.appliedDate, range));
    const invoices = (data.invoices || []).filter(item => isInWeeklyRange(item.sentAt, range));
    const clients = data.applications.filter(item => item.status === 'Active client' && isInWeeklyRange(item.activeAt, range));
    const emails = data.emails.filter(item => item.direction === 'sent' && isInWeeklyRange(item.date, range));
    const applicationEmails = emails.filter(email => {
      const type = weeklyEmailType(email);
      return !['Invoice', 'Follow-up', 'Contract', 'Updated contract'].includes(type)
        && matchApplicationsForEmail(email).length > 0;
    });
    const replies = data.emails.filter(email => email.direction !== 'sent'
      && email.source !== 'sent'
      && isInWeeklyRange(email.date, range)
      && matchApplicationsForEmail(email).length > 0);
    const interviews = data.applications.filter(item => isInWeeklyRange(item.interviewDate, range));
    const followUps = data.applications.filter(item => item.followUpDate
      && isInWeeklyRange(item.followUpDate, range)
      && item.status !== 'Active client'
      && item.status !== 'Not selected');
    const applicationsWithSentEmails = new Set(applicationEmails.flatMap(email => matchApplicationsForEmail(email).map(item => item.id)));
    const applicationsWithReplies = new Set(replies.flatMap(email => matchApplicationsForEmail(email).map(item => item.id)));
    const repliedApplicationCount = [...applicationsWithReplies].filter(id => applicationsWithSentEmails.has(id)).length;
    const responseRate = applicationsWithSentEmails.size
      ? Math.round((repliedApplicationCount / applicationsWithSentEmails.size) * 100)
      : null;
    const emailTypes = emails.reduce((counts, email) => {
      const type = weeklyEmailType(email);
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, {});
    const platformCounts = applications.reduce((counts, item) => {
      const platform = item.platform || 'Not specified';
      counts[platform] ||= { count: 0, replied: 0 };
      counts[platform].count += 1;
      if (applicationsWithReplies.has(item.id)) counts[platform].replied += 1;
      return counts;
    }, {});
    const topPlatform = Object.entries(platformCounts).sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))[0] || ['No applications', { count: 0, replied: 0 }];
    const sources = Object.entries(platformCounts)
      .map(([platform, counts]) => ({ platform, ...counts, replyRate: counts.count ? Math.round((counts.replied / counts.count) * 100) : null }))
      .sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform));
    const outcomeCounts = applications.reduce((counts, item) => {
      const status = item.status || 'Unknown';
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, {});
    const outcomes = Object.entries(outcomeCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const matchedApplication = email => matchApplicationsForEmail(email)[0] || null;
    const activities = [
      ...applications.map(item => ({ date: item.appliedDate, type: 'Application', company: item.clientName || 'Untitled application', platform: item.platform || '', status: item.status || '', details: item.role || '' })),
      ...clients.map(item => ({ date: item.activeAt, type: 'Client', company: item.clientName || 'Unnamed client', platform: item.platform || '', status: item.status || 'Active client', details: 'Client activated' })),
      ...invoices.map(item => ({ date: item.sentAt, type: 'Invoice', company: item.clientName || item.companyName || 'Client', platform: '', status: 'Sent', details: item.invoiceNumber || item.fileName || 'Invoice sent' })),
      ...emails.map(email => {
        const application = matchedApplication(email);
        return { date: email.date, type: 'Email', company: application?.clientName || '', platform: application?.platform || '', status: application?.status || 'Sent', details: email.subject || `${weeklyEmailType(email)} email sent` };
      }),
      ...replies.map(email => {
        const application = matchedApplication(email);
        return { date: email.date, type: 'Reply', company: application?.clientName || '', platform: application?.platform || '', status: application?.status || 'Replied', details: email.subject || 'Incoming application email' };
      }),
      ...interviews.map(item => ({ date: item.interviewDate, type: 'Interview', company: item.clientName || 'Unnamed application', platform: item.platform || '', status: item.status || '', details: item.role || '' })),
      ...followUps.map(item => ({ date: item.followUpDate, type: 'Follow-up', company: item.clientName || 'Unnamed application', platform: item.platform || '', status: item.followUpSentAt ? 'Sent' : 'Due', details: item.role || '' }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));
    const offers = applications.filter(item => item.status === 'Offer');
    const notes = applications.filter(item => String(item.notes || '').trim());
    return {
      range, applications, invoices, clients, emails, applicationEmails, replies, interviews, followUps,
      responseRate, emailTypes, topPlatform, sources, outcomes, offers, notes, activities
    };
  }

  function weeklyReportStatus(report, offset = weeklyReportOffset) {
    if (offset < 0) return 'Viewing past week';
    return new Date(`${report.range.end}T12:00:00`).getDay() === 0 ? 'Final' : 'In progress';
  }

  function weeklyEmptyRow(message, columns) {
    return `<tr><td class="weekly-report-empty-cell" colspan="${columns}">${escapeHtml(message)}</td></tr>`;
  }

  function weeklyStatusBadge(status) {
    return status ? statusPill(status) : '<span class="weekly-report-muted">—</span>';
  }

  function weeklyChange(current, previous) {
    if (current == null || previous == null) return '<span class="weekly-report-change neutral">No baseline</span>';
    if (previous === 0) return current === 0
      ? '<span class="weekly-report-change neutral">No change</span>'
      : '<span class="weekly-report-change positive" title="No activity in the previous week">↑ New</span>';
    const change = Math.round(((current - previous) / previous) * 100);
    if (!change) return '<span class="weekly-report-change neutral">No change</span>';
    const direction = change > 0 ? 'positive' : 'negative';
    return `<span class="weekly-report-change ${direction}">${change > 0 ? '↑' : '↓'} ${Math.abs(change)}% vs last week</span>`;
  }

  function weeklyStatCard(label, value, previous, title = '', trendValue = typeof value === 'number' ? value : null) {
    return `<article class="weekly-report-stat-card"${title ? ` title="${escapeHtml(title)}"` : ''}><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong>${weeklyChange(trendValue, previous)}</article>`;
  }

  function renderWeeklyReportActivities(report) {
    const activities = weeklyReportActivityFilter === 'all'
      ? report.activities
      : report.activities.filter(activity => activity.type === weeklyReportActivityFilter
        || (weeklyReportActivityFilter === 'Email' && activity.type === 'Reply'));
    $('#weeklyReportActivityCount').textContent = plural(activities.length, 'activity');
    $('#weeklyReportActivities').innerHTML = activities.length
      ? activities.map(activity => `<tr><td>${escapeHtml(formatDate(dateKey(activity.date)))}</td><td>${escapeHtml(activity.type)}</td><td>${escapeHtml(activity.company || '—')}</td><td>${escapeHtml(activity.platform || '—')}</td><td>${weeklyStatusBadge(activity.status)}</td></tr>`).join('')
      : weeklyEmptyRow(weeklyReportActivityFilter === 'all' ? 'No applications or tracked activity this week yet.' : `No ${weeklyReportActivityFilter.toLowerCase()} activity this week.`, 5);
  }

  function renderWeeklyReportDetails(report) {
    $('#weeklyReportApplicationCount').textContent = plural(report.applications.length, 'application');
    $('#weeklyReportApplicationRows').innerHTML = report.applications.length
      ? report.applications.map(item => `<tr><td>${escapeHtml(formatDate(dateKey(item.appliedDate)))}</td><td>${escapeHtml(item.clientName || 'Untitled application')}</td><td>${escapeHtml(item.platform || '—')}</td><td>${weeklyStatusBadge(item.status)}</td></tr>`).join('')
      : weeklyEmptyRow('No applications this week yet. Add an application to start building your report.', 4);
    $('#weeklyReportReplyTotal').textContent = plural(report.replies.length, 'reply');
    $('#weeklyReportEmailRows').innerHTML = [...report.emails.map(email => ({ email, type: 'Sent' })), ...report.replies.map(email => ({ email, type: 'Reply' }))]
      .sort((a, b) => new Date(b.email.date) - new Date(a.email.date))
      .map(({ email, type }) => {
        const application = matchApplicationsForEmail(email)[0];
        return `<tr><td>${escapeHtml(formatDate(dateKey(email.date)))}</td><td>${escapeHtml(type)}</td><td>${escapeHtml(application?.clientName || '—')}</td><td>${escapeHtml(email.subject || '(No subject)')}</td></tr>`;
      }).join('') || weeklyEmptyRow('No application emails or replies this week.', 4);
    $('#weeklyReportInterviewRows').innerHTML = report.interviews.length
      ? report.interviews.map(item => `<tr><td>${escapeHtml(formatDate(dateKey(item.interviewDate)))}</td><td>${escapeHtml(item.clientName || 'Unnamed application')}</td><td>${escapeHtml(item.role || '—')}</td><td>${weeklyStatusBadge(item.status)}</td></tr>`).join('')
      : weeklyEmptyRow('No interviews scheduled this week.', 4);
    $('#weeklyReportFollowUpRows').innerHTML = report.followUps.length
      ? report.followUps.map(item => `<tr><td>${escapeHtml(formatDate(dateKey(item.followUpDate)))}</td><td>${escapeHtml(item.clientName || 'Unnamed application')}</td><td>${weeklyStatusBadge(item.followUpSentAt ? 'Sent' : 'Due')}</td></tr>`).join('')
      : weeklyEmptyRow('No follow-ups due this week.', 3);
    $('#weeklyReportSourceRows').innerHTML = report.sources.length
      ? report.sources.map(source => `<tr><td>${escapeHtml(source.platform)}</td><td class="numeric">${source.count}</td><td class="numeric">${source.replied}</td><td class="numeric">${source.replyRate == null ? '—' : `${source.replyRate}%`}</td></tr>`).join('')
      : weeklyEmptyRow('No application sources to compare yet.', 4);
    $('#weeklyReportNotesList').innerHTML = report.notes.length
      ? report.notes.map(item => `<article class="weekly-report-note"><div><strong>${escapeHtml(item.clientName || 'Untitled application')}</strong><span>${escapeHtml(item.platform || 'Platform not specified')}</span></div><p>${escapeHtml(item.notes)}</p></article>`).join('')
      : '<p class="weekly-report-empty">No notes on this week’s applications.</p>';
    $('#weeklyReportOutcomeCount').textContent = plural(report.applications.length, 'application');
    $('#weeklyReportOutcomes').innerHTML = report.outcomes.length
      ? report.outcomes.map(([status, count]) => `<tr><td>${weeklyStatusBadge(status)}</td><td class="numeric">${count}</td></tr>`).join('')
      : weeklyEmptyRow('No applications this week yet.', 2);
  }

  function renderWeeklyReport() {
    const report = weeklyReportData();
    const previousReport = weeklyReportData(weeklyReportOffset - 1);
    $('#weeklyReportDate').textContent = weeklyRangeLabel(report.range);
    $('#weeklyReportStatus').textContent = weeklyReportStatus(report);
    $('#weeklyReportStatus').className = `weekly-report-status ${weeklyReportOffset < 0 ? 'past' : weeklyReportStatus(report) === 'Final' ? 'final' : 'in-progress'}`;
    $('#showCurrentWeeklyReport').disabled = weeklyReportOffset === 0;
    $('#nextWeeklyReport').disabled = weeklyReportOffset === 0;
    $('#weeklyReportHistory').innerHTML = weeklyHistoryOptions();
    $('#weeklyReportHistory').value = String(weeklyReportOffset);
    const metricCards = [
      weeklyStatCard('Applications', report.applications.length, previousReport.applications.length),
      weeklyStatCard('Application emails', report.applicationEmails.length, previousReport.applicationEmails.length),
      weeklyStatCard('Replies', report.replies.length, previousReport.replies.length),
      weeklyStatCard('Interviews', report.interviews.length, previousReport.interviews.length),
      weeklyStatCard('Offers', report.offers.length, previousReport.offers.length, 'Applications submitted this week currently marked as Offer.'),
      weeklyStatCard('Response rate', report.responseRate == null ? '—' : `${report.responseRate}%`, previousReport.responseRate, 'Applications with an incoming reply divided by applications with a matched sent application email.', report.responseRate)
    ].join('');
    $('#weeklyReportMetrics').innerHTML = metricCards;
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dailyCounts = weekdays.map((day, index) => {
      const date = new Date(`${report.range.start}T12:00:00`);
      date.setDate(date.getDate() + index);
      const key = localDateKey(date);
      const count = report.activities.filter(activity => dateKey(activity.date) === key).length;
      return { day, key, count };
    });
    const dailyMax = Math.max(1, ...dailyCounts.map(item => item.count));
    $('#weeklyReportDailyChart').innerHTML = dailyCounts.map(item => `<div class="weekly-report-day" title="${escapeHtml(formatDate(item.key))}: ${plural(item.count, 'activity')}" aria-label="${escapeHtml(formatDate(item.key))}: ${plural(item.count, 'activity')}"><div class="weekly-report-day-track"><i style="height:${Math.max(item.count ? 8 : 0, (item.count / dailyMax) * 100)}%"></i></div><strong>${item.count}</strong><span>${item.day}</span></div>`).join('');
    $('#weeklyReportGoals').innerHTML = '<p class="weekly-report-empty">Weekly goal tracking is not configured yet.</p>';
    const outcomeMax = Math.max(1, ...report.outcomes.map(([, count]) => count));
    $('#weeklyReportChart').innerHTML = report.outcomes.length
      ? report.outcomes.map(([status, count]) => `<div class="weekly-report-stage"><div><span>${weeklyStatusBadge(status)}</span><strong>${count}</strong></div><i style="width:${(count / outcomeMax) * 100}%;--stage-color:${escapeHtml(STATUS_COLORS[status] || '#69717d')}"></i></div>`).join('')
      : '<p class="weekly-report-empty">No applications this week yet.</p>';
    $('#weeklyReportSourceEffectiveness').innerHTML = report.sources.length
      ? report.sources.slice(0, 6).map(source => `<div class="weekly-report-source"><span title="${escapeHtml(source.platform)}">${escapeHtml(source.platform)}</span><i><b style="width:${Math.max(4, (source.count / Math.max(1, report.sources[0].count)) * 100)}%"></b></i><strong>${source.count}</strong><small>${source.replyRate == null ? '—' : `${source.replyRate}% reply rate`}</small></div>`).join('')
      : '<p class="weekly-report-empty">No application sources to compare yet.</p>';
    $('#weeklyReportEmailTotal').textContent = plural(report.emails.length, 'email');
    $('#weeklyReportEmailBreakdown').innerHTML = Object.keys(report.emailTypes).length
      ? Object.entries(report.emailTypes).sort((a, b) => b[1] - a[1]).map(([type, count]) => `<span>${escapeHtml(type)} · ${count}</span>`).join('')
      : '<p class="weekly-report-empty">No emails sent in this period.</p>';
    renderWeeklyReportDetails(report);
    renderWeeklyReportActivities(report);
    requestAnimationFrame(() => observeWeeklyReportSections());
    return report;
  }

  function weeklyReportScrollContainer() {
    const modal = $('#weeklyReportModal');
    const form = $('.weekly-report-form', modal);
    return form.scrollHeight > form.clientHeight && ['auto', 'scroll'].includes(getComputedStyle(form).overflowY)
      ? form
      : modal;
  }

  function updateWeeklyReportActiveSection() {
    if (weeklyReportScrollFrame) return;
    weeklyReportScrollFrame = requestAnimationFrame(() => {
      weeklyReportScrollFrame = 0;
      const modal = $('#weeklyReportModal');
      if (!modal.open) return;
      const scrollContainer = weeklyReportScrollContainer();
      const sections = $$('.weekly-report-section', $('#weeklyReportContent'));
      if (!sections.length) return;
      const containerTop = scrollContainer.getBoundingClientRect().top;
      const headerHeight = $('.weekly-report-header').offsetHeight;
      const navBottom = $('.weekly-report-nav').getBoundingClientRect().bottom;
      modal.style.setProperty('--weekly-report-header-height', `${headerHeight}px`);
      const activeLine = Math.max(containerTop + headerHeight, navBottom) + 12;
      let activeSection = sections[0];
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= activeLine) activeSection = section;
        else break;
      }
      if (scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 2) {
        activeSection = sections[sections.length - 1];
      }
      $$('.weekly-report-nav [data-report-target]').forEach(button => {
        if (button.dataset.reportTarget === activeSection.id) button.setAttribute('aria-current', 'location');
        else button.removeAttribute('aria-current');
      });
    });
  }

  function observeWeeklyReportSections() {
    const modal = $('#weeklyReportModal');
    const form = $('.weekly-report-form', modal);
    if (!modal.open) return;
    modal.removeEventListener('scroll', updateWeeklyReportActiveSection);
    form.removeEventListener('scroll', updateWeeklyReportActiveSection);
    window.removeEventListener('resize', updateWeeklyReportActiveSection);
    modal.addEventListener('scroll', updateWeeklyReportActiveSection, { passive: true });
    form.addEventListener('scroll', updateWeeklyReportActiveSection, { passive: true });
    window.addEventListener('resize', updateWeeklyReportActiveSection, { passive: true });
    updateWeeklyReportActiveSection();
  }

  function scrollToWeeklyReportSection(section) {
    const scrollContainer = weeklyReportScrollContainer();
    const navBottom = $('.weekly-report-nav').getBoundingClientRect().bottom;
    const offset = section.getBoundingClientRect().top - navBottom - 8;
    scrollContainer.scrollTo({
      top: Math.max(0, scrollContainer.scrollTop + offset),
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    });
  }

  function selectWeeklyReportWeek(offset) {
    weeklyReportOffset = Math.min(0, offset);
    renderWeeklyReport();
    weeklyReportScrollContainer().scrollTo({ top: 0, behavior: 'smooth' });
  }

  function weeklyCsvCell(value) {
    let text = String(value ?? '');
    if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function downloadWeeklyCsv(allWeeks = false) {
    try {
      const reports = allWeeks
        ? [...weeklyHistoryOffsets(), 0].map(offset => weeklyReportData(offset))
        : [weeklyReportData()];
      const rows = [
        ['Week', 'Date', 'Type', 'Company', 'Platform', 'Status', 'Details'],
        ...reports.flatMap(report => report.activities.map(activity => [
          weeklyRangeLabel(report.range),
          formatDate(dateKey(activity.date)),
          activity.type,
          activity.company,
          activity.platform,
          activity.status,
          activity.details
        ]))
      ];
      const csv = `\uFEFF${rows.map(row => row.map(weeklyCsvCell).join(',')).join('\r\n')}`;
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = allWeeks
        ? 'jeff-va-weekly-reports-all-weeks.csv'
        : `jeff-va-weekly-report-${weeklyReportData().range.end}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showActionResult({ title: 'Report downloaded', message: allWeeks ? 'Your all-weeks CSV report was downloaded.' : 'Your weekly CSV report was downloaded.' });
    } catch (error) {
      console.error('Weekly report CSV export failed:', error);
      showActionResult({ title: 'Could not generate report', message: 'The weekly report CSV could not be generated. Try again.', status: 'error' });
    }
  }

  function openWeeklyReport() {
    weeklyReportOffset = 0;
    renderWeeklyReport();
    $('#weeklyReportModal').showModal();
    requestAnimationFrame(() => observeWeeklyReportSections());
  }

  function renderWeeklyReportAvailability() {
    const range = weekRange();
    const reportKey = `${range.start}|${range.end}`;
    if (!currentUser || !dataReady || !supabaseDataLoaded || localStorage.getItem(WEEKLY_REPORT_SEEN_KEY) === reportKey) return;
    localStorage.setItem(WEEKLY_REPORT_SEEN_KEY, reportKey);
    setTimeout(openWeeklyReport, 250);
  }

  function pdfRgb(hex) {
    const value = hex.replace('#', '');
    return [0, 2, 4].map(index => Number.parseInt(value.slice(index, index + 2), 16));
  }

  function weeklyPdfStatusColor(status) {
    if (STATUS_COLORS[status]) return STATUS_COLORS[status];
    if (status === 'Due') return '#8a6331';
    if (status === 'Sent') return '#187443';
    return '#69717d';
  }

  function drawWeeklyReportPdf(pdf, reports, allWeeks = false) {
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 14;
    const contentWidth = pageWidth - margin * 2;
    const footerTop = pageHeight - 15;
    const ink = '#202b43';
    const navy = '#1b2244';
    const muted = '#667085';
    const border = '#dce1e8';
    const pale = '#f3f5f8';
    let cursorY = 0;

    const setText = (color = ink) => pdf.setTextColor(...pdfRgb(color));
    const setFill = color => pdf.setFillColor(...pdfRgb(color));
    const setLine = color => pdf.setDrawColor(...pdfRgb(color));
    const textLines = (value, width, fontSize = 9) => {
      pdf.setFontSize(fontSize);
      return pdf.splitTextToSize(String(value ?? '—'), Math.max(2, width));
    };
    const drawBand = (title, rangeLabel, badge, continuation = false) => {
      setFill(navy);
      pdf.rect(0, 0, pageWidth, continuation ? 27 : 39, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      setText('#d9e1f1');
      pdf.text('JEFF VA', margin, 9);
      pdf.setFontSize(continuation ? 13 : 18);
      setText('#ffffff');
      pdf.text(title, margin, continuation ? 18 : 21);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      setText('#e3e8f2');
      pdf.text(rangeLabel, margin, continuation ? 24 : 31);
      const badgeWidth = Math.min(61, Math.max(25, pdf.getTextWidth(badge) + 8));
      const badgeX = pageWidth - margin - badgeWidth;
      setFill('#ffffff');
      pdf.roundedRect(badgeX, continuation ? 8 : 13, badgeWidth, 9, 2, 2, 'F');
      setText(navy);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.text(badge, badgeX + 4, continuation ? 14 : 19);
      cursorY = continuation ? 34 : 46;
    };
    const beginPage = (title, rangeLabel, badge, continuation = false) => {
      pdf.addPage();
      drawBand(title, rangeLabel, badge, continuation);
    };
    const drawHeading = title => {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      setText(navy);
      pdf.text(title, margin, cursorY + 4);
      cursorY += 9;
    };
    const drawMetricCards = (items, columns = 3) => {
      const gap = 3;
      const rows = Math.ceil(items.length / columns);
      const cardWidth = (contentWidth - gap * (columns - 1)) / columns;
      const cardHeight = 19;
      items.forEach(([label, value], index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = margin + column * (cardWidth + gap);
        const y = cursorY + row * (cardHeight + gap);
        setFill('#f6f7fa');
        setLine(border);
        pdf.roundedRect(x, y, cardWidth, cardHeight, 2, 2, 'FD');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(16);
        setText(navy);
        pdf.text(String(value), x + 3, y + 8);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        setText(muted);
        pdf.text(String(label), x + 3, y + 15);
      });
      cursorY += rows * (cardHeight + gap) + 2;
    };
    const drawOutcomeChart = report => {
      drawHeading('Pipeline outcomes');
      if (!report.outcomes.length) {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        setText(muted);
        pdf.text('No applications this week yet.', margin, cursorY + 2);
        cursorY += 9;
        return;
      }
      const labelWidth = 31;
      const countWidth = 10;
      const barWidth = contentWidth - labelWidth - countWidth;
      const maxCount = Math.max(1, ...report.outcomes.map(([, count]) => count));
      report.outcomes.forEach(([status, count]) => {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        setText(ink);
        pdf.text(status, margin, cursorY + 3.6);
        setFill(pale);
        pdf.roundedRect(margin + labelWidth, cursorY, barWidth, 4.5, 1, 1, 'F');
        setFill(weeklyPdfStatusColor(status));
        pdf.roundedRect(margin + labelWidth, cursorY, Math.max(2, barWidth * count / maxCount), 4.5, 1, 1, 'F');
        pdf.setFont('helvetica', 'bold');
        setText(ink);
        pdf.text(String(count), pageWidth - margin, cursorY + 3.6, { align: 'right' });
        cursorY += 6;
      });
      cursorY += 2;
    };
    const drawTrendChart = weekReports => {
      const chartReports = weekReports.slice(-12);
      drawHeading('Activity trend');
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      setText(muted);
      pdf.text('Applications and other tracked activities by week (most recent 12 weeks).', margin, cursorY + 1);
      cursorY += 7;
      const chartHeight = 31;
      const labelHeight = 8;
      const slotWidth = contentWidth / Math.max(1, chartReports.length);
      const barWidth = Math.min(9, Math.max(3, slotWidth * .54));
      const maxActivity = Math.max(1, ...chartReports.map(report => report.activities.length));
      const baseline = cursorY + chartHeight;
      setLine(border);
      pdf.setLineWidth(.25);
      pdf.line(margin, baseline, pageWidth - margin, baseline);
      chartReports.forEach((report, index) => {
        const x = margin + index * slotWidth + (slotWidth - barWidth) / 2;
        const appCount = report.applications.length;
        const otherCount = Math.max(0, report.activities.length - appCount);
        const appHeight = Math.max(0, chartHeight * appCount / maxActivity);
        const otherHeight = Math.max(0, chartHeight * otherCount / maxActivity);
        setFill('#2563a6');
        if (appHeight) pdf.rect(x, baseline - appHeight, barWidth, appHeight, 'F');
        setFill('#1b2244');
        if (otherHeight) pdf.rect(x, baseline - appHeight - otherHeight, barWidth, otherHeight, 'F');
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        setText(ink);
        pdf.text(String(report.activities.length), x + barWidth / 2, baseline - appHeight - otherHeight - 2, { align: 'center' });
        const rangeStart = new Date(`${report.range.start}T12:00:00`);
        const label = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(rangeStart);
        pdf.text(label, margin + index * slotWidth + slotWidth / 2, baseline + labelHeight - 1, { align: 'center' });
      });
      cursorY = baseline + labelHeight + 2;
      pdf.setFontSize(9);
      setFill('#2563a6');
      pdf.rect(margin, cursorY, 3, 3, 'F');
      pdf.setFont('helvetica', 'normal');
      setText(muted);
      pdf.text('Applications', margin + 5, cursorY + 2.7);
      setFill('#1b2244');
      pdf.rect(margin + 34, cursorY, 3, 3, 'F');
      pdf.text('Other tracked activities', margin + 39, cursorY + 2.7);
      cursorY += 8;
    };
    const drawTable = (report, title, columns, rows) => {
      if (cursorY + 19 > footerTop) {
        beginPage('Weekly report', weeklyRangeLabel(report.range), weeklyReportStatus(report, report.offset), true);
      }
      drawHeading(title);
      const tableX = margin;
      const tableWidth = contentWidth;
      const widths = columns.map(column => tableWidth * column.ratio);
      const drawTableHeader = () => {
        setFill('#e9edf3');
        pdf.rect(tableX, cursorY, tableWidth, 7, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        setText(ink);
        let x = tableX;
        columns.forEach((column, index) => {
          const labelX = column.align === 'right' ? x + widths[index] - 2 : x + 2;
          pdf.text(column.label, labelX, cursorY + 4.8, { align: column.align || 'left' });
          x += widths[index];
        });
        cursorY += 7;
      };
      drawTableHeader();
      const sourceRows = rows.length ? rows : [[{ text: 'No records for this period.', span: true }]];
      sourceRows.forEach((row, rowIndex) => {
        const cells = row.map((value, index) => {
          const cell = typeof value === 'object' && value !== null ? value : { text: value };
          const availableWidth = cell.span ? tableWidth - 4 : widths[index] - 4;
          return { ...cell, lines: textLines(cell.text, availableWidth, 9) };
        });
        const rowHeight = Math.max(7, ...cells.map(cell => cell.lines.length * 4.2 + 3));
        const maximumRowHeight = footerTop - 3 - (34 + 9 + 7);
        if (rowHeight > maximumRowHeight) {
          throw new Error('A report entry is too long to fit on one PDF page. Shorten the note or subject and try again.');
        }
        if (cursorY + rowHeight > footerTop - 3) {
          beginPage('Weekly report', weeklyRangeLabel(report.range), weeklyReportStatus(report, report.offset), true);
          drawHeading(`${title} (continued)`);
          drawTableHeader();
        }
        if (rowIndex % 2 === 1) {
          setFill('#fafbfc');
          pdf.rect(tableX, cursorY, tableWidth, rowHeight, 'F');
        }
        setLine(border);
        pdf.setLineWidth(.2);
        pdf.line(tableX, cursorY + rowHeight, tableX + tableWidth, cursorY + rowHeight);
        let x = tableX;
        cells.forEach((cell, index) => {
          if (cell.status) {
            const statusColor = weeklyPdfStatusColor(cell.status);
            const statusRgb = pdfRgb(statusColor);
            const tint = statusRgb.map(channel => Math.round(channel * .12 + 255 * .88));
            setFill(`#${tint.map(value => value.toString(16).padStart(2, '0')).join('')}`);
            pdf.roundedRect(x + 1.5, cursorY + 1.2, Math.min(widths[index] - 3, pdf.getTextWidth(cell.text) + 5), 5.2, 1.2, 1.2, 'F');
            setText(statusColor);
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(9);
            pdf.text(cell.text, x + 4, cursorY + 4.8);
          } else {
            setText(muted);
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(9);
            const textX = cell.span ? x + 2 : cell.align === 'right' ? x + widths[index] - 2 : x + 2;
            pdf.text(cell.lines, textX, cursorY + 4.7, { align: cell.align || 'left' });
          }
          x += widths[index] || 0;
        });
        cursorY += rowHeight;
      });
      cursorY += 5;
    };
    const renderWeeklyDetails = report => {
      report.offset = report.offset ?? 0;
      if (pdf.getNumberOfPages() === 1 && cursorY === 0) {
        drawBand('Weekly report', weeklyRangeLabel(report.range), weeklyReportStatus(report, report.offset));
      } else {
        beginPage('Weekly report', weeklyRangeLabel(report.range), weeklyReportStatus(report, report.offset));
      }
      drawMetricCards([
        ['Total activities', report.activities.length],
        ['Applications', report.applications.length],
        ['Application emails', report.applicationEmails.length],
        ['Replies', report.replies.length],
        ['Interviews', report.interviews.length],
        ['Offers', report.offers.length],
        ['Response rate', report.responseRate == null ? '—' : `${report.responseRate}%`]
      ]);
      drawOutcomeChart(report);
      const applicationRows = report.applications.map(item => [
        formatDate(dateKey(item.appliedDate)),
        item.clientName || 'Untitled application',
        item.platform || '—',
        { text: STATUS_LABELS[item.status] || item.status || '—', status: item.status }
      ]);
      drawTable(report, 'Applications', [
        { label: 'Date', ratio: .18 },
        { label: 'Company', ratio: .38 },
        { label: 'Platform', ratio: .25 },
        { label: 'Status', ratio: .19 }
      ], applicationRows);
      const emailRows = [...report.emails.map(email => ({ email, direction: 'Sent' })), ...report.replies.map(email => ({ email, direction: 'Reply' }))]
        .sort((first, second) => new Date(second.email.date) - new Date(first.email.date))
        .map(({ email, direction }) => [
          formatDate(dateKey(email.date)),
          direction,
          matchApplicationsForEmail(email)[0]?.clientName || '—',
          email.subject || '(No subject)'
        ]);
      drawTable(report, 'Emails', [
        { label: 'Date', ratio: .18 },
        { label: 'Type', ratio: .15 },
        { label: 'Company', ratio: .27 },
        { label: 'Subject', ratio: .40 }
      ], emailRows);
      drawTable(report, 'Interviews', [
        { label: 'Date', ratio: .18 },
        { label: 'Company', ratio: .36 },
        { label: 'Role', ratio: .28 },
        { label: 'Status', ratio: .18 }
      ], report.interviews.map(item => [
        formatDate(dateKey(item.interviewDate)),
        item.clientName || 'Unnamed application',
        item.role || '—',
        { text: STATUS_LABELS[item.status] || item.status || '—', status: item.status }
      ]));
      drawTable(report, 'Follow-ups', [
        { label: 'Date', ratio: .2 },
        { label: 'Company', ratio: .5 },
        { label: 'Status', ratio: .3 }
      ], report.followUps.map(item => [
        formatDate(dateKey(item.followUpDate)),
        item.clientName || 'Unnamed application',
        { text: item.followUpSentAt ? 'Sent' : 'Due', status: item.followUpSentAt ? 'Sent' : 'Due' }
      ]));
      drawTable(report, 'Sources', [
        { label: 'Platform', ratio: .46 },
        { label: 'Applications', ratio: .18, align: 'right' },
        { label: 'Replies', ratio: .16, align: 'right' },
        { label: 'Reply rate', ratio: .2, align: 'right' }
      ], report.sources.map(source => [source.platform, source.count, source.replied, source.replyRate == null ? '—' : `${source.replyRate}%`]));
      drawTable(report, 'Outcomes', [
        { label: 'Status', ratio: .7 },
        { label: 'Applications', ratio: .3, align: 'right' }
      ], report.outcomes.map(([status, count]) => [
        { text: STATUS_LABELS[status] || status, status },
        count
      ]));
      drawTable(report, 'Notes', [
        { label: 'Company / platform', ratio: .34 },
        { label: 'Note', ratio: .66 }
      ], report.notes.map(item => [`${item.clientName || 'Untitled application'} / ${item.platform || 'Platform not specified'}`, item.notes]));
      drawTable(report, 'Activity log', [
        { label: 'Date', ratio: .13 },
        { label: 'Type', ratio: .12 },
        { label: 'Company', ratio: .2 },
        { label: 'Platform', ratio: .15 },
        { label: 'Status', ratio: .12 },
        { label: 'Details', ratio: .28 }
      ], report.activities.map(activity => [
        formatDate(dateKey(activity.date)),
        activity.type,
        activity.company || '—',
        activity.platform || '—',
        { text: STATUS_LABELS[activity.status] || activity.status || '—', status: activity.status },
        activity.details || '—'
      ]));
    };

    if (allWeeks) {
      const oldest = reports[0]?.range;
      const newest = reports[reports.length - 1]?.range;
      const fullDateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      const overallRange = oldest && newest
        ? `${fullDateFormatter.format(new Date(`${oldest.start}T12:00:00`))} – ${fullDateFormatter.format(new Date(`${newest.end}T12:00:00`))}`
        : 'No report periods available';
      const totals = reports.reduce((result, report) => ({
        activities: result.activities + report.activities.length,
        applications: result.applications + report.applications.length,
        emails: result.emails + report.applicationEmails.length,
        replies: result.replies + report.replies.length,
        interviews: result.interviews + report.interviews.length,
        offers: result.offers + report.offers.length
      }), { activities: 0, applications: 0, emails: 0, replies: 0, interviews: 0, offers: 0 });
      drawBand('All-weeks report', overallRange, 'All weeks');
      drawMetricCards([
        ['Total activities', totals.activities],
        ['Applications', totals.applications],
        ['Application emails', totals.emails],
        ['Replies', totals.replies],
        ['Interviews', totals.interviews],
        ['Offers', totals.offers]
      ]);
      drawTrendChart(reports);
      const tocPages = [];
      drawHeading('Table of contents');
      let headerY = cursorY + 1;
      let rowsY = headerY + 7;
      let rowsPerPage = Math.max(1, Math.floor((footerTop - rowsY) / 7));
      let nextWeekIndex = rowsPerPage;
      tocPages.push({ page: 1, headerY, rowsY, rowsPerPage, startIndex: 0 });
      let remainingWeeks = Math.max(0, reports.length - rowsPerPage);
      while (remainingWeeks > 0) {
        beginPage('All-weeks report', overallRange, 'Contents', true);
        cursorY = 37;
        drawHeading('Table of contents');
        headerY = cursorY + 1;
        rowsY = headerY + 7;
        rowsPerPage = Math.max(1, Math.floor((footerTop - rowsY) / 7));
        tocPages.push({ page: pdf.getNumberOfPages(), headerY, rowsY, rowsPerPage, startIndex: nextWeekIndex });
        nextWeekIndex += rowsPerPage;
        remainingWeeks -= rowsPerPage;
      }
      const weeklyPageNumbers = [];
      reports.forEach(report => {
        report.offset = report.offset ?? 0;
        const firstPage = pdf.getNumberOfPages() + 1;
        renderWeeklyDetails(report);
        weeklyPageNumbers.push(firstPage);
      });
      reports.forEach((report, index) => {
        const tocPage = tocPages.find(item => index >= item.startIndex && index < item.startIndex + item.rowsPerPage);
        const rowIndex = index - tocPage.startIndex;
        pdf.setPage(tocPage.page);
        cursorY = tocPage.rowsY + rowIndex * 7;
        if (rowIndex === 0) {
          setFill('#e9edf3');
          pdf.rect(margin, tocPage.headerY, contentWidth, 7, 'F');
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(9);
          setText(ink);
          pdf.text('Week', margin + 2, tocPage.headerY + 4.8);
          pdf.text('Applications', pageWidth - margin - 39, tocPage.headerY + 4.8, { align: 'right' });
          pdf.text('Activities', pageWidth - margin - 20, tocPage.headerY + 4.8, { align: 'right' });
          pdf.text('Page', pageWidth - margin - 2, tocPage.headerY + 4.8, { align: 'right' });
        }
        if (index % 2 === 1) {
          setFill('#fafbfc');
          pdf.rect(margin, cursorY, contentWidth, 7, 'F');
        }
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        setText(muted);
        pdf.text(weeklyRangeLabel(report.range), margin + 2, cursorY + 4.8);
        pdf.text(String(report.applications.length), pageWidth - margin - 39, cursorY + 4.8, { align: 'right' });
        pdf.text(String(report.activities.length), pageWidth - margin - 20, cursorY + 4.8, { align: 'right' });
        pdf.text(String(weeklyPageNumbers[index]), pageWidth - margin - 2, cursorY + 4.8, { align: 'right' });
        setLine(border);
        pdf.line(margin, cursorY + 7, pageWidth - margin, cursorY + 7);
      });
    } else {
      renderWeeklyDetails(reports[0]);
    }
    const generatedOn = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'Asia/Manila' }).format(new Date());
    const totalPages = pdf.getNumberOfPages();
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      pdf.setPage(pageNumber);
      setLine(border);
      pdf.setLineWidth(.25);
      pdf.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      setText(muted);
      pdf.text(`Generated on ${generatedOn}`, margin, pageHeight - 7);
      const period = allWeeks ? 'All weeks' : weeklyRangeLabel(reports[0].range);
      pdf.text(period, pageWidth / 2, pageHeight - 7, { align: 'center' });
      pdf.text(`Page ${pageNumber} of ${totalPages}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
    }
  }

  function downloadWeeklyReport(allWeeks = false) {
    const button = $(allWeeks ? '#downloadAllWeeksPdf' : '#downloadWeeklyReport');
    const pdfLib = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!pdfLib) {
      toast('PDF export is still loading, try again in a moment');
      return;
    }
    const previousLabel = button.textContent;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.classList.add('weekly-report-pdf-loading');
    button.textContent = 'Preparing PDF...';
    $('#weeklyReportDownloadOptions').hidden = false;
    $('#weeklyReportDownloadMenuButton').setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => {
      try {
        const offsets = allWeeks ? [...weeklyHistoryOffsets(), 0] : [weeklyReportOffset];
        const reports = offsets.map(offset => {
          const report = weeklyReportData(offset);
          report.offset = offset;
          return report;
        });
        const pdf = new pdfLib({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        drawWeeklyReportPdf(pdf, reports, allWeeks);
        pdf.save(allWeeks
          ? 'jeff-va-weekly-reports-all-weeks.pdf'
          : `jeff-va-weekly-report-${reports[0].range.end}.pdf`);
        showActionResult({ title: 'Report downloaded', message: allWeeks ? 'Your all-weeks PDF report was downloaded.' : 'Your weekly report PDF was downloaded.' });
      } catch (error) {
        console.error('Weekly report PDF export failed:', error);
        showActionResult({
          title: 'Could not generate report',
          message: error instanceof Error ? error.message : 'The weekly report PDF could not be generated. Try again.',
          status: 'error'
        });
      } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.classList.remove('weekly-report-pdf-loading');
        button.textContent = previousLabel;
        $('#weeklyReportDownloadOptions').hidden = true;
        $('#weeklyReportDownloadMenuButton').setAttribute('aria-expanded', 'false');
      }
    });
  }

  $('#openWeeklyReport').addEventListener('click', openWeeklyReport);
  $('#weeklyReportHistory').innerHTML = weeklyHistoryOptions();
  $('#weeklyReportHistory').addEventListener('change', event => {
    selectWeeklyReportWeek(Number(event.target.value));
  });
  $('#previousWeeklyReport').addEventListener('click', () => {
    selectWeeklyReportWeek(weeklyReportOffset - 1);
  });
  $('#nextWeeklyReport').addEventListener('click', () => {
    selectWeeklyReportWeek(weeklyReportOffset + 1);
  });
  $('#showCurrentWeeklyReport').addEventListener('click', () => {
    selectWeeklyReportWeek(0);
  });
  $$('.weekly-report-nav [data-report-target]').forEach(button => button.addEventListener('click', () => {
    const section = $(`#${button.dataset.reportTarget}`);
    if (!section) return;
    button.setAttribute('aria-current', 'location');
    scrollToWeeklyReportSection(section);
    updateWeeklyReportActiveSection();
  }));
  $$('#weeklyReportActivityFilters [data-activity-filter]').forEach(button => button.addEventListener('click', () => {
    weeklyReportActivityFilter = button.dataset.activityFilter;
    $$('#weeklyReportActivityFilters [data-activity-filter]').forEach(filterButton => {
      const selected = filterButton === button;
      filterButton.classList.toggle('active', selected);
      filterButton.setAttribute('aria-pressed', String(selected));
    });
    renderWeeklyReportActivities(weeklyReportData());
  }));
  $('#weeklyReportDownloadMenuButton').addEventListener('click', () => {
    const options = $('#weeklyReportDownloadOptions');
    const open = options.hidden;
    options.hidden = !open;
    $('#weeklyReportDownloadMenuButton').setAttribute('aria-expanded', String(open));
  });
  $('#weeklyReportDownloadOptions').addEventListener('click', event => {
    const action = event.target.closest('[data-report-download]')?.dataset.reportDownload;
    if (action && action !== 'pdf' && action !== 'all-weeks-pdf') {
      $('#weeklyReportDownloadOptions').hidden = true;
      $('#weeklyReportDownloadMenuButton').setAttribute('aria-expanded', 'false');
    }
    if (action === 'pdf') {
      downloadWeeklyReport();
    } else if (action === 'all-weeks-pdf') {
      downloadWeeklyReport(true);
    } else if (action === 'csv' || action === 'all-weeks') {
      downloadWeeklyCsv(action === 'all-weeks');
    }
  });
  document.addEventListener('click', event => {
    const menu = $('#weeklyReportDownloadMenu');
    if (menu && !menu.contains(event.target)) {
      $('#weeklyReportDownloadOptions').hidden = true;
      $('#weeklyReportDownloadMenuButton').setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('#weeklyReportDownloadOptions').hidden) {
      event.preventDefault();
      $('#weeklyReportDownloadOptions').hidden = true;
      $('#weeklyReportDownloadMenuButton').setAttribute('aria-expanded', 'false');
      $('#weeklyReportDownloadMenuButton').focus();
    }
  });
