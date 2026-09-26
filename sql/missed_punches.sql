-- ============================================================
-- LWH Toolkit v1.60.0 — Missed Punches + Everyone's Hours (managers)
-- Run this in the Supabase SQL Editor (same project as inventory).
--
-- >>> Passcode: set it in the Supabase SQL Editor only (see the bottom of
-- >>> this file). This repo is public — never save the real passcode here.
--
-- Creates:
--   toolkit_manager_access         — holds the manager passcode (hashed).
--                                    Locked down: not readable through the API.
--   toolkit_timeclock_exceptions() — the report. Checks the passcode, then
--                                    returns, for one Sunday–Saturday week:
--       * missing clock-out  — still "clocked in" longer than the hour limit
--       * missing clock-in   — a clock-out with no clock-in
--       * long shift         — a shift over the hour limit (default 10)
--       * no punches         — a weekday the employee usually works (3 of the
--                              previous 4 weeks) with no punches at all
--   After 10 wrong passcodes in a row the report locks for 10 minutes.
--
-- Safe to re-run. Re-running with the bottom line unchanged (CHANGE-ME)
-- leaves an existing passcode alone.
-- ============================================================

create table if not exists public.toolkit_manager_access (
  id               integer primary key default 1 check (id = 1),
  passcode_hash    text not null,
  failed_attempts  integer not null default 0,
  locked_until     timestamptz,
  updated_at       timestamptz not null default now()
);
alter table public.toolkit_manager_access enable row level security;  -- no policies = no API access
revoke all on public.toolkit_manager_access from anon, authenticated;


-- Shared passcode check for every manager report. Returns null when the
-- passcode is right, otherwise 'not_set_up' | 'locked' | 'bad_passcode'.
-- 10 wrong tries in a row locks all manager reports for 10 minutes.
-- Not callable from the app directly — only from inside the reports.
create or replace function public.toolkit_manager_check(p_passcode text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_acc toolkit_manager_access%rowtype;
begin
  select * into v_acc from toolkit_manager_access where id = 1 for update;
  if not found or v_acc.passcode_hash = encode(sha256(convert_to('CHANGE-ME', 'UTF8')), 'hex') then
    return 'not_set_up';
  end if;
  if v_acc.locked_until is not null and v_acc.locked_until > now() then
    return 'locked';
  end if;
  if encode(sha256(convert_to(coalesce(p_passcode, ''), 'UTF8')), 'hex') <> v_acc.passcode_hash then
    update toolkit_manager_access
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 10 then now() + interval '10 minutes' else null end
     where id = 1;
    return 'bad_passcode';
  end if;
  if v_acc.failed_attempts <> 0 or v_acc.locked_until is not null then
    update toolkit_manager_access set failed_attempts = 0, locked_until = null where id = 1;
  end if;
  return null;
end;
$$;
revoke all on function public.toolkit_manager_check(text) from public, anon, authenticated;

create or replace function public.toolkit_timeclock_exceptions(
  p_passcode   text,
  p_week_date  date    default null,
  p_max_hours  numeric default 10
)
returns json
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_now     timestamp := (now() at time zone 'America/Chicago');  -- timeclock stores local times
  v_today   date      := (now() at time zone 'America/Chicago')::date;
  v_date    date;
  v_start   date;
  v_end     date;
  v_limit   numeric   := least(greatest(coalesce(p_max_hours, 10), 4), 24);
  v_err     text;
  v_exc     json;
  v_missed  json;
  v_synced  timestamptz;
begin
  -- ---- passcode check (shared with the Everyone's Hours report) ----
  v_err := toolkit_manager_check(p_passcode);
  if v_err is not null then
    return json_build_object('ok', false, 'error', v_err);
  end if;

  -- ---- the week (Sunday–Saturday) ----
  v_date  := coalesce(p_week_date, v_today);
  v_start := v_date - extract(dow from v_date)::int;
  v_end   := v_start + 6;

  -- ---- punch problems ----
  with p as (
    select distinct on (log_id) log_id, emp_id, clock_in_date, clocked_in, clocked_out, worked_hours
    from emp_punches
    where clock_in_date between v_start and v_end
    order by log_id
  ),
  flagged as (
    select p.*,
           coalesce(p.worked_hours,
                    round((extract(epoch from (p.clocked_out - p.clocked_in)) / 3600)::numeric, 2)) as hrs,
           case
             when p.clocked_in is null and p.clocked_out is not null then 'missing_in'
             when p.clocked_in is not null and p.clocked_out is null
                  and p.clocked_in < v_now - make_interval(secs => (v_limit * 3600)::double precision) then 'missing_out'
             when p.clocked_out is not null
                  and coalesce(p.worked_hours,
                               extract(epoch from (p.clocked_out - p.clocked_in)) / 3600) > v_limit then 'long_shift'
           end as kind
    from p
  )
  select coalesce(json_agg(json_build_object(
           'emp_id',   f.emp_id,
           'name',     coalesce(e.full_name, 'ID ' || f.emp_id),
           'team',     e.team,
           'location', e.location,
           'date',     coalesce(f.clock_in_date, f.clocked_out::date),
           'kind',     f.kind,
           'in',       to_char(f.clocked_in,  'YYYY-MM-DD"T"HH24:MI:SS'),
           'out',      to_char(f.clocked_out, 'YYYY-MM-DD"T"HH24:MI:SS'),
           'hours',    f.hrs,
           'open_hours', case when f.kind = 'missing_out'
                              then round((extract(epoch from (v_now - f.clocked_in)) / 3600)::numeric, 1) end
         ) order by coalesce(e.full_name, f.emp_id::text), f.clocked_in), '[]'::json)
    into v_exc
  from flagged f
  left join lateral (select full_name, team, location from emp_employees x
                     where x.emp_id = f.emp_id order by x.is_active desc nulls last limit 1) e on true
  where f.kind is not null;

  -- ---- usual workdays with no punches (only days already over) ----
  with days as (
    select d::date as d from generate_series(v_start, least(v_end, v_today - 1), interval '1 day') d
  ),
  hist as (   -- which weekdays each person worked in the 4 weeks before this one
    select distinct emp_id, clock_in_date from emp_punches
    where clock_in_date between v_start - 28 and v_start - 1
  ),
  pattern as (
    select emp_id, extract(dow from clock_in_date)::int as dow, count(*) as weeks
    from hist group by 1, 2
  ),
  expected as (
    select pt.emp_id, dy.d, pt.weeks
    from pattern pt join days dy on extract(dow from dy.d)::int = pt.dow
    where pt.weeks >= 3
  ),
  worked as (
    select distinct emp_id, clock_in_date as d from emp_punches
    where clock_in_date between v_start and v_end
  ),
  missed as (
    select x.* from expected x
    where not exists (select 1 from worked w where w.emp_id = x.emp_id and w.d = x.d)
      -- marked inactive AND no punches all week → most likely no longer here
      and not (exists (select 1 from emp_employees e where e.emp_id = x.emp_id and e.is_active = false)
               and not exists (select 1 from worked w2 where w2.emp_id = x.emp_id))
  ),
  day_counts as (
    select x.d, count(*) as expected_n,
           (select count(*) from missed mm where mm.d = x.d) as missing_n
    from expected x group by x.d
  )
  select coalesce(json_agg(json_build_object(
           'emp_id',     m.emp_id,
           'name',       coalesce(e.full_name, 'ID ' || m.emp_id),
           'team',       e.team,
           'location',   e.location,
           'date',       m.d,
           'kind',       'no_punches',
           'usual_weeks', m.weeks,
           'day_missing', dc.missing_n,
           'day_expected', dc.expected_n
         ) order by coalesce(e.full_name, m.emp_id::text), m.d), '[]'::json)
    into v_missed
  from missed m
  join day_counts dc on dc.d = m.d
  left join lateral (select full_name, team, location from emp_employees x
                     where x.emp_id = m.emp_id order by x.is_active desc nulls last limit 1) e on true;

  select max(last_synced_at) into v_synced from emp_sync_meta;

  return json_build_object(
    'ok',             true,
    'week_start',     v_start,
    'week_end',       v_end,
    'today',          v_today,
    'max_hours',      v_limit,
    'last_synced_at', v_synced,
    'exceptions',     v_exc,
    'missed_days',    v_missed
  );
end;
$$;

revoke all on function public.toolkit_timeclock_exceptions(text, date, numeric) from public;
grant execute on function public.toolkit_timeclock_exceptions(text, date, numeric) to anon, authenticated;


-- ------------------------------------------------------------
-- Everyone's Hours (v1.60.0): every employee with punches in one
-- Sunday–Saturday week — hours per day and week total. Hours only.
-- ------------------------------------------------------------
create or replace function public.toolkit_manager_week_hours(
  p_passcode  text,
  p_week_date date default null
)
returns json
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_today  date := (now() at time zone 'America/Chicago')::date;
  v_date   date;
  v_start  date;
  v_end    date;
  v_err    text;
  v_rows   json;
  v_synced timestamptz;
begin
  v_err := toolkit_manager_check(p_passcode);
  if v_err is not null then
    return json_build_object('ok', false, 'error', v_err);
  end if;

  v_date  := coalesce(p_week_date, v_today);
  v_start := v_date - extract(dow from v_date)::int;
  v_end   := v_start + 6;

  with p as (
    select distinct on (log_id) log_id, emp_id, clock_in_date, clocked_in, clocked_out, worked_hours
    from emp_punches
    where clock_in_date between v_start and v_end
    order by log_id
  ),
  per_emp as (
    select emp_id,
           array[
             sum(coalesce(worked_hours,0)) filter (where clock_in_date = v_start),
             sum(coalesce(worked_hours,0)) filter (where clock_in_date = v_start + 1),
             sum(coalesce(worked_hours,0)) filter (where clock_in_date = v_start + 2),
             sum(coalesce(worked_hours,0)) filter (where clock_in_date = v_start + 3),
             sum(coalesce(worked_hours,0)) filter (where clock_in_date = v_start + 4),
             sum(coalesce(worked_hours,0)) filter (where clock_in_date = v_start + 5),
             sum(coalesce(worked_hours,0)) filter (where clock_in_date = v_start + 6)
           ] as days,
           sum(coalesce(worked_hours,0)) as total,
           bool_or(clocked_in is not null and clocked_out is null) as open_punch,
           bool_or(clocked_in is null and clocked_out is not null) as missing_in
    from p group by emp_id
  )
  select coalesce(json_agg(json_build_object(
           'emp_id',     x.emp_id,
           'name',       coalesce(e.full_name, 'ID ' || x.emp_id),
           'team',       e.team,
           'location',   e.location,
           'days',       x.days,
           'total',      x.total,
           'open_punch', x.open_punch,
           'missing_in', x.missing_in
         ) order by coalesce(e.full_name, x.emp_id::text)), '[]'::json)
    into v_rows
  from per_emp x
  left join lateral (select full_name, team, location from emp_employees ee
                     where ee.emp_id = x.emp_id order by ee.is_active desc nulls last limit 1) e on true;

  select max(last_synced_at) into v_synced from emp_sync_meta;

  return json_build_object(
    'ok', true, 'week_start', v_start, 'week_end', v_end, 'today', v_today,
    'last_synced_at', v_synced, 'employees', v_rows);
end;
$$;

revoke all on function public.toolkit_manager_week_hours(text, date) from public;
grant execute on function public.toolkit_manager_week_hours(text, date) to anon, authenticated;

-- ============================================================
-- MANAGER PASSCODE
-- !! This GitHub repo is PUBLIC. Do NOT save your real passcode in this file
-- !! on GitHub. Instead, in the Supabase SQL Editor, change CHANGE-ME to your
-- !! passcode in the statement below and run it there — don't commit it back.
-- Leaving it as CHANGE-ME (e.g. re-running this whole file) keeps whatever
-- passcode is already set.
-- ============================================================
insert into public.toolkit_manager_access (id, passcode_hash)
values (1, encode(sha256(convert_to('CHANGE-ME', 'UTF8')), 'hex'))
on conflict (id) do update
  set passcode_hash   = excluded.passcode_hash,
      failed_attempts = 0,
      locked_until    = null,
      updated_at      = now()
  where excluded.passcode_hash <> encode(sha256(convert_to('CHANGE-ME', 'UTF8')), 'hex');
