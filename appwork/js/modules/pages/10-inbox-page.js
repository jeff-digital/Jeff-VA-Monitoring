  // Inbox and shared email composer controls.
  function removeEmailsFromList(emails) {
    const emailIds = new Set(emails.map(email => email.id));
    const gmailIds = new Set(emails.map(email => email.gmailId).filter(Boolean));
    data.deletedGmailIds = [...new Set([...(data.deletedGmailIds || []), ...gmailIds])];
    data.emails = data.emails.filter(email => !emailIds.has(email.id)
      && !(email.source === 'gmail' && gmailIds.has(email.gmailId)));
  }

  function updateEmailSelectionControls() {
    const checkboxes = [...document.querySelectorAll('#emailList [data-email-select]')];
    const selectedCount = checkboxes.filter(checkbox => checkbox.checked).length;
    const selectAll = document.querySelector('#emailSelectionActions [data-email-select-all]');
    const deleteButton = document.querySelector('#emailSelectionActions [data-email-bulk-delete]');
    const selectionCount = document.querySelector('#emailSelectionActions [data-email-selection-count]');
    if (selectAll) {
      selectAll.checked = checkboxes.length > 0 && selectedCount === checkboxes.length;
      selectAll.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
      selectAll.disabled = checkboxes.length === 0;
    }
    if (deleteButton) {
      deleteButton.disabled = selectedCount === 0;
    }
    if (selectionCount) selectionCount.textContent = `${selectedCount} selected`;
  }

  document.addEventListener('click', async event => {
    if (event.target.closest('[data-email-selection-toggle]')) {
      emailSelectionMode = !emailSelectionMode;
      renderEmails();
      return;
    }

    if (event.target.closest('[data-email-select], [data-email-select-all]')) return;

    if (event.target.closest('[data-email-bulk-delete]')) {
      const selectedIds = new Set([...document.querySelectorAll('#emailList [data-email-select]:checked')].map(input => input.value));
      const selectedEmails = data.emails.filter(email => selectedIds.has(email.id));
      if (!selectedEmails.length || !(await appConfirm(`Are you sure you want to delete ${selectedEmails.length} selected email${selectedEmails.length === 1 ? '' : 's'} from your list?`, { title: 'Remove selected emails', confirmLabel: 'Remove', danger: true }))) return;
      removeEmailsFromList(selectedEmails);
      emailSelectionMode = false;
      renderAll();
      await persist();
      showActionResult({ title: 'Emails removed', message: `${selectedEmails.length} selected email${selectedEmails.length === 1 ? ' was' : 's were'} removed from your saved list.` });
      return;
    }

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
        removeEmailsFromList([email]);
        renderAll();
        await persist();
        showActionResult({ title: 'Email removed', message: 'The email was removed from your saved list.' });
      }
      document.querySelectorAll('.email-actions-menu').forEach(menu => menu.classList.add('hidden'));
      document.querySelectorAll('[data-email-action-trigger]').forEach(trigger => trigger.setAttribute('aria-expanded', 'false'));
      return;
    }

    if (!event.target.closest('.email-actions-trigger') && !event.target.closest('.email-actions-menu')) {
      document.querySelectorAll('.email-actions-menu').forEach(menu => menu.classList.add('hidden'));
      document.querySelectorAll('[data-email-action-trigger]').forEach(trigger => trigger.setAttribute('aria-expanded', 'false'));
    }

    if (emailDetail && (!event.target.closest('button') || event.target.closest('button[data-email-detail]'))) {
      openEmailDetail(emailDetail.dataset.emailDetail);
    }
  });

  document.addEventListener('change', event => {
    if (event.target.matches('[data-email-select-all]')) {
      document.querySelectorAll('#emailList [data-email-select]').forEach(checkbox => {
        checkbox.checked = event.target.checked;
      });
      updateEmailSelectionControls();
    } else if (event.target.matches('[data-email-select]')) {
      updateEmailSelectionControls();
    }
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
