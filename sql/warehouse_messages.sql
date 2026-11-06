-- Warehouse Messages (Warehouse Toolkit v1.79.0) — project tjivcqxnkftujceumdtx (LWH Companion)
-- APPLIED Nov 6, 2026. Kept here for reference.
--
-- Same message tables as Driver Messages (msg_messages / msg_recipients / msg_attachments, built by
-- the Driver Toolkit's supabase/migrations/20261106*.sql), with recipient/sender kind 'emp'.
-- Sign-in is the existing employee PIN system: emp_login / emp_create_pin / emp_logout
-- (employee ID + 6-digit PIN, setup code the first time) — one PIN for every app that uses it.
-- Direction values are shared with drivers: 'to_driver' = managers -> people, 'to_dispatch' = people -> managers.
-- Who can send = msg_wh_managers (loaded from Tim's Manager_List.xlsx, Nov 6, 2026).
-- whm_* functions return the same JSON key names as the driver functions (driver_id, driver_name…)
-- so one Message Center page works for both.

create table if not exists public.msg_wh_managers (
  emp_id       integer primary key,
  manager_code text,
  email        text,
  name         text not null,
  is_active    boolean not null default true,
  added_at     timestamptz not null default now()
);
alter table public.msg_wh_managers enable row level security;

insert into public.msg_wh_managers (emp_id, manager_code, email, name) values
  (97681,'BOLTON03','Sbolton@logistics-warehouse.com','Betty S. Bolton'),
  (37579,'WATKINS01','bwatkins@logistics-warehouse.com','Brandie Watkins'),
  (72325,'APPLETON01','dappleton@logistics-warehouse.com','Dwayne Appleton'),
  (62860,'ROBERTSON02','crobertson@logistics-warehouse.com','James C. Robertson'),
  (35433,'TURNER02','jeturner@logistics-warehouse.com','James Turner'),
  (38474,'DAVIDSON01','kdavidson@logistics-warehouse.com','Kevin Davidson'),
  (41880,'WALKER01','mwalker@logistics-warehouse.com','Michael Walker'),
  (86602,'ROBERTSON01','rrobertson@logistics-warehouse.com','Ronald R. Robertson'),
  (12345,'HEWITT01','rhewitt@logistics-warehouse.com','Ryan E. Hewitt'),
  (93945,'JENNINGS02','tjennings@logistics-warehouse.com','Timothy G. Jennings'),
  (16095,'BOLTON01','tbolton@logistics-warehouse.com','Todd W. Bolton'),
  (85378,'KNAUTZ01','cknautz@logistics-warehouse.com','Candice Knautz')
on conflict (emp_id) do update set manager_code=excluded.manager_code, email=excluded.email, name=excluded.name, is_active=true;

-- ---------------------------------------------------------------- helpers (internal)
create or replace function public.whm_session_emp(p_token text)
returns integer language sql stable security definer set search_path = public, extensions as $$
  select s.emp_id from emp_sessions s join emp_employees e on e.emp_id = s.emp_id and e.is_active
   where s.token_hash = encode(digest(coalesce(p_token,''),'sha256'),'hex') and s.expires_at > now();
$$;
create or replace function public.whm_session_manager(p_token text)
returns integer language sql stable security definer set search_path = public, extensions as $$
  select m.emp_id from msg_wh_managers m where m.is_active and m.emp_id = whm_session_emp(p_token);
$$;
create or replace function public.whm_name(p_emp_id integer)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(full_name),''), 'Employee '||emp_id) from emp_employees where emp_id = p_emp_id;
$$;
create or replace function public.whm_location(p_emp_id integer)
returns text language sql stable security definer set search_path = public as $$
  select nullif(p.location,'') from emp_punches p where p.emp_id = p_emp_id order by p.clocked_in desc limit 1;
$$;
create or replace function public.whm_is_manager(p_emp_id integer)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from msg_wh_managers where emp_id = p_emp_id and is_active);
$$;

-- ---------------------------------------------------------------- employee side (Warehouse Toolkit)
create or replace function public.whm_me(p_token text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare v int := whm_session_emp(p_token);
begin
  if v is null then return json_build_object('ok',false,'error','signed_out'); end if;
  return json_build_object('ok',true,'emp_id',v,'name',whm_name(v),
    'first_name',(select first_name from emp_employees where emp_id=v),
    'location',whm_location(v),'is_manager',whm_is_manager(v));
end $$;

create or replace function public.whm_inbox(p_token text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v int := whm_session_emp(p_token); vt text; result json;
begin
  if v is null then return json_build_object('ok',false,'error','signed_out'); end if;
  vt := v::text;
  update msg_recipients r set delivered_at = now() from msg_messages m
   where m.id = r.message_id and r.recipient_kind='emp' and r.recipient_id = vt and r.delivered_at is null and m.recalled_at is null;
  select json_build_object('ok',true,'now',now(),
    'messages',coalesce((select json_agg(x order by x.sort_key, x.created_at desc) from (
      select m.id, m.created_at, m.sender_name, m.msg_type, m.body, m.reply_options, m.urgent, m.expires_at,
             r.read_at, r.acked_at, r.reply, r.replied_at, r.opened_at, m.reply_to,
             (select json_build_object('topic',o.topic,'body',left(o.body,140),'created_at',o.created_at) from msg_messages o
               where o.id = m.reply_to and o.direction='to_dispatch' and o.sender_kind='emp' and o.sender_id = vt) as in_reply_to,
             msg_attachments_json(m.id) as attachments,
             case when m.msg_type='ack' and r.acked_at is null then 0
                  when m.msg_type='reply' and r.replied_at is null then 0
                  when r.read_at is null then 1 else 2 end as sort_key
        from msg_recipients r join msg_messages m on m.id = r.message_id
       where r.recipient_kind='emp' and r.recipient_id = vt and m.recalled_at is null
         and (m.expires_at is null or m.expires_at > now()) and m.created_at > now() - interval '30 days'
       order by m.id desc limit 100) x),'[]'::json),
    'sent',coalesce((select json_agg(y order by y.created_at desc) from (
      select m.id, m.created_at, m.topic, m.body, m.dispatch_read_at, m.dispatch_read_by, m.handled_at, m.handled_by,
             msg_attachments_json(m.id) as attachments,
             (select count(*) from msg_messages rr where rr.reply_to = m.id and rr.direction='to_driver' and rr.recalled_at is null) as replies
        from msg_messages m
       where m.direction='to_dispatch' and m.sender_kind='emp' and m.sender_id = vt and m.created_at > now() - interval '7 days'
       order by m.id desc limit 30) y),'[]'::json)
  ) into result;
  return result;
end $$;

create or replace function public.whm_mark(p_token text, p_message_id bigint, p_action text, p_reply text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v int := whm_session_emp(p_token); vt text; m msg_messages%rowtype; v_reply text := left(trim(coalesce(p_reply,'')),200);
begin
  if v is null then return json_build_object('ok',false,'error','signed_out'); end if;
  vt := v::text;
  select * into m from msg_messages where id = p_message_id and recalled_at is null;
  if not found or not exists (select 1 from msg_recipients where message_id=p_message_id and recipient_kind='emp' and recipient_id=vt) then
    return json_build_object('ok',false,'error','Message not found.');
  end if;
  if p_action = 'read' then
    update msg_recipients set read_at=coalesce(read_at,now()), delivered_at=coalesce(delivered_at,now())
     where message_id=p_message_id and recipient_kind='emp' and recipient_id=vt;
  elsif p_action = 'ack' then
    update msg_recipients set acked_at=coalesce(acked_at,now()), read_at=coalesce(read_at,now()), delivered_at=coalesce(delivered_at,now())
     where message_id=p_message_id and recipient_kind='emp' and recipient_id=vt;
  elsif p_action = 'open' then
    update msg_recipients set opened_at=coalesce(opened_at,now()), read_at=coalesce(read_at,now()), delivered_at=coalesce(delivered_at,now())
     where message_id=p_message_id and recipient_kind='emp' and recipient_id=vt;
  elsif p_action = 'reply' then
    if v_reply = '' then return json_build_object('ok',false,'error','Pick a reply.'); end if;
    if m.msg_type <> 'reply' or not (v_reply = any(m.reply_options)) then
      return json_build_object('ok',false,'error','That reply is not an option for this message.');
    end if;
    update msg_recipients set reply=v_reply, replied_at=now(), acked_at=coalesce(acked_at,now()), read_at=coalesce(read_at,now()), delivered_at=coalesce(delivered_at,now())
     where message_id=p_message_id and recipient_kind='emp' and recipient_id=vt;
  else
    return json_build_object('ok',false,'error','Bad action.');
  end if;
  return json_build_object('ok',true);
end $$;

-- Employee -> managers (all warehouse managers see it in the Message Center's inbox).
create or replace function public.whm_emp_send(p_token text, p_topic text, p_body text,
                                               p_reply_to bigint default null, p_attachments uuid[] default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v int := whm_session_emp(p_token); vt text; v_topic text := left(trim(coalesce(p_topic,'')),40);
        v_body text := left(trim(coalesce(p_body,'')),1000); v_thread bigint; v_new bigint; v_recent int;
begin
  if v is null then return json_build_object('ok',false,'error','signed_out'); end if;
  vt := v::text;
  if v_topic = '' and v_body = '' then return json_build_object('ok',false,'error','Pick a topic or type a message.'); end if;
  select count(*) into v_recent from msg_messages where direction='to_dispatch' and sender_kind='emp' and sender_id=vt and created_at > now() - interval '1 hour';
  if v_recent >= 20 then return json_build_object('ok',false,'error','Too many messages this hour. Please find a manager.'); end if;
  if p_reply_to is not null then
    select coalesce(m.thread_id, m.id) into v_thread from msg_messages m
      join msg_recipients r on r.message_id = m.id and r.recipient_kind='emp' and r.recipient_id = vt
     where m.id = p_reply_to;
    if v_thread is null then return json_build_object('ok',false,'error','Message not found.'); end if;
  end if;
  insert into msg_messages (direction, sender_kind, sender_id, sender_name, audience_kind, audience_label, msg_type, body, topic, reply_to, thread_id)
  values ('to_dispatch','emp', vt, whm_name(v), 'emp', 'Managers', 'notice', v_body, nullif(v_topic,''), p_reply_to, v_thread)
  returning id into v_new;
  if v_thread is null then update msg_messages set thread_id = v_new where id = v_new; end if;
  perform msg_link_attachments(v_new, 'emp', vt, p_attachments);
  return json_build_object('ok',true,'id',v_new);
end $$;

-- ---------------------------------------------------------------- manager side (Warehouse Message Center)
create or replace function public.whm_directory(p_token text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare v int := whm_session_manager(p_token);
begin
  if v is null then return json_build_object('ok',false,'error','not_manager'); end if;
  return json_build_object('ok',true,'me',whm_name(v),'drivers',coalesce((
    select json_agg(json_build_object('driver_id',e.emp_id::text,'name',whm_name(e.emp_id),
             'role',case when whm_is_manager(e.emp_id) then 'Manager' else 'Employee' end,
             'location',coalesce(whm_location(e.emp_id),''),
             'has_pin',exists(select 1 from emp_auth a where a.emp_id=e.emp_id))
           order by whm_is_manager(e.emp_id), coalesce(whm_location(e.emp_id),'zzzz'), e.full_name)
      from emp_employees e where e.is_active),'[]'::json));
end $$;

create or replace function public.whm_send(p_token text, p_audience jsonb, p_type text, p_body text,
                                           p_reply_options text[] default '{}', p_urgent boolean default false,
                                           p_expires_at timestamptz default null, p_reminder_of bigint default null,
                                           p_reply_to bigint default null, p_attachments uuid[] default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_mgr int := whm_session_manager(p_token); v_body text := trim(coalesce(p_body,''));
        v_opts text[]; v_label text; v_id bigint; n int; v_to int[]; v_thread bigint; v_files int := 0;
begin
  if v_mgr is null then return json_build_object('ok',false,'error','not_manager'); end if;
  if p_type not in ('notice','ack','reply') then return json_build_object('ok',false,'error','Bad message type.'); end if;
  if length(v_body) > 1000 then return json_build_object('ok',false,'error','Message must be 1000 characters or less.'); end if;
  if v_body = '' and coalesce(array_length(p_attachments,1),0) = 0 then return json_build_object('ok',false,'error','Type a message or attach a file.'); end if;
  select coalesce(array_agg(o order by i),'{}') into v_opts
    from (select left(trim(u.o),40) o, min(u.i) i from unnest(coalesce(p_reply_options,'{}')) with ordinality u(o,i)
           where trim(u.o) <> '' group by left(trim(u.o),40) order by min(u.i) limit 4) z;
  if p_type = 'reply' and array_length(v_opts,1) is null then return json_build_object('ok',false,'error','Add at least one quick reply.'); end if;
  if p_type <> 'reply' then v_opts := '{}'; end if;

  if p_reply_to is not null then
    select array[m.sender_id::int], coalesce(m.thread_id, m.id) into v_to, v_thread
      from msg_messages m join emp_employees e on e.emp_id::text = m.sender_id and e.is_active
     where m.id = p_reply_to and m.direction='to_dispatch' and m.sender_kind='emp';
    if v_to is null then return json_build_object('ok',false,'error','That message was not found, or the employee is inactive.'); end if;
    v_label := whm_name(v_to[1]);
  elsif coalesce((p_audience->>'all')::boolean,false) then
    select array_agg(emp_id) into v_to from emp_employees where is_active and not whm_is_manager(emp_id);
    v_label := 'Everyone';
  elsif p_audience ? 'locations' then
    select array_agg(emp_id) into v_to from emp_employees
     where is_active and not whm_is_manager(emp_id)
       and whm_location(emp_id) in (select jsonb_array_elements_text(p_audience->'locations'));
    select string_agg(x, ', ') into v_label from jsonb_array_elements_text(p_audience->'locations') x;
  elsif p_audience ? 'drivers' then
    select array_agg(emp_id) into v_to from emp_employees
     where is_active and emp_id::text in (select jsonb_array_elements_text(p_audience->'drivers'));
    v_label := case when coalesce(array_length(v_to,1),0) = 1 then whm_name(v_to[1]) else coalesce(array_length(v_to,1),0)||' people' end;
  end if;
  n := coalesce(array_length(v_to,1),0);
  if n = 0 then return json_build_object('ok',false,'error','Nobody matches that audience.'); end if;

  insert into msg_messages (sender_kind, sender_id, sender_name, audience_kind, audience_label, msg_type, body, reply_options, urgent,
                            expires_at, reminder_of, reply_to, thread_id)
  values ('emp', v_mgr::text, whm_name(v_mgr), 'emp', coalesce(v_label,''), p_type, v_body, v_opts, coalesce(p_urgent,false),
          p_expires_at, p_reminder_of, p_reply_to, v_thread)
  returning id into v_id;
  insert into msg_recipients (message_id, recipient_kind, recipient_id, recipient_name)
  select v_id, 'emp', t::text, whm_name(t) from unnest(v_to) t;
  v_files := msg_link_attachments(v_id, 'emp', v_mgr::text, p_attachments);
  if p_reply_to is not null then
    update msg_messages set dispatch_read_at=coalesce(dispatch_read_at,now()), dispatch_read_by=coalesce(dispatch_read_by,whm_name(v_mgr)),
                            handled_at=coalesce(handled_at,now()), handled_by=coalesce(handled_by,whm_name(v_mgr))
     where id = p_reply_to;
  end if;
  return json_build_object('ok',true,'id',v_id,'recipients',n,'files',v_files);
end $$;

create or replace function public.whm_sent(p_token text, p_days int default 30)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if whm_session_manager(p_token) is null then return json_build_object('ok',false,'error','not_manager'); end if;
  return json_build_object('ok',true,'messages',coalesce((
    select json_agg(x order by x.created_at desc) from (
      select m.id, m.created_at, m.sender_name, m.audience_label, m.msg_type, m.body, m.reply_options, m.urgent,
             m.expires_at, m.recalled_at, m.reminder_of, m.reply_to, msg_attachments_json(m.id) as attachments,
             count(r.*) total, count(r.read_at) read, count(r.acked_at) acked, count(r.replied_at) replied, count(r.opened_at) opened
        from msg_messages m left join msg_recipients r on r.message_id = m.id
       where m.direction='to_driver' and m.audience_kind='emp'
         and m.created_at > now() - make_interval(days => least(greatest(coalesce(p_days,30),1),180))
       group by m.id) x),'[]'::json));
end $$;

create or replace function public.whm_detail(p_token text, p_message_id bigint)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if whm_session_manager(p_token) is null then return json_build_object('ok',false,'error','not_manager'); end if;
  return json_build_object('ok',true,'recipients',coalesce((
    select json_agg(json_build_object('driver_id',r.recipient_id,'name',r.recipient_name,
             'location',coalesce(whm_location(r.recipient_id::int),''),'delivered_at',r.delivered_at,'read_at',r.read_at,
             'acked_at',r.acked_at,'reply',r.reply,'replied_at',r.replied_at,'opened_at',r.opened_at)
             order by (r.acked_at is not null), (r.read_at is not null), r.recipient_name)
      from msg_recipients r join msg_messages m on m.id = r.message_id and m.audience_kind='emp'
     where r.message_id = p_message_id and r.recipient_kind='emp'),'[]'::json));
end $$;

create or replace function public.whm_recall(p_token text, p_message_id bigint)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if whm_session_manager(p_token) is null then return json_build_object('ok',false,'error','not_manager'); end if;
  update msg_messages set recalled_at = coalesce(recalled_at, now()) where id = p_message_id and audience_kind='emp' and direction='to_driver';
  return json_build_object('ok',true);
end $$;

create or replace function public.whm_mgr_inbox(p_token text, p_view text default 'open', p_days int default 7)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if whm_session_manager(p_token) is null then return json_build_object('ok',false,'error','not_manager'); end if;
  return json_build_object('ok',true,
    'unread',(select count(*) from msg_messages where direction='to_dispatch' and sender_kind='emp' and dispatch_read_at is null and created_at > now() - interval '30 days'),
    'open',(select count(*) from msg_messages where direction='to_dispatch' and sender_kind='emp' and handled_at is null and created_at > now() - interval '30 days'),
    'messages',coalesce((select json_agg(x order by x.created_at desc) from (
      select m.id, m.created_at, m.sender_id as driver_id, m.sender_name as driver_name, coalesce(whm_location(m.sender_id::int),'') as location,
             m.topic, m.body, m.lat, m.lon, m.loc_acc_m, m.dispatch_read_at, m.dispatch_read_by, m.handled_at, m.handled_by,
             m.reply_to, m.thread_id,
             (select json_build_object('body',left(o.body,160),'sender_name',o.sender_name,'created_at',o.created_at) from msg_messages o where o.id = m.reply_to) as in_reply_to,
             msg_attachments_json(m.id) as attachments,
             coalesce((select json_agg(json_build_object('id',rr.id,'created_at',rr.created_at,'sender_name',rr.sender_name,'body',rr.body,
                         'read_at',rc.read_at,'attachments',msg_attachments_json(rr.id)) order by rr.created_at)
                from msg_messages rr left join msg_recipients rc on rc.message_id = rr.id and rc.recipient_kind='emp'
               where rr.reply_to = m.id and rr.direction='to_driver' and rr.recalled_at is null),'[]'::json) as replies
        from msg_messages m
       where m.direction='to_dispatch' and m.sender_kind='emp'
         and m.created_at > now() - make_interval(days => least(greatest(coalesce(p_days,7),1),90))
         and (coalesce(p_view,'open') = 'all' or m.handled_at is null)
       order by m.id desc limit 200) x),'[]'::json));
end $$;

create or replace function public.whm_mgr_mark(p_token text, p_message_id bigint, p_action text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v int := whm_session_manager(p_token); v_name text;
begin
  if v is null then return json_build_object('ok',false,'error','not_manager'); end if;
  v_name := whm_name(v);
  if p_action = 'read' then
    update msg_messages set dispatch_read_at=coalesce(dispatch_read_at,now()), dispatch_read_by=coalesce(dispatch_read_by,v_name)
     where id=p_message_id and direction='to_dispatch' and sender_kind='emp';
  elsif p_action = 'done' then
    update msg_messages set dispatch_read_at=coalesce(dispatch_read_at,now()), dispatch_read_by=coalesce(dispatch_read_by,v_name), handled_at=now(), handled_by=v_name
     where id=p_message_id and direction='to_dispatch' and sender_kind='emp';
  elsif p_action = 'reopen' then
    update msg_messages set handled_at=null, handled_by=null where id=p_message_id and direction='to_dispatch' and sender_kind='emp';
  else
    return json_build_object('ok',false,'error','Bad action.');
  end if;
  return json_build_object('ok',true);
end $$;

-- Setup codes for employees without a PIN (new hires get one automatically), and PIN resets.
create or replace function public.whm_setup_list(p_token text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if whm_session_manager(p_token) is null then return json_build_object('ok',false,'error','not_manager'); end if;
  insert into emp_setup_codes (emp_id, setup_code)
  select e.emp_id, emp_new_setup_code() from emp_employees e
   where e.is_active and not exists (select 1 from emp_auth a where a.emp_id=e.emp_id)
     and not exists (select 1 from emp_setup_codes c where c.emp_id=e.emp_id);
  return json_build_object('ok',true,'codes',coalesce((
    select json_agg(json_build_object('driver_id',c.emp_id::text,'name',whm_name(c.emp_id),
             'location',coalesce(whm_location(c.emp_id),''),'setup_code',c.setup_code)
           order by coalesce(whm_location(c.emp_id),'zzzz'), e.full_name)
      from emp_setup_codes c join emp_employees e on e.emp_id = c.emp_id and e.is_active
     where not exists (select 1 from emp_auth a where a.emp_id=c.emp_id)),'[]'::json));
end $$;

create or replace function public.whm_reset_pin(p_token text, p_driver_id text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare r json; v_id int;
begin
  if whm_session_manager(p_token) is null then return json_build_object('ok',false,'error','not_manager'); end if;
  begin v_id := trim(p_driver_id)::int; exception when others then return json_build_object('ok',false,'error','Bad employee ID.'); end;
  r := emp_reset_pin(v_id);
  if not coalesce((r->>'ok')::boolean,false) then return r; end if;
  return json_build_object('ok',true,'driver_id',v_id::text,'name',r->>'full_name','setup_code',r->>'setup_code');
end $$;

-- ---------------------------------------------------------------- files: accept warehouse employee sign-in too
create or replace function public.msg_file_register(p_token text, p_name text, p_mime text, p_bytes int)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_kind text; v_id text; v_mgr boolean; a_id uuid := gen_random_uuid(); v_emp int;
        v_name text := left(regexp_replace(coalesce(nullif(trim(p_name),''),'file'),'[\r\n/\\]','_','g'),120);
        v_ext text; v_recent int;
begin
  v_id := drv_session_driver(p_token);
  if v_id is not null then v_kind := 'driver'; v_mgr := drv_session_manager(p_token) is not null;
  else
    v_emp := whm_session_emp(p_token);
    if v_emp is null then return json_build_object('ok',false,'error','signed_out'); end if;
    v_kind := 'emp'; v_id := v_emp::text; v_mgr := whm_is_manager(v_emp);
  end if;
  if p_mime not in ('application/pdf','image/jpeg','image/png','image/webp') then
    return json_build_object('ok',false,'error','Only PDF, JPG, PNG or WebP files.');
  end if;
  if not v_mgr and p_mime = 'application/pdf' then return json_build_object('ok',false,'error','Only managers can send PDFs. Send a photo instead.'); end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 10485760 then return json_build_object('ok',false,'error','File must be under 10 MB.'); end if;
  select count(*) into v_recent from msg_attachments where uploader_kind=v_kind and uploader_id=v_id and created_at > now() - interval '1 hour';
  if v_recent >= (case when v_mgr then 60 else 15 end) then return json_build_object('ok',false,'error','Too many files this hour. Try again later.'); end if;
  v_ext := case p_mime when 'application/pdf' then 'pdf' when 'image/png' then 'png' when 'image/webp' then 'webp' else 'jpg' end;
  insert into msg_attachments (id, uploader_kind, uploader_id, file_name, mime, bytes, storage_path)
  values (a_id, v_kind, v_id, v_name, p_mime, p_bytes, to_char(now() at time zone 'America/Chicago','YYYY-MM') || '/' || a_id || '.' || v_ext);
  return json_build_object('ok',true,'id',a_id,'path',(select storage_path from msg_attachments where id = a_id));
end $$;

create or replace function public.msg_file_access(p_token text, p_id uuid)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_kind text; v_id text; v_mgr boolean; v_emp int; a msg_attachments%rowtype; m_kind text; ok boolean := false;
begin
  v_id := drv_session_driver(p_token);
  if v_id is not null then v_kind := 'driver'; v_mgr := drv_session_manager(p_token) is not null;
  else
    v_emp := whm_session_emp(p_token);
    if v_emp is null then return json_build_object('ok',false,'error','signed_out'); end if;
    v_kind := 'emp'; v_id := v_emp::text; v_mgr := whm_is_manager(v_emp);
  end if;
  select * into a from msg_attachments where id = p_id and uploaded_at is not null;
  if not found then return json_build_object('ok',false,'error','File not found.'); end if;
  if a.removed_at is not null or a.expires_at < now() then return json_build_object('ok',false,'error','This file was removed after 14 days.'); end if;
  select audience_kind into m_kind from msg_messages where id = a.message_id;
  if a.uploader_kind = v_kind and a.uploader_id = v_id then ok := true;                         -- my own upload
  elsif v_mgr and (a.uploader_kind = v_kind or m_kind = v_kind) then ok := true;                  -- a manager on the same side
  elsif a.message_id is not null and exists (select 1 from msg_recipients r join msg_messages m on m.id = r.message_id
         where r.message_id = a.message_id and r.recipient_kind = v_kind and r.recipient_id = v_id and m.recalled_at is null) then
    ok := true;                                                                                   -- I was sent this message
  end if;
  if not ok then return json_build_object('ok',false,'error','File not found.'); end if;
  return json_build_object('ok',true,'path',a.storage_path,'name',a.file_name,'mime',a.mime);
end $$;

-- ---------------------------------------------------------------- keep the driver side to drivers only
create or replace function public.msg_dispatch_inbox(p_token text, p_view text default 'open', p_days int default 7)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if drv_session_manager(p_token) is null then return json_build_object('ok',false,'error','not_manager'); end if;
  return json_build_object('ok',true,
    'unread',(select count(*) from msg_messages where direction='to_dispatch' and sender_kind='driver' and dispatch_read_at is null and created_at > now() - interval '30 days'),
    'open',(select count(*) from msg_messages where direction='to_dispatch' and sender_kind='driver' and handled_at is null and created_at > now() - interval '30 days'),
    'messages',coalesce((select json_agg(x order by x.created_at desc) from (
      select m.id, m.created_at, m.sender_id as driver_id, m.sender_name as driver_name, coalesce(d.location,'') as location,
             m.topic, m.body, m.lat, m.lon, m.loc_acc_m, m.dispatch_read_at, m.dispatch_read_by, m.handled_at, m.handled_by,
             m.reply_to, m.thread_id,
             (select json_build_object('body',left(o.body,160),'sender_name',o.sender_name,'created_at',o.created_at) from msg_messages o where o.id = m.reply_to) as in_reply_to,
             msg_attachments_json(m.id) as attachments,
             coalesce((select json_agg(json_build_object('id',rr.id,'created_at',rr.created_at,'sender_name',rr.sender_name,'body',rr.body,
                         'read_at',rc.read_at,'attachments',msg_attachments_json(rr.id)) order by rr.created_at)
                from msg_messages rr left join msg_recipients rc on rc.message_id = rr.id and rc.recipient_kind='driver'
               where rr.reply_to = m.id and rr.direction='to_driver' and rr.recalled_at is null),'[]'::json) as replies
        from msg_messages m left join drivers d on d.driver_id = m.sender_id
       where m.direction='to_dispatch' and m.sender_kind='driver'
         and m.created_at > now() - make_interval(days => least(greatest(coalesce(p_days,7),1),90))
         and (coalesce(p_view,'open') = 'all' or m.handled_at is null)
       order by m.id desc limit 200) x),'[]'::json));
end $$;

create or replace function public.msg_dispatch_mark(p_token text, p_message_id bigint, p_action text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_mgr text := drv_session_manager(p_token); v_name text;
begin
  if v_mgr is null then return json_build_object('ok',false,'error','not_manager'); end if;
  v_name := drv_display_name(v_mgr);
  if p_action = 'read' then
    update msg_messages set dispatch_read_at=coalesce(dispatch_read_at,now()), dispatch_read_by=coalesce(dispatch_read_by,v_name)
     where id=p_message_id and direction='to_dispatch' and sender_kind='driver';
  elsif p_action = 'done' then
    update msg_messages set dispatch_read_at=coalesce(dispatch_read_at,now()), dispatch_read_by=coalesce(dispatch_read_by,v_name), handled_at=now(), handled_by=v_name
     where id=p_message_id and direction='to_dispatch' and sender_kind='driver';
  elsif p_action = 'reopen' then
    update msg_messages set handled_at=null, handled_by=null where id=p_message_id and direction='to_dispatch' and sender_kind='driver';
  else
    return json_build_object('ok',false,'error','Bad action.');
  end if;
  return json_build_object('ok',true);
end $$;

create or replace function public.msg_recall(p_token text, p_message_id bigint)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if drv_session_manager(p_token) is null then return json_build_object('ok',false,'error','not_manager'); end if;
  update msg_messages set recalled_at = coalesce(recalled_at, now()) where id = p_message_id and audience_kind='driver';
  return json_build_object('ok',true);
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function public.whm_session_emp(text)     from public, anon, authenticated;
revoke all on function public.whm_session_manager(text) from public, anon, authenticated;
revoke all on function public.whm_name(integer)         from public, anon, authenticated;
revoke all on function public.whm_location(integer)     from public, anon, authenticated;
revoke all on function public.whm_is_manager(integer)   from public, anon, authenticated;
revoke all on function public.msg_file_register(text,text,text,int) from public, anon, authenticated;
revoke all on function public.msg_file_access(text,uuid)            from public, anon, authenticated;
grant execute on function public.msg_file_register(text,text,text,int) to service_role;
grant execute on function public.msg_file_access(text,uuid)            to service_role;

revoke all on function public.whm_me(text) from public;
revoke all on function public.whm_inbox(text) from public;
revoke all on function public.whm_mark(text,bigint,text,text) from public;
revoke all on function public.whm_emp_send(text,text,text,bigint,uuid[]) from public;
revoke all on function public.whm_directory(text) from public;
revoke all on function public.whm_send(text,jsonb,text,text,text[],boolean,timestamptz,bigint,bigint,uuid[]) from public;
revoke all on function public.whm_sent(text,int) from public;
revoke all on function public.whm_detail(text,bigint) from public;
revoke all on function public.whm_recall(text,bigint) from public;
revoke all on function public.whm_mgr_inbox(text,text,int) from public;
revoke all on function public.whm_mgr_mark(text,bigint,text) from public;
revoke all on function public.whm_setup_list(text) from public;
revoke all on function public.whm_reset_pin(text,text) from public;
revoke all on function public.msg_dispatch_inbox(text,text,int) from public;
revoke all on function public.msg_dispatch_mark(text,bigint,text) from public;
revoke all on function public.msg_recall(text,bigint) from public;
grant execute on function public.whm_me(text) to anon, authenticated;
grant execute on function public.whm_inbox(text) to anon, authenticated;
grant execute on function public.whm_mark(text,bigint,text,text) to anon, authenticated;
grant execute on function public.whm_emp_send(text,text,text,bigint,uuid[]) to anon, authenticated;
grant execute on function public.whm_directory(text) to anon, authenticated;
grant execute on function public.whm_send(text,jsonb,text,text,text[],boolean,timestamptz,bigint,bigint,uuid[]) to anon, authenticated;
grant execute on function public.whm_sent(text,int) to anon, authenticated;
grant execute on function public.whm_detail(text,bigint) to anon, authenticated;
grant execute on function public.whm_recall(text,bigint) to anon, authenticated;
grant execute on function public.whm_mgr_inbox(text,text,int) to anon, authenticated;
grant execute on function public.whm_mgr_mark(text,bigint,text) to anon, authenticated;
grant execute on function public.whm_setup_list(text) to anon, authenticated;
grant execute on function public.whm_reset_pin(text,text) to anon, authenticated;
grant execute on function public.msg_dispatch_inbox(text,text,int) to anon, authenticated;
grant execute on function public.msg_dispatch_mark(text,bigint,text) to anon, authenticated;
grant execute on function public.msg_recall(text,bigint) to anon, authenticated;
