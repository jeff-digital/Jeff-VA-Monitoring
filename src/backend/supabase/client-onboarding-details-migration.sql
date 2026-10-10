-- Run in Supabase Dashboard -> SQL Editor to update the live onboarding RPC.
-- The live page sends the expanded form answers as p_details (jsonb).
begin;

alter table public.client_onboarding_submissions
  add column if not exists details jsonb not null default '{}'::jsonb;

drop function if exists public.submit_client_onboarding(text, text, text, text, text, text, text);
drop function if exists public.submit_client_onboarding(text, text, text, text, text, text, text, jsonb);

create or replace function public.submit_client_onboarding(
  p_token_hash text,
  p_contact_name text,
  p_phone text,
  p_timezone text,
  p_availability text,
  p_tools text,
  p_priorities text,
  p_details jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite public.client_onboarding_invites%rowtype;
  inserted_count integer;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$'
    or p_contact_name is null or length(btrim(p_contact_name)) = 0 or length(p_contact_name) > 120
    or p_phone is null or length(btrim(p_phone)) = 0 or length(p_phone) > 80
    or p_phone !~ '^[+][0-9]{1,3} [0-9][0-9 ()./-]*$'
    or length(regexp_replace(p_phone, '[^0-9]', '', 'g')) not between 4 and 15
    or p_timezone is null or length(btrim(p_timezone)) = 0 or length(p_timezone) > 120
    or not exists (
      select 1 from pg_catalog.pg_timezone_names where name = p_timezone
    )
    or p_availability is null or length(btrim(p_availability)) = 0 or length(p_availability) > 2000
    or length(coalesce(p_tools, '')) > 2000
    or p_priorities is null or length(btrim(p_priorities)) = 0 or length(p_priorities) > 2000
    or p_details is null or jsonb_typeof(p_details) is distinct from 'object'
    or jsonb_typeof(p_details->'companyName') is distinct from 'string'
    or length(btrim(coalesce(p_details->>'companyName', ''))) not between 1 and 160
    or length(coalesce(p_details->>'role', '')) > 120
    or jsonb_typeof(p_details->'services') is distinct from 'array'
    or coalesce(jsonb_array_length(case when jsonb_typeof(p_details->'services') = 'array' then p_details->'services' else '[]'::jsonb end), 0) = 0
    or jsonb_array_length(case when jsonb_typeof(p_details->'services') = 'array' then p_details->'services' else '[]'::jsonb end) > 7
    or exists (
      select 1
      from jsonb_array_elements_text(case when jsonb_typeof(p_details->'services') = 'array' then p_details->'services' else '[]'::jsonb end) as selected_service(value)
      where selected_service.value not in ('Inbox management', 'Scheduling', 'General admin', 'Social media', 'Research', 'Bookkeeping', 'Other')
    )
    or coalesce(p_details->>'hoursPerWeek', '') not in ('Under 10 hours', '10–20 hours', '20–30 hours', '30–40 hours', '40+ hours')
    or coalesce(p_details->>'preferredChannel', '') not in ('Slack', 'WhatsApp', 'Telegram', 'Email')
    or coalesce(p_details->>'startDate', '') <> '' and p_details->>'startDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or coalesce(p_details->>'responseTime', '') not in ('', 'Within 1 hour', 'Within the same business day', 'Within 24 hours', 'Within 2 business days')
    or length(coalesce(p_details->>'blackoutDates', '')) > 1000
    or coalesce(p_details->>'accessMethod', '') not in ('', 'Password manager', 'Delegated/shared access', 'Discuss on kickoff call')
    or length(coalesce(p_details->>'backupName', '')) > 120
    or length(coalesce(p_details->>'backupEmail', '')) > 254
    or coalesce(p_details->>'backupEmail', '') <> '' and p_details->>'backupEmail' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or length(coalesce(p_details->>'backupPhone', '')) > 32
    or coalesce(p_details->>'backupPhone', '') <> '' and (
      p_details->>'backupPhone' !~ '^[0-9][0-9 ().+/-]*$'
      or length(regexp_replace(p_details->>'backupPhone', '[^0-9]', '', 'g')) not between 4 and 15
    )
    or (
      coalesce(p_details->>'backupName', '') <> ''
      or coalesce(p_details->>'backupEmail', '') <> ''
      or coalesce(p_details->>'backupPhone', '') <> ''
    ) and (
      coalesce(p_details->>'backupName', '') = ''
      or coalesce(p_details->>'backupEmail', '') = '' and coalesce(p_details->>'backupPhone', '') = ''
    )
    or coalesce(p_details->>'approval', '') <> '' and length(p_details->>'approval') > 1000
    or p_details->>'agreement' is distinct from 'true' then
    raise exception 'Check the required fields and their maximum lengths.';
  end if;

  select * into invite
  from public.client_onboarding_invites as onboarding_invite
  where onboarding_invite.token_hash = p_token_hash
    and onboarding_invite.revoked_at is null
    and onboarding_invite.submitted_at is null
    and onboarding_invite.expires_at > now()
  for update;

  if not found then
    return false;
  end if;

  insert into public.client_onboarding_submissions (
    user_id, client_id, client_name, client_email, contact_name, phone, timezone, availability, tools, priorities, details
  ) values (
    invite.user_id, invite.client_id, invite.client_name, invite.client_email,
    btrim(p_contact_name), btrim(p_phone), btrim(p_timezone),
    btrim(p_availability), coalesce(btrim(p_tools), ''), btrim(p_priorities), p_details
  )
  on conflict (user_id, client_id) do update set
    client_name = excluded.client_name,
    client_email = excluded.client_email,
    contact_name = excluded.contact_name,
    phone = excluded.phone,
    timezone = excluded.timezone,
    availability = excluded.availability,
    tools = excluded.tools,
    priorities = excluded.priorities,
    details = excluded.details,
    submitted_at = now();

  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then
    return false;
  end if;

  update public.client_onboarding_invites
  set submitted_at = now()
  where user_id = invite.user_id and client_id = invite.client_id;

  return true;
end;
$$;

revoke all on function public.submit_client_onboarding(text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_client_onboarding(text, text, text, text, text, text, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
