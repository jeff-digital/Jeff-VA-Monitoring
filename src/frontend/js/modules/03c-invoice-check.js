  // Client billing is draft-only. This module intentionally has no send-email call.
  const invoiceEngine = window.JeffInvoiceEngine;
  let invoiceCheckClientId = '', invoiceCheckDraft = null, invoiceCheckLogo = '', invoiceCheckBusy = false;
  let invoiceCheckSequence = 0, invoicePreviewSnapshot = null, invoiceAutomaticReady = false;
  let invoicePreviewSequence=0;
  let invoiceProfileOwner='', invoiceProfile=null, invoicePaymentOptions=[];
  let invoiceLogoSequence=0;
  let invoiceLogoLoad=Promise.resolve();
  let invoiceBrandLogoPromise=null;
  let invoiceHourlyCalculationPending=false;
  let invoiceHourlyBillingChanged=false;
  const invoiceField = name => $(`#invoiceCheck${name}`);
  const invoiceClient = () => (data.applications || []).find(item => item.id === invoiceCheckClientId);
  const invoiceCopy = value => JSON.parse(JSON.stringify(value));
  function selectInvoiceSection(section, focus=false) {
    const editAvailable=!$('#invoiceCheckEditFields').hidden;
    if(section==='edit' && !editAvailable)section='billing';
    document.querySelectorAll('[data-invoice-tab]').forEach(button=>{
      const active=button.dataset.invoiceTab===section;
      button.hidden=button.dataset.invoiceTab==='edit' && !editAvailable;
      button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
      if(active && focus)button.focus();
    });
    document.querySelectorAll('[data-invoice-panel]').forEach(panel=>{panel.hidden=panel.dataset.invoicePanel!==section;});
    $('#invoiceCheckForm .invoice-check-content').scrollTop=0;
    if(section==='payment')$('#invoiceCheckPaymentDetails').scrollTop=0;
  }
  document.querySelectorAll('[data-invoice-tab]').forEach(button=>{
    button.addEventListener('click',()=>selectInvoiceSection(button.dataset.invoiceTab));
    button.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const buttons=Array.from(document.querySelectorAll('[data-invoice-tab]')).filter(item=>!item.hidden);
      const index=buttons.indexOf(button),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;
      selectInvoiceSection(buttons[next].dataset.invoiceTab,true);
    });
  });
  function openClientInvoiceHub(clientId) {
    const client=(data.applications || []).find(item=>item.id===clientId);if(!client)return;
    if(invoiceCheckBusy){toast('Wait for the invoice to finish saving.');return;}
    if(activeClientDrawerOpen && activeClientDrawerFormChanged(activeClientDrawerView)){
      if(!window.confirm('Discard unsaved invoice changes?'))return;
      resetActiveClientDrawerForm(activeClientDrawerView);
    }
    if(activeClientDrawerView==='invoice-upload')clearInvoiceUploadDraft();
    hiredEditingId=clientId;
    if(!activeClientDrawerOpen)openActiveClientActionsDrawer($('#activeClientActionsButton'));
    $('#generateClientInvoice').disabled=isContractEnded(client);
    $('#invoiceHubStatus').textContent=isContractEnded(client)?'Contract ended. Review drafts or upload a final invoice.':'';
    $('#invoiceHubDrafts').innerHTML=invoiceDraftRows(clientId);
    showActiveClientDrawerView('invoice-home');
    $('#activeClientDrawerInvoiceHome').scrollTop=0;
    $('#activeClientDrawerInvoiceHome button:not([disabled])')?.focus();
  }
  $('#generateClientInvoice').addEventListener('click',()=>openInvoiceCheck(hiredEditingId));
  $('#uploadClientInvoice').addEventListener('click',()=>{
    const client=(data.applications || []).find(item=>item.id===hiredEditingId);if(client)openInvoiceDocumentPicker(client,true);
  });
  $('#cancelInvoiceUpload').addEventListener('click',event=>{
    if(activeClientDrawerOpen && activeClientDrawerView==='invoice-upload'){event.preventDefault();openClientInvoiceHub(hiredEditingId);}
  });
  $('#invoiceUploadForm').addEventListener('submit',event=>{
    event.preventDefault();
    if(event.submitter?.id==='cancelInvoiceUpload'){
      if(activeClientDrawerOpen && activeClientDrawerView==='invoice-upload')openClientInvoiceHub(hiredEditingId);
      else $('#invoiceDocumentPickerModal').close();
    }else continueInvoicePicker();
  });
  for(const selector of ['#invoiceStartDate','#invoiceEndDate'])$(selector).addEventListener('change',()=>{
    const start=$('#invoiceStartDate').value,end=$('#invoiceEndDate').value;
    if(invoiceEngine.validDate(start) && invoiceEngine.validDate(end) && end>=start)$('#invoiceBillingPeriod').value=`${invoiceEngine.formatDate(start)} – ${invoiceEngine.formatDate(end)}`;
  });
  function invoiceStatus(message = '', error = false) {
    $('#invoiceCheckStatus').textContent = message;
    $('#invoiceCheckStatus').classList.toggle('is-error',error);
  }
  function invoiceCheckDefaults(client) {
    const saved = client.invoiceSettings;
    const reusable = (data.applications || []).find(item => item.invoiceSettings?.issuer?.name)?.invoiceSettings;
    const metadata = currentUser?.user_metadata || {};
    const profile=invoiceProfileOwner===currentUser?.id?invoiceProfile:null;
    return invoiceEngine.settings(saved || {
      basis:String(client.salaryType || '').toLowerCase()==='hourly'?'logged':'weekly',
      rate:String(client.salaryType || '').toLowerCase()==='hourly'?String(client.salaryAmount || ''):'',
      weeklyHours:client.hoursPerWeek || '',workdays:5,
      currency:client.salaryCurrency || 'USD',service:client.role || 'Professional services',
      issuer:reusable?.issuer || profile?.issuer || {name:metadata.full_name || metadata.name || '',email:currentUser?.email || ''},
      payment:reusable?.payment || profile?.payment || {},notes:reusable?.notes || '',timezone:reusable?.timezone || 'Asia/Manila'
    });
  }
  function invoiceFillSettings(config) {
    invoicePaymentOptions=config.payment.options || [];
    renderInvoicePaymentMethods(config.payment.method);
    for(const [name,value] of Object.entries({Basis:config.basis,Currency:config.currency,Rate:config.rate,Terms:config.termsDays,Service:config.service,WeeklyHours:config.weeklyHours,Workdays:config.workdays,
      BusinessName:config.issuer.name,BusinessEmail:config.issuer.email,BusinessAddress:config.issuer.address,BusinessPhone:config.issuer.phone,
      PaymentMethod:config.payment.method,PaymentDetails:config.payment.details,Notes:config.notes,Timezone:config.timezone,
      ScheduleDay:config.schedule.day,ScheduleHour:config.schedule.hour})) invoiceField(name).value=value ?? '';
    invoiceField('Automatic').checked=config.schedule.enabled;
    invoiceCheckLogo=config.issuer.logo;renderInvoiceLogo();
    $('#invoiceCheckBusiness').open=!config.issuer.name || !config.issuer.email;
    $('#invoiceCheckPayment').open=!config.payment.method || !config.payment.details;
    $('#invoiceCheckSchedule').open=config.schedule.enabled;
    updateInvoiceBasis();
  }
  function renderInvoicePaymentMethods(selected='') {
    const methods=[...new Set(['',...invoicePaymentOptions.map(option=>option.method),selected,'Wise','PayPal','Payoneer','Bank transfer','GCash','MariBank','Other'])];
    invoiceField('PaymentMethod').innerHTML=methods.map(method=>`<option value="${escapeHtml(method)}">${escapeHtml(method || 'Choose a method')}</option>`).join('');
    invoiceField('PaymentMethod').value=selected;
  }
  function invoiceReadSettings() {
    const previous=invoiceClient()?.invoiceSettings;
    const enabled=invoiceField('Automatic').checked;
    if(enabled && !invoiceAutomaticReady) throw new Error('Weekly preparation needs the updated Cloudflare Worker. Manual invoice generation is still available.');
    return invoiceEngine.validateSettings({basis:invoiceField('Basis').value,rate:invoiceField('Rate').value,currency:invoiceField('Currency').value,
      weeklyHours:invoiceField('WeeklyHours').value,workdays:invoiceField('Workdays').value,
      service:invoiceField('Service').value,termsDays:invoiceField('Terms').value,timezone:invoiceField('Timezone').value,
      issuer:{name:invoiceField('BusinessName').value,email:invoiceField('BusinessEmail').value,address:invoiceField('BusinessAddress').value,phone:invoiceField('BusinessPhone').value,logo:invoiceCheckLogo},
      payment:{method:invoiceField('PaymentMethod').value,details:invoiceField('PaymentDetails').value,options:invoicePaymentOptions},notes:invoiceField('Notes').value,
      schedule:{enabled,day:Number(invoiceField('ScheduleDay').value),hour:Number(invoiceField('ScheduleHour').value),enabledAt:enabled?(previous?.schedule?.enabled?previous.schedule.enabledAt:new Date().toISOString()):''}});
  }
  function updateInvoiceBasis({recalculate=false}={}) {
    const basis=invoiceField('Basis').value;
    $('#invoiceCheckRateLabel').textContent=basis==='weekly'?'Agreed weekly fee':'Hourly rate';
    try{
      const duration=invoiceEngine.workDuration(invoiceField('WeeklyHours').value,invoiceField('Workdays').value);
      let summary=invoiceEngine.durationLabel(duration);
      $('#invoiceCheckHourlyCalculation').hidden=true;
      if(duration && basis==='agreed'){
        const rate=invoiceEngine.cents(invoiceField('Rate').value),currency=invoiceField('Currency').value,total=Math.round(duration.hoursPerWeek*rate);
        $('#invoiceCheckHourlyCalculation').hidden=false;
        $('#invoiceCheckWeeklyTotal').textContent=invoiceEngine.money(total,currency);
        $('#invoiceCheckHourlyBreakdown').textContent=`${invoiceEngine.money(rate,currency)}/hour × ${duration.hoursPerWeek} hours · ${duration.daysPerWeek} workdays · ${invoiceEngine.money(Math.round(total/duration.daysPerWeek),currency)}/day`;
        summary+=` · ${invoiceEngine.money(total,currency)} per week`;
        if(invoiceCheckDraft && recalculate){
          invoiceHourlyBillingChanged=true;
          const rows=$('#invoiceCheckLines').querySelectorAll('.invoice-service-editor');
          if(rows.length===1){
            rows[0].querySelector('[data-invoice-line="quantity"]').value=duration.hoursPerWeek;
            rows[0].querySelector('[data-invoice-line="rate"]').value=(rate/100).toFixed(2);
            rows[0].querySelector('[data-invoice-line="unit"]').value='hour';
            invoiceHourlyCalculationPending=false;updateInvoiceEditTotal();
          }else invoiceHourlyCalculationPending=true;
        }
      }
      if(basis!=='agreed')invoiceHourlyCalculationPending=false;
      if(invoiceCheckDraft && recalculate && basis==='weekly'){
        const rows=$('#invoiceCheckLines').querySelectorAll('.invoice-service-editor');
        if(rows.length===1){rows[0].querySelector('[data-invoice-line="quantity"]').value=1;rows[0].querySelector('[data-invoice-line="rate"]').value=invoiceField('Rate').value;rows[0].querySelector('[data-invoice-line="unit"]').value='week';updateInvoiceEditTotal();}
      }
      $('#applyInvoiceHourlyCalculation').hidden=!invoiceHourlyCalculationPending;
      if(invoiceCheckDraft && basis!=='agreed')summary+=' · Review and edit the saved service charges below.';
      else if(basis==='weekly')summary+=' · Billed as the fixed weekly fee.';
      else if(basis==='logged')summary+=' · Billed from saved time entries.';
      $('#invoiceCheckDurationSummary').textContent=summary.replace(/^ · /,'');
    }catch(error){$('#invoiceCheckHourlyCalculation').hidden=true;$('#invoiceCheckDurationSummary').textContent=error.message;}
    if(invoiceEngine.validDate(invoiceField('Week').value)) {
      const start=invoiceEngine.weekStart(invoiceField('Week').value);invoiceField('Week').value=start;
      $('#invoiceCheckPeriod').textContent=`${invoiceEngine.formatDate(start)} – ${invoiceEngine.formatDate(invoiceEngine.addDays(start,6))}`;
    }
  }
  function renderInvoiceLogo() {
    const image=$('#invoiceCheckLogoPreview');image.hidden=!invoiceCheckLogo;$('#invoiceCheckLogoData').value=invoiceCheckLogo;
    if(invoiceCheckLogo) image.src=invoiceCheckLogo;else image.removeAttribute('src');
    $('#invoiceCheckRemoveLogo').hidden=!invoiceCheckLogo;
  }
  async function loadInvoiceBrandLogo(sequence) {
    if(invoiceCheckLogo)return;
    const owner=currentUser?.id,logoSequence=invoiceLogoSequence;
    try{
      const logo=await readInvoiceBrandLogo();if(!logo)return;
      if(currentUser?.id===owner && sequence===invoiceCheckSequence && logoSequence===invoiceLogoSequence && !invoiceCheckLogo){invoiceCheckLogo=logo;renderInvoiceLogo();}
    }catch{/* An existing saved logo remains usable offline. */}
  }
  function readInvoiceBrandLogo() {
    if(!invoiceBrandLogoPromise)invoiceBrandLogoPromise=(async()=>{
      const response=await fetch('/images/tab.png',{signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error('Logo unavailable.');
      const blob=await response.blob();if(blob.type!=='image/png' || blob.size>130000)throw new Error('Invalid logo.');
      return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
    })().catch(()=>{invoiceBrandLogoPromise=null;return '';});
    return invoiceBrandLogoPromise;
  }
  function clientInvoiceDrafts(clientId) {
    return (data.invoices || []).filter(item=>item.invoiceDraft && item.draftStatus!=='sent' && item.clientId===clientId).sort((a,b)=>String(b.document?.periodStart || '').localeCompare(String(a.document?.periodStart || '')));
  }
  function invoiceDraftRows(clientId, rows=clientInvoiceDrafts(clientId)) {
    return rows.length?rows.map(draft=>{
      let amount='Needs review';try{amount=invoiceEngine.money(invoiceEngine.calculate(draft.document).totalCents,draft.document.currency);}catch{}
      return `<article class="invoice-ready-row"><div><strong>${escapeHtml(draft.document?.invoiceNumber || 'Invoice draft')}</strong><span>${escapeHtml(invoiceEngine.formatDate(draft.document?.periodStart))} – ${escapeHtml(invoiceEngine.formatDate(draft.document?.periodEnd))}</span><small>${escapeHtml(amount)} · Not sent</small></div><div><button type="button" class="button button-secondary" data-invoice-draft-edit="${escapeHtml(draft.id)}">Edit</button><button type="button" class="button button-primary" data-invoice-draft-preview="${escapeHtml(draft.id)}">Preview</button></div></article>`;
    }).join(''):'<p class="settings-copy">No saved drafts.</p>';
  }
  async function refreshInvoiceAutomaticStatus(sequence,{fillProfile=true}={}) {
    invoiceAutomaticReady=false;
    invoiceField('Automatic').disabled=true;
    $('#invoiceCheckAutomationStatus').textContent='Checking weekly preparation availability…';
    const owner=currentUser?.id;
    const initialProfileFields=Object.fromEntries(['BusinessName','BusinessEmail','BusinessAddress','BusinessPhone','PaymentMethod','PaymentDetails','LogoData'].map(name=>[name,invoiceField(name).value]));
    try {
      const auth=requireSupabase().auth;let session=(await auth.getSession()).data?.session;
      for(let attempt=0;attempt<2;attempt++) {
        if(!session?.access_token || currentUser?.id!==owner) throw new Error();
        const response=await fetch('/api/invoice-check',{headers:{authorization:`Bearer ${session.access_token}`},signal:AbortSignal.timeout(10000)});
        if(response.status===401 && attempt===0){session=(await auth.refreshSession()).data?.session;continue;}
        if(!response.ok) throw new Error();
        const result=await response.json();
        if(sequence!==invoiceCheckSequence || currentUser?.id!==owner) return;
        if(result.profile && fillProfile){
          invoiceProfileOwner=owner;invoiceProfile=invoiceEngine.settings(result.profile);
          invoicePaymentOptions=invoiceProfile.payment.options;
          renderInvoicePaymentMethods(invoiceField('PaymentMethod').value);
          const saved=invoiceClient()?.invoiceSettings;
          for(const [name,value] of Object.entries({BusinessName:invoiceProfile.issuer.name,BusinessEmail:invoiceProfile.issuer.email,BusinessAddress:invoiceProfile.issuer.address,BusinessPhone:invoiceProfile.issuer.phone,PaymentMethod:invoiceProfile.payment.method,PaymentDetails:invoiceProfile.payment.details})){
            const isPayment=name.startsWith('Payment'),issuerKey={BusinessName:'name',BusinessEmail:'email',BusinessAddress:'address',BusinessPhone:'phone'}[name];
            if(invoiceField(name).value===initialProfileFields[name] && !(isPayment?saved?.payment?.options?.length:saved?.issuer?.[issuerKey]))invoiceField(name).value=value;
          }
          if(!invoiceCheckLogo && invoiceField('LogoData').value===initialProfileFields.LogoData){invoiceCheckLogo=invoiceProfile.issuer.logo;renderInvoiceLogo();}
          $('#invoiceCheckPayment').open=false;
        }
        invoiceAutomaticReady=result.automaticReady===true && result.draftOnly===true;break;
      }
    } catch { /* Manual generation remains available on an older/local server. */ }
    if(sequence!==invoiceCheckSequence || currentUser?.id!==owner) return;
    invoiceField('Automatic').disabled=!invoiceAutomaticReady || Boolean(invoiceCheckDraft);
    $('#invoiceCheckAutomationStatus').textContent=invoiceAutomaticReady?'Available':'Weekly preparation unavailable.';
  }
  function openInvoiceCheck(clientId, draftId='') {
    const client=(data.applications || []).find(item=>item.id===clientId);
    if(!client || !invoiceEngine) {toast('Invoice check is unavailable. Reload the app and try again.');return;}
    if(activeClientDrawerOpen && activeClientDrawerView==='invoice-check' && activeClientDrawerFormChanged('invoice-check') && !window.confirm('Discard unsaved invoice changes?')) return;
    invoiceCheckClientId=clientId;invoiceCheckDraft=null;invoiceHourlyCalculationPending=false;invoiceHourlyBillingChanged=false;
    const sequence=++invoiceCheckSequence;
    invoiceLogoSequence++;
    hiredEditingId=clientId;
    if(!activeClientDrawerOpen) openActiveClientActionsDrawer($('#activeClientActionsButton'));
    invoiceFillSettings(invoiceCheckDefaults(client));
    invoiceField('Week').disabled=false;
    invoiceField('Week').value=invoiceEngine.addDays(invoiceEngine.weekStart(invoiceEngine.localDate(Date.now(),invoiceField('Timezone').value)),-7);
    $('#invoiceCheckEditFields').hidden=true;$('#invoiceCheckNewWeek').hidden=true;
    for(const name of ['Basis','Rate','Service']) invoiceField(name).disabled=false;
    invoiceField('Terms').disabled=Boolean(draftId);
    $('#saveInvoiceSetup').hidden=false;$('#generateInvoiceDraft').textContent='Generate preview';
    if(draftId) {
      const draft=(data.invoices || []).find(item=>item.id===draftId && item.invoiceDraft && item.clientId===clientId);
      if(!draft) {invoiceStatus('This draft is no longer available. Refresh your workspace.',true);return;}
      if(draft.draftStatus==='sent'){toast('This invoice has already been sent. Open invoice history to review it.');return;}
      invoiceCheckDraft=invoiceCopy(draft);const d=draft.document;
      invoiceFillSettings(invoiceEngine.settings({...client.invoiceSettings,basis:d.basis || client.invoiceSettings?.basis,rate:d.lines?.length===1?d.lines[0].rate:client.invoiceSettings?.rate,weeklyHours:d.workSchedule?.hoursPerWeek ?? '',workdays:d.workSchedule?.daysPerWeek ?? 5,issuer:d.issuer,payment:d.payment,notes:d.notes,currency:d.currency,service:d.service}));
      invoiceField('Week').value=d.periodStart;invoiceField('Week').disabled=true;
      for(const [name,value] of Object.entries({Number:invoiceEngine.legacyInvoiceNumber(d.invoiceNumber)?invoiceEngine.nextInvoiceNumber(data.invoices,d.issueDate.slice(0,4)):d.invoiceNumber,IssueDate:d.issueDate,DueDate:d.dueDate,BillTo:d.billTo.name,ClientEmail:d.billTo.email,ClientContact:d.billTo.contact,ClientAddress:d.billTo.address,Discount:d.discountPercent || 0,Tax:d.taxPercent || 0})) invoiceField(name).value=value ?? '';
      renderInvoiceEditLines(d.lines);$('#invoiceCheckEditFields').hidden=false;$('#invoiceCheckNewWeek').hidden=false;
      $('#saveInvoiceSetup').hidden=true;$('#generateInvoiceDraft').textContent='Save changes & preview';
      $('#invoiceCheckSchedule').open=false;invoiceField('Automatic').disabled=true;
    }
    invoiceStatus(isContractEnded(client)?'Existing drafts can be edited. New invoices cannot be generated for an ended contract.':'');
    $('#generateInvoiceDraft').disabled=isContractEnded(client) && !invoiceCheckDraft;
    $('#invoiceCheckSavedDrafts').innerHTML=invoiceDraftRows(clientId);updateInvoiceBasis();
    selectInvoiceSection(invoiceCheckDraft?'edit':'billing');
    showActiveClientDrawerView('invoice-check');
    $('#invoiceCheckForm .invoice-check-content').scrollTop=0;
    markActiveClientDrawerFormClean('invoice-check');
    void refreshInvoiceAutomaticStatus(sequence);
    invoiceLogoLoad=loadInvoiceBrandLogo(sequence);
  }
  function renderInvoiceEditLines(lines) {
    $('#invoiceCheckLines').innerHTML=lines.map(line=>`<div class="invoice-service-editor"><label class="form-field">Description<textarea data-invoice-line="description" maxlength="800" rows="2">${escapeHtml(line.description)}</textarea></label><div class="invoice-line-numbers"><label class="form-field">Quantity<input data-invoice-line="quantity" type="number" min="0.0001" step="0.0001" value="${escapeHtml(line.quantity)}" /></label><label class="form-field">Rate<input data-invoice-line="rate" type="number" min="0" step="0.01" value="${escapeHtml(line.rate)}" /></label><label class="form-field">Unit<select data-invoice-line="unit">${['hour','week','service'].map(unit=>`<option value="${unit}"${line.unit===unit?' selected':''}>${unit}</option>`).join('')}</select></label><button type="button" class="button button-secondary invoice-remove-line" aria-label="Remove service line"><i class="fa-solid fa-trash" aria-hidden="true"></i></button></div></div>`).join('');
    updateInvoiceEditTotal();
  }
  function invoiceReadLines() {
    return [...$('#invoiceCheckLines').querySelectorAll('.invoice-service-editor')].map(row=>Object.fromEntries([...row.querySelectorAll('[data-invoice-line]')].map(field=>[field.dataset.invoiceLine,field.value])));
  }
  function invoiceReadDocument() {
    if(invoiceHourlyCalculationPending)throw new Error('Click Apply hourly calculation to replace the existing service lines with this weekly total, then review and save.');
    const d=invoiceCopy(invoiceCheckDraft.document);
    Object.assign(d,{basis:invoiceField('Basis').value,service:invoiceField('Service').value,invoiceNumber:invoiceField('Number').value.trim(),issueDate:invoiceField('IssueDate').value,dueDate:invoiceField('DueDate').value,currency:invoiceField('Currency').value,
      issuer:{name:invoiceField('BusinessName').value.trim(),email:invoiceField('BusinessEmail').value.trim(),address:invoiceField('BusinessAddress').value,phone:invoiceField('BusinessPhone').value,logo:invoiceCheckLogo},
      billTo:{name:invoiceField('BillTo').value.trim(),email:invoiceField('ClientEmail').value.trim(),contact:invoiceField('ClientContact').value,address:invoiceField('ClientAddress').value},
      payment:{method:invoiceField('PaymentMethod').value,details:invoiceField('PaymentDetails').value,options:invoicePaymentOptions},notes:invoiceField('Notes').value,
      workSchedule:invoiceEngine.workDuration(invoiceField('WeeklyHours').value,invoiceField('Workdays').value),
      lines:invoiceReadLines(),discountPercent:invoiceField('Discount').value,taxPercent:invoiceField('Tax').value});
    return invoiceEngine.validateDocument(d);
  }
  function updateInvoiceEditTotal() {
    if(!invoiceCheckDraft) return;
    try {const total=invoiceEngine.calculate({lines:invoiceReadLines(),discountPercent:invoiceField('Discount').value,taxPercent:invoiceField('Tax').value});$('#invoiceCheckTotal').textContent=`Total due: ${invoiceEngine.money(total.totalCents,invoiceField('Currency').value)}`;}
    catch {$('#invoiceCheckTotal').textContent='Complete the service lines to calculate the total.';}
  }
  // Roll back only an unchanged optimistic record, never another action's edits.
  async function commitInvoiceRecords(changes) {
    const owner=currentUser?.id;
    for(const change of changes) {
      data[change.key] ||= [];const index=data[change.key].findIndex(item=>item.id===change.value.id);
      change.previous=index<0?null:invoiceCopy(data[change.key][index]);change.serialized=JSON.stringify(change.value);
      if(index<0)data[change.key].unshift(change.value);else data[change.key][index]=change.value;
    }
    const saved=await persist();
    if(saved && currentUser?.id===owner) return true;
    if(currentUser?.id===owner)for(const change of changes){const index=data[change.key].findIndex(item=>item.id===change.value.id);if(index>=0 && JSON.stringify(data[change.key][index])===change.serialized){if(change.previous)data[change.key][index]=change.previous;else data[change.key].splice(index,1);}}
    throw new Error('The invoice was not saved. Reconnect or refresh before trying again.');
  }

  async function deleteSentInvoice(invoiceId) {
    const owner = currentUser?.id;
    const invoice = data.invoices.find(item => item.id === invoiceId && !item.invoiceDraft && !item.deletedAt);
    if (!invoice) return;
    const original = JSON.stringify(invoice);
    const number = invoice.invoiceNumber || 'this invoice';
    const paymentNotice = invoice.paidAt ? ' Its recorded payment will also be removed from your totals.' : '';
    const confirmed = await appConfirm(`Delete ${number} from your workspace? The original email will remain in the recipient’s inbox.${paymentNotice}`, {
      title: 'Delete sent invoice', confirmLabel: 'Delete invoice', danger: true
    });
    if (!confirmed || currentUser?.id !== owner) return;
    const current = data.invoices.find(item => item.id === invoiceId);
    if (JSON.stringify(current) !== original) {
      toast('This invoice changed. Review it before deleting.');
      return;
    }

    const now = new Date().toISOString();
    const changes = [{ key: 'invoices', value: { ...current, deletedAt: now } }];
    const source = data.invoices.find(item => item.invoiceDraft && item.draftStatus === 'sent'
      && item.clientId === current.clientId
      && (item.sentInvoiceId ? item.sentInvoiceId === current.id : item.id === current.sourceDraftId));
    let correction;
    try {
      if (source?.document && invoiceEngine) {
        const { sentAt, sentInvoiceId, ...draft } = source;
        const year = (parseInvoiceDate(draft.document.issueDate) || today()).slice(0, 4);
        const invoiceNumber = invoiceEngine.nextInvoiceNumber(data.invoices, year);
        correction = { ...draft, draftStatus: 'ready', updatedAt: now, document: { ...draft.document, invoiceNumber } };
        changes.push({ key: 'invoices', value: correction });
      }
      await commitInvoiceRecords(changes);
    } catch (error) {
      if (currentUser?.id === owner) toast(error.message || 'The invoice could not be deleted.');
      return;
    }

    renderAlerts();
    const client = data.applications.find(item => item.id === current.clientId);
    if (client && activeView === 'hired' && hiredEditingId === client.id && !showingHiredClientList) {
      renderHiredDetail(client, false);
      if (correction) selectClientInvoiceList('drafts');
    }
    showActionResult({
      title: 'Invoice deleted',
      message: correction
        ? `Draft ${correction.document.invoiceNumber} is ready to edit and send from the Drafts tab.`
        : 'Use the client’s invoice actions to generate or upload the corrected invoice with a new number.'
    });
  }

  async function invoiceCheckOperation(work) {
    if(invoiceCheckBusy) return;
    invoiceCheckBusy=true;const owner=currentUser?.id, clientId=invoiceCheckClientId;
    $('#generateInvoiceDraft').disabled=true;$('#saveInvoiceSetup').disabled=true;invoiceStatus('Saving…');
    try {await invoiceLogoLoad;if(currentUser?.id!==owner || invoiceCheckClientId!==clientId)throw new Error('The account or client changed. Reopen Invoice check.');await work(owner,clientId);}
    catch(error){if(currentUser?.id===owner && invoiceCheckClientId===clientId)invoiceStatus(error.message || 'The invoice could not be prepared.',true);}
    finally {invoiceCheckBusy=false;if(currentUser?.id===owner && invoiceCheckClientId===clientId){$('#generateInvoiceDraft').disabled=isContractEnded(invoiceClient()) && !invoiceCheckDraft;$('#saveInvoiceSetup').disabled=false;}}
  }
  $('#saveInvoiceSetup').addEventListener('click',()=>invoiceCheckOperation(async()=>{
    const config=invoiceReadSettings(),client=invoiceClient();
    if(isContractEnded(client) && config.schedule.enabled) throw new Error('Disable weekly preparation for an ended contract.');
    await commitInvoiceRecords([{key:'applications',value:{...client,invoiceSettings:config}}]);
    if(typeof browserDrafts!=='undefined')browserDrafts.clearForm('invoiceCheckForm');
    markActiveClientDrawerFormClean('invoice-check');invoiceStatus('Setup saved.');
  }));
  $('#invoiceCheckForm').addEventListener('submit',event=>{
    event.preventDefault();
    void invoiceCheckOperation(async(owner,clientId)=>{
      const client=invoiceClient();let draft;
      if(invoiceCheckDraft) {
        const current=(data.invoices || []).find(item=>item.id===invoiceCheckDraft.id);
        if(!current || current.updatedAt!==invoiceCheckDraft.updatedAt)throw new Error('This invoice changed on another device. Reopen it before saving.');
        draft={...current,document:invoiceReadDocument(),updatedAt:new Date().toISOString()};
        const duplicate=(data.invoices || []).some(item=>item.id!==draft.id && (item.deletedAt || item.sourceDraftId!==draft.id) && (item.invoiceNumber || item.document?.invoiceNumber)===draft.document.invoiceNumber);
        if(duplicate)throw new Error('Another invoice already uses that invoice number.');
        const changes=[{key:'invoices',value:draft}];
        if(invoiceHourlyBillingChanged && draft.document.basis==='agreed'){
          const config=invoiceEngine.validateSettings({...invoiceEngine.settings(client.invoiceSettings || {}),basis:'agreed',rate:invoiceField('Rate').value,weeklyHours:invoiceField('WeeklyHours').value,workdays:invoiceField('Workdays').value,currency:invoiceField('Currency').value,
            issuer:client.invoiceSettings?.issuer?.name?client.invoiceSettings.issuer:draft.document.issuer,payment:client.invoiceSettings?.payment?.details?client.invoiceSettings.payment:draft.document.payment});
          changes.push({key:'applications',value:{...client,invoiceSettings:config}});
        }
        await commitInvoiceRecords(changes);
      } else {
        const config=invoiceReadSettings(),start=invoiceEngine.weekStart(invoiceField('Week').value),id=await invoiceEngine.draftId(clientId,start);
        const existing=(data.invoices || []).find(item=>item.id===id);
        if(existing){
          markActiveClientDrawerFormClean('invoice-check');
          if(existing.draftStatus!=='sent' && config.basis==='agreed'){
            $('#invoiceDraftPreviewModal').close();openInvoiceCheck(clientId,existing.id);
            for(const [name,value] of Object.entries({Basis:'agreed',Rate:config.rate,Currency:config.currency,WeeklyHours:config.weeklyHours,Workdays:config.workdays}))invoiceField(name).value=value;
            updateInvoiceBasis({recalculate:true});
            if(invoiceHourlyCalculationPending){invoiceStatus('This invoice has multiple service lines. Click Apply hourly calculation to use one weekly service charge, then review and save.');return;}
            draft={...existing,document:invoiceReadDocument(),updatedAt:new Date().toISOString()};
            await commitInvoiceRecords([{key:'applications',value:{...invoiceClient(),invoiceSettings:config}},{key:'invoices',value:draft}]);
            if(typeof browserDrafts!=='undefined')browserDrafts.clearForm('invoiceCheckForm');
            invoiceCheckDraft=invoiceCopy(draft);markActiveClientDrawerFormClean('invoice-check');
            $('#invoiceCheckSavedDrafts').innerHTML=invoiceDraftRows(clientId);
            if(hiredEditingId===clientId)renderHiredDetail(invoiceClient(),false);
            invoiceStatus('Hourly total recalculated and saved. Review the invoice before sending.');await openInvoiceDraftPreview(draft.id);
          }else if(existing.draftStatus!=='sent' && config.weeklyHours && (existing.document?.workSchedule?.hoursPerWeek!==config.weeklyHours || existing.document?.workSchedule?.daysPerWeek!==config.workdays)){
            $('#invoiceDraftPreviewModal').close();openInvoiceCheck(clientId,existing.id);
            invoiceField('WeeklyHours').value=config.weeklyHours;invoiceField('Workdays').value=config.workdays;updateInvoiceBasis();
            invoiceStatus('This week already has an invoice. Your weekly schedule is filled in. Review the saved service charges below, then save changes.');
          }else{invoiceStatus('This week already has an invoice. Existing edits were preserved.');openInvoiceDraftPreview(existing.id);}
          return;
        }
        if((data.invoices || []).some(item=>!item.invoiceDraft && !item.deletedAt && item.clientId===clientId && item.startDate===start && item.endDate===invoiceEngine.addDays(start,6)))throw new Error('A sent invoice already exists for this billing week. Review invoice history before preparing another.');
        draft=await invoiceEngine.generate(client,data.clientTasks || [],config,start,new Date().toISOString(),data.invoices || []);
        if(currentUser?.id!==owner || invoiceCheckClientId!==clientId)throw new Error('The account or client changed. Reopen Invoice check.');
        if(invoiceClient()!==client || (data.invoices || []).some(item=>item.id===id))throw new Error('The client or invoice changed while preparing this draft. Reopen Invoice check before continuing.');
        await commitInvoiceRecords([{key:'applications',value:{...client,invoiceSettings:config}},{key:'invoices',value:draft},{key:'alerts',value:invoiceEngine.readyAlert(draft)}]);
      }
      if(currentUser?.id!==owner || invoiceCheckClientId!==clientId)return;
      invoiceCheckDraft=invoiceCopy(draft);markActiveClientDrawerFormClean('invoice-check');
      openInvoiceCheck(clientId,draft.id);
      if(typeof browserDrafts!=='undefined')browserDrafts.clearForm('invoiceCheckForm');
      $('#invoiceCheckSavedDrafts').innerHTML=invoiceDraftRows(clientId);renderAlerts();
      invoiceStatus('Invoice is ready for preview. It has not been sent.');
      if(hiredEditingId===clientId)renderHiredDetail(invoiceClient(),false);
      openInvoiceDraftPreview(draft.id);
    });
  });
  $('#invoiceCheckChooseLogo').addEventListener('click',()=>$('#invoiceCheckLogo').click());
  $('#invoiceCheckLogo').addEventListener('change',async event=>{
    const file=event.target.files?.[0],sequence=invoiceCheckSequence;if(!file)return;
    invoiceLogoSequence++;
    try {
      if(!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>2*1024*1024)throw new Error('Choose a PNG, JPG or WebP logo smaller than 2 MB.');
      const bitmap=await createImageBitmap(file);
      if(bitmap.width>12000 || bitmap.height>12000){bitmap.close();throw new Error('This image is too large. Choose a smaller logo.');}
      const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
      const scale=Math.min(256/bitmap.width,256/bitmap.height);const context=canvas.getContext('2d');context.drawImage(bitmap,(256-bitmap.width*scale)/2,(256-bitmap.height*scale)/2,bitmap.width*scale,bitmap.height*scale);bitmap.close();
      const logo=canvas.toDataURL('image/png');if(logo.length>180000)throw new Error('Choose a simpler or smaller logo image.');
      if(sequence!==invoiceCheckSequence)return;invoiceCheckLogo=logo;renderInvoiceLogo();invoiceStatus('Logo loaded.');
    }catch(error){invoiceStatus(error.message,true);}finally{event.target.value='';}
  });
  $('#invoiceCheckRemoveLogo').addEventListener('click',()=>{invoiceLogoSequence++;invoiceCheckLogo='';renderInvoiceLogo();});
  $('#invoiceCheckBasis').addEventListener('change',()=>updateInvoiceBasis({recalculate:true}));$('#invoiceCheckWeek').addEventListener('change',updateInvoiceBasis);
  for(const name of ['WeeklyHours','Workdays','Rate','Currency'])invoiceField(name).addEventListener('input',()=>{
    if(name==='WeeklyHours' && Number(invoiceField('WeeklyHours').value)>0)invoiceField('Basis').value='agreed';
    updateInvoiceBasis({recalculate:true});
  });
  $('#applyInvoiceHourlyCalculation').addEventListener('click',()=>{
    try{
      if(invoiceField('Basis').value!=='agreed')return;
      const duration=invoiceEngine.workDuration(invoiceField('WeeklyHours').value,invoiceField('Workdays').value);
      const lines=[{description:invoiceField('Service').value,quantity:duration?.hoursPerWeek,rate:invoiceField('Rate').value,unit:'hour'}];invoiceEngine.calculate({lines});
      renderInvoiceEditLines(lines);
      invoiceHourlyCalculationPending=false;updateInvoiceBasis({recalculate:true});
    }catch(error){invoiceStatus(error.message,true);}
  });
  document.addEventListener('click',event=>{
    const preset=event.target.closest('[data-invoice-weekly-hours]');if(!preset)return;
    invoiceField('Basis').value='agreed';invoiceField('WeeklyHours').value=preset.dataset.invoiceWeeklyHours;invoiceField('Workdays').value=5;updateInvoiceBasis({recalculate:true});
  });
  $('#invoiceCheckPaymentMethod').addEventListener('change',()=>{
    const saved=invoicePaymentOptions.find(option=>option.method===invoiceField('PaymentMethod').value);
    if(saved)invoiceField('PaymentDetails').value=saved.details;
  });
  $('#invoiceCheckScheduleHour').innerHTML=Array.from({length:24},(_,hour)=>`<option value="${hour}">${String(hour).padStart(2,'0')}:00</option>`).join('');
  $('#invoiceCheckForm').addEventListener('input',updateInvoiceEditTotal);
  $('#invoiceCheckAddLine').addEventListener('click',()=>{const lines=invoiceReadLines();if(lines.length>=100){invoiceStatus('An invoice can contain up to 100 service lines.',true);return;}lines.push({description:'',quantity:1,rate:'0.00',unit:'service'});renderInvoiceEditLines(lines);});
  $('#invoiceCheckLines').addEventListener('click',event=>{const button=event.target.closest('.invoice-remove-line');if(!button)return;const rows=[...$('#invoiceCheckLines').children];if(rows.length===1){invoiceStatus('Keep at least one service line.',true);return;}button.closest('.invoice-service-editor').remove();updateInvoiceEditTotal();});
  $('#invoiceCheckNewWeek').addEventListener('click',()=>{if(!invoiceCheckBusy)openInvoiceCheck(invoiceCheckClientId);});
  async function openInvoiceDraftPreview(id) {
    const previewSequence=++invoicePreviewSequence;
    let draft=(data.invoices || []).find(item=>item.invoiceDraft && item.id===id);
    if(!draft){toast('This invoice draft is no longer available. Refresh your workspace.');return;}
    if(draft.draftStatus==='sent'){toast('This invoice has already been sent. Open invoice history to review it.');return;}
    const owner=currentUser?.id;
    try {
      const updated=invoiceCopy(draft),client=(data.applications || []).find(item=>item.id===draft.clientId);
      if(!invoiceEngine.settings({issuer:updated.document.issuer}).issuer.logo){
        updated.document.issuer.logo=invoiceEngine.settings({issuer:client?.invoiceSettings?.issuer || {}}).issuer.logo
          || (invoiceProfileOwner===owner?invoiceProfile?.issuer?.logo:'') || await readInvoiceBrandLogo();
        if(!updated.document.issuer.logo)throw new Error('The invoice logo could not load. Reconnect and open the preview again.');
      }
      if(currentUser?.id!==owner)return;
      if(invoiceEngine.legacyInvoiceNumber(updated.document.invoiceNumber))updated.document.invoiceNumber=invoiceEngine.nextInvoiceNumber(data.invoices,updated.document.issueDate.slice(0,4));
      if(JSON.stringify(updated.document)!==JSON.stringify(draft.document)){
        const current=(data.invoices || []).find(item=>item.id===id);
        if(!current || current.updatedAt!==draft.updatedAt)throw new Error('This invoice changed. Reopen the preview.');
        updated.updatedAt=new Date().toISOString();await commitInvoiceRecords([{key:'invoices',value:updated}]);draft=updated;
        if(currentUser?.id!==owner)return;
        if(invoiceCheckClientId===draft.clientId)$('#invoiceCheckSavedDrafts').innerHTML=invoiceDraftRows(draft.clientId);
      }
      if(previewSequence!==invoicePreviewSequence)return;
      invoicePreviewSnapshot=invoiceCopy(draft);
      $('#invoiceDraftPreviewContent').innerHTML=invoiceEngine.html(draft.document);
      $('#invoiceDraftPreviewTitle').textContent=draft.document.invoiceNumber;
      $('#invoiceDraftWarnings').textContent=(draft.document.warnings || []).join(' ');
      $('#invoiceDraftPreviewStatus').textContent='Ready for review · Not sent';
      if(!$('#invoiceDraftPreviewModal').open)$('#invoiceDraftPreviewModal').showModal();
    }catch(error){if(currentUser?.id===owner && previewSequence===invoicePreviewSequence)toast(error.message || 'This draft needs review.');}
  }
  $('#closeInvoiceDraftPreview').addEventListener('click',()=>$('#invoiceDraftPreviewModal').close());
  $('#editInvoiceDraft').addEventListener('click',()=>{if(!invoicePreviewSnapshot)return;$('#invoiceDraftPreviewModal').close();openInvoiceCheck(invoicePreviewSnapshot.clientId,invoicePreviewSnapshot.id);});
  $('#downloadInvoiceDraft').addEventListener('click',()=>{
    if(!invoicePreviewSnapshot)return;
    try {const pdf=window.JeffInvoicePdf.create(invoicePreviewSnapshot.document,window.jspdf?.jsPDF,invoiceEngine);pdf.save(`${invoicePreviewSnapshot.document.invoiceNumber.replace(/[^A-Za-z0-9_-]/g,'_')}.pdf`);$('#invoiceDraftPreviewStatus').textContent='PDF downloaded. No email was sent.';}
    catch(error){$('#invoiceDraftPreviewStatus').textContent=error.message || 'PDF download failed.';}
  });
  function prepareInvoiceDraftEmail() {
    if(!invoicePreviewSnapshot)return;
    try {
      const draft=(data.invoices || []).find(item=>item.id===invoicePreviewSnapshot.id && item.invoiceDraft);
      if(!draft || draft.updatedAt!==invoicePreviewSnapshot.updatedAt)throw new Error('This invoice changed. Reopen its preview before preparing the email.');
      const client=(data.applications || []).find(item=>item.id===draft.clientId);
      if(!client)throw new Error('The client is no longer available.');
      const d=invoiceEngine.validateDocument(draft.document);
      if(draft.draftStatus==='sent' || invoiceAlreadySent(client.id,d.invoiceNumber))throw new Error('This invoice was already sent. Review invoice history.');
      const filename=d.invoiceNumber.replace(/[^A-Za-z0-9_-]/g,'_')+'.pdf';
      const pdf=window.JeffInvoicePdf.create(d,window.jspdf?.jsPDF,invoiceEngine);
      const file=new File([pdf.output('arraybuffer')],filename,{type:'application/pdf'});
      const recipient={...client,email:d.billTo.email || client.email,contact:d.billTo.contact || client.contact};
      openInvoiceComposer(recipient,file,{invoiceNumber:d.invoiceNumber,issueDate:d.issueDate,billingPeriod:`${invoiceEngine.formatDate(d.periodStart)} – ${invoiceEngine.formatDate(d.periodEnd)}`,dueDate:d.dueDate,service:d.service || client.role || 'Professional services',startDate:d.periodStart,endDate:d.periodEnd,amountInvoiced:invoiceEngine.calculate(d).totalCents/100,paymentCurrency:d.currency,sourceDraftId:draft.id,sourceDraftUpdatedAt:draft.updatedAt},true);
      $('#invoiceDraftPreviewModal').close();
    }catch(error){$('#invoiceDraftPreviewStatus').textContent=error.message || 'The email could not be prepared.';}
  }
  $('#emailInvoiceDraft').addEventListener('click',prepareInvoiceDraftEmail);
  document.addEventListener('click',event=>{
    const preview=event.target.closest('[data-invoice-draft-preview]'),edit=event.target.closest('[data-invoice-draft-edit]');
    if(preview)openInvoiceDraftPreview(preview.dataset.invoiceDraftPreview);
    else if(edit){const draft=(data.invoices || []).find(item=>item.id===edit.dataset.invoiceDraftEdit);if(draft)openInvoiceCheck(draft.clientId,draft.id);}
  });
