import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { D1_COLLECTIONS,d1Table,d1Rows } from '../functions/api/d1-workspace.js';
const literal = value => "'" + String(value).replaceAll("'","''") + "'";
export function prepareImport(backup, digest) {
  if (backup?.format !== 'jeff-va-workspace' || backup.version !== 1 || !/^[a-f0-9-]{36}$/i.test(backup.userId || '') || !backup.data || Array.isArray(backup.data)) throw new Error('Invalid workspace backup.');
  const owner = literal(backup.userId), importing = literal('importing:'+digest);
  const condition = `EXISTS(SELECT 1 FROM workspace_accounts WHERE user_id=${owner} AND ready=0 AND revision=${importing})`;
  const sql = [`-- Private workspace import. Never commit this file. Resume only with this same backup.`, `INSERT OR IGNORE INTO workspace_accounts(user_id,revision,ready) VALUES(${owner},${importing},0);`];
  const counts = {}, checks = [];
  for (const key of D1_COLLECTIONS) {
    const values = backup.data[key] ?? [];
    if (!Array.isArray(values)) throw new Error(`Invalid collection: ${key}`);
    const rows = d1Rows(values), table = d1Table(key);
    counts[key] = rows.length;
    for (const row of rows) {
      if (Buffer.byteLength(row.payload)>1500000) throw new Error(`A ${key} record must be split before importing.`);
      const statement=`INSERT INTO ${table}(user_id,id,position,payload) SELECT ${owner},${literal(row.id)},${row.position},${literal(row.payload)} WHERE ${condition} ON CONFLICT(user_id,id) DO NOTHING;`;
      if(Buffer.byteLength(statement)>95000) throw new Error(`A ${key} record exceeds D1's SQL-file statement limit; retain the backup and import that record with bound parameters instead.`);
      sql.push(statement);
    }
    checks.push(`(SELECT COUNT(*) FROM ${table} WHERE user_id=${owner})=${rows.length}`);
  }
  const known = new Set([...D1_COLLECTIONS,'weeklyActivityGoal','emailTaskAiUsage']);
  const settings = { weeklyActivityGoal: backup.data.weeklyActivityGoal ?? null, emailTaskAiUsage: backup.data.emailTaskAiUsage ?? null,
    __legacy: Object.fromEntries(Object.entries(backup.data).filter(([key])=>!known.has(key))) };
  for (const [key,value] of Object.entries(settings)) sql.push(`INSERT INTO workspace_settings(user_id,name,payload) SELECT ${owner},${literal(key)},${literal(JSON.stringify(value))} WHERE ${condition} ON CONFLICT(user_id,name) DO NOTHING;`);
  checks.push(`(SELECT COUNT(*) FROM workspace_settings WHERE user_id=${owner})=3`);
  sql.push(`UPDATE workspace_accounts SET guard=CASE WHEN ${checks.join(' AND ')} THEN 1 ELSE 0 END,ready=1,revision=${literal('imported:'+digest)} WHERE user_id=${owner} AND ready=0 AND revision=${importing};`);
  return { sql:sql.join('\n')+'\n', counts };
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const input = path.resolve(process.argv[2] || '');
  if (!process.argv[2]) throw new Error('Usage: node scripts/prepare-d1-import.mjs /path/to/full-records.json');
  const source = fs.readFileSync(input), digest = createHash('sha256').update(source).digest('hex');
  const backup = JSON.parse(source.toString('utf8').replace(/^\uFEFF/,''));
  const prepared = prepareImport(backup,digest);
  const directory = path.resolve('migration-data',digest.slice(0,12));
  fs.mkdirSync(directory,{recursive:true});
  const saved = path.join(directory,'source-backup.json');
  if (!fs.existsSync(saved)) fs.copyFileSync(input,saved,fs.constants.COPYFILE_EXCL);
  if (createHash('sha256').update(fs.readFileSync(saved)).digest('hex')!==digest) throw new Error('Existing backup differs; refusing to overwrite.');
  fs.writeFileSync(path.join(directory,'import.sql'),prepared.sql);
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({sha256:digest,counts:prepared.counts,attachedFilesIncluded:false},null,2));
  console.log(JSON.stringify({directory,counts:prepared.counts,sha256:digest}));
}
