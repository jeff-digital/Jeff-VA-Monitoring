const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('src/frontend/js/modules/03b-notifications-and-reminders.js','utf8');
let day='2026-10-19',confirmation=true,saved;
const context=vm.createContext({currentUser:{id:'u1'},dataReady:true,supabaseDataLoaded:true,
 data:{alerts:[{id:'email-1',subject:'Old email alert',snoozedUntil:'2030-01-01'}],dailyTasks:[{id:'t1',title:'Finish video',taskDate:day}],clientTasks:[],walletEntries:[],subscriptions:[],applications:[{id:'c1',status:'Active client',contractEndDate:'2026-11-02'}]},
 today:()=>day,dateKey:value=>String(value||'').slice(0,10),plural:(n,s)=>n+' '+s,persist:async()=>{saved=JSON.parse(JSON.stringify(context.data));return true;},
 $:()=>({textContent:'',classList:{contains:()=>true}}),appConfirm:async()=>confirmation,renderAlerts(){},renderAll(){}});
vm.runInContext(source.slice(0,source.indexOf('  function notificationCategory(')),context);
vm.runInContext(source.slice(source.indexOf('  async function clearAlerts(')),context);
vm.runInContext(source.slice(source.indexOf('  function handleNotificationAction('),source.indexOf('  function handleNotificationKeydown(')),context);
(async()=>{
 context.refreshGeneratedNotifications();assert.equal(context.data.alerts.length,3);
 await context.clearAlerts();assert.equal(context.data.alerts.length,0);assert.equal(context.data.clearedNotificationKeys.length,3);assert.equal(saved.alerts.length,0);
 assert.equal(context.data.dailyTasks[0].completedAt,undefined,'Clearing notifications does not complete the task');
 day='2026-10-26';context.data=JSON.parse(JSON.stringify(saved));context.refreshGeneratedNotifications();assert.equal(context.data.alerts.length,0,'A week later, overdue tasks and contract thresholds stay deleted');
 context.data.alerts.push({id:'task-overdue|daily-task:t1|2026-10-19',type:'task-overdue'},{id:'email-1',subject:'Old stale alert'});context.refreshGeneratedNotifications();assert.equal(context.data.alerts.length,0,'Stale regenerated copies are suppressed');
 context.data.alerts=[{id:'email-2',subject:'New email'}];context.handleNotificationAction('email-2','dismiss');assert.equal(context.data.alerts.length,0);
 context.data.alerts=[{id:'email-2',subject:'Recreated'}];context.limitAlertHistory();assert.equal(context.data.alerts.length,0,'Dismiss survives history pruning');
 context.data.dailyTasks[0].taskDate='2026-10-26';context.refreshGeneratedNotifications();assert.equal(context.data.alerts.length,1,'A newly scheduled date is a new event');
 confirmation=false;await context.clearAlerts();assert.equal(context.data.alerts.length,1,'Cancel never deletes');
 console.log('Permanent notification clear passed: cloud marker persistence, week rollover, urgency changes, stale copies, individual dismissal, new events and cancellation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
