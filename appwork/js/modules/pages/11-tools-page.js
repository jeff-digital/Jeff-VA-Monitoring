  // Tools page controls: documents, scripts, and work links.
  const COVER_LETTER_STORAGE_KEY = 'jeff-va-cover-letter-v1';
  const COVER_LETTER_DEFAULTS = {
    recipient: 'Hiring Manager',
    company: '',
    role: 'Social Media Marketing Virtual Assistant',
    email: 'almocerajeffreys@gmail.com',
    phone: '+63 975 683 4839',
    location: 'Calamba, Philippines',
    website: 'jeffdigi.com',
    body: 'With over three years of digital marketing experience supporting multiple client accounts, I bring hands-on experience in social media content creation, scheduling, publishing, community engagement, and visual design.\n\nIn my previous role as a Digital Marketing Specialist at a Canada-based company, I managed content across Facebook, Instagram, Reddit, Pinterest, Quora, YouTube, X, and TikTok, maintaining multiple client accounts with 5-20 posts per week. I also created post graphics, promotional visuals, and campaign materials using Canva and Photoshop, and responded to comments and messages to support community engagement.\n\nI have training in social media marketing through HubSpot Academy, as well as experience with CapCut, Adobe Premiere Pro, Grammarly, and other content creation and publishing tools. My digital marketing background has also helped me plan content and identify the right audience for each platform.\n\nI am organized, detail-oriented, and comfortable managing multiple social media accounts and content tasks independently. I would welcome the opportunity to bring my social media and virtual assistance skills to your team.\n\nThank you for considering my application. I look forward to discussing how I can support your social media marketing efforts.'
  };
  const coverLetterFields = [...document.querySelectorAll('[data-cover-letter-field]')];

  function coverLetterValues() {
    return Object.fromEntries(coverLetterFields.map(field => [field.dataset.coverLetterField, field.value.trim()]));
  }

  function coverLetterDate() {
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());
  }

  function renderCoverLetterPreview() {
    const values = coverLetterValues();
    const intro = `I am excited to apply for the ${values.role || 'position'}${values.company ? ` at ${values.company}` : ''}.`;
    const contact = [values.email, values.phone, values.location, values.website].filter(Boolean).join(' | ');
    const body = [intro, values.body].filter(Boolean).join('\n\n');
    const bodyHtml = body.split(/\n\s*\n/).filter(Boolean)
      .map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('');
    const recipientName = (values.recipient || '').trim();
    const defaultRecipient = 'Hiring Manager';
    const salutationRecipient = recipientName || defaultRecipient;
    const recipientAddress = recipientName && recipientName.toLowerCase() !== defaultRecipient.toLowerCase() ? recipientName : '';
    $('#coverLetterPreview').innerHTML = `
      <header class="cover-letter-page-header">
        <img src="image/tab.png" alt="Jeff VA logo" />
        <div><h1>Jeffrey S. Almocera</h1><div class="cover-letter-contact">${escapeHtml(contact)}</div></div>
      </header>
      <p class="cover-letter-date">${coverLetterDate()}</p>
      ${recipientAddress ? `<p class="cover-letter-recipient">${escapeHtml(recipientAddress)}</p>` : ''}
      <p class="cover-letter-greeting">Dear ${escapeHtml(salutationRecipient)},</p>
      <div class="cover-letter-copy">${bodyHtml}</div>
      <p class="cover-letter-signoff">Best regards,<br><strong>Jeffrey S. Almocera</strong></p>`;
  }

  function initializeCoverLetter() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(COVER_LETTER_STORAGE_KEY) || '{}');
    } catch (error) {
      console.warn('Could not load the saved cover letter:', error);
    }
    const values = { ...COVER_LETTER_DEFAULTS, ...saved };
    coverLetterFields.forEach(field => {
      field.value = values[field.dataset.coverLetterField] || '';
      field.addEventListener('input', () => {
        try {
          localStorage.setItem(COVER_LETTER_STORAGE_KEY, JSON.stringify(coverLetterValues()));
        } catch (error) {
          console.warn('Could not save the cover letter:', error);
        }
        renderCoverLetterPreview();
      });
    });
    renderCoverLetterPreview();
  }

  function coverLetterFilename(extension) {
    const role = coverLetterValues().role || 'cover-letter';
    const safeRole = role.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cover-letter';
    return `jeffrey-almocera-${safeRole}.${extension}`;
  }

  function downloadCoverLetterBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function renderCoverLetterCanvas() {
    if (!window.html2canvas) throw new Error('The cover letter renderer is unavailable.');
    if (document.fonts?.ready) await document.fonts.ready;
    return window.html2canvas($('#coverLetterPreview'), { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  }

  async function downloadCoverLetterPdf() {
    const pdfLib = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!pdfLib || !window.html2canvas) {
      showActionResult({ title: 'PDF export unavailable', message: 'The PDF tools are still loading. Try again in a moment.', status: 'error' });
      return;
    }
    const button = $('#downloadCoverLetterPdf');
    button.disabled = true;
    try {
      const canvas = await renderCoverLetterCanvas();
      const pdf = new pdfLib({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const image = canvas.toDataURL('image/jpeg', 0.94);
      const fitScale = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
      const imageWidth = canvas.width * fitScale;
      const imageHeight = canvas.height * fitScale;
      pdf.addImage(image, 'JPEG', (pageWidth - imageWidth) / 2, (pageHeight - imageHeight) / 2, imageWidth, imageHeight);
      pdf.save(coverLetterFilename('pdf'));
      showActionResult({ title: 'Cover letter downloaded', message: 'Your cover letter PDF is ready.' });
    } catch (error) {
      console.error('Cover letter PDF export failed:', error);
      showActionResult({ title: 'Could not create PDF', message: 'The cover letter PDF could not be generated. Try again.', status: 'error' });
    } finally {
      button.disabled = false;
    }
  }

  async function downloadCoverLetterWord() {
    const docx = window.docx;
    if (!docx) {
      showActionResult({ title: 'Word export unavailable', message: 'The Word document tool could not load. Check your connection and try again.', status: 'error' });
      return;
    }
    const button = $('#downloadCoverLetterWord');
    button.disabled = true;
    try {
      const values = coverLetterValues();
      const logoResponse = await fetch('image/tab.png');
      if (!logoResponse.ok) throw new Error('The logo image could not be loaded.');
      const logoData = new Uint8Array(await logoResponse.arrayBuffer());
      const { AlignmentType, BorderStyle, Document, ImageRun, Packer, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType } = docx;
      const contact = [values.email, values.phone, values.location, values.website].filter(Boolean).join(' | ');
      const recipientName = (values.recipient || '').trim();
      const defaultRecipient = 'Hiring Manager';
      const salutationRecipient = recipientName || defaultRecipient;
      const recipientAddress = recipientName && recipientName.toLowerCase() !== defaultRecipient.toLowerCase() ? recipientName : '';
      const textParagraph = (text, options = {}) => {
        const { fontSize = 20, color, bold = false, ...paragraphOptions } = options;
        return new Paragraph({
          children: [new TextRun({ text, font: 'Arial', size: fontSize, ...(color ? { color } : {}), ...(bold ? { bold: true } : {}) })],
          spacing: { after: 165, line: 290 },
          ...paragraphOptions
        });
      };
      const headerRule = { style: BorderStyle.SINGLE, size: 6, color: 'DCE3DD' };
      const twipsPerPixel = 15;
      const pageMarginHorizontal = 52 * twipsPerPixel;
      const pageMarginVertical = 48 * twipsPerPixel;
      const logoAndGapWidth = (56 + 15) * twipsPerPixel;
      const headerWidth = 11906 - pageMarginHorizontal * 2;
      const nameColumnWidth = headerWidth - logoAndGapWidth;
      const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
      const header = new Table({
        width: { size: headerWidth, type: WidthType.DXA },
        columnWidths: [logoAndGapWidth, nameColumnWidth],
        layout: TableLayoutType.FIXED,
        borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder },
        rows: [new TableRow({ children: [
          new TableCell({
            width: { size: logoAndGapWidth, type: WidthType.DXA },
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({ spacing: { before: 0, after: 0 }, children: [new ImageRun({ data: logoData, transformation: { width: 56, height: 56 } })] })]
          }),
          new TableCell({
            width: { size: nameColumnWidth, type: WidthType.DXA },
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            verticalAlign: VerticalAlign.CENTER,
            children: [
              textParagraph('Jeffrey S. Almocera', { fontSize: 30, color: '1F3525', spacing: { before: 0, after: 35, line: 300 }, bold: true }),
              textParagraph(contact, { fontSize: 16, color: '505952', spacing: { before: 0, after: 0, line: 250 } })
            ]
          })
        ] })]
      });
      const headerDivider = new Paragraph({
        children: [new TextRun({ text: ' ', font: 'Arial', size: 1 })],
        spacing: { before: 120, after: 100, line: 20 },
        border: { bottom: headerRule }
      });
      const body = [
        header,
        headerDivider,
        textParagraph(coverLetterDate(), { fontSize: 18, spacing: { before: 200, after: 200 } }),
        ...(recipientAddress ? [textParagraph(recipientAddress, { spacing: { after: 200 } })] : []),
        textParagraph(`Dear ${salutationRecipient},`, { spacing: { after: 165 } }),
        textParagraph(`I am excited to apply for the ${values.role || 'position'}${values.company ? ` at ${values.company}` : ''}.`, { alignment: AlignmentType.JUSTIFIED })
      ];
      String(values.body || '').split(/\n\s*\n/).filter(Boolean).forEach(paragraph => {
        body.push(textParagraph(paragraph.replace(/\n/g, ' '), { alignment: AlignmentType.JUSTIFIED }));
      });
      body.push(textParagraph('Best regards,', { spacing: { before: 200, after: 70 } }));
      body.push(new Paragraph({ children: [new TextRun({ text: 'Jeffrey S. Almocera', bold: true, font: 'Arial', size: 20, color: '1F3525' })] }));
      const document = new Document({ sections: [{
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: pageMarginVertical, right: pageMarginHorizontal, bottom: pageMarginVertical, left: pageMarginHorizontal } } },
        children: body
      }] });
      const blob = await Packer.toBlob(document);
      downloadCoverLetterBlob(blob, coverLetterFilename('docx'));
      showActionResult({ title: 'Cover letter downloaded', message: 'Your Word document is ready.' });
    } catch (error) {
      console.error('Cover letter Word export failed:', error);
      showActionResult({ title: 'Could not create Word document', message: 'The Word document could not be generated. Try again.', status: 'error' });
    } finally {
      button.disabled = false;
    }
  }

  $('#downloadCoverLetterPdf').addEventListener('click', downloadCoverLetterPdf);
  $('#downloadCoverLetterWord').addEventListener('click', downloadCoverLetterWord);
  initializeCoverLetter();

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
    const payType = $('#salaryCalculatorPayType')?.value || 'hourly';
    const enteredRate = Number($('#salaryCalculatorRate')?.value || 0);
    const hoursPerWeek = Number($('#salaryCalculatorHours')?.value || 0);
    const daysPerWeek = Number($('#salaryCalculatorDays')?.value || 0);
    const monthlyDays = daysPerWeek * (52 / 12);
    const monthlyTotal = payType === 'monthly' ? enteredRate : enteredRate * hoursPerWeek * (52 / 12);
    const hourlyRate = payType === 'monthly'
      ? (hoursPerWeek > 0 ? monthlyTotal / (hoursPerWeek * (52 / 12)) : 0)
      : enteredRate;
    const convertedTotal = currency === 'USD' ? monthlyTotal * 58 : monthlyTotal / 58;
    const convertedHourly = currency === 'USD' ? hourlyRate * 58 : hourlyRate / 58;
    const convertedCurrency = currency === 'USD' ? 'PHP' : 'USD';
    const money = (amount, code) => code === 'USD'
      ? `$${Math.round(amount).toLocaleString()}`
      : `₱${Math.round(amount).toLocaleString()}`;
    $('#salaryCalculatorRateLabel').textContent = payType === 'monthly' ? 'Monthly salary' : 'Hourly rate';
    $('#salaryCalculatorRate').placeholder = currency === 'USD'
      ? (payType === 'monthly' ? 'e.g. 1,700' : 'e.g. 10')
      : (payType === 'monthly' ? 'e.g. 98,600' : 'e.g. 580');
    $('#salaryCalculatorMonthlyDays').textContent = `${monthlyDays.toFixed(1)} days`;
    $('#salaryCalculatorMonthlyTotal').textContent = money(monthlyTotal, currency);
    $('#salaryCalculatorConversionLabel').textContent = `Converted monthly (${convertedCurrency})`;
    $('#salaryCalculatorHourlyLabel').textContent = `Hourly equivalent (${convertedCurrency})`;
    $('#salaryCalculatorConversion').textContent = currency === 'USD'
      ? money(convertedTotal, 'PHP')
      : money(convertedTotal, 'USD');
    $('#salaryCalculatorHourlyConversion').textContent = currency === 'USD'
      ? money(convertedHourly, 'PHP')
      : money(convertedHourly, 'USD');
  }

  ['salaryCalculatorCurrency', 'salaryCalculatorPayType', 'salaryCalculatorRate', 'salaryCalculatorHours', 'salaryCalculatorDays'].forEach(id => {
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
