  // --- Excel export/restore ---
  // Uses SheetJS (loaded via CDN in index.html) to read/write real .xlsx workbooks in the
  // browser. Application records and tool data are exported as separate sheets. Document binaries stay in private
  // Supabase Storage and are never included in the sheet — only their names/sizes/metadata travel
  // with the sheet. A restore therefore restores records, not document binaries or email history.
  const APPLICATION_COLUMNS = ['id', 'clientName', 'status', 'contractStatus', 'contractEndDate', 'contractEndedEmailSentAt', 'platform', 'employmentType', 'salaryType', 'salaryAmount', 'hoursPerWeek', 'contact', 'role', 'appliedDate', 'createdAt', 'activeAt', 'activePendingDocument', 'activePendingEmail', 'documentEmailPending', 'documentEmailReminderDate', 'documentEmailReminderAlertedDate', 'interviewPriority', 'interviewDate', 'interviewLink', 'interviewAlertDate', 'followUpDate', 'automaticFollowUp', 'followUpProcessedAt', 'followUpSentAt', 'notes', 'email', 'phone', 'website', 'socialMedia', 'location', 'documents', 'updatedAt'];
  const TO_APPLY_COLUMNS = ['id', 'title', 'link', 'dueDate', 'notes'];
  const DAILY_TASK_COLUMNS = ['id', 'title', 'type', 'taskDate', 'relatedType', 'relatedId', 'relatedName', 'destination', 'notes', 'checklist', 'createdAt', 'completedAt'];
  const LINK_COLUMNS = ['id', 'name', 'url', 'createdAt', 'updatedAt'];
  const SCRIPT_COLUMNS = ['id', 'title', 'content', 'createdAt', 'updatedAt'];
  const AUTO_BACKUP_FREQUENCY_KEY = 'jeff-va-auto-backup-frequency-v1';
  const AUTO_BACKUP_LAST_RUN_KEY = 'jeff-va-auto-backup-last-run-v1';
  const DOCUMENTS_BACKUP_ENDPOINT = '/api/automatic-backup';
  const DOCUMENTS_BACKUP_NAME = 'Jeff VA Backup.xlsx';
  const DOCUMENTS_BACKUP_LAST_SAVED_KEY = 'jeff-va-documents-backup-saved-at-v1';
  let automaticBackupTimer = null;
  let documentsBackupTimer = null;
  let documentsBackupInFlight = false;
  let documentsBackupQueued = false;
  let documentsBackupUnavailable = false;

  function applicationToRow(item) {
    const row = {};
    APPLICATION_COLUMNS.forEach(key => {
      row[key] = key === 'documents' ? JSON.stringify(item.documents || []) : (item[key] ?? '');
    });
    return row;
  }

  function dailyTaskToRow(task) {
    return { ...task, checklist: JSON.stringify(task.checklist || []) };
  }

  function rowToDailyTask(row) {
    let checklist = [];
    try { checklist = row.checklist ? JSON.parse(row.checklist) : []; } catch { checklist = []; }
    return { ...row, checklist: Array.isArray(checklist) ? checklist : [] };
  }

  function createDataSheet(records, columns, widths = {}) {
    const sheet = XLSX.utils.json_to_sheet(records || [], { header: columns });
    sheet['!cols'] = columns.map(column => ({ wch: widths[column] || (column === 'content' || column === 'notes' ? 48 : column.length + 4) }));
    return sheet;
  }

  function rowToApplication(row) {
    let documents = [];
    try { documents = row.documents ? JSON.parse(row.documents) : []; } catch { documents = []; }
    return {
      id: String(row.id || uid()),
      clientName: String(row.clientName || ''),
      status: String(row.status || 'Applied'),
      platform: String(row.platform || ''),
      employmentType: String(row.employmentType || ''),
      salaryType: String(row.salaryType || ''),
      salaryAmount: row.salaryAmount === '' || row.salaryAmount === null || row.salaryAmount === undefined ? '' : Number(row.salaryAmount),
      hoursPerWeek: row.hoursPerWeek === '' || row.hoursPerWeek === null || row.hoursPerWeek === undefined ? '' : Number(row.hoursPerWeek),
      contact: String(row.contact || ''),
      role: String(row.role || ''),
      appliedDate: String(row.appliedDate || ''),
      followUpDate: String(row.followUpDate || ''),
      automaticFollowUp: String(row.automaticFollowUp).toLowerCase() === 'true',
      followUpProcessedAt: String(row.followUpProcessedAt || ''),
      followUpSentAt: String(row.followUpSentAt || ''),
      activePendingDocument: String(row.activePendingDocument).toLowerCase() === 'true',
      activePendingEmail: String(row.activePendingEmail).toLowerCase() === 'true',
      documentEmailPending: String(row.documentEmailPending).toLowerCase() === 'true',
      documentEmailReminderDate: String(row.documentEmailReminderDate || ''),
      documentEmailReminderAlertedDate: String(row.documentEmailReminderAlertedDate || ''),
      contractEndedEmailSentAt: String(row.contractEndedEmailSentAt || ''),
      interviewPriority: String(row.interviewPriority).toLowerCase() === 'true',
      interviewDate: String(row.interviewDate || ''),
      interviewLink: String(row.interviewLink || ''),
      interviewAlertDate: String(row.interviewAlertDate || ''),
      notes: String(row.notes || ''),
      email: String(row.email || ''),
      phone: String(row.phone || ''),
      website: String(row.website || ''),
      socialMedia: String(row.socialMedia || ''),
      location: String(row.location || ''),
      createdAt: String(row.createdAt || row.updatedAt || new Date().toISOString()),
      activeAt: String(row.activeAt || (row.status === 'Active client' ? row.appliedDate || '' : '')),
      documents,
      updatedAt: String(row.updatedAt || new Date().toISOString())
    };
  }

  function buildBackupWorkbook() {
    const workbook = XLSX.utils.book_new();
    const applicationWidths = { id: 38, clientName: 24, status: 16, contractStatus: 16, contractEndDate: 16, contractEndedEmailSentAt: 24, platform: 18, employmentType: 16, salaryType: 16, salaryAmount: 18, hoursPerWeek: 18, contact: 22, role: 24, appliedDate: 16, createdAt: 24, activeAt: 24, activePendingDocument: 20, activePendingEmail: 18, documentEmailPending: 20, documentEmailReminderDate: 20, documentEmailReminderAlertedDate: 24, interviewPriority: 18, interviewDate: 16, interviewLink: 36, interviewAlertDate: 24, followUpDate: 16, automaticFollowUp: 18, followUpProcessedAt: 24, followUpSentAt: 24, notes: 48, email: 30, phone: 18, website: 32, socialMedia: 24, location: 24, documents: 48, updatedAt: 24 };
    const applicationsSheet = createDataSheet(pipelineApplications().map(applicationToRow), APPLICATION_COLUMNS, applicationWidths);
    const activeClientsSheet = createDataSheet(hiredClients().map(applicationToRow), APPLICATION_COLUMNS, applicationWidths);
    const invoiceColumns = ['id', 'clientId', 'invoiceNumber', 'issueDate', 'billingPeriod', 'dueDate', 'service', 'startDate', 'endDate', 'fileName', 'sentAt'];
    XLSX.utils.book_append_sheet(workbook, applicationsSheet, 'Applications');
    XLSX.utils.book_append_sheet(workbook, activeClientsSheet, 'Active clients');
    XLSX.utils.book_append_sheet(workbook, createDataSheet(data.invoices || [], invoiceColumns, { id: 38, clientId: 38, invoiceNumber: 18, issueDate: 18, billingPeriod: 24, dueDate: 18, service: 34, startDate: 16, endDate: 16, fileName: 34, sentAt: 24 }), 'Invoices');
    XLSX.utils.book_append_sheet(workbook, createDataSheet(data.toApply || [], TO_APPLY_COLUMNS, { id: 38, title: 28, link: 48, dueDate: 16, notes: 48 }), 'To apply');
    XLSX.utils.book_append_sheet(workbook, createDataSheet((data.dailyTasks || []).map(dailyTaskToRow), DAILY_TASK_COLUMNS, { id: 38, title: 40, type: 18, taskDate: 16, relatedType: 18, relatedId: 38, relatedName: 28, destination: 40, notes: 60, checklist: 60, createdAt: 24, completedAt: 24 }), 'Daily tasks');
    XLSX.utils.book_append_sheet(workbook, createDataSheet(data.workLinks || [], LINK_COLUMNS, { id: 38, name: 28, url: 55, createdAt: 24, updatedAt: 24 }), 'Links');
    XLSX.utils.book_append_sheet(workbook, createDataSheet(data.scripts || [], SCRIPT_COLUMNS, { id: 38, title: 28, content: 70, createdAt: 24, updatedAt: 24 }), 'Scripts');
    return workbook;
  }

  function exportBackup({ automatic = false } = {}) {
    if (!window.XLSX) { if (!automatic) toast('Excel export is still loading, try again in a moment'); return false; }
    const workbook = buildBackupWorkbook();
    XLSX.writeFile(workbook, `${automatic ? 'jeff-va-auto-backup' : 'jeff-va-export'}-${today()}.xlsx`);
    toast(automatic ? 'Automatic Excel backup downloaded' : 'Excel file downloaded');
    return true;
  }

  function canSaveToDocuments() {
    return window.location.protocol.startsWith('http')
      && ['127.0.0.1', 'localhost'].includes(window.location.hostname)
      && Boolean(window.XLSX && currentUser && dataReady && supabaseDataLoaded);
  }

  function documentsBackupTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
  }

  function updateDocumentsBackupNote(message = '') {
    const note = $('#autoBackupNote');
    const status = $('#documentsBackupStatus');
    if (!note) return;
    if (message) {
      note.textContent = message;
      if (status) status.textContent = 'Waiting for the Documents backup server.';
      return;
    }
    if (documentsBackupUnavailable) {
      note.textContent = 'Automatic Documents backup is unavailable. Start Jeff VA with start-jeff-va.bat, then reopen the app.';
      if (status) status.textContent = 'Documents backup could not be saved.';
      return;
    }
    note.textContent = `An updated Excel copy is saved to Documents\\${DOCUMENTS_BACKUP_NAME} when Jeff VA opens and when it closes. Downloaded backups still use your browser Downloads folder.`;
    const lastSavedAt = localStorage.getItem(DOCUMENTS_BACKUP_LAST_SAVED_KEY);
    if (status) status.textContent = lastSavedAt
      ? `Documents backup saved at ${documentsBackupTime(lastSavedAt)}.`
      : 'Preparing the first Documents backup.';
  }

  async function saveBackupToDocuments() {
    documentsBackupTimer = null;
    if (!canSaveToDocuments()) return;
    if (documentsBackupInFlight) {
      documentsBackupQueued = true;
      return;
    }
    documentsBackupInFlight = true;
    documentsBackupQueued = false;
    try {
      const workbook = buildBackupWorkbook();
      const file = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const response = await fetch(DOCUMENTS_BACKUP_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        body: file
      });
      if (!response.ok) throw new Error('The local backup server did not accept the Excel file.');
      const result = await response.json();
      if (!result?.ok || result.file !== DOCUMENTS_BACKUP_NAME) throw new Error('The local backup server returned an unexpected response.');
      documentsBackupUnavailable = false;
      localStorage.setItem(DOCUMENTS_BACKUP_LAST_SAVED_KEY, new Date().toISOString());
      updateDocumentsBackupNote();
    } catch (error) {
      documentsBackupUnavailable = true;
      console.warn('Could not save the automatic Documents backup:', error);
      updateDocumentsBackupNote();
    } finally {
      documentsBackupInFlight = false;
      if (documentsBackupQueued) queueDocumentsBackup({ immediate: true });
    }
  }

  function queueDocumentsBackup({ immediate = false } = {}) {
    if (!canSaveToDocuments()) return;
    if (documentsBackupTimer) clearTimeout(documentsBackupTimer);
    documentsBackupTimer = setTimeout(saveBackupToDocuments, immediate ? 0 : 700);
  }

  function scheduleDocumentsBackup() {
    updateDocumentsBackupNote();
    queueDocumentsBackup();
  }

  function autoBackupPeriodKey(frequency) {
    const currentDate = new Date(`${today()}T12:00:00`);
    if (frequency === 'daily') return today();
    if (frequency !== 'weekly') return '';
    const firstDay = new Date(currentDate.getFullYear(), 0, 1);
    const dayOfYear = Math.floor((currentDate - firstDay) / 86400000);
    return `${currentDate.getFullYear()}-week-${Math.floor((dayOfYear + firstDay.getDay()) / 7)}`;
  }

  function runAutomaticBackup() {
    if (!currentUser || !dataReady || !supabaseDataLoaded) return;
    const frequency = localStorage.getItem(AUTO_BACKUP_FREQUENCY_KEY) || 'off';
    const periodKey = autoBackupPeriodKey(frequency);
    if (!periodKey || localStorage.getItem(AUTO_BACKUP_LAST_RUN_KEY) === `${frequency}:${periodKey}`) return;
    if (exportBackup({ automatic: true })) localStorage.setItem(AUTO_BACKUP_LAST_RUN_KEY, `${frequency}:${periodKey}`);
  }

  function scheduleAutomaticBackup() {
    if (automaticBackupTimer) clearInterval(automaticBackupTimer);
    automaticBackupTimer = setInterval(runAutomaticBackup, 60000);
    runAutomaticBackup();
    scheduleDocumentsBackup();
  }

  window.addEventListener('pagehide', () => queueDocumentsBackup({ immediate: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') queueDocumentsBackup({ immediate: true });
  });

  async function restoreBackup(file) {
    if (!file) return;
    if (!window.XLSX) { toast('Excel restore is still loading, try again in a moment'); return; }
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const applicationsSheet = workbook.Sheets['Applications'];
      const activeClientsSheet = workbook.Sheets['Active clients'];
      if (!applicationsSheet || !activeClientsSheet) throw new Error('invalid');
      const applications = XLSX.utils.sheet_to_json(applicationsSheet, { defval: '' }).map(rowToApplication);
      const activeClients = XLSX.utils.sheet_to_json(activeClientsSheet, { defval: '' }).map(rowToApplication).map(item => ({ ...item, status: 'Active client', activePendingDocument: false }));
      const invoices = workbook.Sheets.Invoices ? XLSX.utils.sheet_to_json(workbook.Sheets.Invoices, { defval: '' }) : data.invoices || [];
      const toApply = workbook.Sheets['To apply'] ? XLSX.utils.sheet_to_json(workbook.Sheets['To apply'], { defval: '' }) : data.toApply || [];
      const dailyTasks = workbook.Sheets['Daily tasks'] ? XLSX.utils.sheet_to_json(workbook.Sheets['Daily tasks'], { defval: '' }).map(rowToDailyTask) : data.dailyTasks || [];
      const workLinks = workbook.Sheets.Links ? XLSX.utils.sheet_to_json(workbook.Sheets.Links, { defval: '' }) : data.workLinks || [];
      const scripts = workbook.Sheets.Scripts ? XLSX.utils.sheet_to_json(workbook.Sheets.Scripts, { defval: '' }) : data.scripts || [];
      const restoredApplications = [...applications, ...activeClients.filter(active => !applications.some(application => application.id === active.id))];
      if (!(await appConfirm(`Replace the current application data with ${applications.length} applications and ${activeClients.length} active clients? Tool data and email history will also be restored.`, { title: 'Replace workspace data', confirmLabel: 'Replace data', danger: true }))) return;
      data = { applications: restoredApplications, toApply, dailyTasks, emails: data.emails, deletedGmailIds: data.deletedGmailIds || [], alerts: [], emailTemplates: data.emailTemplates || [], personalDocuments: data.personalDocuments || [], invoices, scripts, workLinks };
      persist(); renderAll(); toast('Data restored from Excel file');
    } catch {
      toast('That file doesn\'t look like a Jeff VA export');
    } finally { $('#backupInput').value = ''; }
  }

  function toast(message) {
    const target = $('#toast');
    target.textContent = message;
    target.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => target.classList.remove('show'), 2800);
  }


