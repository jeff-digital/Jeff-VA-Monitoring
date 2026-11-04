-- Run once in the Supabase SQL Editor before enabling background follow-ups.
-- Only the Cloudflare server's service-role key may call this function.
-- Lock and merge one receipt rather than overwriting the browser's workspace.
create or replace function public.background_follow_up_snapshot(
  p_user_id uuid, p_application_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace jsonb;
  applications jsonb;
begin
  select data into workspace from public.app_state where user_id = p_user_id;
  if workspace is null then return null; end if;
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', item->'id', 'clientName', item->'clientName', 'contact', item->'contact',
    'role', item->'role', 'platform', item->'platform', 'email', item->'email',
    'appliedDate', item->'appliedDate', 'followUpDate', item->'followUpDate',
    'followUpSentAt', item->'followUpSentAt', 'followUpGmailId', item->'followUpGmailId',
    'automaticFollowUp', item->'automaticFollowUp', 'status', item->'status',
    'location', item->'location', 'clientTimeZone', item->'clientTimeZone',
    'timeZone', item->'timeZone', 'timezone', item->'timezone'
  ))), '[]'::jsonb) into applications
  from jsonb_array_elements(coalesce(workspace->'applications', '[]'::jsonb)) as rows(item)
  where case when p_application_id is not null then item->>'id' = p_application_id
    else item->>'automaticFollowUp' = 'true' and coalesce(item->>'followUpDate', '') <> ''
      and coalesce(item->>'status', '') not in ('Active client', 'Not selected') end;
  return jsonb_build_object('applications', applications);
end;
$$;
revoke all on function public.background_follow_up_snapshot(uuid, text) from public, anon, authenticated;
grant execute on function public.background_follow_up_snapshot(uuid, text) to service_role;

create or replace function public.record_background_follow_up(
  p_user_id uuid,
  p_application_id text default null,
  p_scheduled_date text default null,
  p_sent_at timestamptz default null,
  p_gmail_id text default null,
  p_subject text default null,
  p_body text default null,
  p_recipient text default null,
  p_check_only boolean default false
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace jsonb;
  applications jsonb;
  application jsonb;
  emails jsonb;
  alerts jsonb;
  alert_id text;
  client_name text;
begin
  if p_check_only then return true; end if;
  if p_user_id is null or coalesce(p_application_id, '') = ''
    or coalesce(p_scheduled_date, '') !~ '^\d{4}-\d{2}-\d{2}$'
    or p_sent_at is null or p_subject is null or p_body is null or p_recipient is null then
    raise exception 'Invalid follow-up receipt';
  end if;
  select data into workspace from public.app_state where user_id = p_user_id for update;
  -- Account/workspace deletion must not recreate it from a background result.
  if workspace is null then return true; end if;
  applications := coalesce(workspace->'applications', '[]'::jsonb);
  select item into application from jsonb_array_elements(applications) as rows(item)
    where item->>'id' = p_application_id limit 1;
  if application is null then return true; end if;
  client_name := coalesce(application->>'clientName', 'Client');
  -- A newly scheduled date must not be cleared by an older delivery.
  if application->>'followUpDate' = p_scheduled_date then
    select jsonb_agg(case when item->>'id' = p_application_id then
      item || jsonb_build_object('followUpSentAt', p_sent_at, 'followUpGmailId', coalesce(p_gmail_id, ''),
        'followUpProcessedAt', p_sent_at, 'followUpDate', '', 'automaticFollowUp', false)
      else item end order by position)
      into applications from jsonb_array_elements(applications) with ordinality as rows(item, position);
    workspace := jsonb_set(workspace, '{applications}', applications);
  end if;
  emails := coalesce(workspace->'emails', '[]'::jsonb);
  if not exists (select 1 from jsonb_array_elements(emails) as rows(item)
    where (coalesce(p_gmail_id, '') <> '' and item->>'gmailId' = p_gmail_id)
      or item->>'id' = 'background-follow-up|' || p_application_id || '|' || p_scheduled_date) then
    emails := jsonb_build_array(jsonb_build_object(
      'id', 'background-follow-up|' || p_application_id || '|' || p_scheduled_date,
      'gmailId', coalesce(p_gmail_id, ''), 'applicationId', p_application_id, 'emailType', 'follow-up',
      'from', 'You', 'to', p_recipient, 'subject', p_subject, 'body', p_body,
      'date', p_sent_at, 'importedAt', clock_timestamp(), 'source', 'gmail', 'direction', 'sent')) || emails;
  end if;
  alert_id := 'follow-up|' || p_application_id || '|' || p_scheduled_date;
  alerts := coalesce(workspace->'alerts', '[]'::jsonb);
  if not exists (select 1 from jsonb_array_elements(alerts) as rows(item)
    where item->>'id' = alert_id and item->>'deliveryStatus' = 'sent') then
    select coalesce(jsonb_agg(item), '[]'::jsonb) into alerts
      from jsonb_array_elements(alerts) as rows(item) where item->>'id' is distinct from alert_id;
    alerts := jsonb_build_array(jsonb_build_object('id', alert_id, 'clientName', client_name,
      'subject', 'Automatic follow-up sent: ' || p_subject, 'from', 'Jeff VA', 'date', p_sent_at,
      'deliveryStatus', 'sent', 'deliveryReason', '', 'unread', true)) || alerts;
  end if;
  workspace := jsonb_set(jsonb_set(workspace, '{emails}', emails), '{alerts}', alerts);
  update public.app_state set data = workspace, updated_at = clock_timestamp() where user_id = p_user_id;
  return true;
end;
$$;
revoke all on function public.record_background_follow_up(uuid, text, text, timestamptz, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.record_background_follow_up(uuid, text, text, timestamptz, text, text, text, text, boolean) to service_role;
