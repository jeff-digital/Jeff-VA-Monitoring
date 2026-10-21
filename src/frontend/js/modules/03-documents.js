  // --- Active client documents ---
  // Document binaries are stored in the private Supabase Storage bucket; only metadata and
  // the storage path are kept in the user's app_state row. Nothing is stored in IndexedDB.
  const PDFJS_MODULE_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.min.mjs';
  const PDFJS_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.min.mjs';
  const MAX_DOCUMENT_SIZE_BYTES = 25 * 1024 * 1024;
  const DOCUMENT_CONTENT_TYPES = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };
  let pdfjsModulePromise = null;
  let contractEmailUploadClientId = '';
  let contractEmailUploadFile = null;

  function loadPdfJs() {
    if (!pdfjsModulePromise) {
      pdfjsModulePromise = import(PDFJS_MODULE_URL).then(pdfjs => {
        pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        return pdfjs;
      }).catch(error => {
        pdfjsModulePromise = null;
        throw error;
      });
    }
    return pdfjsModulePromise;
  }

  function documentContentType(file) {
    if (Object.values(DOCUMENT_CONTENT_TYPES).includes(file.type)) return file.type;
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    return DOCUMENT_CONTENT_TYPES[extension] || 'application/octet-stream';
  }

  async function saveDocumentBlob(id, file) {
    const client = requireSupabase();
    if (!currentUser) throw new Error('Not signed in');
    if (file.size > MAX_DOCUMENT_SIZE_BYTES) throw new Error('Documents must be 25 MB or smaller.');
    const path = `${currentUser.id}/${id}`;
    const { error } = await client.storage.from(SUPABASE_BUCKET).upload(path, file, {
      upsert: false,
      contentType: documentContentType(file)
    });
    if (error) throw error;
    return path;
  }

  async function getDocumentBlob(idOrPath) {
    const client = requireSupabase();
    if (!currentUser) throw new Error('Not signed in');
    const path = String(idOrPath).includes('/') ? String(idOrPath) : `${currentUser.id}/${idOrPath}`;
    const { data: blob, error } = await client.storage.from(SUPABASE_BUCKET).download(path);
    if (error) throw error;
    return blob;
  }

  async function deleteDocumentBlob(idOrPath) {
    const client = requireSupabase();
    if (!currentUser) return;
    const path = String(idOrPath).includes('/') ? String(idOrPath) : `${currentUser.id}/${idOrPath}`;
    const { error } = await client.storage.from(SUPABASE_BUCKET).remove([path]);
    if (error) throw error;
  }

  function personalDocumentPath(id) {
    return `${currentUser.id}/personal/${id}`;
  }

  function renderPersonalDocuments() {
    const target = $('#personalDocumentList');
    if (!target) return;
    const documents = data.personalDocuments || [];
    $('#uploadDocumentButton').hidden = documents.length === 0;
    target.innerHTML = documents.length ? documents.map(document => {
      const isPdf = /\.pdf$/i.test(document.name) || document.type === 'application/pdf';
      const fileType = isPdf ? 'PDF' : 'Word document';
      return `
        <article class="document-preview-card personal-document-card" data-personal-open="${escapeHtml(document.id)}" tabindex="0" role="button" aria-label="Preview ${escapeHtml(document.name)}">
          <div class="document-preview-head">
            <div class="document-preview-title">
              <span class="doc-type-icon">${fileType === 'PDF' ? 'PDF' : 'DOC'}</span>
              <div><p class="eyebrow">DOCUMENT PREVIEW</p><h3>${escapeHtml(document.name)}</h3><p>${fileType} · ${formatFileSize(document.size)} · Added ${emailDate(document.addedAt)}</p></div>
              <button class="personal-document-delete" type="button" data-personal-delete="${escapeHtml(document.id)}" aria-label="Delete ${escapeHtml(document.name)}" title="Delete document">×</button>
            </div>
          </div>
          <div class="personal-document-thumbnail" aria-hidden="true"><span class="personal-document-file-icon">${fileType === 'PDF' ? 'PDF' : 'DOC'}</span></div>
        </article>`;
    }).join('') : '<div class="personal-document-empty"><span class="personal-document-empty-icon" aria-hidden="true"><i class="fa-solid fa-cloud-arrow-up"></i></span><h3>No personal documents yet</h3><p>Upload a document here when it is for your own records.</p><label class="button button-primary personal-document-empty-upload import-label" for="personalDocumentInput"><i class="fa-solid fa-arrow-up-from-bracket" aria-hidden="true"></i> Upload personal document</label></div>';
  }

  function renderScripts() {
    const target = $('#scriptList');
    if (!target) return;
    const scripts = [...(data.scripts || [])].sort((first, second) => new Date(second.updatedAt || second.createdAt || 0) - new Date(first.updatedAt || first.createdAt || 0));
    target.innerHTML = scripts.length ? scripts.map(script => `
      <article class="script-item" data-script-open="${escapeHtml(script.id)}" tabindex="0" aria-label="Open script: ${escapeHtml(script.title)}">
        <div class="script-item-head"><div><h3>${escapeHtml(script.title)}</h3><small>Updated ${emailDate(script.updatedAt || script.createdAt)}</small></div><div class="script-item-actions"><button class="button button-secondary" type="button" data-script-edit="${escapeHtml(script.id)}">Edit</button><button class="icon-button" type="button" data-script-delete="${escapeHtml(script.id)}" aria-label="Delete ${escapeHtml(script.title)}" title="Delete script">×</button></div></div>
      </article>`).join('') : '<div class="application-empty"><h3>No scripts yet</h3><p>Add a reusable script for outreach, follow-ups, or client communication.</p></div>';
  }

  function openScriptDetails(id) {
    const script = (data.scripts || []).find(item => item.id === id);
    if (!script) return;
    $('#scriptDetailTitle').textContent = script.title;
    $('#scriptDetailUpdated').textContent = `Updated ${emailDate(script.updatedAt || script.createdAt)}`;
    $('#scriptDetailContent').textContent = script.content;
    $('#scriptDetailEdit').dataset.scriptDetailEdit = script.id;
    $('#scriptDetailDialog').showModal();
  }

  function resetScriptForm() {
    const form = $('#scriptForm');
    if (!form) return;
    form.reset();
    $('#scriptId').value = '';
    const dialog = $('#scriptDialog');
    if (dialog && dialog.open) dialog.close();
    form.classList.add('hidden');
  }

  function openScriptForm(id = '') {
    const form = $('#scriptForm');
    const dialog = $('#scriptDialog');
    if (!form || !dialog) return;
    const script = (data.scripts || []).find(item => item.id === id);
    form.reset();
    $('#scriptId').value = script?.id || '';
    $('#scriptTitle').value = script?.title || '';
    $('#scriptContent').value = script?.content || '';
    form.classList.remove('hidden');
    dialog.showModal();
    $('#scriptTitle').focus();
  }

  function saveScript(event) {
    event.preventDefault();
    const form = $('#scriptForm');
    if (!form.reportValidity()) return;
    const id = $('#scriptId').value || uid();
    const now = new Date().toISOString();
    const existingIndex = (data.scripts || []).findIndex(item => item.id === id);
    const script = { id, title: $('#scriptTitle').value.trim(), content: $('#scriptContent').value.trim(), createdAt: existingIndex >= 0 ? data.scripts[existingIndex].createdAt : now, updatedAt: now };
    data.scripts = data.scripts || [];
    if (existingIndex >= 0) data.scripts[existingIndex] = script;
    else data.scripts.unshift(script);
    persist();
    resetScriptForm();
    renderScripts();
    showActionResult({ title: existingIndex >= 0 ? 'Script updated' : 'Script saved', message: existingIndex >= 0 ? 'Your script changes were saved.' : 'The script was added to your tools.' });
  }

  async function deleteScript(id) {
    const script = (data.scripts || []).find(item => item.id === id);
    if (!script || !(await appConfirm(`Delete ${script.title}?`, { title: 'Delete script', confirmLabel: 'Delete', danger: true }))) return;
    data.scripts = data.scripts.filter(item => item.id !== id);
    persist();
    renderScripts();
    showActionResult({ title: 'Script deleted', message: 'The script was removed from your tools.' });
  }

  function renderWorkLinks() {
    const target = $('#workLinkList');
    if (!target) return;
    const links = [...(data.workLinks || [])].sort((first, second) => new Date(second.updatedAt || second.createdAt || 0) - new Date(first.updatedAt || first.createdAt || 0));
    target.innerHTML = links.length ? links.map(link => `
      <article class="work-link-item">
        <div class="work-link-copy"><strong>${escapeHtml(link.name || link.url)}</strong><a href="${escapeHtml(normalizeUrl(link.url))}" target="_blank" rel="noopener">${escapeHtml(link.url)}</a></div>
        <div class="work-link-actions"><button class="button button-secondary" type="button" data-work-link-edit="${escapeHtml(link.id)}">Edit</button><button class="icon-button" type="button" data-work-link-delete="${escapeHtml(link.id)}" aria-label="Delete ${escapeHtml(link.name || link.url)}" title="Delete softcopy link">×</button></div>
      </article>`).join('') : '<div class="small-empty"><p class="doc-empty">No softcopy links yet. Add a shared document or tool link here.</p></div>';
  }

  function resetWorkLinkForm() {
    const form = $('#workLinkForm');
    if (!form) return;
    $('#workLinkName').value = '';
    $('#workLinkUrl').value = '';
    form.dataset.editingId = '';
    const dialog = $('#workLinkDialog');
    if (dialog && dialog.open) dialog.close();
    form.classList.add('hidden');
  }

  function openWorkLinkForm(id = '') {
    const form = $('#workLinkForm');
    const dialog = $('#workLinkDialog');
    if (!form || !dialog) return;
    const link = (data.workLinks || []).find(item => item.id === id);
    $('#workLinkName').value = '';
    $('#workLinkUrl').value = '';
    form.dataset.editingId = link?.id || '';
    $('#workLinkName').value = link?.name || '';
    $('#workLinkUrl').value = link?.url || '';
    form.classList.remove('hidden');
    dialog.showModal();
    $('#workLinkName').focus();
  }

  function saveWorkLink() {
    const name = $('#workLinkName').value.trim();
    const url = $('#workLinkUrl').value.trim();
    if (!url) { $('#workLinkUrl').focus(); return; }
    try { new URL(url); } catch { $('#workLinkUrl').focus(); toast('Enter a valid link URL'); return; }
    const id = $('#workLinkForm').dataset.editingId || uid();
    const now = new Date().toISOString();
    data.workLinks = data.workLinks || [];
    const existingIndex = data.workLinks.findIndex(item => item.id === id);
    const link = { id, name, url, createdAt: existingIndex >= 0 ? data.workLinks[existingIndex].createdAt : now, updatedAt: now };
    if (existingIndex >= 0) data.workLinks[existingIndex] = link;
    else data.workLinks.unshift(link);
    persist();
    resetWorkLinkForm();
    renderWorkLinks();
    showActionResult({ title: existingIndex >= 0 ? 'Link updated' : 'Link saved', message: existingIndex >= 0 ? 'Your link changes were saved.' : 'The link was added to your tools.' });
  }

  async function deleteWorkLink(id) {
    const link = (data.workLinks || []).find(item => item.id === id);
    if (!link || !(await appConfirm(`Delete ${link.name || link.url}?`, { title: 'Delete softcopy link', confirmLabel: 'Delete', danger: true }))) return;
    data.workLinks = data.workLinks.filter(item => item.id !== id);
    persist();
    renderWorkLinks();
    showActionResult({ title: 'Link deleted', message: 'The link was removed from your tools.' });
  }

  function renderInvoiceList() {
    const target = $('#invoiceList');
    if (!target) return;
    const invoices = [...(data.invoices || [])].sort((first, second) => new Date(second.sentAt) - new Date(first.sentAt));
    target.innerHTML = invoices.length ? invoices.map(invoice => {
      const client = data.applications.find(application => application.id === invoice.clientId);
      const dueDate = parseInvoiceDate(invoice.dueDate);
      return `<article class="invoice-email-row">
        <span class="invoice-email-icon">PDF</span>
        <div class="invoice-email-main"><strong>${escapeHtml(invoice.invoiceNumber || '')}</strong><span>${escapeHtml(client?.clientName || 'Client unavailable')}</span></div>
        <div class="invoice-email-subject"><strong>${escapeHtml(invoice.fileName || 'Invoice')}</strong><span>${escapeHtml(invoice.service || 'Invoice')}</span></div>
        <div class="invoice-email-meta"><strong>${emailDate(invoice.sentAt)}</strong><span>Sent invoice${dueDate ? ` · Due ${escapeHtml(formatDate(dueDate))}` : ''}</span></div>
      </article>`;
    }).join('') : '<div class="application-empty"><h3>No invoices sent yet</h3><p>Invoices sent from an active client will appear here.</p></div>';
  }

  async function uploadPersonalDocument(file) {
    if (!file) return;
    if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
      toast('Documents must be 25 MB or smaller.');
      return null;
    }
    if (!/\.(pdf|doc|docx)$/i.test(file.name)) {
      toast('Please choose a PDF or Word document.');
      return;
    }
    try {
      const documentId = uid();
      const storagePath = personalDocumentPath(documentId);
      const client = requireSupabase();
      const { error } = await client.storage.from(SUPABASE_BUCKET).upload(storagePath, file, {
        upsert: false,
        contentType: documentContentType(file)
      });
      if (error) throw error;
      data.personalDocuments = data.personalDocuments || [];
      const record = { id: documentId, storagePath, name: file.name, type: file.type, size: file.size, addedAt: new Date().toISOString() };
      data.personalDocuments.unshift(record);
      persist();
      renderAll();
      showActionResult({ title: 'Document uploaded', message: 'Your personal document was saved to Supabase.' });
      return record;
    } catch (error) {
      console.error(error);
      showActionResult({ title: 'Document upload failed', message: `Could not upload ${file.name}. Check your connection and try again.`, status: 'error' });
      return null;
    }
  }

  function renderClientDocumentPicker() {
    const target = $('#clientDocumentPickerList');
    if (!target) return;
    const documents = data.personalDocuments || [];
    target.innerHTML = documents.length ? documents.map(document => `
      <button class="client-document-picker-item" type="button" data-client-document-attach="${escapeHtml(document.id)}">
        <span><strong>${escapeHtml(document.name)}</strong><small>${formatFileSize(document.size)} · Added ${emailDate(document.addedAt)}</small></span><span>Use file</span>
      </button>`).join('') : '<p class="doc-empty">No saved documents yet. Upload a new document below.</p>';
  }

  function extractInvoiceField(content, labelPattern, maxLength, dateField = false) {
    if (!content) return '';
    const labels = '(?:Invoice\\s*(?:Number|No\\.?|#)|Date\\s+of\\s+Issue|Billing\\s+Period|Due\\s+Date)';
    const matches = content.matchAll(new RegExp(`${labelPattern}\\s*[:#-]?\\s*(.*?)(?=\\s+${labels}\\s*[:#-]?|$)`, 'gi'));
    for (const match of matches) {
      if (/[\[\]]/.test(match[1] || '')) continue;
      const candidate = (match[1] || '').replace(/\s+/g, ' ').trim();
      if (!candidate || /[\[\]]/.test(candidate)) continue;
      if (dateField) {
        const dates = candidate.match(/\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4})\b/gi) || [];
        const validDate = dates.find(value => parseInvoiceDate(value));
        if (validDate) return validDate.slice(0, maxLength);
        continue;
      }
      return candidate.slice(0, maxLength);
    }
    return '';
  }

  function extractInvoiceDetails(content) {
    return {
      invoiceNumber: extractInvoiceField(content, '(?:Invoice\\s*(?:Number|No\\.?|#))', 40),
      issueDate: extractInvoiceField(content, 'Date\\s+of\\s+Issue', 40, true),
      billingPeriod: extractInvoiceField(content, 'Billing\\s+Period', 60),
      dueDate: extractInvoiceField(content, 'Due\\s+Date', 40, true)
    };
  }

  function invoiceAlreadySent(clientId, invoiceNumber) {
    const normalized = String(invoiceNumber || '').trim().toLowerCase();
    return Boolean(normalized && (data.invoices || []).some(invoice => invoice.clientId === clientId && String(invoice.invoiceNumber || '').trim().toLowerCase() === normalized));
  }

  function showInvoiceDuplicateAlert(invoiceNumber) {
    const message = `Invoice ${invoiceNumber} was already sent to this client. Choose a different invoice number.`;
    $('#invoiceDuplicateAlertMessage').textContent = message;
    $('#invoiceDuplicateAlertModal').showModal();
  }

  async function extractInvoiceText(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    if (extension === 'pdf') {
      const pdfjs = await loadPdfJs();
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      const pages = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const text = await page.getTextContent();
        pages.push(text.items.map(item => item.str).join(' '));
      }
      return pages.join('\n');
    }
    if (extension === 'docx' && window.mammoth) {
      const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      return result.value || '';
    }
    return '';
  }

  function openInvoiceDocumentPicker(application) {
    if (!application?.email) { toast('Add a client email before sending an invoice.'); return; }
    pendingInvoiceClientId = application.id;
    pendingInvoiceFile = null;
    pendingInvoiceDetails = {};
    $('#invoiceNumber').value = '';
    $('#invoiceIssueDate').value = '';
    $('#invoiceBillingPeriod').value = '';
    $('#invoiceDueDate').value = '';
    $('#invoiceService').value = application.role || '';
    $('#invoiceStartDate').value = '';
    $('#invoiceEndDate').value = '';
    $('#invoiceDocumentPickerStatus').textContent = 'Choose an invoice file. Its invoice details will be read from the document.';
    $('#useInvoiceFileButton').disabled = true;
    $('#invoiceDocumentPickerModal').showModal();
  }

  async function stageInvoiceFile(file) {
    if (!file) return;
    if (!/\.(pdf|doc|docx)$/i.test(file.name)) {
      $('#invoiceDocumentPickerStatus').textContent = 'Please choose a PDF or Word invoice.';
      return;
    }
    pendingInvoiceFile = file;
    $('#useInvoiceFileButton').disabled = true;
    $('#invoiceDocumentPickerStatus').textContent = 'Reading invoice content...';
    try {
      const content = await extractInvoiceText(file);
      if (pendingInvoiceFile !== file) return;
      pendingInvoiceDetails = extractInvoiceDetails(content);
      $('#invoiceNumber').value = pendingInvoiceDetails.invoiceNumber;
      $('#invoiceIssueDate').value = pendingInvoiceDetails.issueDate;
      $('#invoiceBillingPeriod').value = pendingInvoiceDetails.billingPeriod;
      $('#invoiceDueDate').value = pendingInvoiceDetails.dueDate;
      if (invoiceAlreadySent(pendingInvoiceClientId, pendingInvoiceDetails.invoiceNumber)) {
        showInvoiceDuplicateAlert(pendingInvoiceDetails.invoiceNumber);
        $('#invoiceDocumentPickerStatus').textContent = 'Duplicate invoice number detected. Choose a different invoice number.';
      } else {
        $('#invoiceDocumentPickerStatus').textContent = content ? 'Invoice details loaded from the file. Empty fields were left blank.' : 'The file text could not be read. Invoice detail fields were left blank.';
      }
    } catch (error) {
      console.error('Could not read invoice content:', error);
      pendingInvoiceDetails = {};
      $('#invoiceDocumentPickerStatus').textContent = 'Could not read the file content. Invoice detail fields were left blank.';
    }
    $('#useInvoiceFileButton').disabled = false;
  }

  function continueInvoicePicker() {
    const application = data.applications.find(item => item.id === pendingInvoiceClientId);
    if (!application || !pendingInvoiceFile) return;
    const invoiceNumber = $('#invoiceNumber').value.trim();
    const service = $('#invoiceService').value.trim();
    const issueDate = $('#invoiceIssueDate').value.trim();
    const billingPeriod = $('#invoiceBillingPeriod').value.trim();
    const dueDate = $('#invoiceDueDate').value.trim();
    const startDate = $('#invoiceStartDate').value;
    const endDate = $('#invoiceEndDate').value;
    if (!invoiceNumber || !issueDate || !billingPeriod || !dueDate || !service || !startDate || !endDate) {
      $('#invoiceDocumentPickerStatus').textContent = 'Complete every invoice field before continuing.';
      return;
    }
    if (invoiceAlreadySent(application.id, invoiceNumber)) {
      showInvoiceDuplicateAlert(invoiceNumber);
      $('#invoiceDocumentPickerStatus').textContent = 'Duplicate invoice number detected. Choose a different invoice number.';
      return;
    }
    const file = pendingInvoiceFile;
    $('#invoiceDocumentPickerModal').close();
    pendingInvoiceFile = null;
    pendingInvoiceClientId = null;
    openInvoiceComposer(application, file, {
      invoiceNumber,
      issueDate,
      billingPeriod,
      dueDate,
      service,
      startDate,
      endDate
    });
  }

  function openClientDocumentPicker(application) {
    pendingActiveClientId = application.id;
    $('#activationFileInfo').classList.add('hidden');
    $('#activationFileInfo').textContent = '';
    const uploadButton = $('#uploadActivationFileButton');
    const uploadInput = $('#clientPickerUploadInput');
    uploadButton.textContent = '+ Upload contract file';
    uploadButton.setAttribute('for', 'clientPickerUploadInput');
    uploadButton.removeAttribute('aria-disabled');
    uploadButton.classList.remove('is-uploading');
    uploadInput.disabled = false;
    uploadInput.value = '';
    $('#continueActivationEmailButton').disabled = true;
    $('#clientDocumentPickerStatus').textContent = 'Upload the contract, review the file information, then click Next to open the email composer.';
    $('#clientDocumentPickerModal').showModal();
  }

  function beginActivationRollback(applicationId, previousApplication) {
    pendingActivation = {
      applicationId,
      previousApplication: previousApplication ? JSON.parse(JSON.stringify(previousApplication)) : null,
      previousIndex: previousApplication ? data.applications.findIndex(item => item.id === applicationId) : -1,
      storagePath: '',
      documentId: '',
      stage: 'document-selection',
      cancelled: false,
      uploading: false
    };
  }

  async function rollbackActivation() {
    const transaction = pendingActivation;
    if (!transaction) return;
    transaction.cancelled = true;
    pendingActivation = null;
    pendingActiveClientId = null;
    editingId = null;
    if (transaction.storagePath) {
      try { await deleteDocumentBlob(transaction.storagePath); } catch (error) { console.error(error); }
    }
    if (transaction.previousApplication) {
      const index = data.applications.findIndex(item => item.id === transaction.applicationId);
      if (index >= 0) data.applications[index] = transaction.previousApplication;
      else data.applications.splice(Math.max(0, transaction.previousIndex), 0, transaction.previousApplication);
    } else {
      data.applications = data.applications.filter(item => item.id !== transaction.applicationId);
    }
    persist();
    renderAll();
    showView('applications');
    showActionResult({ title: 'Activation cancelled', message: 'The application was restored and the staged document was removed.' });
  }

  function clearActivationRollback() {
    pendingActivation = null;
    pendingActiveClientId = null;
  }

  function continueActivationEmail() {
    const transaction = pendingActivation;
    const application = data.applications.find(item => item.id === pendingActiveClientId);
    const selectedDocument = application?.documents?.find(document => document.id === transaction?.documentId);
    if (!transaction || transaction.stage !== 'document-selection' || transaction.uploading || !selectedDocument) {
      $('#clientDocumentPickerStatus').textContent = 'Choose a contract file and wait for it to finish uploading before continuing.';
      return;
    }
    transaction.stage = 'email';
    $('#clientDocumentPickerModal').close();
    pendingActiveClientId = null;
    openClientEmailComposer(application);
  }

  async function uploadActivationDocument(file) {
    if (!file) return;
    if (!/\.(pdf|doc|docx)$/i.test(file.name)) {
      $('#clientDocumentPickerStatus').textContent = 'Please choose a PDF or Word document.';
      return;
    }
    const transaction = pendingActivation;
    if (!transaction || transaction.stage !== 'document-selection' || transaction.uploading) return;
    const applicationId = pendingActiveClientId;
    const application = data.applications.find(item => item.id === applicationId);
    if (!application || transaction.applicationId !== applicationId) return;
    const uploadButton = $('#uploadActivationFileButton');
    const uploadInput = $('#clientPickerUploadInput');
    transaction.uploading = true;
    uploadButton.textContent = 'Uploading contract…';
    uploadButton.removeAttribute('for');
    uploadButton.setAttribute('aria-disabled', 'true');
    uploadButton.classList.add('is-uploading');
    uploadInput.disabled = true;
    $('#continueActivationEmailButton').disabled = true;
    $('#clientDocumentPickerStatus').textContent = 'Uploading the contract file…';
    try {
      const documentId = uid();
      const storagePath = await saveDocumentBlob(documentId, file);
      // The picker can be cancelled while the browser is still uploading. Do not
      // leave an orphaned blob or re-apply a cancelled activation in that case.
      if (pendingActivation !== transaction || transaction.cancelled) {
        await deleteDocumentBlob(storagePath);
        return;
      }
      const currentApplication = data.applications.find(item => item.id === applicationId);
      if (!currentApplication) {
        await deleteDocumentBlob(storagePath);
        return;
      }
      currentApplication.documents = [...(currentApplication.documents || []), {
        id: documentId,
        storagePath,
        name: file.name,
        type: file.type,
        size: file.size,
        addedAt: new Date().toISOString()
      }];
      currentApplication.activePendingDocument = false;
      currentApplication.activePendingEmail = true;
      currentApplication.updatedAt = new Date().toISOString();
      transaction.storagePath = storagePath;
      transaction.documentId = documentId;
      transaction.uploading = false;
      persist();
      $('#activationFileInfo').textContent = `${file.name} · ${formatFileSize(file.size)} · Ready to email`;
      $('#activationFileInfo').classList.remove('hidden');
      uploadButton.textContent = file.name;
      uploadButton.classList.remove('is-uploading');
      $('#continueActivationEmailButton').disabled = false;
      $('#clientDocumentPickerStatus').textContent = 'File attached. Click Next to review the activation email.';
      renderAll();
    } catch (error) {
      console.error(error);
      if (pendingActivation === transaction && !transaction.cancelled) {
        transaction.uploading = false;
        uploadButton.textContent = '+ Upload contract file';
        uploadButton.setAttribute('for', 'clientPickerUploadInput');
        uploadButton.removeAttribute('aria-disabled');
        uploadButton.classList.remove('is-uploading');
        uploadInput.disabled = false;
      }
      $('#clientDocumentPickerStatus').textContent = 'Could not upload the contract file. Please try again.';
    }
  }

  async function attachPersonalDocumentToClient(documentId) {
    const application = data.applications.find(item => item.id === pendingActiveClientId);
    const fileRecord = (data.personalDocuments || []).find(item => item.id === documentId);
    const transaction = pendingActivation;
    if (!application || !fileRecord || !transaction || transaction.stage !== 'document-selection') return;
    try {
      const documentIdForClient = uid();
      const blob = await getDocumentBlob(fileRecord.storagePath);
      const storagePath = await saveDocumentBlob(documentIdForClient, blob);
      if (pendingActivation !== transaction || transaction.cancelled) {
        await deleteDocumentBlob(storagePath);
        return;
      }
      application.documents = [...(application.documents || []), { ...fileRecord, id: documentIdForClient, storagePath, addedAt: new Date().toISOString() }];
      transaction.storagePath = storagePath;
      transaction.documentId = documentIdForClient;
    } catch (error) {
      console.error(error);
      $('#clientDocumentPickerStatus').textContent = 'Could not copy that document to the client.';
      return;
    }
    application.activePendingDocument = false;
    application.activePendingEmail = true;
    application.updatedAt = new Date().toISOString();
    persist();
    transaction.stage = 'email';
    $('#clientDocumentPickerModal').close();
    pendingActiveClientId = null;
    renderAll();
    openClientEmailComposer(application);
    showActionResult({ title: 'Document attached', message: 'The contract was attached. Send the client email to finish activation.' });
  }

  function showDocumentViewer(fileRecord, blob) {
    const url = URL.createObjectURL(blob);
    const modal = $('#documentViewerModal');
    const frame = $('#documentViewerFrame');
    const title = $('#documentViewerTitle');
    const note = $('#documentViewerNote');
    const openButton = $('#documentViewerOpen');
    if (!modal || !frame) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    title.textContent = fileRecord.name || 'Document viewer';
    openButton.href = url;
    openButton.download = fileRecord.name || 'document';
    if (/\.pdf$/i.test(fileRecord.name || '') || blob.type === 'application/pdf') {
      frame.classList.remove('document-word-placeholder');
      frame.src = url;
      frame.style.display = 'block';
      note.textContent = 'PDF preview';
    } else {
      frame.src = 'about:blank';
      frame.style.display = 'block';
      frame.classList.add('document-word-placeholder');
      frame.srcdoc = `<div style="font-family:Arial,sans-serif;padding:40px;color:#333"><div style="font-size:42px">DOC</div><h2>${escapeHtml(fileRecord.name || 'Word document')}</h2><p>Word files are stored securely in your account. Use “Open / download” to view the original file.</p></div>`;
      note.textContent = 'Word document preview';
    }
    modal.showModal();
    modal.addEventListener('close', () => URL.revokeObjectURL(url), { once: true });
  }

  async function openPersonalDocument(documentId) {
    const fileRecord = (data.personalDocuments || []).find(item => item.id === documentId);
    if (!fileRecord) return;
    try {
      const blob = await getDocumentBlob(fileRecord.storagePath);
      showDocumentViewer(fileRecord, blob);
    } catch (error) {
      console.error(error);
      showActionResult({ title: 'Could not open document', message: 'The personal document could not be downloaded from Supabase.', status: 'error' });
    }
  }

  async function removePersonalDocument(documentId) {
    const fileRecord = (data.personalDocuments || []).find(item => item.id === documentId);
    if (!fileRecord || !(await appConfirm(`Delete ${fileRecord.name}?`, { title: 'Delete personal document', confirmLabel: 'Delete', danger: true }))) return;
    data.personalDocuments = data.personalDocuments.filter(item => item.id !== documentId);
    persist();
    try { await deleteDocumentBlob(fileRecord.storagePath); } catch (error) { console.error(error); }
    renderAll();
    showActionResult({ title: 'Document deleted', message: 'The personal document was removed from Supabase.' });
  }

  function clearPendingDocumentPreview() {
    if (pendingDocumentPreviewUrl) {
      URL.revokeObjectURL(pendingDocumentPreviewUrl);
      pendingDocumentPreviewUrl = null;
    }
    pendingDocumentFile = null;
  }

  function clearContractEmailUploadStage() {
    contractEmailUploadFile = null;
    contractEmailUploadClientId = '';
    $('#contractEmailFileInput').value = '';
    $('#chooseContractEmailFileButton').hidden = false;
    $('#contractEmailSelectedFile').hidden = true;
    $('#contractEmailFileName').textContent = '';
    $('#contractEmailUploadStatus').textContent = '';
    $('#continueContractEmailButton').disabled = true;
  }

  function openContractEmailUploadModal(clientId) {
    const application = data.applications.find(item => item.id === clientId);
    if (!application || isContractEnded(application)) return;
    if (!application.email?.trim()) {
      toast('Add a client email before sending a contract.');
      return;
    }
    clearContractEmailUploadStage();
    contractEmailUploadClientId = application.id;
    $('#contractEmailUploadClientName').textContent = application.clientName || 'Active client';
    $('#contractEmailUploadModal').showModal();
  }

  function renderContractEmailSelectedFile(file) {
    $('#contractEmailFileName').textContent = file.name;
    $('#contractEmailSelectedFile').hidden = false;
    $('#chooseContractEmailFileButton').hidden = true;
    $('#contractEmailUploadStatus').textContent = '';
    $('#continueContractEmailButton').disabled = false;
  }

  function removeContractEmailUploadFile() {
    contractEmailUploadFile = null;
    $('#contractEmailSelectedFile').hidden = true;
    $('#contractEmailFileName').textContent = '';
    $('#chooseContractEmailFileButton').hidden = false;
    $('#contractEmailUploadStatus').textContent = '';
    $('#continueContractEmailButton').disabled = true;
  }

  function stageContractEmailFile(file) {
    if (!file) return;
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const supportedTypes = {
      pdf: ['application/pdf', 'application/x-pdf'],
      doc: ['application/msword', 'application/octet-stream'],
      docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream'],
      xls: ['application/vnd.ms-excel', 'application/msexcel', 'application/xls', 'application/x-excel', 'application/octet-stream'],
      xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream']
    };
    const allowedMimes = supportedTypes[extension];
    const validType = allowedMimes && (!file.type || allowedMimes.includes(file.type.toLowerCase()));
    if (!validType) {
      $('#contractEmailUploadStatus').textContent = 'Please choose a PDF, Word, or Excel document.';
      return;
    }
    if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
      $('#contractEmailUploadStatus').textContent = 'Documents must be 25 MB or smaller.';
      return;
    }
    contractEmailUploadFile = file;
    renderContractEmailSelectedFile(file);
  }

  async function pickContractEmailFile() {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [{ description: 'PDF, Word, or Excel document', accept: {
            'application/pdf': ['.pdf'],
            'application/msword': ['.doc'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
            'application/vnd.ms-excel': ['.xls'],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
          }}]
        });
        stageContractEmailFile(await handle.getFile());
      } catch (error) {
        if (error?.name !== 'AbortError') {
          console.error('Could not open the contract file picker:', error);
          $('#contractEmailUploadStatus').textContent = 'Could not open the file picker. Check browser permissions and try again.';
        }
      }
      return;
    }
    $('#contractEmailFileInput').value = '';
    $('#contractEmailFileInput').click();
  }

  function continueContractEmailUpload() {
    const application = data.applications.find(item => item.id === contractEmailUploadClientId);
    const file = contractEmailUploadFile;
    if (!application || !file) return;
    if (isContractEnded(application)) {
      $('#contractEmailUploadModal').close();
      return;
    }
    const hasEmail = Boolean(application.email?.trim());
    clearContractEmailUploadStage();
    $('#contractEmailUploadModal').close();
    if (!hasEmail) {
      toast('Add a client email before sending a contract.');
      return;
    }
    openContractEmailComposer(application, file);
  }

  $('#contractEmailUploadModal').addEventListener('close', clearContractEmailUploadStage);

  async function saveSentContractFile(application, file) {
    try {
      if (!application || !file) throw new Error('The contract or client could not be found.');
      const id = uid();
      const storagePath = await saveDocumentBlob(id, file);
      application.documents = application.documents || [];
      application.documents.push({
        id,
        storagePath,
        name: file.name,
        type: file.type || documentContentType(file),
        size: file.size,
        addedAt: new Date().toISOString()
      });
      application.updatedAt = new Date().toISOString();
      persist();
      renderAll();
      return true;
    } catch (error) {
      console.error('Email sent, but the contract file could not be saved to the client:', error);
      toast('Email sent, but the file could not be saved to the client. You can upload it again.');
      return false;
    }
  }

  function renderPendingDocumentPreview(item) {
    const workspace = $('#hiredDocumentWorkspace');
    if (!workspace || !pendingDocumentFile) return;
    const file = pendingDocumentFile;
    const openEmailAfterSave = Boolean(item && !item.activePendingEmail && item.email?.trim() && !isContractEnded(item));
    pendingDocumentPreviewUrl = URL.createObjectURL(file);
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    workspace.innerHTML = `
      <div class="document-preview-card document-pending-card">
        <div class="document-preview-head">
          <div class="document-preview-title">
            <span class="doc-type-icon">${isPdf ? 'PDF' : 'DOC'}</span>
            <div><p class="eyebrow">READY TO SAVE</p><h3>${escapeHtml(file.name)}</h3><p>${formatFileSize(file.size)} · Selected just now</p></div>
          </div>
          <div class="document-preview-actions">
            <button class="button button-secondary" type="button" id="cancelPendingDocument">Cancel</button>
            <button class="button button-primary" type="button" id="savePendingDocument">${openEmailAfterSave ? 'Save &amp; send email' : 'Save file'}</button>
          </div>
        </div>
        <div class="document-inline-viewer" id="pendingInlineDocumentViewer">
          ${isPdf
            ? `<iframe src="${pendingDocumentPreviewUrl}" title="Preview of ${escapeHtml(file.name)}"></iframe>`
            : `<div class="word-preview"><div class="word-preview-icon">DOC</div><h4>${escapeHtml(file.name)}</h4><p>Your Word file is selected and ready to save. The browser cannot render .doc/.docx directly here, but you can open it after saving.</p></div>`}
        </div>
        <p class="doc-note save-file-note">${openEmailAfterSave ? 'Choose <strong>Save &amp; send email</strong> to attach this file and open the email to your client.' : 'Choose <strong>Save file</strong> to attach it to this client. It&#39;s stored securely in your account and ready to preview anytime.'}</p>
      </div>`;
  }

  function renderHiredDocumentWorkspace(item) {
    const workspace = $('#hiredDocumentWorkspace');
    if (!workspace) return;
    if (pendingDocumentFile && hiredEditingId === item.id) {
      renderPendingDocumentPreview(item);
      return;
    }
    const docs = item.documents || [];
    const latest = docs.length ? docs[docs.length - 1] : null;
    const oldest = docs.length ? docs[0] : null;
    if (!latest) {
      workspace.innerHTML = `
        <div class="upload-empty-state">
          <div>
            <p class="eyebrow">NEXT STEP REQUIRED</p>
            <h3>Upload a client document</h3>
            <p>This client is active, but the workflow is not complete until you attach a PDF or Word document.</p>
          </div>
          <span class="doc-empty">Choose Send contract email from Actions to attach the first document.</span>
        </div>`;
      return;
    }

    const documentRow = (doc, options = {}) => `
      <div class="active-document-row ${options.type || 'other-version-row'} ${options.highlight ? 'version-highlight' : ''}">
        <span class="doc-type-icon">${/\.pdf$/i.test(doc.name) ? 'PDF' : 'DOC'}</span>
        <div class="active-document-name"><strong>${escapeHtml(doc.name)}</strong><small>${/\.pdf$/i.test(doc.name) ? 'PDF' : 'Word document'}</small></div>
        ${item.contractEndDate && dateKey(item.contractEndDate) < today() ? '' : `<div class="document-row-menu">
          <button class="icon-button document-menu-button" type="button" aria-label="Document actions" aria-haspopup="true" aria-expanded="false"><i class="fa-solid fa-ellipsis-vertical" aria-hidden="true"></i></button>
          <div class="document-menu hidden">
            <button type="button" data-doc-open="${escapeHtml(doc.id)}">View File</button>
              <button type="button" class="document-menu-danger" data-doc-remove="${escapeHtml(doc.id)}">Delete File</button>
          </div>
        </div>`}
      </div>`;

    const newestVersionMarkup = documentRow(latest, { type: 'newest-version-row', highlight: true });
    const oldestVersionMarkup = oldest && oldest.id !== latest.id ? documentRow(oldest, { type: 'oldest-version-row' }) : '';
    const archiveItems = docs.slice().reverse();

    workspace.innerHTML = `
      <div class="document-version-section newest-version-section">
        <div class="document-version-label">Newest version</div>
        <div class="active-document-list">${newestVersionMarkup}</div>
        ${item.documentEmailPending && !(item.contractEndDate && dateKey(item.contractEndDate) < today()) ? renderDocumentUpdateAction(item) : ''}
      </div>
      ${oldestVersionMarkup ? `
      <div class="document-version-section oldest-version-section">
        <div class="document-version-label">Oldest version</div>
        <div class="active-document-list">${oldestVersionMarkup}</div>
      </div>` : ''}
      ${archiveItems.length ? `
      <div class="document-archive">
        <div class="document-archive-head"><span class="eyebrow">FULL FILE RECORD</span><span>${plural(docs.length, 'file')} saved</span></div>
        <div class="document-archive-list">
          ${archiveItems.map(doc => `
            <div class="document-archive-item">
              <button type="button" class="document-archive-name" data-doc-open="${escapeHtml(doc.id)}">
                <span class="doc-type-icon">${/\.pdf$/i.test(doc.name) ? 'PDF' : 'DOC'}</span>
                <span class="document-archive-meta"><span class="document-archive-filename">COA | ${escapeHtml(formatDate(doc.addedAt.slice(0, 10)))}</span><span class="document-archive-date">${formatFileSize(doc.size)}</span></span>
              </button>
              <button type="button" class="doc-remove archive-delete-button" data-doc-remove="${escapeHtml(doc.id)}" aria-label="Delete ${escapeHtml(doc.name)} from the archive" title="Delete file">Delete file</button>
            </div>`).join('')}
        </div>
      </div>` : ''}`;
  }

  function renderDocumentUpdateAction(item) {
    const reminderDate = dateKey(item.documentEmailReminderDate);
    if (reminderDate && reminderDate > today()) {
      return `<div class="document-update-prompt document-update-scheduled"><div><strong>Email reminder scheduled</strong><span>${escapeHtml(formatDate(reminderDate))}</span></div><button class="button button-secondary" type="button" id="changeDocumentEmailReminder">Change date</button></div>`;
    }
    return `<div class="document-update-prompt"><div><strong>Updated file saved</strong><span>Send the latest version to this client.</span></div><div class="document-update-actions"><button class="button button-primary" type="button" id="sendUpdatedDocumentEmail">Send updated version</button><button class="button button-secondary" type="button" id="dismissUpdatedDocumentEmail">Send later</button></div></div>`;
  }

  async function renderInlineDocumentPreview(doc) {
    const target = $('#inlineDocumentViewer');
    if (!target || !doc) return;
    try {
      const blob = await getDocumentBlob(doc.id);
      if (!blob) { target.innerHTML = '<div class="document-loading">Preview unavailable. Use “View file” to open the saved copy.</div>'; return; }
      const url = URL.createObjectURL(blob);
      if (/\.pdf$/i.test(doc.name) || blob.type === 'application/pdf') {
        target.innerHTML = `<iframe src="${url}" title="PDF preview for ${escapeHtml(doc.name)}"></iframe>`;
      } else {
        target.innerHTML = `<div class="word-preview"><div class="word-preview-icon">DOC</div><h4>${escapeHtml(doc.name)}</h4><p>Word preview is not rendered directly by the browser. Use “Open Word file” to view the saved document.</p><button class="button button-primary" type="button" data-doc-open="${escapeHtml(doc.id)}">Open Word file</button></div>`;
      }
    } catch { target.innerHTML = '<div class="document-loading">Could not load the document preview.</div>'; }
  }

  function renderHiredDocuments(item, targetSelector = '#hiredDetailDocumentList') {
    const list = $(targetSelector);
    if (!list) return;
    const docs = item.documents || [];
    list.innerHTML = docs.length ? docs.map(doc => `
      <div class="doc-row"><button type="button" class="doc-name" data-doc-open="${escapeHtml(doc.id)}"><span class="doc-type-icon">${/\.pdf$/i.test(doc.name) ? 'PDF' : 'DOC'}</span><span class="doc-name-text">${escapeHtml(doc.name)}</span></button><span class="doc-size">${formatFileSize(doc.size)}</span><button type="button" class="doc-remove" data-doc-remove="${escapeHtml(doc.id)}" aria-label="Remove ${escapeHtml(doc.name)}">×</button></div>
    `).join('') : '<p class="doc-empty">No documents attached yet.</p>';
  }

  function stageHiredDocument(files) {
    const file = [...(files || [])].find(candidate => /\.(pdf|doc|docx)$/i.test(candidate.name) || ['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(candidate.type));
    if (!file) { toast('Please choose a PDF or Word document.'); return; }
    clearPendingDocumentPreview();
    pendingDocumentFile = file;
    renderHiredDocumentWorkspace(data.applications.find(application => application.id === hiredEditingId));
  }

  async function pickHiredDocumentFile() {
    if (!hiredEditingId) return;
    // Prefer the File System Access picker when available. It returns a File directly and
    // avoids the hidden input/form path that can cause a static page to navigate on some browsers.
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [{ description: 'PDF or Word document', accept: {
            'application/pdf': ['.pdf'],
            'application/msword': ['.doc'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx']
          }}]
        });
        const file = await handle.getFile();
        stageHiredDocument([file]);
      } catch (error) {
        if (error?.name !== 'AbortError') showActionResult({ title: 'File picker unavailable', message: 'Could not open the file picker. Check browser permissions and try again.', status: 'error' });
      }
      return;
    }
    const input = $('#hiredDetailDocumentInput');
    if (!input) return;
    input.value = '';
    input.click();
  }

  async function savePendingHiredDocument() {
    const item = data.applications.find(application => application.id === hiredEditingId);
    const file = pendingDocumentFile;
    const saveButton = $('#savePendingDocument');
    const cancelButton = $('#cancelPendingDocument');
    if (!item || !file || isContractEnded(item) || saveButton?.disabled) return;
    if (saveButton) saveButton.disabled = true;
    if (cancelButton) cancelButton.disabled = true;
    const docId = uid();
    try {
      const storagePath = await saveDocumentBlob(docId, file);
      item.documents = item.documents || [];
      item.documents.push({ id: docId, storagePath, name: file.name, type: file.type, size: file.size, addedAt: new Date().toISOString() });
      const activationEmailPending = Boolean(item.activePendingEmail);
      item.activePendingDocument = false;
      if (activationEmailPending) {
        item.documentEmailPending = false;
        item.documentEmailReminderDate = '';
        item.documentEmailReminderAlertedDate = '';
      }
      item.updatedAt = new Date().toISOString();
      await persist();
      clearPendingDocumentPreview();
      renderAll();
      if (activationEmailPending) openClientEmailComposer(item);
      else if (item.email?.trim()) openUpdatedDocumentEmailComposer(item, docId);
      const status = $('#documentsFolderStatus');
      if (status) status.textContent = 'Saved — ready to preview anytime.';
      if (activationEmailPending) {
        showActionResult({ title: 'Document saved', message: 'The file was saved. Send the client email to finish activation.' });
      } else if (item.email?.trim()) {
        showActionResult({ title: 'Document saved', message: 'Review the email below and send it to your client.' });
      } else {
        toast('Add a client email to send this contract.');
      }
    } catch (error) {
      console.error(error);
      const message = error?.message || 'The secure file store rejected the upload';
      const status = $('#documentsFolderStatus');
      if (status) status.textContent = `Upload failed: ${message}`;
      showActionResult({ title: 'Document save failed', message: `Could not save ${file.name}: ${message}`, status: 'error' });
    } finally {
      if (saveButton) saveButton.disabled = false;
      if (cancelButton) cancelButton.disabled = false;
    }
  }

  async function removeHiredDocument(docId) {
    const item = data.applications.find(application => application.id === hiredEditingId);
    if (!item) return;
    const doc = (item.documents || []).find(document => document.id === docId);
    if (!doc || !(await appConfirm(`Are you sure you want to delete the file "${doc.name}" from ${item.clientName}? This cannot be undone.`, { title: 'Delete client document', confirmLabel: 'Delete', danger: true }))) return;
    item.documents = (item.documents || []).filter(document => document.id !== docId);
    item.activePendingDocument = false;
    item.updatedAt = new Date().toISOString();
    persist();
    try { await deleteDocumentBlob(doc?.storagePath || docId); } catch { /* already gone, ignore */ }
    renderHired();
    renderHiredDetail(item, false);
    showActionResult({ title: 'Document removed', message: 'The client document was removed from Supabase.' });
  }

  async function openDocument(docId) {
    try {
      const doc = (data.applications.flatMap(app => app.documents || [])).find(item => item.id === docId);
      const blob = await getDocumentBlob(doc?.storagePath || docId);
      if (!blob) { showActionResult({ title: 'Document unavailable', message: 'That file could not be found in your account.', status: 'error' }); return; }
      showDocumentViewer(doc || { name: 'Document' }, blob);
    } catch {
      showActionResult({ title: 'Could not open document', message: 'The document could not be downloaded from Supabase.', status: 'error' });
    }
  }

  function alertPortfolioSubmissionEmails(emails) {
    data.alerts = data.alerts || [];
    let added = false;
    (emails || []).forEach(emailItem => {
      if (isSentEmail(emailItem)) return;
      const fromHeader = String(emailItem.from || '');
      const bracketAddress = fromHeader.match(/<([^>]+)>/);
      const senderAddress = (bracketAddress?.[1] || fromHeader.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '').trim().toLowerCase();
      if (senderAddress !== 'submissions@formsubmit.co') return;
      const alertId = `portfolio-submission|${emailItem.gmailId || emailItem.id}`;
      if (data.alerts.some(alert => alert.id === alertId)) return;
      data.alerts.unshift({
        id: alertId,
        clientName: 'Portfolio submission',
        subject: `Portfolio inquiry: ${emailItem.subject || '(No subject)'}`,
        from: fromHeader || 'submissions@formsubmit.co',
        date: emailItem.date || new Date().toISOString(),
        unread: true
      });
      added = true;
    });
    if (added) limitAlertHistory();
    return added;
  }

  function alertNewMatches(newEmails, { showNotice = true, createdTasks = [] } = {}) {
    const matches = [];
    newEmails.forEach(emailItem => {
      if (isSentEmail(emailItem)) return;
      const applications = matchApplicationsForEmail(emailItem);
      applications.forEach(app => matches.push({ emailItem, app }));
    });
    // Retain a durable pending flag until the notification snapshot saves.
    // This recovers mail fetched just before a reload interrupted notification creation.
    const pendingEmails = newEmails.filter(email => email.clientEmailNotificationPending);
    pendingEmails.forEach(email => { email.clientEmailNotificationPending = false; });
    if (!matches.length) {
      if (pendingEmails.length) saveClientEmailNotifications(pendingEmails);
      return false;
    }

    const unique = [];
    const seen = new Set();
    matches.forEach(match => {
      const key = `${match.emailItem.gmailId || match.emailItem.id}|${match.app.id}`;
      if (!seen.has(key) && !data.alerts.some(alert => alert.id === key)) { seen.add(key); unique.push(match); }
    });

    if (!unique.length) {
      if (pendingEmails.length) saveClientEmailNotifications(pendingEmails);
      return false;
    }

    unique.forEach(({ emailItem, app }) => {
      if (isEmailTaskActiveClient(app)) return;
      if (!isInterviewEmail(emailItem)) return;
      const interviewDate = interviewDateFromEmail(emailItem);
      const sameDay = Boolean(interviewDate && app.interviewDate && interviewDate === app.interviewDate);
      app.interviewPriority = true;
      if (interviewDate) app.interviewDate = interviewDate;
      app.interviewSameDay = sameDay;
      app.interviewAlert = sameDay ? 'Interview date confirmed by another client email' : 'Interview requested or scheduled';
    });

    unique.forEach(({ emailItem, app }) => {
      const alertId = `${emailItem.gmailId || emailItem.id}|${app.id}`;
      if (!data.alerts.some(alert => alert.id === alertId)) {
        const activeClient = isEmailTaskActiveClient(app);
        const interview = !activeClient && isInterviewEmail(emailItem);
        const interviewDate = interviewDateFromEmail(emailItem);
        const sameDay = Boolean(app.interviewSameDay);
        data.alerts.unshift({
          id: alertId,
          type: activeClient ? 'active-client-email' : 'application-email',
          applicationId: app.id,
          emailId: emailItem.id,
          taskId: createdTasks.find(task => task.clientId === app.id && task.sourceEmailId === emailItem.id)?.id || '',
          clientName: app.clientName,
          subject: interview ? `${sameDay ? 'Interview date confirmed' : 'Interview with client'}: ${emailItem.subject || '(No subject)'}` : (emailItem.subject || '(No subject)'),
          from: emailItem.from || 'Unknown sender',
          date: emailItem.date || new Date().toISOString(),
          interviewDate: interviewDate || app.interviewDate || '',
          unread: true
        });
      }
    });
    limitAlertHistory();
    saveClientEmailNotifications(pendingEmails);
    renderAlerts();

    if (showNotice) showActionResult({
      title: unique.length === 1 && isEmailTaskActiveClient(unique[0].app)
        ? `${unique[0].app.contact || unique[0].app.clientName || 'Your client'} sent you an email` : 'New client email',
      message: `${plural(unique.length, 'new email')} matched to your applications or active clients.${createdTasks.length ? ` ${plural(createdTasks.length, 'task')} created automatically from work requests.` : ''}`,
      status: 'info',
      label: 'CLIENT EMAIL ALERT',
      actionLabel: 'Open inbox',
      details: unique.map(({ emailItem, app }) => ({
        clientName: app.clientName,
        subject: emailItem.subject || '(No subject)',
        from: emailItem.from || 'Unknown sender',
        date: emailItem.date || '',
        taskCreated: createdTasks.some(task => task.clientId === app.id && task.sourceEmailId === emailItem.id)
      })),
      onAction: () => { showView('inbox'); openEmailDetail(unique[0].emailItem.id); }
    });
    return true;
  }

  function saveClientEmailNotifications(pendingEmails) {
    const workspace = data;
    const restorePending = () => {
      if (data === workspace) pendingEmails.forEach(email => { email.clientEmailNotificationPending = true; });
    };
    Promise.resolve(persist()).then(saved => { if (saved === false) restorePending(); }).catch(restorePending);
  }

  const generatedNotificationTypes = new Set([
    'task-due-today', 'task-overdue', 'client-task-due-today', 'client-task-overdue',
    'contract-ending-30', 'contract-ending-14', 'contract-ending-7', 'contract-ended',
    'wallet-payment-due-soon', 'wallet-payment-due-today', 'wallet-payment-overdue',
    'subscription-due-soon', 'subscription-due-today', 'subscription-expired'
  ]);
  let notificationFilter = 'all';
  let notificationReturnFocus = null;
  let notificationRefreshTimer = null;

  function isGeneratedNotification(alert) {
    return generatedNotificationTypes.has(alert.type);
  }

  function limitAlertHistory() {
    const alerts = Array.isArray(data.alerts) ? data.alerts : [];
    const generated = alerts.filter(isGeneratedNotification);
    const history = alerts.filter(alert => !isGeneratedNotification(alert)).slice(0, Math.max(0, 30 - generated.length));
    data.alerts = [...generated, ...history];
  }

  function notificationDate(date) {
    return new Date(`${date}T12:00:00`).toISOString();
  }

  function notificationRelativeTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value || 'No date';
    const day = dateKey(date);
    const currentDay = today();
    const dayOffset = Math.round((new Date(`${day}T12:00:00`) - new Date(`${currentDay}T12:00:00`)) / 86400000);
    if (dayOffset === 0) return 'Today';
    if (dayOffset === 1) return 'Tomorrow';
    if (dayOffset === -1) return 'Yesterday';
    return dayOffset > 0 ? `In ${dayOffset} days` : `${Math.abs(dayOffset)} days ago`;
  }

  function refreshGeneratedNotifications() {
    if (!dataReady || !supabaseDataLoaded) return false;
    data.alerts = Array.isArray(data.alerts) ? data.alerts : [];
    const existingById = new Map(data.alerts.map(alert => [alert.id, alert]));
    const generated = new Map();
    const add = alert => {
      const previous = existingById.get(alert.id);
      const wasContractEmailUpdated = alert.type === 'contract-ended' && previous?.emailSent !== undefined;
      generated.set(alert.id, {
        ...alert,
        unread: previous ? Boolean(previous.unread) : true,
        dismissedAt: previous?.dismissedAt || '',
        snoozedUntil: previous?.snoozedUntil || '',
        ...(wasContractEmailUpdated ? {
          emailSent: previous.emailSent,
          subject: previous.subject,
          from: previous.from
        } : {})
      });
    };
    const addTaskAlert = (task, { type, entityType, date, clientName = '' }) => {
      const title = task.title || 'Untitled task';
      add({
        id: `${type}|${entityType}:${task.id}|${date}`,
        type,
        taskId: task.id,
        taskDate: date,
        clientId: entityType === 'client-task' ? task.clientId : task.relatedType === 'client' ? task.relatedId : '',
        applicationId: entityType === 'client-task' ? task.clientId : task.relatedType === 'client' ? task.relatedId : '',
        clientName: clientName || task.relatedName || (entityType === 'client-task' ? 'Client task' : 'Task'),
        subject: `${type.endsWith('overdue') ? 'Overdue' : 'Due today'}: ${title}`,
        from: 'Jeff VA reminder',
        date: notificationDate(date),
        urgency: type.endsWith('overdue') ? 'overdue' : 'due-today'
      });
    };
    const todayDate = today();
    (data.dailyTasks || []).forEach(task => {
      if (!task.id || task.completedAt || task.status === 'done' || !task.taskDate) return;
      if (task.taskDate === todayDate) addTaskAlert(task, { type: 'task-due-today', entityType: 'daily-task', date: task.taskDate });
      else if (task.taskDate < todayDate) addTaskAlert(task, { type: 'task-overdue', entityType: 'daily-task', date: task.taskDate });
    });
    (data.clientTasks || []).forEach(task => {
      if (!task.id || task.status === 'done' || task.completedAt || !task.dueDate) return;
      const client = (data.applications || []).find(item => item.id === task.clientId);
      const type = task.dueDate === todayDate ? 'client-task-due-today' : task.dueDate < todayDate ? 'client-task-overdue' : '';
      if (type) addTaskAlert(task, { type, entityType: 'client-task', date: task.dueDate, clientName: client?.clientName || 'Client task' });
    });
    (data.walletEntries || []).forEach(entry => {
      if (!entry.id || entry.type !== 'payable' || !entry.date) return;
      const deadline = dateKey(entry.date);
      if (!deadline) return;
      const daysLeft = Math.round((new Date(`${deadline}T12:00:00`) - new Date(`${todayDate}T12:00:00`)) / 86400000);
      if (daysLeft > 3) return;
      const type = daysLeft < 0 ? 'wallet-payment-overdue' : daysLeft === 0 ? 'wallet-payment-due-today' : 'wallet-payment-due-soon';
      const timing = daysLeft < 0 ? 'overdue' : daysLeft === 0 ? 'due today' : `due in ${plural(daysLeft, 'day')}`;
      add({
        id: `${type}|wallet-entry:${entry.id}|${deadline}`,
        type,
        walletEntryId: entry.id,
        clientName: entry.payee || 'Upcoming payment',
        subject: `Payment ${timing}: ${entry.description || 'Untitled payment'}`,
        from: 'Wallet reminder',
        date: notificationDate(deadline),
        paymentDeadline: deadline,
        urgency: daysLeft < 0 ? 'overdue' : daysLeft === 0 ? 'due-today' : 'ending-soon'
      });
    });
    (data.subscriptions || []).forEach(item => {
      if (!item?.id || item.tracking === 'cancelled') return;
      const expiry = subscriptionDateValue(item.expiryDate);
      const daysLeft = Math.round((expiry - subscriptionDateValue(subscriptionToday())) / 86400000);
      if (!Number.isFinite(daysLeft) || daysLeft > 7) return;
      const type = daysLeft < 0 ? 'subscription-expired' : daysLeft === 0 ? 'subscription-due-today' : 'subscription-due-soon';
      add({ id: `${type}|subscription:${item.id}|${item.expiryDate}`, type, subscriptionId: item.id,
        clientName: item.name || 'Paid account',
        subject: `${item.name || 'Subscription'}: ${daysLeft < 0 ? 'expired' : daysLeft === 0 ? 'expires today' : `expires in ${plural(daysLeft, 'day')}`}`,
        from: 'Subscription reminder', date: notificationDate(item.expiryDate),
        urgency: daysLeft < 0 ? 'overdue' : daysLeft === 0 ? 'due-today' : 'ending-soon' });
    });
    (data.applications || []).forEach(item => {
      if (!item.id || item.status !== 'Active client') return;
      const endDate = dateKey(item.contractEndDate);
      const explicitlyEnded = String(item.contractStatus || '').trim().toLowerCase() === 'contract ended';
      if (explicitlyEnded || endDate && endDate < todayDate) {
        const endedDate = endDate || dateKey(item.updatedAt || item.activeAt || item.createdAt) || todayDate;
        add({
          id: `contract-ended|${item.id}|${endedDate}`,
          type: 'contract-ended',
          applicationId: item.id,
          clientName: item.clientName || 'Client',
          subject: 'Contract ended',
          from: 'Jeff VA reminder',
          date: notificationDate(endedDate),
          contractEndDate: endedDate,
          urgency: 'ended'
        });
        return;
      }
      if (!endDate || String(item.contractStatus || 'Active').trim().toLowerCase() !== 'active') return;
      const daysLeft = Math.round((new Date(`${endDate}T12:00:00`) - new Date(`${todayDate}T12:00:00`)) / 86400000);
      if (daysLeft < 0 || daysLeft > 30) return;
      const threshold = daysLeft <= 7 ? 7 : daysLeft <= 14 ? 14 : 30;
      add({
        id: `contract-ending-${threshold}|${item.id}|${endDate}`,
        type: `contract-ending-${threshold}`,
        applicationId: item.id,
        clientName: item.clientName || 'Client',
        subject: daysLeft ? `Contract ending in ${plural(daysLeft, 'day')}` : 'Contract ends today',
        from: 'Jeff VA reminder',
        date: notificationDate(endDate),
        contractEndDate: endDate,
        urgency: 'ending-soon'
      });
    });

    const existingGenerated = data.alerts.filter(isGeneratedNotification);
    const previousGeneratedIds = new Set(existingGenerated.map(alert => alert.id));
    const generatedIds = new Set(generated.keys());
    const urgentNewCount = [...generated.values()].filter(alert =>
      !previousGeneratedIds.has(alert.id) && ['task-overdue', 'task-due-today', 'client-task-overdue', 'client-task-due-today', 'contract-ending-7', 'contract-ended', 'wallet-payment-overdue', 'wallet-payment-due-today'].includes(alert.type)
    ).length;
    const changed = previousGeneratedIds.size !== generatedIds.size
      || [...previousGeneratedIds].some(id => !generatedIds.has(id))
      || [...generatedIds].some(id => !previousGeneratedIds.has(id))
      || [...generated.values()].some(alert => {
        const existing = existingById.get(alert.id);
        return !existing || Object.keys(alert).some(key => existing[key] !== alert[key]);
      });
    const retainedAlerts = data.alerts.filter(alert => !isGeneratedNotification(alert));
    data.alerts = [...generated.values(), ...retainedAlerts];
    if (changed) {
      data.alerts.sort((first, second) => new Date(second.date) - new Date(first.date));
      persist();
      if (urgentNewCount) {
        const live = $('#notificationLive');
        if (live) live.textContent = `${urgentNewCount} new urgent ${urgentNewCount === 1 ? 'notification' : 'notifications'}.`;
      }
    }
    return changed;
  }

  function visibleNotificationAlerts() {
    const now = Date.now();
    return (data.alerts || []).filter(alert => !alert.dismissedAt && (!alert.snoozedUntil || new Date(alert.snoozedUntil).getTime() <= now));
  }

  function notificationCategory(alert) {
    if (alert.type?.startsWith('task-')) return 'daily-tasks';
    if (alert.type?.startsWith('wallet-payment-') || alert.type?.startsWith('subscription-')) return 'finance';
    if (alert.type === 'to-apply' || alert.id?.startsWith('to-apply|due|')) return 'to-apply';
    if (alert.type?.startsWith('client-task-') || alert.type?.startsWith('contract-') || ['document-email-reminder', 'onboarding-submission', 'active-client-email', 'active-client-email-review'].includes(alert.type)) return 'active-clients';
    const linkedApplication = (data.applications || []).find(item =>
      item.id === alert.applicationId || alert.id?.endsWith(`|${item.id}`)
    );
    return linkedApplication?.status === 'Active client' ? 'active-clients' : 'applications';
  }

  function renderAlerts() {
    refreshGeneratedNotifications();
    const alerts = visibleNotificationAlerts().sort((first, second) => new Date(second.date) - new Date(first.date));
    let unread = 0;
    const unreadByCategory = new Map();
    for (const alert of alerts) {
      if (!alert.unread) continue;
      unread += 1;
      const category = notificationCategory(alert);
      unreadByCategory.set(category, (unreadByCategory.get(category) || 0) + 1);
    }
    const badge = $('#notificationBadge');
    const button = $('#notificationButton');
    if (badge) {
      badge.textContent = unread > 9 ? '9+' : String(unread);
      badge.hidden = unread === 0;
      badge.classList.toggle('is-single', unread === 1);
    }
    if (button) button.setAttribute('aria-label', unread ? `Notifications, ${unread} unread` : 'Notifications');
    updateTabNotification(unread);
    $$('.notification-tabs [role="tab"]').forEach(tab => {
      const filter = tab.dataset.notificationFilter;
      const count = filter === 'all' || filter === 'unread' ? unread : (unreadByCategory.get(filter) || 0);
      const countPill = tab.querySelector('.notification-tab-count');
      if (countPill) {
        countPill.textContent = count > 9 ? '9+' : String(count);
        countPill.hidden = count === 0;
        countPill.classList.toggle('is-single', count === 1);
      }
      tab.classList.toggle('has-unread', count > 0);
      const label = tab.querySelector('.notification-tab-text')?.textContent.trim() || '';
      const accessibleLabel = count ? `${label}, ${count} unread ${count === 1 ? 'notification' : 'notifications'}` : label;
      tab.setAttribute('aria-label', accessibleLabel);
    });
    const list = $('#notificationList');
    if (!list) return;
    const shownAlerts = alerts.filter(alert => {
      if (notificationFilter === 'unread') return alert.unread;
      return notificationFilter === 'all' || notificationCategory(alert) === notificationFilter;
    });
    const groups = [
      { key: 'applications', label: 'Applications' },
      { key: 'active-clients', label: 'Active Clients' },
      { key: 'daily-tasks', label: 'Daily Tasks' },
      { key: 'to-apply', label: 'To Apply' },
      { key: 'finance', label: 'Finance' }
    ].map(group => ({
      label: group.label,
      items: shownAlerts.filter(alert => notificationCategory(alert) === group.key)
    })).filter(group => group.items.length);
    if (!groups.length) {
      const emptyMessages = {
        all: 'No notifications right now. Tasks and client updates will appear here.',
        applications: 'No application notifications right now.',
        'active-clients': 'No active client notifications right now.',
        'daily-tasks': 'No daily task notifications right now.',
        'to-apply': 'No To Apply notifications right now.',
        finance: 'No finance notifications right now.',
        unread: 'You’re all caught up. No unread notifications.'
      };
      list.innerHTML = `<div class="notification-empty">${emptyMessages[notificationFilter]}</div>`;
      return;
    }
    list.innerHTML = groups.map(group => `
      <section class="notification-section" aria-label="${group.label}">
        <h3 class="notification-section-title">${group.label}</h3>
        ${group.items.map(alert => {
          const urgency = alert.urgency || (alert.type === 'contract-ended' ? 'ended' : '');
          return `<article class="notification-item ${alert.unread ? 'unread' : ''}${urgency ? ` is-${escapeHtml(urgency)}` : ''}">
            <span class="notification-item-dot" aria-hidden="true"></span>
            <div class="notification-item-copy">
              <span class="notification-item-heading"><strong>${escapeHtml(alert.clientName || 'Notification')}</strong><time datetime="${escapeHtml(alert.date || '')}">${escapeHtml(notificationRelativeTime(alert.date))}</time></span>
              <button type="button" class="notification-item-subject" data-alert-open="${escapeHtml(alert.id)}">${escapeHtml(alert.subject || '(No subject)')}</button>
              ${alert.from ? `<small>${escapeHtml(alert.from)}</small>` : ''}
              ${['application-email-closed', 'application-email-review'].includes(alert.type) && alert.evidence ? `<small>From the email: ${escapeHtml(alert.evidence)}</small>` : ''}
              ${['application-email-closed', 'application-email-review'].includes(alert.type) && alert.reason ? `<small>AI assessment: ${escapeHtml(alert.reason)}</small>` : ''}
              <div class="notification-item-actions">
                <button type="button" data-alert-action="snooze" data-alert-id="${escapeHtml(alert.id)}" aria-label="Snooze ${escapeHtml(alert.subject || 'notification')} for one day">Snooze</button>
                <button type="button" data-alert-action="dismiss" data-alert-id="${escapeHtml(alert.id)}" aria-label="Dismiss ${escapeHtml(alert.subject || 'notification')}">Dismiss</button>
                <button type="button" data-alert-action="done" data-alert-id="${escapeHtml(alert.id)}">Mark done</button>
              </div>
            </div>
          </article>`;
        }).join('')}
      </section>
    `).join('');
  }

  function closeNotifications({ restoreFocus = false } = {}) {
    const panel = $('#notificationPanel');
    if (!panel || panel.classList.contains('hidden')) return;
    panel.classList.add('hidden');
    $('#notificationButton').setAttribute('aria-expanded', 'false');
    const focusTarget = notificationReturnFocus instanceof HTMLElement && notificationReturnFocus.isConnected
      ? notificationReturnFocus
      : $('#notificationButton');
    notificationReturnFocus = null;
    if (restoreFocus) focusTarget.focus();
  }

  function openNotifications() {
    const panel = $('#notificationPanel');
    const willOpen = panel.classList.contains('hidden');
    if (!willOpen) {
      closeNotifications({ restoreFocus: true });
      return;
    }
    notificationReturnFocus = $('#notificationButton');
    renderAlerts();
    panel.classList.remove('hidden');
    $('#notificationButton').setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => {
      $(`[data-notification-filter="${notificationFilter}"]`)?.focus();
    });
  }

  function setNotificationFilter(filter) {
    notificationFilter = filter;
    const tabs = $$('.notification-tabs [role="tab"]');
    tabs.forEach(tab => {
      const selected = tab.dataset.notificationFilter === filter;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    $('#notificationList').setAttribute('aria-labelledby', $(`[data-notification-filter="${filter}"]`).id);
    renderAlerts();
  }

  function handleNotificationAction(alertId, action) {
    const alert = (data.alerts || []).find(item => item.id === alertId);
    if (!alert) return;
    if (action === 'snooze') alert.snoozedUntil = new Date(Date.now() + 86400000).toISOString();
    else if (action === 'dismiss') alert.dismissedAt = new Date().toISOString();
    else if (action === 'done') {
      if (alert.type?.startsWith('client-task-')) {
        const task = (data.clientTasks || []).find(item => item.id === alert.taskId);
        if (task) {
          task.status = 'done';
          task.completedAt = new Date().toISOString();
          task.updatedAt = task.completedAt;
        }
      } else if (alert.type?.startsWith('task-')) {
        const task = (data.dailyTasks || []).find(item => item.id === alert.taskId);
        if (task) task.completedAt = new Date().toISOString();
      } else {
        alert.unread = false;
        alert.dismissedAt = new Date().toISOString();
      }
    }
    persist();
    renderAll();
    if (!$('#notificationPanel').classList.contains('hidden')) {
      requestAnimationFrame(() => $(`[data-notification-filter="${notificationFilter}"]`)?.focus());
    }
  }

  function handleNotificationKeydown(event) {
    const panel = $('#notificationPanel');
    if (panel.classList.contains('hidden') || document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeNotifications({ restoreFocus: true });
      return;
    }
    if (event.target instanceof HTMLElement && event.target.matches('[role="tab"]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const tabs = $$('.notification-tabs [role="tab"]');
      const currentIndex = tabs.indexOf(event.target);
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (currentIndex + 1) % tabs.length : (currentIndex - 1 + tabs.length) % tabs.length;
      const next = tabs[nextIndex];
      next.focus();
      next.click();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(item => !item.closest('[hidden]') && item.getClientRects().length);
    if (!focusable.length) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('keydown', handleNotificationKeydown);
  window.addEventListener('focus', renderAlerts);

  function startNotificationRefreshTimer() {
    if (!notificationRefreshTimer) {
      notificationRefreshTimer = setInterval(() => {
        if (dataReady && supabaseDataLoaded) {
          renderAlerts();
          if (activeView === 'subscriptions') renderSubscriptions();
        }
      }, 60000);
    }
  }

  function stopNotificationRefreshTimer() {
    if (!notificationRefreshTimer) return;
    clearInterval(notificationRefreshTimer);
    notificationRefreshTimer = null;
  }

  let onboardingAlertsRefreshInFlight = false;
  async function refreshClientOnboardingAlerts() {
    if (!currentUser || !dataReady || !supabaseDataLoaded || onboardingAlertsRefreshInFlight) return;
    const userId = currentUser.id;
    onboardingAlertsRefreshInFlight = true;
    try {
      const { data: submissions, error } = await requireSupabase().rpc('get_client_onboarding_submissions');
      if (error) throw error;
      if (!currentUser || currentUser.id !== userId || !dataReady || !supabaseDataLoaded) return;
      if (!Array.isArray(submissions)) throw new Error('The onboarding notifications response was invalid.');
      submissions.forEach(submission => {
        if (!submission.client_id) return;
        if (submission.timezone) clientTimeZones.set(submission.client_id, submission.timezone);
      });
      updateClientOnlineIndicators();
      data.onboardingSubmissionIds = data.onboardingSubmissionIds || [];
      data.alerts = data.alerts || [];
      const seen = new Set(data.onboardingSubmissionIds);
      let changed = false;
      submissions.forEach(submission => {
        const submissionId = `onboarding|${submission.client_id}|${submission.submitted_at}`;
        if (seen.has(submissionId)) return;
        seen.add(submissionId);
        data.onboardingSubmissionIds.push(submissionId);
        data.alerts.unshift({
          id: submissionId,
          type: 'onboarding-submission',
          applicationId: submission.client_id,
          clientName: submission.client_name || 'Client',
          subject: 'Submitted onboarding form',
          from: submission.client_email || 'Client',
          date: submission.submitted_at,
          unread: true
        });
        changed = true;
      });
      if (changed) {
        limitAlertHistory();
        persist();
        renderAlerts();
      }
    } catch (error) {
      console.error('Could not refresh client onboarding notifications:', error);
    } finally {
      onboardingAlertsRefreshInFlight = false;
    }
  }

  function updateTabNotification(unread) {
    const favicon = $('#tabFavicon');
    if (!favicon) return;
    const baseTitle = 'Jeff VA';
    document.title = unread ? `(${unread > 9 ? '9+' : unread}) ${baseTitle}` : baseTitle;
    if (!unread) {
      favicon.href = 'images/tab.png';
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    context.fillStyle = '#20374c';
    context.beginPath();
    context.arc(32, 32, 30, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#c34f57';
    context.beginPath();
    context.arc(47, 17, 15, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#fff';
    context.font = '700 14px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(unread > 9 ? '9+' : String(unread), 47, 17);
    favicon.href = canvas.toDataURL('image/png');
  }

  function contractDuration(item) {
    const start = item.activeAt || item.appliedDate;
    const end = item.contractEndDate;
    if (!start || !end) return '';
    const startDate = new Date(`${start.slice(0, 10)}T12:00:00`);
    const endDate = new Date(`${end.slice(0, 10)}T12:00:00`);
    const months = Math.max(1, Math.round((endDate - startDate) / (1000 * 60 * 60 * 24 * 30.4375)));
    return `${months} month${months === 1 ? '' : 's'}`;
  }

  async function sendContractEndedEmail(item, alert) {
    if (!gmailAccessToken || !isEmailAddress(item.email) || item.contractEndedEmailSentAt || contractEndedEmailSending.has(item.id)) return;
    contractEndedEmailSending.add(item.id);
    const previousFailureWasReported = alert.emailSent === false;
    const previousAlertState = {
      subject: alert.subject,
      from: alert.from,
      emailSent: alert.emailSent,
      date: alert.date
    };
    const template = buildDocumentEmailTemplate('contract-ended', item, { duration: contractDuration(item) || 'the project period' });
    const subject = template.subject;
    const body = template.body;
    try {
      const rawMessage = buildRawEmailMessage({ to: item.email, subject, body });
      await sendGmailRaw(rawMessage);
      const sentAt = new Date().toISOString();
      item.contractEndedEmailSentAt = sentAt;
      data.emails.unshift({ id: uid(), from: 'You', to: item.email, subject, body, date: sentAt, importedAt: sentAt, source: 'sent', direction: 'sent' });
      alert.subject = 'Contract ended: email sent to client';
      alert.from = 'Jeff VA';
      alert.emailSent = true;
      alert.date = sentAt;
      persist();
      renderAll();
      showActionResult({ title: 'Contract email sent successfully', message: 'The contract-ended email was sent to the client.' });
    } catch (error) {
      console.error('Contract-ended email failed:', error);
      alert.subject = 'Contract ended: email not sent';
      alert.from = 'Sign in with Google to retry';
      alert.emailSent = false;
      const alertChanged = previousAlertState.subject !== alert.subject
        || previousAlertState.from !== alert.from
        || previousAlertState.emailSent !== alert.emailSent
        || previousAlertState.date !== alert.date;
      // perf: avoid persist churn when a retry failure leaves the alert unchanged.
      if (alertChanged) persist();
      renderAlerts();
      if (!previousFailureWasReported) {
        showActionResult({ title: 'Contract email could not be sent', message: 'Sign in with Google again and review the client alert before retrying.', status: 'error' });
      }
    } finally {
      contractEndedEmailSending.delete(item.id);
    }
  }

  function processContractEndedAlerts() {
    const ended = data.applications.filter(item => item.status === 'Active client' && item.contractEndDate && dateKey(item.contractEndDate) < today());
    if (!ended.length) return;
    data.alerts = data.alerts || [];
    let changed = false;
    ended.forEach(item => {
      const alertId = `contract-ended|${item.id}|${dateKey(item.contractEndDate)}`;
      if (data.alerts.some(alert => alert.id === alertId)) return;
      data.alerts.unshift({
        id: alertId,
        type: 'contract-ended',
        applicationId: item.id,
        clientName: item.clientName,
        subject: 'Contract ended',
        from: 'Jeff VA reminder',
        date: new Date().toISOString(),
        contractEndDate: item.contractEndDate,
        unread: true
      });
      changed = true;
    });
    if (changed) {
      limitAlertHistory();
      persist();
      const needsManualEmail = ended.filter(item => !item.contractEndedEmailSentAt && (!gmailAccessToken || !isEmailAddress(item.email))).length;
      if (needsManualEmail) {
        showActionResult({
          title: 'Contract ended',
          message: `${plural(needsManualEmail, 'client')} have an ended contract. Connect Gmail and review the client alert to send the notice.`,
          status: 'info',
          label: 'CLIENT REMINDER',
          actionLabel: 'Open active clients',
          onAction: () => showView('hired')
        });
      }
    }
    ended.forEach(item => {
      const alert = data.alerts.find(candidate => candidate.id === `contract-ended|${item.id}|${dateKey(item.contractEndDate)}`);
      // perf: never auto-retry a recorded failure; only retry when the user intentionally opens the alert again.
      if (alert && alert.emailSent !== false && !item.contractEndedEmailSentAt) sendContractEndedEmail(item, alert);
    });
  }

  function processDueInterviews() {
    const due = data.applications.filter(item => isInterviewToday(item) && item.interviewAlertDate !== today());
    if (!due.length) return;
    data.alerts = data.alerts || [];
    let interviewsDue = 0;
    due.forEach(item => {
      const alertId = `interview|today|${item.id}|${today()}`;
      if (data.alerts.some(alert => alert.id === alertId)) {
        item.interviewAlertDate = today();
        return;
      }
      item.interviewAlertDate = today();
      data.alerts.unshift({
        id: alertId,
        type: 'interview',
        applicationId: item.id,
        clientName: item.clientName,
        subject: 'Interview scheduled for today',
        from: item.interviewLink ? 'Interview meeting' : 'Jeff VA reminder',
        date: new Date().toISOString(),
        interviewDate: item.interviewDate,
        meetingLink: item.interviewLink || '',
        unread: true
      });
      interviewsDue += 1;
    });
    limitAlertHistory();
    persist();
    renderAlerts();
    if (interviewsDue) {
      showActionResult({
        title: 'Interview scheduled today',
        message: `${plural(interviewsDue, 'interview')} are scheduled for today.`,
        status: 'info',
        label: 'INTERVIEW REMINDER',
        actionLabel: 'Open applications',
        onAction: () => showView('applications')
      });
    }
  }

  function processDueDocumentEmailReminders() {
    const due = data.applications.filter(item => item.status === 'Active client'
      && item.documentEmailPending
      && item.documentEmailReminderDate
      && dateKey(item.documentEmailReminderDate) <= today()
      && item.documentEmailReminderAlertedDate !== dateKey(item.documentEmailReminderDate));
    if (!due.length) return;
    data.alerts = data.alerts || [];
    due.forEach(item => {
      const reminderDate = dateKey(item.documentEmailReminderDate);
      const alertId = `document-email|due|${item.id}|${reminderDate}`;
      item.documentEmailReminderAlertedDate = reminderDate;
      item.documentEmailReminderDate = '';
      if (data.alerts.some(alert => alert.id === alertId)) return;
      data.alerts.unshift({ id: alertId, type: 'document-email-reminder', applicationId: item.id, clientName: item.clientName, subject: 'Send the updated document today', from: 'Jeff VA reminder', date: new Date().toISOString(), unread: true });
    });
    limitAlertHistory();
    persist();
    renderAlerts();
    const currentClient = data.applications.find(item => item.id === hiredEditingId);
    if (currentClient) renderHiredDetail(currentClient, false);
    showActionResult({
      title: 'Document reminder due',
      message: `${plural(due.length, 'updated document')} need to be sent today.`,
      status: 'info',
      label: 'DOCUMENT REMINDER',
      actionLabel: 'Open client',
      onAction: () => {
        showView('hired');
        renderHiredDetail(due[0], false);
      }
    });
  }

  async function processDueFollowUps() {
    const due = data.applications.filter(item => item.followUpDate && item.followUpDate <= today() && item.status !== 'Active client' && item.status !== 'Not selected' && (!item.followUpProcessedAt || (item.automaticFollowUp && !item.followUpSentAt && gmailAccessToken)));
    if (!due.length) return;
    data.alerts = data.alerts || [];
    let followUpAlertsAdded = 0;
    let automaticEmailsSent = 0;
    let automaticEmailsFailed = 0;
    let followUpsNeedingReview = 0;
    for (const item of due) {
      const scheduledFollowUpDate = item.followUpDate;
      const template = buildDocumentEmailTemplate('follow-up', item);
      const subject = template.subject;
      const body = template.body;
      let sent = false;
      if (item.automaticFollowUp && gmailAccessToken && isEmailAddress(item.email)) {
        try {
          const rawMessage = buildRawEmailMessage({ to: item.email, subject, body });
          await sendGmailRaw(rawMessage);
          sent = true;
          automaticEmailsSent += 1;
        } catch (error) {
          console.error('Automatic follow-up failed:', error);
          automaticEmailsFailed += 1;
        }
      }
      item.followUpProcessedAt = new Date().toISOString();
      item.followUpSentAt = sent ? item.followUpProcessedAt : '';
      if (sent) {
        item.followUpDate = '';
        item.automaticFollowUp = false;
        if (editingId === item.id) {
          $('#followUpDate').value = '';
          $('#automaticFollowUp').checked = false;
        }
      }
      const alertId = `follow-up|${item.id}|${scheduledFollowUpDate}`;
      const existingAlert = data.alerts.find(alert => alert.id === alertId);
      const followUpAlert = {
        id: alertId,
        clientName: item.clientName,
        subject: sent ? `Automatic follow-up sent: ${subject}` : `Follow-up needed: ${subject}`,
        from: sent ? 'Jeff VA' : 'Jeff VA reminder',
        date: new Date().toISOString(),
        unread: true
      };
      if (existingAlert) Object.assign(existingAlert, followUpAlert);
      else {
        data.alerts.unshift(followUpAlert);
        followUpAlertsAdded += 1;
      }
      if (sent) {
        data.emails.unshift({ id: uid(), applicationId: item.id, emailType: 'follow-up', from: 'You', to: item.email, subject, body, date: new Date().toISOString(), importedAt: new Date().toISOString(), source: 'sent', direction: 'sent' });
      } else if (!item.automaticFollowUp || !gmailAccessToken || !isEmailAddress(item.email)) {
        followUpsNeedingReview += 1;
      }
    }
    limitAlertHistory();
    persist();
    if (automaticEmailsSent && activeView === 'applications') renderApplications();
    if (automaticEmailsSent && activeView === 'dashboard') renderDashboard();
    renderAlerts();
    if (followUpAlertsAdded || automaticEmailsSent) {
      const summary = [
        automaticEmailsSent ? `${plural(automaticEmailsSent, 'automatic follow-up email')} sent` : '',
          automaticEmailsFailed ? `${plural(automaticEmailsFailed, 'automatic follow-up email')} could not be sent; sign in with Google again and review the alert` : '',
        followUpsNeedingReview ? `${plural(followUpsNeedingReview, 'follow-up')} need your attention in Applications` : ''
      ].filter(Boolean).join('. ');
      showActionResult({
        title: automaticEmailsFailed ? 'Follow-ups need attention' : automaticEmailsSent ? 'Automatic follow-ups sent' : 'Follow-ups due',
        message: summary,
        status: automaticEmailsFailed ? 'error' : automaticEmailsSent ? 'success' : 'info',
        label: 'FOLLOW-UP STATUS',
        actionLabel: 'Open applications',
        onAction: () => showView('applications')
      });
    }
  }

  function markAlertsRead() {
    (data.alerts || []).forEach(alert => { alert.unread = false; });
    persist();
    renderAlerts();
  }

  async function clearAlerts() {
    if (!visibleNotificationAlerts().length) return;
    if (!(await appConfirm('Dismiss all visible notifications? This will not delete your tasks or client records.', { title: 'Clear notifications', confirmLabel: 'Clear all', danger: true }))) return;
    const dismissedAt = new Date().toISOString();
    visibleNotificationAlerts().forEach(alert => { alert.dismissedAt = dismissedAt; });
    persist();
    renderAlerts();
  }
