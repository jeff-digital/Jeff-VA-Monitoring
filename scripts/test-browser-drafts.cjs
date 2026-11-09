const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {parseHTML}=require(process.env.JEFF_VA_DOM_MODULE || '../.codex-remote-attachments/invoice-review/node_modules/linkedom');
const engine=require('../src/frontend/js/invoice-engine.js');
const source=fs.readFileSync('src/frontend/js/modules/05a-browser-drafts.js','utf8');
const storage=new Map(),files=new Map();
const wait=()=>new Promise(resolve=>setTimeout(resolve,15));
function environment(user='owner'){
 const {window}=parseHTML(fs.readFileSync('src/frontend/index.html','utf8')),document=window.document;
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){const option=this.querySelector('option[selected]') || this.querySelector('option');return option?option.getAttribute('value') ?? option.textContent:'';},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',(option.getAttribute('value') ?? option.textContent)===String(value));}});
 let focus=null;Object.defineProperty(document,'activeElement',{get:()=>focus});
 for(const form of document.querySelectorAll('form')){
  Object.defineProperty(form,'elements',{get:()=>[...form.querySelectorAll('input,select,textarea,button')]});form.getClientRects=()=>form.dataset.visible==='yes'?[{}]:[];
  form.reset=()=>{for(const field of form.elements){if(field.type==='checkbox' || field.type==='radio')field.checked=false;else if(field.tagName!=='BUTTON' && field.type!=='file')field.value='';}};
  for(const field of form.elements){Object.defineProperty(field,'form',{get:()=>field.closest('form')});field.getClientRects=()=>form.getClientRects();field.focus=()=>{focus=field;};}
 }
 for(const dialog of document.querySelectorAll('dialog')){dialog.showModal=function(){this.open=true;};dialog.close=function(){this.open=false;};}
 const $=selector=>document.querySelector(selector),events={};
 const indexedDB={open(){const request={};queueMicrotask(()=>{request.result={createObjectStore(){},transaction(){const transaction={objectStore(){return {put(record){files.set(record.id,record);queueMicrotask(()=>transaction.oncomplete?.());},get(id){const result={};queueMicrotask(()=>{result.result=files.get(id);result.onsuccess?.();});return result;}};}};return transaction;}};request.onupgradeneeded?.();request.onsuccess?.();});return request;}};
 const show=id=>{for(const form of document.querySelectorAll('form'))form.dataset.visible='no';const form=$('#'+id);form.dataset.visible='yes';for(let ancestor=form;ancestor;ancestor=ancestor.parentElement){ancestor.hidden=false;ancestor.classList.remove('hidden');}return form;};
 const data={applications:[{id:'client',status:'Active client',clientName:'Example Studio'}],invoices:[],clientTasks:[],dailyTasks:[]};
 let writes=0,sends=0;
 const context=vm.createContext({console,document,window:{JeffInvoiceEngine:engine,addEventListener(type,fn){(events[type] ||= []).push(fn);}},crypto:globalThis.crypto,File,indexedDB,queueMicrotask,Event:window.Event,
 sessionStorage:{getItem:key=>storage.get(key) ?? null,setItem:(key,value)=>storage.set(key,value)},
 currentUser:{id:user},dataReady:true,supabaseDataLoaded:true,data,$,$$:selector=>[...document.querySelectorAll(selector)],
 activeView:'hired',hiredEditingId:'client',showingHiredClientList:false,activeDashboardTab:'client',activeClientDrawerOpen:false,activeClientDrawerView:'list',
 invoiceCheckClientId:'client',invoiceCheckDraft:null,invoiceCheckLogo:'',invoicePaymentOptions:[],invoiceHourlyCalculationPending:false,invoiceHourlyBillingChanged:false,invoiceCheckSequence:0,
 composeClientId:null,composeActivationClientId:null,composeDocumentUpdateClientId:null,composeContractEmailMode:false,composeRequiresConfirmation:false,composeInvoiceDraft:null,composeAttachment:null,composeAttachmentFile:null,invoicePreviewSnapshot:null,
 pendingInvoiceClientId:null,pendingInvoiceFile:null,pendingInvoiceDetails:{},
 APP_VIEW_SET:new Set(['hired','dashboard','applications','inbox']),appViewFromLocation:()=> 'hired',
 showView(view){context.activeView=view;context.showingHiredClientList=true;},renderHiredDetail(record){context.hiredEditingId=record.id;context.showingHiredClientList=false;},selectClientDetailTab(){},
 renderDashboard(){},toast(message){context.notice=message;},
 setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:fn=>fn(),MutationObserver:class{observe(){}},
 refreshInvoiceAutomaticStatus:async()=>{},updateInvoiceBasis(){},updateInvoiceEditTotal(){},invoiceStatus(){},
 renderInvoiceLogo(){ $('#invoiceCheckLogoData').value=context.invoiceCheckLogo;},
 renderInvoicePaymentMethods(selected){$('#invoiceCheckPaymentMethod').innerHTML=`<option value="${engine.escape(selected)}">${engine.escape(selected)}</option>`;},
 invoiceReadLines(){return [...$('#invoiceCheckLines').children].map(row=>({description:row.querySelector('textarea').value,quantity:row.querySelector('input').value,rate:'10',unit:'hour'}));},
 renderInvoiceEditLines(lines){$('#invoiceCheckLines').innerHTML=lines.map(line=>`<div><textarea>${engine.escape(line.description)}</textarea><input value="${line.quantity}" /></div>`).join('');},
 openInvoiceCheck(clientId,id){show('invoiceCheckForm');context.invoiceCheckClientId=clientId;context.invoiceCheckDraft=id?JSON.parse(JSON.stringify(context.data.invoices.find(item=>item.id===id))):null;context.invoiceCheckSequence++;$('#invoiceCheckRate').value='1';$('#invoiceCheckService').value='Server default';if(context.invoiceCheckDraft)context.renderInvoiceEditLines(context.invoiceCheckDraft.document.lines);},
 openActiveClientActionsDrawer(){context.activeClientDrawerOpen=true;},showActiveClientDrawerView(view){context.activeClientDrawerView=view;show(view==='email'?'emailComposeForm':'invoiceUploadForm');},
 openInvoiceDocumentPicker(record,drawer){context.pendingInvoiceClientId=record.id;show('invoiceUploadForm');context.activeClientDrawerOpen=drawer;context.activeClientDrawerView='invoice-upload';},
 updateComposeAttachmentDisplay(){},setEmailComposeStatus(){},openInvoiceDraftPreview:async()=>{},
 persist:async()=>{writes++;return true;},sendGmailRaw:async()=>{sends++;},
 });
 vm.runInContext(source,context);const drafts=vm.runInContext('browserDrafts',context);
 return {context,drafts,document,$,show,events,writes:()=>writes,sends:()=>sends};
}
(async()=>{
 const first=environment();await first.drafts.restore();first.show('invoiceCheckForm');first.$('#invoiceCheckRate').value='10';first.$('#invoiceCheckWeeklyHours').value='40';first.$('#invoiceCheckWorkdays').value='5';first.$('#invoiceCheckService').value='My unfinished description';first.context.invoiceCheckLogo='data:image/png;base64,AAAA';first.context.renderInvoiceLogo();
 const password=first.document.createElement('input');password.type='password';password.id='neverSavePassword';password.value='do-not-store-this';first.$('#invoiceCheckForm').append(password);
 first.drafts.capture();assert.ok(![...storage.values()].join('').includes('do-not-store-this'));
 const second=environment();second.drafts.capture();assert.equal(await second.drafts.restore(),true);assert.equal(second.context.activeView,'hired');assert.equal(second.context.hiredEditingId,'client');assert.equal(second.$('#invoiceCheckRate').value,'10');assert.equal(second.$('#invoiceCheckWeeklyHours').value,'40');assert.equal(second.$('#invoiceCheckService').value,'My unfinished description');assert.equal(second.context.invoiceCheckLogo,'data:image/png;base64,AAAA');assert.equal(second.writes(),0);assert.equal(second.sends(),0);
 const other=environment('another-user');assert.equal(await other.drafts.restore(),false);assert.equal(other.$('#invoiceCheckRate').value,'');
 second.drafts.clearForm('invoiceCheckForm');second.drafts.capture();const afterSave=environment();assert.equal(await afterSave.drafts.restore(),false,'A successfully saved form does not reopen as unfinished');
 const mail=environment();await mail.drafts.restore();mail.show('emailComposeForm');mail.context.activeClientDrawerOpen=true;mail.context.activeClientDrawerView='email';mail.context.composeClientId='client';mail.context.composeAttachmentFile=new File(['%PDF-private-draft'],'draft.pdf',{type:'application/pdf'});mail.$('#composeSubject').value='My unfinished subject';mail.$('#composeBody').value='My unfinished email';mail.drafts.capture();await wait();
 const reloadedMail=environment();assert.equal(await reloadedMail.drafts.restore(),true,reloadedMail.context.notice);assert.equal(reloadedMail.$('#composeSubject').value,'My unfinished subject');assert.equal(reloadedMail.$('#composeBody').value,'My unfinished email');assert.equal(reloadedMail.context.composeAttachmentFile.name,'draft.pdf');assert.equal(await reloadedMail.context.composeAttachmentFile.text(),'%PDF-private-draft');assert.equal(reloadedMail.sends(),0,'Restoring an email never sends it');
 const upload=environment();await upload.drafts.restore();upload.show('invoiceUploadForm');upload.context.activeClientDrawerOpen=true;upload.context.activeClientDrawerView='invoice-upload';upload.context.pendingInvoiceClientId='client';upload.context.pendingInvoiceFile=new File(['invoice-upload'],'upload.pdf',{type:'application/pdf'});upload.$('#invoiceNumber').value='2026-009';upload.$('#invoiceUploadAmount').value='400';upload.drafts.capture();await wait();
 const reloadUpload=environment();assert.equal(await reloadUpload.drafts.restore(),true,reloadUpload.context.notice);assert.equal(reloadUpload.context.pendingInvoiceFile.name,'upload.pdf');assert.equal(reloadUpload.$('#invoiceNumber').value,'2026-009');assert.equal(reloadUpload.$('#invoiceUploadAmount').value,'400');
 const close=environment();await close.drafts.restore();close.show('invoiceCheckForm');close.$('#invoiceCheckService').value='Will cancel';close.drafts.capture();close.$('#invoiceCheckForm').dataset.visible='no';close.drafts.capture();const afterCancel=environment();assert.equal(await afterCancel.drafts.restore(),false,'Explicitly closed forms do not return on reload');
 console.log('PASS reload recovery: route/client, invoice fields/logo, account separation, credential exclusion, save/cancel cleanup, email text/file, uploaded PDF/metadata and no automatic submissions.');
})().catch(error=>{console.error(error);process.exitCode=1;});
