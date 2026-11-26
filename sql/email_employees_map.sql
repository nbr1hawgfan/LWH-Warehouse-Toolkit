-- Email Employees → Toolkit Messages (Warehouse Toolkit v1.104.0) — project tjivcqxnkftujceumdtx
-- New, read-only, managers only. Maps PTO tracker Employee IDs to Toolkit employees (emp_id) so a
-- manager's email can also be posted to people's Toolkit Messages with the normal whm_send.
-- Same matching the PIN push already did (tc_pins.emp_id), plus emp_pin_map for names that differ.
-- Changes nothing that exists.

create or replace function public.whm_pto_map(p_token text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare v int := whm_session_manager(p_token);
begin
  if v is null then return json_build_object('ok',false,'error','not_manager'); end if;
  return json_build_object('ok',true,'map',coalesce((
    select json_object_agg(x.pto, x.emp_id) from (
      select distinct on (upper(p.pto_employee_id)) upper(p.pto_employee_id) pto, e.emp_id
        from tc_pins p join emp_employees e on e.emp_id = p.emp_id and e.is_active
       where p.emp_id is not null
      union
      select upper(m.pto_employee_id), e.emp_id
        from emp_pin_map m join emp_employees e on e.emp_id = m.emp_id and e.is_active
       where not exists (select 1 from tc_pins p where upper(p.pto_employee_id) = upper(m.pto_employee_id) and p.emp_id is not null)
    ) x), '{}'::json));
end $$;
revoke all on function public.whm_pto_map(text) from public;
grant execute on function public.whm_pto_map(text) to anon, authenticated;
