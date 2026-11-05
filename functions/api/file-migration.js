import {copyLegacyFile,validFilePath,fileDeleted} from './files.js';
const KEY='private-file-migration-v1';
export async function startFileMigration(env) {
  if(!env.WORKSPACE_FILES || !env.SUPABASE_SERVICE_ROLE_KEY || !env.FOLLOW_UP_DELIVERIES)return;
  const id=env.FOLLOW_UP_DELIVERIES.idFromName(KEY);
  await env.FOLLOW_UP_DELIVERIES.get(id).fetch(new Request('https://internal/file-migration',{method:'POST',body:'{}'}));
}
export async function coordinateFileMigration(storage) {
  let state=await storage.get(KEY);
  if(!state){state={folders:[{path:'',offset:0}],files:[],copied:0,skipped:0,failures:[],done:false};await storage.put(KEY,state);}
  if(!state.done)await storage.setAlarm(Date.now()+1000);
  return Response.json({started:!state.done,done:state.done,copied:state.copied,failed:state.failures.length});
}
export async function runFileMigration(storage,env) {
  const state=await storage.get(KEY);if(!state || state.done)return false;
  try {
    if(state.files.length) {
      const path=state.files[0],owner=path.split('/')[0];
      if(!validFilePath(path,owner) || !/^[a-f0-9-]{36}$/i.test(owner) || await fileDeleted(env,path))state.skipped++;
      else {await copyLegacyFile(env,path,`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);state.copied++;}
      state.files.shift();state.retries=0;
    } else if(state.folders.length) {
      const folder=state.folders[0];
      const result=await fetch(`${env.SUPABASE_URL}/storage/v1/object/list/client-documents`,{method:'POST',headers:{authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,apikey:env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json'},body:JSON.stringify({prefix:folder.path,limit:100,offset:folder.offset,sortBy:{column:'name',order:'asc'}}),signal:AbortSignal.timeout(30000)});
      if(!result.ok)throw new Error('Source listing unavailable');
      const entries=await result.json();if(!Array.isArray(entries))throw new Error('Invalid source listing');
      for(const entry of entries){
        if(typeof entry.name!=='string' || entry.name.includes('/') || entry.name==='.' || entry.name==='..')continue;
        const path=folder.path?folder.path+'/'+entry.name:entry.name;
        if(!folder.path && !/^[a-f0-9-]{36}$/i.test(path))continue;
        if(entry.id===null && entry.metadata===null)state.folders.push({path,offset:0});
        else state.files.push(path);
      }
      folder.offset+=entries.length;if(entries.length<100)state.folders.shift();state.retries=0;
    }
    state.done=!state.files.length && !state.folders.length;
    state.updatedAt=new Date().toISOString();
  } catch {
    state.retries=(state.retries||0)+1;
    if(state.retries>=5){state.failures.push({path:state.files[0] || state.folders[0]?.path || '',at:new Date().toISOString()});if(state.files.length)state.files.shift();else state.folders.shift();state.retries=0;}
  }
  await storage.put(KEY,state);
  await env.WORKSPACE_FILES.put('_system/migration-v1.json',JSON.stringify({done:state.done,copied:state.copied,skipped:state.skipped,failures:state.failures,updatedAt:state.updatedAt}),{httpMetadata:{contentType:'application/json'}});
  if(!state.done)await storage.setAlarm(Date.now()+(state.retries?60000:2000));
  return true;
}
