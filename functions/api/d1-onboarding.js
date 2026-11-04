import {d1Table,d1Revision} from './d1-workspace.js';
const appTable=d1Table('applications');
const activeSql=`EXISTS(SELECT 1 FROM ${appTable} a WHERE a.user_id=i.user_id AND a.id=i.client_id AND json_extract(a.payload,'$.status')='Active client')`;
const text=(value,max,required=false)=>typeof value==='string' && value.length<=max && (!required || value.trim().length>0);
function validSubmission(p) {
  if(!text(p.p_contact_name,160,true) || !text(p.p_phone||'',64) || !text(p.p_timezone,120,true) || !text(p.p_availability,2000,true) || !text(p.p_tools||'',2000) || !text(p.p_priorities,2000,true)) return false;
  try {new Intl.DateTimeFormat('en',{timeZone:p.p_timezone});} catch{return false;}
  const d=p.p_details;
  if(!d || Array.isArray(d) || !text(d.companyName,160,true) || !text(d.role || '',120) || !Array.isArray(d.services) || !d.services.length || d.services.length>7 || !d.services.every(value=>['Inbox management','Scheduling','General admin','Social media','Research','Bookkeeping','Other'].includes(value))) return false;
  if(!['Under 10 hours','10–20 hours','20–30 hours','30–40 hours','40+ hours'].includes(d.hoursPerWeek) || !['Slack','WhatsApp','Telegram','Email'].includes(d.preferredChannel) || d.agreement!==true) return false;
  if(d.startDate) {try {if(!/^\d{4}-\d{2}-\d{2}$/.test(d.startDate) || new Date(d.startDate+'T12:00:00Z').toISOString().slice(0,10)!==d.startDate) return false;} catch{return false;}}
  if(!['','Within 1 hour','Within the same business day','Within 24 hours','Within 2 business days'].includes(d.responseTime || '') || !['','Password manager','Delegated/shared access','Discuss on kickoff call'].includes(d.accessMethod || '')) return false;
  if(!text(d.blackoutDates||'',1000) || !text(d.backupName||'',120) || !text(d.backupEmail||'',254) || !text(d.backupPhone||'',32) || !text(d.approval||'',1000)) return false;
  if(d.backupEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.backupEmail)) return false;
  if((d.backupName || d.backupEmail || d.backupPhone) && (!d.backupName || (!d.backupEmail && !d.backupPhone))) return false;
  if(d.backupPhone && (!/^[0-9][0-9 ().+/-]*$/.test(d.backupPhone) || !/^\d{4,15}$/.test(d.backupPhone.replace(/\D/g,'')))) return false;
  return true;
}
async function recoverLegacy(request,env,user) {
  const db=env.WORKSPACE_DB;
  if(await db.prepare("SELECT name FROM workspace_settings WHERE user_id=? AND name='__onboarding_recovered'").bind(user.id).first()) return;
  const rpc=async(action,parameters)=>{
    const response=await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${action}`,{method:'POST',headers:{authorization:request.headers.get('authorization'),apikey:env.SUPABASE_PUBLISHABLE_KEY,'content-type':'application/json'},body:JSON.stringify(parameters),signal:AbortSignal.timeout(10000)});
    if(!response.ok) throw new Error('Earlier onboarding responses are still in Supabase. Their recovery will retry.');
    return response.json();
  };
  const list=await rpc('get_client_onboarding_submissions',{});
  for(const entry of Array.isArray(list)?list:[]) {
    const value=await rpc('get_client_onboarding_submission',{p_client_id:entry.client_id});
    if(value && (!value.user_id || value.user_id===user.id)) await db.prepare('INSERT OR IGNORE INTO workspace_onboarding_submissions(user_id,client_id,payload) VALUES(?,?,?)').bind(user.id,entry.client_id,JSON.stringify(value)).run();
  }
  await db.prepare("INSERT OR IGNORE INTO workspace_settings(user_id,name,payload) VALUES(?,'__onboarding_recovered','true')").bind(user.id).run();
}
export async function d1Onboarding(request,env,user,action,p) {
  const db=env.WORKSPACE_DB;
  if(!db) throw new Error('D1 is not configured.');
  if(user) {
    if(!await d1Revision(env,user.id)) throw new Error('Import this account into D1 first.');
    if(action==='issue_client_onboarding_invite') {
      const client=await db.prepare(`SELECT payload FROM ${appTable} WHERE user_id=? AND id=? AND json_extract(payload,'$.status')='Active client'`).bind(user.id,p.p_client_id).first();
      if(!client) return false;
      await db.prepare('INSERT INTO workspace_onboarding_invites(user_id,client_id,token_hash,expires_at,submitted_at) VALUES(?,?,?,?,NULL) ON CONFLICT(user_id,client_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,submitted_at=NULL,guard=1').bind(user.id,p.p_client_id,p.p_token_hash,new Date(Date.now()+7*86400000).toISOString()).run();
      return true;
    }
    // Recovery is account-scoped and never erases existing D1 responses.
    await recoverLegacy(request,env,user);
    const rows=await db.prepare(`SELECT s.payload FROM workspace_onboarding_submissions s JOIN ${appTable} a ON a.user_id=s.user_id AND a.id=s.client_id WHERE s.user_id=? AND json_extract(a.payload,'$.status')='Active client'`).bind(user.id).all();
    const values=rows.results.map(row=>JSON.parse(row.payload));
    return action==='get_client_onboarding_submission' ? values.find(item=>item.client_id===p.p_client_id)||null : values.map(({client_id,client_name,client_email,timezone,submitted_at})=>({client_id,client_name,client_email,timezone,submitted_at}));
  }
  const now=new Date().toISOString();
  const invitation=await db.prepare(`SELECT i.*,a.payload FROM workspace_onboarding_invites i JOIN ${appTable} a ON a.user_id=i.user_id AND a.id=i.client_id WHERE i.token_hash=? AND i.submitted_at IS NULL AND i.expires_at>? AND json_extract(a.payload,'$.status')='Active client'`).bind(p.p_token_hash,now).first();
  if(!invitation) return action==='lookup_client_onboarding_invite'?null:false;
  const client=JSON.parse(invitation.payload);
  if(action==='lookup_client_onboarding_invite') return {client_name:client.clientName,client_email:client.email};
  if(!validSubmission(p)) throw Object.assign(new Error('Check the required fields and their maximum lengths.'),{status:400});
  const value={user_id:invitation.user_id,client_id:invitation.client_id,client_name:client.clientName,client_email:client.email,contact_name:p.p_contact_name.trim(),phone:(p.p_phone||'').trim(),timezone:p.p_timezone,availability:p.p_availability,tools:p.p_tools||'',priorities:p.p_priorities,details:p.p_details,submitted_at:now};
  try {
    const results=await db.batch([
      db.prepare(`UPDATE workspace_onboarding_invites AS i SET guard=CASE WHEN submitted_at IS NULL AND expires_at>? AND ${activeSql} THEN 1 ELSE 0 END WHERE token_hash=?`).bind(now,p.p_token_hash),
      db.prepare(`INSERT INTO workspace_onboarding_submissions(user_id,client_id,payload) SELECT user_id,client_id,? FROM workspace_onboarding_invites i WHERE token_hash=? AND submitted_at IS NULL AND expires_at>? AND ${activeSql} ON CONFLICT(user_id,client_id) DO UPDATE SET payload=excluded.payload`).bind(JSON.stringify(value),p.p_token_hash,now),
      db.prepare('UPDATE workspace_onboarding_invites SET submitted_at=? WHERE token_hash=? AND submitted_at IS NULL').bind(now,p.p_token_hash)
    ]);
    return results[1].meta.changes===1;
  } catch(error) {if(/guard|CHECK constraint/i.test(error.message)) return false;throw error;}
}
