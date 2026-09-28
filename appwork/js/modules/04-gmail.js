  // --- Gmail sync ---
  // Runs entirely in the browser via Google's own sign-in (Google Identity Services) and calls
  // the Gmail API directly with the resulting token. Jeff VA has no server of its own,
  // so nothing about your inbox passes through anything but your browser and Google's API.
  const GMAIL_SCOPE = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send'
  ].join(' ');
  const GMAIL_SEND_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
  const DOCUMENT_TEMPLATE_DEFINITIONS = {
    'blank-email': {
      name: 'Empty email',
      subject: '',
      body: ''
    },
    'contract-signing': {
      name: 'Contract signing',
      subject: 'Contract for Your Review: Jeffrey S. Almocera',
      body: 'Hi {{contact}},\n\nThank you for choosing to move forward together. Please find attached the service contract for **{{role}}** outlining the scope of work, rate, and terms we discussed.\n\nKindly review the details at your convenience. Once everything looks good, please sign and return a copy so we can get started. Let me know if you have any questions or if any adjustments are needed.\n\nBest regards,\nJeffrey S. Almocera\nalmocerajeffreys@gmail.com | +63 975-683-4839'
    },
    'follow-up': {
      name: 'Follow-up',
      subject: 'Follow-up: {{clientName}}',
      body: 'Hi {{contact}},\n\nI wanted to follow up on my application for the **{{role}}** role, which I submitted on {{applicationDate}}. I would appreciate any update on the progress or next steps.\n\nThank you for your time and consideration.\n\nBest regards,\nJeffrey S. Almocera\nalmocerajeffreys@gmail.com | +63 975-683-4839'
    },
    'proceed-application': {
      name: 'Proceed application',
      subject: 'Application for - {{role}}',
      body: 'Dear Hiring Team,\n\nThank you for the opportunity to move forward with my application for the {{role}} position. I am sharing my contact details below for your reference.\n\nFull name: Jeffrey S. Almocera\nEmail: almocerajeffreys@gmail.com\nPhone: +63 975 683 4839\nWebsite: jeffdigi.com\n\nPlease let me know if you need any additional information. I look forward to hearing from you about the next steps.\n\nBest regards,\nJeffrey S. Almocera\nalmocerajeffreys@gmail.com | +63 975-683-4839'
    },
    'contract-ended': {
      name: 'Contract ended',
      subject: 'Wrapping Up Our Engagement: Jeffrey S. Almocera',
      body: 'Hi {{contact}},\n\nAs we reach the end of our contract period, I wanted to reach out and thank you for the opportunity to work with you over the past **{{duration}}** on **{{role}}**.\n\nIf there is any handover or documentation you need from my end before we close things out, please let me know and I will take care of it.\n\nShould you ever need support again in the future, I would welcome the chance to work together again.\n\nThank you again for the trust and the opportunity.\n\nBest regards,\nJeffrey S. Almocera\nalmocerajeffreys@gmail.com | +63 975-683-4839'
    },
    'send-new-contract': {
      name: 'Send new contract',
      subject: 'New Contract for {{clientName}}: Jeffrey S. Almocera',
      body: 'Hi {{contact}},\n\nThank you for the opportunity to continue working together. Please find attached the latest contract for **{{role}}**.\n\nPlease review it at your convenience and let me know if you need any adjustments before we proceed.\n\nBest regards,\nJeffrey S. Almocera\nalmocerajeffreys@gmail.com | +63 975-683-4839'
    },
    'invoice': {
      name: 'Invoice',
      subject: 'Invoice for {{role}}: {{invoiceNumber}} / {{billingPeriod}}',
      body: 'Hi {{contact}},\n\nI hope this message finds you well. Please find attached the invoice for the **{{role}}** services provided.\n\nInvoice Number: {{invoiceNumber}}\nDate of Issue: {{issueDate}}\nBilling Period: {{billingPeriod}}\nDue Date: {{dueDate}}\n\nKindly review at your convenience, and let me know if you have any questions.\n\nThank you for the continued opportunity to work with you.\n\nBest regards,\nJeffrey S. Almocera\nalmocerajeffreys@gmail.com | +63 975-683-4839'
    },
    'updated-contract': {
      name: 'Updated contract',
      subject: 'Updated Contract Of Agreement',
      body: 'Hi {{contact}},\n\nPlease find attached the updated Contract Of Agreement for your records.\n\nBest regards,\nJeffrey S. Almocera\nalmocerajeffreys@gmail.com | +63 975-683-4839'
    }
  };
  let gmailTokenClient = null;
  let gmailAccessToken = null;
  let composeAttachment = null;
  let composeAttachmentFile = null;
  let composeClientId = null;
  let composeActivationClientId = null;
  let composeInvoiceDraft = null;
  let composeDocumentUpdateClientId = null;
  let composeRequiresConfirmation = false;
  let gmailTokenRequest = null;
  const GMAIL_CONNECTED_KEY = 'jeff-va-gmail-connected-v1';
  const GMAIL_TOKEN_SESSION_KEY = 'jeff-va-gmail-token-session-v1';

  function renderDocumentTemplateOptions(selectedId = 'contract-signing') {
    const select = $('#documentTemplateSelect');
    if (!select) return;
    select.innerHTML = Object.entries(DOCUMENT_TEMPLATE_DEFINITIONS)
      .map(([templateId, template]) => `<option value="${escapeHtml(templateId)}">${escapeHtml(template.name)}</option>`)
      .join('');
    select.value = selectedId;
  }

  function escapeHtmlForEmail(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function htmlEmailBodyFromText(value = '') {
    const plain = String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    const escaped = escapeHtmlForEmail(plain)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    const paragraphs = escaped
      .split(/\n\s*\n/)
      .map(paragraph => paragraph.replace(/\n/g, '<br>'))
      .filter(Boolean)
      .map(paragraph => `<p style="margin:0 0 18px; line-height:1.7; font-size:17px; color:#1f2a2d;">${paragraph}</p>`)
      .join('');

    const content = paragraphs || '<p style="margin:0; line-height:1.7; font-size:17px; color:#1f2a2d;">&nbsp;</p>';
    return `
      <div style="background:#f3efe9; padding:32px 16px; font-family:Arial, Helvetica, sans-serif;">
        <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #e6dfd7; border-radius:18px; box-shadow:0 8px 22px rgba(27,24,20,0.06); overflow:hidden;">
          <div style="height:5px; background:#0f1720; border-radius:18px 18px 0 0;"></div>
          <div style="padding:28px 32px 20px;">
            ${content}
          </div>
          <div style="background:rgb(26, 35, 64); padding:16px 24px; text-align:center; font-size:13px; color:#ffffff; letter-spacing:0.02em; border-top:1px solid rgba(255,255,255,0.15);">
            <div>Copyright © 2026 Jeffrey S. Almocera</div>
            <div style="margin-top:4px; font-weight:600;">jeffdigi.com</div>
          </div>
        </div>
      </div>
    `;
  }

  function buildRawEmailMessage({ to, subject, body, attachmentName = '', attachmentType = 'application/octet-stream', attachmentBase64 = '' }) {
    const safeRecipient = String(to || '').replace(/[\r\n]+/g, '');
    const safeSubject = String(subject || '').replace(/[\r\n]+/g, ' ');
    const safeAttachmentName = String(attachmentName || 'attachment')
      .replace(/[\r\n"\\]/g, '_')
      .replace(/[^\x20-\x7E]/g, '_')
      .slice(0, 180) || 'attachment';
    const safeAttachmentType = /^[a-z\d.+-]+\/[a-z\d.+-]+$/i.test(attachmentType)
      ? attachmentType
      : 'application/octet-stream';
    const mixedBoundary = `jeff-va-${uid()}`;
    const altBoundary = `jeff-va-alt-${uid()}`;
    const htmlBody = htmlEmailBodyFromText(body);
    if (!attachmentBase64) {
      return [
        `To: ${safeRecipient}`,
        `Subject: ${safeSubject}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
        '',
        `--${altBoundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        '',
        body,
        `--${altBoundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        '',
        htmlBody,
        `--${altBoundary}--`
      ].join('\r\n');
    }

    return [
      `To: ${safeRecipient}`,
      `Subject: ${safeSubject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
      '',
      `--${mixedBoundary}`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      `--${altBoundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      body,
      `--${altBoundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      '',
      htmlBody,
      `--${altBoundary}--`,
      `--${mixedBoundary}`,
      `Content-Type: ${safeAttachmentType}; name="${safeAttachmentName}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${safeAttachmentName}"`,
      '',
      attachmentBase64,
      `--${mixedBoundary}--`
    ].join('\r\n');
  }

  async function sendDocumentTemplateTestEmail(templateType = 'contract-signing') {
    const template = DOCUMENT_TEMPLATE_DEFINITIONS[templateType] || DOCUMENT_TEMPLATE_DEFINITIONS['contract-signing'];
    const rendered = buildDocumentEmailTemplate(templateType, {
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
    const recipient = 'almocerajeffreys@gmail.com';
    const rawMessage = buildRawEmailMessage({
      to: recipient,
      subject: rendered.subject,
      body: rendered.body
    });

    try {
      await sendGmailRaw(rawMessage);
      toast(`Template test sent to ${recipient}.`);
    } catch (error) {
      console.error('Template test failed:', error);
      toast(`Could not send the ${template.name} test email. Check Gmail access.`);
    }
  }

  function getDocumentTemplateCatalog() {
    return Object.entries(DOCUMENT_TEMPLATE_DEFINITIONS).map(([templateId, template]) => ({ id: templateId, ...template }));
  }

  function buildDocumentEmailTemplate(templateType, application = {}, additional = {}) {
    const template = DOCUMENT_TEMPLATE_DEFINITIONS[templateType] || DOCUMENT_TEMPLATE_DEFINITIONS['contract-signing'];
    const clientName = application.clientName || 'Client';
    const contactName = application.contact || clientName;
    const roleName = application.role || 'your project';
    const duration = additional.duration || contractDuration(application) || 'the project period';
    const invoiceNumber = additional.invoiceNumber || 'INV-000';
    const billingPeriod = additional.billingPeriod || 'this period';
    const issueDate = additional.issueDate || new Date().toISOString().slice(0, 10);
    const dueDate = additional.dueDate || new Date().toISOString().slice(0, 10);
    const subject = (additional.subject || template.subject)
      .replace(/{{clientName}}/g, clientName)
      .replace(/{{contact}}/g, contactName)
      .replace(/{{role}}/g, roleName)
      .replace(/{{duration}}/g, duration)
      .replace(/{{invoiceNumber}}/g, invoiceNumber)
      .replace(/{{billingPeriod}}/g, billingPeriod)
      .replace(/{{issueDate}}/g, issueDate)
      .replace(/{{dueDate}}/g, dueDate);
    const body = (additional.body || template.body)
      .replace(/{{clientName}}/g, clientName)
      .replace(/{{contact}}/g, contactName)
      .replace(/{{role}}/g, roleName)
      .replace(/{{duration}}/g, duration)
      .replace(/{{invoiceNumber}}/g, invoiceNumber)
      .replace(/{{billingPeriod}}/g, billingPeriod)
      .replace(/{{issueDate}}/g, issueDate)
      .replace(/{{dueDate}}/g, dueDate);
    return { subject, body };
  }

  function renderEmailTemplateOptions(selectedId = '') {
    const select = $('#emailTemplateSelect');
    const deleteButton = $('#deleteEmailTemplateButton');
    if (!select || !deleteButton) return;
    select.innerHTML = '<option value="">Start from scratch</option>' + (data.emailTemplates || []).map(template => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`).join('');
    select.value = selectedId;
    deleteButton.hidden = !selectedId;
  }

  function updateComposeAttachmentDisplay() {
    const fileName = composeAttachmentFile?.name || composeAttachment?.name || '';
    const label = $('#composeAttachmentName');
    const removeButton = $('#removeComposeAttachmentButton');
    if (label) label.textContent = fileName ? `Attachment: ${fileName}` : '';
    if (removeButton) removeButton.hidden = !fileName;
  }

  function setEmailComposeStatus(message, type = 'info') {
    const status = $('#emailComposeStatus');
    if (!status) return;
    const classType = type === 'error' ? 'alert' : type;
    status.textContent = message;
    status.className = `compose-status status-${classType}`;
  }

  function openEmailComposer(emailId) {
    const emailItem = data.emails.find(item => item.id === emailId);
    if (!emailItem) return;
    const matches = matchApplicationsForEmail(emailItem);
    const matchedClient = matches[0];
    const recipient = isEmailAddress(matchedClient?.email) ? matchedClient.email : extractEmailAddress(emailItem.from);
    composeClientId = null;
    composeActivationClientId = null;
    composeAttachment = null;
    composeAttachmentFile = null;
    composeInvoiceDraft = null;
    composeDocumentUpdateClientId = null;
    composeRequiresConfirmation = false;
    $('#composeAttachmentInput').value = '';
    $('#composeTo').value = recipient;
    $('#composeSubject').value = emailItem.subject?.toLowerCase().startsWith('re:') ? emailItem.subject : `Re: ${emailItem.subject || ''}`.trim();
    $('#composeBody').value = '';
    $('#emailTemplateName').value = '';
    setEmailComposeStatus(gmailAccessToken ? 'Ready to send through Gmail.' : 'Gmail will connect automatically when you send.');
    updateComposeAttachmentDisplay();
    renderEmailTemplateOptions();
    $('#emailComposeModal').showModal();
    $('#composeBody').focus();
  }

  function openClientEmailComposer(application) {
    if (!application?.email) {
      toast('Add a client email before sending a message.');
      return;
    }
    $('#composeTo').value = application.email;
    composeClientId = application.id;
    composeActivationClientId = application.activePendingEmail ? application.id : null;
    composeAttachmentFile = null;
    composeInvoiceDraft = null;
    composeDocumentUpdateClientId = null;
    composeRequiresConfirmation = false;
    $('#composeAttachmentInput').value = '';
    const document = application.documents?.[application.documents.length - 1];
    composeAttachment = document || null;
    const template = buildDocumentEmailTemplate('contract-signing', application);
    $('#composeSubject').value = template.subject;
    $('#composeBody').value = template.body;
    $('#emailTemplateName').value = '';
    setEmailComposeStatus(gmailAccessToken
      ? `Review the details, then send through Gmail. Attachment: ${document?.name || 'none'}`
      : 'Gmail will connect automatically when you send.');
    updateComposeAttachmentDisplay();
    renderEmailTemplateOptions();
    $('#emailComposeModal').showModal();
    $('#composeBody').focus();
  }

  function openPlainClientEmailComposer(application) {
    if (!application?.email) {
      toast('Add a client email before sending a message.');
      return;
    }
    composeClientId = application.id;
    composeActivationClientId = null;
    composeAttachment = null;
    composeAttachmentFile = null;
    composeInvoiceDraft = null;
    composeDocumentUpdateClientId = null;
    composeRequiresConfirmation = false;
    $('#composeAttachmentInput').value = '';
    $('#composeTo').value = application.email;
    $('#composeSubject').value = '';
    $('#composeBody').value = '';
    $('#emailTemplateName').value = '';
    setEmailComposeStatus(gmailAccessToken
      ? 'Ready to send through Gmail.'
      : 'Gmail will connect automatically when you send.');
    updateComposeAttachmentDisplay();
    renderEmailTemplateOptions();
    $('#emailComposeModal').showModal();
    $('#composeSubject').focus();
  }

  function openProceedEmailComposer(application) {
    if (!application?.email) {
      toast('Add a client email before sending a message.');
      return;
    }
    if (!String(application.role || '').trim()) {
      toast('Add a role or service before sending the proceed email.');
      return;
    }
    composeClientId = application.id;
    composeActivationClientId = null;
    composeAttachment = null;
    composeAttachmentFile = null;
    composeInvoiceDraft = null;
    composeDocumentUpdateClientId = null;
    composeRequiresConfirmation = true;
    $('#composeAttachmentInput').value = '';
    const template = buildDocumentEmailTemplate('proceed-application', application);
    $('#composeTo').value = application.email;
    $('#composeSubject').value = template.subject;
    $('#composeBody').value = template.body;
    $('#emailTemplateName').value = '';
    setEmailComposeStatus(gmailAccessToken
      ? 'Review the application email before sending through Gmail. You can attach a resume or CV if needed.'
      : 'Review the application email. Gmail will connect when you send. You can attach a resume or CV if needed.');
    updateComposeAttachmentDisplay();
    renderEmailTemplateOptions();
    $('#emailComposeModal').showModal();
    $('#composeBody').focus();
  }

  function openInvoiceComposer(application, file, invoice) {
    composeClientId = null;
    composeActivationClientId = null;
    composeDocumentUpdateClientId = null;
    composeRequiresConfirmation = false;
    composeAttachment = null;
    composeAttachmentFile = file;
    $('#composeAttachmentInput').value = '';
    composeInvoiceDraft = { ...invoice, clientId: application.id, fileName: file.name };
    const template = buildDocumentEmailTemplate('invoice', application, {
      invoiceNumber: invoice.invoiceNumber,
      billingPeriod: invoice.billingPeriod,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      role: invoice.service || application.role || 'services'
    });
    $('#composeTo').value = application.email;
    $('#composeSubject').value = template.subject;
    $('#composeBody').value = template.body;
    $('#emailTemplateName').value = '';
    setEmailComposeStatus(`Review the invoice email, then send through Gmail. Attachment: ${file.name}`);
    renderEmailTemplateOptions();
    $('#emailComposeModal').showModal();
    $('#composeBody').focus();
  }

  function openUpdatedDocumentEmailComposer(application, documentId = null) {
    const document = application?.documents?.find(item => item.id === documentId) || application?.documents?.[application.documents.length - 1];
    if (!application || !document) return;
    composeClientId = null;
    composeActivationClientId = null;
    composeInvoiceDraft = null;
    composeDocumentUpdateClientId = application.id;
    composeAttachment = document;
    composeAttachmentFile = null;
    composeRequiresConfirmation = false;
    $('#composeAttachmentInput').value = '';
    const template = buildDocumentEmailTemplate('updated-contract', application);
    $('#composeTo').value = application.email || '';
    $('#composeSubject').value = template.subject;
    $('#composeBody').value = template.body;
    $('#emailTemplateName').value = '';
    setEmailComposeStatus(gmailAccessToken ? `Review the updated document email, then send through Gmail. Attachment: ${document.name}` : 'Gmail will connect automatically when you send.');
    renderEmailTemplateOptions();
    $('#emailComposeModal').showModal();
    $('#composeBody').focus();
  }

  function openEmailDetail(emailId) {
    const emailItem = data.emails.find(item => item.id === emailId);
    if (!emailItem) return;
    const isSent = emailItem.direction === 'sent';
    const recipient = isSent ? emailItem.to : extractEmailAddress(emailItem.from);
    $('#emailDetailEyebrow').textContent = isSent ? 'SENT EMAIL' : 'EMAIL DETAILS';
    $('#emailDetailTitle').textContent = emailItem.subject || '(No subject)';
    $('#emailDetailFrom').textContent = isSent ? 'You' : (emailItem.from || 'Unknown sender');
    $('#emailDetailTo').textContent = recipient || 'Not available';
    $('#emailDetailDateLabel').textContent = isSent ? 'Sent' : 'Received';
    $('#emailDetailDate').textContent = emailDate(emailItem.date);
    $('#emailDetailBody').textContent = `${emailContentText(emailItem.body) || 'This inbox sync stores message headers only. Open the message in Gmail to read its full content.'}${emailItem.attachmentName ? `\n\nAttachment: ${emailItem.attachmentName}` : ''}`;
    $('#emailDetailStatus').textContent = isSent ? 'This message was sent from Jeff VA.' : 'Reply from this client directly through Gmail.';
    const composeButton = $('#emailDetailComposeButton');
    composeButton.hidden = isSent || !isEmailAddress(recipient);
    composeButton.dataset.composeEmail = emailItem.id;
    $('#emailDetailModal').showModal();
  }

  function applyEmailTemplate(templateId) {
    const template = (data.emailTemplates || []).find(item => item.id === templateId);
    $('#deleteEmailTemplateButton').hidden = !template;
    if (!template) return;
    $('#composeSubject').value = template.subject;
    $('#composeBody').value = template.body;
  }

  function saveEmailTemplate() {
    const name = $('#emailTemplateName').value.trim();
    const subject = $('#composeSubject').value.trim();
    const body = $('#composeBody').value.trim();
    if (!name || !subject || !body) {
      setEmailComposeStatus('Add a template name, subject, and message first.', 'error');
      return;
    }
    data.emailTemplates = data.emailTemplates || [];
    const existing = data.emailTemplates.find(template => template.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.subject = subject;
      existing.body = body;
      renderEmailTemplateOptions(existing.id);
    } else {
      const template = { id: uid(), name, subject, body };
      data.emailTemplates.push(template);
      renderEmailTemplateOptions(template.id);
    }
    persist();
    $('#emailTemplateName').value = '';
    setEmailComposeStatus('Template saved.', 'success');
  }

  async function deleteEmailTemplate() {
    const templateId = $('#emailTemplateSelect').value;
    if (!templateId || !(await appConfirm('Delete this email template?', { title: 'Delete email template', confirmLabel: 'Delete', danger: true }))) return;
    data.emailTemplates = (data.emailTemplates || []).filter(template => template.id !== templateId);
    persist();
    renderEmailTemplateOptions();
    setEmailComposeStatus('Template deleted.', 'success');
  }

  function encodeBase64Url(value) {
    return encodeBase64UrlBytes(new TextEncoder().encode(value));
  }

  function encodeBase64UrlBytes(bytes) {
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function encodeBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  }

  function wrapBase64(value) {
    return value.match(/.{1,76}/g)?.join('\r\n') || '';
  }

  function decodeGmailBody(value) {
    if (!value) return '';
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function emailContentText(value = '') {
    if (!value) return '';
    if (!/<[a-z][\s\S]*>/i.test(value)) return value.trim();
    const parsed = new DOMParser().parseFromString(value, 'text/html');
    parsed.querySelectorAll('script, style, noscript, template, comment').forEach(node => node.remove());
    parsed.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
    parsed.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6').forEach(node => node.append('\n'));
    return (parsed.body?.textContent || '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function gmailMessageBody(payload) {
    if (!payload) return '';
    if (payload.body?.data) return emailContentText(decodeGmailBody(payload.body.data));
    for (const part of payload.parts || []) {
      const body = gmailMessageBody(part);
      if (body && part.mimeType === 'text/plain') return body;
    }
    for (const part of payload.parts || []) {
      const body = gmailMessageBody(part);
      if (body) return emailContentText(body);
    }
    return '';
  }

  function requestGmailAccessToken(prompt = '') {
    if (!window.google?.accounts?.oauth2 || !gmailConfigured()) return Promise.reject(new Error('Gmail is not configured.'));
    if (gmailTokenRequest) return gmailTokenRequest;
    gmailTokenRequest = new Promise((resolve, reject) => {
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: window.GMAIL_CLIENT_ID,
        scope: GMAIL_SCOPE,
        callback: response => {
          if (response.error || !response.access_token) {
            reject(new Error(response.error_description || response.error || 'Gmail authorization was not completed.'));
            return;
          }
          gmailAccessToken = response.access_token;
          sessionStorage.setItem(GMAIL_TOKEN_SESSION_KEY, response.access_token);
          sessionStorage.setItem(GMAIL_CONNECTED_KEY, '1');
          updateGmailConnectionUI(true);
          updateLoginGoogleUI(true, 'Google account connected for this browser session.');
          resolve(response.access_token);
        }
      });
      tokenClient.requestAccessToken({ prompt });
    }).finally(() => { gmailTokenRequest = null; });
    return gmailTokenRequest;
  }

  async function ensureGmailAccessToken() {
    if (gmailAccessToken) return gmailAccessToken;
    try {
      return await requestGmailAccessToken('');
    } catch {
      return requestGmailAccessToken('consent');
    }
  }

  async function sendGmailRaw(rawMessage) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await ensureGmailAccessToken();
      const response = await fetch(GMAIL_SEND_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${gmailAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: encodeBase64Url(rawMessage) })
      });
      if (response.ok) return response;
      if ((response.status === 401 || response.status === 403) && attempt === 0) {
        gmailAccessToken = null;
        await requestGmailAccessToken('');
        continue;
      }
      if (response.status === 401 || response.status === 403) handleGmailAuthorizationFailure();
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Gmail returned ${response.status}`);
    }
    throw new Error('Gmail could not send the message.');
  }

  async function sendComposedEmail() {
    const to = $('#composeTo').value.trim();
    const subject = $('#composeSubject').value.trim().replace(/[\r\n]+/g, ' ');
    const body = $('#composeBody').value.trim();
    if (!to || !subject || !body || !isEmailAddress(to)) {
      setEmailComposeStatus('Enter a valid recipient, subject, and message.', 'error');
      return;
    }
    if (composeDocumentUpdateClientId && !(await appConfirm('Send the updated document to this client now?', { title: 'Send updated document', confirmLabel: 'Send' }))) return;
    if (composeRequiresConfirmation && !(await appConfirm(`Send this application email to ${to}?`, { title: 'Confirm email', confirmLabel: 'Send' }))) return;
    const sendButton = $('#sendEmailButton');
    sendButton.disabled = true;
    setEmailComposeStatus('Sending through Gmail...');
    try {
      let rawMessage;
      if (composeAttachment || composeAttachmentFile) {
        const attachmentBlob = composeAttachmentFile || await getDocumentBlob(composeAttachment.storagePath || composeAttachment.id);
        const attachmentBytes = new Uint8Array(await attachmentBlob.arrayBuffer());
        const attachmentName = composeAttachment?.name || composeAttachmentFile?.name || 'attachment';
        const attachmentType = composeAttachment?.type || attachmentBlob.type || 'application/octet-stream';
        const attachmentBase64 = wrapBase64(encodeBase64(attachmentBytes));
        rawMessage = buildRawEmailMessage({
          to,
          subject,
          body,
          attachmentName,
          attachmentType,
          attachmentBase64
        });
      } else {
        rawMessage = buildRawEmailMessage({ to, subject, body });
      }
      await sendGmailRaw(rawMessage);
      data.emails.unshift({
        id: uid(),
        applicationId: composeClientId || composeActivationClientId || composeDocumentUpdateClientId || '',
        from: 'You',
        to,
        subject,
        body,
        date: new Date().toISOString(),
        importedAt: new Date().toISOString(),
        source: 'sent',
        direction: 'sent',
        attachmentName: composeAttachment?.name || composeAttachmentFile?.name || ''
      });
      if (composeInvoiceDraft) {
        data.invoices = data.invoices || [];
        data.invoices.unshift({ id: uid(), ...composeInvoiceDraft, sentAt: new Date().toISOString() });
      }
      const activatingClient = composeActivationClientId && data.applications.find(item => item.id === composeActivationClientId);
      const updatingClient = composeDocumentUpdateClientId && data.applications.find(item => item.id === composeDocumentUpdateClientId);
      if (activatingClient?.activePendingEmail) {
        activatingClient.activePendingEmail = false;
        activatingClient.updatedAt = new Date().toISOString();
        clearActivationRollback();
      }
      if (updatingClient?.documentEmailPending) {
        updatingClient.documentEmailPending = false;
        updatingClient.documentEmailReminderDate = '';
        updatingClient.documentEmailReminderAlertedDate = '';
        updatingClient.updatedAt = new Date().toISOString();
      }
      persist();
      renderAll();
      $('#emailComposeModal').close();
      let successMessage = 'Email sent successfully through Gmail.';
      if (activatingClient) {
        showView('hired');
        renderHiredDetail(activatingClient);
        successMessage = 'Email sent successfully. Client moved to Active Clients.';
      } else if (updatingClient) {
        showView('hired');
        renderHiredDetail(updatingClient);
        successMessage = 'Updated document email sent successfully.';
      }
      if (composeInvoiceDraft) {
        successMessage = 'Invoice sent successfully and added to this client\'s history.';
      }
      showEmailActionResult({ title: 'Email sent', message: successMessage });
      toast(successMessage);
      composeAttachmentFile = null;
      composeInvoiceDraft = null;
      composeClientId = null;
      composeActivationClientId = null;
      composeDocumentUpdateClientId = null;
      composeRequiresConfirmation = false;
    } catch (error) {
      console.error(error);
      const failureMessage = `${error.message} Google authorization may be required.`;
      setEmailComposeStatus(failureMessage, 'error');
      showEmailActionResult({ title: 'Email not sent', message: failureMessage, status: 'error' });
    } finally {
      sendButton.disabled = false;
    }
  }

  function gmailConfigured() {
    const clientId = window.GMAIL_CLIENT_ID;
    return Boolean(clientId && !clientId.includes('YOUR_CLIENT_ID'));
  }

  function updateGmailConnectionUI() {}

  function updateLoginGoogleUI(connected, message) {
    const button = $('#loginGoogleButton');
    const status = $('#loginGoogleStatus');
    if (button) {
      button.textContent = connected ? 'Google account connected' : 'Log in with Google';
      button.classList.toggle('button-secondary', !connected);
      button.classList.toggle('button-success', connected);
    }
    if (status && message) status.textContent = message;
  }

  function setGmailStatus(message) {
    const status = $('#gmailStatus');
    if (status) status.textContent = message;
  }

  function initGmail() {
    updateGmailConnectionUI(false);
    updateLoginGoogleUI(false, 'Use your Google account to open the dashboard.');
    const loginGoogleButton = $('#loginGoogleButton');
    loginGoogleButton.disabled = !supabaseConfigured();
    if (!window.google?.accounts?.oauth2) {
      setTimeout(initGmail, 300);
      return;
    }
    if (!gmailConfigured()) {
      setGmailStatus('Gmail not set up yet — you can still log in with Google to open the dashboard.');
      loginGoogleButton.disabled = !supabaseConfigured();
      return;
    }
    gmailTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: window.GMAIL_CLIENT_ID,
      scope: GMAIL_SCOPE,
      callback: response => {
        if (response.error) {
          const message = response.error_description || response.error;
          setGmailStatus(`Gmail connection failed: ${message}`);
          toast(`Gmail connection failed: ${message}`);
          return;
        }
        gmailAccessToken = response.access_token;
        sessionStorage.setItem(GMAIL_TOKEN_SESSION_KEY, response.access_token);
        sessionStorage.setItem(GMAIL_CONNECTED_KEY, '1');
        updateLoginGoogleUI(true, 'Google account selected. Log in to load your Gmail inbox.');
        setGmailStatus('Connected — syncing…');
        processContractEndedAlerts();
        processDueFollowUps();
        syncGmail();
        startGmailSyncTimer();
      }
    });
    loginGoogleButton.disabled = false;
    const savedSessionToken = sessionStorage.getItem(GMAIL_TOKEN_SESSION_KEY);
    if (savedSessionToken) {
      gmailAccessToken = savedSessionToken;
      updateGmailConnectionUI(true);
      updateLoginGoogleUI(true, 'Google account connected for this browser session.');
      setGmailStatus('Gmail connected — session restored');
      processContractEndedAlerts();
      syncGmail();
      startGmailSyncTimer();
      return;
    }
    if (sessionStorage.getItem(GMAIL_CONNECTED_KEY)) {
      setGmailStatus('Gmail authorized previously — log in with Google to sync');
    } else {
      setGmailStatus('Gmail ready — log in with Google to sync your inbox');
    }
  }

  async function loginWithGoogle() {
    if (!supabaseConfigured()) {
      $('#loginError').textContent = 'Supabase is not configured yet. Fill in js/supabase-config.js first.';
      return;
    }
    $('#loginGoogleButton').disabled = true;
    $('#loginGoogleStatus').textContent = 'Opening Google sign-in…';
    try {
      const { error } = await requireSupabase().auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}${window.location.pathname}`,
          scopes: GMAIL_SCOPE
        }
      });
      if (error) throw error;
    } catch (error) {
      console.error(error);
      const providerDisabled = error?.error_code === 'validation_failed' && error?.msg?.includes('provider is not enabled');
      $('#loginError').textContent = providerDisabled
        ? 'Google login is disabled in Supabase. Enable Google under Authentication > Providers, then try again.'
        : 'Google sign-in could not start. Check your Supabase Google provider settings.';
      $('#loginGoogleStatus').textContent = 'Use your Google account to open the dashboard.';
      $('#loginGoogleButton').disabled = false;
    }
  }

  function disconnectGmail() {
    if (gmailAccessToken && window.google?.accounts?.oauth2?.revoke) {
      google.accounts.oauth2.revoke(gmailAccessToken, () => {});
    }
    gmailAccessToken = null;
    sessionStorage.removeItem(GMAIL_TOKEN_SESSION_KEY);
    sessionStorage.removeItem(GMAIL_CONNECTED_KEY);
    if (gmailSyncTimer) { clearInterval(gmailSyncTimer); gmailSyncTimer = null; }
    updateGmailConnectionUI(false);
    updateLoginGoogleUI(false, 'Use your Google account to open the dashboard.');
    setGmailStatus('Gmail ready — log in with Google to sync your inbox');
    toast('Disconnected from Gmail');
  }

  function handleGmailAuthorizationFailure() {
    gmailAccessToken = null;
    sessionStorage.removeItem(GMAIL_TOKEN_SESSION_KEY);
    sessionStorage.removeItem(GMAIL_CONNECTED_KEY);
    if (gmailSyncTimer) { clearInterval(gmailSyncTimer); gmailSyncTimer = null; }
    updateGmailConnectionUI(false);
    updateLoginGoogleUI(false, 'Google authorization expired. Use Gmail reconnect in the dashboard.');
    setGmailStatus('Gmail authorization expired — log in with Google again');
  }

  function startGmailSyncTimer() {
    if (gmailSyncTimer) clearInterval(gmailSyncTimer);
    gmailSyncTimer = setInterval(() => {
      if (currentUser && gmailAccessToken) syncGmail(true);
    }, 10000);
  }

  async function syncGmail(silent = false) {
    // Do not let a restored Gmail session sync against the empty startup state.
    // The authenticated startup flow triggers the first sync after saved deletions load.
    if (gmailSyncInFlight || !gmailAccessToken || !currentUser || !dataReady || !supabaseDataLoaded) return;
    gmailSyncInFlight = true;
    try {
      const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=30&labelIds=INBOX', {
        headers: { Authorization: `Bearer ${gmailAccessToken}` }
      });
      if (listRes.status === 401 || listRes.status === 403) {
        handleGmailAuthorizationFailure();
        throw new Error('Gmail authorization expired. Log in with Google again.');
      }
      if (!listRes.ok) throw new Error('list failed');
      const listData = await listRes.json();
      const deletedGmailIds = new Set(data.deletedGmailIds || []);
      const ids = (listData.messages || []).map(message => message.id).filter(id => !deletedGmailIds.has(id));
      const previousGmailIds = new Set(data.emails.filter(item => item.source === 'gmail').map(item => item.gmailId));
      const newIds = ids.filter(id => !previousGmailIds.has(id));
      const fetchedNewMessages = await Promise.all(newIds.map(async id => {
        const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
          headers: { Authorization: `Bearer ${gmailAccessToken}` }
        });
        if (!res.ok) throw new Error(`message fetch failed (${res.status})`);
        const msg = await res.json();
        const headers = msg.payload?.headers || [];
        const header = name => headers.find(item => item.name === name)?.value || '';
        const rawDate = header('Date');
        const date = rawDate && !Number.isNaN(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : new Date().toISOString();
        return { id: `gmail-${id}`, gmailId: id, from: header('From') || 'Unknown sender', subject: header('Subject') || '(No subject)', body: gmailMessageBody(msg.payload), date, importedAt: new Date().toISOString(), source: 'gmail' };
      }));
      // A user can delete an email while this sync is fetching message details.
      // Re-read the deletion list before merging so an older response cannot revive it.
      const currentDeletedGmailIds = new Set(data.deletedGmailIds || []);
      const activeIds = ids.filter(id => !currentDeletedGmailIds.has(id));
      const existingGmailMessages = data.emails.filter(item => item.source === 'gmail' && activeIds.includes(item.gmailId));
      const newOnes = fetchedNewMessages.filter(item => !currentDeletedGmailIds.has(item.gmailId));
      const emailCountBeforeMerge = data.emails.length;
      data.emails = dedupeEmails([
        ...data.emails.filter(item => item.source !== 'gmail' || (!activeIds.includes(item.gmailId) && !currentDeletedGmailIds.has(item.gmailId))),
        ...existingGmailMessages,
        ...newOnes
      ]).filter(item => !(item.source === 'gmail' && currentDeletedGmailIds.has(item.gmailId)));
      if (newOnes.length || data.emails.length !== emailCountBeforeMerge) {
        persist();
        renderAll();
      }
      updateGmailConnectionUI(true);
      sessionStorage.setItem(GMAIL_CONNECTED_KEY, '1');
      setGmailStatus(`Connected — ${plural(activeIds.length, 'message')}${newOnes.length ? ` · ${plural(newOnes.length, 'new message')} just now` : ''}`);
      if (!silent && !alertNewMatches(newOnes)) toast('Gmail inbox synced');
      if (silent) alertNewMatches(newOnes);
    } catch (error) {
      const message = error?.message || 'Unknown Gmail API error';
      setGmailStatus(`Gmail sync failed: ${message}`);
      if (!silent) toast(`Gmail sync failed: ${message}`);
    } finally {
      gmailSyncInFlight = false;
    }
  }

