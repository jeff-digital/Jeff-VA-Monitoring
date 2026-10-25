const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const nodes=new Map();const $=key=>{if(!nodes.has(key))nodes.set(key,{value:'',hidden:true,innerHTML:'',textContent:'',addEventListener(){},classList:{toggle(){}},setAttribute(){},focus(){}});return nodes.get(key);};
let saves=0, seq=0;
const context=vm.createContext({$,currentUser:{id:'u1'},dataReady:true,Date,sessionStorage:{getItem:()=>null,setItem(){}},
 data:{applications:[{id:'a1',clientName:'Acme',role:'Editor',email:'contact@acme.com',status:'Applied',appliedDate:'2026-10-20'},{id:'a2',clientName:'Acme',role:'Designer',email:'contact@acme.com'},{id:'a3',clientName:'Other company',role:'Editor'}],dailyTasks:[]},
 today:()=> '2026-10-25',uid:()=> 'id-'+ ++seq,persist:()=>saves++,renderAll(){},escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
 matchingEmailsForApplication:app=>[{subject:'Received '+app.id,from:'Acme',date:'2026-10-24',body:'Thanks for applying'},{subject:'Sent follow-up',direction:'sent'}],isSentEmail:email=>email.direction==='sent'});
vm.runInContext(fs.readFileSync('src/frontend/js/modules/pages/06c-assistant-workspace.js','utf8'),context);
vm.runInContext(fs.readFileSync('src/frontend/js/modules/pages/06b-research-chat.js','utf8'),context);
assert.equal(context.assistantWorkspaceRequest('Make a task for tomorrow: finish video','reasoning').mode,'task');
assert.ok(context.assistantWorkspaceRequest('Any updates on Acme?','reasoning').error,'Same-company roles require selection');
const check=context.assistantWorkspaceRequest('Any reply for Acme Editor application?','reasoning');assert.equal(check.workspace.application.role,'Editor');assert.equal(check.workspace.emails.length,1);assert.equal(check.workspace.emails[0].subject,'Received a1');assert.ok(!JSON.stringify(check).includes('Other company'));
assert.equal(context.assistantWorkspaceRequest('Any update for Acme Designer?','application').scope,'application:a2');
assert.ok(context.assistantWorkspaceRequest('Update for an unknown company?','application').error);
assert.match(context.assistantWorkspaceRequest('Any update for Acme?','application').error,/exact role/);
const chat=context.currentResearchChat();chat.messages.push({role:'assistant',content:'Draft',actionId:'action-1',taskDraft:{title:'Finish video',taskDate:'2026-10-26',notes:'Check audio'}});
assert.equal(context.data.dailyTasks.length,0,'Generating a draft never saves');
context.addAssistantDailyTask('action-1');assert.equal(context.data.dailyTasks.length,1);assert.equal(saves,1);assert.equal(context.data.dailyTasks[0].taskDate,'2026-10-26');
context.addAssistantDailyTask('action-1');assert.equal(saves,1,'Double click cannot duplicate');
chat.messages.push({role:'assistant',content:'Draft',actionId:'action-2',taskDraft:{title:'Finish video',taskDate:'2026-10-26',notes:''}});context.addAssistantDailyTask('action-2');assert.equal(saves,1,'Same title and date are deduplicated');
context.currentUser={id:'u2'};context.addAssistantDailyTask('action-1');assert.equal(saves,1,'Other account cannot confirm old draft');
assert.equal(context.validAssistantTaskDraft({title:'x',taskDate:'2026-02-30',notes:''}),false);
console.log('Workspace UI passed: exact application/role selection, received-only context, task confirmation, duplicate prevention, invalid dates and account isolation.');
