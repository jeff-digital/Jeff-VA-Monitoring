  // Unfinished work stays in this tab, separate from committed account records.
  const browserDrafts = (() => {
    const prefix='jeff-va-unfinished-v1:',tabKey=prefix+'tab';
    const allowed=new Set(['invoiceCheckForm','invoiceUploadForm','emailComposeForm','clientForm','clientTaskForm','dailyTaskForm','toApplyForm','scriptForm','workLinkForm','walletEntryForm','subscriptionForm','socialTrendForm','invoicePaymentForm']);
    const copy=value=>JSON.parse(JSON.stringify(value));
    let restoring=false,leaving=false,timer=null,lastVisible=new Map(),clean=new Map(),warned=false,initializedOwner='',restoreGeneration=0;
    const fileIds=new WeakMap();let database=null,memoryTabId=crypto.randomUUID();
    function tabId(){try{let id=sessionStorage.getItem(tabKey);if(!id){id=memoryTabId;sessionStorage.setItem(tabKey,id);}return id;}catch{return memoryTabId;}}
    const owner=()=>currentUser?.id || '';
    const ready=()=>Boolean(owner() && dataReady && supabaseDataLoaded);
    const storeKey=()=>prefix+owner();
    function read(){try{const saved=JSON.parse(sessionStorage.getItem(storeKey()) || 'null');return saved?.version===1 && saved.owner===owner() && saved.forms && typeof saved.forms==='object' && !Array.isArray(saved.forms)?saved:{version:1,owner:owner(),forms:{},navigation:{}};}catch{return {version:1,owner:owner(),forms:{},navigation:{}};}}
    function write(saved){try{sessionStorage.setItem(storeKey(),JSON.stringify(saved));return true;}catch{if(!warned){warned=true;toast('This browser could not save the unfinished form. Keep this tab open until you save.');}return false;}}
    function db(){
      if(!database)database=new Promise((resolve,reject)=>{
        const request=indexedDB.open('jeff-va-unfinished-files-v1',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('files',{keyPath:'id'});
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
      }).catch(()=>null);
      return database;
    }
    async function saveFile(file,id,user){
      try{const database=await db();if(!database)return;
        await new Promise((resolve,reject)=>{const transaction=database.transaction('files','readwrite');transaction.objectStore('files').put({id,owner:user,tab:tabId(),file,at:Date.now()});transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);});
      }catch{/* Text recovery remains available if the browser refuses file storage. */}
    }
    function rememberFile(file){if(!file || file.size>25*1024*1024)return null;let id=fileIds.get(file);if(!id){id=owner()+':'+tabId()+':'+crypto.randomUUID();fileIds.set(file,id);void saveFile(file,id,owner());}return {id,name:file.name,type:file.type,size:file.size};}
    async function loadFile(reference,user){
      if(!reference?.id)return null;
      try{const database=await db();if(!database)return null;
        const record=await new Promise((resolve,reject)=>{const request=database.transaction('files').objectStore('files').get(reference.id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
        if(owner()!==user || record?.owner!==user || record.tab!==tabId())return null;
        const file=record.file instanceof File?record.file:new File([record.file],reference.name,{type:reference.type});fileIds.set(file,reference.id);return file;
      }catch{return null;}
    }
    function fields(form){return [...form.elements].filter(field=>['INPUT','SELECT','TEXTAREA'].includes(field.tagName) && !['password','file','submit','button'].includes(field.type) && !/password|token|secret|one.time/i.test(field.id+' '+field.name+' '+field.autocomplete));}
    function values(form){return fields(form).map((field,index)=>({id:field.id,index,type:field.type,name:field.name,value:field.type==='checkbox' || field.type==='radio'?field.checked:field.multiple?[...field.selectedOptions].map(option=>option.value):field.value}));}
    function visible(form){return !form.closest('[hidden],.hidden') && Boolean(form.getClientRects().length);}
    function context(form){
      const id=form.id,c={clientId:activeView==='hired'?hiredEditingId || '':''};
      if(id==='invoiceCheckForm')Object.assign(c,{clientId:invoiceCheckClientId,invoice:invoiceCheckDraft?copy(invoiceCheckDraft):null,logo:invoiceCheckLogo,paymentOptions:copy(invoicePaymentOptions),lines:invoiceCheckDraft?invoiceReadLines():[],pending:invoiceHourlyCalculationPending,billingChanged:invoiceHourlyBillingChanged});
      else if(id==='emailComposeForm')Object.assign(c,{clientId:composeInvoiceDraft?.clientId || composeClientId || composeActivationClientId || composeDocumentUpdateClientId || c.clientId,drawer:activeClientDrawerOpen && activeClientDrawerView==='email',composeClientId,composeActivationClientId,composeDocumentUpdateClientId,composeContractEmailMode,composeRequiresConfirmation,invoice:composeInvoiceDraft?copy(composeInvoiceDraft):null,attachment:composeAttachment?copy(composeAttachment):null,file:rememberFile(composeAttachmentFile)});
      else if(id==='invoiceUploadForm')Object.assign(c,{clientId:pendingInvoiceClientId,drawer:activeClientDrawerOpen && activeClientDrawerView==='invoice-upload',file:rememberFile(pendingInvoiceFile)});
      else if(id==='clientForm')Object.assign(c,{recordId:editingId || '',drawer:activeClientDrawerOpen && activeClientDrawerView==='edit',socialLinks:readClientSocialLinks({includeEmpty:true})});
      else if(id==='clientTaskForm')Object.assign(c,{recordId:clientTaskEditingId,entries:copy(clientTaskDraftEntries),oneOff:clientTaskOneOffMode});
      else if(id==='dailyTaskForm')c.checklist=copy(pendingDailyTaskChecklist);
      else if(id==='workLinkForm')c.recordId=form.dataset.editingId || '';
      else if(id==='invoicePaymentForm')c.recordId=form.dataset.invoiceId || '';
      else {const ids={toApplyForm:'toApplyId',scriptForm:'scriptId',walletEntryForm:'walletEntryId',subscriptionForm:'subscriptionId',socialTrendForm:'socialTrendId'};c.recordId=ids[id]?$('#'+ids[id]).value:'';}
      return c;
    }
    function key(id,c){return JSON.stringify([id,c.clientId || '',c.recordId || c.invoice?.id || c.invoice?.sourceDraftId || 'new']);}
    function navigation(){return {view:activeView,clientId:activeView==='hired' && !showingHiredClientList?hiredEditingId:'',clientTab:$('#hiredDetailPanel [data-client-detail-tab].active')?.dataset.clientDetailTab || 'overview',dashboardTab:activeDashboardTab,previewId:$('#invoiceDraftPreviewModal')?.open?invoicePreviewSnapshot?.id || '':''};}
    function statusHost(form){
      return form.querySelector(':scope > .invoice-check-footer') || form;
    }
    function status(form,message){
      const host=statusHost(form);
      let note=host.querySelector(':scope > .form-draft-status');
      if(!note){
        note=document.createElement('p');
        note.className='form-draft-status';
        note.setAttribute('role','status');
        if(host===form)form.append(note);
        else host.prepend(note);
      }
      if(note.textContent!==message)note.textContent=message;
    }
    function capture(){
      if(!ready() || restoring || initializedOwner!==owner() || typeof passwordRecoveryMode!=='undefined' && passwordRecoveryMode)return;
      const saved=read(),open=new Map();let active='';
      for(const id of allowed){const form=$('#'+id);if(!form || !visible(form))continue;
        const c=context(form),idKey=key(id,c),snapshot=values(form),fingerprint=JSON.stringify(snapshot);
        open.set(id,idKey);
        if(clean.get(idKey)===fingerprint || clean.get('form:'+id)===fingerprint)continue;
        const entry={form:id,context:c,values:snapshot,at:Date.now(),fileInputs:[...form.querySelectorAll('input[type="file"]')].filter(field=>field.id).map(field=>({id:field.id,files:[...(field.files || [])].map(rememberFile).filter(Boolean)})),details:[...form.querySelectorAll('details[id]')].map(item=>({id:item.id,open:item.open})),scroll:form.querySelector('.invoice-check-content')?.scrollTop || form.closest('.active-client-drawer-view')?.scrollTop || form.scrollTop || 0,focus:form.contains(document.activeElement)?document.activeElement.id:''};
        saved.forms[idKey]=entry;active=idKey;
        if(form.contains(document.activeElement))saved.active=idKey;
        status(form,'Saved in this tab.');
      }
      for(const [id,oldKey] of lastVisible)if(!open.has(id) && !leaving){delete saved.forms[oldKey];if(saved.active===oldKey)saved.active='';}
      lastVisible=open;
      saved.navigation=navigation();
      if(!saved.active || ![...open.values()].includes(saved.active) || !saved.forms[saved.active])saved.active=active;
      const entries=Object.entries(saved.forms).sort((a,b)=>b[1].at-a[1].at);saved.forms=Object.fromEntries(entries.slice(0,30));write(saved);
    }
    function schedule(){if(restoring || leaving)return;clearTimeout(timer);timer=setTimeout(capture,180);}
    function clearForm(id){if(!ready() || restoring)return;const form=$('#'+id);if(!form)return;const c=context(form),idKey=key(id,c),saved=read();
      for(const [entryKey,entry] of Object.entries(saved.forms))if(entryKey===idKey || id==='invoiceCheckForm' && entry.form===id && entry.context.clientId===c.clientId){delete saved.forms[entryKey];if(saved.active===entryKey)saved.active='';}
      const fingerprint=JSON.stringify(values(form));clean.set(idKey,fingerprint);clean.set('form:'+id,fingerprint);write(saved);statusHost(form).querySelector(':scope > .form-draft-status')?.remove();}
    function client(id){return (data.applications || []).find(item=>item.id===id);}
    function openClient(id){const record=client(id);if(!record)throw new Error('The client for this draft is no longer available.');if(activeView!=='hired')showView('hired');renderHiredDetail(record,false);hiredEditingId=id;}
    async function open(entry,user){
      const c=entry.context,id=entry.form;
      const collections={scriptForm:'scripts',workLinkForm:'workLinks',toApplyForm:'toApply',walletEntryForm:'walletEntries',subscriptionForm:'subscriptions',socialTrendForm:'socialTrends',invoicePaymentForm:'invoices'};
      if(c.recordId && collections[id] && !(data[collections[id]] || []).some(item=>item.id===c.recordId))throw new Error('The record for this unfinished form is no longer available.');
      if(c.clientId && ['invoiceCheckForm','invoiceUploadForm','clientTaskForm'].includes(id))openClient(c.clientId);
      if(id==='invoiceCheckForm'){
        if(c.invoice && !(data.invoices || []).some(item=>item.id===c.invoice.id && item.draftStatus!=='sent'))throw new Error('This invoice is no longer an editable draft.');
        openInvoiceCheck(c.clientId,c.invoice?.id || '');
        // Finish private defaults before reapplying the user's unsaved fields.
        invoiceCheckSequence++;
        invoicePaymentOptions=window.JeffInvoiceEngine.settings({payment:{options:c.paymentOptions || []}}).payment.options;
        renderInvoicePaymentMethods(entry.values.find(item=>item.id==='invoiceCheckPaymentMethod')?.value || '');
        if(c.invoice)invoiceCheckDraft=copy(c.invoice);
        if(c.invoice)renderInvoiceEditLines(c.lines);
        invoiceCheckLogo=c.logo || '';renderInvoiceLogo();invoiceHourlyCalculationPending=Boolean(c.pending);invoiceHourlyBillingChanged=Boolean(c.billingChanged);
      }else if(id==='emailComposeForm'){
        if(c.clientId && !client(c.clientId))throw new Error('The client for this email is no longer available.');
        let file=await loadFile(c.file,user);if(owner()!==user)return false;
        if(!file && c.invoice?.sourceDraftId){const draft=(data.invoices || []).find(item=>item.id===c.invoice.sourceDraftId && item.updatedAt===c.invoice.sourceDraftUpdatedAt && item.draftStatus!=='sent');if(draft){try{file=new File([window.JeffInvoicePdf.create(draft.document,window.jspdf?.jsPDF,invoiceEngine).output('arraybuffer')],c.invoice.fileName,{type:'application/pdf'});}catch{}}}
        composeClientId=c.composeClientId || null;composeActivationClientId=c.composeActivationClientId || null;composeDocumentUpdateClientId=c.composeDocumentUpdateClientId || null;composeContractEmailMode=Boolean(c.composeContractEmailMode);composeRequiresConfirmation=Boolean(c.composeRequiresConfirmation);composeInvoiceDraft=c.invoice || null;composeAttachment=c.attachment || null;composeAttachmentFile=file;
        if(c.drawer && c.clientId){openClient(c.clientId);if(!activeClientDrawerOpen)openActiveClientActionsDrawer($('#activeClientActionsButton'));showActiveClientDrawerView('email');}
        else if(!$('#emailComposeModal').open)$('#emailComposeModal').showModal();
        updateComposeAttachmentDisplay();setEmailComposeStatus(!file && c.file?'Email text restored. Choose the attachment again before sending.':'Unfinished email restored. Review it before sending.');
      }else if(id==='invoiceUploadForm'){
        if(c.drawer && !activeClientDrawerOpen)openActiveClientActionsDrawer($('#activeClientActionsButton'));
        openInvoiceDocumentPicker(client(c.clientId),c.drawer);
        const file=await loadFile(c.file,user);if(owner()!==user)return false;
        pendingInvoiceFile=file;$('#useInvoiceFileButton').disabled=!file;$('#invoiceUploadFileInfo').textContent=file?.name || 'Choose the invoice file again';
      }else if(id==='clientForm'){
        if(c.recordId && !client(c.recordId))throw new Error('This client or application no longer exists.');
        openClientModal(c.recordId || null,false,Boolean(c.drawer),false,Boolean(c.drawer));renderClientSocialLinkEditor(c.socialLinks || []);
      }else if(id==='clientTaskForm'){
        const task=(data.clientTasks || []).find(item=>item.id===c.recordId && item.clientId===c.clientId);if(c.recordId && !task)throw new Error('This task no longer exists.');
        openClientTaskDrawer(task || null);clientTaskDraftEntries=c.entries || [];clientTaskOneOffMode=Boolean(c.oneOff);renderClientTaskEntries();
      }else if(id==='dailyTaskForm'){resetDailyTaskDraft();pendingDailyTaskChecklist=c.checklist || [];renderDailyTaskDraftChecklist();$('#dailyTaskAddModal').showModal();}
      else if(id==='scriptForm')openScriptForm(c.recordId);
      else if(id==='workLinkForm')openWorkLinkForm(c.recordId);
      else if(id==='toApplyForm')openToApplyModal(c.recordId || null);
      else if(id==='walletEntryForm')openWalletEntry((data.walletEntries || []).find(item=>item.id===c.recordId) || null);
      else if(id==='subscriptionForm')openSubscriptionEditor(c.recordId);
      else if(id==='socialTrendForm')openSocialTrendDrawer((data.socialTrends || []).find(item=>item.id===c.recordId) || null);
      else if(id==='invoicePaymentForm')openInvoicePayment(c.recordId);
      return true;
    }
    function apply(entry){
      const form=$('#'+entry.form),inputs=fields(form);
      for(const item of entry.values || []){const field=item.id?inputs.find(field=>field.id===item.id):inputs[item.index];if(!field || field.type!==item.type)continue;
        if(field.type==='checkbox' || field.type==='radio')field.checked=item.value===true;
        else if(field.multiple && Array.isArray(item.value))[...field.options].forEach(option=>{option.selected=item.value.includes(option.value);});
        else field.value=String(item.value ?? '');
      }
      for(const item of entry.details || []){const element=[...form.querySelectorAll('details[id]')].find(element=>element.id===item.id);if(element)element.open=item.open;}
      if(entry.form==='invoiceCheckForm'){invoiceCheckLogo=$('#invoiceCheckLogoData').value || entry.context.logo || '';renderInvoiceLogo();updateInvoiceBasis();updateInvoiceEditTotal();invoiceStatus('Draft restored.');}
      if(entry.form==='clientTaskForm'){updateClientTaskRepeatFields();updateClientTaskSchedule();}
      if(entry.form==='dailyTaskForm'){dailyTaskRelatedOptions();$('#dailyTaskDestinationField').classList.toggle('hidden',$('#dailyTaskType').value!=='apply');}
      if(entry.form==='clientForm'){
        for(const id of ['clientPlatform','clientCountry','clientRegion']){
          const field=inputs.find(field=>field.id===id);if(field){const saved=entry.values.find(item=>item.id===id);if(saved)field.value=String(saved.value ?? '');field.dispatchEvent(new Event('change'));}
        }
        for(const item of entry.values || []){const field=item.id?inputs.find(field=>field.id===item.id):null;if(field && field.tagName==='SELECT')field.value=String(item.value ?? '');}
        updateSalaryFields();updateClientActionLabel();
      }
      if(entry.form==='walletEntryForm')syncWalletPayeeField();
      status(form,entry.form==='invoiceCheckForm'?'Saved in this tab.':'Unfinished form restored. Changes are not submitted automatically.');
      requestAnimationFrame(()=>{const area=form.querySelector('.invoice-check-content') || form.closest('.active-client-drawer-view') || form;area.scrollTop=entry.scroll || 0;const focus=fields(form).find(field=>field.id===entry.focus);if(focus && focus.getClientRects().length)focus.focus({preventScroll:true});});
    }
    async function restoreFileInputs(entry,user){
      for(const item of entry.fileInputs || []){
        const form=$('#'+entry.form),input=[...form.querySelectorAll('input[type="file"]')].find(field=>field.id===item.id);
        if(!input || !item.files?.length || typeof DataTransfer==='undefined')continue;
        const files=await Promise.all(item.files.map(reference=>loadFile(reference,user)));if(owner()!==user)return;
        const transfer=new DataTransfer();for(const file of files.filter(Boolean))transfer.items.add(file);input.files=transfer.files;
        // Logo decoding is local; other change handlers can upload files, so do not replay them.
        if(input.id==='invoiceCheckLogo' && !invoiceCheckLogo && files.some(Boolean))input.dispatchEvent(new Event('change',{bubbles:true}));
      }
    }
    async function restore(){
      if(typeof passwordRecoveryMode!=='undefined' && passwordRecoveryMode){initializedOwner=owner();return false;}
      if(!ready())return false;const user=owner(),generation=++restoreGeneration,saved=read(),route=appViewFromLocation(),navigation=saved.navigation || {};
      restoring=true;let restored=false;
      try{
        const view=route || (APP_VIEW_SET.has(navigation.view)?navigation.view:activeView);showView(view,{updateUrl:!route});
        if(view==='dashboard' && ['client','application'].includes(navigation.dashboardTab)){
          activeDashboardTab=navigation.dashboardTab;
          $$('[data-dashboard-tab]').forEach(tab=>{const selected=tab.dataset.dashboardTab===activeDashboardTab;tab.classList.toggle('active',selected);tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;});
          $$('[data-dashboard-panel]').forEach(panel=>{panel.hidden=panel.dataset.dashboardPanel!==activeDashboardTab;});renderDashboard();
        }
        if(view==='hired' && navigation.clientId && client(navigation.clientId)){openClient(navigation.clientId);selectClientDetailTab(navigation.clientTab || 'overview');}
        const entry=saved.forms[saved.active];
        if(entry && allowed.has(entry.form) && (!navigation.view || navigation.view===view)){
          if(await open(entry,user) && owner()===user){
            apply(entry);
            await restoreFileInputs(entry,user);if(owner()!==user)return false;
            if(entry.form==='invoiceCheckForm'){await refreshInvoiceAutomaticStatus(invoiceCheckSequence,{fillProfile:false});if(owner()!==user)return false;}
            restored=true;
          }
        }else if(view==='hired' && navigation.previewId){await openInvoiceDraftPreview(navigation.previewId);restored=true;}
      }catch(error){if(owner()===user)toast(error.message || 'Your unfinished form is still saved, but could not be reopened.');}
      finally{if(generation===restoreGeneration){restoring=false;lastVisible=new Map();initializedOwner=owner()===user?user:'';}}
      if(owner()===user)schedule();return restored;
    }
    function signOut(){capture();restoreGeneration++;initializedOwner='';restoring=true;
      for(const id of allowed){const form=$('#'+id);if(!form)continue;const dialog=form.closest('dialog');if(dialog?.open)dialog.close();form.reset();statusHost(form).querySelector(':scope > .form-draft-status')?.remove();}
      if(activeClientDrawerOpen)void closeActiveClientActionsDrawer(true);lastVisible=new Map();clean.clear();restoring=false;
    }
    function edited(form){clean.delete('form:'+form.id);clean.delete(key(form.id,context(form)));}
    document.addEventListener('input',event=>{if(allowed.has(event.target.form?.id)){edited(event.target.form);schedule();}});
    document.addEventListener('change',event=>{if(allowed.has(event.target.form?.id)){edited(event.target.form);event.target.type==='file'?capture():schedule();}});
    document.addEventListener('click',()=>schedule());
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')capture();});
    window.addEventListener('beforeunload',()=>{capture();leaving=true;});window.addEventListener('pagehide',()=>{capture();leaving=true;});window.addEventListener('pageshow',()=>{leaving=false;});
    new MutationObserver(records=>{if(records.some(record=>record.type==='attributes' || record.addedNodes.length || record.removedNodes.length))schedule();}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','hidden','data-view']});
    return {capture,schedule,restore,clearForm,signOut};
  })();
