  const subscriptionCurrencies = ['PHP', 'USD', 'AUD', 'CAD', 'GBP', 'EUR'];
  const subscriptionDecisions = { undecided: 'Decide later', renew: 'Renew', cancel: 'Do not renew' };
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
      : days <= 7 ? { key: 'soon', label: days === 0 ? 'Expires today' : 'Expiring soon', detail: days === 0 ? 'Renewal date is today' : `${plural(days, 'day')} remaining` }
        : { key: 'active', label: 'Active', detail: `${plural(days, 'day')} remaining` };
  }

  function subscriptionNextDate(item, reference = subscriptionToday()) {
    if (item.cycle === 'custom') return '';
    const base = item.expiryDate >= reference && Number.isFinite(subscriptionDateValue(item.expiryDate)) ? item.expiryDate : reference;
    const date = new Date(subscriptionDateValue(base));
    if (!Number.isFinite(date.getTime())) return '';
    const year = date.getUTCFullYear(), month = date.getUTCMonth() + (item.cycle === 'yearly' ? 12 : 1);
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay))).toISOString().slice(0, 10);
  }

  function subscriptionWebsite(value) {
    if (!String(value || '').trim()) return '';
    try {
      const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && url.hostname.includes('.') ? url.href : null;
    } catch { return null; }
  }

  function validateSubscriptionDraft(input, records = [], editingId = '') {
    const name = String(input.name || '').trim(), account = String(input.account || '').trim();
    if (!name || name.length > 120 || account.length > 200) return { error: 'Enter a service name and keep the account details within 200 characters.' };
    const identity = value => String(value || '').normalize('NFKC').trim().toLowerCase();
    if (records.some(item => item && item.id !== editingId && identity(item.name) === identity(name) && identity(item.account) === identity(account))) return { error: 'This service and account are already saved. Edit the existing subscription.' };
    if (!/^\d+(?:\.\d{1,2})?$/.test(String(input.cost || ''))) return { error: 'Enter the billing cost with no more than two decimal places.' };
    const cents = Math.round(Number(input.cost) * 100);
    if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 99999999900) return { error: 'Enter a valid paid subscription cost greater than zero.' };
    if (!subscriptionCurrencies.includes(input.currency) || !['monthly', 'yearly', 'custom'].includes(input.cycle)) return { error: 'Choose a supported currency and billing cycle.' };
    if (!Number.isFinite(subscriptionDateValue(input.expiryDate))) return { error: 'Choose a valid expiry or renewal date.' };
    if (!Object.hasOwn(subscriptionDecisions, input.decision) || !['active', 'cancelled'].includes(input.tracking)) return { error: 'Choose a renewal decision and tracking status.' };
    const website = subscriptionWebsite(String(input.website || '').trim());
    if (website === null) return { error: 'Use a valid http or https website without account credentials.' };
    return { value: { name, account, plan: String(input.plan || '').trim().slice(0, 120), cents, currency: input.currency,
      cycle: input.cycle, expiryDate: input.expiryDate, decision: input.decision, tracking: input.tracking,
      website, notes: String(input.notes || '').trim().slice(0, 2000) } };
  }

  function renderSubscriptions() {
    const records = (data.subscriptions || []).filter(item => item?.id);
    const states = records.map(item => subscriptionStatus(item));
    $('#subscriptionSummary').innerHTML = [['Active', states.filter(state => ['active', 'soon'].includes(state.key)).length, 'Accounts still in their paid period'],
      ['Expiring soon', states.filter(state => state.key === 'soon').length, 'Today or within the next 7 days'],
      ['Expired', states.filter(state => state.key === 'expired').length, 'Review before paying again']]
      .map(([label, count, detail]) => `<article><span>${label}</span><strong>${count}</strong><small>${detail}</small></article>`).join('');
    const query = $('#subscriptionSearch').value.trim().toLowerCase(), filter = $('#subscriptionFilter').value;
    const visible = records.filter(item => [item.name, item.account, item.plan, item.notes].join(' ').toLowerCase().includes(query))
      .filter(item => filter === 'all' || (filter === 'active' ? ['active', 'soon'].includes(subscriptionStatus(item).key) : subscriptionStatus(item).key === filter))
      .sort((a, b) => Number(a.tracking === 'cancelled') - Number(b.tracking === 'cancelled') || String(a.expiryDate || '9999').localeCompare(String(b.expiryDate || '9999')) || String(a.name).localeCompare(String(b.name)));
    $('#subscriptionCount').textContent = `${plural(visible.length, 'subscription')}${query || filter !== 'all' ? ' shown' : ''}`;
    $('#subscriptionList').innerHTML = visible.length ? visible.map(item => {
      const status = subscriptionStatus(item), website = subscriptionWebsite(item.website);
      const cost = Number.isSafeInteger(item.cents) && item.cents > 0 && subscriptionCurrencies.includes(item.currency)
        ? new Intl.NumberFormat('en-PH', { style: 'currency', currency: item.currency }).format(item.cents / 100) : 'Cost not set';
      return `<article class="subscription-card" data-state="${status.key}"><div class="subscription-card-heading"><div><h2>${escapeHtml(item.name || 'Untitled account')}</h2><p>${escapeHtml(item.account || 'Account not specified')}</p></div><span class="subscription-status">${status.label}</span></div>
        <p class="subscription-plan">${escapeHtml(item.plan || 'Paid subscription')}</p><p class="subscription-price"><strong>${escapeHtml(cost)}</strong><span> / ${item.cycle === 'yearly' ? 'year' : item.cycle === 'monthly' ? 'month' : 'billing cycle'}</span></p>
        <div class="subscription-expiry"><span>Expiry / renewal</span><strong>${Number.isFinite(subscriptionDateValue(item.expiryDate)) ? escapeHtml(formatDate(item.expiryDate)) : 'Not set'}</strong><small>${escapeHtml(status.detail)}</small></div>
        <div class="subscription-decision"><span>Renewal decision</span><strong>${subscriptionDecisions[item.decision] || 'Decide later'}</strong></div>
        <footer>${website ? `<a href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer" aria-label="Open billing website for ${escapeHtml(item.name)}">Billing site <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>` : '<span></span>'}<div><button class="button button-secondary" type="button" data-subscription-edit="${escapeHtml(item.id)}" aria-haspopup="dialog">Manage</button></div></footer></article>`;
    }).join('') : `<div class="subscriptions-empty"><i class="fa-regular fa-credit-card" aria-hidden="true"></i><h2>${records.length ? 'No subscriptions found' : 'No subscriptions yet'}</h2><p>${records.length ? 'Try another search or status filter.' : 'Add a paid account to track its expiry and plan your next renewal.'}</p></div>`;
  }

  function openSubscriptionEditor(id = '', renewal = false) {
    if (subscriptionSaving) return;
    const item = (data.subscriptions || []).find(record => record.id === id);
    if (id && !item) return;
    const form = $('#subscriptionForm'); form.reset();
    form.dataset.userId = currentUser?.id || ''; form.dataset.mode = renewal ? 'renewal' : 'edit';
    $('#subscriptionId').value = item?.id || '';
    $('#subscriptionEditorTitle').textContent = renewal ? 'Record renewal' : item ? 'Manage subscription' : 'Add subscription';
    for (const [field, value] of Object.entries({ Name: item?.name || '', Account: item?.account || '', Plan: item?.plan || '', Cost: item ? (item.cents / 100).toFixed(2) : '',
      Currency: item?.currency || 'PHP', Cycle: item?.cycle || 'monthly', Expiry: renewal ? subscriptionNextDate(item) : item?.expiryDate || '',
      Decision: renewal ? 'renew' : item?.decision || 'undecided', Tracking: renewal ? 'active' : item?.tracking || 'active', Website: item?.website || '', Notes: item?.notes || '' })) $('#subscription' + field).value = value;
    $('#subscriptionFormError').hidden = true; $('#subscriptionRenewalHelp').hidden = !renewal;
    $('#subscriptionPanelActions').hidden = !item || renewal || item.tracking === 'cancelled';
    $('#deleteSubscription').hidden = !item || renewal; $('#saveSubscription').textContent = renewal ? 'Save renewal' : 'Save subscription';
    const dialog = $('#subscriptionEditor'); if (!dialog.open) dialog.showModal();
    (renewal ? $('#subscriptionExpiry') : $('#subscriptionName')).focus();
  }

  function subscriptionFormError(message) {
    $('#subscriptionFormError').textContent = message; $('#subscriptionFormError').hidden = false;
  }

  function setSubscriptionSaving(value) {
    subscriptionSaving = value;
    ['saveSubscription', 'deleteSubscription', 'closeSubscriptionEditor', 'cancelSubscriptionEditor', 'subscriptionRecordRenewal'].forEach(id => { $('#' + id).disabled = value; });
    $('#subscriptionForm').setAttribute('aria-busy', String(value));
  }

  $('#addSubscription').addEventListener('click', () => openSubscriptionEditor());
  $('#subscriptionSearch').addEventListener('input', renderSubscriptions);
  $('#subscriptionFilter').addEventListener('change', renderSubscriptions);
  $('#subscriptionRecordRenewal').addEventListener('click', () => {
    if (!subscriptionSaving && currentUser?.id === $('#subscriptionForm').dataset.userId) openSubscriptionEditor($('#subscriptionId').value, true);
  });
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
    const input = Object.fromEntries(['Name', 'Account', 'Plan', 'Cost', 'Currency', 'Cycle', 'Expiry', 'Decision', 'Tracking', 'Website', 'Notes'].map(field => [field === 'Expiry' ? 'expiryDate' : field.toLowerCase(), $('#subscription' + field).value]));
    const validated = validateSubscriptionDraft(input, workspace.subscriptions || [], id);
    if (validated.error) { subscriptionFormError(validated.error); return; }
    const renewal = event.currentTarget.dataset.mode === 'renewal';
    if (renewal && (input.expiryDate <= existing.expiryDate || input.expiryDate < subscriptionToday())) { subscriptionFormError('Choose a new expiry date after the previous expiry and not before today.'); return; }
    const now = new Date().toISOString(), record = { ...existing, ...validated.value, id: id || uid(), createdAt: existing?.createdAt || now, updatedAt: now,
      ...(renewal ? { lastRenewedAt: now } : {}) };
    const previous = workspace.subscriptions || [];
    workspace.subscriptions = id ? previous.map(item => item.id === id ? record : item) : [...previous, record];
    setSubscriptionSaving(true);
    let saved = false; try { saved = await persist(); } catch { /* Retain the form for retry. */ } finally { setSubscriptionSaving(false); }
    if (currentUser?.id !== userId || data !== workspace) return;
    if (!saved) { workspace.subscriptions = previous; subscriptionFormError('The subscription could not be saved. Please try again.'); return; }
    $('#subscriptionEditor').close(); renderAll();
    toast(renewal ? 'Renewal recorded' : id ? 'Subscription updated' : 'Subscription added');
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
