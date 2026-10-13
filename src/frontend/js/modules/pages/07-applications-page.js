  // Applications page and its Active Client activation flow are intentionally
  // contained here. Nothing on the inbox, tools, or active-clients page can
  // advance or cancel this transaction.
  let applicationActionsReturnFocus = null;

  function openApplicationActionsPanel(applicationId, trigger) {
    const application = data.applications.find(item => item.id === applicationId);
    const panel = $('#applicationActionsPanel');
    if (!application || !panel) return;
    applicationActionsReturnFocus = trigger;
    panel.dataset.applicationId = applicationId;
    $('#applicationActionsClientName').textContent = application.clientName || 'Application';
    $('#applicationActionsFollowUpDate').textContent = application.followUpDate
      ? `Scheduled for ${formatDate(dateKey(application.followUpDate))}`
      : 'Set a follow-up date.';
    panel.showModal();
    panel.querySelector('[data-application-panel-action]')?.focus();
  }

  function openApplicationFollowUpModal(application) {
    const modal = $('#applicationFollowUpModal');
    modal.dataset.applicationId = application.id;
    $('#applicationFollowUpTitle').textContent = `Follow-up date for ${application.clientName || 'Application'}`;
    $('#applicationFollowUpDateInput').value = dateKey(application.followUpDate);
    modal.showModal();
    $('#applicationFollowUpDateInput').focus();
  }

  $('#applicationActionsPanel').addEventListener('close', () => {
    applicationActionsReturnFocus?.focus();
    applicationActionsReturnFocus = null;
  });

  $('#applicationActionsPanel').addEventListener('click', event => {
    if (event.target.closest('.application-actions-panel-close')) {
      event.currentTarget.close();
      return;
    }
    if (event.target === event.currentTarget) event.currentTarget.close();
  });

  function updateClientLocation() {
    const country = $('#clientCountry');
    const region = $('#clientRegion');
    const regionField = $('#clientRegionField');
    const selectedCountry = country.options[country.selectedIndex];
    const countryCode = country.value;
    const countryName = selectedCountry?.text || '';
    const regionalCountries = [...region.options].filter(option => option.dataset.countries?.split(',').includes(countryCode));
    regionalCountries.forEach(option => { option.hidden = false; });
    [...region.options].filter(option => option.value).forEach(option => { option.hidden = !regionalCountries.includes(option); });
    const hasRegions = regionalCountries.length > 0;
    regionField.classList.toggle('hidden', !hasRegions);
    if (!hasRegions) region.value = '';
    const selectedRegion = region.options[region.selectedIndex];
    $('#hiredLocation').value = countryName ? `${countryName}${selectedRegion?.value ? `, ${selectedRegion.text}` : ''}` : '';
  }

  function updateSalaryFields() {
    const USD_TO_PHP = 58;
    const salaryType = $('#salaryType').value;
    const salaryCurrency = $('#salaryCurrency').value || 'USD';
    const salaryAmount = Number($('#salaryAmount').value || 0);
    const hoursPerWeek = Number($('#salaryHoursPerWeek').value || 0);
    const amountField = $('#salaryAmount').closest('.salary-amount-field');
    const hoursField = $('#salaryHoursPerWeek').closest('.salary-hours-field');
    const estimate = $('#salaryMonthlyEstimatePreview');
    const estimatePhp = $('#salaryMonthlyEstimatePhp');
    const estimateField = $('#salaryMonthlyEstimatePreview')?.closest('.salary-estimate-field');
    const needsSalary = Boolean(salaryType && (salaryType === 'monthly' || salaryType === 'hourly'));
    const mainCurrencySymbol = salaryCurrency === 'PHP' ? '₱' : '$';
    const conversionCurrencySymbol = salaryCurrency === 'PHP' ? '$' : '₱';
    amountField?.classList.toggle('hidden', !needsSalary);
    hoursField?.classList.toggle('hidden', salaryType !== 'hourly');
    estimateField?.classList.toggle('hidden', !needsSalary);
    if (!needsSalary) {
      estimate.textContent = `${mainCurrencySymbol}0`;
      estimatePhp.textContent = `(approx. ${conversionCurrencySymbol}0)`;
      return;
    }
    const monthlyEstimate = salaryType === 'monthly'
      ? salaryAmount
      : (salaryAmount * hoursPerWeek * 4);
    const roundedEstimate = Math.round(monthlyEstimate);
    const convertedEstimate = salaryCurrency === 'PHP'
      ? Math.round(roundedEstimate / USD_TO_PHP)
      : Math.round(roundedEstimate * USD_TO_PHP);
    estimate.textContent = Number.isFinite(monthlyEstimate) && monthlyEstimate > 0
      ? `${mainCurrencySymbol}${roundedEstimate.toLocaleString()}`
      : `${mainCurrencySymbol}0`;
    estimatePhp.textContent = Number.isFinite(monthlyEstimate) && monthlyEstimate > 0
      ? `(approx. ${conversionCurrencySymbol}${convertedEstimate.toLocaleString()})`
      : `(approx. ${conversionCurrencySymbol}0)`;
  }

  document.addEventListener('click', async event => {
    const addButton = event.target.closest('[data-open-add]');
    const editButton = event.target.closest('[data-edit-id]');
    const applicationEmailsButton = event.target.closest('[data-application-emails]');
    const viewDetailsButton = event.target.closest('[data-view-details]');
    const clientDocumentAttachButton = event.target.closest('[data-client-document-attach]');
    const sendProceedEmailButton = event.target.closest('#sendProceedEmailButton');
    const applicationActionsTrigger = event.target.closest('[data-open-application-actions]');
    const applicationPanelAction = event.target.closest('[data-application-panel-action]');
    if (addButton) {
      openClientModal();
      return;
    }
    if (applicationActionsTrigger) {
      openApplicationActionsPanel(applicationActionsTrigger.dataset.openApplicationActions, applicationActionsTrigger);
      return;
    }
    if (applicationPanelAction) {
      const panel = $('#applicationActionsPanel');
      const applicationId = panel.dataset.applicationId;
      const action = applicationPanelAction.dataset.applicationPanelAction;
      const application = data.applications.find(item => item.id === applicationId);
      applicationActionsReturnFocus = null;
      panel.close();
      if (action === 'email' && application) openPlainClientEmailComposer(application);
      else if (action === 'follow-up' && application) openApplicationFollowUpModal(application);
      else if (action === 'edit') openClientModal(applicationId);
      else if (action === 'delete') await deleteClient(applicationId);
      return;
    }
    if (editButton) {
      openClientModal(editButton.dataset.editId);
      return;
    }
    if (applicationEmailsButton) {
      openApplicationEmailsModal(applicationEmailsButton.dataset.applicationEmails);
      return;
    }
    if (viewDetailsButton && !event.target.closest('button, a, input, select, textarea, label')) {
      openClientModal(viewDetailsButton.dataset.viewDetails, true);
      return;
    }
    if (clientDocumentAttachButton) attachPersonalDocumentToClient(clientDocumentAttachButton.dataset.clientDocumentAttach);
    if (sendProceedEmailButton) {
      const application = data.applications.find(item => item.id === editingId);
      if (application) openProceedEmailComposer(application);
      else toast('Save the application first, then open it again to send the proceed email.');
      return;
    }
  });

  $('#applicationFollowUpForm').addEventListener('submit', event => {
    if (event.submitter?.value === 'cancel') return;
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const modal = $('#applicationFollowUpModal');
    const application = data.applications.find(item => item.id === modal.dataset.applicationId);
    if (!application) {
      modal.close();
      toast('This application could not be found. Reopen the actions panel and try again.');
      return;
    }
    const followUpDate = $('#applicationFollowUpDateInput').value;
    if (application.followUpDate !== followUpDate) {
      application.followUpDate = followUpDate;
      application.followUpProcessedAt = '';
      application.followUpSentAt = '';
    }
    application.updatedAt = new Date().toISOString();
    persist();
    renderAll();
    modal.close();
    toast('Follow-up date saved.');
  });

  $('#clientPlatform').addEventListener('change', event => {
    const isOther = event.target.value === 'Other';
    $('#customPlatformField').classList.toggle('hidden', !isOther);
    $('#customPlatform').required = isOther;
    if (!isOther) $('#customPlatform').value = '';
    if (!editingId && !viewingClientDetails) {
      const email = $('#hiredEmail');
      const knownSenderEmails = Object.keys(PLATFORM_SENDER_EMAILS).map(platformSenderEmail);
      const currentEmail = email.value.trim().toLowerCase();
      const senderEmail = platformSenderEmail(event.target.value);
      if (senderEmail && (!currentEmail || knownSenderEmails.includes(currentEmail))) {
        email.value = senderEmail;
      } else if (!senderEmail && knownSenderEmails.includes(currentEmail)) {
        email.value = '';
      }
    }
  });
  $('#salaryType').addEventListener('change', updateSalaryFields);
  $('#salaryCurrency').addEventListener('change', updateSalaryFields);
  $('#salaryAmount').addEventListener('input', updateSalaryFields);
  $('#salaryHoursPerWeek').addEventListener('input', updateSalaryFields);
  $('#clientCountry').addEventListener('change', updateClientLocation);
  $('#clientRegion').addEventListener('change', updateClientLocation);
  $('#clientForm').addEventListener('submit', saveClient);
  ['input', 'change'].forEach(eventName => {
    $('#clientForm').addEventListener(eventName, () => {
      if ($('#clientModal').open && !editingId && !viewingClientDetails) saveNewClientApplicationDraft();
    });
  });
  $('#clientStatus').addEventListener('change', updateClientActionLabel);
  $('#automaticFollowUp').addEventListener('change', event => {
    if (event.target.checked && !$('#followUpDate').value) $('#followUpDate').value = addDays(today(), 7);
  });
  $('#applicationSearch').addEventListener('input', renderApplications);
  $('#applicationDateFilter').addEventListener('change', event => {
    applicationDateFilter = event.target.value;
    applicationDateSort = '';
    renderApplications();
    updateWeekNavigationCounts();
  });
  $('#applicationDateSort').addEventListener('change', event => {
    applicationDateSort = event.target.value;
    if (applicationDateSort === 'all') {
      applicationDateFilter = '';
      $('#applicationDateFilter').value = '';
    }
    renderApplications();
    updateWeekNavigationCounts();
  });
  $('#statusFilter').addEventListener('change', renderApplications);
  $('#platformFilter').addEventListener('change', renderApplications);
  document.querySelectorAll('[data-application-view]').forEach(button => {
    button.addEventListener('click', () => {
      applicationViewMode = button.dataset.applicationView;
      localStorage.setItem('jeff-va-application-view-v1', applicationViewMode);
      renderApplications();
    });
  });
  $('#toggleApplicationSelection').addEventListener('click', () => {
    applicationSelectionMode = !applicationSelectionMode;
    if (!applicationSelectionMode) selectedApplicationIds.clear();
    renderApplications();
  });
  $('#clearApplicationFilters').addEventListener('click', () => {
    $('#applicationSearch').value = '';
    $('#applicationDateFilter').value = '';
    $('#statusFilter').value = '';
    $('#platformFilter').value = '';
    $('#applicationDateSort').value = 'all';
    applicationDateFilter = '';
    applicationDateSort = 'all';
    renderApplications();
    updateWeekNavigationCounts();
  });
  document.addEventListener('click', async event => {
    const removeFilter = event.target.closest('[data-remove-application-filter]');
    const detailButton = event.target.closest('button[data-view-details]');
    if (removeFilter) {
      const filter = removeFilter.dataset.removeApplicationFilter;
      if (filter === 'search') $('#applicationSearch').value = '';
      if (filter === 'date') {
        applicationDateFilter = '';
        $('#applicationDateFilter').value = '';
      }
      if (filter === 'status') $('#statusFilter').value = '';
      if (filter === 'platform') $('#platformFilter').value = '';
      if (filter === 'week') {
        applicationDateSort = 'all';
        $('#applicationDateSort').value = 'all';
      }
      renderApplications();
      updateWeekNavigationCounts();
      return;
    }
    if (detailButton) {
      openClientModal(detailButton.dataset.viewDetails, true);
      return;
    }
  });
  $('#applicationList').addEventListener('change', event => {
    const checkbox = event.target.closest('[data-application-select]');
    if (!checkbox) return;
    if (checkbox.checked) selectedApplicationIds.add(checkbox.dataset.applicationSelect);
    else selectedApplicationIds.delete(checkbox.dataset.applicationSelect);
    $('#applicationBulkActions').hidden = !applicationSelectionMode || selectedApplicationIds.size === 0;
    $('#applicationSelectionCount').textContent = `${selectedApplicationIds.size} selected`;
  });
  $('#clearApplicationSelection').addEventListener('click', () => {
    selectedApplicationIds.clear();
    renderApplications();
  });
  $('#applyBulkStatus').addEventListener('click', () => {
    const newStatus = $('#applicationBulkStatus').value;
    if (!newStatus || !selectedApplicationIds.size) return;
    const selected = data.applications.filter(item => selectedApplicationIds.has(item.id));
    const activeClients = selected.filter(item => item.status === 'Active client');
    if (activeClients.length) {
      toast('Active clients must be updated from their details to preserve contract records.');
      return;
    }
    selected.forEach(item => {
      item.status = newStatus;
      if (newStatus !== 'Interview') {
        item.interviewDate = '';
        item.interviewLink = '';
      }
      if (newStatus !== 'To Proceed') item.nextStep = '';
    });
    selectedApplicationIds.clear();
    $('#applicationBulkStatus').value = '';
    persist();
    renderAll();
    toast(`Updated ${plural(selected.length, 'application')}.`);
  });
  let draggedApplicationId = '';
  $('#applicationList').addEventListener('dragstart', event => {
    const card = event.target.closest('[data-application-card]');
    if (!card || card.getAttribute('draggable') !== 'true') return;
    draggedApplicationId = card.dataset.applicationCard;
    event.dataTransfer.setData('text/plain', draggedApplicationId);
    event.dataTransfer.effectAllowed = 'move';
  });
  $('#applicationList').addEventListener('dragover', event => {
    const column = event.target.closest('[data-application-drop-status]');
    if (!column || !draggedApplicationId) return;
    event.preventDefault();
    column.classList.add('drop-target');
  });
  $('#applicationList').addEventListener('dragleave', event => {
    const column = event.target.closest('[data-application-drop-status]');
    if (column && !column.contains(event.relatedTarget)) column.classList.remove('drop-target');
  });
  $('#applicationList').addEventListener('drop', event => {
    const column = event.target.closest('[data-application-drop-status]');
    if (!column || !draggedApplicationId) return;
    event.preventDefault();
    column.classList.remove('drop-target');
    const item = data.applications.find(application => application.id === draggedApplicationId);
    const nextStatus = column.dataset.applicationDropStatus;
    draggedApplicationId = '';
    if (!item || item.status === nextStatus) return;
    if (nextStatus === 'Interview' || nextStatus === 'Active client') {
      openClientModal(item.id);
      $('#clientStatus').value = nextStatus;
      $('#clientStatus').dispatchEvent(new Event('change'));
      toast(nextStatus === 'Interview'
        ? 'Add the interview date and link to complete this status change.'
        : 'Complete the client activation steps to change this status.');
      return;
    }
    item.status = nextStatus;
    if (nextStatus !== 'To Proceed') item.nextStep = '';
    item.interviewDate = '';
    item.interviewLink = '';
    persist();
    renderAll();
    toast(`Moved ${item.clientName} to ${nextStatus === 'Not selected' ? 'Rejected' : nextStatus}.`);
  });

  $('#clientPickerUploadInput').addEventListener('change', async event => {
    await uploadActivationDocument(event.target.files[0]);
    event.target.value = '';
  });
  $('#continueActivationEmailButton').addEventListener('click', continueActivationEmail);
  $('#cancelActivationDocumentButton').addEventListener('click', event => {
    event.preventDefault();
    $('#clientDocumentPickerModal').close();
  });
  $('#cancelActivationEmailButton').addEventListener('click', event => {
    event.preventDefault();
    $('#emailComposeModal').close();
  });
  $('#clientDocumentPickerModal').addEventListener('close', () => {
    if (pendingActivation?.stage === 'document-selection') rollbackActivation();
  });
  $('#emailComposeModal').addEventListener('close', () => {
    if (pendingActivation?.stage === 'email') rollbackActivation();
  });
