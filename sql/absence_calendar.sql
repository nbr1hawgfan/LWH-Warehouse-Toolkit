-- Absence Calendar (Warehouse Toolkit v1.82.0) — project tjivcqxnkftujceumdtx (LWH Companion)
--
-- PTO & absence data from the "New PTO and Attendance Tracker" Google Sheet, for the Toolkit's
-- Absence Calendar (managers only).
--
-- Feed: PTO_Supabase_Push.gs (its own script file in the tracker, its own hourly timer) reads the
-- Export_PTORequests / Export_Employees / Export_AbsenceTypes tabs and calls pto_sync_push().
-- Nothing in the tracker, PTO_TLand_Export.gs, Sync-PTO.ps1 or TLand changes.
--
-- Only the columns the calendar needs are pushed (no emails, no PINs).
-- Tables are RLS-locked with no policies: the only way in is the two functions below.
--   pto_sync_push(secret, …)       — the sheet's push; checked against a stored secret hash
--   toolkit_absence_calendar()     — Toolkit sign-in required AND on the warehouse manager list
--
-- Rotate the push secret:
--   update pto_sync_meta set secret_hash = encode(digest('NEW-SECRET','sha256'),'hex') where id = 1;
--   then paste NEW-SECRET into the tracker's Script Properties (PTO_SUPABASE_SECRET).

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.pto_requests (
  id            bigserial primary key,
  employee_id   text not null,
  employee_name text,
  absence_type  text,
  start_date    date,
  end_date      date,
  status        text,
  days_count    numeric,
  synced_at     timestamptz not null default now()
);
create index if not exists pto_requests_dates on public.pto_requests (start_date, end_date);

create table if not exists public.pto_employees (
  employee_id     text primary key,
  name            text,
  department      text,
  manager         text,
  pto_balance     numeric,
  pto_allocation  numeric,
  employee_status text,
  synced_at       timestamptz not null default now()
);

create table if not exists public.pto_absence_types (
  name   text primary key,
  active boolean not null default true
);

create table if not exists public.pto_sync_meta (
  id          int primary key default 1 check (id = 1),
  secret_hash text not null,
  last_push   timestamptz,
  last_counts jsonb
);

alter table public.pto_requests      enable row level security;
alter table public.pto_employees     enable row level security;
alter table public.pto_absence_types enable row level security;
alter table public.pto_sync_meta     enable row level security;
revoke all on public.pto_requests, public.pto_employees, public.pto_absence_types, public.pto_sync_meta from anon, authenticated;

-- ---------------------------------------------------------------- push from the sheet
-- Full replace in one transaction: the Export_ tabs are the whole picture every time, so a request
-- deleted or edited in the sheet is corrected on the next push. Refuses an empty push (a broken
-- tab) instead of wiping the calendar.
create or replace function public.pto_sync_push(p_secret text, p_requests jsonb, p_employees jsonb, p_types jsonb)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text; nr int; ne int; nt int;
begin
  select secret_hash into v_hash from pto_sync_meta where id = 1;
  if v_hash is null or encode(digest(coalesce(p_secret,''),'sha256'),'hex') <> v_hash then
    return json_build_object('ok', false, 'error', 'bad_secret');
  end if;
  if jsonb_typeof(p_requests) <> 'array' or jsonb_typeof(p_employees) <> 'array' or jsonb_typeof(p_types) <> 'array' then
    return json_build_object('ok', false, 'error', 'bad_payload');
  end if;
  nr := jsonb_array_length(p_requests); ne := jsonb_array_length(p_employees); nt := jsonb_array_length(p_types);
  if ne = 0 or (nr = 0 and exists (select 1 from pto_requests)) then
    return json_build_object('ok', false, 'error', 'empty_push', 'requests', nr, 'employees', ne);
  end if;

  delete from pto_requests where true;
  insert into pto_requests (employee_id, employee_name, absence_type, start_date, end_date, status, days_count)
  select trim(r->>'EmployeeID'), nullif(trim(r->>'EmployeeName'),''), nullif(trim(r->>'AbsenceType'),''),
         case when r->>'StartDate' ~ '^\d{4}-\d{2}-\d{2}' then left(r->>'StartDate',10)::date end,
         case when r->>'EndDate'   ~ '^\d{4}-\d{2}-\d{2}' then left(r->>'EndDate',10)::date end,
         nullif(trim(r->>'Status'),''),
         case when r->>'DaysCount' ~ '^-?\d+(\.\d+)?$' then (r->>'DaysCount')::numeric end
    from jsonb_array_elements(p_requests) r
   where coalesce(trim(r->>'EmployeeID'),'') <> '';

  delete from pto_employees where true;
  insert into pto_employees (employee_id, name, department, manager, pto_balance, pto_allocation, employee_status)
  select distinct on (trim(e->>'EmployeeID'))
         trim(e->>'EmployeeID'), nullif(trim(e->>'Name'),''), nullif(trim(e->>'Department'),''), nullif(trim(e->>'Manager'),''),
         case when e->>'PTOBalance'    ~ '^-?\d+(\.\d+)?$' then (e->>'PTOBalance')::numeric end,
         case when e->>'PTOAllocation' ~ '^-?\d+(\.\d+)?$' then (e->>'PTOAllocation')::numeric end,
         nullif(trim(e->>'EmployeeStatus'),'')
    from jsonb_array_elements(p_employees) e
   where coalesce(trim(e->>'EmployeeID'),'') <> '';

  delete from pto_absence_types where true;
  insert into pto_absence_types (name, active)
  select distinct on (trim(t->>'AbsenceTypeName')) trim(t->>'AbsenceTypeName'), upper(coalesce(t->>'Active','TRUE')) = 'TRUE'
    from jsonb_array_elements(p_types) t
   where coalesce(trim(t->>'AbsenceTypeName'),'') <> '';

  update pto_sync_meta set last_push = now(),
         last_counts = jsonb_build_object('requests', nr, 'employees', ne, 'types', nt) where id = 1;
  return json_build_object('ok', true, 'requests', nr, 'employees', ne, 'types', nt);
end $$;

revoke all on function public.pto_sync_push(text, jsonb, jsonb, jsonb) from public;
grant execute on function public.pto_sync_push(text, jsonb, jsonb, jsonb) to anon;

-- ---------------------------------------------------------------- Toolkit read (managers only)
-- Approved + Pending requests from Jan 1 of last year forward (enough for the calendar and the
-- this-year balance history), plus employees and absence types.
create or replace function public.toolkit_absence_calendar()
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare v_emp int; v_from date := make_date(extract(year from current_date)::int - 1, 1, 1);
begin
  v_emp := lwh_request_emp();
  if v_emp is null then return json_build_object('ok', false, 'error', 'sign_in'); end if;
  if not whm_is_manager(v_emp) then return json_build_object('ok', false, 'error', 'not_manager'); end if;
  return json_build_object(
    'ok', true,
    'last_push', (select last_push from pto_sync_meta where id = 1),
    'requests', coalesce((select json_agg(json_build_object(
        'employee_id', r.employee_id, 'name', r.employee_name, 'type', r.absence_type,
        'start', r.start_date, 'end', coalesce(r.end_date, r.start_date), 'status', r.status, 'days', r.days_count)
        order by r.start_date)
      from pto_requests r
     where r.status in ('Approved','Pending') and r.start_date is not null
       and coalesce(r.end_date, r.start_date) >= v_from), '[]'::json),
    'employees', coalesce((select json_agg(json_build_object(
        'employee_id', e.employee_id, 'name', e.name, 'department', e.department, 'manager', e.manager,
        'balance', e.pto_balance, 'allocation', e.pto_allocation, 'status', e.employee_status) order by e.name)
      from pto_employees e), '[]'::json),
    'types', coalesce((select json_agg(t.name order by t.name) from pto_absence_types t where t.active), '[]'::json)
  );
end $$;

revoke all on function public.toolkit_absence_calendar() from public;
grant execute on function public.toolkit_absence_calendar() to anon, authenticated;

insert into public.lwh_protected_rpcs (fn, note) values ('toolkit_absence_calendar','Absence Calendar (manager)')
on conflict (fn) do update set note = excluded.note;
