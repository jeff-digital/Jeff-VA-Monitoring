import {applyD1Changes,readD1Workspace,d1Revision,d1Table} from './d1-workspace.js';
export async function d1FollowUpSchedules(env,userId,applicationId=null) {
  if(!await d1Revision(env,userId)) throw new Error('Import this account into D1 before background sending can resume.');
  const statement=applicationId ? env.WORKSPACE_DB.prepare(`SELECT payload FROM ${d1Table('applications')} WHERE user_id=? AND id=?`).bind(userId,applicationId)
    : env.WORKSPACE_DB.prepare(`SELECT payload FROM ${d1Table('applications')} WHERE user_id=? AND json_extract(payload,'$.automaticFollowUp')=1 AND COALESCE(json_extract(payload,'$.followUpDate'),'')<>''`).bind(userId);
  return {applications:(await statement.all()).results.map(row=>JSON.parse(row.payload))};
}
export async function saveD1FollowUpReceipt(env,userId,receipt,checkOnly=false) {
  if(!await d1Revision(env,userId)) throw new Error('Import this account into D1 before background sending can resume.');
  if(checkOnly) return;
  const loaded=await readD1Workspace(env,userId,['applications','emails','alerts']);
  const state=loaded.data, app=state.applications.find(item=>item.id===receipt.applicationId);
  if(!app) return;
  const changes=[];
  if(app.followUpDate===receipt.scheduledDate) changes.push({key:'applications',type:'put',id:app.id,base:app,value:{...app,followUpSentAt:receipt.sentAt,followUpGmailId:receipt.gmailId || '',followUpProcessedAt:receipt.sentAt,followUpDate:'',automaticFollowUp:false}});
  const emailId=`background-follow-up|${app.id}|${receipt.scheduledDate}`;
  if(!state.emails.some(item=>item.id===emailId || (receipt.gmailId && item.gmailId===receipt.gmailId))) changes.push({key:'emails',type:'put',id:emailId,base:null,value:{id:emailId,gmailId:receipt.gmailId || '',applicationId:app.id,emailType:'follow-up',from:'You',to:receipt.recipient,subject:receipt.subject,body:receipt.body,date:receipt.sentAt,importedAt:new Date().toISOString(),source:'gmail',direction:'sent'},beforeId:state.emails[0]?.id || null});
  const alertId=`follow-up|${app.id}|${receipt.scheduledDate}`, previous=state.alerts.find(item=>item.id===alertId);
  if(previous?.deliveryStatus!=='sent') changes.push({key:'alerts',type:'put',id:alertId,base:previous || null,value:{id:alertId,clientName:app.clientName,subject:'Automatic follow-up sent: '+receipt.subject,from:'Jeff VA',date:receipt.sentAt,deliveryStatus:'sent',deliveryReason:'',unread:true},beforeId:state.alerts[0]?.id || null});
  if(changes.length) await applyD1Changes(env,userId,changes);
}
