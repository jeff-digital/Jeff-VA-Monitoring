-- Jeff VA / Client Compass
-- Run this in Supabase Dashboard -> SQL Editor.
-- This creates one private JSON state row per authenticated user and a private document bucket.

create table if not exists public.app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"applications":[],"emails":[],"alerts":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_state'
  ) then
    alter publication supabase_realtime add table public.app_state;
  end if;
end $$;

alter table public.app_state enable row level security;

-- Re-running the script is safe.
drop policy if exists "Users can read their own app state" on public.app_state;
drop policy if exists "Users can insert their own app state" on public.app_state;
drop policy if exists "Users can update their own app state" on public.app_state;
drop policy if exists "Users can delete their own app state" on public.app_state;

create policy "Users can read their own app state"
  on public.app_state for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert their own app state"
  on public.app_state for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own app state"
  on public.app_state for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own app state"
  on public.app_state for delete
  to authenticated
  using (auth.uid() = user_id);

-- Onboarding data is isolated from app_state. Public clients can only use
-- token-scoped functions; neither public role receives direct table access.
create table if not exists public.client_onboarding_invites (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  client_name text not null,
  client_email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  submitted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, client_id)
);

create table if not exists public.client_onboarding_submissions (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  client_name text not null,
  client_email text not null,
  contact_name text not null,
  phone text not null default '',
  timezone text not null,
  availability text not null,
  tools text not null default '',
  priorities text not null,
  submitted_at timestamptz not null default now(),
  primary key (user_id, client_id)
);

alter table public.client_onboarding_submissions
  add column if not exists details jsonb not null default '{}'::jsonb;

alter table public.client_onboarding_invites enable row level security;
alter table public.client_onboarding_submissions enable row level security;
revoke all on public.client_onboarding_invites from public, anon, authenticated, service_role;
revoke all on public.client_onboarding_submissions from public, anon, authenticated, service_role;

drop function if exists public.issue_client_onboarding_invite(uuid, text, text, text, text, timestamptz);
drop function if exists public.get_client_onboarding_submission(text);
drop function if exists public.lookup_client_onboarding_invite(text);
drop function if exists public.get_client_onboarding_submissions();
drop function if exists public.submit_client_onboarding(text, text, text, text, text, text, text);

create or replace function public.issue_client_onboarding_invite(p_client_id text, p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  client_name text;
  client_email text;
  issued boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in to create an onboarding invitation.';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid onboarding token.';
  end if;

  select application->>'clientName', application->>'email'
  into client_name, client_email
  from public.app_state as state
  cross join lateral jsonb_array_elements(coalesce(state.data->'applications', '[]'::jsonb)) as applications(application)
  where state.user_id = auth.uid()
    and applications.application->>'id' = p_client_id
    and applications.application->>'status' = 'Active client'
  limit 1;

  if client_name is null or client_email is null or client_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Add an email address to an active client before creating an onboarding invitation.';
  end if;

  insert into public.client_onboarding_invites (
    user_id, client_id, client_name, client_email, token_hash, expires_at, submitted_at, revoked_at, created_at
  ) values (
    auth.uid(), p_client_id, client_name, client_email, p_token_hash, now() + interval '14 days', null, null, now()
  )
  on conflict (user_id, client_id) do update set
    client_name = excluded.client_name,
    client_email = excluded.client_email,
    token_hash = excluded.token_hash,
    expires_at = excluded.expires_at,
    submitted_at = null,
    revoked_at = null,
    created_at = now()
  returning true into issued;

  return coalesce(issued, false);
end;
$$;

create or replace function public.get_client_onboarding_submission(p_client_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view client onboarding.';
  end if;

  select to_jsonb(submission)
  into result
  from public.client_onboarding_submissions as submission
  where submission.user_id = auth.uid()
    and submission.client_id = p_client_id
    and exists (
      select 1
      from public.app_state as state
      cross join lateral jsonb_array_elements(coalesce(state.data->'applications', '[]'::jsonb)) as applications(application)
      where state.user_id = auth.uid()
        and applications.application->>'id' = p_client_id
        and applications.application->>'status' = 'Active client'
    );

  return result;
end;
$$;

create or replace function public.get_client_onboarding_submissions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view client onboarding.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'client_id', submission.client_id,
    'client_name', submission.client_name,
    'client_email', submission.client_email,
    'timezone', submission.timezone,
    'submitted_at', submission.submitted_at
  ) order by submission.submitted_at desc), '[]'::jsonb)
  into result
  from public.client_onboarding_submissions as submission
  where submission.user_id = auth.uid()
    and exists (
      select 1
      from public.app_state as state
      cross join lateral jsonb_array_elements(coalesce(state.data->'applications', '[]'::jsonb)) as applications(application)
      where state.user_id = auth.uid()
        and applications.application->>'id' = submission.client_id
        and applications.application->>'status' = 'Active client'
    );

  return result;
end;
$$;

create or replace function public.lookup_client_onboarding_invite(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select jsonb_build_object('client_name', invite.client_name, 'client_email', invite.client_email)
  into result
  from public.client_onboarding_invites as invite
  where invite.token_hash = p_token_hash
    and invite.revoked_at is null
    and invite.submitted_at is null
    and invite.expires_at > now();

  return result;
end;
$$;

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
    btrim(p_contact_name), coalesce(btrim(p_phone), ''), btrim(p_timezone),
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

revoke all on function public.issue_client_onboarding_invite(text, text) from public, anon, authenticated;
revoke all on function public.get_client_onboarding_submission(text) from public, anon, authenticated;
revoke all on function public.get_client_onboarding_submissions() from public, anon, authenticated;
revoke all on function public.lookup_client_onboarding_invite(text) from public, anon, authenticated;
revoke all on function public.submit_client_onboarding(text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.issue_client_onboarding_invite(text, text) to authenticated;
grant execute on function public.get_client_onboarding_submission(text) to authenticated;
grant execute on function public.get_client_onboarding_submissions() to authenticated;
grant execute on function public.lookup_client_onboarding_invite(text) to anon, authenticated;
grant execute on function public.submit_client_onboarding(text, text, text, text, text, text, text, jsonb) to anon, authenticated;

-- Private bucket for client documents and profile photos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-documents',
  'client-documents',
  false,
  26214400,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Files are stored under: <authenticated-user-uuid>/<document-uuid>
drop policy if exists "Users can upload their own client documents" on storage.objects;
drop policy if exists "Users can read their own client documents" on storage.objects;
drop policy if exists "Users can update their own client documents" on storage.objects;
drop policy if exists "Users can delete their own client documents" on storage.objects;

create policy "Users can upload their own client documents"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can read their own client documents"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update their own client documents"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete their own client documents"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Authenticated users can read project-wide storage totals without seeing object names.
create or replace function public.get_project_storage_usage()
returns table (total_bytes bigint, file_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(case
      when (stored_object.metadata->>'size') ~ '^[0-9]+$' then (stored_object.metadata->>'size')::bigint
      else 0
    end), 0)::bigint,
    count(*)::bigint
  from storage.objects as stored_object;
$$;

revoke all on function public.get_project_storage_usage() from public;
revoke all on function public.get_project_storage_usage() from anon;
grant execute on function public.get_project_storage_usage() to authenticated;
