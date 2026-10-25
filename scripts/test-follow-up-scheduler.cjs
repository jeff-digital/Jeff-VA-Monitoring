const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/frontend/js/modules/03b-notifications-and-reminders.js','utf8');
const handlers = {}, documentHandlers = {};
let tick, checks = 0;
const context=vm.createContext({
  window: { addEventListener: (type, fn) => { handlers[type] = fn; } },
  document: { visibilityState: 'visible', addEventListener: (type, fn) => { documentHandlers[type] = fn; } },
  currentUser: { id: 'user' }, dataReady: true, supabaseDataLoaded: true, navigator: { onLine: true },
  notificationRefreshTimer: null, activeView: 'applications', renderAlerts() {}, renderSubscriptions() {},
  processDueFollowUps: async () => { checks++; }, console,
  setInterval: (fn, delay) => { assert.equal(delay, 60000); tick = fn; return 1; }
});
vm.runInContext(source.slice(source.indexOf('  function checkAutomaticFollowUps('),source.indexOf('  function stopNotificationRefreshTimer(')),context);
context.startNotificationRefreshTimer();
tick(); assert.equal(checks,1,'Timer checks follow-ups independently of Gmail sync');
handlers.focus(); handlers.online(); documentHandlers.visibilitychange();
assert.equal(checks,4,'Returning to the app or regaining network checks due follow-ups');
context.navigator.onLine=false; handlers.focus(); assert.equal(checks,4);
context.navigator.onLine=true; context.currentUser=null; tick(); assert.equal(checks,4);
context.currentUser={ id:'user' }; context.dataReady=false; tick(); assert.equal(checks,4);
console.log('Follow-up scheduling passed: minute timer, focus, reconnection, visibility, offline, sign-out and startup guards.');
