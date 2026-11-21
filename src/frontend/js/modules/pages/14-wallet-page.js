  const walletAccountNames = { maribank: 'MariBank', gcash: 'GCash', wise: 'Wise', unassigned: 'Other / unassigned' };
  const walletTypeNames = { income: 'Income', expense: 'Expense', payable: 'To be paid', salary: 'Salary', opening: 'Opening balance' };
  const walletMoney = cents => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(cents / 100);
  const walletEntryTypeDetail = entry => entry.type === 'payable' && entry.payee ? `To be paid · Pay to ${entry.payee}` : (walletTypeNames[entry.type] || entry.type);
  let walletTypeFilter = 'all';

  function syncWalletPayeeField() {
    const isPayable = $('#walletEntryType').value === 'payable';
    $('#walletPayeeField').hidden = !isPayable;
    $('#walletEntryPayee').required = isPayable;
    $('#walletEntryPayee').disabled = !isPayable;
    $('#walletAccountField').hidden = isPayable;
    $('#walletEntryAccount').disabled = isPayable;
    $('#walletEntryDateLabel').textContent = isPayable ? 'Payment deadline' : 'Date';
    if (!isPayable && !['maribank', 'gcash', 'wise'].includes($('#walletEntryAccount').value)) $('#walletEntryAccount').value = 'maribank';
  }

  function walletTotals(entries) {
    const totals = { income: 0, expense: 0, payable: 0, salary: 0, balance: 0, available: 0, accounts: { maribank: 0, gcash: 0, wise: 0, unassigned: 0 } };
    entries.forEach(entry => {
      if (!Object.hasOwn(walletAccountNames, entry.account) || !Object.hasOwn(walletTypeNames, entry.type) || !Number.isSafeInteger(entry.cents) || entry.cents <= 0) return;
      if (entry.type === 'payable') { totals.payable += entry.cents; return; }
      const signed = entry.type === 'expense' ? -entry.cents : entry.cents;
      totals.accounts[entry.account] += signed;
      totals.balance += signed;
      if (entry.type !== 'opening') totals[entry.type] += entry.cents;
    });
    totals.available = totals.balance - totals.payable;
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

  function walletReportEntries() {
    return [...(data.walletEntries || []), ...walletInvoiceEntries()].filter(entry => ['income', 'salary', 'expense', 'payable', 'opening'].includes(entry.type) && (entry.cents === null || (Number.isSafeInteger(entry.cents) && entry.cents > 0)));
  }

  function walletReportSelection() {
    const entries = walletReportEntries();
    const period = $('#walletReportPeriod').value;
    if (period === 'salary') {
      const entry = entries.find(item => String(item.id) === $('#walletReportSalary').value && item.type === 'salary');
      return { title: entry ? `Salary report · ${entry.description} · ${entry.date}` : 'Salary report', entries: entry ? [entry] : [], rangeStart: entry?.date || '', rangeEnd: entry?.date || '' };
    }
    const value = period === 'week' ? $('#walletReportWeek').value : $('#walletReportMonth').value;
    if (!value) return { title: period === 'week' ? 'Weekly report' : 'Monthly report', entries: [], rangeStart: '', rangeEnd: '' };
    if (period === 'week') {
      const start = new Date(`${value}T00:00:00`);
      const day = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - day);
      const end = new Date(start); end.setDate(end.getDate() + 7);
      const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const from = localDate(start), until = localDate(end);
      const lastDay = new Date(end); lastDay.setDate(lastDay.getDate() - 1);
      return { title: `Weekly report · ${from} to ${localDate(lastDay)}`, entries: entries.filter(entry => entry.date >= from && entry.date < until), rangeStart: from, rangeEnd: localDate(lastDay) };
    }
    const [year, month] = value.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    return { title: `Monthly report · ${new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1))}`, entries: entries.filter(entry => String(entry.date || '').startsWith(value)), rangeStart: `${value}-01`, rangeEnd: `${value}-${String(lastDay).padStart(2, '0')}` };
  }

  function walletReportTotals(entries) {
    return entries.reduce((totals, entry) => {
      if (entry.type === 'payable') { totals.due += Number.isSafeInteger(entry.cents) && entry.cents > 0 ? entry.cents : 0; totals.dueCount++; return totals; }
      if (!Number.isSafeInteger(entry.cents) || entry.cents <= 0) return totals;
      if (entry.type === 'expense') totals.expense += entry.cents;
      else if (entry.type === 'salary') totals.salary += entry.cents;
      else if (entry.type === 'income') totals.income += entry.cents;
      return totals;
    }, { income: 0, salary: 0, expense: 0, due: 0, dueCount: 0 });
  }

  function renderWalletReport() {
    if (!$('#walletReportPeriod')) return;
    const period = $('#walletReportPeriod').value;
    $('#walletReportMonthField').hidden = period !== 'month';
    $('#walletReportWeekField').hidden = period !== 'week';
    $('#walletReportSalaryField').hidden = period !== 'salary';
    const salaries = walletReportEntries().filter(entry => entry.type === 'salary' && Number.isSafeInteger(entry.cents) && entry.cents > 0).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const salarySelect = $('#walletReportSalary');
    const previous = salarySelect.value;
    salarySelect.innerHTML = salaries.map(entry => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.description)} · ${escapeHtml(entry.date)} · ${walletMoney(entry.cents)}</option>`).join('');
    if (salaries.some(entry => String(entry.id) === previous)) salarySelect.value = previous;
    return walletReportSelection();
  }

  async function walletReportPdf() {
    const report = renderWalletReport();
    if (!report) return null;
    const pdfLibrary = window.JeffWalletReportPdf || await import('./wallet-report-pdf.js?v=20261121-live-pdf-module');
    const title = report.title.replace(/^Monthly report · /, 'Monthly report - ').replace(/^Weekly report · /, 'Weekly report - ').replace(/^Salary report · /, 'Salary report - ');
    const pdfBytes = pdfLibrary.createWalletReportPdf({ title, period: title.replace(/^(Monthly|Weekly|Salary) report\s*[·-]\s*/, ''), rangeStart: report.rangeStart, rangeEnd: report.rangeEnd, userName: currentUser?.user_metadata?.full_name || 'Jeffrey Almocera', entries: report.entries, accountBalances: walletTotals([...(data.walletEntries || []), ...walletInvoiceEntries()]).accounts });
    const filename = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
    return { blob: new Blob([pdfBytes], { type: 'application/pdf' }), filename, report };
  }

  async function downloadWalletReport() {
    const button = $('#walletDownloadReport'); button.disabled = true;
    try {
      const generated = await walletReportPdf(); if (!generated) return;
      const url = URL.createObjectURL(generated.blob), link = document.createElement('a');
      link.href = url; link.download = generated.filename; link.hidden = true; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Wallet PDF downloaded.');
    } catch (error) { toast(error.message || 'Wallet PDF could not be downloaded.'); }
    finally { button.disabled = false; }
  }

  async function emailWalletReportPreview() {
    const button = $('#walletEmailReport'); button.disabled = true;
    let generated;
    try { generated = await walletReportPdf(); } catch (error) { toast(error.message || 'Wallet PDF could not be created.'); button.disabled = false; return; }
    button.disabled = false;
    if (!generated) return;
    const report = generated.report;
    const recipient = currentUser?.email || '';
    if (!recipient) { toast('Your account email is not available.'); return; }
    const { title, entries } = report;
    const totals = walletReportTotals(entries);
    const net = totals.income + totals.salary - totals.expense;
    const lines = [`${title}`, '', `Other income: ${walletMoney(totals.income)}`, `Salary received: ${walletMoney(totals.salary)}`, `Expenses: ${walletMoney(totals.expense)}`, `To be paid: ${walletMoney(totals.due)} (${totals.dueCount} unpaid item${totals.dueCount === 1 ? '' : 's'})`, `Net: ${walletMoney(net)}`, '', 'Transactions:', ...entries.map(entry => `${entry.date} · ${walletEntryTypeDetail(entry)} · ${entry.description} · ${entry.cents === null ? 'Needs PHP amount' : entry.type === 'payable' ? `Due ${walletMoney(entry.cents)}` : `${entry.type === 'expense' ? '−' : entry.type === 'opening' ? '' : '+'}${walletMoney(entry.cents)}`}`), '', 'This is a preview generated from your Wallet records. Review it before sending.'];
    composeClientId = null;
    composeActivationClientId = null;
    composeAttachment = null;
    composeAttachmentFile = new File([generated.blob], generated.filename, { type: 'application/pdf' });
    composeInvoiceDraft = null;
    composeDocumentUpdateClientId = null;
    composeContractEmailMode = false;
    contractEmailSendPending = false;
    composeRequiresConfirmation = false;
    $('#emailComposeForm').classList.remove('onboarding-email-compose');
    $('#emailComposeForm').dataset.invoiceCompose = 'false';
    $('#composeExtraOptions').open = false;
    $('#composeTo').value = recipient;
    $('#composeSubject').value = `Wallet report · ${title}`;
    $('#composeBody').value = lines.join('\n');
    $('#composeAttachmentInput').value = '';
    $('#composeAttachmentName').textContent = generated.filename;
    updateComposeAttachmentDisplay();
    $('#emailTemplateName').value = '';
    setEmailComposeStatus(gmailAccessToken ? 'Ready to send through Gmail.' : 'Gmail will connect automatically when you send.');
    $('#emailComposeTitle').textContent = 'Review wallet report email';
    $('#sendEmailButton').textContent = 'Send email';
    $('#emailComposeModal').classList.remove('email-compose-side-panel');
    $('#walletReportMore')?.removeAttribute('open');
    $('#emailComposeModal').showModal();
    $('#composeBody').focus();
  }

  function renderWallet() {
    // Derive payments from invoices instead of copying them: edits and unpaid status stay in sync.
    const invoiceEntries = walletInvoiceEntries();
    const entries = [...(data.walletEntries || []), ...invoiceEntries];
    const totals = walletTotals(entries);
    const now = new Date();
    if (!$('#walletReportMonth').value) $('#walletReportMonth').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (!$('#walletReportWeek').value) $('#walletReportWeek').value = today();
    $('#walletSummary').innerHTML = [
      ['balance', 'Total balance', 'All time', 'fa-wallet'],
      ['income', 'Income', 'All time', 'fa-arrow-trend-up'],
      ['salary', 'Salary', 'All time', 'fa-briefcase'],
      ['payable', 'To pay', `Balance after: ${walletMoney(totals.available)}`, 'fa-calendar-check'],
      ['expense', 'Expenses', 'All time', 'fa-arrow-trend-down']
    ].map(([key, label, detail, icon]) => `<article class="wallet-stat wallet-stat-${key}"><span><i class="fa-solid ${icon}" aria-hidden="true"></i> ${label}</span><strong>${walletMoney(totals[key])}</strong><small class="${key === 'payable' && totals.available < 0 ? 'wallet-negative' : ''}">${detail}</small></article>`).join('');
    renderWalletReport();
    $('#walletAccounts').innerHTML = Object.entries(walletAccountNames).filter(([key]) => key !== 'unassigned' || entries.some(entry => entry.account === key && entry.type !== 'payable')).map(([key, name]) => `<article class="wallet-account wallet-account-${key}"><span class="wallet-account-mark" aria-hidden="true">${name[0]}</span><h4>${escapeHtml(name)}</h4><strong>${totals.accounts[key] ? walletMoney(totals.accounts[key]) : '<span class="wallet-zero">No balance</span>'}</strong></article>`).join('');
    const missingPhp = invoiceEntries.filter(entry => entry.cents === null).length;
    $('#walletInvoiceNotice').textContent = missingPhp ? `${missingPhp} paid invoice(s) need an amount received in PHP. They appear below but are excluded from PHP totals until you edit the payment.` : '';
    $('#walletInvoiceNotice').hidden = !missingPhp;
    $('#walletClientRates').innerHTML = hiredClients().filter(isActiveContract).map(client => { const rate = clientDashboardRate(client); return `<article class="wallet-account"><h4>${escapeHtml(client.clientName || 'Client')}</h4>${rate ? `<strong>${escapeHtml(rate)}</strong>` : `<button class="wallet-set-rate" type="button" data-wallet-set-rate="${escapeHtml(client.id)}">Set rate</button>`}</article>`; }).join('') || '<p class="wallet-hint">No active client contracts.</p>';
    const account = $('#walletAccountFilter').value;
    const visible = entries.filter(entry => (account === 'all' || entry.account === account) && (walletTypeFilter === 'all' || entry.type === walletTypeFilter)).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
    $('#walletTransactionList').innerHTML = visible.length ? `<div class="wallet-table-scroll"><table class="wallet-table"><thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Account</th><th scope="col">Amount</th><th scope="col">Actions</th></tr></thead><tbody>${visible.map(entry => `<tr><td data-label="Date">${escapeHtml(formatDate(entry.date))}</td><td data-label="Description"><strong>${escapeHtml(entry.description)}</strong><small>${escapeHtml(walletEntryTypeDetail(entry))}</small></td><td data-label="Account">${entry.type === 'payable' ? '—' : escapeHtml(walletAccountNames[entry.account] || entry.account)}</td><td data-label="Amount" class="wallet-amount ${entry.type === 'expense' ? 'wallet-outgoing' : entry.type === 'payable' ? 'wallet-pending' : 'wallet-incoming'}">${entry.type === 'expense' ? '−' : entry.type === 'payable' ? 'Due ' : '+'}${entry.cents === null ? 'Needs PHP amount' : walletMoney(entry.cents)}</td><td data-label="Actions"><div class="wallet-row-actions">${entry.invoiceId ? `<button type="button" class="button button-secondary" data-wallet-invoice="${escapeHtml(entry.invoiceId)}">Edit payment</button>` : `<button type="button" class="button button-secondary" data-wallet-actions="${escapeHtml(entry.id)}" aria-haspopup="dialog" aria-label="Actions for ${escapeHtml(entry.description)}">Actions</button>`}</div></td></tr>`).join('')}</tbody></table></div>` : `<div class="wallet-empty"><i class="fa-solid fa-wallet" aria-hidden="true"></i><h4>${entries.length ? 'No transactions match these filters' : 'No wallet transactions yet'}</h4><p>${entries.length ? 'Try another account or transaction type.' : 'Add your first wallet transaction to see it here.'}</p><button class="button button-secondary" type="button" data-wallet-empty-add>Add transaction</button></div>`;
    $$('.wallet-type-filter [data-wallet-type]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.walletType === walletTypeFilter)));
    if (typeof loadBackgroundFollowUpStatus === 'function') loadBackgroundFollowUpStatus();
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
    $('#walletEntryPayee').value = entry?.payee || '';
    syncWalletPayeeField();
    $('#walletEntryPanel').showModal();
    $('#walletEntryType').focus();
  }

  let walletActionId = null;
  function closeWalletActions() {
    const panel = $('#walletActionsPanel');
    if (panel?.open) panel.close();
    walletActionId = null;
  }
  function openWalletActions(id) {
    const entry = (data.walletEntries || []).find(item => item.id === id);
    const panel = $('#walletActionsPanel');
    if (!entry || !panel) return;
    walletActionId = id;
    $('#walletActionsSubtitle').textContent = entry.description || 'Wallet transaction';
    panel.showModal();
    $('#walletEditAction')?.focus();
  }

  $('#walletAddEntry').addEventListener('click', () => openWalletEntry());
  $('#walletEntryType').addEventListener('change', syncWalletPayeeField);
  $('#walletCancelEntry').addEventListener('click', () => { $('#walletEntryPanel').close(); $('#walletAddEntry').focus(); });
  $('#walletAccountFilter').addEventListener('change', renderWallet);
  $('.wallet-type-filter').addEventListener('click', event => { const button = event.target.closest('[data-wallet-type]'); if (!button) return; walletTypeFilter = button.dataset.walletType; renderWallet(); });
  $('#walletClientRates').addEventListener('click', event => { const button = event.target.closest('[data-wallet-set-rate]'); if (!button) return; openClientModal(button.dataset.walletSetRate, false, true, false, true); });
  $('#walletTransactionList').addEventListener('click', event => { if (event.target.closest('[data-wallet-empty-add]')) openWalletEntry(); });
  $('#walletReportPeriod').addEventListener('change', renderWallet);
  $('#walletReportMonth').addEventListener('change', renderWallet);
  $('#walletReportWeek').addEventListener('change', renderWallet);
  $('#walletReportSalary').addEventListener('change', renderWallet);
  $('#walletDownloadReport').addEventListener('click', downloadWalletReport);
  $('#walletEmailReport').addEventListener('click', emailWalletReportPreview);
  $('#walletCancelActions')?.addEventListener('click', closeWalletActions);
  $('#walletEditAction')?.addEventListener('click', () => {
    const entry = (data.walletEntries || []).find(item => item.id === walletActionId);
    closeWalletActions();
    if (entry) openWalletEntry(entry);
  });
  $('#walletDeleteAction')?.addEventListener('click', async () => {
    const id = walletActionId;
    closeWalletActions();
    if (!id) return;
    const entry = (data.walletEntries || []).find(item => item.id === id);
    if (!entry || !await appConfirm('Delete this transaction? Its amount will be removed from your wallet totals.', { title: 'Delete transaction', confirmLabel: 'Delete', danger: true })) return;
    data.walletEntries = (data.walletEntries || []).filter(item => item.id !== id);
    renderWallet();
    renderAlerts();
    if (await persist()) toast('Wallet transaction deleted.');
  });
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
    const type = $('#walletEntryType').value;
    const payee = type === 'payable' ? $('#walletEntryPayee').value.trim() : '';
    if (!Number.isSafeInteger(cents) || cents <= 0 || !description) { toast('Enter a valid amount and description.'); return; }
    if (type === 'payable' && !payee) { toast('Enter who this payment is for.'); $('#walletEntryPayee').focus(); return; }
    const entries = data.walletEntries || [];
    const id = $('#walletEntryId').value;
    const existing = entries.find(entry => entry.id === id);
    if (id && !existing) { toast('This transaction no longer exists. Cancel and add a new entry.'); return; }
    const entry = { id: existing?.id || crypto.randomUUID(), type, account: type === 'payable' ? 'unassigned' : $('#walletEntryAccount').value, cents, description, payee, date: $('#walletEntryDate').value, createdAt: existing?.createdAt || new Date().toISOString() };
    data.walletEntries = existing ? entries.map(item => item.id === id ? entry : item) : [...entries, entry];
    $('#walletEntryPanel').close();
    renderWallet();
    renderAlerts();
    if (await persist()) toast('Wallet transaction saved.');
  });
  $('#walletTransactionList').addEventListener('click', async event => {
    const invoiceButton = event.target.closest('[data-wallet-invoice]');
    if (invoiceButton) { openInvoicePayment(invoiceButton.dataset.walletInvoice); return; }
    const actions = event.target.closest('[data-wallet-actions]');
    if (actions) { openWalletActions(actions.dataset.walletActions); return; }
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
    renderAlerts();
    if (await persist()) toast('Wallet transaction deleted.');
  });
