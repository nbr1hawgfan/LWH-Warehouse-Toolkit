-- ============================================================
-- LWH Toolkit v1.55.1 — "My Hours"
-- v1.55.1: no longer requires emp_employees.is_active = true. An employee
--          is found if they're in emp_employees OR have any punches.
-- Run this once in the Supabase SQL Editor (same project as inventory).
--
-- What it does:
--   Creates ONE function the Toolkit calls with an employee ID and a date.
--   It returns that one employee's punches for the Sunday–Saturday week
--   containing that date — nothing else. No pay rates, no wages, and no
--   other employee's data ever leaves the database.
--
--   The function runs with the database owner's rights (SECURITY DEFINER),
--   so the emp_punches / emp_employees tables themselves do NOT need to be
--   opened up to the public key. Safe to re-run any time.
-- ============================================================

create or replace function public.toolkit_my_week_hours(
  p_emp_id     integer,
  p_week_date  date default current_date
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  -- Snap whatever date was sent back to that week's Sunday (Sun = 0)
  v_start   date := p_week_date - extract(dow from p_week_date)::int;
  v_end     date := v_start + 6;
  v_first   text;
  v_full    text;
  v_punches json;
  v_synced  timestamptz;
begin
  -- Look the employee up for their name. The active flag is NOT checked:
  -- it isn't always current, and having punches is what matters here.
  select e.first_name, e.full_name
    into v_first, v_full
  from emp_employees e
  where e.emp_id = p_emp_id
  order by e.is_active desc nulls last
  limit 1;

  if not found and not exists (select 1 from emp_punches where emp_id = p_emp_id) then
    return json_build_object('found', false);
  end if;

  -- DISTINCT ON log_id guards against a punch being double-loaded by a sync.
  select coalesce(json_agg(json_build_object(
           'date',  p.clock_in_date,
           'in',    to_char(p.clocked_in,  'YYYY-MM-DD"T"HH24:MI:SS'),
           'out',   to_char(p.clocked_out, 'YYYY-MM-DD"T"HH24:MI:SS'),
           'hours', p.worked_hours
         ) order by p.clocked_in), '[]'::json)
    into v_punches
  from (
    select distinct on (log_id)
           log_id, clock_in_date, clocked_in, clocked_out, worked_hours
    from emp_punches
    where emp_id = p_emp_id
      and clock_in_date between v_start and v_end
    order by log_id
  ) p;

  select max(last_synced_at) into v_synced from emp_sync_meta;

  return json_build_object(
    'found',          true,
    'first_name',     v_first,
    'full_name',      v_full,
    'week_start',     v_start,
    'week_end',       v_end,
    'last_synced_at', v_synced,
    'punches',        v_punches
  );
end;
$$;

-- Only allow calling the function — not reading the tables directly.
revoke all on function public.toolkit_my_week_hours(integer, date) from public;
grant execute on function public.toolkit_my_week_hours(integer, date) to anon, authenticated;

-- Quick test (swap in a real 5-digit employee ID):
-- select public.toolkit_my_week_hours(12345, current_date);
