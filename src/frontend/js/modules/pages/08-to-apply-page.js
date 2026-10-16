  // To Apply page controls.
  $('#addToApplyButton')?.addEventListener('click', () => openToApplyModal());
  $('#toApplySearch')?.addEventListener('input', renderToApplyList);
  $('#toApplySort')?.addEventListener('change', renderToApplyList);
  $('#toApplyForm')?.addEventListener('submit', saveToApply);
  let toApplyActionId = null;
  function openToApplyActions(id) {
    const item = (data.toApply || []).find(reminder => reminder.id === id);
    if (!item) return;
    toApplyActionId = id;
    const panel = $('#toApplyActionsPanel');
    if (!panel) return;
    $('#toApplyActionsSubtitle').textContent = item.title || 'Application reminder';
    panel.showModal();
    $('#editToApplyAction')?.focus();
  }
  function closeToApplyActions() {
    const panel = $('#toApplyActionsPanel');
    if (panel?.open) panel.close();
    toApplyActionId = null;
  }
  $('#cancelToApplyActions')?.addEventListener('click', closeToApplyActions);
  $('#editToApplyAction')?.addEventListener('click', () => {
    const id = toApplyActionId;
    closeToApplyActions();
    if (id) openToApplyModal(id);
  });
  $('#deleteToApplyAction')?.addEventListener('click', async () => {
    const id = toApplyActionId;
    closeToApplyActions();
    if (id) await deleteToApply(id);
  });
  function closeToApplyActionMenus(restoreFocus = false) {
    document.querySelectorAll('[data-to-apply-menu][aria-expanded="true"]').forEach(button => {
      button.setAttribute('aria-expanded', 'false');
      button.nextElementSibling.classList.add('hidden');
      button.nextElementSibling.classList.remove('opens-up');
      if (restoreFocus) button.focus();
    });
  }

  document.addEventListener('click', event => {
    const menuButton = event.target.closest('[data-to-apply-actions]');
    if (menuButton) {
      closeToApplyActionMenus();
      openToApplyActions(menuButton.dataset.toApplyActions);
      return;
    }
    closeToApplyActionMenus();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeToApplyActionMenus(true);
  });
