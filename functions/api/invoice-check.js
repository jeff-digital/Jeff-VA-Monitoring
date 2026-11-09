import InvoiceEngine from '../../src/frontend/js/invoice-engine.js';
import {d1Enabled, readD1Workspace} from './d1-workspace.js';

export function invoiceDraftStatus(request, env) {
  return Response.json({automaticReady:d1Enabled(env) && Boolean(env.WORKSPACE_DB) && env.INVOICE_DRAFTS_SCHEDULED === 'true', draftOnly:true},
    {headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
}

// Invoice drafts share the existing account-scoped invoice store, but are not sent
// invoices, payments or Gmail jobs. A revision guard makes the two inserts atomic.
export async function insertScheduledInvoice(env, owner, revision, draft) {
  const db=env.WORKSPACE_DB, alert=InvoiceEngine.readyAlert(draft);
  await db.batch([
    db.prepare('UPDATE workspace_accounts SET guard=CASE WHEN revision=? AND ready=1 THEN 1 ELSE 0 END WHERE user_id=?').bind(revision,owner),
    db.prepare('INSERT INTO workspace_invoices(user_id,id,position,payload) VALUES(?,?,(SELECT COALESCE(MIN(position),0)-1 FROM workspace_invoices WHERE user_id=?),?)').bind(owner,draft.id,owner,JSON.stringify(draft)),
    db.prepare('INSERT INTO workspace_alerts(user_id,id,position,payload) VALUES(?,?,(SELECT COALESCE(MIN(position),0)-1 FROM workspace_alerts WHERE user_id=?),?)').bind(owner,alert.id,owner,JSON.stringify(alert)),
    db.prepare('UPDATE workspace_accounts SET revision=? WHERE user_id=?').bind(crypto.randomUUID(),owner)
  ]);
}

export async function runInvoiceDrafts(env, now = new Date().toISOString()) {
  if(!d1Enabled(env) || !env.WORKSPACE_DB || env.INVOICE_DRAFTS_SCHEDULED !== 'true') return {created:0,skipped:0,failed:0};
  const db=env.WORKSPACE_DB, summary={created:0,skipped:0,failed:0};
  // Keyset pagination avoids an unbounded tenant scan and never uses an auth token.
  let afterOwner='',afterId='';
  for(let page=0;page<100;page++) {
    const batch=await db.prepare("SELECT user_id,id FROM workspace_applications WHERE json_extract(payload,'$.invoiceSettings.schedule.enabled')=1 AND (user_id>? OR (user_id=? AND id>?)) ORDER BY user_id,id LIMIT 50").bind(afterOwner,afterOwner,afterId).all();
    if(!batch.results.length) break;
    for(const row of batch.results) {
      afterOwner=row.user_id;afterId=row.id;
      let finished=false;
      for(let attempt=0;attempt<3 && !finished;attempt++) {
        try {
          const snapshot=await readD1Workspace(env,row.user_id,['applications','clientTasks','invoices','alerts']);
          const client=snapshot?.data.applications.find(client=>client.id===row.id);
          if(!client || !client.invoiceSettings?.schedule?.enabled) {summary.skipped++;break;}
          const start=InvoiceEngine.dueWeek(client.invoiceSettings,now);
          if(!start) {summary.skipped++;break;}
          const id=await InvoiceEngine.draftId(client.id,start);
          const existing=snapshot.data.invoices.some(invoice=>invoice.id===id || invoice.clientId===client.id && invoice.startDate===start && invoice.endDate===InvoiceEngine.addDays(start,6));
          if(existing) {summary.skipped++;break;}
          const draft=await InvoiceEngine.generate(client,snapshot.data.clientTasks,client.invoiceSettings,start,now,snapshot.data.invoices);
          await insertScheduledInvoice(env,row.user_id,snapshot.revision,draft);
          summary.created++;finished=true;
        } catch(error) {
          if(['NO_BILLABLE_WORK','INACTIVE_CLIENT'].includes(error.code)) {summary.skipped++;break;}
          if(/guard|CHECK constraint|UNIQUE constraint/i.test(error.message || '') && attempt<2) continue;
          summary.failed++;finished=true;
        }
      }
    }
    if(batch.results.length<50) break;
  }
  return summary;
}
