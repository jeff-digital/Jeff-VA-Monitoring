// Optional: PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.app_state (user_id uuid primary key, data jsonb not null, updated_at timestamptz default now());`);
  const migration = fs.readFileSync(new URL('../src/backend/supabase/background-follow-ups-migration.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(migration); // Re-running deployment must remain safe.
  const user = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  const app = { id: 'app', clientName: 'Acme', email: 'client@example.com', followUpDate: '2026-11-05', automaticFollowUp: true, note: 'Keep edited note' };
  const workspace = { applications: [app, { id: 'another', role: 'Keep this' }], emails: [{ id: 'old-email', body: 'x'.repeat(50000) }], alerts: [], dailyTasks: [{ title: 'Keep task' }] };
  await db.query('insert into public.app_state(user_id,data) values ($1,$2),($3,$2)', [user, workspace, other]);
  const save = (date = '2026-11-05', gmail = 'mail-1', uid = user) => db.query(`select public.record_background_follow_up(
    p_user_id => $1, p_application_id => 'app', p_scheduled_date => $2,
    p_sent_at => '2026-11-05T01:00:00Z', p_gmail_id => $3, p_subject => 'Application for VA',
    p_body => 'Follow-up body', p_recipient => 'original-recipient@example.com') as saved`, [uid, date, gmail]);
  const state = async (uid = user) => (await db.query('select data from public.app_state where user_id=$1', [uid])).rows[0]?.data;
  await db.exec('set role authenticated');
  await assert.rejects(save(), /permission denied/i, 'Browser users cannot call the privileged receipt function');
  await assert.rejects(db.query('select public.background_follow_up_snapshot($1)', [user]), /permission denied/i);
  await db.exec('reset role; set role service_role');
  assert.equal((await db.query('select public.record_background_follow_up(p_user_id=>$1,p_check_only=>true) as ready', [user])).rows[0].ready, true);
  const snapshot = (await db.query('select public.background_follow_up_snapshot($1) as snapshot', [user])).rows[0].snapshot;
  assert.equal(snapshot.applications.length, 1, 'Only scheduled automatic applications are downloaded');
  assert.equal(snapshot.applications[0].id, 'app');
  assert.equal(snapshot.applications[0].note, undefined, 'Unrelated application fields stay in the database');
  assert.equal(snapshot.emails, undefined, 'Email bodies are never downloaded by the scheduler');
  assert.equal(snapshot.dailyTasks, undefined);
  assert.ok(JSON.stringify(snapshot).length < JSON.stringify(workspace).length / 50, 'Lean schedule response substantially reduces transferred data for an email-heavy workspace');
  const specific = (await db.query('select public.background_follow_up_snapshot($1,$2) as snapshot', [user, 'another'])).rows[0].snapshot;
  assert.equal(specific.applications.length, 1, 'The final eligibility check can read a disabled application');
  await save();
  await db.exec('reset role');
  let saved = await state();
  assert.equal(saved.applications[0].automaticFollowUp, false);
  assert.equal(saved.applications[0].followUpDate, '');
  assert.equal(saved.applications[0].note, 'Keep edited note');
  assert.deepEqual(saved.applications[1], workspace.applications[1]);
  assert.deepEqual(saved.dailyTasks, workspace.dailyTasks);
  assert.equal(saved.emails[0].to, 'original-recipient@example.com', 'Receipt preserves the actual sent recipient after an application edit');
  assert.equal(saved.alerts[0].deliveryStatus, 'sent');
  assert.deepEqual(await state(other), workspace, 'Another account stays untouched');
  await save();
  saved = await state();
  assert.equal(saved.emails.length, workspace.emails.length + 1, 'Duplicate alarm receipts do not duplicate sent mail');
  assert.equal(saved.alerts.length, 1, 'Duplicate receipts do not duplicate alerts');
  saved.applications[0].followUpDate = '2026-11-10';
  saved.applications[0].automaticFollowUp = true;
  await db.query('update public.app_state set data=$2 where user_id=$1', [user, saved]);
  await save();
  saved = await state();
  assert.equal(saved.applications[0].followUpDate, '2026-11-10', 'An older receipt cannot clear a newer schedule');
  assert.equal(saved.applications[0].automaticFollowUp, true);
  await db.query('delete from public.app_state where user_id=$1', [user]);
  await save();
  assert.equal(await state(), undefined, 'Background results cannot recreate a deleted workspace');
  console.log('PASS background SQL: migration rerun, service-only permission, account isolation, field-preserving merge, idempotent receipts, original recipient, newer schedules and deleted accounts.');
} finally { await db.close(); }
