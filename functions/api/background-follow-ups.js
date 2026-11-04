import { isFollowUpSendTime, followUpLocalDate } from './follow-up-calendar.js';
import { savedFollowUpDelivery } from './follow-up-send.js';
import {d1Enabled} from './d1-workspace.js';
import {d1FollowUpSchedules,saveD1FollowUpReceipt} from './d1-follow-ups.js';

const CONFIG = 'background-follow-up-config';
const HISTORY = 'background-follow-up-history';
const INTERVAL = 5 * 60000;
const ROOT = 'https://gmail.googleapis.com/gmail/v1/users/me';
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });
const email = value => String(value || '').trim().toLowerCase();
const validEmail = value => /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value) && value.length <= 320;
const serviceHeaders = env => ({ apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' });

export function backgroundFollowUpReady(env) {
  return Boolean(env.FOLLOW_UP_DELIVERIES && env.SUPABASE_SERVICE_ROLE_KEY && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.FOLLOW_UP_TOKEN_KEY);
}
async function tokenKey(env) {
  const bytes = Uint8Array.from(atob(env.FOLLOW_UP_TOKEN_KEY || ''), char => char.charCodeAt(0));
  if (bytes.length !== 32) throw new Error('Background sending needs a valid encryption key.');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const base64 = bytes => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
async function seal(env, userId, token) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(userId) }, await tokenKey(env), new TextEncoder().encode(token));
  return { iv: base64(iv), ciphertext: base64(new Uint8Array(encrypted)) };
}
async function unseal(env, config) {
  try {
    const bytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(config.token.iv), additionalData: new TextEncoder().encode(config.userId) }, await tokenKey(env), bytes(config.token.ciphertext));
    return new TextDecoder().decode(plain);
  } catch { throw Object.assign(new Error('Reconnect Gmail to unlock background authorization.'), { reconnect: true }); }
}
async function gmailAccess(env, refreshToken) {
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET }), signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok || !result.access_token) {
    const failure = new Error(result.error === 'invalid_grant' ? 'Reconnect Gmail to resume background follow-ups.' : 'Gmail renewal is temporarily unavailable.');
    failure.reconnect = result.error === 'invalid_grant';
    throw failure;
  }
  const scopes = String(result.scope || '').split(' ');
  if (!scopes.some(scope => ['https://mail.google.com/', 'https://www.googleapis.com/auth/gmail.modify'].includes(scope))
    && !(scopes.includes('https://www.googleapis.com/auth/gmail.send') && scopes.includes('https://www.googleapis.com/auth/gmail.readonly'))) {
    throw Object.assign(new Error('Reconnect Gmail with permission to read sent mail and send follow-ups.'), { reconnect: true });
  }
  return result;
}
async function googleJson(url, accessToken) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Gmail history could not be checked. No new email was sent.');
  return response.json();
}
async function saveReceipt(env, userId, receipt, checkOnly = false) {
  if(d1Enabled(env)) return saveD1FollowUpReceipt(env,userId,receipt,checkOnly);
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/record_background_follow_up`, { method: 'POST', headers: serviceHeaders(env),
    body: JSON.stringify(checkOnly ? { p_user_id: userId, p_check_only: true } : {
      p_user_id: userId, p_application_id: receipt.applicationId, p_scheduled_date: receipt.scheduledDate,
      p_sent_at: receipt.sentAt, p_gmail_id: receipt.gmailId, p_subject: receipt.subject, p_body: receipt.body, p_recipient: receipt.recipient
    }), signal: AbortSignal.timeout(10000) });
  if (!response.ok || (await response.json()) !== true) throw new Error('Background delivery storage is not ready. Apply the follow-up database update.');
}
async function workspace(env, userId, applicationId = null) {
  if(d1Enabled(env)) return d1FollowUpSchedules(env,userId,applicationId);
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/background_follow_up_snapshot`, {
    method: 'POST', headers: serviceHeaders(env), body: JSON.stringify({ p_user_id: userId, p_application_id: applicationId }), signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('Follow-up schedules are unavailable. Apply the background follow-up database update.');
  return response.json();
}
function userObject(env, userId) { return env.FOLLOW_UP_DELIVERIES.get(env.FOLLOW_UP_DELIVERIES.idFromName(`background-follow-ups:${userId}`)); }
async function connectionInput(request) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 12000) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
}

// The public Worker verifies the Supabase session before entering this handler.
export async function backgroundFollowUps(request, env, user) {
  if (!env.FOLLOW_UP_DELIVERIES) return json({ error: 'Background follow-ups are not configured.' }, 503);
  if (!user.email || !user.email_confirmed_at) return json({ error: 'A verified email is required.' }, 403);
  if (request.method !== 'GET') {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return json({ error: 'Origin not allowed.' }, 403);
  }
  let input = { action: request.method === 'GET' ? 'status' : 'disable', userId: user.id };
  if (request.method === 'POST') {
    if (!backgroundFollowUpReady(env)) return json({ error: 'Background sending needs the server setup. See the deployment guide.', configured: false }, 503);
    const body = await connectionInput(request);
    if (typeof body?.refreshToken !== 'string' || !body.refreshToken || body.refreshToken.length > 8192 || Object.keys(body).some(key => key !== 'refreshToken')) return json({ error: 'Reconnect Gmail before enabling background follow-ups.' }, 400);
    input = { ...input, action: 'enable', email: email(user.email),
      senderName: String(user.user_metadata?.full_name || user.user_metadata?.name || user.email).replace(/[\r\n]+/g, ' ').trim().slice(0, 200), refreshToken: body.refreshToken };
  }
  return userObject(env, user.id).fetch(new Request('https://internal/background-follow-ups', { method: 'POST', body: JSON.stringify(input) }));
}

export async function coordinateBackgroundFollowUps(storage, env, input) {
  if (input.action === 'status') {
    const config = await storage.get(CONFIG);
    const history = await storage.get(HISTORY) || [];
    return json({ configured: backgroundFollowUpReady(env), enabled: Boolean(config?.enabled), email: config?.email || '',
      status: config?.enabled && env.BACKGROUND_FOLLOW_UPS_PAUSED === 'true' ? 'paused' : config?.status || 'off', lastCheckedAt: config?.lastCheckedAt || '', message: config?.enabled && env.BACKGROUND_FOLLOW_UPS_PAUSED === 'true' ? 'Automatic follow-ups are paused during migration. Review restored schedules before resuming.' : config?.message || '',
      recent: history.slice(0, 20).map(({ body, subject, ...record }) => record) });
  }
  if (input.action === 'disable') {
    await storage.delete(CONFIG);
    await storage.deleteAlarm();
    return json({ enabled: false });
  }
  if (input.action !== 'enable') return json({ error: 'Invalid action.' }, 400);
  try {
    // Validate ownership and scope using Google, never a browser-supplied mailbox.
    const access = await gmailAccess(env, input.refreshToken);
    const profile = await googleJson(`${ROOT}/profile`, access.access_token);
    if (email(profile.emailAddress) !== input.email) return json({ error: 'Connect the Gmail address used by your signed-in account.' }, 403);
    await saveReceipt(env, input.userId, null, true);
    const token = await seal(env, input.userId, access.refresh_token || input.refreshToken);
    await storage.put(CONFIG, { userId: input.userId, email: input.email, senderName: input.senderName, token, enabled: true, generation: crypto.randomUUID(), status: 'ready', message: '' });
    await storage.setAlarm(Date.now() + 60000);
    return json({ enabled: true, email: input.email });
  } catch (error) { return json({ error: error.message || 'Gmail could not be connected.' }, 503); }
}

// Matches the existing follow-up template used by the application composer.
export function backgroundFollowUpMessage(app, sender = {}) {
  const senderEmail = String(sender.email || '').trim();
  const senderName = String(sender.senderName || senderEmail || 'Your name').trim();
  const role = String(app.role || '').trim() || 'position';
  const platform = String(app.platform || '').trim();
  const applied = new Date(String(app.appliedDate || '').slice(0, 10) + 'T12:00:00Z');
  const date = Number.isFinite(applied.getTime()) ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(applied) : 'an earlier date';
  const via = platform ? platform.toLowerCase() === 'direct client' ? ' using the email address provided in the job description' : ` through ${platform}` : '';
  return { subject: `Application for ${role}`, body: `Hi ${app.contact || app.clientName || 'Client'},\n\nI wanted to follow up on my application for the **${role}** role, which I submitted on ${date}${via}. I would welcome any updates regarding my application status or the next steps in the application process.\n\nThank you for your time and consideration.\n\nBest regards,\n${senderName}\n${senderEmail}` };
}
export function backgroundRawMessage(app, message) {
  const subject = `=?UTF-8?B?${base64(new TextEncoder().encode(message.subject.replace(/[\r\n]+/g, ' ')))}?=`;
  const raw = [`To: ${email(app.email)}`, `Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', base64(new TextEncoder().encode(message.body.replace(/\*\*([^*]+)\*\*/g, '$1'))) ].join('\r\n');
  return base64(new TextEncoder().encode(raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function reservation(env, userId, app, scheduledDate, input) {
  const object = env.FOLLOW_UP_DELIVERIES.get(env.FOLLOW_UP_DELIVERIES.idFromName(JSON.stringify([userId, app.id, scheduledDate])));
  const response = await object.fetch(new Request('https://internal/delivery', { method: 'POST', body: JSON.stringify(input) }));
  if (!response.ok) throw new Error('Follow-up delivery protection is unavailable.');
  return response.json();
}
async function sentHistory(app, scheduledDate, subject, token) {
  const after = Math.floor(new Date(`${scheduledDate}T00:00:00+14:00`).getTime() / 1000) - 1;
  const query = `in:sent to:${email(app.email)} after:${after} {subject:follow "I wanted to follow up on my application"}`;
  const list = await googleJson(`${ROOT}/messages?${new URLSearchParams({ q: query, maxResults: '100' })}`, token);
  const expected = [subject, String(app.role || '').trim(), app.clientName ? `Follow-up: ${app.clientName.trim()}` : '', `Follow-up application: ${String(app.role || '').trim() || 'position'}${app.platform ? ' — ' + app.platform.trim() : ''}`].filter(Boolean).map(value => value.toLowerCase());
  for (const entry of list.messages || []) {
    const item = await googleJson(`${ROOT}/messages/${encodeURIComponent(entry.id)}?format=full`, token);
    const header = name => {
      const value = item.payload?.headers?.find(row => row.name.toLowerCase() === name)?.value || '';
      return value.replace(/(=\?utf-8\?[bq]\?[^?]*\?=)\s+(?==\?utf-8\?)/gi, '$1').replace(/=\?utf-8\?([bq])\?([^?]*)\?=/gi, (match, encoding, text) => {
        try {
          const binary = encoding.toLowerCase() === 'b' ? atob(text) : text.replace(/_/g, ' ').replace(/=([\da-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
          return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
        } catch { return match; }
      });
    };
    const to = header('to').match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase();
    const at = Number(item.internalDate);
    if (to !== email(app.email) || !expected.includes(header('subject').trim().toLowerCase()) || !Number.isFinite(at) || at < after * 1000 || at < (Date.parse(app.appliedDate || '') || 0) || followUpLocalDate(app, new Date(at)) < scheduledDate) continue;
    // Subjects reused for initial applications need actual follow-up body evidence.
    const containsFollowUp = part => {
      if (part.body?.data) {
        try { if (/I wanted to follow up on my application/i.test(atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/')))) return true; } catch {}
      }
      return (part.parts || []).some(containsFollowUp);
    };
    if (!/^follow(?:ing)?[\s-]*up\b/i.test(header('subject')) && !containsFollowUp(item.payload || {})) continue;
    return { sentAt: new Date(at).toISOString(), gmailId: item.id };
  }
  if (list.nextPageToken) throw new Error('Sent history needs review before another follow-up can be sent.');
  return null;
}
async function remember(storage, record) {
  await storage.transaction(async tx => {
    const history = await tx.get(HISTORY) || [];
    const others = history.filter(item => item.applicationId !== record.applicationId || item.scheduledDate !== record.scheduledDate);
    // Never discard unsynced successful receipts; they must reach the workspace.
    await tx.put(HISTORY, [record, ...others.filter(item => item.status === 'sent' && !item.synced), ...others.filter(item => item.status !== 'sent' || item.synced).slice(0, 99)]);
  });
}
const eligible = app => app && app.automaticFollowUp === true && !['Active client', 'Not selected'].includes(app.status) && /^\d{4}-\d{2}-\d{2}$/.test(app.followUpDate || '') && isFollowUpSendTime(app, app.followUpDate) && validEmail(email(app.email));
const fingerprint = app => JSON.stringify([app.id, app.followUpDate, app.email, app.role, app.contact, app.clientName, app.appliedDate, app.platform, app.status, app.location, app.clientTimeZone, app.timeZone, app.timezone, app.automaticFollowUp]);

export async function runBackgroundFollowUps(storage, env) {
  const config = await storage.get(CONFIG);
  if (!config?.enabled) return;
  if (env.BACKGROUND_FOLLOW_UPS_PAUSED === 'true') { await storage.setAlarm(Date.now()+300000); return; }
  const current = async () => {
    const latest = await storage.get(CONFIG);
    return latest?.enabled && latest.generation === config.generation;
  };
  try {
    if (!backgroundFollowUpReady(env)) throw new Error('Background sending needs the server setup.');
    const history = await storage.get(HISTORY) || [];
    for (const receipt of history.filter(item => item.status === 'sent' && !item.synced)) {
      await saveReceipt(env, config.userId, receipt);
      await remember(storage, { ...receipt, synced: true });
    }
    const state = await workspace(env, config.userId);
    if (!state) {
      // Deleted workspaces must not retain a background Gmail connection.
      if (await current()) { await storage.delete(CONFIG); await storage.deleteAlarm(); }
      return;
    }
    const due = (state.applications || []).filter(eligible).slice(0, 10);
    if (due.length) {
      if(d1Enabled(env)) {
        const response=await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(config.userId)}`,{headers:serviceHeaders(env),signal:AbortSignal.timeout(10000)});
        if(!response.ok) throw Object.assign(new Error('Account verification failed. Background sending is paused.'),{reconnect:response.status===404});
        const user=await response.json();
        if(!user.email_confirmed_at || email(user.email)!==config.email || Date.parse(user.banned_until || '')>Date.now()) throw Object.assign(new Error('Reconnect this account before resuming background follow-ups.'),{reconnect:true});
      }
      const access = await gmailAccess(env, await unseal(env, config));
      // Google can rotate refresh tokens; retain the replacement encrypted.
      if (access.refresh_token && await current()) {
        config.token = await seal(env, config.userId, access.refresh_token);
        await storage.put(CONFIG, config);
      }
      for (const app of due) {
        if (!await current()) break;
        const scheduledDate = app.followUpDate;
        const message = backgroundFollowUpMessage(app, config);
        const record = { applicationId: app.id, scheduledDate, recipient: email(app.email), ...message, updatedAt: new Date().toISOString() };
        let claimedToken = '', sendStarted = false;
        try {
          const found = savedFollowUpDelivery(state, app, scheduledDate) || await sentHistory(app, scheduledDate, message.subject, access.access_token);
          const claim = await reservation(env, config.userId, app, scheduledDate, { action: 'claim', eligible: true, ...(found ? { savedDelivery: found } : {}) });
          if (claim.status === 'sent') {
            const receipt = { ...record, status: 'sent', sentAt: claim.sentAt, gmailId: claim.gmailId || '', synced: false };
            await remember(storage, receipt);
            await saveReceipt(env, config.userId, receipt);
            await remember(storage, { ...receipt, synced: true });
            continue;
          }
          if (claim.status !== 'claimed') {
            await remember(storage, { ...record, status: 'review', message: 'Check Gmail Sent. An earlier delivery has not been confirmed.' });
            continue;
          }
          claimedToken = claim.claimToken;
          // Re-read immediately before Gmail: edits, cancellation and disabling win.
          const latest = (await workspace(env, config.userId, app.id))?.applications?.find(item => item.id === app.id);
          if (!await current() || !eligible(latest) || fingerprint(latest) !== fingerprint(app)) {
            await reservation(env, config.userId, app, scheduledDate, { action: 'release', claimToken: claim.claimToken });
            continue;
          }
          let response;
          try {
            sendStarted = true;
            response = await fetch(`${ROOT}/messages/send`, { method: 'POST', headers: { authorization: `Bearer ${access.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ raw: backgroundRawMessage(app, message) }), signal: AbortSignal.timeout(15000) });
          } catch {
            await remember(storage, { ...record, status: 'review', message: 'Gmail delivery is unconfirmed. Automatic resending is blocked.' });
            continue;
          }
          if (!response.ok) {
            const rejected = [400, 401, 403, 404, 429].includes(response.status);
            if (rejected) await reservation(env, config.userId, app, scheduledDate, { action: 'release', claimToken: claim.claimToken });
            await remember(storage, { ...record, status: rejected ? 'retry' : 'review', message: rejected ? `Gmail rejected delivery (HTTP ${response.status}); it will retry.` : 'Delivery is unconfirmed. Automatic resending is blocked.' });
            continue;
          }
          const sent = await response.json();
          if (!sent.id) throw new Error('Gmail delivery needs review. Automatic resending is blocked.');
          const receipt = { ...record, status: 'sent', sentAt: new Date().toISOString(), gmailId: sent.id, synced: false };
          await remember(storage, receipt);
          await reservation(env, config.userId, app, scheduledDate, { action: 'complete', claimToken: claim.claimToken, sentAt: receipt.sentAt, gmailId: receipt.gmailId });
          await saveReceipt(env, config.userId, receipt);
          await remember(storage, { ...receipt, synced: true });
        } catch {
          if (claimedToken && !sendStarted) await reservation(env, config.userId, app, scheduledDate, { action: 'release', claimToken: claimedToken }).catch(() => {});
          // Do not overwrite an accepted-but-unsynced receipt with a generic error.
          const history = await storage.get(HISTORY) || [];
          if (!history.some(item => item.applicationId === app.id && item.scheduledDate === scheduledDate && item.status === 'sent')) await remember(storage, { ...record,
            status: claimedToken && !sendStarted ? 'retry' : 'review',
            message: claimedToken && !sendStarted ? 'Schedule check failed before sending. It will retry.' : 'Follow-up needs review. Check Gmail Sent before retrying.' });
        }
      }
    }
    if (await current()) await storage.put(CONFIG, { ...config, status: 'ready', message: '', lastCheckedAt: new Date().toISOString() });
  } catch (error) {
    if (await current()) await storage.put(CONFIG, { ...config, enabled: !error.reconnect, status: error.reconnect ? 'reconnect' : 'retry', message: error.message || 'Background sending will retry.', lastCheckedAt: new Date().toISOString() });
  } finally {
    if (await current()) await storage.setAlarm(Date.now() + INTERVAL);
  }
}
