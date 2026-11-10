-- Manager sign-in replaces the shared manager passcode (Warehouse Toolkit v1.83.0)
-- Project tjivcqxnkftujceumdtx (LWH Companion). APPLIED Nov 10, 2026.
--
-- Every manager function (Missed Punches / Everyone's Hours, Forklift Certs, Outbound records and
-- overrides, Load Tag Scan records and clear-device) authorizes through toolkit_manager_check().
-- It now accepts, in this order:
--   1. A signed-in Toolkit session (x-lwh-session) for someone on the warehouse manager list
--      (msg_wh_managers). No second code.
--   2. 'pin:<employee id>:<6-digit PIN>' — a manager approving on someone else's device. Same PIN
--      and the same 5-tries / 15-minute lockout as the Toolkit and Messages sign-in.
--   3. The old shared passcode — ONLY until Nov 18, 2026, so phones still on the cached old app
--      keep working until they update. After that it is refused.
-- Function signatures are unchanged (the p_passcode argument just carries 1–3).
--
-- Who counts as a manager: msg_wh_managers (Manager Messages → same list).
-- Roll back to passcode-only: re-run toolkit_manager_check from sql/missed_punches.sql.

create or replace function public.toolkit_manager_check(p_passcode text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  v_emp int; m text[]; a emp_auth%rowtype; v_acc toolkit_manager_access%rowtype;
begin
  -- 1. Signed-in manager
  v_emp := lwh_request_emp();
  if v_emp is not null and whm_is_manager(v_emp) then return null; end if;

  -- 2. Manager ID + PIN typed on this device
  m := regexp_match(coalesce(p_passcode,''), '^pin:(\d{1,9}):(\d{6})$');
  if m is not null then
    if not whm_is_manager(m[1]::int) then return 'bad_pin'; end if;
    select au.* into a from emp_auth au join emp_employees e on e.emp_id = au.emp_id and e.is_active
     where au.emp_id = m[1]::int for update of au;
    if not found then return 'bad_pin'; end if;
    if a.locked_until is not null and a.locked_until > now() then return 'pin_locked'; end if;
    if a.pin_hash <> crypt(m[2], a.pin_hash) then
      update emp_auth set failed_attempts = failed_attempts + 1,
             locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' end
       where emp_id = a.emp_id;
      return 'bad_pin';
    end if;
    if a.failed_attempts <> 0 or a.locked_until is not null then
      update emp_auth set failed_attempts = 0, locked_until = null where emp_id = a.emp_id;
    end if;
    return null;
  end if;

  -- 3. Old shared passcode — grace period for cached apps, ends Nov 18, 2026
  if now() < timestamptz '2026-11-18 06:00:00+00' and coalesce(p_passcode,'') <> '' then
    select * into v_acc from toolkit_manager_access where id = 1 for update;
    if not found or v_acc.passcode_hash = encode(sha256(convert_to('CHANGE-ME','UTF8')),'hex') then return 'not_manager'; end if;
    if v_acc.locked_until is not null and v_acc.locked_until > now() then return 'locked'; end if;
    if encode(sha256(convert_to(p_passcode,'UTF8')),'hex') <> v_acc.passcode_hash then
      update toolkit_manager_access set failed_attempts = failed_attempts + 1,
             locked_until = case when failed_attempts + 1 >= 10 then now() + interval '10 minutes' else null end
       where id = 1;
      return 'bad_passcode';
    end if;
    if v_acc.failed_attempts <> 0 or v_acc.locked_until is not null then
      update toolkit_manager_access set failed_attempts = 0, locked_until = null where id = 1;
    end if;
    return null;
  end if;

  return 'not_manager';
end $$;

-- Who is approving: used by Outbound overrides and Load Tag Scan clear-device to record the
-- manager's name, and by screens to check access before showing manager tools.
create or replace function public.toolkit_manager_whoami(p_passcode text default '')
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_err text; v_emp int; m text[]; v_via text;
begin
  v_err := toolkit_manager_check(p_passcode);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  v_emp := lwh_request_emp();
  if v_emp is not null and whm_is_manager(v_emp) then v_via := 'session';
  else
    m := regexp_match(coalesce(p_passcode,''), '^pin:(\d{1,9}):(\d{6})$');
    if m is not null then v_emp := m[1]::int; v_via := 'pin'; else v_emp := null; v_via := 'passcode'; end if;
  end if;
  return json_build_object('ok', true, 'via', v_via, 'emp_id', v_emp,
    'name', (select coalesce(nullif(full_name,''), first_name) from emp_employees where emp_id = v_emp));
end $$;

revoke all on function public.toolkit_manager_whoami(text) from public;
grant execute on function public.toolkit_manager_whoami(text) to anon, authenticated;

insert into public.lwh_protected_rpcs (fn, note) values ('toolkit_manager_whoami','Manager check (all manager tools)')
on conflict (fn) do update set note = excluded.note;
