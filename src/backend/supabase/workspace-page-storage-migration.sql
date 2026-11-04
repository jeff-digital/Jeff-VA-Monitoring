-- Phase 1: page storage contract. No data is moved, deleted or split into new tables.
-- Run this before deploying clients that use /api/workspace.
create or replace function public.get_workspace_record(p_collection text, p_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise insufficient_privilege using message = 'Sign in first'; end if;
  if p_collection is null or p_collection not in ('applications','toApply','dailyTasks','clientTasks','socialTrends','emails','alerts','emailTemplates','personalDocuments','invoices','scripts','workLinks','walletEntries','subscriptions','accountSignInHistory') then raise exception 'Unknown collection'; end if;
  select item into result from public.app_state as workspace,
    lateral jsonb_array_elements(coalesce(workspace.data->p_collection, '[]'::jsonb)) as rows(item)
    where workspace.user_id = auth.uid() and item->>'id' = p_id limit 1;
  return result;
end;
$$;
revoke all on function public.get_workspace_record(text,text) from public, anon;
grant execute on function public.get_workspace_record(text,text) to authenticated;

create or replace function public.apply_workspace_changes(p_changes jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  workspace jsonb;
  change jsonb;
  field text;
  kind text;
  record_id text;
  collection jsonb;
  current_value jsonb;
  base_value jsonb;
  next_value jsonb;
  revision timestamptz;
  entry jsonb;
  rebuilt jsonb;
  inserted boolean;
  allowed text[] := array['applications','toApply','dailyTasks','clientTasks','socialTrends','emails','deletedGmailIds','alerts','clearedNotificationKeys','onboardingSubmissionIds','emailTemplates','personalDocuments','invoices','scripts','workLinks','walletEntries','subscriptions','accountSignInHistory','weeklyActivityGoal','emailTaskAiUsage'];
begin
  if owner_id is null then raise insufficient_privilege using message = 'Sign in first'; end if;
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) > 100 then raise exception 'Invalid changes'; end if;
  insert into public.app_state(user_id, data) values(owner_id, '{}'::jsonb) on conflict (user_id) do nothing;
  select data into workspace from public.app_state where user_id = owner_id for update;
  for change in select value from jsonb_array_elements(p_changes) loop
    field := change->>'key'; kind := change->>'type'; record_id := change->>'id';
    if field is null or not (field = any(allowed)) or kind is null or kind not in ('set','put','remove','order') or not (change ? 'base') then raise exception 'Invalid change'; end if;
    base_value := change->'base';
    if kind = 'order' then
      next_value := change->'value';
      if field in ('weeklyActivityGoal','emailTaskAiUsage') or jsonb_typeof(next_value) is distinct from 'array' then raise exception 'Invalid order'; end if;
      if exists(select 1 from jsonb_array_elements(next_value) as ids(id) where jsonb_typeof(id) <> 'string' or length(id#>>'{}') > 512)
        or jsonb_array_length(next_value) <> (select count(distinct id) from jsonb_array_elements(next_value) as ids(id)) then raise exception 'Invalid order'; end if;
      collection := coalesce(workspace->field, '[]'::jsonb);
      select coalesce(jsonb_agg(item order by rank), '[]'::jsonb) into collection from (
        select item, desired.position as rank from jsonb_array_elements(next_value) with ordinality as desired(id,position)
          join jsonb_array_elements(collection) as rows(item) on item->>'id' = desired.id#>>'{}'
        union all
        select item, jsonb_array_length(next_value) + position as rank from jsonb_array_elements(collection) with ordinality as rows(item,position)
          where not exists (select 1 from jsonb_array_elements(next_value) as desired(id) where item->>'id' = desired.id#>>'{}')
      ) as ordered;
      workspace := jsonb_set(workspace, array[field], collection, true);
    elsif kind = 'set' then
      if not (change ? 'value') then raise exception 'Missing value'; end if;
      next_value := change->'value';
      if field not in ('weeklyActivityGoal','emailTaskAiUsage') and jsonb_typeof(next_value) is distinct from 'array' then raise exception 'Expected collection'; end if;
      current_value := coalesce(workspace->field, 'null'::jsonb);
      if current_value is distinct from base_value and current_value is distinct from next_value then raise sqlstate '40001' using message = 'Workspace conflict'; end if;
      workspace := jsonb_set(workspace, array[field], next_value, true);
    else
      if field in ('weeklyActivityGoal','emailTaskAiUsage') or coalesce(record_id,'') = '' or length(record_id) > 512 then raise exception 'Invalid record'; end if;
      collection := coalesce(workspace->field, '[]'::jsonb);
      if jsonb_typeof(collection) is distinct from 'array' then raise exception 'Expected collection'; end if;
      select item into current_value from jsonb_array_elements(collection) as rows(item) where item->>'id' = record_id limit 1;
      current_value := coalesce(current_value, 'null'::jsonb);
      next_value := case when kind = 'remove' then 'null'::jsonb else change->'value' end;
      if kind = 'put' and (jsonb_typeof(next_value) is distinct from 'object' or next_value->>'id' is distinct from record_id) then raise exception 'Invalid record value'; end if;
      if current_value is distinct from base_value and current_value is distinct from next_value then raise sqlstate '40001' using message = 'Record conflict'; end if;
      if kind = 'remove' then
        select coalesce(jsonb_agg(item order by position), '[]'::jsonb) into collection from jsonb_array_elements(collection) with ordinality as rows(item,position) where item->>'id' is distinct from record_id;
      elsif current_value = 'null'::jsonb then
        rebuilt := '[]'::jsonb; inserted := false;
        for entry in select value from jsonb_array_elements(collection) loop
          if not inserted and entry->>'id' = change->>'beforeId' then rebuilt := rebuilt || jsonb_build_array(next_value); inserted := true; end if;
          rebuilt := rebuilt || jsonb_build_array(entry);
        end loop;
        if not inserted then rebuilt := rebuilt || jsonb_build_array(next_value); end if;
        collection := rebuilt;
      else
        select jsonb_agg(case when item->>'id' = record_id then next_value else item end order by position) into collection from jsonb_array_elements(collection) with ordinality as rows(item,position);
      end if;
      workspace := jsonb_set(workspace, array[field], collection, true);
    end if;
  end loop;
  revision := clock_timestamp();
  update public.app_state set data = workspace, updated_at = revision where user_id = owner_id;
  return jsonb_build_object('saved', true, 'revision', revision);
end;
$$;
revoke all on function public.apply_workspace_changes(jsonb) from public, anon;
grant execute on function public.apply_workspace_changes(jsonb) to authenticated;
