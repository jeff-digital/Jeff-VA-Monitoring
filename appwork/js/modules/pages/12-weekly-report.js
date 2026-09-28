  // Weekly reporting is isolated from the dashboard so reporting changes cannot affect client, email, or billing flows.
  const WEEKLY_REPORT_SEEN_KEY = 'jeff-va-weekly-report-seen-v1';
  let weeklyReportOffset = 0;

  function weekRange(offset = 0) {
    const end = new Date();
    end.setHours(12, 0, 0, 0);
    const start = new Date(end);
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
    start.setDate(start.getDate() + offset * 7);
    if (offset !== 0) {
      end.setTime(start.getTime());
      end.setDate(end.getDate() + 4);
    }
    return { start: localDateKey(start), end: localDateKey(end) };
  }

  function weeklyRangeLabel(range) {
    const start = new Date(`${range.start}T12:00:00`);
    const end = new Date(`${range.end}T12:00:00`);
    const format = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    return `${format.format(start)} – ${format.format(end)}, ${end.getFullYear()}`;
  }

  function weeklyHistoryOptions() {
    const currentRange = weekRange();
    const activityDates = [
      ...data.applications.map(item => item.appliedDate),
      ...data.applications.filter(item => item.status === 'Active client').map(item => item.activeAt),
      ...(data.invoices || []).map(item => item.sentAt),
      ...data.emails.filter(item => item.direction === 'sent').map(item => item.date)
    ].map(dateKey).filter(date => date && date < currentRange.start);
    const offsets = [...new Set(activityDates.map(date => {
      const activityDate = new Date(`${date}T12:00:00`);
      const daysSinceMonday = (activityDate.getDay() + 6) % 7;
      activityDate.setDate(activityDate.getDate() - daysSinceMonday);
      return Math.round((activityDate - new Date(`${currentRange.start}T12:00:00`)) / 86400000 / 7);
    }))].sort((first, second) => second - first);
    const options = offsets.map(offset => {
      const range = weekRange(offset);
      return `<option value="${offset}">${escapeHtml(weeklyRangeLabel(range).replace(' – ', ' to '))}</option>`;
    }).join('');
    return `<option value="0">Choose a previous week</option>${options}`;
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

  function weeklyReportData() {
    const range = weekRange(weeklyReportOffset);
    const applications = data.applications.filter(item => isInWeeklyRange(item.appliedDate, range));
    const invoices = (data.invoices || []).filter(item => isInWeeklyRange(item.sentAt, range));
    const clients = data.applications.filter(item => item.status === 'Active client' && isInWeeklyRange(item.activeAt, range));
    const emails = data.emails.filter(item => item.direction === 'sent' && isInWeeklyRange(item.date, range));
    const emailTypes = emails.reduce((counts, email) => {
      const type = weeklyEmailType(email);
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, {});
    const platformCounts = applications.reduce((counts, item) => {
      const platform = item.platform || 'Not specified';
      counts[platform] = (counts[platform] || 0) + 1;
      return counts;
    }, {});
    const topPlatform = Object.entries(platformCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || ['No applications', 0];
    const activities = [
      ...applications.map(item => ({ date: item.appliedDate, label: `Applied: ${item.clientName || 'Untitled application'}`, type: 'Application' })),
      ...clients.map(item => ({ date: item.activeAt, label: `Client activated: ${item.clientName || 'Unnamed client'}`, type: 'Client' })),
      ...invoices.map(item => ({ date: item.sentAt, label: `Invoice sent: ${item.invoiceNumber || item.fileName || 'Invoice'}`, type: 'Invoice' })),
      ...emails.map(item => ({ date: item.date, label: `${weeklyEmailType(item)} email: ${item.subject || '(No subject)'}`, type: 'Email' }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));
    return { range, applications, invoices, clients, emails, emailTypes, topPlatform, activities };
  }

  function renderWeeklyReport() {
    const report = weeklyReportData();
    $('#weeklyReportDate').textContent = `${weeklyReportOffset === 0 ? 'Week in progress' : 'Selected week'} ${weeklyRangeLabel(report.range)}`;
    $('#weeklyReportPeriod').textContent = `${weeklyReportOffset === 0 ? 'Current week' : 'Selected week'}: ${weeklyRangeLabel(report.range)}`;
    $('#showCurrentWeeklyReport').disabled = weeklyReportOffset === 0;
    $('#weeklyReportHistory').innerHTML = weeklyHistoryOptions();
    $('#weeklyReportHistory').value = String(weeklyReportOffset);
    const metrics = [
      ['Applications', report.applications.length],
      ['Invoices sent', report.invoices.length],
      ['New clients', report.clients.length],
      ['Emails sent', report.emails.length]
    ];
    $('#weeklyReportMetrics').innerHTML = `${metrics.map(([label, value]) => `<div class="weekly-report-metric"><strong>${value}</strong><span>${label}</span></div>`).join('')}<div class="weekly-report-metric weekly-report-platform"><strong title="${escapeHtml(report.topPlatform[0])}">${escapeHtml(report.topPlatform[0])}</strong><span>Most applied platform${report.topPlatform[1] ? ` · ${report.topPlatform[1]}` : ''}</span></div>`;
    const max = Math.max(1, ...metrics.map(([, value]) => value));
    $('#weeklyReportChart').innerHTML = metrics.map(([label, value]) => `<div class="weekly-report-bar"><i style="height:${Math.max(3, (value / max) * 100)}%"></i><strong>${value}</strong><span>${escapeHtml(label)}</span></div>`).join('');
    $('#weeklyReportEmailTotal').textContent = plural(report.emails.length, 'email');
    $('#weeklyReportEmailBreakdown').innerHTML = Object.keys(report.emailTypes).length
      ? Object.entries(report.emailTypes).sort((a, b) => b[1] - a[1]).map(([type, count]) => `<span>${escapeHtml(type)} · ${count}</span>`).join('')
      : '<p class="weekly-report-empty">No emails sent in this period.</p>';
    $('#weeklyReportActivityCount').textContent = plural(report.activities.length, 'activity');
    $('#weeklyReportActivities').innerHTML = report.activities.length
      ? report.activities.slice(0, 30).map(activity => `<div class="weekly-report-activity"><span>${escapeHtml(activity.label)}</span><small>${escapeHtml(formatDate(dateKey(activity.date)))}</small></div>`).join('')
      : '<p class="weekly-report-empty">No tracked activity in this period.</p>';
    return report;
  }

  function openWeeklyReport() {
    weeklyReportOffset = 0;
    renderWeeklyReport();
    $('#weeklyReportModal').showModal();
  }

  function renderWeeklyReportAvailability() {
    const range = weekRange();
    const period = $('#weeklyReportPeriod');
    if (period) period.textContent = `Current week: ${weeklyRangeLabel(range)}`;
    const reportKey = `${range.start}|${range.end}`;
    if (!currentUser || !dataReady || !supabaseDataLoaded || localStorage.getItem(WEEKLY_REPORT_SEEN_KEY) === reportKey) return;
    localStorage.setItem(WEEKLY_REPORT_SEEN_KEY, reportKey);
    setTimeout(openWeeklyReport, 250);
  }

  function downloadWeeklyReport() {
    const modal = $('#weeklyReportModal');
    const button = $('#downloadWeeklyReport');
    const report = weeklyReportData();
    const pdfLib = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!modal || !window.html2canvas || !pdfLib) {
      toast('PDF export is still loading, try again in a moment');
      return;
    }

    const previousLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Preparing PDF...';

    window.html2canvas(modal, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      scrollX: 0,
      scrollY: 0
    }).then(canvas => {
      const pdf = new pdfLib({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 12;
      const maxWidth = pageWidth - (margin * 2);
      const maxHeight = pageHeight - (margin * 2);
      const aspectRatio = canvas.width / canvas.height;
      let imgWidth = maxWidth;
      let imgHeight = imgWidth / aspectRatio;
      if (imgHeight > maxHeight) {
        imgHeight = maxHeight;
        imgWidth = imgHeight * aspectRatio;
      }
      const imgData = canvas.toDataURL('image/png');
      const x = (pageWidth - imgWidth) / 2;
      const y = (pageHeight - imgHeight) / 2;
      pdf.addImage(imgData, 'PNG', x, y, imgWidth, imgHeight);
      pdf.save(`jeff-va-weekly-report-${report.range.end}.pdf`);
      showActionResult({ title: 'Report downloaded', message: 'Your weekly report PDF was downloaded.' });
    }).catch(error => {
      console.error('Weekly report PDF export failed:', error);
      showActionResult({ title: 'Could not generate report', message: 'The weekly report PDF could not be generated. Try again.', status: 'error' });
    }).finally(() => {
      button.disabled = false;
      button.textContent = previousLabel;
    });
  }

  $('#openWeeklyReport').addEventListener('click', openWeeklyReport);
  $('#weeklyReportHistory').innerHTML = weeklyHistoryOptions();
  $('#weeklyReportHistory').addEventListener('change', event => {
    weeklyReportOffset = Number(event.target.value);
    renderWeeklyReport();
  });
  $('#showCurrentWeeklyReport').addEventListener('click', () => {
    weeklyReportOffset = 0;
    renderWeeklyReport();
  });
  $('#downloadWeeklyReport').addEventListener('click', downloadWeeklyReport);
