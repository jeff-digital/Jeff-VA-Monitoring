const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const engine=require('../src/frontend/js/invoice-engine.js');
const gmail=fs.readFileSync('src/frontend/js/modules/04-gmail.js','utf8');
const check=fs.readFileSync('src/frontend/js/modules/03c-invoice-check.js','utf8');
const nodes=new Map();
function $(selector){if(!nodes.has(selector))nodes.set(selector,{value:'',textContent:'',open:false,focus(){},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(selector);}
let sent=0,saved=0,attachmentShown=0;
let saveSucceeds = true;
const context=vm.createContext({console,window:{JeffInvoicePdf:{create:()=>({output:()=>new Uint8Array([37,80,68,70]).buffer})},jspdf:{jsPDF:()=>{}}},File,Date,JSON,Uint8Array,invoiceEngine:engine,$,
 currentUser:{email:'billing@example.com',user_metadata:{name:'Example Services'}},
 data:{applications:[{id:'client',status:'Active client',clientName:'Example Studio',email:'client@example.com',role:'Support'}],invoices:[],emails:[]},
 composeAttachment:null,composeAttachmentFile:null,composeClientId:null,composeActivationClientId:null,composeDocumentUpdateClientId:null,composeContractEmailMode:false,composeRequiresConfirmation:false,composeInvoiceDraft:null,
 invoicePreviewSnapshot:null,contractEmailSendPending:false,editingId:null,
 today:()=> '2026-11-09',contractDuration:()=>'',renderEmailTemplateOptions(){},updateComposeAttachmentDisplay(){attachmentShown++;},setEmailComposeStatus(message){$('#emailComposeStatus').textContent=message;},
 extractEmailAddress:value=>value,isEmailAddress:value=>value.includes('@'),setButtonLoading(){},wrapBase64:value=>value,encodeBase64:()=> 'PDF',buildRawEmailMessage:input=>input,
 sendGmailRaw:async input=>{sent++;assert.equal(input.attachmentType,'application/pdf');return {id:'test-gmail-id'};},
 uid:()=> 'sent-invoice',persist:async()=>{saved++;return saveSucceeds;},renderAll(){},isActiveClientDrawerOpen:()=>false,showEmailActionResult(){},appConfirm:async()=>{throw Error('Unexpected prompt');}});
vm.runInContext(gmail.slice(gmail.indexOf('  const DOCUMENT_TEMPLATE_DEFINITIONS ='),gmail.indexOf('  let gmailAccessToken')),context);
vm.runInContext(gmail.slice(gmail.indexOf('  function buildDocumentEmailTemplate('),gmail.indexOf('  function renderEmailTemplateOptions(')),context);
vm.runInContext(gmail.slice(gmail.indexOf('  function openInvoiceComposer('),gmail.indexOf('  function openUpdatedDocumentEmailComposer(')),context);
vm.runInContext(gmail.slice(gmail.indexOf('  async function runComposedEmail('),gmail.indexOf('  function gmailConfigured(')),context);
const documents=fs.readFileSync('src/frontend/js/modules/03-documents.js','utf8');
vm.runInContext(documents.slice(documents.indexOf('  function invoiceAlreadySent('),documents.indexOf('  async function extractInvoiceText(')),context);
vm.runInContext(check.slice(check.indexOf('  function prepareInvoiceDraftEmail('),check.indexOf("  $('#emailInvoiceDraft').addEventListener")),context);
vm.runInContext(check.slice(check.indexOf('  async function commitInvoiceRecords('),check.indexOf('  async function invoiceCheckOperation(')),context);
const payments=fs.readFileSync('src/frontend/js/modules/03a-invoice-payments.js','utf8');
vm.runInContext(payments.slice(payments.indexOf('  function parseInvoiceDate('),payments.indexOf('  function invoiceAmount(')),context);
context.invoiceCopy=value=>JSON.parse(JSON.stringify(value));
context.activeView='dashboard';
context.renderAlerts=()=>{};
context.showActionResult=()=>{};
context.toast=()=>{};
(async()=>{
 const draft=await engine.generate(context.data.applications[0],[],{basis:'weekly',rate:'250',issuer:{name:'Example Services',email:'billing@example.com'},payment:{method:'Wise',details:'Example account'}},'2026-11-02','2026-11-09T01:00:00Z');
 context.data.invoices.push(draft);context.invoicePreviewSnapshot=JSON.parse(JSON.stringify(draft));
 context.prepareInvoiceDraftEmail();
 assert.equal(sent,0,'Preparing never sends');assert.equal(saved,0,'Preparing never marks the invoice sent');
 assert.equal($('#emailComposeModal').open,true);assert.equal(context.composeAttachmentFile.type,'application/pdf');assert.equal(attachmentShown,1);
 assert.match($('#composeSubject').value,new RegExp(draft.document.invoiceNumber));assert.ok($('#composeBody').value.includes('Nov 2, 2026'));assert.ok(!$('#composeBody').value.includes('{{'));
 assert.equal(context.composeInvoiceDraft.amountInvoiced,250);
 const attachment=context.composeAttachmentFile;context.composeAttachmentFile=null;
 await context.runComposedEmail();assert.equal(sent,0,'Missing generated invoice PDF blocks sending');
 context.composeAttachmentFile=attachment;context.data.invoices[0].updatedAt='changed';
 await context.runComposedEmail();assert.equal(sent,0,'Changed draft blocks stale email');
 context.data.invoices[0].updatedAt=draft.createdAt;
 await context.runComposedEmail();assert.equal(sent,1);assert.equal(saved,1);
 assert.equal(context.data.invoices[0].amountInvoiced,250);assert.equal(context.data.invoices[1].draftStatus,'sent');assert.equal(context.data.emails[0].applicationId,'client');
 context.invoicePreviewSnapshot=JSON.parse(JSON.stringify(draft));context.prepareInvoiceDraftEmail();assert.equal(sent,1);assert.match($('#invoiceDraftPreviewStatus').textContent,/already sent/);
 const next=await engine.generate(context.data.applications[0],[],{basis:'weekly',rate:'250',issuer:{name:'Example Services',email:'billing@example.com'},payment:{method:'Wise',details:'Example account'}},'2026-11-09','2026-11-09T01:00:00Z',context.data.invoices);
 next.document.invoiceNumber = draft.document.invoiceNumber;
 context.data.invoices.push(next);context.invoicePreviewSnapshot=JSON.parse(JSON.stringify(next));
 let drawerView='',cleaned='';context.isActiveClientDrawerOpen=()=>true;context.showActiveClientDrawerView=view=>{drawerView=view;};context.markActiveClientDrawerFormClean=view=>{cleaned=view;};$('#emailComposeModal').open=false;
 context.prepareInvoiceDraftEmail();assert.equal(drawerView,'email');assert.equal(cleaned,'email');assert.equal($('#emailComposeModal').open,false,'Invoice email stays in the existing sidebar');assert.equal(sent,1);
 await context.runComposedEmail();
 assert.equal(sent,1,'Only the actual Send action rejects a number already sent');
 assert.match($('#emailComposeStatus').textContent,/already sent/);
 next.document.invoiceNumber = '2026-002';

 const original = context.data.invoices.find(invoice => invoice.id === 'sent-invoice');
 original.paidAt = '2026-11-10';
 context.appConfirm = async message => {
   assert.match(message, /original email will remain/);
   assert.match(message, /recorded payment/);
   return false;
 };
 await context.deleteSentInvoice(original.id);
 assert.equal(original.deletedAt, undefined);
 context.appConfirm = async () => true;
 saveSucceeds = false;
 await context.deleteSentInvoice(original.id);
 assert.equal(context.data.invoices.find(invoice => invoice.id === original.id).deletedAt, undefined);
 assert.equal(context.data.invoices.find(invoice => invoice.id === draft.id).draftStatus, 'sent');

 saveSucceeds = true;
 await context.deleteSentInvoice(original.id);
 const deleted = context.data.invoices.find(invoice => invoice.id === original.id);
 const correction = context.data.invoices.find(invoice => invoice.id === draft.id);
 assert.equal(context.invoicePaymentStatus(deleted), 'Deleted');
 assert.equal(context.invoiceAlreadySent('client', original.invoiceNumber), false, 'Deleting releases the old number');
 assert.equal(correction.draftStatus, 'ready');
 assert.equal(correction.document.periodStart, draft.document.periodStart);
 assert.equal(correction.document.invoiceNumber, '2026-003');
 assert.equal(correction.sentInvoiceId, undefined);
 assert.equal(context.data.emails.length, 1, 'Original email history remains intact');
 assert.equal(sent, 1, 'Deleting does not send email');

 correction.document.invoiceNumber = original.invoiceNumber;
 context.invoicePreviewSnapshot = JSON.parse(JSON.stringify(correction));
 context.prepareInvoiceDraftEmail();
 assert.equal(context.composeInvoiceDraft.invoiceNumber, correction.document.invoiceNumber);
 context.uid = () => 'sent-correction';
 context.closeActiveClientActionsDrawer = async () => {};
 await context.runComposedEmail();
 assert.equal(sent, 2, 'The corrected invoice can be sent explicitly');
 assert.equal(context.data.invoices.find(invoice => invoice.id === draft.id).sentInvoiceId, 'sent-correction');
 assert.equal(context.invoiceAlreadySent('client', original.invoiceNumber), true, 'The active replacement blocks a second send');

 const upload = { id: 'sent-upload', clientId: 'client', invoiceNumber: '2026-004' };
 context.data.invoices.push(upload);
 const length = context.data.invoices.length;
 await context.deleteSentInvoice(upload.id);
 assert.equal(context.data.invoices.length, length);
 assert.ok(context.data.invoices.find(invoice => invoice.id === upload.id).deletedAt);
 console.log('PASS invoice email and corrections: attachment and duplicate guards, cancellation and failed-save rollback, retained email history, and explicit replacement delivery.');
})().catch(error=>{console.error(error);process.exitCode=1;});
