const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/frontend/js/modules/01-core.js','utf8');
let outcome, signouts=0, attempts=0, deletes=0, expiry;
const nodes = new Map();
const $ = key => { if (!nodes.has(key)) nodes.set(key,{ hidden:false,open:true }); return nodes.get(key); };
const context = vm.createContext({ $, clearTimeout:()=>{}, setTimeout:fn=>{expiry=fn;return 1;}, data:{applications:[],personalDocuments:[]},emptyData:()=>({}),supabaseDataLoaded:true,
 supabaseClient:{from:()=>({delete:()=>({eq:async(field,id)=>{assert.equal(id,'owner');deletes++;return {};}})})},
 currentUser:{id:'owner',email:'owner@example.com'}, userHasPasswordIdentity:()=>true,
 window:{SUPABASE_URL:'test',SUPABASE_ANON_KEY:'test',supabase:{createClient:(url,key,options)=>{
 assert.equal(options.auth.persistSession,false); assert.equal(options.auth.autoRefreshToken,false);
 return {auth:{signInWithPassword:async credentials=>{attempts++;assert.equal(credentials.email,'owner@example.com');return outcome;},signOut:async()=>{signouts++;}}};
 }}}});
vm.runInContext(source.slice(source.indexOf('  async function verifyPasswordForDataClear('),source.indexOf('  function escapeHtml(')),context);
(async()=>{
 await assert.rejects(context.verifyPasswordForDataClear(''),/Enter/);assert.equal(attempts,0);
 outcome={error:{message:'invalid'}};await assert.rejects(context.verifyPasswordForDataClear('wrong'),/verified/);
 outcome={data:{user:{id:'other'}}};await assert.rejects(context.verifyPasswordForDataClear('password'),/verified/);
 outcome={data:{user:{id:'owner'}}};assert.equal(await context.verifyPasswordForDataClear('password'),'owner');
 context.userHasPasswordIdentity=()=>false;await assert.rejects(context.verifyPasswordForDataClear('password'),/Enter/);
 assert.equal(attempts,3);assert.equal(signouts,3);
 context.userHasPasswordIdentity=()=>true;
 context.lockWorkspaceDataControls();assert.equal($('#clearDataButton').hidden,true);
 await assert.rejects(context.clearSupabaseData(),/Unlock/);assert.equal(deletes,0);
 await context.unlockWorkspaceDataControls('password');assert.equal($('#clearDataButton').hidden,false);assert.equal(deletes,0,'Verification never deletes data');
 expiry();assert.equal($('#clearDataButton').hidden,true);await assert.rejects(context.clearSupabaseData(),/Unlock/);
 await context.unlockWorkspaceDataControls('password');context.currentUser={id:'other'};await assert.rejects(context.clearSupabaseData(),/Unlock/);assert.equal(deletes,0);
 context.currentUser={id:'owner',email:'owner@example.com'};await context.unlockWorkspaceDataControls('password');await context.clearSupabaseData();assert.equal(deletes,1);
 await assert.rejects(context.clearSupabaseData(),/Unlock/);assert.equal(deletes,1,'Unlock is consumed once');
 console.log('Clear data guard passed: password validation, isolated session, reveal without deletion, timed relock, account isolation and single-use authorization.');
})().catch(error=>{console.error(error);process.exitCode=1;});
