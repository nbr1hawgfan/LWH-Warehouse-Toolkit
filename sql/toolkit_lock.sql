-- Toolkit sign-in lock (Warehouse Toolkit v1.80.0) — project tjivcqxnkftujceumdtx (LWH Companion)
-- APPLIED Nov 6, 2026. Kept here for reference.
--
-- The Toolkit's data functions (inventory, transactions, bays, load scans, outbound, forklift
-- certs, hours…) only answer requests that carry a signed-in employee session in the
-- `x-lwh-session` header (employee ID + PIN, same sign-in as Messages).
--
-- How: PostgREST runs public.lwh_check_request() before every Data API request. If the request is
-- for a function listed in lwh_protected_rpcs and the switch is on, it needs a valid session.
-- The three CSV exports (master-lookup-csv, transaction-history-csv, load-details-csv) check the
-- same session through lwh_session_check().
--
-- ON / OFF switch (instant, no app change needed):
--   update lwh_settings set enforce = false where id = 1;   -- open everything back up
--   update lwh_settings set enforce = true  where id = 1;   -- lock
-- Remove the pre-request hook completely (last resort):
--   alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';
--
-- Deliberately NOT locked (used by other apps or must stay public):
--   emp_login / emp_create_pin / emp_logout (sign-in; Employee Timesheet app), whm_* (own checks),
--   log_app_usage (every app), os_inbound_sync (OneSource Inbound app), fc_verify (QR on forklift
--   wallet cards), fc_mail_* (forklift mailer script), spotter-timesheets-csv (Transportation Manager).

create table if not exists public.lwh_settings (
  id       int primary key default 1 check (id = 1),
  enforce  boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.lwh_settings (id, enforce) values (1, false) on conflict (id) do nothing;
alter table public.lwh_settings enable row level security;

create table if not exists public.lwh_protected_rpcs (
  fn    text primary key,
  note  text
);
alter table public.lwh_protected_rpcs enable row level security;

insert into public.lwh_protected_rpcs (fn, note) values
  ('get_item_inventory_summary','Inventory lookup'),
  ('get_item_transaction_summary','Item transaction lookup'),
  ('get_inventory_health','Data health'),
  ('get_transaction_health','Data health'),
  ('get_pallets_by_location','Inventory by location (no app uses it; locked as inventory data)'),
  ('toolkit_aging_pallets','Aging'),
  ('toolkit_bay_add','Bay Scan'),('toolkit_bay_clear','Bay Scan'),('toolkit_bay_contents','Bay Scan'),
  ('toolkit_bay_list','Bay Scan'),('toolkit_bay_rename','Bay Scan'),('toolkit_bay_retire','Bay Scan'),
  ('toolkit_bay_scan','Bay Scan'),('toolkit_bay_tag_lookup','Bay Scan'),('toolkit_bay_update','Bay Scan'),
  ('toolkit_fifo_item','FIFO'),
  ('toolkit_load_scan_records','Load Tag Scan'),('toolkit_save_load_scan','Load Tag Scan'),
  ('toolkit_manager_week_hours','Hours (manager)'),('toolkit_my_week_hours','My Hours'),
  ('toolkit_timeclock_exceptions','Missed Punches'),
  ('toolkit_outbound_lookups','Outbound'),('toolkit_outbound_manage','Outbound'),('toolkit_outbound_records','Outbound'),
  ('toolkit_outbound_save','Outbound'),('toolkit_outbound_shipped_ids','Outbound'),('toolkit_outbound_verify','Outbound'),
  ('fc_lookup_employee','Forklift test'),('fc_start_test','Forklift test'),('fc_submit_test','Forklift test'),
  ('fc_training_start','Forklift training'),('fc_training_module','Forklift training'),('fc_training_finish','Forklift training'),
  ('fc_mgr_dashboard','Forklift certs (manager)'),('fc_mgr_employees','Forklift certs (manager)'),('fc_mgr_hide_employees','Forklift certs (manager)'),
  ('fc_mgr_mail_token','Forklift certs (manager)'),('fc_mgr_practical','Forklift certs (manager)'),('fc_mgr_revoke','Forklift certs (manager)'),
  ('fc_mgr_save_manager','Forklift certs (manager)'),('fc_mgr_save_question','Forklift certs (manager)'),('fc_mgr_save_settings','Forklift certs (manager)'),
  ('fc_mgr_training','Forklift certs (manager)'),('fc_mgr_update_cert','Forklift certs (manager)'),('fc_mgr_waive_training','Forklift certs (manager)')
on conflict (fn) do update set note = excluded.note;

-- The signed-in employee for this Data API request (from the x-lwh-session header), or null.
create or replace function public.lwh_request_emp()
returns integer language plpgsql stable security definer set search_path = public, extensions as $$
declare h json;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then return null; end;
  if h is null then return null; end if;
  return whm_session_emp(h->>'x-lwh-session');
end $$;

-- Used by the CSV export functions (service role). Returns ok when the switch is off or the
-- session is valid; keeps active sessions alive (30 days from last use).
create or replace function public.lwh_session_check(p_token text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v int; v_enforce boolean;
begin
  select enforce into v_enforce from lwh_settings where id = 1;
  v := whm_session_emp(p_token);
  if v is not null then
    update emp_sessions set expires_at = now() + interval '30 days'
     where token_hash = encode(digest(p_token,'sha256'),'hex') and expires_at < now() + interval '29 days';
  end if;
  return json_build_object('ok', v is not null or not coalesce(v_enforce,false), 'emp_id', v, 'enforce', coalesce(v_enforce,false));
end $$;

-- Pre-request hook. Never breaks a request on its own errors — it only blocks a protected function
-- when the switch is on and there is no valid session.
create or replace function public.lwh_check_request()
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_path text; v_fn text; v_tok text; v_emp int; v_block boolean := false; v_method text;
begin
  begin
    v_role := coalesce(nullif(current_setting('request.jwt.claims', true),'')::json->>'role','');
    if v_role = 'service_role' then return; end if;
    v_path := coalesce(current_setting('request.path', true),'');
    if v_path !~ '^/?rpc/' then return; end if;
    v_fn := regexp_replace(v_path,'^/?rpc/','');
    if not exists (select 1 from lwh_protected_rpcs where fn = v_fn) then return; end if;
    if not coalesce((select enforce from lwh_settings where id = 1), false) then return; end if;
    v_tok := nullif(current_setting('request.headers', true),'')::json->>'x-lwh-session';
    v_emp := whm_session_emp(v_tok);
    if v_emp is null then
      v_block := true;
    else
      v_method := coalesce(current_setting('request.method', true),'');
      if v_method not in ('GET','HEAD') then
        update emp_sessions set expires_at = now() + interval '30 days'
         where token_hash = encode(digest(v_tok,'sha256'),'hex') and expires_at < now() + interval '29 days';
      end if;
    end if;
  exception when others then
    return;
  end;
  if v_block then
    raise sqlstate 'PGRST' using
      message = json_build_object('code','LWH401','message','sign_in_required','hint','Sign in to the Warehouse Toolkit.')::text,
      detail  = json_build_object('status',401)::text;
  end if;
end $$;

-- My Hours: once locked, people see their own hours (managers on the list can look anyone up).
create or replace function public.toolkit_my_week_hours(p_emp_id integer, p_week_date date default current_date)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_start   date := p_week_date - extract(dow from p_week_date)::int;
  v_end     date := v_start + 6;
  v_first   text;
  v_full    text;
  v_punches json;
  v_synced  timestamptz;
  v_me      int;
begin
  if coalesce((select enforce from lwh_settings where id = 1), false) then
    v_me := lwh_request_emp();
    if v_me is null or (v_me <> p_emp_id and not whm_is_manager(v_me)) then
      return json_build_object('found', false, 'error', 'own_hours_only');
    end if;
  end if;

  select e.first_name, e.full_name into v_first, v_full
    from emp_employees e where e.emp_id = p_emp_id order by e.is_active desc nulls last limit 1;

  if not found and not exists (select 1 from emp_punches where emp_id = p_emp_id) then
    return json_build_object('found', false);
  end if;

  select coalesce(json_agg(json_build_object(
           'date',  p.clock_in_date,
           'in',    to_char(p.clocked_in,  'YYYY-MM-DD"T"HH24:MI:SS'),
           'out',   to_char(p.clocked_out, 'YYYY-MM-DD"T"HH24:MI:SS'),
           'hours', p.worked_hours
         ) order by p.clocked_in), '[]'::json)
    into v_punches
  from (select distinct on (log_id) log_id, clock_in_date, clocked_in, clocked_out, worked_hours
          from emp_punches where emp_id = p_emp_id and clock_in_date between v_start and v_end order by log_id) p;

  select max(last_synced_at) into v_synced from emp_sync_meta;

  return json_build_object('found', true, 'first_name', v_first, 'full_name', v_full,
    'week_start', v_start, 'week_end', v_end, 'last_synced_at', v_synced, 'punches', v_punches);
end $$;

revoke all on function public.lwh_request_emp()        from public, anon, authenticated;
revoke all on function public.lwh_session_check(text)   from public, anon, authenticated;
grant execute on function public.lwh_session_check(text) to service_role;
revoke all on function public.lwh_check_request()       from public;
grant execute on function public.lwh_check_request()    to anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request = 'public.lwh_check_request';
notify pgrst, 'reload config';
