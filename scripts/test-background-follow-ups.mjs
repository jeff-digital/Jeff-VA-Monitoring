import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker from '../src/backend/worker.mjs';
import { FollowUpDelivery } from '../functions/api/follow-up-send.js';
import { backgroundFollowUpMessage, backgroundRawMessage } from '../functions/api/background-follow-ups.js';
import { MemoryStorage } from './lib/memory-durable.mjs';

const NativeDate = Date, originalFetch = globalThis.fetch;
let clock = '2026-11-05T01:00:00Z'; // Thursday, 9 AM in the Philippines.
globalThis.Date = class extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return NativeDate.parse(clock); }
};
class Storage extends MemoryStorage {
  async setAlarm(value) { this.alarmAt = value; }
  async deleteAlarm() { this.alarmAt = null; }
}
function fixture() {
  const stores = new Map(), objects = new Map();
  const env = { SUPABASE_URL: 'https://auth.example', SUPABASE_PUBLISHABLE_KEY: 'public', SUPABASE_SERVICE_ROLE_KEY: 'private-service-key',
    GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'private-google-secret', FOLLOW_UP_TOKEN_KEY: btoa('x'.repeat(32)) };
  env.FOLLOW_UP_DELIVERIES = { idFromName: name => name, get(name) {
    if (!stores.has(name)) { const storage = new Storage(); stores.set(name, storage); objects.set(name, new FollowUpDelivery({ storage }, env)); }
    return objects.get(name);
  } };
  const app = { id: 'app', clientName: 'Acme', contact: 'Jordan', role: 'VA', platform: 'Direct client', email: 'client@example.com', appliedDate: '2026-10-20', followUpDate: '2026-11-05', automaticFollowUp: true, status: 'Applied', location: 'Philippines' };
  const state = { applications: [structuredClone(app)], emails: [], alerts: [], unrelated: 'keep me' };
  const control = { sends: 0, receipts: [], gmail: [], mode: 'success', profileEmail: 'owner@example.com', refreshRejected: false, saveFails: false, deleted: false, beforeRead: null, beforeSend: null, reads: 0, scopes: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send' };
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url.includes('/auth/v1/user')) return Response.json({ id: options.headers.authorization === 'Bearer other' ? 'other' : 'owner', email: options.headers.authorization === 'Bearer other' ? 'other@example.com' : 'owner@example.com', email_confirmed_at: clock, user_metadata: { full_name: options.headers.authorization === 'Bearer other' ? 'Other User' : 'Owner Example' } });
    if (url === 'https://oauth2.googleapis.com/token') {
      assert.equal(options.body.get('refresh_token'), 'private-refresh');
      return control.refreshRejected ? Response.json({ error: 'invalid_grant' }, { status: 400 }) : Response.json({ access_token: 'google-access', scope: control.scopes });
    }
    if (url.endsWith('/profile')) return Response.json({ emailAddress: control.profileEmail });
    if (url.endsWith('/rpc/background_follow_up_snapshot')) {
      const query = JSON.parse(options.body);
      assert.equal(query.p_user_id, 'owner');
      assert.ok(query.p_application_id === null || query.p_application_id === 'app', 'Pre-send reads request just the affected application');
      assert.equal(options.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
      control.reads++;
      if (control.beforeRead) await control.beforeRead(control.reads);
      return Response.json(control.deleted ? null : { applications: structuredClone(state.applications.filter(item => query.p_application_id ? item.id === query.p_application_id : item.automaticFollowUp && item.followUpDate)) });
    }
    if (url.endsWith('/rpc/record_background_follow_up')) {
      const receipt = JSON.parse(options.body);
      if (receipt.p_check_only) return Response.json(true);
      if (control.saveFails) return Response.json({}, { status: 503 });
      control.receipts.push(receipt);
      const current = state.applications.find(item => item.id === receipt.p_application_id);
      if (current?.followUpDate === receipt.p_scheduled_date) Object.assign(current, { followUpDate: '', automaticFollowUp: false, followUpSentAt: receipt.p_sent_at });
      return Response.json(true);
    }
    if (url.includes('/messages?')) return Response.json({ messages: control.gmail.map(item => ({ id: item.id })) });
    if (/\/messages\/[^?]+\?format=full/.test(url)) {
      const id = url.split('/messages/')[1].split('?')[0];
      return Response.json(control.gmail.find(item => item.id === id));
    }
    if (url.endsWith('/messages/send')) {
      control.sends++;
      if (control.beforeSend) await control.beforeSend();
      if (control.mode === 'timeout') throw new Error('Lost Gmail response');
      if (control.mode === 'reject') return Response.json({}, { status: 429 });
      const message = { id: `mail-${control.sends}`, internalDate: String(Date.now()), payload: { headers: [{ name: 'To', value: app.email }, { name: 'Subject', value: '=?UTF-8?B?' + Buffer.from(backgroundFollowUpMessage(app).subject).toString('base64') + '?=' }], body: { data: btoa('I wanted to follow up on my application') } } };
      control.gmail.push(message);
      if (control.mode === 'accepted-timeout') throw new Error('Gmail accepted but response was lost');
      return Response.json({ id: message.id });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const api = (method = 'GET', body, token = 'owner') => worker.fetch(new Request('https://app.example/api/follow-up/background', {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin: 'https://app.example', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {})
  }), env, {});
  const enable = async () => { const response = await api('POST', { refreshToken: 'private-refresh' }); assert.equal(response.status, 200, await response.clone().text()); };
  const scheduler = () => env.FOLLOW_UP_DELIVERIES.get(env.FOLLOW_UP_DELIVERIES.idFromName('background-follow-ups:owner'));
  const alarm = () => scheduler().alarm();
  const storage = () => stores.get('background-follow-ups:owner');
  return { env, stores, objects, app, state, control, api, enable, alarm, storage, scheduler };
}
try {
  let f = fixture();
  assert.equal((await f.api('GET', null, '')).status, 401);
  assert.equal((await f.api('PUT')).status, 405);
  assert.equal((await f.api('POST', { refreshToken: 'private-refresh', userId: 'other' })).status, 400);
  assert.equal((await f.api('POST', { refreshToken: 'x'.repeat(20000) })).status, 400, 'Oversized connection bodies are rejected');
  assert.equal((await (await f.api()).json()).enabled, false);
  await f.enable();
  assert.equal(f.storage().alarmAt, Date.now() + 60000);
  const saved = JSON.stringify([...f.storage().values]);
  for (const secret of ['private-refresh', 'google-access', 'private-google-secret', 'private-service-key']) assert.ok(!saved.includes(secret), 'Credentials must be encrypted or absent in durable storage');
  const statusText = await (await f.api()).text();
  assert.ok(!statusText.includes('ciphertext') && !statusText.includes('refresh'), 'Status must never return token material');
  assert.equal((await (await f.api('GET', null, 'other')).json()).enabled, false, 'Another account cannot read this connection');
  await f.alarm(); // No browser or bearer session participates in the alarm.
  assert.equal(f.control.sends, 1);
  assert.equal(f.control.receipts.length, 1);
  assert.match(f.control.receipts[0].p_body, /Best regards,\nOwner Example\nowner@example\.com$/);
  assert.doesNotMatch(f.control.receipts[0].p_body, /Jeffrey|almocera|975-683/i, 'Automatic follow-ups never use another user\'s fixed signature');
  assert.equal(f.state.applications[0].automaticFollowUp, false);
  assert.equal(f.storage().alarmAt, Date.now() + 5 * 60000);
  // A stale browser snapshot cannot bypass the shared delivery ledger.
  Object.assign(f.state.applications[0], { automaticFollowUp: true, followUpDate: f.app.followUpDate });
  await f.alarm();
  assert.equal(f.control.sends, 1);
  assert.equal(f.state.unrelated, 'keep me');
  await f.api('DELETE');
  assert.equal(await f.storage().get('background-follow-up-config'), undefined);
  assert.equal(f.storage().alarmAt, null);
  await f.alarm();
  assert.equal(f.control.sends, 1, 'Turning off removes credentials and stops background sends');

  f = fixture(); await f.enable(); f.control.profileEmail = 'other@example.com';
  assert.equal((await f.api('POST', { refreshToken: 'private-refresh' }, 'other')).status, 200);
  assert.equal((await (await f.api()).json()).email, 'owner@example.com');
  assert.equal((await (await f.api('GET', null, 'other')).json()).email, 'other@example.com');
  assert.notEqual((await f.stores.get('background-follow-ups:owner').get('background-follow-up-config')).token.ciphertext,
    (await f.stores.get('background-follow-ups:other').get('background-follow-up-config')).token.ciphertext, 'Users have separate encrypted connections');
  await f.api('DELETE', null, 'other');
  assert.equal((await (await f.api()).json()).enabled, true, 'One user turning off never disables another user');

  f = fixture(); f.control.profileEmail = 'stranger@example.com';
  assert.equal((await f.api('POST', { refreshToken: 'private-refresh' })).status, 403, 'A token for another mailbox cannot be connected');
  f = fixture(); f.control.scopes = 'https://www.googleapis.com/auth/gmail.readonly';
  assert.equal((await f.api('POST', { refreshToken: 'private-refresh' })).status, 503, 'Missing send permission fails closed');
  f = fixture(); delete f.env.FOLLOW_UP_TOKEN_KEY;
  assert.equal((await f.api('POST', { refreshToken: 'private-refresh' })).status, 503);

  f = fixture(); await f.enable();
  clock = '2026-11-07T01:00:00Z'; await f.alarm();
  clock = '2026-11-05T10:00:00Z'; await f.alarm();
  assert.equal(f.control.sends, 0, 'Weekends and after 5 PM never send');
  clock = '2026-11-05T01:00:00Z';
  f.state.applications[0].status = 'Active client'; await f.alarm();
  f.state.applications[0].status = 'Not selected'; await f.alarm();
  f.state.applications[0].status = 'Applied'; f.state.applications[0].automaticFollowUp = false; await f.alarm();
  assert.equal(f.control.sends, 0, 'Ineligible or disabled applications never send');

  f = fixture(); await f.enable();
  f.control.beforeRead = count => { if (count === 2) f.state.applications[0].automaticFollowUp = false; };
  await f.alarm(); assert.equal(f.control.sends, 0, 'Cancellation before Gmail wins over an earlier scan');
  f = fixture(); await f.enable();
  f.control.beforeRead = async count => { if (count === 2) await f.api('DELETE'); };
  await f.alarm(); assert.equal(f.control.sends, 0, 'Turning off while the alarm runs stops an unsent email');

  f = fixture(); await f.enable(); f.control.mode = 'timeout';
  await f.alarm(); await f.alarm();
  assert.equal(f.control.sends, 1, 'An ambiguous Gmail result never automatically resends');
  assert.equal((await (await f.api()).json()).recent[0].status, 'review');
  f = fixture(); await f.enable(); f.control.mode = 'accepted-timeout';
  await f.alarm(); await f.alarm();
  assert.equal(f.control.sends, 1, 'Sent history recovers an accepted email after its response was lost');
  assert.equal((await (await f.api()).json()).recent[0].status, 'sent', 'Recovery handles MIME-encoded subjects');
  f = fixture(); await f.enable();
  f.control.beforeRead = count => { if (count === 2) throw new Error('Temporary database read failure'); };
  await f.alarm(); f.control.beforeRead = null; await f.alarm();
  assert.equal(f.control.sends, 1, 'A known failure before contacting Gmail safely releases the claim for retry');
  f = fixture(); await f.enable(); f.control.mode = 'reject';
  await f.alarm(); f.control.mode = 'success'; await f.alarm();
  assert.equal(f.control.sends, 2, 'An explicit Gmail rejection can be retried');

  f = fixture(); await f.enable(); f.control.saveFails = true;
  await f.alarm(); assert.equal((await (await f.api()).json()).recent[0].synced, false);
  f.control.saveFails = false; await f.alarm();
  assert.equal(f.control.sends, 1, 'A database failure does not lose the receipt or send twice');
  assert.equal((await (await f.api()).json()).recent[0].synced, true);
  f = fixture(); await f.enable(); f.control.refreshRejected = true; await f.alarm();
  assert.equal((await (await f.api()).json()).status, 'reconnect');
  assert.equal((await (await f.api()).json()).enabled, false, 'Revoked Gmail access pauses background sending');
  f = fixture(); await f.enable(); f.control.deleted = true; await f.alarm();
  assert.equal(await f.storage().get('background-follow-up-config'), undefined, 'Deleting the workspace removes its encrypted connection');
  assert.equal(f.storage().alarmAt, null);
  f = fixture(); await f.enable(); f.env.FOLLOW_UP_TOKEN_KEY = btoa('z'.repeat(32)); await f.alarm();
  assert.equal((await (await f.api()).json()).status, 'reconnect', 'Encryption key rotation requires reconnecting, never a plaintext fallback');

  f = fixture(); await f.enable();
  await Promise.all([f.alarm(), f.alarm()]);
  assert.equal(f.control.sends, 1, 'Repeated alarm delivery uses the same reservation as open tabs');

  // Verify the server uses exactly the composer subject/body, including substitutions.
  const gmail = fs.readFileSync(new URL('../src/frontend/js/modules/04-gmail.js', import.meta.url), 'utf8');
  const definitions = gmail.slice(gmail.indexOf('  const DOCUMENT_TEMPLATE_DEFINITIONS'), gmail.indexOf('  let gmailAccessToken'));
  const renderer = gmail.slice(gmail.indexOf('  function buildDocumentEmailTemplate('), gmail.indexOf('  function renderEmailTemplateOptions('));
  const end = renderer.indexOf('\n  function ', 15);
  const context = vm.createContext({ Date, Intl, contractDuration: () => '', app: f.app });
  vm.runInContext(definitions + (end > 0 ? renderer.slice(0, end) : renderer), context);
  const browser = vm.runInContext("buildDocumentEmailTemplate('follow-up', app)", context);
  assert.deepEqual(backgroundFollowUpMessage(f.app), { subject: browser.subject, body: browser.body });
  for (const [name, email] of [['Alex Rivera', 'alex@example.com'], ['Sam Lee', 'sam@example.com']]) {
    context.currentUser = { email, user_metadata: { full_name: name } };
    const browser = vm.runInContext("buildDocumentEmailTemplate('follow-up', app)", context);
    const server = backgroundFollowUpMessage(f.app, { email, senderName: name });
    assert.deepEqual(server, { subject: browser.subject, body: browser.body });
    assert.ok(server.body.endsWith(`Best regards,\n${name}\n${email}`));
    assert.doesNotMatch(server.body, /Jeffrey|almocera|975-683/i);
  }
  const raw = Buffer.from(backgroundRawMessage({ ...f.app, email: 'client@example.com' }, { subject: 'Hello\r\nBcc: bad@example.com', body: 'Unicode ✓' }), 'base64url').toString();
  assert.equal(raw.split('\r\n').filter(line => line.startsWith('To:')).length, 1);
  assert.ok(!raw.includes('\r\nBcc:'), 'Subject values cannot inject email headers');
  console.log('PASS background follow-ups: logged-out delivery, encrypted credentials, mailbox isolation, sending windows, cancellation, duplicate alarms, ambiguous delivery, retries, receipt recovery and template parity.');
} finally { globalThis.fetch = originalFetch; globalThis.Date = NativeDate; }
