  const INVOICE_PAYMENT_METHODS = ['Wise', 'PayPal', 'Payoneer', 'GCash', 'Bank transfer', 'Other'];

  function parseInvoiceDate(value) {
    const text = String(value || '').trim();
    let year;
    let month;
    let day;
    let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/);
    if (match) [, year, month, day] = match;
    else if ((match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [, day, month, year] = match;
    else {
      match = text.match(/^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})$/i);
      if (!match) return '';
      const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      month = monthNames.indexOf(match[1].slice(0, 3).toLowerCase()) + 1;
      day = match[2];
      year = match[3];
    }
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return '';
    return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function invoicePaymentStatus(invoice) {
    if (invoice.paidAt) return 'Paid';
    const dueDate = parseInvoiceDate(invoice.dueDate);
    return dueDate && dueDate < today() ? 'Overdue' : 'Sent';
  }

  function invoiceAmount(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '';
  }

  function invoicePaymentSummary(invoices) {
    const totals = { invoiced: new Map(), received: new Map(), unpaid: new Map() };
    let paidCount = 0;
    invoices.forEach(invoice => {
      const paid = invoicePaymentStatus(invoice) === 'Paid';
      if (paid) paidCount += 1;
      const currency = String(invoice.paymentCurrency || 'USD').toUpperCase();
      const amountInvoiced = invoice.amountInvoiced === '' || invoice.amountInvoiced == null ? Number.NaN : Number(invoice.amountInvoiced);
      const amountReceived = invoice.amountReceived === '' || invoice.amountReceived == null ? Number.NaN : Number(invoice.amountReceived);
      if (Number.isFinite(amountInvoiced) && amountInvoiced >= 0) {
        totals.invoiced.set(currency, (totals.invoiced.get(currency) || 0) + amountInvoiced);
        if (!paid) totals.unpaid.set(currency, (totals.unpaid.get(currency) || 0) + Math.max(0, amountInvoiced - (Number.isFinite(amountReceived) ? amountReceived : 0)));
      }
      if (Number.isFinite(amountReceived) && amountReceived >= 0) totals.received.set(currency, (totals.received.get(currency) || 0) + amountReceived);
    });
    const formatTotals = map => [...map].map(([currency, amount]) => `${invoiceAmount(amount)} ${escapeHtml(currency)}`).join(' · ');
    return `
      <div class="client-invoice-payment-summary" aria-label="Invoice payment summary">
        <div><strong>Billed</strong><span>${formatTotals(totals.invoiced) || '—'}</span><small>${invoices.length} ${plural(invoices.length, 'invoice')}</small></div>
        <div><strong>Received</strong><span>${formatTotals(totals.received) || '—'}</span><small>${paidCount} paid</small></div>
        <div><strong>Outstanding</strong><span>${formatTotals(totals.unpaid) || '—'}</span><small>${invoices.length - paidCount} unpaid${invoices.filter(invoice => invoicePaymentStatus(invoice) === 'Overdue').length ? ` · <span class="client-invoice-overdue-copy">${invoices.filter(invoice => invoicePaymentStatus(invoice) === 'Overdue').length} overdue</span>` : ''}</small></div>
        ${invoices.some(invoice => invoice.amountInvoiced === '' || invoice.amountInvoiced == null) ? '<small class="client-invoice-payment-hint">Some invoices have no amount</small>' : ''}
      </div>`;
  }

  function invoicePaymentDetail(invoice) {
    const parts = [];
    const paidDate = parseInvoiceDate(invoice.paidAt);
    if (paidDate) parts.push(formatDate(paidDate));
    const received = invoice.amountReceived === '' || invoice.amountReceived == null ? Number.NaN : Number(invoice.amountReceived);
    if (Number.isFinite(received) && received >= 0) parts.push(`${invoiceAmount(received)}${invoice.paymentCurrency ? ` ${String(invoice.paymentCurrency).toUpperCase()}` : ''}`);
    if (invoice.paymentMethod) parts.push(String(invoice.paymentMethod));
    return parts.length ? `Paid ${parts.join(' · ')}` : '';
  }

  function openInvoicePayment(invoiceId) {
    const invoice = (data.invoices || []).find(item => item.id === invoiceId);
    if (!invoice) return;
    const client = data.applications.find(item => item.id === invoice.clientId);
    const salaryAmount = Number(client?.salaryAmount);
    const amountPrefill = Number.isFinite(salaryAmount) && salaryAmount >= 0 && client?.salaryAmount !== '' ? String(salaryAmount) : '';
    const currency = invoice.paymentCurrency || client?.salaryCurrency || 'USD';
    const currencySelect = $('#invoicePaymentCurrency');
    if (![...currencySelect.options].some(option => option.value === currency)) {
      const option = document.createElement('option');
      option.value = currency;
      option.textContent = currency;
      currencySelect.append(option);
    }
    $('#invoicePaymentForm').dataset.invoiceId = invoice.id;
    $('#invoicePaymentTitle').textContent = invoice.paidAt ? 'Edit payment' : 'Mark invoice as paid';
    $('#invoicePaymentDate').value = parseInvoiceDate(invoice.paidAt) || today();
    $('#invoiceAmountReceived').value = invoice.amountReceived ?? amountPrefill;
    currencySelect.value = currency;
    $('#invoicePaymentFee').value = invoice.paymentFee ?? '';
    $('#invoiceAmountReceivedPhp').value = invoice.amountReceivedPhp ?? '';
    $('#invoicePaymentMethod').value = invoice.paymentMethod || '';
    $('#invoiceAmountInvoiced').value = invoice.amountInvoiced ?? amountPrefill;
    $('#invoicePaymentNote').value = invoice.paymentNote || '';
    $('#invoicePaymentModal').showModal();
    $('#invoicePaymentDate').focus();
  }

  async function markInvoiceUnpaid(invoiceId) {
    const invoice = (data.invoices || []).find(item => item.id === invoiceId);
    if (!invoice) return;
    if (!(await appConfirm(`Mark invoice ${invoice.invoiceNumber || ''} as unpaid? Its payment details will be cleared.`, {
      title: 'Mark invoice as unpaid',
      confirmLabel: 'Mark as unpaid',
      danger: true
    }))) return;
    ['paymentStatus', 'paidAt', 'amountInvoiced', 'amountReceived', 'paymentCurrency', 'paymentFee', 'amountReceivedPhp', 'paymentMethod', 'paymentNote']
      .forEach(field => delete invoice[field]);
    persist();
    const client = data.applications.find(item => item.id === invoice.clientId);
    if (client) renderHiredDetail(client, false);
    showActionResult({ title: 'Payment cleared', message: 'The invoice is marked as unpaid.' });
  }

  $('#invoicePaymentForm').addEventListener('submit', event => {
    if (event.submitter?.value === 'cancel') return;
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const invoice = (data.invoices || []).find(item => item.id === form.dataset.invoiceId);
    if (!invoice) {
      $('#invoicePaymentModal').close();
      showActionResult({ title: 'Invoice not found', message: 'The invoice could not be found. Refresh the client details and try again.', status: 'error' });
      return;
    }
    const dateReceived = $('#invoicePaymentDate').value;
    const amountReceivedText = $('#invoiceAmountReceived').value;
    const amountReceived = Number(amountReceivedText);
    if (!parseInvoiceDate(dateReceived) || amountReceivedText === '' || !Number.isFinite(amountReceived) || amountReceived < 0) {
      toast('Enter a valid date and a non-negative amount received.');
      return;
    }
    const optionalAmounts = [
      ['amountInvoiced', '#invoiceAmountInvoiced'],
      ['paymentFee', '#invoicePaymentFee'],
      ['amountReceivedPhp', '#invoiceAmountReceivedPhp']
    ];
    const payment = {
      paymentStatus: 'paid',
      paidAt: dateReceived,
      amountReceived,
      paymentCurrency: $('#invoicePaymentCurrency').value || 'USD',
      paymentMethod: $('#invoicePaymentMethod').value,
      paymentNote: $('#invoicePaymentNote').value.trim()
    };
    for (const [field, selector] of optionalAmounts) {
      const value = $(selector).value;
      if (value === '') {
        payment[field] = '';
        continue;
      }
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount < 0) {
        toast('Enter valid non-negative amounts.');
        return;
      }
      payment[field] = amount;
    }
    Object.entries(payment).forEach(([field, value]) => {
      if (value === '') delete invoice[field];
      else invoice[field] = value;
    });
    persist();
    $('#invoicePaymentModal').close();
    const client = data.applications.find(item => item.id === invoice.clientId);
    if (client) renderHiredDetail(client, false);
    showActionResult({ title: 'Payment saved', message: `Payment for ${invoice.invoiceNumber || 'the invoice'} was saved.` });
  });
