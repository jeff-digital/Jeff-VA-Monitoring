// D1 adapter: separate collections, account-scoped reads, atomic optimistic saves.
export const D1_COLLECTIONS = Object.freeze(['applications','toApply','dailyTasks','clientTasks','socialTrends','emails','deletedGmailIds','alerts','clearedNotificationKeys','onboardingSubmissionIds','emailTemplates','personalDocuments','invoices','scripts','workLinks','walletEntries','subscriptions','accountSignInHistory']);
export const d1Table = key => {
  if (!D1_COLLECTIONS.includes(key)) throw new Error('Unknown collection');
  return 'workspace_' + key.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
};
export const d1Enabled = env => env.WORKSPACE_BACKEND === 'd1';
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(item => JSON.parse(canonical(item))) : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])) : value);
const equal = (a,b) => canonical(a ?? null) === canonical(b ?? null);
export function d1Rows(values) {
  const ids = new Set();
  const identified = values.every(value => value && typeof value === 'object' && !Array.isArray(value) && typeof value.id === 'string' && value.id && !ids.has(value.id) && ids.add(value.id));
  return values.map((value, index) => ({ id: identified ? value.id : `legacy-row:${index}`, position: index, payload: JSON.stringify(value) }));
}
function dbFor(env) { if (!env.WORKSPACE_DB) throw new Error('D1 database binding WORKSPACE_DB is missing.'); return env.WORKSPACE_DB; }
export async function readD1Workspace(env, userId, keys = null) {
  const db = dbFor(env);
  const collections = keys ? D1_COLLECTIONS.filter(key => keys.includes(key)) : [...D1_COLLECTIONS];
  const results = await db.batch([
    db.prepare('SELECT revision,ready FROM workspace_accounts WHERE user_id=?').bind(userId),
    db.prepare('SELECT name,payload FROM workspace_settings WHERE user_id=?').bind(userId),
    ...collections.map(key => db.prepare(`SELECT id,position,payload FROM ${d1Table(key)} WHERE user_id=? ORDER BY position,id`).bind(userId))
  ]);
  const account = results[0].results[0];
  if (!account?.ready) return null;
  const data = {}, rows = {};
  for (const entry of results[1].results) {
    if (entry.name === '__legacy') Object.assign(data, JSON.parse(entry.payload));
    else if(!entry.name.startsWith('__')) data[entry.name] = JSON.parse(entry.payload);
  }
  collections.forEach((key,index) => { rows[key] = results[index+2].results; data[key] = rows[key].map(row => JSON.parse(row.payload)); });
  return { data, rows, revision: account.revision };
}
export async function d1Revision(env,userId) {
  return (await dbFor(env).prepare('SELECT revision FROM workspace_accounts WHERE user_id=? AND ready=1').bind(userId).first())?.revision || null;
}
export async function createEmptyD1Account(env,userId) {
  const db=dbFor(env), revision=crypto.randomUUID();
  await db.batch([db.prepare('INSERT OR IGNORE INTO workspace_accounts(user_id,revision,ready) VALUES(?,?,1)').bind(userId,revision),
    ...[['weeklyActivityGoal',null],['emailTaskAiUsage',null],['__legacy',{}]].map(([key,value])=>db.prepare('INSERT OR IGNORE INTO workspace_settings(user_id,name,payload) VALUES(?,?,?)').bind(userId,key,JSON.stringify(value)))]);
}
export async function clearD1Workspace(env,userId) {
  const db=dbFor(env);
  await db.batch([...D1_COLLECTIONS.map(key=>db.prepare(`DELETE FROM ${d1Table(key)} WHERE user_id=?`).bind(userId)),
    db.prepare('DELETE FROM workspace_onboarding_invites WHERE user_id=?').bind(userId),
    db.prepare('DELETE FROM workspace_onboarding_submissions WHERE user_id=?').bind(userId),
    db.prepare('DELETE FROM workspace_settings WHERE user_id=?').bind(userId),
    db.prepare('UPDATE workspace_accounts SET revision=? WHERE user_id=?').bind(crypto.randomUUID(),userId)]);
}
export async function ensureD1Account(request,env,user) {
  if (await d1Revision(env,user.id)) return;
  const response=await fetch(`${env.SUPABASE_URL}/rest/v1/app_state?${new URLSearchParams({user_id:`eq.${user.id}`,select:'data,updated_at',limit:'1'})}`,{
    headers:{authorization:request.headers.get('authorization'),apikey:env.SUPABASE_PUBLISHABLE_KEY},signal:AbortSignal.timeout(10000)
  });
  if(!response.ok) throw Object.assign(new Error('Account migration status could not be checked. No empty workspace was created.'),{status:503});
  const records=await response.json();
  if (!records.length) return createEmptyD1Account(env,user.id);
  // Existing users migrate once, through their own verified login and RLS.
  // A failed source read never creates an empty replacement workspace.
  await importD1Account(env,user.id,records[0].data);
}
export async function importD1Account(env,userId,data) {
  if (!data || typeof data!=='object' || Array.isArray(data)) throw new Error('The saved workspace could not be migrated.');
  const db=dbFor(env),revision=crypto.randomUUID();
  const statements=[
    db.prepare('INSERT OR IGNORE INTO workspace_accounts(user_id,revision,ready) VALUES(?,?,0)').bind(userId,revision),
    db.prepare('UPDATE workspace_accounts SET guard=CASE WHEN revision=? AND ready=0 THEN 1 ELSE 0 END WHERE user_id=?').bind(revision,userId)
  ];
  const legacy={...data};
  for(const key of D1_COLLECTIONS) {
    if(data[key]!==undefined && !Array.isArray(data[key])) throw new Error('The saved collection could not be migrated.');
    delete legacy[key];
    for(const row of d1Rows(data[key] || [])) {
      if(new TextEncoder().encode(row.payload).length>1500000) throw new Error('A saved record is too large to migrate automatically. Keep its backup.');
      statements.push(db.prepare(`INSERT INTO ${d1Table(key)}(user_id,id,position,payload) VALUES(?,?,?,?)`).bind(userId,row.id,row.position,row.payload));
    }
  }
  delete legacy.weeklyActivityGoal; delete legacy.emailTaskAiUsage;
  for(const [key,value] of [['weeklyActivityGoal',data.weeklyActivityGoal??null],['emailTaskAiUsage',data.emailTaskAiUsage??null],['__legacy',legacy]]) {
    const payload=JSON.stringify(value);
    if(new TextEncoder().encode(payload).length>1500000) throw new Error('Saved settings are too large to migrate automatically. Keep their backup.');
    statements.push(db.prepare('INSERT INTO workspace_settings(user_id,name,payload) VALUES(?,?,?)').bind(userId,key,payload));
  }
  statements.push(db.prepare('UPDATE workspace_accounts SET ready=1 WHERE user_id=? AND revision=?').bind(userId,revision));
  try {await db.batch(statements);}
  catch(error) {if(await d1Revision(env,userId)) return;throw error;}
}
export async function applyD1Changes(env,userId,changes,clientRevision=undefined) {
  const keys = [...new Set(changes.map(change => change.key))];
  const loaded = await readD1Workspace(env,userId,keys);
  if (!loaded) throw Object.assign(new Error('This account must be imported into D1 before saving.'),{status:409});
  const state = copy(loaded.data);
  for (const change of changes) {
    const current = state[change.key];
    if (change.type === 'set') {
      if (!equal(current,change.base) && !equal(current,change.value)) throw Object.assign(new Error('This collection changed on another device. Refresh before saving.'),{status:409});
      state[change.key] = copy(change.value); continue;
    }
    if (!D1_COLLECTIONS.includes(change.key)) throw new Error('Expected collection');
    const values = state[change.key] || [];
    if (change.type === 'order') {
      const wanted = new Set(change.value), byId = new Map(values.map(value => [value?.id,value]));
      state[change.key] = [...change.value.filter(id => byId.has(id)).map(id => byId.get(id)),...values.filter(value => !wanted.has(value?.id))]; continue;
    }
    const index = values.findIndex(value => value?.id === change.id), previous = index >= 0 ? values[index] : null;
    const next = change.type === 'remove' ? null : change.value;
    if (!equal(previous,change.base) && !equal(previous,next)) throw Object.assign(new Error('This record changed on another device. Refresh before saving.'),{status:409});
    if (change.type === 'remove') state[change.key] = values.filter(value => value?.id !== change.id);
    else if (index >= 0) values[index] = copy(change.value);
    else { const anchor = values.findIndex(value => value?.id === change.beforeId); values.splice(anchor >= 0 ? anchor : values.length,0,copy(change.value)); }
  }
  const db = dbFor(env), revision = crypto.randomUUID();
  const statements = [db.prepare('UPDATE workspace_accounts SET guard=CASE WHEN revision=? AND ready=1 THEN 1 ELSE 0 END WHERE user_id=?').bind(loaded.revision,userId)];
  for (const key of keys) {
    if (!D1_COLLECTIONS.includes(key)) {
      statements.push(db.prepare('INSERT INTO workspace_settings(user_id,name,payload) VALUES(?,?,?) ON CONFLICT(user_id,name) DO UPDATE SET payload=excluded.payload').bind(userId,key,JSON.stringify(state[key]))); continue;
    }
    const previous = new Map((loaded.rows[key] || []).map(row => [row.id,row]));
    const next = d1Rows(state[key] || []), nextIds = new Set(next.map(row => row.id));
    // Preserve stable positions when insertion leaves the existing relative order intact.
    const oldIds = [...previous.keys()].filter(id => nextIds.has(id));
    const shared = next.filter(row => previous.has(row.id)).map(row => row.id);
    const stable = equal(oldIds,shared);
    let last = -Infinity;
    for (let i=0;i<next.length;i++) {
      const row = next[i], old = previous.get(row.id);
      if (stable && old) row.position = old.position;
      else if (stable) {
        const following = next.slice(i+1).map(item => previous.get(item.id)).find(Boolean)?.position;
        row.position = last === -Infinity ? (following ?? next.length) - (next.length-i) : following === undefined ? last+1 : (last+following)/2;
      }
      last = row.position;
    }
    if(next.some((row,index)=>!Number.isFinite(row.position) || (index>0 && row.position<=next[index-1].position))) next.forEach((row,index)=>{row.position=index;});
    for(const row of next) {
      const old=previous.get(row.id);
      if (new TextEncoder().encode(row.payload).length > 1500000) throw new Error('One record exceeds the D1 migration size limit. Keep its backup and split its content first.');
      if (!old || old.payload !== row.payload) statements.push(db.prepare(`INSERT INTO ${d1Table(key)}(user_id,id,position,payload) VALUES(?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET position=excluded.position,payload=excluded.payload`).bind(userId,row.id,row.position,row.payload));
      else if (old.position !== row.position) statements.push(db.prepare(`UPDATE ${d1Table(key)} SET position=? WHERE user_id=? AND id=?`).bind(row.position,userId,row.id));
    }
    for (const id of previous.keys()) if (!nextIds.has(id)) statements.push(db.prepare(`DELETE FROM ${d1Table(key)} WHERE user_id=? AND id=?`).bind(userId,id));
  }
  statements.push(db.prepare('UPDATE workspace_accounts SET revision=? WHERE user_id=?').bind(revision,userId));
  try { await db.batch(statements); }
  catch (error) { if (/guard|CHECK constraint/i.test(error.message)) throw Object.assign(new Error('Workspace changed during saving. Refresh and retry.'),{status:409}); throw error; }
  return { saved:true, revision,refreshNeeded:clientRevision!==undefined && clientRevision!==loaded.revision };
}
