-- Production (Warehouse Toolkit v1.85.0) — timeclock hours for the Production tool and its daily email
-- Project tjivcqxnkftujceumdtx (LWH Companion). NOT YET APPLIED — run once in the Supabase SQL Editor.
--
-- Production's records stay in the Google Sheet. This one function lets the Production Apps Script
-- (gas/ProductionAPI.gs) read timeclock hours so it can compare them with logged production hours
-- (Toolkit → Production → Timeclock tab, and the "clocked in, no production" check in the daily email).
--
-- The script has no Toolkit sign-in, so the function is gated by its own key, the same way the
-- forklift mailer is: the script sends the key, the database keeps only its SHA-256 hash.
-- Hours only — no pay rates, no punches, and only for the employee IDs the script asks about.
--
-- Optional: if you skip this file, Production still works; the Timeclock tab and the email section
-- just say "not set up".

create table if not exists public.prod_api_key (
  id         int primary key default 1 check (id = 1),
  key_hash   text not null,
  updated_at timestamptz not null default now()
);
alter table public.prod_api_key enable row level security;   -- no policies: only the function reads it

create or replace function public.prod_timeclock_hours(
  p_key     text,
  p_start   date,
  p_end     date,
  p_emp_ids integer[]
)
returns json
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare v_hash text; v_rows json; v_synced timestamptz;
begin
  select key_hash into v_hash from prod_api_key where id = 1;
  if v_hash is null or coalesce(p_key,'') = ''
     or encode(sha256(convert_to(p_key,'UTF8')),'hex') <> v_hash then
    return json_build_object('ok', false, 'error', 'bad_key');
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 62 then
    return json_build_object('ok', false, 'error', 'bad_range');
  end if;
  if p_emp_ids is null or array_length(p_emp_ids,1) is null then
    return json_build_object('ok', true, 'rows', '[]'::json);
  end if;

  with p as (
    select distinct on (log_id) log_id, emp_id, clock_in_date, clocked_in, clocked_out, worked_hours
      from emp_punches
     where clock_in_date between p_start and p_end
       and emp_id = any(p_emp_ids)
     order by log_id
  )
  select coalesce(json_agg(json_build_object(
           'emp_id',     x.emp_id,
           'date',       x.clock_in_date,
           'hours',      x.hours,
           'open_punch', x.open_punch
         ) order by x.emp_id, x.clock_in_date), '[]'::json)
    into v_rows
    from (select emp_id, clock_in_date,
                 round(sum(coalesce(worked_hours,0))::numeric, 2) as hours,
                 bool_or(clocked_in is not null and clocked_out is null) as open_punch
            from p group by emp_id, clock_in_date) x;

  select max(last_synced_at) into v_synced from emp_sync_meta;
  return json_build_object('ok', true, 'rows', v_rows, 'last_synced_at', v_synced);
end $$;

revoke all on function public.prod_timeclock_hours(text, date, date, integer[]) from public;
grant execute on function public.prod_timeclock_hours(text, date, date, integer[]) to anon, authenticated;

-- ============================================================
-- SET THE KEY  —  !! This GitHub repo is PUBLIC. Do NOT save your real key in this file. !!
-- Make up a long random key (30+ letters/numbers). In the Supabase SQL Editor, replace
-- CHANGE-ME below with it and run just this statement there. Put the SAME key in the
-- Production Apps Script → Project Settings → Script Properties → PROD_TIMECLOCK_KEY.
-- ============================================================
-- insert into public.prod_api_key (id, key_hash)
-- values (1, encode(sha256(convert_to('CHANGE-ME','UTF8')),'hex'))
-- on conflict (id) do update set key_hash = excluded.key_hash, updated_at = now();

-- Quick test (use your real key and a real employee ID):
-- select public.prod_timeclock_hours('your-key', current_date - 7, current_date, array[12345]);
