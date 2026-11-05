import fs from 'node:fs';
import assert from 'node:assert/strict';
import worker from '../src/backend/worker.mjs';
import {sqliteD1} from './lib/sqlite-d1.mjs';
import {MemoryStorage} from './lib/memory-durable.mjs';
import {coordinateFileMigration,runFileMigration} from '../functions/api/file-migration.js';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const db=sqliteD1(fs.readFileSync('src/backend/d1/0002-private-files.sql','utf8'));
const objects=new Map(),legacy=new Map([[owner+'/old.pdf',new TextEncoder().encode('legacy PDF')],[owner+'/gone.pdf',new Uint8Array([1])]]);
const bucket={
 async head(key){const item=objects.get(key);return item?{size:item.bytes.length,httpMetadata:item.httpMetadata}:null;},
 async get(key){const item=objects.get(key);return item?{size:item.bytes.length,body:new Blob([item.bytes]).stream(),httpMetadata:item.httpMetadata}:null;},
 async put(key,body,options={}){if(options.onlyIf && objects.has(key))return null;const bytes=typeof body==='string'?new TextEncoder().encode(body):new Uint8Array(body);if(options.sha256)assert.deepEqual(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),new Uint8Array(options.sha256),'R2 validates the transferred bytes');objects.set(key,{bytes,httpMetadata:options.httpMetadata});return {size:bytes.length};},
 async delete(key){objects.delete(key);},
 async list({prefix}){return {objects:[...objects].filter(([key])=>key.startsWith(prefix)).map(([key,value])=>({key,size:value.bytes.length})),truncated:false};}
};
const env={WORKSPACE_FILES:bucket,WORKSPACE_DB:db,SUPABASE_URL:'https://auth.test',SUPABASE_PUBLISHABLE_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'server-secret'};
const originalFetch=globalThis.fetch;let sourceReads=0;
globalThis.fetch=async(input,options)=>{
 const url=String(input);
 if(url.endsWith('/auth/v1/user'))return options.headers.authorization==='Bearer invalid'?new Response('',{status:401}):Response.json({id:options.headers.authorization==='Bearer other'?other:owner});
 if(url.endsWith('/storage/v1/object/list/client-documents')){
  assert.equal(options.headers.authorization,'Bearer server-secret');const {prefix}=JSON.parse(options.body);
  return Response.json(prefix===''?[{name:owner,id:null,metadata:null}]:[{name:'old.pdf',id:'old',metadata:{size:10}},{name:'gone.pdf',id:'gone',metadata:{size:1}}]);
 }
 if(url.includes('/storage/v1/object/authenticated/client-documents/')){
  assert.notEqual(options.method,'DELETE','Migration never deletes originals');
  const path=decodeURIComponent(url.split('/client-documents/')[1]);
  if(options.headers.authorization!=='Bearer server-secret'){assert(path.startsWith(owner+'/'));assert.equal(options.headers.apikey,'public');}
  sourceReads++;return legacy.has(path)?new Response(legacy.get(path),{headers:{'content-type':'application/pdf'}}):new Response('',{status:404});
 }
 throw new Error('Unexpected network request');
};
const call=(method,path,body=null,token='owner',headers={})=>worker.fetch(new Request('https://app.test/api/files?'+new URLSearchParams(path),{method,headers:{origin:'https://app.test',...(token?{authorization:`Bearer ${token}`}:{}) ,...headers},...(body?{body}: {})}),env,{});
try {
 assert.equal((await call('GET',{path:owner+'/old.pdf'},null,'')).status,401);
 assert.equal((await call('GET',{path:owner+'/old.pdf'},null,'other')).status,400);
 for(const path of [owner+'/../other.pdf',owner+'/%2e%2e/secret',owner+'/a\\b'])assert.equal((await call('GET',{path})).status,400);
 assert.equal((await call('PUT',{path:owner+'/new.pdf'},'new PDF','owner',{'content-type':'application/pdf'})).status,201);
 assert.equal((await call('PUT',{path:owner+'/new.pdf'},'replacement','owner',{'content-type':'application/pdf'})).status,409);
 assert.equal((await call('PUT',{path:owner+'/bad.html'},'<script>','owner',{'content-type':'text/html'})).status,415);
 assert.equal((await call('PUT',{path:owner+'/large.pdf'},'x','owner',{'content-type':'application/pdf','content-length':String(26*1024*1024)})).status,413);
 const restored=await call('GET',{path:owner+'/old.pdf'});assert.equal(await restored.text(),'legacy PDF');assert.equal(restored.headers.get('cache-control'),'private, no-store');assert.equal(restored.headers.get('content-disposition'),'attachment');
 const reads=sourceReads;assert.equal(await(await call('GET',{path:owner+'/old.pdf'})).text(),'legacy PDF');assert.equal(sourceReads,reads,'R2 reads stop repeated Supabase transfers');
 await call('DELETE',{path:owner+'/gone.pdf'});assert.equal((await call('GET',{path:owner+'/gone.pdf'})).status,404);assert.equal(sourceReads,reads,'Deleted legacy files cannot be resurrected');
 assert.equal((await(await call('GET',{action:'usage'})).json()).count,2);assert.equal((await(await call('GET',{action:'usage'},null,'other')).json()).count,0);
 const storage=new MemoryStorage();storage.setAlarm=async()=>{};
 await coordinateFileMigration(storage);
 for(let i=0;i<10;i++){await runFileMigration(storage,env);if(JSON.parse(new TextDecoder().decode(objects.get('_system/migration-v1.json').bytes)).done)break;}
 const report=JSON.parse(new TextDecoder().decode(objects.get('_system/migration-v1.json').bytes));assert(report.done);assert.equal(report.failures.length,0);assert.equal(report.skipped,1);assert.equal(legacy.size,2);
 console.log('PASS private files: authenticated ownership, traversal blocking, immutable uploads, sizes/types, private downloads, legacy copy/checksum, no repeated source downloads, deletion tombstones, usage isolation and background migration.');
} finally {globalThis.fetch=originalFetch;db.sqlite.close();}
