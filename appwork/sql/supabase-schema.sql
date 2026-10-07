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

-- Onboarding links and answers are only available to the server-side Pages Function.
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

alter table public.client_onboarding_invites enable row level security;
alter table public.client_onboarding_submissions enable row level security;
revoke all on public.client_onboarding_invites from public, anon, authenticated;
revoke all on public.client_onboarding_submissions from public, anon, authenticated;
grant select, insert, update, delete on public.client_onboarding_invites to service_role;
grant select, insert, update, delete on public.client_onboarding_submissions to service_role;

create or replace function public.issue_client_onboarding_invite(
  p_user_id uuid,
  p_client_id text,
  p_client_name text,
  p_client_email text,
  p_token_hash text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  issued boolean;
begin
  insert into public.client_onboarding_invites (
    user_id, client_id, client_name, client_email, token_hash, expires_at, submitted_at, revoked_at, created_at
  ) values (
    p_user_id, p_client_id, p_client_name, p_client_email, p_token_hash, p_expires_at, null, null, now()
  )
  on conflict (user_id, client_id) do update set
    client_name = excluded.client_name,
    client_email = excluded.client_email,
    token_hash = excluded.token_hash,
    expires_at = excluded.expires_at,
    revoked_at = null,
    created_at = now()
  where public.client_onboarding_invites.submitted_at is null
  returning true into issued;

  return coalesce(issued, false);
end;
$$;

create or replace function public.submit_client_onboarding(
  p_token_hash text,
  p_contact_name text,
  p_phone text,
  p_timezone text,
  p_availability text,
  p_tools text,
  p_priorities text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite public.client_onboarding_invites%rowtype;
begin
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
    user_id, client_id, client_name, client_email, contact_name, phone, timezone, availability, tools, priorities
  ) values (
    invite.user_id, invite.client_id, invite.client_name, invite.client_email,
    p_contact_name, p_phone, p_timezone, p_availability, p_tools, p_priorities
  )
  on conflict (user_id, client_id) do nothing;

  if not found then
    return false;
  end if;

  update public.client_onboarding_invites
  set submitted_at = now()
  where user_id = invite.user_id and client_id = invite.client_id;

  return true;
end;
$$;

revoke all on function public.issue_client_onboarding_invite(uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.submit_client_onboarding(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.issue_client_onboarding_invite(uuid, text, text, text, text, timestamptz) to service_role;
grant execute on function public.submit_client_onboarding(text, text, text, text, text, text, text) to service_role;

-- Private bucket for PDF/Word client documents.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-documents',
  'client-documents',
  false,
  26214400,
  array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']::text[]
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
