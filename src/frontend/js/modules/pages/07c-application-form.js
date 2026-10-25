  function saveNewClientApplicationDraft() {
    const draft = {};
    $$('#clientForm input[id], #clientForm select[id], #clientForm textarea[id]').forEach(field => {
      if (field.id === 'clientId' || field.type === 'file') return;
      draft[field.id] = field.type === 'checkbox' ? field.checked : field.value;
    });
    draft.socialLinks = readClientSocialLinks({ includeEmpty: true });
    localStorage.setItem(`${APPLICATION_DRAFT_KEY}:${currentUser?.id || 'anonymous'}`, JSON.stringify(draft));
  }

  function restoreNewClientApplicationDraft() {
    const savedDraft = localStorage.getItem(`${APPLICATION_DRAFT_KEY}:${currentUser?.id || 'anonymous'}`);
    if (!savedDraft) return false;

    let draft;
    try {
      draft = JSON.parse(savedDraft);
    } catch (error) {
      console.error('Could not restore the unfinished application:', error);
      showActionResult({ title: 'Unfinished application could not be restored', message: 'The saved draft is invalid and has been kept in browser storage.', status: 'error' });
      return false;
    }
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
      console.error('Could not restore the unfinished application: saved draft has an invalid format.');
      showActionResult({ title: 'Unfinished application could not be restored', message: 'The saved draft has an invalid format and has been kept in browser storage.', status: 'error' });
      return false;
    }

    Object.entries(draft).forEach(([id, value]) => {
      const field = document.getElementById(id);
      if (!field || field.closest('#clientForm') !== $('#clientForm')) return;
      if (field.type === 'checkbox') field.checked = value === true;
      else field.value = String(value ?? '');
    });
    renderClientSocialLinkEditor(Array.isArray(draft.socialLinks) ? draft.socialLinks : []);
    if (!$('#hiredSocial').value && Array.isArray(draft.socialLinks)) {
      $('#hiredSocial').value = String(draft.socialLinks.find(link => link?.url)?.url || '');
    }
    $('#clientPlatform').dispatchEvent(new Event('change'));
    $('#clientCountry').dispatchEvent(new Event('change'));
    if ($('#clientRegion').value) $('#clientRegion').dispatchEvent(new Event('change'));
    updateSalaryFields();
    updateClientActionLabel();
    return true;
  }

  function openClientModal(id = null, viewOnly = false, activeClientOnly = false, drawerEdit = false, activeClientDetailsEdit = false) {
    const form = $('#clientForm');
    form.reset();
    renderClientSocialLinkEditor();
    activeClientDetailsModalEdit = activeClientDetailsEdit;
    $$('#clientForm input, #clientForm select, #clientForm textarea').forEach(field => { field.disabled = false; });
    editingId = id;
    viewingClientDetails = viewOnly;
    $('#clientModal').classList.toggle('application-detail-panel', viewOnly && activeView === 'applications');
    $('#clientId').value = id || '';
    $('#appliedDate').value = id ? '' : today();
    $('#automaticFollowUp').checked = false;
    $('#appliedDate').disabled = false;
    $('#followUpDate').disabled = false;
    $('#automaticFollowUp').disabled = false;
    $('#followUpDate').closest('.form-field')?.classList.remove('hidden');
    $('#automaticFollowUp').closest('.follow-up-option')?.classList.remove('hidden');
    $('#customPlatformField').classList.add('hidden');
    $('#customPlatform').required = false;
    $('#clientCountry').value = '';
    $('#clientRegion').value = '';
    $('#clientRegionField').classList.add('hidden');
    $('#clientFollowUpHistory').classList.add('hidden');
    $('#clientEmailHistory').classList.add('hidden');
    if (id) {
      const item = data.applications.find(application => application.id === id);
      if (!item) return;
      $('#modalEyebrow').textContent = viewOnly ? 'VIEW DETAILS' : 'EDIT RECORD';
      $('#clientModalTitle').textContent = viewOnly ? 'Application details' : 'Update client application';
      $('#saveClientButton').textContent = 'Save changes';
      $('#clientName').value = item.clientName;
      $('#contactName').value = item.contact || '';
      $('#clientRole').value = item.role || '';
      $('#employmentType').value = item.employmentType || '';
      $('#hiredEmail').value = item.email || '';
      $('#hiredPhone').value = item.phone || '';
      $('#hiredWebsite').value = item.website || '';
      $('#hiredSocial').value = item.socialMedia || normalizeClientSocialLinks(item)[0]?.url || '';
      renderClientSocialLinkEditor(normalizeClientSocialLinks(item), viewOnly);
      $('#hiredLocation').value = item.location || '';
      const savedLocation = String(item.location || '');
      const savedCountry = [...$('#clientCountry').options].find(option => savedLocation === option.text || savedLocation.startsWith(`${option.text},`));
      if (savedCountry) {
        $('#clientCountry').value = savedCountry.value;
        $('#clientCountry').dispatchEvent(new Event('change'));
        const savedRegion = [...$('#clientRegion').options].find(option => savedLocation.includes(option.text));
        if (savedRegion) $('#clientRegion').value = savedRegion.value;
        updateClientLocation();
      }
      $('#clientStatus').value = ['Ongoing', 'Applied', 'To Proceed', 'Interview', 'Active client', 'Not selected'].includes(item.status) ? item.status : 'Applied';
      $('#nextStep').value = item.nextStep || '';
      if (activeClientOnly && item.status !== 'Active client') return;
      $('#contractEndDate').value = item.contractEndDate || '';
      $('#appliedDate').value = item.appliedDate || '';
      $('#interviewDate').value = item.interviewDate || '';
      $('#interviewLink').value = item.interviewLink || '';
      $('#followUpDate').value = item.followUpDate || '';
      $('#automaticFollowUp').checked = Boolean(item.automaticFollowUp);
      $('#clientNotes').value = item.notes || '';
      renderClientFollowUpHistory(item, viewOnly);
      renderClientEmailHistory(item);
      const listedPlatforms = [...$('#clientPlatform').options].map(option => option.value);
      if (listedPlatforms.includes(item.platform)) {
        $('#clientPlatform').value = item.platform;
      } else {
        $('#clientPlatform').value = 'Other';
        $('#customPlatformField').classList.remove('hidden');
        $('#customPlatform').required = true;
        $('#customPlatform').value = item.platform;
      }
    } else {
      $('#modalEyebrow').textContent = 'NEW RECORD';
      $('#clientModalTitle').textContent = 'Add a client application';
      $('#saveClientButton').textContent = 'Save application';
      $('#salaryType').value = '';
      $('#salaryCurrency').value = 'USD';
      $('#salaryAmount').value = '';
      $('#salaryHoursPerWeek').value = '';
      updateSalaryFields();
    }
    if (id) {
      const item = data.applications.find(application => application.id === id);
      if (item) {
        $('#salaryType').value = item.salaryType || '';
        $('#salaryCurrency').value = item.salaryCurrency || 'USD';
        $('#salaryAmount').value = item.salaryAmount ?? '';
        $('#salaryHoursPerWeek').value = item.hoursPerWeek ?? '';
        updateSalaryFields();
      }
    }
    if (!id && !viewOnly) restoreNewClientApplicationDraft();
    const showSocialAccountEditor = Boolean(id && activeClientOnly && !viewOnly);
    $('#clientSocialLinksField').hidden = !showSocialAccountEditor;
    $('#hiredSocialField').hidden = showSocialAccountEditor;
    [
      ['#hiredWebsite', '#hiredWebsiteLink'],
      ['#hiredSocial', '#hiredSocialLink']
    ].forEach(([inputSelector, linkSelector]) => {
      const input = $(inputSelector);
      const link = $(linkSelector);
      const value = input.value.trim();
      input.hidden = viewOnly;
      link.hidden = !viewOnly || !value;
      link.textContent = value;
      if (value) link.href = normalizeUrl(value);
    });
    $$('#clientForm input, #clientForm select, #clientForm textarea').forEach(field => { field.disabled = viewOnly; });
    updateClientSocialEditorControls(viewOnly || !showSocialAccountEditor);
    if (activeClientOnly) {
      $('#clientStatus').value = 'Active client';
      $('#clientStatus').disabled = true;
    }
    $('#saveClientButton').hidden = viewOnly;
    $('#closeClientDetailsButton').hidden = !viewOnly;
    $('#clientForm').classList.toggle('view-details-form', viewOnly);
    const activeClientEdit = Boolean(id && data.applications.find(application => application.id === id)?.status === 'Active client' && !viewOnly);
    $('#clientForm').classList.toggle('active-client-edit', activeClientEdit);
    $('#appliedDate').disabled = activeClientEdit;
    $('#followUpDate').disabled = activeClientEdit;
    $('#automaticFollowUp').disabled = activeClientEdit;
    $('#followUpDate').closest('.form-field')?.classList.toggle('hidden', activeClientEdit);
    $('#automaticFollowUp').closest('.follow-up-option')?.classList.toggle('hidden', activeClientEdit);
    if (drawerEdit) {
      showActiveClientDrawerView('edit');
      $('#closeClientDetailsButton').textContent = 'Cancel';
      markActiveClientDrawerFormClean('edit');
    } else {
      $('#clientModal').showModal();
    }
    updateClientActionLabel();
    updateApplicationDuplicateNotice();
    if (drawerEdit) $('#clientName').focus();
    else setTimeout(() => $('#clientName').focus(), 30);
  }

  function renderClientFollowUpHistory(item, viewOnly) {
    const target = $('#clientFollowUpHistory');
    if (!target || !viewOnly) return;
    const clientEmail = String(item.email || '').trim().toLowerCase();
    const followUps = data.emails.filter(email => isSentEmail(email)
      && (email.applicationId === item.id || (clientEmail && String(email.to || '').trim().toLowerCase() === clientEmail && (/^follow(?:ing)?[\s-]*up\b/i.test(email.subject || '') || /I wanted to follow up on my application/i.test(email.body || '')))))
      .sort((first, second) => new Date(second.date) - new Date(first.date));
    const historicalFollowUp = !followUps.length && item.followUpSentAt
      ? [{ date: item.followUpSentAt, subject: `Follow-up: ${item.clientName}`, historical: true }]
      : followUps;
    target.classList.remove('hidden');
    target.innerHTML = `<div class="client-follow-up-history-head"><span>FOLLOW-UPS SENT</span><strong>${plural(historicalFollowUp.length, 'email')}</strong></div>${historicalFollowUp.length
      ? `<div class="client-follow-up-history-list">${historicalFollowUp.map(email => `<div><span title="${escapeHtml(email.subject || 'Follow-up')}">${escapeHtml(email.subject || 'Follow-up')}</span><small>${escapeHtml(emailDate(email.date))}</small></div>`).join('')}</div>`
      : '<p>No follow-up emails have been sent to this application.</p>'}`;
  }

  function renderClientEmailHistory(item) {
    const target = $('#clientEmailHistory');
    const list = $('#clientEmailHistoryList');
    const count = $('#clientEmailHistoryCount');
    if (!target || !list || !count) return;
    const sentEmails = sentEmailsForApplication(item);
    target.classList.remove('hidden');
    count.textContent = `${sentEmails.length} ${sentEmails.length === 1 ? 'email' : 'emails'}`;
    list.innerHTML = renderSentEmailHistoryItems(sentEmails, 'No emails have been sent to this application.');
  }

  function sentEmailsForApplication(item) {
    const clientEmail = String(item.email || '').trim().toLowerCase();
    return data.emails
      .filter(email => isSentEmail(email)
        && (email.applicationId === item.id || (!email.applicationId && clientEmail && String(email.to || '').trim().toLowerCase() === clientEmail)))
      .sort((first, second) => new Date(second.date) - new Date(first.date));
  }

  function renderSentEmailHistoryItems(sentEmails, emptyMessage) {
    return sentEmails.length
      ? sentEmails.map(email => `<button type="button" class="client-email-history-item" data-email-detail="${escapeHtml(email.id)}" aria-label="Open email: ${escapeHtml(email.subject || 'No subject')}, sent ${escapeHtml(emailDate(email.date))}"><span class="client-email-history-copy"><strong title="${escapeHtml(email.subject || '(No subject)')}">${escapeHtml(email.subject || '(No subject)')}</strong><small>To ${escapeHtml(email.to || 'client')}</small></span><span class="client-email-history-meta"><span class="client-email-direction">Sent</span><time>${escapeHtml(emailDate(email.date))}</time></span></button>`).join('')
      : `<p>${emptyMessage}</p>`;
  }

  function renderClientHistoryEmailRows(emails) {
    return emails.map(email => {
      const rawRecipient = String(email.to || 'Client').trim();
      const recipient = rawRecipient.includes('<') ? rawRecipient.slice(0, rawRecipient.indexOf('<')).replace(/["']/g, '').trim() || rawRecipient : rawRecipient;
      const preview = emailContentText(email.body || '').replace(/\s+/g, ' ').trim().slice(0, 110);
      const subject = email.subject || '(No subject)';
      const time = emailTime(email.date);
      return `<article class="email-row sent" data-email-detail="${escapeHtml(email.id)}"><span class="email-avatar" aria-hidden="true">${escapeHtml(recipient.charAt(0).toUpperCase() || '?')}</span><div class="email-row-content"><div class="email-sender-line"><h3 class="email-from" title="${escapeHtml(rawRecipient)}">${escapeHtml(recipient)}</h3></div><p class="email-preview" title="${escapeHtml(subject + (preview ? ' - ' + preview : ''))}"><strong class="email-subject">${escapeHtml(subject)}</strong><span class="sent-email-badge">SENT</span><span class="email-snippet">${preview ? ' - ' + escapeHtml(preview) : ''}</span></p></div><time class="email-date" title="Sent"><span>${escapeHtml(emailDate(email.date))}</span>${time ? `<span class="email-time">${escapeHtml(time)}</span>` : ''}</time><div class="email-row-actions"><button class="email-actions-trigger" type="button" data-email-detail="${escapeHtml(email.id)}" aria-label="${escapeHtml('View email: ' + subject)}">View email</button></div></article>`;
    }).join('');
  }

  function renderHiredEmailHistory(item) {
    const sentEmails = sentEmailsForApplication(item);
    return `<section class="client-email-history hired-email-history" aria-live="polite">
      <header class="client-email-history-head"><h3>Email History</h3><strong>${plural(sentEmails.length, 'email')}</strong></header>
      <div class="client-email-history-list">${sentEmails.length ? renderClientHistoryEmailRows(sentEmails) : '<p>No emails have been sent to this client.</p>'}</div>
    </section>`;
  }

  function updateClientActionLabel() {
    const button = $('#saveClientButton');
    if (!button) return;
    const activeClient = $('#clientStatus').value === 'Active client';
    const activeClientDrawerEdit = isActiveClientDrawerView('edit');
    button.textContent = activeClient && !activeClientDrawerEdit && !activeClientDetailsModalEdit ? 'Next' : (editingId ? 'Save changes' : 'Save application');
    $$('.contract-field').forEach(field => field.classList.toggle('hidden', !activeClient));
    const activeClientEdit = Boolean(editingId && activeClient && !viewingClientDetails);
    $('#appliedDate').disabled = activeClientEdit;
    $('#followUpDate').disabled = activeClientEdit;
    $('#automaticFollowUp').disabled = activeClientEdit;
    $('#followUpDate').closest('.form-field')?.classList.toggle('hidden', activeClientEdit);
    $('#automaticFollowUp').closest('.follow-up-option')?.classList.toggle('hidden', activeClientEdit);
    const isInterview = $('#clientStatus').value === 'Interview';
    $$('.interview-field').forEach(field => field.classList.toggle('hidden', !isInterview));
    const interviewDate = $('#interviewDate');
    const interviewLink = $('#interviewLink');
    [interviewDate, interviewLink].forEach(field => {
      if (!field) return;
      field.required = isInterview;
      field.setCustomValidity(isInterview ? '' : '');
    });
    $('#closeClientDetailsButton').hidden = false;
    if (!activeClientDrawerEdit) $('#closeClientDetailsButton').textContent = (viewingClientDetails || editingId) ? 'Close' : 'Cancel';
    $('#nextStepField').classList.toggle('hidden', $('#clientStatus').value !== 'To Proceed');
    $('#sendProceedEmailButton').hidden = viewingClientDetails || $('#clientStatus').value !== 'To Proceed';
  }

  function normalizeApplicationIdentity(value) {
    return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function findDuplicateApplication(candidate, applications = data.applications) {
    if (candidate.id) return undefined;
    const fields = ['clientName', 'contact', 'email', 'role'];
    const values = fields.map(field => normalizeApplicationIdentity(candidate[field]));
    if (values.some(value => !value) || !values[2].includes('@')) return undefined;
    const matches = item => fields.every((field, index) => normalizeApplicationIdentity(item[field]) === values[index]);
    return applications.find(matches);
  }

  function updateApplicationDuplicateNotice() {
    const notice = $('#applicationDuplicateNotice');
    if (!notice) return;
    notice.hidden = true;
    notice.textContent = '';
    if (viewingClientDetails || editingId) return;
    const candidate = { id: editingId || '', clientName: $('#clientName').value,
      contact: $('#contactName').value, email: $('#hiredEmail').value, role: $('#clientRole').value };
    const duplicate = findDuplicateApplication(candidate);
    if (candidate.id && !duplicate) return;
    const existing = duplicate;
    if (!existing) return;
    const status = STATUS_LABELS[existing.status] || existing.status || 'Not specified';
    notice.dataset.kind = 'duplicate';
    notice.textContent = `${candidate.id ? 'These details match another saved application' : 'Already saved'}: ${existing.clientName} — ${existing.contact} — ${existing.email} — ${existing.role} (${status}${existing.appliedDate ? `; applied ${formatDate(existing.appliedDate)}` : ''}). ${candidate.id ? 'Check the company name, contact person, email and role/service.' : 'Update the existing application instead of adding it again.'}`;
    notice.hidden = false;
  }

  async function saveClient(event) {
    const submitter = event.submitter;
    if (submitter?.value === 'cancel') {
      if (!editingId) localStorage.removeItem(`${APPLICATION_DRAFT_KEY}:${currentUser?.id || 'anonymous'}`);
      return;
    }
    event.preventDefault();
    const savingInDrawer = isActiveClientDrawerView('edit');
    const form = $('#clientForm');
    if (!form.reportValidity()) return;
    if ($('#automaticFollowUp').checked && !$('#followUpDate').value) {
      $('#followUpDate').value = nextFollowUpWeekday(addDays(today(), 7));
    }
    if (!validateFollowUpDateInput($('#followUpDate'))) return;
    if ($('#automaticFollowUp').checked && !followUpTimeZone({ location: $('#hiredLocation').value })) {
      showActionResult({ title: 'Client timezone required', message: 'Choose the client country and region before enabling automatic follow-up.', status: 'error' });
      return;
    }
    const platformChoice = $('#clientPlatform').value;
    const existing = editingId ? data.applications.find(item => item.id === editingId) : null;
    const existingIndex = editingId ? data.applications.findIndex(item => item.id === editingId) : -1;
    const previousApplication = existing ? JSON.parse(JSON.stringify(existing)) : null;
    const duplicate = findDuplicateApplication({
      id: editingId || '', clientName: $('#clientName').value,
      contact: $('#contactName').value, email: $('#hiredEmail').value, role: $('#clientRole').value
    });
    if (duplicate) {
      showActionResult({
        title: 'Application already exists',
        message: `${duplicate.clientName} — ${duplicate.contact} — ${duplicate.email} — ${duplicate.role} is already saved (status: ${STATUS_LABELS[duplicate.status] || duplicate.status || 'Not specified'}${duplicate.appliedDate ? `; applied ${formatDate(duplicate.appliedDate)}` : ''}). Open the existing application to update it.`,
        status: 'error'
      });
      return;
    }
    const isActiveClient = $('#clientStatus').value === 'Active client';
    const contractEndDate = $('#contractEndDate').value;
    if (isActiveClient && contractEndDate && dateKey(contractEndDate) < today()
      && !(await appConfirm(`This contract end date has already passed (${formatDate(contractEndDate)}). Saving it will mark ${$('#clientName').value.trim() || 'this client'} as expired. Do you want to continue?`, { title: 'Contract date has passed', confirmLabel: 'Save anyway' }))) return;
    if (isActiveClient && (!existing || existing.status !== 'Active client')) beginActivationRollback(editingId || uid(), existing);
    const activeClientEmailPending = isActiveClient && (!existing || existing.status !== 'Active client' || Boolean(existing.activePendingEmail));
    const editingSocialAccounts = !$('#clientSocialLinksField').hidden;
    const applicationSocial = $('#hiredSocial').value.trim();
    const socialLinks = editingSocialAccounts
      ? readClientSocialLinks()
      : (applicationSocial ? [{ platform: inferClientSocialPlatform(applicationSocial), url: applicationSocial }] : []);
    const application = {
      id: editingId || (pendingActivation?.applicationId || uid()),
      clientName: $('#clientName').value.trim(),
      contact: $('#contactName').value.trim(),
      role: $('#clientRole').value.trim(),
      email: $('#hiredEmail').value.trim(),
      phone: $('#hiredPhone').value.trim(),
      website: $('#hiredWebsite').value.trim(),
      socialMedia: editingSocialAccounts ? (socialLinks[0]?.url || '') : applicationSocial,
      socialLinks,
      location: $('#hiredLocation').value.trim(),
      platform: platformChoice === 'Other' ? $('#customPlatform').value.trim() : platformChoice,
      employmentType: $('#employmentType').value,
      salaryType: $('#salaryType').value,
      salaryCurrency: $('#salaryCurrency').value || 'USD',
      salaryAmount: $('#salaryAmount').value === '' ? '' : Number($('#salaryAmount').value),
      hoursPerWeek: $('#salaryHoursPerWeek').value === '' ? '' : Number($('#salaryHoursPerWeek').value),
      status: $('#clientStatus').value,
      manualStatusChangedAt: manualApplicationStatusTimestamp(existing, $('#clientStatus').value),
      nextStep: $('#clientStatus').value === 'To Proceed' ? $('#nextStep').value.trim() : '',
      // Moving an application into Active Clients always requires a newly
      // confirmed contract for the activation email. Existing client files are
      // preserved, but they cannot accidentally skip this one-time step.
      activePendingDocument: isActiveClient && (!existing || existing.status !== 'Active client'),
      activePendingEmail: activeClientEmailPending,
      appliedDate: $('#appliedDate').value,
      interviewDate: $('#interviewDate').value,
      interviewLink: $('#interviewLink').value.trim(),
      interviewAlertDate: editingId && data.applications.find(item => item.id === editingId)?.interviewDate === $('#interviewDate').value ? (data.applications.find(item => item.id === editingId)?.interviewAlertDate || '') : '',
      createdAt: editingId ? (data.applications.find(item => item.id === editingId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
      activeAt: editingId ? (data.applications.find(item => item.id === editingId)?.activeAt || ($('#clientStatus').value === 'Active client' ? new Date().toISOString() : '')) : ($('#clientStatus').value === 'Active client' ? new Date().toISOString() : ''),
      followUpDate: $('#followUpDate').value,
      automaticFollowUp: $('#automaticFollowUp').checked,
      followUpProcessedAt: editingId && data.applications.find(item => item.id === editingId)?.followUpDate === $('#followUpDate').value ? (data.applications.find(item => item.id === editingId)?.followUpProcessedAt || '') : '',
      followUpSentAt: editingId && data.applications.find(item => item.id === editingId)?.followUpDate === $('#followUpDate').value ? (data.applications.find(item => item.id === editingId)?.followUpSentAt || '') : '',
      notes: $('#clientNotes').value.trim(),
      emailClosure: existing?.emailClosure,
      contractStatus: editingId ? (data.applications.find(item => item.id === editingId)?.contractStatus || 'Active') : 'Active',
      contractEndDate: isActiveClient ? contractEndDate : '',
      updatedAt: new Date().toISOString()
    };
    if (editingId) {
      // Document metadata lives in Supabase and is managed from the Active Clients page — carry the references forward.
      if (existing) {
        application.documents = existing.documents;
        application.profileImage = existing.profileImage;
      }
      if (existingIndex >= 0) data.applications[existingIndex] = application;
    } else {
      data.applications.push(application);
    }
    if (submitter) setButtonLoading(submitter, true);
    const saved = await persist();
    if (submitter) setButtonLoading(submitter, false);
    if (!saved) {
      if (previousApplication && existingIndex >= 0) data.applications[existingIndex] = previousApplication;
      else data.applications = data.applications.filter(item => item.id !== application.id);
      renderAll();
      return;
    }
    if (!editingId) localStorage.removeItem(`${APPLICATION_DRAFT_KEY}:${currentUser?.id || 'anonymous'}`);
    if ($('#clientModal').open) $('#clientModal').close();
    if (savingInDrawer) closeActiveClientActionsDrawer(true);
    renderAll();
    if (application.status === 'Active client' && application.activePendingDocument) {
      pendingActiveClientId = application.id;
      openClientDocumentPicker(application);
      toast('Next step: select or upload a client document');
    } else if (application.status === 'Active client' && application.activePendingEmail) {
      if (pendingActivation) pendingActivation.stage = 'email';
      openClientEmailComposer(application);
      toast('Next step: send the activation email');
    } else if (application.status === 'Active client') {
      showView('hired');
      renderHiredDetail(application);
    } else {
      showActionResult({ title: editingId ? 'Application updated' : 'Application added', message: editingId ? 'Your application changes were saved.' : 'The application was added to your workspace.' });
    }
    processDueInterviews();
    await processDueFollowUps();
  }

  async function deleteClient(id, fromActive = false) {
    const item = data.applications.find(application => application.id === id);
    if (!item) return;
    if (!(await appConfirm(`Delete ${item.clientName}? This removes the application, profile photo, and attached documents. This cannot be undone unless you've exported a backup.`, { title: 'Delete client application', confirmLabel: 'Delete', danger: true, showCloseButton: false }))) return;
    data.applications = data.applications.filter(application => application.id !== id);
    persist();
    (item.documents || []).forEach(doc => { deleteDocumentBlob(doc.storagePath || doc.id).catch(() => {}); });
    if (item.profileImage?.storagePath) {
      deleteDocumentBlob(item.profileImage.storagePath).catch(error => console.error('Could not remove the deleted client profile photo:', error));
    }
    $('#clientModal')?.close();
    if (isActiveClientDrawerOpen()) closeActiveClientActionsDrawer(true);
    editingId = null;
    if (fromActive) closeHiredDetail(false);
    renderAll();
    showActionResult({ title: 'Client deleted', message: 'The client, profile photo, and attached documents were removed.' });
  }
