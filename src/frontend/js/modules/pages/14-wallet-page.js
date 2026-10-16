  const walletAccountNames = { maribank: 'MariBank', gcash: 'GCash', wise: 'Wise', unassigned: 'Other / unassigned' };
  const walletTypeNames = { income: 'Income', expense: 'Expense', salary: 'Salary', opening: 'Opening balance' };
  const walletMoney = cents => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(cents / 100);

  function walletTotals(entries) {
    const totals = { income: 0, expense: 0, salary: 0, balance: 0, accounts: { maribank: 0, gcash: 0, wise: 0, unassigned: 0 } };
    entries.forEach(entry => {
      if (!Object.hasOwn(walletAccountNames, entry.account) || !Object.hasOwn(walletTypeNames, entry.type) || !Number.isSafeInteger(entry.cents) || entry.cents <= 0) return;
      const signed = entry.type === 'expense' ? -entry.cents : entry.cents;
      totals.accounts[entry.account] += signed;
      totals.balance += signed;
      if (entry.type !== 'opening') totals[entry.type] += entry.cents;
    });
    return totals;
  }

  function walletInvoiceAccount(invoice) {
    if (Object.hasOwn(walletAccountNames, invoice.walletAccount)) return invoice.walletAccount;
    const method = String(invoice.paymentMethod || '').trim().toLowerCase();
    return ['maribank', 'gcash', 'wise'].includes(method) ? method : 'unassigned';
  }

  function walletInvoiceEntries() {
    const seen = new Set();
    return (data.invoices || []).flatMap(invoice => {
      if (!invoice.id || seen.has(invoice.id) || invoicePaymentStatus(invoice) !== 'Paid') return [];
      seen.add(invoice.id);
      const php = invoice.amountReceivedPhp;
      const amount = php !== '' && php != null ? Number(php)
        : String(invoice.paymentCurrency || 'USD').toUpperCase() === 'PHP' && invoice.amountReceived !== '' && invoice.amountReceived != null ? Number(invoice.amountReceived) : NaN;
      const cents = Math.round(amount * 100);
      const client = (data.applications || []).find(item => item.id === invoice.clientId);
      return [{ id: `invoice:${invoice.id}`, invoiceId: invoice.id, type: 'salary', account: walletInvoiceAccount(invoice), cents: Number.isSafeInteger(cents) && cents >= 0 ? cents : null, description: `${client?.clientName || 'Client'} · Invoice ${invoice.invoiceNumber || invoice.id}`, date: parseInvoiceDate(invoice.paidAt), createdAt: invoice.sentAt || '' }];
    });
  }

  function renderWallet() {
    // Derive payments from invoices instead of copying them: edits and unpaid status stay in sync.
    const invoiceEntries = walletInvoiceEntries();
    const entries = [...(data.walletEntries || []), ...invoiceEntries];
    const totals = walletTotals(entries);
    $('#walletSummary').innerHTML = [
      ['balance', 'Total balance', 'All recorded PHP balances', 'fa-wallet'],
      ['income', 'Income', 'Other earnings · all time', 'fa-arrow-trend-up'],
      ['salary', 'Salary', 'Salary received · all time', 'fa-briefcase'],
      ['expense', 'Expenses', 'Spending · all time', 'fa-arrow-trend-down']
    ].map(([key, label, detail, icon]) => `<article class="wallet-stat wallet-stat-${key}"><span><i class="fa-solid ${icon}" aria-hidden="true"></i> ${label}</span><strong>${walletMoney(totals[key])}</strong><small>${detail}</small></article>`).join('');
    $('#walletAccounts').innerHTML = Object.entries(walletAccountNames).filter(([key]) => key !== 'unassigned' || entries.some(entry => entry.account === key)).map(([key, name]) => `<article class="wallet-account wallet-account-${key}"><div><span class="wallet-account-mark" aria-hidden="true">${name[0]}</span><h4>${name}</h4></div><strong>${walletMoney(totals.accounts[key])}</strong><span>Recorded balance · PHP</span></article>`).join('');
    const missingPhp = invoiceEntries.filter(entry => entry.cents === null).length;
    $('#walletInvoiceNotice').textContent = missingPhp ? `${missingPhp} paid invoice(s) need an amount received in PHP. They appear below but are excluded from PHP totals until you edit the payment.` : 'Paid invoices appear automatically as salary. Edit their payment details to update the amount or receiving account; do not add the same payment manually.';
    $('#walletClientRates').innerHTML = hiredClients().filter(isActiveContract).map(client => `<article class="wallet-account"><h4>${escapeHtml(client.clientName || 'Client')}</h4><strong>${escapeHtml(clientDashboardRate(client) || 'Rate not set')}</strong><span>Contract rate · counted as received only after payment</span></article>`).join('') || '<p class="wallet-hint">No active client contracts.</p>';
    const account = $('#walletAccountFilter').value;
    const visible = entries.filter(entry => account === 'all' || entry.account === account).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
    $('#walletTransactionList').innerHTML = visible.length ? `<div class="wallet-table-scroll"><table class="wallet-table"><thead><tr><th scope="col">Transaction</th><th scope="col">Date</th><th scope="col">Account</th><th scope="col">Amount</th><th scope="col">Actions</th></tr></thead><tbody>${visible.map(entry => `<tr><td><strong>${escapeHtml(entry.description)}</strong><small>${escapeHtml(walletTypeNames[entry.type] || entry.type)}</small></td><td>${escapeHtml(entry.date)}</td><td>${escapeHtml(walletAccountNames[entry.account] || entry.account)}</td><td class="wallet-amount ${entry.type === 'expense' ? 'wallet-outgoing' : 'wallet-incoming'}">${entry.type === 'expense' ? '−' : '+'}${entry.cents === null ? 'Needs PHP amount' : walletMoney(entry.cents)}</td><td><div class="wallet-row-actions">${entry.invoiceId ? `<button type="button" class="button button-secondary" data-wallet-invoice="${escapeHtml(entry.invoiceId)}">Edit payment</button>` : `<button type="button" class="button button-secondary" data-wallet-edit="${escapeHtml(entry.id)}" aria-label="Edit ${escapeHtml(entry.description)}">Edit</button><button type="button" class="button button-secondary" data-wallet-delete="${escapeHtml(entry.id)}" aria-label="Delete ${escapeHtml(entry.description)}">Delete</button>`}</div></td></tr>`).join('')}</tbody></table></div>` : '<div class="wallet-empty"><i class="fa-solid fa-wallet" aria-hidden="true"></i><h4>No transactions yet</h4><p>Add an opening balance, income, salary, or expense to start tracking.</p></div>';
  }

  function openWalletEntry(entry = null) {
    $('#walletEntryForm').reset();
    $('#walletEntryId').value = entry?.id || '';
    $('#walletEntryTitle').textContent = entry ? 'Edit transaction' : 'Add transaction';
    $('#walletEntryType').value = entry?.type || 'expense';
    $('#walletEntryAccount').value = entry?.account || 'maribank';
    $('#walletEntryAmount').value = entry ? (entry.cents / 100).toFixed(2) : '';
    $('#walletEntryDate').value = entry?.date || today();
    $('#walletEntryDescription').value = entry?.description || '';
    $('#walletEntryPanel').showModal();
    $('#walletEntryType').focus();
  }

  $('#walletAddEntry').addEventListener('click', () => openWalletEntry());
  $('#walletCancelEntry').addEventListener('click', () => { $('#walletEntryPanel').close(); $('#walletAddEntry').focus(); });
  $('#walletAccountFilter').addEventListener('change', renderWallet);
  $('#walletAmountKeypad').addEventListener('click', event => {
    const key = event.target.closest('[data-wallet-key]')?.dataset.walletKey;
    const amount = $('#walletEntryAmount');
    if (!key || !amount) return;
    const current = String(amount.value || '');
    if (key === 'clear') amount.value = '';
    else if (key === 'backspace') amount.value = current.slice(0, -1);
    else if (key === '.' && !current.includes('.')) amount.value = current ? `${current}.` : '0.';
    else if (/^\d$/.test(key) && current.length < 12 && !(current === '0' && key === '0')) amount.value = current === '0' ? key : `${current}${key}`;
    amount.focus();
    amount.dispatchEvent(new Event('input', { bubbles: true }));
  });
  $('#walletEntryForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    if (!dataReady || !supabaseDataLoaded || !currentUser) { toast('Wait for your workspace to finish loading.'); return; }
    const cents = Math.round(Number($('#walletEntryAmount').value) * 100);
    const description = $('#walletEntryDescription').value.trim();
    if (!Number.isSafeInteger(cents) || cents <= 0 || !description) { toast('Enter a valid amount and description.'); return; }
    const entries = data.walletEntries || [];
    const id = $('#walletEntryId').value;
    const existing = entries.find(entry => entry.id === id);
    if (id && !existing) { toast('This transaction no longer exists. Cancel and add a new entry.'); return; }
    const entry = { id: existing?.id || crypto.randomUUID(), type: $('#walletEntryType').value, account: $('#walletEntryAccount').value, cents, description, date: $('#walletEntryDate').value, createdAt: existing?.createdAt || new Date().toISOString() };
    data.walletEntries = existing ? entries.map(item => item.id === id ? entry : item) : [...entries, entry];
    $('#walletEntryPanel').close();
    renderWallet();
    if (await persist()) toast('Wallet transaction saved.');
  });
  $('#walletTransactionList').addEventListener('click', async event => {
    const invoiceButton = event.target.closest('[data-wallet-invoice]');
    if (invoiceButton) { openInvoicePayment(invoiceButton.dataset.walletInvoice); return; }
    const edit = event.target.closest('[data-wallet-edit]');
    const remove = event.target.closest('[data-wallet-delete]');
    const id = edit?.dataset.walletEdit || remove?.dataset.walletDelete;
    if (!id) return;
    const entry = (data.walletEntries || []).find(item => item.id === id);
    if (!entry) return;
    if (edit) { openWalletEntry(entry); return; }
    if (!await appConfirm('Delete this transaction? Its amount will be removed from your wallet totals.', { title: 'Delete transaction', confirmLabel: 'Delete', danger: true })) return;
    data.walletEntries = (data.walletEntries || []).filter(item => item.id !== id);
    if ($('#walletEntryId').value === id) $('#walletEntryPanel').close();
    renderWallet();
    if (await persist()) toast('Wallet transaction deleted.');
  });
