import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sqliteD1 } from './lib/sqlite-d1.mjs';
import { prepareImport } from './prepare-d1-import.mjs';
import { readD1Workspace,applyD1Changes,d1Table,D1_COLLECTIONS,ensureD1Account,importD1Account } from '../functions/api/d1-workspace.js';
const db=sqliteD1(fs.readFileSync('src/backend/d1/0001-workspace.sql','utf8'));
const userId='11111111-1111-4111-8111-111111111111';
const data={ applications:[{id:'a',title:'Before'},{id:'b',title:'Other'}],emails:[{id:'mail',body:'private body'}],accountSignInHistory:[{provider:'Google',at:'2026-11-05'}],deletedGmailIds:['deleted'],legacy:{preserve:true},weeklyActivityGoal:5,emailTaskAiUsage:null };
for(const key of D1_COLLECTIONS) data[key] ??= [];
const imported=prepareImport({format:'jeff-va-workspace',version:1,userId,data},'test-digest');
try {
 db.sqlite.exec(imported.sql);
 const env={WORKSPACE_DB:db};
 await importD1Account(env,'new-owner',data);
 assert.deepEqual((await readD1Workspace(env,'new-owner')).data,data);
 await importD1Account(env,'new-owner',{applications:[]});
 assert.deepEqual((await readD1Workspace(env,'new-owner')).data,data,'A later import cannot overwrite a ready account');
 const originalFetch=globalThis.fetch;
 try {
  globalThis.fetch=async()=>Response.json([{data}]);
  await ensureD1Account(new Request('https://app.test',{headers:{authorization:'Bearer owner'}}),{...env,SUPABASE_URL:'https://auth.test'}, {id:'legacy-owner'});
  assert.deepEqual((await readD1Workspace(env,'legacy-owner')).data,data);
  globalThis.fetch=async()=>new Response('',{status:503});
  await assert.rejects(()=>ensureD1Account(new Request('https://app.test'),{...env,SUPABASE_URL:'https://auth.test'}, {id:'failed-owner'}));
  assert.equal(await readD1Workspace(env,'failed-owner'),null,'Failed migrations never create empty replacements');
 } finally {globalThis.fetch=originalFetch;}
 let loaded=await readD1Workspace(env,userId);
 assert.equal(loaded.data.emails[0].body,'private body');
 assert.deepEqual(loaded.data.accountSignInHistory,data.accountSignInHistory);
 assert.deepEqual(loaded.data.legacy,data.legacy);
 assert.equal(await readD1Workspace(env,'other'),null);
 await applyD1Changes(env,userId,[{key:'applications',type:'put',id:'a',base:data.applications[0],value:{id:'a',title:'After'}}]);
 await applyD1Changes(env,userId,[{key:'applications',type:'put',id:'b',base:data.applications[1],value:{id:'b',title:'Edited independently'}}]);
 assert.equal((await readD1Workspace(env,userId)).data.applications[0].title,'After');
 await assert.rejects(applyD1Changes(env,userId,[{key:'applications',type:'put',id:'a',base:data.applications[0],value:{id:'a',title:'Stale'}}]),error=>error.status===409);
 await applyD1Changes(env,userId,[{key:'applications',type:'put',id:'a',base:data.applications[0],value:{id:'a',title:'After'}}]);
 await applyD1Changes(env,userId,[{key:'applications',type:'put',id:'new',base:null,value:{id:'new'},beforeId:'a'}]);
 assert.deepEqual((await readD1Workspace(env,userId)).data.applications.map(item=>item.id),['new','a','b']);
 await applyD1Changes(env,userId,[{key:'applications',type:'order',base:[],value:['b','new','a']}]);
 assert.deepEqual((await readD1Workspace(env,userId)).data.applications.map(item=>item.id),['b','new','a']);
 db.sqlite.exec(imported.sql);
 assert.equal((await readD1Workspace(env,userId)).data.applications[2].title,'After','An old import cannot overwrite a ready account');
 // Force a competing revision between the read and the atomic write batch.
 const competing={...db,async batch(statements){ if(statements[0]?.sql.startsWith('UPDATE workspace_accounts SET guard=')) db.sqlite.prepare('UPDATE workspace_accounts SET revision=? WHERE user_id=?').run('competing-revision',userId); return db.batch(statements); }};
 await assert.rejects(applyD1Changes({WORKSPACE_DB:competing},userId,[{key:'dailyTasks',type:'put',id:'task',base:null,value:{id:'task'}}]),error=>error.status===409);
 assert.equal(db.sqlite.prepare(`SELECT COUNT(*) as n FROM ${d1Table('dailyTasks')} WHERE user_id=?`).get(userId).n,0,'Revision conflict rolls the entire batch back');
 console.log('PASS D1: schema, private import, separate tables, legacy fields, record ordering, account isolation, safe replay, conflicts and atomic rollback.');
} finally {db.sqlite.close();}
