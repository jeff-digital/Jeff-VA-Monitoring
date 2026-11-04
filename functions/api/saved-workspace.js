import {d1Enabled,readD1Workspace} from './d1-workspace.js';
export async function savedWorkspace(request,env,user,keys=null) {
  if(d1Enabled(env)) {
    const loaded=await readD1Workspace(env,user.id,keys);
    if(!loaded) throw new Error('This account must be imported into D1 first.');
    return loaded.data;
  }
  const response=await fetch(`${env.SUPABASE_URL}/rest/v1/app_state?user_id=eq.${encodeURIComponent(user.id)}&select=data&limit=1`,{
    headers:{authorization:request.headers.get('authorization'),apikey:env.SUPABASE_PUBLISHABLE_KEY},signal:AbortSignal.timeout(8000)
  });
  if(!response.ok) throw new Error('Saved records could not be loaded.');
  return (await response.json())?.[0]?.data;
}
