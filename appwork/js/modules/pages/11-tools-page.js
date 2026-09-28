  // Tools page controls: documents, scripts, and work links.
  function renderTemplateTesterPreview() {
    const select = $('#documentTemplateSelect');
    const preview = $('#documentTemplatePreview');
    if (!select || !preview) return;
    const templateId = select.value || 'contract-signing';
    const rendered = buildDocumentEmailTemplate(templateId, {
      clientName: 'Acme Studio',
      contact: 'Jordan Lee',
      role: 'Social Media Management Services'
    }, {
      duration: '3 months',
      invoiceNumber: 'INV-2026-104',
      billingPeriod: 'September 2026',
      issueDate: '2026-09-24',
      dueDate: '2026-10-08'
    });
    const previewBody = htmlEmailBodyFromText(rendered.body);
    preview.innerHTML = `<div style="font-family:Arial, Helvetica, sans-serif; margin:0;">${previewBody}</div>`;
  }

  $('#personalDocumentInput').addEventListener('change', event => {
    uploadPersonalDocument(event.target.files[0]);
    event.target.value = '';
  });
  $('#documentTemplateSelect')?.addEventListener('change', renderTemplateTesterPreview);
  $('#previewDocumentTemplateButton')?.addEventListener('click', renderTemplateTesterPreview);
  $('#sendDocumentTemplateTestButton')?.addEventListener('click', () => {
    const select = $('#documentTemplateSelect');
    sendDocumentTemplateTestEmail(select?.value || 'contract-signing');
  });
  function updateSalaryCalculator() {
    const currency = $('#salaryCalculatorCurrency')?.value || 'USD';
    const hourlyRate = Number($('#salaryCalculatorRate')?.value || 0);
    const hoursPerWeek = Number($('#salaryCalculatorHours')?.value || 0);
    const daysPerWeek = Number($('#salaryCalculatorDays')?.value || 0);
    const monthlyDays = daysPerWeek * (52 / 12);
    const monthlyTotal = hourlyRate * hoursPerWeek * (52 / 12);
    const convertedTotal = currency === 'USD' ? monthlyTotal * 58 : monthlyTotal / 58;
    const convertedHourly = currency === 'USD' ? hourlyRate * 58 : hourlyRate / 58;
    const money = (amount, code) => code === 'USD'
      ? `$${Math.round(amount).toLocaleString()}`
      : `₱${Math.round(amount).toLocaleString()}`;
    $('#salaryCalculatorMonthlyDays').textContent = `${monthlyDays.toFixed(1)} days`;
    $('#salaryCalculatorMonthlyTotal').textContent = money(monthlyTotal, currency);
    $('#salaryCalculatorConversion').textContent = currency === 'USD'
      ? money(convertedTotal, 'PHP')
      : money(convertedTotal, 'USD');
    $('#salaryCalculatorHourlyConversion').textContent = currency === 'USD'
      ? money(convertedHourly, 'PHP')
      : money(convertedHourly, 'USD');
  }

  ['salaryCalculatorCurrency', 'salaryCalculatorRate', 'salaryCalculatorHours', 'salaryCalculatorDays'].forEach(id => {
    $(`#${id}`)?.addEventListener('input', updateSalaryCalculator);
    $(`#${id}`)?.addEventListener('change', updateSalaryCalculator);
  });

  $('#scriptForm').addEventListener('submit', saveScript);
  $('#addScriptButton').addEventListener('click', () => openScriptForm());
  $('#cancelScriptButton').addEventListener('click', resetScriptForm);

  renderDocumentTemplateOptions();
  renderTemplateTesterPreview();
  updateSalaryCalculator();

  document.addEventListener('click', event => {
    const personalDeleteButton = event.target.closest('[data-personal-delete]');
    const personalOpenButton = event.target.closest('[data-personal-open]');
    const scriptViewButton = event.target.closest('[data-script-view]');
    const scriptEditButton = event.target.closest('[data-script-edit]');
    const scriptDeleteButton = event.target.closest('[data-script-delete]');
    const workLinkEditButton = event.target.closest('[data-work-link-edit]');
    const workLinkDeleteButton = event.target.closest('[data-work-link-delete]');
    const addWorkLinkButton = event.target.closest('#addWorkLinkButton');
    const cancelWorkLinkButton = event.target.closest('#cancelWorkLinkButton');
    const saveWorkLinkButton = event.target.closest('#saveWorkLinkButton');
    const documentsTab = event.target.closest('[data-documents-tab]');

    if (personalDeleteButton) {
      removePersonalDocument(personalDeleteButton.dataset.personalDelete);
      return;
    }
    if (personalOpenButton) {
      $$('.personal-document-card').forEach(card => card.classList.remove('selected'));
      personalOpenButton.classList.add('selected');
      if (event.detail >= 2) openPersonalDocument(personalOpenButton.dataset.personalOpen);
      return;
    }
    if (scriptViewButton) {
      const content = $(`[data-script-content="${scriptViewButton.dataset.scriptView}"]`);
      const isHidden = content?.classList.toggle('hidden');
      scriptViewButton.textContent = isHidden ? 'View' : 'Hide';
      return;
    }
    if (scriptEditButton) {
      openScriptForm(scriptEditButton.dataset.scriptEdit);
      return;
    }
    if (scriptDeleteButton) {
      deleteScript(scriptDeleteButton.dataset.scriptDelete);
      return;
    }
    if (workLinkEditButton) {
      openWorkLinkForm(workLinkEditButton.dataset.workLinkEdit);
      return;
    }
    if (workLinkDeleteButton) {
      deleteWorkLink(workLinkDeleteButton.dataset.workLinkDelete);
      return;
    }
    if (addWorkLinkButton) {
      openWorkLinkForm();
      return;
    }
    if (cancelWorkLinkButton) {
      resetWorkLinkForm();
      return;
    }
    if (saveWorkLinkButton) saveWorkLink();
    if (documentsTab) {
      const selectedPanel = documentsTab.dataset.documentsTab;
      $$('[data-documents-tab]').forEach(tab => {
        const active = tab.dataset.documentsTab === selectedPanel;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
      });
      $$('[data-documents-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.documentsPanel !== selectedPanel));
      $('#uploadDocumentButton').hidden = selectedPanel !== 'documents' || !(data.personalDocuments || []).length;
    }
  });
  document.addEventListener('keydown', event => {
    const personalDocument = event.target.closest?.('[data-personal-open]');
    if (!personalDocument || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    openPersonalDocument(personalDocument.dataset.personalOpen);
  });
