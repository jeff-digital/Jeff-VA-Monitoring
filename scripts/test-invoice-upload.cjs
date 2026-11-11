const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('src/frontend/js/modules/03-documents.js','utf8');
const payments=fs.readFileSync('src/frontend/js/modules/03a-invoice-payments.js','utf8');
const nodes=new Map();function $(selector){if(!nodes.has(selector))nodes.set(selector,{value:'',textContent:'',disabled:false,open:false,showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(selector);}
const content='INVOICE 2026-015 BILL TO Example Studio Issued Nov 9, 2026 Due date Nov 16, 2026 Billing period Nov 2, 2026 – Nov 8, 2026 Currency USD DESCRIPTION QTY / HOURS RATE AMOUNT Support hour 25.5 USD 20.00 USD 510.00 Subtotal USD 510.00 TOTAL DUE USD 510.00';
let composer=null,view='',readContent=content;
const context=vm.createContext({console,$,MAX_DOCUMENT_SIZE_BYTES:25*1024*1024,pendingInvoiceClientId:null,pendingInvoiceFile:null,pendingInvoiceDetails:{},
 data:{applications:[{id:'client',clientName:'Example',role:'Client support'}],invoices:[]},toast(){},
 showActiveClientDrawerView:value=>{view=value;},markActiveClientDrawerFormClean(){},isActiveClientDrawerView:value=>view===value,
 openInvoiceComposer(...args){composer=args;},documentContentType:()=> 'application/pdf'});
vm.runInContext(payments.slice(payments.indexOf('  function parseInvoiceDate('),payments.indexOf('  function invoicePaymentStatus(')),context);
vm.runInContext(source.slice(source.indexOf('  function extractInvoiceField('),source.indexOf('  function openClientDocumentPicker(')),context);
context.extractInvoiceText=async()=>readContent;
(async()=>{
 const parsed=context.extractInvoiceDetails(content);
 assert.equal(parsed.invoiceNumber,'2026-015');assert.equal(parsed.issueDate,'2026-11-09');assert.equal(parsed.dueDate,'2026-11-16');assert.equal(parsed.startDate,'2026-11-02');assert.equal(parsed.endDate,'2026-11-08');assert.equal(parsed.amountInvoiced,'510.00');assert.equal(parsed.currency,'USD');
 const blank=context.extractInvoiceDetails('Invoice Number: [invoice number] Date of Issue: [date] Billing Period: [week] Due Date: [date]');assert.equal(blank.invoiceNumber,'');assert.equal(blank.issueDate,'');
 context.openInvoiceDocumentPicker(context.data.applications[0],true);assert.equal(view,'invoice-upload');assert.equal($('#invoiceDocumentPickerModal').open,false,'Upload remains in the same sidebar');
 const file={name:'invoice.pdf',type:'application/pdf',size:100};await context.stageInvoiceFile(file);
 assert.equal($('#invoiceStartDate').value,'2026-11-02');assert.equal($('#invoiceEndDate').value,'2026-11-08');assert.equal($('#invoiceUploadAmount').value,'510.00');
 context.continueInvoicePicker();assert.equal(composer[1],file);assert.equal(composer[2].paymentCurrency,'USD');assert.equal(composer[2].amountInvoiced,510);assert.equal(composer[3],true);assert.equal(context.pendingInvoiceFile,null);
 composer=null;context.openInvoiceDocumentPicker(context.data.applications[0],true);await context.stageInvoiceFile(file);$('#invoiceEndDate').value='2026-11-01';context.continueInvoicePicker();assert.equal(composer,null);assert.match($('#invoiceDocumentPickerStatus').textContent,/Check the dates/);
 await context.stageInvoiceFile({name:'bad.exe',size:100});assert.equal(context.pendingInvoiceFile,null);assert.equal($('#useInvoiceFileButton').disabled,true);
 context.extractInvoiceText=()=>new Promise(resolve=>{context.finishRead=resolve;});
 const pending=context.stageInvoiceFile(file);context.clearInvoiceUploadDraft();context.finishRead(content);await pending;assert.equal(context.pendingInvoiceFile,null);assert.equal($('#useInvoiceFileButton').disabled,true,'A cancelled read cannot enable the old attachment');
 context.data.invoices=[{id:'sent',clientId:'another-client',invoiceNumber:'2026-001',sentAt:'2026-11-09'}];assert.equal(context.invoiceAlreadySent('client','2026-1'),true,'Year sequence numbers cannot be reused for another client');
 context.data.invoices[0].invoiceNumber = '2026-015';
 context.extractInvoiceText = async () => content;
 context.openInvoiceDocumentPicker(context.data.applications[0],true);await context.stageInvoiceFile(file);
 context.continueInvoicePicker();assert.equal(composer[2].invoiceNumber,'2026-015','Upload can proceed to review with a previously sent number');
 console.log('PASS invoice upload: generated-PDF labels, ISO dates, billing boundaries, total/currency, placeholders, same-sidebar review, correct attachment, invalid dates/files, stale reads and duplicate numbers.');
})().catch(error=>{console.error(error);process.exitCode=1;});
