// Page-facing storage contract. Keep the existing Supabase data until every
// client is ready; a D1 implementation can replace this adapter without changing pages.
export const WORKSPACE_FIELDS = Object.freeze(['applications', 'toApply', 'dailyTasks', 'clientTasks', 'socialTrends', 'emails', 'deletedGmailIds', 'alerts', 'clearedNotificationKeys', 'onboardingSubmissionIds', 'emailTemplates', 'personalDocuments', 'invoices', 'scripts', 'workLinks', 'walletEntries', 'subscriptions', 'accountSignInHistory', 'weeklyActivityGoal', 'emailTaskAiUsage']);
const fields = new Set(WORKSPACE_FIELDS);
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
async function boundedJson(request, maximum = 8 * 1024 * 1024) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
}
// Preserve the existing invitation-token and RLS checks while moving clients
// behind a fixed API. Arbitrary Supabase RPC names/arguments are never forwarded.
export async function workspaceOnboarding(request, env, user = null) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Origin not allowed.' }, 403);
  const input = await boundedJson(request, 131072);
  if (!object(input) || Object.keys(input).some(key => !['action', 'parameters'].includes(key))) return json({ error: 'Invalid onboarding request.' }, 400);
  const allowed = user ? {
    issue_client_onboarding_invite: ['p_client_id','p_token_hash'], get_client_onboarding_submission: ['p_client_id'], get_client_onboarding_submissions: []
  } : {
    lookup_client_onboarding_invite: ['p_token_hash'], submit_client_onboarding: ['p_token_hash','p_contact_name','p_phone','p_timezone','p_availability','p_tools','p_priorities','p_details']
  };
  if (!Object.hasOwn(allowed, input.action) || !object(input.parameters) || Object.keys(input.parameters).some(key => !allowed[input.action].includes(key))) return json({ error: 'Invalid onboarding action.' }, 400);
  const parameters = input.parameters;
  if (allowed[input.action].includes('p_token_hash') && !/^[a-f0-9]{64}$/.test(parameters.p_token_hash || '')) return json({ error: 'Invalid invitation.' }, 400);
  if (allowed[input.action].includes('p_client_id') && (typeof parameters.p_client_id !== 'string' || !parameters.p_client_id || parameters.p_client_id.length > 512)) return json({ error: 'Invalid client.' }, 400);
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${input.action}`, { method: 'POST', headers: {
    apikey: env.SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json', ...(user ? { authorization: request.headers.get('authorization') } : {})
  }, body: JSON.stringify(parameters), signal: AbortSignal.timeout(15000) });
  const result = await response.json().catch(() => null);
  return response.ok ? json({ data: result }) : json({ error: 'The onboarding request could not be completed. Check the invitation or try again.' }, response.status >= 500 ? 503 : 400);
}
function validChange(change) {
  if (!object(change) || !fields.has(change.key) || !['put', 'remove', 'set', 'order'].includes(change.type)) return false;
  if (Object.keys(change).some(key => !['key', 'type', 'id', 'base', 'value', 'beforeId'].includes(key)) || !Object.hasOwn(change, 'base')) return false;
  if (change.beforeId !== undefined && change.beforeId !== null && (typeof change.beforeId !== 'string' || change.beforeId.length > 512)) return false;
  if (change.type === 'set') return Object.hasOwn(change, 'value');
  if (change.type === 'order') return Array.isArray(change.value) && change.value.every(id => typeof id === 'string' && id.length <= 512) && new Set(change.value).size === change.value.length;
  if (typeof change.id !== 'string' || !change.id || change.id.length > 512) return false;
  return change.type === 'remove' || (object(change.value) && change.value.id === change.id);
}
export async function workspaceApi(request, env, user) {
  const headers = { authorization: request.headers.get('authorization'), apikey: env.SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' };
  const url = new URL(request.url);
  if (request.method !== 'GET') {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return json({ error: 'Origin not allowed.' }, 403);
  }
  if (request.method === 'GET') {
    const key = url.searchParams.get('collection');
    const id = url.searchParams.get('id');
    if (key && (!fields.has(key) || key === 'weeklyActivityGoal' || key === 'emailTaskAiUsage')) return json({ error: 'Unknown collection.' }, 400);
    if (id && (!key || id.length > 512)) return json({ error: 'Invalid record.' }, 400);
    if (key && id) {
      const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/get_workspace_record`, { method: 'POST', headers, body: JSON.stringify({ p_collection: key, p_id: id }), signal: AbortSignal.timeout(15000) });
      if (!response.ok) return json({ error: 'Record reads need the page-storage database update.' }, 503);
      return json({ backend: 'supabase', record: await response.json() });
    }
    const params = new URLSearchParams({ user_id: `eq.${user.id}`, select: key ? `${key}:data->${key},updated_at` : url.searchParams.get('revision') === '1' ? 'updated_at' : 'data,updated_at', limit: '1' });
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/app_state?${params}`, { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) return json({ error: 'Saved workspace could not be loaded.' }, 503);
    const row = (await response.json())?.[0];
    if (key) {
      const records = Array.isArray(row?.[key]) ? row[key] : [];
      return json({ backend: 'supabase', records, revision: row?.updated_at || null });
    }
    return json({ backend: 'supabase', revision: row?.updated_at || null, ...(url.searchParams.get('revision') !== '1' ? { data: row?.data || {} } : {}) });
  }
  if (request.method === 'DELETE') {
    const params = new URLSearchParams({ user_id: `eq.${user.id}` });
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/app_state?${params}`, { method: 'DELETE', headers: { ...headers, prefer: 'return=minimal' }, signal: AbortSignal.timeout(15000) });
    return response.ok ? json({ cleared: true }) : json({ error: 'Workspace could not be cleared.' }, 503);
  }
  const input = await boundedJson(request);
  if (!object(input) || Object.keys(input).some(key => key !== 'changes') || !Array.isArray(input.changes) || input.changes.length > 100 || !input.changes.every(validChange)) return json({ error: 'Invalid workspace changes.' }, 400);
  if (!input.changes.length) return json({ saved: true, revision: null });
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/apply_workspace_changes`, { method: 'POST', headers,
    body: JSON.stringify({ p_changes: input.changes }), signal: AbortSignal.timeout(20000) });
  const result = await response.json().catch(() => null);
  if (response.status === 409 || result?.code === '40001') return json({ error: 'This record changed on another device. Refresh before saving it again.', code: 'WORKSPACE_CONFLICT' }, 409);
  if (!response.ok || !result?.saved) return json({ error: 'Workspace saves need the page-storage database update. Your existing records are unchanged.' }, 503);
  return json({ saved: true, revision: result.revision });
}
