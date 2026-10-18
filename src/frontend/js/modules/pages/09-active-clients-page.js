  // Active Clients page controls, including its document and invoice tools.
  let activeClientDrawerOpen = false;
  let activeClientDrawerView = 'list';
  let activeClientDrawerReturnFocus = null;
  let activeClientDrawerCloseTimer = null;
  const activeClientDrawerBaselines = new Map();

  function isActiveClientDrawerOpen() {
    return activeClientDrawerOpen;
  }

  function isActiveClientDrawerView(view) {
    return activeClientDrawerOpen && activeClientDrawerView === view;
  }

  function activeClientDrawerFormSnapshot(form) {
    return JSON.stringify([...form.elements].map(field => ({
      id: field.id,
      type: field.type,
      value: field.type === 'checkbox' || field.type === 'radio'
        ? field.checked
        : field.type === 'file'
          ? [...(field.files || [])].map(file => file.name)
          : field.value
    })));
  }

  function activeClientDrawerFormChanged(view) {
    const baseline = activeClientDrawerBaselines.get(view);
    const form = view === 'email' ? $('#emailComposeForm') : $('#clientForm');
    return Boolean(baseline && form && activeClientDrawerFormSnapshot(form) !== baseline);
  }

  function markActiveClientDrawerFormClean(view) {
    const form = view === 'email' ? $('#emailComposeForm') : $('#clientForm');
    if (form) activeClientDrawerBaselines.set(view, activeClientDrawerFormSnapshot(form));
  }

  function resetActiveClientDrawerForm(view) {
    const form = view === 'email' ? $('#emailComposeForm') : $('#clientForm');
    const baseline = activeClientDrawerBaselines.get(view);
    if (!form || !baseline) return;
    const values = JSON.parse(baseline);
    [...form.elements].forEach((field, index) => {
      const initial = values[index];
      if (!initial) return;
      if (field.type === 'file') {
        field.value = '';
        return;
      }
      if (field.type === 'checkbox' || field.type === 'radio') field.checked = initial.value;
      else field.value = initial.value;
    });
  }

  function mountActiveClientDrawerForm(formId, slotId) {
    const form = $(`#${formId}`);
    const slot = $(`#${slotId}`);
    if (!form || !slot || form.parentElement === slot) return;
    form.dataset.drawerOriginalMethod = form.getAttribute('method') || '';
    form.setAttribute('method', 'post');
    slot.append(form);
    if (formId === 'emailComposeForm') $('#sendEmailButton').textContent = 'Send';
    if (formId === 'clientForm') $('#closeClientDetailsButton').textContent = 'Cancel';
  }

  function restoreActiveClientDrawerForms() {
    [
      ['emailComposeForm', 'emailComposeModal'],
      ['clientForm', 'clientModal']
    ].forEach(([formId, modalId]) => {
      const form = $(`#${formId}`);
      const modal = $(`#${modalId}`);
      if (!form || !modal || !form.dataset.drawerOriginalMethod) return;
      form.setAttribute('method', form.dataset.drawerOriginalMethod);
      delete form.dataset.drawerOriginalMethod;
      modal.append(form);
    });
    $('#sendEmailButton').textContent = 'Send email';
    $('#closeClientDetailsButton').textContent = 'Close';
    activeClientDrawerBaselines.clear();
  }

  function showActiveClientDrawerView(view) {
    const layer = $('#activeClientDrawerLayer');
    const title = $('#activeClientActionsTitle');
    const back = $('#activeClientDrawerBack');
    const close = $('#closeActiveClientDrawer');
    const client = data.applications.find(application => application.id === hiredEditingId);
    if (!layer || !client) return;
    activeClientDrawerView = view;
    $('#activeClientDrawerList').hidden = view !== 'list';
    $('#activeClientDrawerEmailView').hidden = view !== 'email';
    $('#activeClientDrawerOnboardingView').hidden = view !== 'onboarding';
    $('#activeClientDrawerEditView').hidden = view !== 'edit';
    back.hidden = view === 'list';
    if (close) close.hidden = view === 'email';
    title.textContent = view === 'list'
      ? client.clientName || 'Active client'
      : view === 'email'
        ? 'Send email'
        : view === 'onboarding'
          ? 'Request corrected onboarding details'
          : 'Edit details';
    $('#activeClientDrawerClientName').textContent = view === 'list'
      ? client.role || client.service || ''
      : client.clientName || 'Active client';
    if (view === 'email') mountActiveClientDrawerForm('emailComposeForm', 'activeClientDrawerEmailSlot');
    if (view === 'edit') mountActiveClientDrawerForm('clientForm', 'activeClientDrawerClientFormSlot');
    layer.dataset.view = view;
    document.body.style.setProperty('--active-client-drawer-width', `${$('#activeClientDrawer').getBoundingClientRect().width}px`);
  }

  function openActiveClientActionsDrawer(trigger) {
    const detailClientId = $('#hiredDetailPanel')?.dataset.clientId;
    const clientId = hiredEditingId || detailClientId;
    const client = data.applications.find(application => application.id === clientId);
    if (!client) return;
    hiredEditingId = client.id;
    const layer = $('#activeClientDrawerLayer');
    activeClientDrawerReturnFocus = trigger;
    activeClientDrawerOpen = true;
    activeClientDrawerView = 'list';
    clearTimeout(activeClientDrawerCloseTimer);
    document.body.style.setProperty('--active-client-drawer-width', `${$('#activeClientDrawer').getBoundingClientRect().width}px`);
    layer.hidden = false;
    layer.setAttribute('aria-hidden', 'false');
    layer.classList.remove('closing');
    document.body.classList.add('active-client-drawer-open');
    $('#activeClientGeneratedLink').hidden = true;
    $('#activeClientOnboardingUrl').value = '';
    $('#activeClientOnboardingStatus').textContent = '';
    $('#activeClientDrawerList [data-active-client-action="contract-email"]').hidden = isContractEnded(client);
    $('#activeClientDrawerList [data-active-client-action="send-invoice"]').hidden = isContractEnded(client);
    $('#activeClientDrawerList [data-active-client-action="new-task"]').hidden = isContractEnded(client);
    showActiveClientDrawerView('list');
    requestAnimationFrame(() => {
      if (!activeClientDrawerOpen) return;
      layer.classList.add('open');
      $('#activeClientDrawerList [data-active-client-action]')?.focus();
    });
  }

  $('#activeClientActionsButton')?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    openActiveClientActionsDrawer(event.currentTarget);
  });

  async function closeActiveClientActionsDrawer(force = false, onClosed = null) {
    if (!activeClientDrawerOpen) {
      onClosed?.();
      return;
    }
    const changedViews = ['email', 'edit'].filter(activeClientDrawerFormChanged);
    if (!force && changedViews.length
      && !window.confirm('Discard unsaved changes and close client actions?')) return;
    if (!force) changedViews.forEach(resetActiveClientDrawerForm);
    activeClientDrawerOpen = false;
    const layer = $('#activeClientDrawerLayer');
    layer.classList.add('closing');
    layer.classList.remove('open');
    layer.setAttribute('aria-hidden', 'true');
    activeClientDrawerCloseTimer = setTimeout(() => {
      layer.hidden = true;
      layer.classList.remove('closing');
      document.body.classList.remove('active-client-drawer-open');
      document.body.style.removeProperty('--active-client-drawer-width');
      restoreActiveClientDrawerForms();
      updateClientActionLabel();
      activeClientDrawerReturnFocus?.focus();
      activeClientDrawerReturnFocus = null;
      onClosed?.();
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 270);
  }

  window.addEventListener('resize', () => {
    if (activeClientDrawerOpen) {
      document.body.style.setProperty('--active-client-drawer-width', `${$('#activeClientDrawer').getBoundingClientRect().width}px`);
    }
  });

  function drawerTabStops() {
    return $$('#activeClientDrawer button:not([disabled]), #activeClientDrawer input:not([disabled]), #activeClientDrawer select:not([disabled]), #activeClientDrawer textarea:not([disabled]), #activeClientDrawer a[href]')
      .filter(element => !element.closest('[hidden]') && element.getClientRects().length);
  }

  $('#closeActiveClientDrawer')?.addEventListener('click', () => closeActiveClientActionsDrawer());
  $('#activeClientDrawerBackdrop').addEventListener('click', () => closeActiveClientActionsDrawer());
  $('#activeClientDrawerBack').addEventListener('click', () => {
    if (activeClientDrawerFormChanged(activeClientDrawerView)) {
      if (!window.confirm('Discard unsaved changes and return to actions?')) return;
      resetActiveClientDrawerForm(activeClientDrawerView);
    }
    showActiveClientDrawerView('list');
    $('#activeClientDrawerList [data-active-client-action]')?.focus();
  });
  document.addEventListener('keydown', event => {
    if (!activeClientDrawerOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeActiveClientActionsDrawer();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = drawerTabStops();
    if (!stops.length) {
      event.preventDefault();
      $('#activeClientDrawer').focus();
      return;
    }
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (event.shiftKey && (document.activeElement === first || !$('#activeClientDrawer').contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !$('#activeClientDrawer').contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }, true);
  $('#activeClientDrawerLayer').addEventListener('click', event => {
    if (activeClientDrawerOpen && event.target.closest('#closeClientDetailsButton, #cancelActivationEmailButton, .active-client-drawer-cancel')) {
      event.preventDefault();
      event.stopPropagation();
      closeActiveClientActionsDrawer();
    }
  });

  document.addEventListener('click', event => {
    const avatarUploadButton = event.target.closest('[data-client-avatar-upload]');
    const avatarInput = event.target.closest('[data-client-avatar-input]');
    if (!avatarUploadButton && !avatarInput) return;
    event.stopPropagation();
    if (!avatarUploadButton) return;
    event.preventDefault();
    openClientAvatarUpload(avatarUploadButton.dataset.clientAvatarUpload);
  }, true);

  document.addEventListener('click', async event => {
    const clientDetailTab = event.target.closest('#hiredDetailPanel [data-client-detail-tab]');
    if (clientDetailTab) {
      selectClientDetailTab(clientDetailTab.dataset.clientDetailTab);
      return;
    }
    const deleteActiveButton = event.target.closest('#deleteActiveClient');
    const activeClientActionsButton = event.target.closest('#activeClientActionsButton');
    const invoicePaymentButton = event.target.closest('[data-invoice-mark-paid], [data-invoice-edit-payment], [data-invoice-mark-unpaid]');
    const actionRow = event.target.closest('[data-active-client-action]');
    const generateOnboardingLinkButton = event.target.closest('#generateClientOnboardingLinkButton');
    const copyOnboardingLinkButton = event.target.closest('#copyActiveClientOnboardingUrl');
    const hiredSelectButton = event.target.closest('[data-hired-select]');
    const docOpenButton = event.target.closest('[data-doc-open]');
    const docRemoveButton = event.target.closest('[data-doc-remove]');
    const docEmailButton = event.target.closest('[data-doc-email]');
    const documentMenuButton = event.target.closest('.document-menu-button');

    if (activeClientActionsButton) {
      openActiveClientActionsDrawer(activeClientActionsButton);
      return;
    }

    if (actionRow) {
      if (actionRow.dataset.activeClientAction === 'new-task') {
        closeActiveClientActionsDrawer(false, () => {
          selectClientDetailTab('tasks');
          openClientTaskDrawer(null, $('#activeClientActionsButton'));
        });
      } else if (actionRow.dataset.activeClientAction === 'email') {
        const item = data.applications.find(application => application.id === hiredEditingId);
        if (item) openPlainClientEmailComposer(item, true);
      } else if (actionRow.dataset.activeClientAction === 'send-invoice') {
        const client = data.applications.find(application => application.id === hiredEditingId);
        if (client) closeActiveClientActionsDrawer(false, () => openInvoiceDocumentPicker(client));
      } else if (actionRow.dataset.activeClientAction === 'contract-email') {
        const clientId = hiredEditingId;
        const client = data.applications.find(application => application.id === clientId);
        if (!client?.email?.trim()) {
          toast('Add a client email before sending a contract.');
        } else if (!isContractEnded(client)) {
          closeActiveClientActionsDrawer(false, () => openContractEmailUploadModal(clientId));
        }
      } else if (actionRow.dataset.activeClientAction === 'onboarding') {
        showActiveClientDrawerView('onboarding');
        $('#generateClientOnboardingLinkButton').focus();
      } else if (actionRow.dataset.activeClientAction === 'edit') {
        const clientId = hiredEditingId;
        closeActiveClientActionsDrawer(false, () => openClientModal(clientId, false, true, false, true));
      } else if (actionRow.dataset.activeClientAction === 'delete') {
        await deleteClient(hiredEditingId, true);
      }
      return;
    }

    if (generateOnboardingLinkButton) {
      const item = data.applications.find(application => application.id === hiredEditingId);
      if (item) await sendClientOnboardingInvite(item, generateOnboardingLinkButton, true);
      return;
    }

    if (copyOnboardingLinkButton) {
      const status = $('#activeClientOnboardingStatus');
      try {
        await navigator.clipboard.writeText($('#activeClientOnboardingUrl').value);
        status.textContent = 'Onboarding link copied to clipboard.';
        status.className = 'compose-status status-success';
      } catch (error) {
        console.error('Could not copy the onboarding link:', error);
        status.textContent = 'Could not copy automatically. Select and copy the link above.';
        status.className = 'compose-status status-alert';
      }
      return;
    }

    if (deleteActiveButton) {
      deleteClient(hiredEditingId, true);
      return;
    }
    if (invoicePaymentButton) {
      const invoiceId = invoicePaymentButton.dataset.invoiceMarkPaid
        || invoicePaymentButton.dataset.invoiceEditPayment
        || invoicePaymentButton.dataset.invoiceMarkUnpaid;
      if (invoicePaymentButton.hasAttribute('data-invoice-mark-unpaid')) await markInvoiceUnpaid(invoiceId);
      else openInvoicePayment(invoiceId);
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
    if (!event.target.closest('.document-row-menu')) {
      document.querySelectorAll('.document-menu').forEach(item => item.classList.add('hidden'));
      document.querySelectorAll('.document-menu-button').forEach(item => item.setAttribute('aria-expanded', 'false'));
    }
  });

  document.addEventListener('keydown', event => {
    const currentTab = event.target.closest('#hiredDetailPanel [role="tab"][data-client-detail-tab]');
    if (!currentTab) return;
    const tabs = [...$('#hiredDetailPanel').querySelectorAll('[role="tab"][data-client-detail-tab]')];
    const currentIndex = tabs.indexOf(currentTab);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    selectClientDetailTab(tabs[nextIndex].dataset.clientDetailTab, true);
  });

  let clientAvatarCropState = null;
  let clientAvatarCropObjectUrl = '';
  let clientAvatarUploadState = null;
  let clientAvatarUploadObjectUrl = '';

  function clearClientAvatarUploadPreview() {
    if (clientAvatarUploadObjectUrl) URL.revokeObjectURL(clientAvatarUploadObjectUrl);
    clientAvatarUploadObjectUrl = '';
    clientAvatarUploadState = null;
    $('#clientAvatarUploadImage').removeAttribute('src');
    $('#clientAvatarUploadImage').hidden = true;
    $('.client-avatar-upload-placeholder')?.removeAttribute('hidden');
    $('#clientAvatarUploadFile').textContent = 'No picture selected';
    $('#continueClientAvatarUpload').disabled = true;
    $('#removeClientAvatarButton').hidden = true;
  }

  function openClientAvatarUpload(clientId) {
    const item = data.applications.find(application => application.id === clientId);
    if (!item) return;
    clearClientAvatarUploadPreview();
    clientAvatarUploadState = { clientId, file: null };
    $('#removeClientAvatarButton').hidden = !item.profileImage?.storagePath;
    $('#clientAvatarUploadModal').showModal();
    $('#clientAvatarUploadPreview').focus();
  }

  function closeClientAvatarUpload() {
    if ($('#clientAvatarUploadModal').open) $('#clientAvatarUploadModal').close();
    clearClientAvatarUploadPreview();
  }

  async function removeClientAvatar() {
    const clientId = clientAvatarUploadState?.clientId;
    const item = data.applications.find(application => application.id === clientId);
    if (!item?.profileImage?.storagePath) return;
    if (!(await appConfirm(`Remove ${item.clientName || 'this client'}'s profile photo?`, {
      title: 'Remove profile photo',
      confirmLabel: 'Remove photo',
      danger: true,
      showCloseButton: false
    }))) return;
    const button = $('#removeClientAvatarButton');
    setButtonLoading(button, true);
    const previousProfileImage = item.profileImage;
    try {
      await deleteDocumentBlob(previousProfileImage.storagePath);
      item.profileImage = null;
      clearHiredClientAvatar(item.id);
      await persist();
      renderHired();
      closeClientAvatarUpload();
      showActionResult({ title: 'Profile photo removed', message: 'The client profile picture was removed successfully.' });
    } catch (error) {
      console.error('Could not remove client profile photo:', error);
      showActionResult({ title: 'Profile photo could not be removed', message: error.message || 'Check your connection and try again.', status: 'error' });
    } finally {
      setButtonLoading(button, false);
    }
  }

  function clampClientAvatarPosition() {
    if (!clientAvatarCropState) return;
    const viewport = $('#clientAvatarCropViewport');
    const image = $('#clientAvatarCropImage');
    const bounds = viewport.getBoundingClientRect();
    const width = clientAvatarCropState.image.naturalWidth * clientAvatarCropState.scale;
    const height = clientAvatarCropState.image.naturalHeight * clientAvatarCropState.scale;
    clientAvatarCropState.left = Math.min(0, Math.max(bounds.width - width, clientAvatarCropState.left));
    clientAvatarCropState.top = Math.min(0, Math.max(bounds.height - height, clientAvatarCropState.top));
    image.style.width = `${width}px`;
    image.style.height = `${height}px`;
    image.style.left = `${clientAvatarCropState.left}px`;
    image.style.top = `${clientAvatarCropState.top}px`;
  }

  function updateClientAvatarCropScale(keepCenter = true) {
    if (!clientAvatarCropState) return;
    const viewport = $('#clientAvatarCropViewport');
    const bounds = viewport.getBoundingClientRect();
    const oldScale = clientAvatarCropState.scale;
    const baseScale = Math.max(
      bounds.width / clientAvatarCropState.image.naturalWidth,
      bounds.height / clientAvatarCropState.image.naturalHeight
    );
    const zoom = Number($('#clientAvatarZoom').value) || 1;
    const scale = baseScale * zoom;
    if (keepCenter && oldScale) {
      const centerX = (bounds.width / 2 - clientAvatarCropState.left) / oldScale;
      const centerY = (bounds.height / 2 - clientAvatarCropState.top) / oldScale;
      clientAvatarCropState.left = bounds.width / 2 - centerX * scale;
      clientAvatarCropState.top = bounds.height / 2 - centerY * scale;
    } else {
      clientAvatarCropState.left = (bounds.width - clientAvatarCropState.image.naturalWidth * scale) / 2;
      clientAvatarCropState.top = (bounds.height - clientAvatarCropState.image.naturalHeight * scale) / 2;
    }
    clientAvatarCropState.scale = scale;
    clampClientAvatarPosition();
  }

  function closeClientAvatarCrop() {
    if ($('#clientAvatarCropModal').open) $('#clientAvatarCropModal').close();
    if (clientAvatarCropObjectUrl) URL.revokeObjectURL(clientAvatarCropObjectUrl);
    clientAvatarCropObjectUrl = '';
    clientAvatarCropState = null;
    $('#clientAvatarCropImage').removeAttribute('src');
  }

  function backClientAvatarCropToUpload() {
    const crop = clientAvatarCropState;
    if (!crop) {
      closeClientAvatarCrop();
      return;
    }
    const { clientId, file } = crop;
    closeClientAvatarCrop();
    openClientAvatarUpload(clientId);
    clientAvatarUploadState = { clientId, file };
    clientAvatarUploadObjectUrl = URL.createObjectURL(file);
    $('#clientAvatarUploadImage').src = clientAvatarUploadObjectUrl;
    $('#clientAvatarUploadImage').hidden = false;
    $('.client-avatar-upload-placeholder')?.setAttribute('hidden', '');
    $('#clientAvatarUploadFile').textContent = `${file.name || 'Selected picture'} · Ready to continue`;
    $('#continueClientAvatarUpload').disabled = false;
  }

  function openClientAvatarCrop(clientId, file) {
    if (clientAvatarCropObjectUrl) URL.revokeObjectURL(clientAvatarCropObjectUrl);
    clientAvatarCropObjectUrl = URL.createObjectURL(file);
    const image = $('#clientAvatarCropImage');
    image.onload = () => {
      clientAvatarCropState = { clientId, file, image, scale: 0, left: 0, top: 0, drag: null };
      $('#clientAvatarZoom').value = '1';
      $('#clientAvatarCropStatus').textContent = 'The saved profile photo will be a square JPEG.';
      $('#clientAvatarCropModal').showModal();
      updateClientAvatarCropScale(false);
      $('#useClientAvatarCrop').focus();
    };
    image.onerror = () => {
      closeClientAvatarCrop();
      showActionResult({ title: 'Image could not be opened', message: 'Choose a valid JPEG, PNG, or WebP image.', status: 'error' });
    };
    image.src = clientAvatarCropObjectUrl;
  }

  function makeClientAvatarCropBlob() {
    if (!clientAvatarCropState) return Promise.reject(new Error('Choose a profile image to crop.'));
    const viewport = $('#clientAvatarCropViewport');
    const bounds = viewport.getBoundingClientRect();
    const sourceX = -clientAvatarCropState.left / clientAvatarCropState.scale;
    const sourceY = -clientAvatarCropState.top / clientAvatarCropState.scale;
    const sourceSize = bounds.width / clientAvatarCropState.scale;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) return Promise.reject(new Error('The image crop could not be prepared in this browser.'));
    context.drawImage(
      clientAvatarCropState.image,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      canvas.width,
      canvas.height
    );
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('The cropped profile photo could not be created.'));
      }, 'image/jpeg', 0.9);
    });
  }

  async function uploadClientAvatar(clientId, file) {
    const item = data.applications.find(application => application.id === clientId);
    if (!item) throw new Error('This client could not be found.');
    if (!currentUser) throw new Error('Sign in before uploading a client photo.');
    const button = document.querySelector(`[data-client-avatar-upload="${CSS.escape(clientId)}"]`);
    if (button) button.disabled = true;
    const storagePath = `${currentUser.id}/client-avatars/${item.id}/${uid()}.jpg`;
    let uploaded = false;
    const previousProfileImage = item.profileImage;
    try {
      const { error } = await requireSupabase().storage.from(SUPABASE_BUCKET).upload(storagePath, file, {
        upsert: false,
        contentType: 'image/jpeg'
      });
      if (error) throw error;
      uploaded = true;
      const previousPath = item.profileImage?.storagePath;
      item.profileImage = {
        storagePath,
        name: `profile-${item.id}.jpg`,
        type: 'image/jpeg',
        size: file.size,
        updatedAt: new Date().toISOString()
      };
      cacheHiredClientAvatar(item.id, storagePath, file);
      await persist();
      const { data: savedState, error: verifyError } = await requireSupabase()
        .from('app_state')
        .select('data')
        .eq('user_id', currentUser.id)
        .maybeSingle();
      if (verifyError) throw verifyError;
      const savedClient = savedState?.data?.applications?.find(application => application.id === item.id);
      if (savedClient?.profileImage?.storagePath !== storagePath) {
        throw new Error('The photo uploaded, but its client record could not be confirmed as saved. Please try again.');
      }
      renderHired();
      if (previousProfileImage?.storagePath && previousProfileImage.storagePath !== storagePath) {
        try {
          await deleteDocumentBlob(previousProfileImage.storagePath);
        } catch (error) {
          console.error('Could not remove the replaced client profile photo:', error);
          showActionResult({
            title: 'Previous profile photo retained',
            message: error.message || 'The new photo is displayed, but the previous photo could not be safely removed.',
            status: 'info'
          });
        }
      }
      toast('Client profile photo saved.');
      return true;
    } catch (error) {
      if (uploaded) {
        try {
          await deleteDocumentBlob(storagePath);
        } catch (cleanupError) {
          console.error('Could not clean up an unsuccessful client photo upload:', cleanupError);
        }
      }
      item.profileImage = previousProfileImage;
      clearHiredClientAvatar(item.id);
      renderHired();
      console.error('Could not upload client profile photo:', error);
      showActionResult({
        title: 'Profile photo could not be uploaded',
        message: /mime type .* not supported|mime types? not allowed/i.test(error.message || '')
          ? 'The Supabase client-documents bucket must allow image/jpeg. Apply src/backend/supabase/profile-photo-storage-migration.sql in your Supabase SQL Editor, then try again.'
          : error.message || 'Check your connection and try again.',
        status: 'error'
      });
      return false;
    } finally {
      if (button?.isConnected) button.disabled = false;
    }
  }

  const cropViewport = $('#clientAvatarCropViewport');
  cropViewport.addEventListener('pointerdown', event => {
    if (!clientAvatarCropState) return;
    event.preventDefault();
    cropViewport.setPointerCapture(event.pointerId);
    clientAvatarCropState.drag = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      left: clientAvatarCropState.left,
      top: clientAvatarCropState.top
    };
  });
  cropViewport.addEventListener('pointermove', event => {
    const drag = clientAvatarCropState?.drag;
    if (!drag) return;
    clientAvatarCropState.left = drag.left + event.clientX - drag.pointerX;
    clientAvatarCropState.top = drag.top + event.clientY - drag.pointerY;
    clampClientAvatarPosition();
  });
  const stopClientAvatarCropDrag = () => {
    if (clientAvatarCropState) clientAvatarCropState.drag = null;
  };
  cropViewport.addEventListener('pointerup', stopClientAvatarCropDrag);
  cropViewport.addEventListener('pointercancel', stopClientAvatarCropDrag);
  $('#clientAvatarZoom').addEventListener('input', () => updateClientAvatarCropScale(true));
  const openClientAvatarFilePicker = () => {
    const clientId = clientAvatarUploadState?.clientId;
    if (!clientId) return;
    document.querySelector(`[data-client-avatar-input="${CSS.escape(clientId)}"]`)?.click();
  };
  $('#clientAvatarUploadPreview').addEventListener('click', openClientAvatarFilePicker);
  $('#clientAvatarUploadPreview').addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openClientAvatarFilePicker();
  });
  $('#cancelClientAvatarUpload').addEventListener('click', closeClientAvatarUpload);
  $('#removeClientAvatarButton').addEventListener('click', removeClientAvatar);
  $('#clientAvatarUploadModal').addEventListener('close', clearClientAvatarUploadPreview);
  $('#continueClientAvatarUpload').addEventListener('click', () => {
    if (!clientAvatarUploadState?.file) return;
    const { clientId, file } = clientAvatarUploadState;
    closeClientAvatarUpload();
    openClientAvatarCrop(clientId, file);
  });
  $('#cancelClientAvatarCrop')?.addEventListener('click', closeClientAvatarCrop);
  $('#cancelClientAvatarCropAction').addEventListener('click', backClientAvatarCropToUpload);
  $('#clientAvatarCropModal').addEventListener('close', () => {
    if (clientAvatarCropObjectUrl) URL.revokeObjectURL(clientAvatarCropObjectUrl);
    clientAvatarCropObjectUrl = '';
    clientAvatarCropState = null;
    $('#clientAvatarCropImage').removeAttribute('src');
  });
  $('#useClientAvatarCrop').addEventListener('click', async event => {
    if (!clientAvatarCropState) return;
    const button = event.currentTarget;
    setButtonLoading(button, true);
    $('#clientAvatarCropStatus').textContent = 'Uploading your cropped photo…';
    const clientId = clientAvatarCropState.clientId;
    try {
      const croppedFile = await makeClientAvatarCropBlob();
      closeClientAvatarCrop();
      const uploaded = await uploadClientAvatar(clientId, croppedFile);
      if (uploaded) showActionResult({ title: 'Profile photo saved', message: 'The client profile picture was uploaded successfully.' });
    } catch (error) {
      console.error('Could not crop client profile photo:', error);
      $('#clientAvatarCropStatus').textContent = error.message || 'The photo could not be cropped.';
      setButtonLoading(button, false);
      return;
    }
    setButtonLoading(button, false);
  });
  document.addEventListener('change', async event => {
    const input = event.target.closest('[data-client-avatar-input]');
    const file = input?.files?.[0];
    if (!input || !file) return;
    const clientId = input.dataset.clientAvatarInput;
    input.value = '';
    const item = data.applications.find(application => application.id === clientId);
    if (!item) return;
    const typeByMime = {
      'image/jpeg': { extension: 'jpg', contentType: 'image/jpeg' },
      'image/jpg': { extension: 'jpg', contentType: 'image/jpeg' },
      'image/pjpeg': { extension: 'jpg', contentType: 'image/jpeg' },
      'image/png': { extension: 'png', contentType: 'image/png' },
      'image/x-png': { extension: 'png', contentType: 'image/png' },
      'image/webp': { extension: 'webp', contentType: 'image/webp' }
    };
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    const typeByExtension = {
      jpg: typeByMime['image/jpeg'],
      jpeg: typeByMime['image/jpeg'],
      jpe: typeByMime['image/jpeg'],
      png: typeByMime['image/png'],
      webp: typeByMime['image/webp']
    };
    const normalizedMimeType = String(file.type || '').split(';')[0].trim().toLowerCase();
    const imageType = typeByMime[normalizedMimeType] || typeByExtension[extension];
    if (!imageType) {
      showActionResult({ title: 'Unsupported profile photo', message: 'Choose a JPEG, PNG, or WebP image.', status: 'error' });
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      showActionResult({ title: 'Profile photo is too large', message: 'Choose an image that is 25 MB or smaller before cropping.', status: 'error' });
      return;
    }
    const imageUrl = URL.createObjectURL(file);
    clientAvatarUploadState = { clientId, file };
    if (clientAvatarUploadObjectUrl) URL.revokeObjectURL(clientAvatarUploadObjectUrl);
    clientAvatarUploadObjectUrl = imageUrl;
    $('#clientAvatarUploadImage').src = imageUrl;
    $('#clientAvatarUploadImage').hidden = false;
    $('.client-avatar-upload-placeholder')?.setAttribute('hidden', '');
    $('#clientAvatarUploadFile').textContent = `${file.name || 'Selected picture'} · Ready to continue`;
    $('#continueClientAvatarUpload').disabled = false;
    if (!$('#clientAvatarUploadModal').open) $('#clientAvatarUploadModal').showModal();
  });

  async function sendClientOnboardingInvite(item, button, generateOnly = false) {
    if (!item.email) {
      if (generateOnly) {
        $('#activeClientOnboardingStatus').textContent = 'Add an email address to this active client before creating an onboarding link.';
        $('#activeClientOnboardingStatus').className = 'compose-status status-alert';
      } else {
        showActionResult({ title: 'Client email required', message: 'Add an email address to this active client before sending an onboarding invitation.', status: 'error' });
      }
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
      if (generateOnly) {
        $('#activeClientOnboardingUrl').value = onboardingUrl.href;
        $('#activeClientGeneratedLink').hidden = false;
        $('#activeClientOnboardingStatus').textContent = 'Private link generated. Copy it to share with your client.';
        $('#activeClientOnboardingStatus').className = 'compose-status status-success';
        $('#copyActiveClientOnboardingUrl').focus();
        return;
      }
      openPlainClientEmailComposer(item);
      $('#composeSubject').value = 'Please review your client onboarding details';
      $('#composeBody').value = `Hi ${item.clientName || 'there'},\n\nPlease complete or update your onboarding details using this private form:\n\n${onboardingUrl.href}\n\nThe link is private to you, expires in 14 days, and can only be submitted once. Submitting this form will replace any onboarding details previously provided. You will be able to review and confirm all your answers before submitting. Please do not enter passwords or sensitive account credentials.\n\nThank you`;
      toast('Review the onboarding invitation and send it through Gmail.');
    } catch (error) {
      console.error('Could not create client onboarding invitation:', error);
      if (generateOnly) {
        $('#activeClientOnboardingStatus').textContent = error.message || 'The link could not be created. Check your connection and try again.';
        $('#activeClientOnboardingStatus').className = 'compose-status status-alert';
      } else {
        showActionResult({ title: 'Onboarding link could not be created', message: error.message || 'Check your connection and try again.', status: 'error' });
      }
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

  $('#cancelDocumentEmailReminder')?.addEventListener('click', closeDocumentEmailReminder);
  $('#cancelDocumentEmailReminderAction').addEventListener('click', closeDocumentEmailReminder);

  document.addEventListener('change', event => {
    if (event.target.id === 'contractEmailFileInput') {
      stageContractEmailFile(event.target.files?.[0]);
      event.target.value = '';
      return;
    }
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
    if (event.target.closest('#chooseContractEmailFileButton, #chooseDifferentContractEmailFileButton')) {
      event.preventDefault();
      pickContractEmailFile();
      return;
    }
    if (event.target.closest('#removeContractEmailFileButton')) {
      removeContractEmailUploadFile();
      return;
    }
    if (event.target.closest('#cancelContractEmailUploadButton, #closeContractEmailUploadModal')) {
      $('#contractEmailUploadModal').close();
      return;
    }
    if (event.target.closest('#continueContractEmailButton')) {
      continueContractEmailUpload();
      return;
    }
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
      openContractEmailUploadModal(hiredEditingId);
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
