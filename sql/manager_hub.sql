-- Manager hub "needs attention" counts (Warehouse Toolkit v1.94.0) — project tjivcqxnkftujceumdtx
-- One call for the Manager section's top cards. Warehouse managers only (msg_wh_managers), via the
-- Toolkit sign-in (x-lwh-session → lwh_request_emp). Forklift PM comes separately from the forklift-pm
-- Edge Function (it lives in the forklift Apps Script).

create or replace function public.mgr_attention()
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare v int := lwh_request_emp(); per date := date_trunc('month', (now() at time zone 'America/Chicago'))::date;
        today date := (now() at time zone 'America/Chicago')::date;
begin
  if v is null then return json_build_object('ok',false,'error','sign_in'); end if;
  if not whm_is_manager(v) then return json_build_object('ok',false,'error','not_manager'); end if;
  return json_build_object('ok',true,
    'msgs_unread', (select count(*) from msg_messages where direction='to_dispatch' and sender_kind='emp'
                      and dispatch_read_at is null and created_at > now() - interval '30 days'),
    'msgs_open',   (select count(*) from msg_messages where direction='to_dispatch' and sender_kind='emp'
                      and handled_at is null and created_at > now() - interval '30 days'),
    'cyc_counting',(select count(*) from cyc_counts where status='open'),
    'cyc_review',  (select count(*) from cyc_counts where status='review'),
    'cyc_open_diffs',(select count(*) from cyc_lines l join cyc_counts c on c.id=l.count_id
                      where c.status='review' and l.result is not null and l.result<>'match' and l.resolution is null),
    'insp_zones_total', (select count(*) from insp_zones z join insp_locations lo on lo.code=z.location_code and lo.active where z.active),
    'insp_zones_done',  (select count(distinct i.zone_id) from insp_inspections i join insp_zones z on z.id=i.zone_id and z.active
                          where i.period=per and i.status='submitted'),
    'insp_month', to_char(per,'FMMonth'),
    'insp_actions_open',(select count(*) from insp_actions where coalesce(status,'open') not in ('closed','fixed','done')),
    'insp_actions_overdue',(select count(*) from insp_actions where coalesce(status,'open') not in ('closed','fixed','done') and due_on < today),
    'certs_expiring', (select count(*) from fc_certs where status='active' and expires_on between today and today + 60),
    'certs_expired',  (select count(*) from fc_certs c where status='active' and expires_on < today
                         and exists (select 1 from emp_employees e where e.emp_id=c.emp_id and e.is_active)),
    'no_pin', (select count(*) from emp_employees e where e.is_active
                 and not exists (select 1 from emp_auth a where a.emp_id=e.emp_id)
                 and not exists (select 1 from tc_pins t where t.emp_id=e.emp_id and t.pin_hash is not null)
                 and exists (select 1 from emp_punches p where p.emp_id=e.emp_id and p.clocked_in > now() - interval '30 days')));
end $$;
revoke all on function public.mgr_attention() from public;
grant execute on function public.mgr_attention() to anon, authenticated;
insert into public.lwh_protected_rpcs (fn, note) values ('mgr_attention','Manager hub') on conflict (fn) do update set note = excluded.note;
