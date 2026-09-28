  // Inbox and shared email composer controls.
  document.addEventListener('click', async event => {
    const actionTrigger = event.target.closest('[data-email-action-trigger]');
    const actionButton = event.target.closest('[data-email-action]');
    const emailDetail = event.target.closest('[data-email-detail]');

    if (actionTrigger) {
      event.stopPropagation();
      const menu = document.querySelector(`[data-email-actions-menu="${actionTrigger.dataset.emailActionTrigger}"]`);
      if (!menu) return;
      const willOpen = menu.classList.contains('hidden');
      document.querySelectorAll('.email-actions-menu').forEach(panel => {
        if (panel !== menu) panel.classList.add('hidden');
      });
      menu.classList.toggle('hidden', !willOpen);
      actionTrigger.setAttribute('aria-expanded', String(willOpen));
      return;
    }

    if (actionButton) {
      event.stopPropagation();
      const emailId = actionButton.dataset.emailId;
      if (actionButton.dataset.emailAction === 'compose') {
        openEmailComposer(emailId);
        return;
      }
      if (actionButton.dataset.emailAction === 'delete') {
        const email = data.emails.find(item => item.id === emailId);
        if (!email || !(await appConfirm(`Are you sure you want to delete this email from your list?\n\n${email.subject || '(No subject)'}`, { title: 'Remove email', confirmLabel: 'Remove', danger: true }))) return;
        data.emails = data.emails.filter(item => item.id !== emailId);
        if (email.source === 'gmail' && email.gmailId) {
          data.deletedGmailIds = [...new Set([...(data.deletedGmailIds || []), email.gmailId])];
          data.emails = data.emails.filter(item => !(item.source === 'gmail' && item.gmailId === email.gmailId));
        }
        renderAll();
        await persist();
        toast('Email removed from this list');
      }
      document.querySelectorAll('.email-actions-menu').forEach(menu => menu.classList.add('hidden'));
      document.querySelectorAll('[data-email-action-trigger]').forEach(trigger => trigger.setAttribute('aria-expanded', 'false'));
      return;
    }

    if (!event.target.closest('.email-actions-trigger') && !event.target.closest('.email-actions-menu')) {
      document.querySelectorAll('.email-actions-menu').forEach(menu => menu.classList.add('hidden'));
      document.querySelectorAll('[data-email-action-trigger]').forEach(trigger => trigger.setAttribute('aria-expanded', 'false'));
    }

    if (emailDetail && !event.target.closest('button')) openEmailDetail(emailDetail.dataset.emailDetail);
  });

  $('#emailSearch').addEventListener('input', renderEmails);
  $('#emailDateFilter').addEventListener('change', event => {
    emailDateFilter = event.target.value;
    renderEmails();
  });
  $('#emailDateSort').addEventListener('change', event => {
    emailDateSort = event.target.value;
    localStorage.setItem(EMAIL_WEEK_FILTER_KEY, emailDateSort);
    renderEmails();
    updateWeekNavigationCounts();
  });
  $$('[data-email-view]').forEach(tab => tab.addEventListener('click', () => {
    emailViewFilter = tab.dataset.emailView;
    renderEmails();
  }));
  $('#emailTemplateSelect').addEventListener('change', event => applyEmailTemplate(event.target.value));
  $('#saveEmailTemplateButton').addEventListener('click', saveEmailTemplate);
  $('#deleteEmailTemplateButton').addEventListener('click', deleteEmailTemplate);
  $('#attachFileButton').addEventListener('click', () => $('#composeAttachmentInput').click());
  $('#removeComposeAttachmentButton').addEventListener('click', () => {
    composeAttachment = null;
    composeAttachmentFile = null;
    $('#composeAttachmentInput').value = '';
    updateComposeAttachmentDisplay();
    setEmailComposeStatus('Attachment removed. Review the email before sending.');
  });
  $('#composeAttachmentInput').addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (!file) {
      composeAttachment = null;
      composeAttachmentFile = null;
      updateComposeAttachmentDisplay();
      return;
    }
    composeAttachment = null;
    composeAttachmentFile = file;
    updateComposeAttachmentDisplay();
    setEmailComposeStatus(`Resume/CV attached: ${file.name}. Review before sending.`);
  });
  $('#sendEmailButton').addEventListener('click', sendComposedEmail);
  $('#emailDetailComposeButton').addEventListener('click', event => {
    const emailId = event.currentTarget.dataset.composeEmail;
    $('#emailDetailModal').close();
    openEmailComposer(emailId);
  });
