/* Shared invoice calculations: browser and draft-only Cloudflare scheduler. */
(function (root, factory) {
  const engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  else root.JeffInvoiceEngine = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000;
  const currencies = ['USD', 'PHP', 'EUR', 'GBP', 'AUD', 'CAD'];
  const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max);
  const issuerAddress = value => {
    const address=clean(value,500);
    return /^Calamba City,\s*Laguna[,\s]+Philippines$/i.test(address)?'Philippines':address;
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const date = new Date(value + 'T12:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function addDays(value, days) {
    if (!validDate(value)) throw new Error('Choose a valid billing date.');
    return new Date(Date.parse(value + 'T12:00:00Z') + days * DAY).toISOString().slice(0, 10);
  }
  function weekStart(value) {
    if (!validDate(value)) throw new Error('Choose a valid billing week.');
    const weekday = new Date(value + 'T12:00:00Z').getUTCDay();
    return addDays(value, -((weekday + 6) % 7));
  }
  function zoneParts(now, zone) {
    const parts = new Intl.DateTimeFormat('en-CA', {timeZone:zone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now));
    return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  }
  function localDate(now, zone) { const p = zoneParts(now, zone); return `${p.year}-${p.month}-${p.day}`; }
  function localInstant(date, hour, zone) {
    const target = Date.parse(`${date}T${String(hour).padStart(2,'0')}:00:00Z`);
    let guess = target;
    for (let i=0;i<4;i++) {
      const p = zoneParts(guess, zone);
      const shown = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
      guess += target - shown;
    }
    return guess;
  }
  function cents(value) {
    const text = String(value ?? '').trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('Enter a valid amount with at most two decimal places.');
    const result = Math.round(Number(text) * 100);
    if (!Number.isSafeInteger(result) || result < 0 || result > 1000000000) throw new Error('The rate or weekly fee is out of range.');
    return result;
  }
  const money = (value, currency) => new Intl.NumberFormat('en-US',{style:'currency',currency, currencyDisplay:'code'}).format(value / 100);
  const formatDate = value => validDate(value) ? new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z')) : '';
  function workDuration(hours, days=5) {
    const workdays=Number(days);
    if(!Number.isInteger(workdays) || workdays<1 || workdays>7)throw new Error('Choose between 1 and 7 workdays per week.');
    if(hours==='' || hours==null)return null;
    const weeklyHours=Number(hours);
    if(!Number.isFinite(weeklyHours) || Math.round(weeklyHours*100)<=0 || weeklyHours>workdays*24)throw new Error('Enter weekly hours greater than zero and no more than 24 hours per workday.');
    return {hoursPerWeek:Math.round(weeklyHours*100)/100,daysPerWeek:workdays};
  }
  function durationLabel(duration) {
    if(!duration)return '';
    const valid=workDuration(duration.hoursPerWeek,duration.daysPerWeek);if(!valid)return '';
    const hoursPerDay=new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(valid.hoursPerWeek/valid.daysPerWeek);
    return `${valid.hoursPerWeek} hours/week · ${valid.daysPerWeek} workday${valid.daysPerWeek===1?'':'s'} · ${hoursPerDay} hours/day`;
  }
  function settings(input = {}) {
    const issuer = input.issuer || {}, payment = input.payment || {}, schedule = input.schedule || {};
    const duration=workDuration(input.weeklyHours ?? '',input.workdays ?? 5);
    const result = {
      basis: ['logged','agreed'].includes(input.basis) ? input.basis : 'weekly',
      weeklyHours:duration?.hoursPerWeek ?? '',workdays:Number(input.workdays ?? 5),
      rate: clean(input.rate, 30), currency: currencies.includes(input.currency) ? input.currency : 'USD',
      service: clean(input.service || 'Professional services', 160),
      termsDays: Math.max(0,Math.min(90,Math.floor(Number(input.termsDays ?? 7)))),
      timezone: clean(input.timezone || 'Asia/Manila',80), prefix: clean(input.prefix || 'JV',16).replace(/[^A-Za-z0-9-]/g,'') || 'JV',
      issuer:{ name:clean(issuer.name,160), email:clean(issuer.email,200), address:issuerAddress(issuer.address), phone:clean(issuer.phone,80),
        logo:/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(issuer.logo || '') && issuer.logo.length <= 180000 ? issuer.logo : '' },
      payment:{ method:clean(payment.method,80), details:clean(payment.details,1400),options:(Array.isArray(payment.options)?payment.options:[]).slice(0,8).map(option=>({method:clean(option.method,80),details:clean(option.details,1400)})).filter(option=>option.method && option.details) },
      notes:clean(input.notes,1400),
      schedule:{ enabled:schedule.enabled === true, day:Number.isInteger(Number(schedule.day)) ? Math.max(0,Math.min(6,Number(schedule.day))) : 1,
        hour:Number.isInteger(Number(schedule.hour)) ? Math.max(0,Math.min(23,Number(schedule.hour))) : 9, enabledAt:clean(schedule.enabledAt,40) }
    };
    zoneParts(Date.now(), result.timezone);
    if (!Number.isFinite(result.termsDays)) throw new Error('Choose valid payment terms.');
    return result;
  }
  function validateSettings(input) {
    const config = settings(input);
    if (!config.issuer.name || !config.issuer.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.issuer.email)) throw new Error('Add your business name and a valid business email.');
    if (!config.payment.method || !config.payment.details) throw new Error('Add a payment method and payment instructions.');
    if (cents(config.rate) <= 0) throw new Error('Add the agreed hourly rate or weekly fee. Monthly rates are not converted automatically.');
    if(config.basis==='agreed' && !config.weeklyHours)throw new Error('Add the agreed number of hours per week.');
    return config;
  }
  function calculate(document) {
    if (!Array.isArray(document.lines) || !document.lines.length || document.lines.length > 100) throw new Error('Add between 1 and 100 service lines.');
    let subtotal = 0;
    const lines = document.lines.map(line => {
      const quantity = Math.round(Number(line.quantity) * 10000) / 10000;
      const rateCents = cents(line.rate);
      if (!clean(line.description,800) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000) throw new Error('Every service line needs a description and a positive quantity.');
      const amountCents = Math.round(quantity * rateCents);
      subtotal += amountCents;
      if (!Number.isSafeInteger(subtotal)) throw new Error('Invoice total is too large.');
      return {description:clean(line.description,800),quantity,rate:(rateCents / 100).toFixed(2),unit:clean(line.unit || 'service',20),amountCents};
    });
    const discountPercent = Number(document.discountPercent || 0), taxPercent = Number(document.taxPercent || 0);
    if (![discountPercent,taxPercent].every(n => Number.isFinite(n) && n >= 0 && n <= 100)) throw new Error('Discount and tax percentages must be between 0 and 100.');
    const discount = Math.round(subtotal * discountPercent / 100), tax = Math.round((subtotal - discount) * taxPercent / 100);
    return {lines, subtotalCents:subtotal, discountCents:discount, taxCents:tax, totalCents:subtotal - discount + tax};
  }
  async function draftId(clientId, start) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${clientId}|${start}`));
    return 'invoice-draft:' + Array.from(new Uint8Array(digest)).map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,32);
  }
  function active(client, date) {
    return client?.status === 'Active client' && String(client.contractStatus || 'Active').toLowerCase() !== 'contract ended'
      && (!validDate(client.contractEndDate) || client.contractEndDate >= date);
  }
  function nextInvoiceNumber(invoices, year) {
    if(!/^\d{4}$/.test(String(year)))throw new Error('Choose a valid invoice year.');
    let highest=0;
    for(const invoice of invoices || []){
      const match=String(invoice.document?.invoiceNumber || invoice.invoiceNumber || '').trim().match(/^(\d{4})-(\d+)$/);
      if(match && match[1]===String(year)){
        const value=Number(match[2]);if(!Number.isSafeInteger(value))throw new Error('An existing invoice number is out of range.');highest=Math.max(highest,value);
      }
    }
    if(highest>=999999999)throw new Error('The invoice numbering limit has been reached.');
    return `${year}-${String(highest+1).padStart(3,'0')}`;
  }
  const legacyInvoiceNumber = value => /^[A-Za-z0-9-]+-\d{8}-[A-F0-9]{6}$/.test(String(value || ''));
  async function generate(client, tasks, configInput, date, now = new Date().toISOString(), invoices = []) {
    const config = validateSettings(configInput), start = weekStart(date), end = addDays(start,6), id = await draftId(client.id,start);
    const issueDate = localDate(now,config.timezone), warnings = [], lines = [];
    if (!active(client,issueDate)) throw Object.assign(new Error('Weekly draft generation is only available for active clients.'),{code:'INACTIVE_CLIENT'});
    if (config.basis === 'weekly') lines.push({description:config.service,quantity:1,rate:config.rate,unit:'week'});
    else if(config.basis==='agreed')lines.push({description:config.service,quantity:config.weeklyHours,rate:config.rate,unit:'hour'});
    else {
      const first = localInstant(start,0,config.timezone), last = localInstant(addDays(end,1),0,config.timezone), seen = new Set();
      for (const task of tasks.filter(task => task.clientId === client.id)) {
        if (task.timerStartedAt) warnings.push('A running timer is not included. Stop it and review this invoice if needed.');
        let duration = 0;
        for (const entry of Array.isArray(task.timeEntries) ? task.timeEntries : []) {
          const a = Date.parse(entry.start), ms = Number.isFinite(entry.durationMs) ? entry.durationMs : Date.parse(entry.end) - a;
          const key = `${task.id}|${entry.id || `${entry.start}|${ms}`}`;
          if (seen.has(key) || !Number.isFinite(a) || !Number.isFinite(ms) || ms <= 0) continue;
          seen.add(key); duration += Math.max(0,Math.min(a + ms,last) - Math.max(a,first));
        }
        if (duration >= 360) lines.push({description:clean(task.title || config.service,800),quantity:Math.round(duration / 3600000 * 10000) / 10000,rate:config.rate,unit:'hour'});
      }
      if (!lines.length) throw Object.assign(new Error('No saved billable hours were found in this week. Add time entries or choose a fixed weekly fee.'),{code:'NO_BILLABLE_WORK'});
    }
    if (lines.length > 100) throw new Error('This week has more than 100 task lines. Group the services in a manual draft.');
    const document = {
      invoiceNumber:nextInvoiceNumber(invoices,issueDate.slice(0,4)),
      issueDate,dueDate:addDays(issueDate,config.termsDays),periodStart:start,periodEnd:end,currency:config.currency,
      issuer:config.issuer, billTo:{name:clean(client.clientName,200),contact:clean(client.contact,200),email:clean(client.email,200),address:clean(client.location,500)},
      payment:config.payment,service:config.service,lines,discountPercent:0,taxPercent:0,
      notes:config.notes || 'Please include the invoice number as your payment reference. Thank you for your business.',
      warnings:[...new Set(warnings)],basis:config.basis,timezone:config.timezone,
      workSchedule:workDuration(config.weeklyHours,config.workdays)
    };
    return {id,clientId:client.id,invoiceDraft:true,document,createdAt:now,updatedAt:now,draftStatus:'ready'};
  }
  function readyAlert(draft) {
    return {id:`invoice-ready|${draft.id}`,type:'invoice-ready',invoiceDraftId:draft.id,applicationId:draft.clientId,clientName:draft.document.billTo.name,
      subject:'Invoice is ready for preview',from:'Invoice check',date:draft.createdAt,unread:true};
  }
  function dueWeek(input, now = Date.now()) {
    const config = settings(input);
    if (!config.schedule.enabled || !Number.isFinite(Date.parse(config.schedule.enabledAt))) return null;
    const current = localDate(now,config.timezone), weekday = new Date(current+'T12:00:00Z').getUTCDay();
    let dueDate = addDays(current,-((weekday - config.schedule.day + 7) % 7));
    let due = localInstant(dueDate,config.schedule.hour,config.timezone);
    if (due > new Date(now).getTime()) {dueDate = addDays(dueDate,-7);due = localInstant(dueDate,config.schedule.hour,config.timezone);}
    if (due < Date.parse(config.schedule.enabledAt)) return null;
    return addDays(weekStart(dueDate),-7);
  }
  function validateDocument(input) {
    const document = JSON.parse(JSON.stringify(input));
    if (!clean(document.invoiceNumber,60) || document.invoiceNumber.length > 60 || !validDate(document.issueDate) || !validDate(document.dueDate) || document.dueDate < document.issueDate) throw new Error('Add an invoice number, issue date and a due date on or after issue.');
    if (!document.issuer?.name || !document.billTo?.name || !document.payment?.method || !document.payment.details) throw new Error('Complete the business, client and payment details.');
    if (!currencies.includes(document.currency)) throw new Error('Choose a supported currency.');
    if (!validDate(document.periodStart) || !validDate(document.periodEnd) || document.periodEnd < document.periodStart) throw new Error('Choose a valid billing period.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(document.issuer.email || '')) throw new Error('Add a valid business email.');
    if (document.billTo.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(document.billTo.email)) throw new Error('Add a valid client email or leave it empty.');
    document.invoiceNumber=clean(document.invoiceNumber,60);
    document.issuer={name:clean(document.issuer.name,160),email:clean(document.issuer.email,200),address:issuerAddress(document.issuer.address),phone:clean(document.issuer.phone,80),logo:settings({issuer:document.issuer}).issuer.logo};
    document.billTo={name:clean(document.billTo.name,200),contact:clean(document.billTo.contact,200),email:clean(document.billTo.email,200),address:clean(document.billTo.address,500)};
    document.payment=settings({payment:document.payment}).payment;
    document.notes=clean(document.notes,1400);
    if(document.workSchedule)document.workSchedule=workDuration(document.workSchedule.hoursPerWeek,document.workSchedule.daysPerWeek);
    const totals = calculate(document);document.lines = totals.lines.map(({amountCents,...line})=>line);
    if (!totals.totalCents) throw new Error('The invoice total must be greater than zero.');
    return document;
  }
  function paymentChoices(payment) {
    const choices=(payment.options || []).filter(option=>option.method!==payment.method);
    return choices.length>1 && choices.every(option=>payment.details.includes(option.details))?choices:[{method:payment.method,details:payment.details}];
  }
  function rateLabel(line,currency) {
    const value=cents(line.rate);
    const amount=currency==='USD'?'$'+new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value/100):money(value,currency);
    return `${amount} per ${clean(line.unit || 'service',20)}`;
  }
  function paymentRows(payment) {
    return paymentChoices(payment).map(choice=>({method:choice.method,rows:String(choice.details || '').split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{
      if(/^[a-z][a-z\d+.-]*:\/\//i.test(line))return {label:'Payment link',value:line};
      const field=line.match(/^([^:]{1,60}):\s*(.+)$/);
      return field?{label:field[1].trim(),value:field[2].trim()}:{label:'Instructions',value:line};
    })}));
  }
  function html(document) {
    const d = validateDocument(document), totals = calculate(d), e = escape;
    const logo = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(d.issuer.logo || '') && d.issuer.logo.length <= 180000 ? `<img src="${d.issuer.logo}" alt="Business logo"/>` : '<img src="/images/tab.png" alt="Business logo"/>';
    const multiline = value => e(value).replace(/\n/g,'<br>');
    const identity=`<div class="invoice-issuer"><strong>${e(d.issuer.name)}</strong>${d.issuer.address?`<span class="invoice-issuer-address">${e(d.issuer.address.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).join(', '))}</span>`:''}<span class="invoice-issuer-email">${e(d.issuer.email)}</span>${d.issuer.phone?`<span>${e(d.issuer.phone)}</span>`:''}</div>`;
    const recipient=`<div class="invoice-party-card invoice-recipient"><h3>BILL TO</h3><strong>${e(d.billTo.name)}</strong><div class="invoice-recipient-details">${[d.billTo.contact,d.billTo.address,d.billTo.email].filter(Boolean).map(value=>`<span>${e(value)}</span>`).join('')}</div></div>`;
    return `<article class="invoice-paper"><header class="invoice-paper-header"><div class="invoice-brand">${logo}${identity}</div><div class="invoice-heading"><span>INVOICE</span><strong>${e(d.invoiceNumber)}</strong></div></header><section class="invoice-paper-parties">${recipient}<div class="invoice-party-card invoice-detail-block"><h3>INVOICE DETAILS</h3><dl><div><dt>Issued</dt><dd>${e(formatDate(d.issueDate))}</dd></div><div><dt>Due date</dt><dd>${e(formatDate(d.dueDate))}</dd></div><div><dt>Billing period</dt><dd>${e(formatDate(d.periodStart))} – ${e(formatDate(d.periodEnd))}</dd></div><div><dt>Currency</dt><dd>${e(d.currency)}</dd></div></dl></div></section>${d.workSchedule ? `<p class="invoice-paper-duration"><strong>Agreed weekly schedule</strong> ${e(durationLabel(d.workSchedule))}</p>` : ''}<table class="invoice-paper-lines"><thead><tr><th>Description</th><th>Qty / hours</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${totals.lines.map(line=>`<tr><td><strong>${multiline(line.description)}</strong><small>${e(line.unit)}</small></td><td>${line.quantity}</td><td>${e(rateLabel(line,d.currency))}</td><td>${e(money(line.amountCents,d.currency))}</td></tr>`).join('')}</tbody></table><section class="invoice-paper-totals"><dl><div><dt>Subtotal</dt><dd>${e(money(totals.subtotalCents,d.currency))}</dd></div>${totals.discountCents ? `<div><dt>Discount (${e(d.discountPercent)}%)</dt><dd>-${e(money(totals.discountCents,d.currency))}</dd></div>`:''}${totals.taxCents ? `<div><dt>Tax (${e(d.taxPercent)}%)</dt><dd>${e(money(totals.taxCents,d.currency))}</dd></div>`:''}<div class="invoice-total"><dt>Total due</dt><dd>${e(money(totals.totalCents,d.currency))}</dd></div></dl></section><section class="invoice-paper-payment"><h3>PAYMENT INSTRUCTIONS</h3><div class="invoice-payment-choices">${paymentChoices(d.payment).map(choice=>`<div class="invoice-payment-choice"><strong>${e(choice.method)}</strong><p>${multiline(choice.details)}</p></div>`).join('')}</div><p class="invoice-reference">Reference: ${e(d.invoiceNumber)}</p></section><footer><h3>NOTES & TERMS</h3><p>${multiline(d.notes || '')}</p><span>Thank you for your business.</span></footer></article>`;
  }
  return {currencies,validDate,addDays,weekStart,localDate,localInstant,settings,validateSettings,cents,money,formatDate,calculate,draftId,generate,readyAlert,dueWeek,validateDocument,paymentChoices,nextInvoiceNumber,legacyInvoiceNumber,workDuration,durationLabel,rateLabel,paymentRows,html,escape};
});
