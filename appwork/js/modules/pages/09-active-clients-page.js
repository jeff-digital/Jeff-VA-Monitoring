  // Active Clients page controls, including its document and invoice tools.
  document.addEventListener('click', async event => {
    const deleteActiveButton = event.target.closest('#deleteActiveClient');
    const activeClientActionsButton = event.target.closest('#activeClientActionsButton');
    const editActiveButton = event.target.closest('#editActiveClientButton');
    const closeHiredDetailAction = event.target.closest('#closeHiredDetailAction');
    const sendActiveClientEmailButton = event.target.closest('#sendActiveClientEmailButton');
    const sendClientOnboardingLinkButton = event.target.closest('#sendClientOnboardingLinkButton');
    const sendInvoiceButton = event.target.closest('#sendInvoiceButton');
    const hiredSelectButton = event.target.closest('[data-hired-select]');
    const docOpenButton = event.target.closest('[data-doc-open]');
    const docRemoveButton = event.target.closest('[data-doc-remove]');
    const docEmailButton = event.target.closest('[data-doc-email]');
    const documentMenuButton = event.target.closest('.document-menu-button');

    if (activeClientActionsButton) {
      const menu = activeClientActionsButton.nextElementSibling;
      const willOpen = menu.classList.contains('hidden');
      document.querySelectorAll('.document-menu').forEach(item => item.classList.add('hidden'));
      document.querySelectorAll('[aria-haspopup="true"]').forEach(item => item.setAttribute('aria-expanded', 'false'));
      menu.classList.toggle('hidden', !willOpen);
      activeClientActionsButton.setAttribute('aria-expanded', String(willOpen));
      return;
    }

    if (deleteActiveButton) {
      deleteClient(hiredEditingId, true);
      return;
    }
    if (editActiveButton) {
      openClientModal(hiredEditingId, false, true);
      return;
    }
    if (closeHiredDetailAction) {
      closeHiredDetail();
      return;
    }
    if (sendActiveClientEmailButton) {
      const item = data.applications.find(application => application.id === hiredEditingId);
      if (item) openPlainClientEmailComposer(item);
      return;
    }
    if (sendClientOnboardingLinkButton) {
      const item = data.applications.find(application => application.id === hiredEditingId);
      if (item) await sendClientOnboardingInvite(item, sendClientOnboardingLinkButton);
      return;
    }
    if (sendInvoiceButton) {
      const item = data.applications.find(application => application.id === hiredEditingId);
      if (item) openInvoiceDocumentPicker(item);
      return;
    }
    if (hiredSelectButton && !event.target.closest('a')) {
      renderHiredDetail(data.applications.find(item => item.id === hiredSelectButton.dataset.hiredSelect));
      return;
    }
    if (docOpenButton) {
      openDocument(docOpenButton.dataset.docOpen);
      return;
    }
    if (docRemoveButton) {
      removeHiredDocument(docRemoveButton.dataset.docRemove);
      return;
    }
    if (docEmailButton) {
      const item = data.applications.find(application => (application.documents || []).some(document => document.id === docEmailButton.dataset.docEmail));
      if (item) openUpdatedDocumentEmailComposer(item, docEmailButton.dataset.docEmail);
      return;
    }
    if (documentMenuButton) {
      const menu = documentMenuButton.nextElementSibling;
      const willOpen = menu.classList.contains('hidden');
      document.querySelectorAll('.document-menu').forEach(item => item.classList.add('hidden'));
      document.querySelectorAll('.document-menu-button').forEach(item => item.setAttribute('aria-expanded', 'false'));
      menu.classList.toggle('hidden', !willOpen);
      documentMenuButton.setAttribute('aria-expanded', String(willOpen));
      return;
    }
    if (!event.target.closest('.document-row-menu, .hired-actions-menu')) {
      document.querySelectorAll('.document-menu').forEach(item => item.classList.add('hidden'));
      document.querySelectorAll('.document-menu-button').forEach(item => item.setAttribute('aria-expanded', 'false'));
      $('#activeClientActionsButton')?.setAttribute('aria-expanded', 'false');
    }
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
  $('#closeHiredDetail').addEventListener('click', () => closeHiredDetail());

  async function sendClientOnboardingInvite(item, button) {
    if (!item.email) {
      showActionResult({ title: 'Client email required', message: 'Add an email address to this active client before sending an onboarding invitation.', status: 'error' });
      return;
    }
    button.disabled = true;
    try {
      const randomBytes = crypto.getRandomValues(new Uint8Array(32));
      const token = [...randomBytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      const tokenHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      const { data: issued, error } = await requireSupabase().rpc('issue_client_onboarding_invite', {
        p_client_id: item.id,
        p_token_hash: tokenHash
      });
      if (error) throw error;
      if (issued !== true) throw new Error('The onboarding invitation could not be created.');
      const onboardingUrl = new URL('/onboarding/', window.location.origin);
      onboardingUrl.hash = `token=${token}`;
      openPlainClientEmailComposer(item);
      $('#composeSubject').value = 'Please review your client onboarding details';
      $('#composeBody').value = `Hi ${item.clientName || 'there'},\n\nPlease complete or update your onboarding details using this private form:\n\n${onboardingUrl.href}\n\nThe link is private to you, expires in 14 days, and can only be submitted once. Submitting this form will replace any onboarding details previously provided. You will be able to review and confirm all your answers before submitting. Please do not enter passwords or sensitive account credentials.\n\nThank you`;
      toast('Review the onboarding invitation and send it through Gmail.');
    } catch (error) {
      console.error('Could not create client onboarding invitation:', error);
      showActionResult({ title: 'Onboarding link could not be created', message: error.message || 'Check your connection and try again.', status: 'error' });
    } finally {
      button.disabled = false;
    }
  }

  function openDocumentEmailReminder(item) {
    const modal = $('#documentEmailReminderModal');
    const input = $('#documentEmailReminderDate');
    input.min = today();
    input.value = item.documentEmailReminderDate || '';
    modal.showModal();
  }

  function closeDocumentEmailReminder() {
    $('#documentEmailReminderModal').close();
  }

  $('#documentEmailReminderForm').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const item = data.applications.find(application => application.id === hiredEditingId);
    if (!item) return;
    const reminderDate = $('#documentEmailReminderDate').value;
    if (reminderDate < today()) {
      toast('Choose today or a future date.');
      return;
    }
    item.documentEmailPending = true;
    item.documentEmailReminderDate = reminderDate;
    item.documentEmailReminderAlertedDate = '';
    item.updatedAt = new Date().toISOString();
    persist();
    closeDocumentEmailReminder();
    renderHiredDetail(item, false);
    processDueDocumentEmailReminders();
    showActionResult({ title: 'Reminder set', message: `The document email reminder is set for ${formatDate(reminderDate)}.` });
  });

  $('#cancelDocumentEmailReminder').addEventListener('click', closeDocumentEmailReminder);
  $('#cancelDocumentEmailReminderAction').addEventListener('click', closeDocumentEmailReminder);

  document.addEventListener('change', event => {
    if (event.target.id === 'invoicePickerUploadInput') {
      stageInvoiceFile(event.target.files[0]);
      event.target.value = '';
      return;
    }
    if (['hiredDetailDocumentInput', 'hiredDocumentInput'].includes(event.target.id)) {
      const files = [...event.target.files];
      event.target.value = '';
      stageHiredDocument(files);
    }
  });
  document.addEventListener('click', event => {
    if (event.target.closest('#useInvoiceFileButton')) {
      event.preventDefault();
      continueInvoicePicker();
      return;
    }
    if (event.target.closest('#reviewActiveClientButton')) {
      const item = data.applications.find(application => application.id === hiredEditingId);
      if (item) openClientEmailComposer(item);
      return;
    }
    const uploadButton = event.target.closest('#hiredDetailUploadButton, #hiredDetailReplaceButton');
    if (uploadButton) {
      event.preventDefault();
      event.stopPropagation();
      pickHiredDocumentFile();
      return;
    }
    if (event.target.closest('#savePendingDocument')) {
      event.preventDefault();
      event.stopPropagation();
      savePendingHiredDocument();
      return;
    }
    if (event.target.closest('#sendUpdatedDocumentEmail')) {
      const item = data.applications.find(application => application.id === hiredEditingId);
      if (item) openUpdatedDocumentEmailComposer(item);
      return;
    }
    if (event.target.closest('#dismissUpdatedDocumentEmail')) {
      const item = data.applications.find(application => application.id === hiredEditingId);
      if (item) openDocumentEmailReminder(item);
      return;
    }
    if (event.target.closest('#changeDocumentEmailReminder')) {
      const item = data.applications.find(application => application.id === hiredEditingId);
      if (item) openDocumentEmailReminder(item);
      return;
    }
    if (event.target.closest('#cancelPendingDocument')) {
      event.preventDefault();
      event.stopPropagation();
      clearPendingDocumentPreview();
      const item = data.applications.find(application => application.id === hiredEditingId);
      if (item) renderHiredDetail(item, false);
    }
  });
