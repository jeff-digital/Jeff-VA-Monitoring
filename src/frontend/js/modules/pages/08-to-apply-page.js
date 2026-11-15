  // To Apply page controls.
  $('#addToApplyButton')?.addEventListener('click', () => openToApplyModal());
  $('#toApplySearch')?.addEventListener('input', renderToApplyList);
  $('#toApplySort')?.addEventListener('change', renderToApplyList);
  enhanceWorkspaceSelect($('#toApplySort'), { labelText: 'Sort reminders', refreshTarget: $('#toApplyView') });
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
  document.addEventListener('click', event => {
    const menuButton = event.target.closest('[data-to-apply-actions]');
    if (menuButton) openToApplyActions(menuButton.dataset.toApplyActions);
  });
