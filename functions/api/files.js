export const MAX_FILE_BYTES=25*1024*1024;
const TYPES=new Set(['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png','image/webp','application/octet-stream']);
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'private, no-store'}});
export function validFilePath(path,userId) {
  return typeof path==='string' && path.startsWith(userId+'/') && path.length<=1024 && !/[\\%?#\x00-\x1f\x7f]/.test(path) && path.split('/').every(part=>part && part!=='.' && part!=='..' && part.length<=255);
}
export async function fileDeleted(env,path) {
  return Boolean(await env.WORKSPACE_DB.prepare('SELECT 1 FROM workspace_file_deletions WHERE user_id=? AND path=?').bind(path.split('/')[0],path).first());
}
async function boundedBytes(body) {
  if(!body) throw Object.assign(new Error('Empty upload.'),{status:400});
  const reader=body.getReader(),chunks=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_FILE_BYTES){await reader.cancel();throw Object.assign(new Error('Files must be 25 MB or smaller.'),{status:413});}chunks.push(value);}
  if(!size)throw Object.assign(new Error('Empty upload.'),{status:400});
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
export async function copyLegacyFile(env,path,authorization) {
  if(await fileDeleted(env,path))return null;
  const existing=await env.WORKSPACE_FILES.head(path);if(existing)return existing;
  const source=await fetch(`${env.SUPABASE_URL}/storage/v1/object/authenticated/client-documents/${path.split('/').map(encodeURIComponent).join('/')}`,{
    headers:{authorization,apikey:authorization===`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`?env.SUPABASE_SERVICE_ROLE_KEY:env.SUPABASE_PUBLISHABLE_KEY},signal:AbortSignal.timeout(60000)
  });
  if(!source.ok)throw Object.assign(new Error('The original file could not be copied. It remains in Supabase.'),{status:source.status===404?404:503});
  const bytes=await boundedBytes(source.body),sha256=await crypto.subtle.digest('SHA-256',bytes);
  const type=source.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
  const result=await env.WORKSPACE_FILES.put(path,bytes,{onlyIf:{etagDoesNotMatch:'*'},sha256,httpMetadata:{contentType:TYPES.has(type)?type:'application/octet-stream'},customMetadata:{migratedFrom:'supabase'}});
  if(await fileDeleted(env,path)){await env.WORKSPACE_FILES.delete(path);return null;}
  const checked=result || await env.WORKSPACE_FILES.head(path);
  if(!checked || checked.size!==bytes.length)throw new Error('File verification failed; the original was retained.');
  return checked;
}
export async function fileStorage(request,env,user) {
  if(!env.WORKSPACE_FILES || !env.WORKSPACE_DB)return json({error:'Private file storage is not configured.'},503);
  const url=new URL(request.url),origin=request.headers.get('origin');
  if(origin && origin!==url.origin)return json({error:'Origin not allowed.'},403);
  try {
    if(url.searchParams.get('action')==='usage' && request.method==='GET') {
      let cursor,bytes=0,count=0;
      const deleted=new Set((await env.WORKSPACE_DB.prepare('SELECT path FROM workspace_file_deletions WHERE user_id=?').bind(user.id).all()).results.map(row=>row.path));
      do {const page=await env.WORKSPACE_FILES.list({prefix:user.id+'/',cursor,limit:1000});for(const object of page.objects)if(!deleted.has(object.key)){bytes+=object.size;count++;}cursor=page.truncated?page.cursor:undefined;}while(cursor);
      return json({provider:'r2',bytes,count});
    }
    const path=url.searchParams.get('path');if(!validFilePath(path,user.id))return json({error:'Invalid file path for this account.'},400);
    if(request.method==='DELETE') {
      await env.WORKSPACE_DB.prepare('INSERT INTO workspace_file_deletions(user_id,path,deleted_at) VALUES(?,?,?) ON CONFLICT(user_id,path) DO NOTHING').bind(user.id,path,new Date().toISOString()).run();
      await env.WORKSPACE_FILES.delete(path);return json({deleted:true});
    }
    if(await fileDeleted(env,path))return json({error:'File not found.'},404);
    if(request.method==='PUT') {
      const type=request.headers.get('content-type')?.split(';')[0];if(!TYPES.has(type))return json({error:'Unsupported file type.'},415);
      if(Number(request.headers.get('content-length'))>MAX_FILE_BYTES)return json({error:'Files must be 25 MB or smaller.'},413);
      const bytes=await boundedBytes(request.body);
      const saved=await env.WORKSPACE_FILES.put(path,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:type},sha256:await crypto.subtle.digest('SHA-256',bytes)});
      if(!saved)return json({error:'A file already exists at this path.'},409);
      if(await fileDeleted(env,path)){await env.WORKSPACE_FILES.delete(path);return json({error:'This file was deleted while uploading.'},409);}
      return json({path,size:saved.size,provider:'r2'},201);
    }
    let object=await env.WORKSPACE_FILES.get(path);
    if(!object){await copyLegacyFile(env,path,request.headers.get('authorization'));object=await env.WORKSPACE_FILES.get(path);}
    if(!object || await fileDeleted(env,path))return json({error:'File not found.'},404);
    return new Response(object.body,{headers:{'content-type':object.httpMetadata?.contentType || 'application/octet-stream','content-length':String(object.size),'content-disposition':'attachment','cache-control':'private, no-store','x-content-type-options':'nosniff'}});
  } catch(error) {return json({error:error.status?error.message:'File storage is temporarily unavailable. Existing originals have been retained.'},error.status || 503);}
}
