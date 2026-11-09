const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const engine=require('../src/frontend/js/invoice-engine.js');
const source=fs.readFileSync('src/frontend/js/modules/03c-invoice-check.js','utf8');
const nodes=new Map();let rows=[],total=0,click;
function field(name,value=''){if(!nodes.has(name))nodes.set(name,{value,hidden:false,textContent:'',events:{},addEventListener(type,fn){(this.events[type] ||= []).push(fn);}});return nodes.get(name);}
function service(line){const fields=Object.fromEntries(['description','quantity','rate','unit'].map(name=>[name,{value:line[name]}]));return {fields,querySelector(selector){return fields[selector.match(/data-invoice-line="(\w+)"/)[1]];}};}
const currentLines=()=>rows.map(row=>Object.fromEntries(Object.entries(row.fields).map(([key,input])=>[key,input.value])));
const context=vm.createContext({invoiceEngine:engine,invoiceCheckDraft:{id:'existing'},invoiceHourlyCalculationPending:false,invoiceHourlyBillingChanged:false,
 invoiceField:name=>field(name),$:selector=>selector==='#invoiceCheckLines'?{querySelectorAll:()=>rows}:field(selector.replace('#invoiceCheck','')),
 document:{addEventListener(type,fn){if(type==='click')click=fn;}},
 updateInvoiceEditTotal(){total=engine.calculate({lines:currentLines()}).totalCents;},
 renderInvoiceEditLines(lines){rows=lines.map(service);},invoiceStatus(message){throw Error(message);}});
for(const [key,value] of Object.entries({Basis:'weekly',Rate:'10',WeeklyHours:'',Workdays:'5',Currency:'USD',Service:'Virtual assistance',Week:'2026-11-02'}))field(key).value=value;
rows=[service({description:'Virtual assistance',quantity:1,rate:'10',unit:'week'})];
vm.runInContext(source.slice(source.indexOf('  function updateInvoiceBasis('),source.indexOf('  function renderInvoiceLogo(')),context);
vm.runInContext(source.slice(source.indexOf("  $('#invoiceCheckBasis').addEventListener"),source.indexOf("  $('#invoiceCheckPaymentMethod').addEventListener")),context);
const preset=hours=>click({target:{closest:()=>({dataset:{invoiceWeeklyHours:String(hours)}})}});
const input=(name,value)=>{field(name).value=value;for(const fn of field(name).events.input || [])fn({target:field(name)});};
preset(40);
assert.equal(field('Basis').value,'agreed');assert.equal(total,40000,'Correct an existing $10 weekly invoice to 40 hours × $10');
assert.ok(field('WeeklyTotal').textContent.includes('400.00'));assert.ok(field('HourlyBreakdown').textContent.includes('80.00'));assert.ok(field('DurationSummary').textContent.includes('8 hours/day'));assert.equal(rows[0].fields.unit.value,'hour');
assert.equal(context.invoiceHourlyBillingChanged,true,'A saved hourly edit updates future billing setup');
input('WeeklyHours','20');assert.equal(total,20000);assert.ok(field('DurationSummary').textContent.includes('4 hours/day'));
input('WeeklyHours','40');input('Rate','12.50');assert.equal(total,50000);assert.ok(field('HourlyBreakdown').textContent.includes('100.00'));
field('Basis').value='weekly';for(const fn of field('Basis').events.change)fn({});assert.equal(total,1250,'Explicit fixed-fee selection remains a flat total');
input('Rate','10');input('WeeklyHours','40');assert.equal(total,40000,'Typing hours selects hourly billing without a hidden extra selection');
rows.push(service({description:'Additional service',quantity:1,rate:'5',unit:'service'}));preset(40);
assert.equal(rows.length,2,'Multiple service lines are preserved until explicitly replaced');assert.equal(context.invoiceHourlyCalculationPending,true);
assert.equal(field('#applyInvoiceHourlyCalculation').hidden,false);
for(const fn of field('#applyInvoiceHourlyCalculation').events.click)fn({});
assert.equal(rows.length,1);assert.equal(total,40000);assert.equal(context.invoiceHourlyCalculationPending,false);
input('Workdays','0');assert.equal(field('HourlyCalculation').hidden,true);assert.match(field('DurationSummary').textContent,/workdays/);
console.log('PASS hourly-price UI: existing $10 fee → $400, $80/day, automatic hourly mode, input/preset recalculation, changed rates, explicit flat fee and safe multi-line replacement.');
