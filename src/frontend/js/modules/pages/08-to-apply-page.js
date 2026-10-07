  // To Apply page controls.
  $('#addToApplyButton').addEventListener('click', () => openToApplyModal());
  $('#toApplySearch').addEventListener('input', renderToApplyList);
  $('#toApplySort').addEventListener('change', renderToApplyList);
  $('#toApplyForm').addEventListener('submit', saveToApply);
  $('#deleteToApplyButton').addEventListener('click', () => deleteToApply($('#toApplyId').value));
  function closeToApplyActionMenus(restoreFocus = false) {
    document.querySelectorAll('[data-to-apply-menu][aria-expanded="true"]').forEach(button => {
      button.setAttribute('aria-expanded', 'false');
      button.nextElementSibling.classList.add('hidden');
      button.nextElementSibling.classList.remove('opens-up');
      if (restoreFocus) button.focus();
    });
  }

  document.addEventListener('click', event => {
    const menuButton = event.target.closest('[data-to-apply-menu]');
    const editButton = event.target.closest('[data-edit-to-apply]');
    const deleteButton = event.target.closest('[data-delete-to-apply]');
    if (menuButton) {
      const menu = menuButton.nextElementSibling;
      const willOpen = menu.classList.contains('hidden');
      closeToApplyActionMenus();
      if (willOpen) {
        const listBounds = menuButton.closest('.to-apply-list').getBoundingClientRect();
        const buttonBounds = menuButton.getBoundingClientRect();
        menu.classList.toggle('opens-up', listBounds.bottom - buttonBounds.bottom < 84);
        menu.classList.remove('hidden');
        menuButton.setAttribute('aria-expanded', 'true');
      }
      return;
    }
    if (editButton) {
      closeToApplyActionMenus();
      openToApplyModal(editButton.dataset.editToApply);
      return;
    }
    if (deleteButton) {
      closeToApplyActionMenus();
      deleteToApply(deleteButton.dataset.deleteToApply);
      return;
    }
    closeToApplyActionMenus();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeToApplyActionMenus(true);
  });
