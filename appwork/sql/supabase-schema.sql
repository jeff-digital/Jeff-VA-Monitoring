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
