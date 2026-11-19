-- One PIN everywhere — Warehouse Toolkit sign-in uses the PTO PIN (v1.93.0) — project tjivcqxnkftujceumdtx
--
-- The PTO tracker's Apps Script (TimeClock_PinPush.gs) now sends EVERY active employee's PTO PIN
-- (not just Transportation) with their department. Each PIN is bcrypt-hashed on arrival
-- (tc_pins) and matched to:
--   * a driver   (drivers.driver_id)      — tc_pin_map, or by name for Transportation only
--   * a Toolkit  employee (emp_employees) — emp_pin_map, or by name
-- emp_login then accepts the PTO PIN (4 digits) for anyone matched. People who aren't in the PTO
-- tracker (or not matched yet) keep their Toolkit PIN + setup code exactly as before, and a
-- Toolkit PIN someone already made keeps working too.
-- Wrong PTO PINs share the Time Clock's lockout (5 wrong = 15 minutes) on that person's PTO row.

alter table public.tc_pins add column if not exists emp_id integer;
alter table public.tc_pins add column if not exists department text;

create table if not exists public.emp_pin_map (
  pto_employee_id text primary key,
  emp_id          integer not null,
  note            text
);
alter table public.emp_pin_map enable row level security;
insert into public.emp_pin_map (pto_employee_id, emp_id, note) values
  ('JENNINGS02', 93945, 'PTO: Timothy G. Jennings'),
  ('DUGGAR01',   95270, 'PTO spells it Duggar; Toolkit Ashlea Dugger'),
  ('RELEFORD01', 45472, 'PTO: Lakesha R. Releford; Toolkit Kesha Releford')
on conflict (pto_employee_id) do nothing;

create or replace function public.tc_sync_pins(p_secret text, p_rows jsonb)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text; r jsonb; v_id text; v_name text; v_pin text; v_dept text; v_drv text; v_emp int; v_old tc_pins%rowtype;
        v_plain text; v_last text;
        n int := 0; n_pin int := 0; n_new int := 0; n_emp int := 0; unmatched text[] := '{}'; seen text[] := '{}';
begin
  select pin_secret_hash into v_hash from tc_sync_meta where id = 1;
  if v_hash is null or encode(digest(coalesce(p_secret,''),'sha256'),'hex') <> v_hash then
    return json_build_object('ok', false, 'error', 'bad_secret');
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return json_build_object('ok', false, 'error', 'empty_push');
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_id   := upper(trim(coalesce(r->>'id','')));
    v_name := regexp_replace(trim(coalesce(r->>'name','')), '\s+', ' ', 'g');
    v_pin  := regexp_replace(coalesce(r->>'pin',''), '\.0+$', '');
    v_dept := nullif(trim(coalesce(r->>'dept','')),'');
    if v_id = '' or v_id = any(seen) then continue; end if;
    seen := seen || v_id; n := n + 1;
    if v_pin !~ '^[0-9]{4,6}$' then v_pin := null; end if;
    v_plain := regexp_replace(v_name, ' [A-Za-z]\. ', ' ');          -- drop a middle initial
    v_last  := lower(regexp_replace(v_name, '^.* ', ''));

    -- Driver: explicit map, or by name for Transportation (or when no department was sent — old pushes)
    v_drv := null;
    select m.driver_id into v_drv from tc_pin_map m where upper(m.pto_employee_id) = v_id;
    if v_drv is null and (v_dept is null or v_dept = 'Transportation') then
      select d.driver_id into v_drv from drivers d
       where lower(d.name) in (lower(v_name), lower(v_plain)) or lower(coalesce(d.goes_by,'')) in (lower(v_name), lower(v_plain)) limit 1;
      if v_drv is null then
        select min(d.driver_id) into v_drv from drivers d
         where lower(split_part(d.name, ' ', 1)) like lower(left(v_name, 1)) || '%'
           and lower(regexp_replace(d.name, '^.* ', '')) = v_last
        having count(*) = 1;
      end if;
    end if;

    -- Warehouse Toolkit employee: explicit map, exact name, or unique first initial + last name
    v_emp := null;
    select m.emp_id into v_emp from emp_pin_map m where upper(m.pto_employee_id) = v_id;
    if v_emp is null then
      select e.emp_id into v_emp from emp_employees e
       where e.is_active and lower(e.full_name) in (lower(v_name), lower(v_plain)) limit 1;
    end if;
    if v_emp is null then
      select min(e.emp_id) into v_emp from emp_employees e
       where e.is_active and lower(left(e.full_name,1)) = lower(left(v_name,1))
         and lower(regexp_replace(e.full_name, '^.* ', '')) = v_last
      having count(*) = 1;
    end if;
    if v_emp is not null then n_emp := n_emp + 1; end if;
    if v_drv is null and v_emp is null then unmatched := unmatched || (v_name || ' (' || v_id || ')'); end if;

    select * into v_old from tc_pins where pto_employee_id = v_id;
    if not found then
      insert into tc_pins (pto_employee_id, pto_name, driver_id, emp_id, department, pin_hash)
      values (v_id, v_name, v_drv, v_emp, v_dept, case when v_pin is not null then crypt(v_pin, gen_salt('bf', 8)) end);
      n_new := n_new + 1;
    else
      update tc_pins set pto_name = v_name, driver_id = v_drv, emp_id = v_emp, department = v_dept, synced_at = now(),
             pin_hash = case when v_pin is null then null
                             when v_old.pin_hash is not null and v_old.pin_hash = crypt(v_pin, v_old.pin_hash) then v_old.pin_hash
                             else crypt(v_pin, gen_salt('bf', 8)) end,
             failed_attempts = case when v_pin is null or v_old.pin_hash is null or v_old.pin_hash <> crypt(v_pin, v_old.pin_hash) then 0 else failed_attempts end,
             locked_until    = case when v_pin is null or v_old.pin_hash is null or v_old.pin_hash <> crypt(v_pin, v_old.pin_hash) then null else locked_until end
       where pto_employee_id = v_id;
    end if;
    if v_pin is not null then n_pin := n_pin + 1; end if;
  end loop;

  delete from tc_pins where not (pto_employee_id = any(seen));
  update tc_sync_meta set last_pin_push = now(),
         last_pin_counts = jsonb_build_object('people', n, 'with_pin', n_pin, 'new', n_new, 'toolkit_matched', n_emp, 'unmatched', to_jsonb(unmatched))
   where id = 1;
  return json_build_object('ok', true, 'people', n, 'with_pin', n_pin, 'new', n_new, 'toolkit_matched', n_emp, 'unmatched', unmatched,
                           'drivers_without_pin', (select coalesce(json_agg(d.name order by d.name), '[]'::json) from drivers d
                                                    where d.status = 'Active' and d.role = 'Driver'
                                                      and not exists (select 1 from tc_pins p where p.driver_id = d.driver_id and p.pin_hash is not null)));
end $$;

-- PTO PIN check for a Toolkit employee. Returns null when the PIN is right, else a message.
create or replace function public.emp_pto_check(p_emp_id integer, p_pin text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare p tc_pins%rowtype;
begin
  select * into p from tc_pins where emp_id = p_emp_id and pin_hash is not null order by synced_at desc limit 1 for update;
  if not found then return 'none'; end if;
  if p.locked_until is not null and p.locked_until > now() then
    return 'Too many wrong PINs. Wait 15 minutes, then try again.';
  end if;
  if p.pin_hash <> crypt(coalesce(p_pin,''), p.pin_hash) then
    update tc_pins set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' end
     where pto_employee_id = p.pto_employee_id;
    return 'That PIN is not right. Use the same PIN as the PTO / time off app.';
  end if;
  update tc_pins set failed_attempts = 0, locked_until = null where pto_employee_id = p.pto_employee_id;
  return null;
end $$;
revoke all on function public.emp_pto_check(integer, text) from public, anon, authenticated;

create or replace function public.emp_login(p_emp_id integer, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare a emp_auth%rowtype; v_err text; v_has boolean;
begin
  if not exists (select 1 from emp_employees where emp_id = p_emp_id and is_active) then
    return json_build_object('ok', false, 'error', 'Employee ID or PIN not recognized.');
  end if;
  -- 1) PTO PIN (same as the time off app)
  v_err := emp_pto_check(p_emp_id, p_pin);
  if v_err is null then return json_build_object('ok', true, 'token', emp_start_session(p_emp_id)); end if;
  -- 2) Toolkit PIN (people not in the PTO tracker, or anyone who already made one)
  select au.* into a from emp_auth au where au.emp_id = p_emp_id for update;
  v_has := found;
  if v_has then
    if a.locked_until is not null and a.locked_until > now() then
      return json_build_object('ok', false, 'error', 'Too many tries. Wait 15 minutes, then try again.');
    end if;
    if a.pin_hash = crypt(coalesce(p_pin, ''), a.pin_hash) then
      update emp_auth set failed_attempts = 0, locked_until = null where emp_id = p_emp_id;
      return json_build_object('ok', true, 'token', emp_start_session(p_emp_id));
    end if;
    if v_err = 'none' then   -- only count against the Toolkit PIN when there's no PTO PIN
      update emp_auth set failed_attempts = failed_attempts + 1,
             locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' end
       where emp_id = p_emp_id;
    end if;
  end if;
  if v_err <> 'none' then return json_build_object('ok', false, 'error', v_err); end if;
  if not v_has then
    return json_build_object('ok', false, 'error', 'No PIN on file yet. Use your PTO / time off PIN, or ask a manager for a setup code.');
  end if;
  return json_build_object('ok', false, 'error', 'Employee ID or PIN not recognized.');
end $$;

-- Manager list: setup codes only for people who can't use a PTO PIN.
create or replace function public.whm_setup_list(p_token text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if whm_session_manager(p_token) is null then return json_build_object('ok',false,'error','not_manager'); end if;
  insert into emp_setup_codes (emp_id, setup_code)
  select e.emp_id, emp_new_setup_code() from emp_employees e
   where e.is_active and not exists (select 1 from emp_auth a where a.emp_id=e.emp_id)
     and not exists (select 1 from emp_setup_codes c where c.emp_id=e.emp_id);
  return json_build_object('ok',true,
    'pto_pin_count',(select count(distinct t.emp_id) from tc_pins t join emp_employees e on e.emp_id=t.emp_id and e.is_active where t.pin_hash is not null),
    'codes',coalesce((
      select json_agg(json_build_object('driver_id',c.emp_id::text,'name',whm_name(c.emp_id),
               'location',coalesce(whm_location(c.emp_id),''),'setup_code',c.setup_code)
             order by coalesce(whm_location(c.emp_id),'zzzz'), e.full_name)
        from emp_setup_codes c join emp_employees e on e.emp_id = c.emp_id and e.is_active
       where not exists (select 1 from emp_auth a where a.emp_id=c.emp_id)
         and not exists (select 1 from tc_pins t where t.emp_id=c.emp_id and t.pin_hash is not null)),'[]'::json));
end $$;

-- Link the PTO people already synced (Transportation) to Toolkit employees right away.
update tc_pins t set emp_id = coalesce(
    (select m.emp_id from emp_pin_map m where upper(m.pto_employee_id) = t.pto_employee_id),
    (select e.emp_id from emp_employees e where e.is_active and lower(e.full_name) in (lower(t.pto_name), lower(regexp_replace(t.pto_name, ' [A-Za-z]\. ', ' '))) limit 1));
