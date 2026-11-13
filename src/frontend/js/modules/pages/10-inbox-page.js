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
    $('#emailList').classList.toggle('inbox-has-selection', selectedCount > 0);
    for (const checkbox of checkboxes) checkbox.closest('.email-row')?.classList.toggle('is-selected', checkbox.checked);
    const actions = $('#emailSelectionActions');
    const contextual = selectedCount > 0 || emailSelectionMode;
    actions.querySelector('.email-bulk-actions').hidden = !contextual;
    actions.querySelector('.email-selection-trigger').hidden = contextual;
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
    if (event.target.closest('[data-inbox-clear-filters]')) {
      $('#emailSearch').value = '';
      $('#emailDateFilter').value = '';
      $('#emailDateEndFilter').value = '';
      emailDateFilter = '';
      $('#emailDateSort').value = 'all';
      $('#emailDateSort').dispatchEvent(new Event('change'));
      $('#emailSearch').focus();
      return;
    }
    if (event.target.closest('[data-email-selection-toggle]')) {
      if (event.target.closest('.email-selection-cancel')) {
        $$('#emailList [data-email-select]:checked').forEach(input => { input.checked = false; });
        emailSelectionMode = false;
        updateEmailSelectionControls();
        $('#emailSelectionActions .email-selection-trigger').focus();
        return;
      }
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
      document.querySelectorAll('[data-email-action-trigger]').forEach(button => button.setAttribute('aria-expanded', 'false'));
      menu.classList.toggle('hidden', !willOpen);
      actionTrigger.setAttribute('aria-expanded', String(willOpen));
      if (willOpen) {
        const listBounds = $('#emailList').getBoundingClientRect();
        const triggerBounds = actionTrigger.getBoundingClientRect();
        menu.classList.toggle('opens-up', listBounds.bottom - triggerBounds.bottom < menu.offsetHeight + 4
          && triggerBounds.top - listBounds.top >= menu.offsetHeight + 4);
        menu.querySelector('button')?.focus();
      }
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
  for (const [id, step] of [['inboxPreviousPage', -1], ['inboxNextPage', 1]]) {
    $('#' + id).addEventListener('click', event => {
      $$('#emailList [data-email-select]:checked').forEach(input => { input.checked = false; });
      inboxPage += step;
      renderEmails();
      $('#emailList').scrollTop = 0;
      if (event.currentTarget.disabled) {
        $(step > 0 ? '#inboxPreviousPage' : '#inboxNextPage').focus({ preventScroll: true });
      }
    });
  }
  $('#emailDateFilter').addEventListener('change', event => {
    emailDateFilter = event.target.value;
    if ($('#emailDateEndFilter').value && emailDateFilter > $('#emailDateEndFilter').value) $('#emailDateEndFilter').value = emailDateFilter;
    renderEmails();
  });
  $('#emailDateEndFilter').addEventListener('change', event => {
    if (event.target.value && emailDateFilter > event.target.value) {
      $('#emailDateFilter').value = emailDateFilter = event.target.value;
    }
    renderEmails();
  });
  enhanceWorkspaceSelect($('#emailDateSort'), { labelText: 'Filter emails by week', refreshTarget: $('#inboxView') });
  $('#emailList').addEventListener('keydown', event => {
    const menu = event.target.closest('.email-actions-menu');
    if (menu && event.key === 'Escape') {
      event.preventDefault();
      const trigger = menu.parentElement.querySelector('[data-email-action-trigger]');
      menu.classList.add('hidden');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.focus();
      return;
    }
    const row = event.target;
    if (!row.matches('.email-row')) return;
    const next = event.key === 'ArrowDown' ? row.nextElementSibling : event.key === 'ArrowUp' ? row.previousElementSibling : null;
    if (next?.matches('.email-row')) { event.preventDefault(); next.focus(); }
    if (event.key === 'Enter') { event.preventDefault(); openEmailDetail(row.dataset.emailDetail); }
    if (event.key.toLowerCase() === 'x' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      row.querySelector('[data-email-select]')?.click();
    }
  });
  $('#emailDateSort').addEventListener('change', event => {
    emailDateSort = event.target.value;
    localStorage.setItem(EMAIL_WEEK_FILTER_KEY, emailDateSort);
    renderEmails();
    updateWeekNavigationCounts();
  });
  $$('.email-summary-item').forEach(button => button.addEventListener('click', () => {
    $$('#emailList [data-email-select]:checked').forEach(input => { input.checked = false; });
    emailViewFilter = button.dataset.emailView;
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
