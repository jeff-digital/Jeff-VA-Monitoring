  let subscriptionSaving = false;

  function subscriptionToday() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }

  function subscriptionDateValue(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return NaN;
    const [year, month, day] = value.split('-').map(Number), time = Date.UTC(year, month - 1, day);
    return year >= 1900 && new Date(time).toISOString().slice(0, 10) === value ? time : NaN;
  }

  function subscriptionStatus(item = {}, reference = subscriptionToday()) {
    item = item || {};
    if (item.tracking === 'cancelled') return { key: 'cancelled', label: 'Cancelled', detail: 'No longer tracked for renewal' };
    const expiry = subscriptionDateValue(item.expiryDate), current = subscriptionDateValue(reference);
    if (!Number.isFinite(expiry) || !Number.isFinite(current)) return { key: 'date-needed', label: 'Date needed', detail: 'Add an expiry date' };
    const days = Math.round((expiry - current) / 86400000);
    return days < 0 ? { key: 'expired', label: 'Expired', detail: `Expired ${plural(-days, 'day')} ago` }
      : days <= 7 ? { key: 'soon', label: days === 0 ? 'Expires today' : 'Expiring soon', detail: days === 0 ? 'Subscription ends today' : `${plural(days, 'day')} remaining` }
        : { key: 'active', label: 'Active', detail: `${plural(days, 'day')} remaining` };
  }

  function validateSubscriptionDraft(input, records = [], editingId = '') {
    const name = String(input.name || '').trim(), account = String(input.account || '').trim();
    if (!name || name.length > 120) return { error: 'Enter an account type or service name within 120 characters.' };
    if (account.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) return { error: 'Enter a valid email address for this account.' };
    const identity = value => String(value || '').normalize('NFKC').trim().toLowerCase();
    if (records.some(item => item && item.id !== editingId && identity(item.name) === identity(name) && identity(item.account) === identity(account))) return { error: 'This service and account are already saved. Edit the existing subscription.' };
    if (!Number.isFinite(subscriptionDateValue(input.expiryDate))) return { error: 'Choose a valid subscription end date.' };
    return { value: { name, account, expiryDate: input.expiryDate } };
  }

  function renderSubscriptions() {
    const records = (data.subscriptions || []).filter(item => item?.id);
    const states = records.map(item => subscriptionStatus(item));
    $('#subscriptionSummary').innerHTML = [['Active', states.filter(state => ['active', 'soon'].includes(state.key)).length, 'Accounts still in their paid period'],
      ['Expiring soon', states.filter(state => state.key === 'soon').length, 'Today or within the next 7 days'],
      ['Expired', states.filter(state => state.key === 'expired').length, 'Subscriptions past their end date']]
      .map(([label, count, detail]) => `<article><span>${label}</span><strong>${count}</strong><small>${detail}</small></article>`).join('');
    const query = $('#subscriptionSearch').value.trim().toLowerCase(), filter = $('#subscriptionFilter').value;
    const visible = records.filter(item => [item.name, item.account].join(' ').toLowerCase().includes(query))
      .filter(item => filter === 'all' || (filter === 'active' ? ['active', 'soon'].includes(subscriptionStatus(item).key) : subscriptionStatus(item).key === filter))
      .sort((a, b) => Number(a.tracking === 'cancelled') - Number(b.tracking === 'cancelled') || String(a.expiryDate || '9999').localeCompare(String(b.expiryDate || '9999')) || String(a.name).localeCompare(String(b.name)));
    $('#subscriptionCount').textContent = `${plural(visible.length, 'subscription')}${query || filter !== 'all' ? ' shown' : ''}`;
    $('#subscriptionList').innerHTML = visible.length ? visible.map(item => {
      const status = subscriptionStatus(item);
      return `<article class="subscription-card" data-state="${status.key}"><div class="subscription-card-heading"><div><h2>${escapeHtml(item.name || 'Untitled account')}</h2><p>${escapeHtml(item.account || 'Account not specified')}</p></div><span class="subscription-status">${status.label}</span></div>
        <div class="subscription-expiry"><span>End of subscription</span><strong>${Number.isFinite(subscriptionDateValue(item.expiryDate)) ? escapeHtml(formatDate(item.expiryDate)) : 'Not set'}</strong><small>${escapeHtml(status.detail)}</small></div>
        <footer><div><button class="button button-secondary" type="button" data-subscription-edit="${escapeHtml(item.id)}" aria-haspopup="dialog">Manage</button></div></footer></article>`;
    }).join('') : `<div class="subscriptions-empty"><i class="fa-regular fa-credit-card" aria-hidden="true"></i><h2>${records.length ? 'No subscriptions found' : 'No subscriptions yet'}</h2><p>${records.length ? 'Try another search or status filter.' : 'Add a paid account to track its expiry and plan your next renewal.'}</p></div>`;
  }

  function openSubscriptionEditor(id = '') {
    if (subscriptionSaving) return;
    const item = (data.subscriptions || []).find(record => record.id === id);
    if (id && !item) return;
    const form = $('#subscriptionForm'); form.reset();
    form.dataset.userId = currentUser?.id || '';
    $('#subscriptionId').value = item?.id || '';
    $('#subscriptionEditorTitle').textContent = item ? 'Manage subscription' : 'Add subscription';
    for (const [field, value] of Object.entries({ Name: item?.name || '', Account: item?.account || '', Expiry: item?.expiryDate || '' })) $('#subscription' + field).value = value;
    $('#subscriptionFormError').hidden = true;
    $('#deleteSubscription').hidden = !item; $('#saveSubscription').textContent = 'Save subscription';
    const dialog = $('#subscriptionEditor'); if (!dialog.open) dialog.showModal();
    $('#subscriptionName').focus();
  }

  function subscriptionFormError(message) {
    $('#subscriptionFormError').textContent = message; $('#subscriptionFormError').hidden = false;
  }

  function setSubscriptionSaving(value) {
    subscriptionSaving = value;
    ['saveSubscription', 'deleteSubscription', 'closeSubscriptionEditor', 'cancelSubscriptionEditor'].forEach(id => { $('#' + id).disabled = value; });
    $('#subscriptionForm').setAttribute('aria-busy', String(value));
  }

  $('#addSubscription').addEventListener('click', () => openSubscriptionEditor());
  $('#subscriptionSearch').addEventListener('input', renderSubscriptions);
  $('#subscriptionFilter').addEventListener('change', renderSubscriptions);
  ['closeSubscriptionEditor', 'cancelSubscriptionEditor'].forEach(id => $('#' + id).addEventListener('click', () => { if (!subscriptionSaving) $('#subscriptionEditor').close(); }));
  $('#subscriptionEditor').addEventListener('cancel', event => { if (subscriptionSaving) event.preventDefault(); });
  $('#subscriptionList').addEventListener('click', event => {
    const edit = event.target.closest('[data-subscription-edit]');
    if (edit) openSubscriptionEditor(edit.dataset.subscriptionEdit);
  });
  $('#subscriptionForm').addEventListener('submit', async event => {
    event.preventDefault(); if (subscriptionSaving || !event.currentTarget.reportValidity()) return;
    if (!currentUser || event.currentTarget.dataset.userId !== currentUser.id) { subscriptionFormError('Your account changed. Close this form and reopen it.'); return; }
    const workspace = data, userId = currentUser.id, id = $('#subscriptionId').value;
    const existing = (workspace.subscriptions || []).find(item => item.id === id);
    if (id && !existing) { subscriptionFormError('This subscription is no longer available. Reopen the page.'); return; }
    const input = Object.fromEntries(['Name', 'Account', 'Expiry'].map(field => [field === 'Expiry' ? 'expiryDate' : field.toLowerCase(), $('#subscription' + field).value]));
    const validated = validateSubscriptionDraft(input, workspace.subscriptions || [], id);
    if (validated.error) { subscriptionFormError(validated.error); return; }
    const now = new Date().toISOString(), record = { ...existing, ...validated.value, id: id || uid(), createdAt: existing?.createdAt || now, updatedAt: now };
    const previous = workspace.subscriptions || [];
    workspace.subscriptions = id ? previous.map(item => item.id === id ? record : item) : [...previous, record];
    setSubscriptionSaving(true);
    let saved = false; try { saved = await persist(); } catch { /* Retain the form for retry. */ } finally { setSubscriptionSaving(false); }
    if (currentUser?.id !== userId || data !== workspace) return;
    if (!saved) { workspace.subscriptions = previous; subscriptionFormError('The subscription could not be saved. Please try again.'); return; }
    $('#subscriptionEditor').close(); renderAll();
    toast(id ? 'Subscription updated' : 'Subscription added');
  });
  $('#deleteSubscription').addEventListener('click', async () => {
    if (subscriptionSaving) return;
    const workspace = data, userId = currentUser?.id, id = $('#subscriptionId').value;
    if (!userId || $('#subscriptionForm').dataset.userId !== userId) return;
    const item = (workspace.subscriptions || []).find(record => record.id === id);
    if (!item || !(await appConfirm(`Remove ${item.name} from your subscription tracker?`, { title: 'Delete subscription', confirmLabel: 'Delete', danger: true }))) return;
    if (currentUser?.id !== userId || data !== workspace || subscriptionSaving) return;
    const previous = workspace.subscriptions; workspace.subscriptions = previous.filter(record => record.id !== id);
    setSubscriptionSaving(true);
    let saved = false; try { saved = await persist(); } catch { /* Restore on failure. */ } finally { setSubscriptionSaving(false); }
    if (currentUser?.id !== userId || data !== workspace) return;
    if (!saved) { workspace.subscriptions = previous; subscriptionFormError('The subscription could not be deleted. Please try again.'); return; }
    $('#subscriptionEditor').close(); renderAll(); toast('Subscription deleted');
  });
