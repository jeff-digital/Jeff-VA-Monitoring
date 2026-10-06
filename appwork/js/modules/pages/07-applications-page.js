  // Applications page and its Active Client activation flow are intentionally
  // contained here. Nothing on the inbox, tools, or active-clients page can
  // advance or cancel this transaction.
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

  document.addEventListener('click', event => {
    if (!event.target.closest('.send-email-menu')) {
      $('#sendEmailMenu')?.classList.add('hidden');
      $('#sendEmailMenuButton')?.setAttribute('aria-expanded', 'false');
    }
    const addButton = event.target.closest('[data-open-add]');
    const editButton = event.target.closest('[data-edit-id]');
    const applicationEmailsButton = event.target.closest('[data-application-emails]');
    const viewDetailsButton = event.target.closest('[data-view-details]');
    const clientDocumentAttachButton = event.target.closest('[data-client-document-attach]');
    const sendEmailMenuButton = event.target.closest('#sendEmailMenuButton');
    const sendClientEmailButton = event.target.closest('#sendClientEmailButton');
    const sendProceedEmailButton = event.target.closest('#sendProceedEmailButton');
    if (sendEmailMenuButton) {
      const menu = $('#sendEmailMenu');
      const willOpen = menu.classList.contains('hidden');
      menu.classList.toggle('hidden', !willOpen);
      sendEmailMenuButton.setAttribute('aria-expanded', String(willOpen));
      return;
    }
    if (addButton) {
      openClientModal();
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
    if (viewDetailsButton && !event.target.closest('button, a')) {
      openClientModal(viewDetailsButton.dataset.viewDetails, true);
      return;
    }
    if (clientDocumentAttachButton) attachPersonalDocumentToClient(clientDocumentAttachButton.dataset.clientDocumentAttach);
    if (sendClientEmailButton) {
      $('#sendEmailMenu').classList.add('hidden');
      $('#sendEmailMenuButton').setAttribute('aria-expanded', 'false');
      const application = data.applications.find(item => item.id === editingId);
      if (application) openPlainClientEmailComposer(application);
      else toast('Save the application first, then open it again to send an email.');
      return;
    }
    if (sendProceedEmailButton) {
      $('#sendEmailMenu').classList.add('hidden');
      $('#sendEmailMenuButton').setAttribute('aria-expanded', 'false');
      const application = data.applications.find(item => item.id === editingId);
      if (application) openProceedEmailComposer(application);
      else toast('Save the application first, then open it again to send the proceed email.');
      return;
    }
  });

  $('#clientPlatform').addEventListener('change', event => {
    const isOther = event.target.value === 'Other';
    $('#customPlatformField').classList.toggle('hidden', !isOther);
    $('#customPlatform').required = isOther;
    if (!isOther) $('#customPlatform').value = '';
    if (!editingId && !viewingClientDetails) {
      const senderEmails = {
        '20four7va': 'info@20four7va.com',
        indeed: 'donotreply@jobalert.indeed.com',
        jobstreet: 'noreply@e.jobstreet.com',
        multiplymii: 'info@multiplymii.com',
        'onlinejobs.ph': 'support@onlinejobs.ph',
        'remote work ph': 'support@remotework.ph',
        zirtual: 'noreply@candidates.workablemail.com'
      };
      const email = $('#hiredEmail');
      const knownSenderEmails = Object.values(senderEmails);
      const currentEmail = email.value.trim().toLowerCase();
      const senderEmail = senderEmails[event.target.value.trim().toLowerCase()];
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
  $('#deleteClientButton').addEventListener('click', () => deleteClient(editingId));
  $('#clientStatus').addEventListener('change', updateClientActionLabel);
  $('#automaticFollowUp').addEventListener('change', event => {
    if (event.target.checked && !$('#followUpDate').value) $('#followUpDate').value = addDays(today(), 7);
  });
  $('#applicationSearch').addEventListener('input', renderApplications);
  $('#applicationDateFilter').addEventListener('change', event => {
    applicationDateFilter = event.target.value;
    renderApplications();
  });
  $('#applicationDateSort').addEventListener('change', event => {
    applicationDateSort = event.target.value;
    localStorage.setItem(APPLICATION_WEEK_FILTER_KEY, applicationDateSort);
    renderApplications();
    updateWeekNavigationCounts();
  });
  $('#statusFilter').addEventListener('change', renderApplications);
  $('#platformFilter').addEventListener('change', renderApplications);

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
