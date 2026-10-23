-- ============================================================
-- LWH Toolkit v1.73.0 — Bay Scan (scan customer pallet tags into a bay)
-- Run once in the Supabase SQL Editor (LWH Companion — same project as
-- inventory). Safe to re-run.
--
-- Why it's built this way:
--   A customer's bay name belongs to THEIR system and can change for the
--   same physical space (VB220 today, VB2102 for the next PO). So:
--     bay_scan_bays     — every bay name ever used, per warehouse, with
--                         capacity (default 240 pallets) and an optional
--                         "physical spot" (our own name for the space, which
--                         never changes). Renaming retires the old name and
--                         makes a new one for the same spot — old history
--                         keeps the old name.
--     bay_scan_moves    — permanent log: every scan into a bay, every
--                         clear (consumed / sent back) and every rename.
--     bay_scan_current  — one row per tag = where it is right now and
--                         when it was put there. Cleared tags drop out.
--   The tables aren't reachable with the public key; the app only goes
--   through the toolkit_bay_* functions below.
-- ============================================================

create table if not exists public.bay_scan_bays (
  id          bigserial primary key,
  warehouse   text not null,                 -- WHSE10, WHSE41 …
  bay         text not null,                 -- customer's bay name, upper case
  capacity    integer not null default 240,  -- pallets
  spot        text,                          -- our name for the physical space (optional, stays the same)
  note        text,
  active      boolean not null default true,
  created_by  text,
  created_at  timestamptz not null default now(),
  retired_at  timestamptz,
  retired_by  text,
  replaced_by bigint references public.bay_scan_bays(id)
);
-- only one ACTIVE bay with a given name per warehouse (a retired name can be reused later)
create unique index if not exists bay_scan_bays_active_name_uq
  on public.bay_scan_bays (warehouse, bay) where active;
create index if not exists bay_scan_bays_wh_idx on public.bay_scan_bays (warehouse, active);

create table if not exists public.bay_scan_moves (
  id          bigserial primary key,
  client_id   text unique,                   -- made by the device, so a retried save never doubles up
  tag         text not null,
  action      text not null,                 -- assign | clear | rename
  warehouse   text,
  bay_id      bigint references public.bay_scan_bays(id),
  bay         text,                          -- bay name at the time (kept even after a rename)
  from_bay_id bigint references public.bay_scan_bays(id),
  from_bay    text,
  from_warehouse text,
  note        text,
  scanned_by  text,
  device      text,
  scanned_at  timestamptz not null default now(),
  saved_at    timestamptz not null default now()
);
create index if not exists bay_scan_moves_tag_idx on public.bay_scan_moves (tag, scanned_at desc);
create index if not exists bay_scan_moves_bay_idx on public.bay_scan_moves (bay_id);
create index if not exists bay_scan_moves_from_bay_idx on public.bay_scan_moves (from_bay_id);
create index if not exists bay_scan_moves_saved_idx on public.bay_scan_moves (saved_at desc);

create table if not exists public.bay_scan_current (
  tag          text primary key,
  warehouse    text not null,
  bay_id       bigint not null references public.bay_scan_bays(id),
  assigned_at  timestamptz not null,
  assigned_by  text,
  move_id      bigint
);
create index if not exists bay_scan_current_bay_idx on public.bay_scan_current (bay_id);

alter table public.bay_scan_bays    enable row level security;   -- no policies = no direct API access
alter table public.bay_scan_moves   enable row level security;
alter table public.bay_scan_current enable row level security;
revoke all on public.bay_scan_bays    from anon, authenticated;
revoke all on public.bay_scan_moves   from anon, authenticated;
revoke all on public.bay_scan_current from anon, authenticated;

-- ------------------------------------------------------------
-- helpers (not callable from the app)
-- ------------------------------------------------------------
create or replace function public._bay_norm(p text)
returns text language sql immutable set search_path = public as $$
  select nullif(upper(regexp_replace(trim(coalesce(p,'')), '\s+', '', 'g')), '')
$$;

-- one bay as json, with how many tags are in it now
create or replace function public._bay_json(p_id bigint)
returns json language sql stable set search_path = public as $$
  select json_build_object(
    'id',b.id,'warehouse',b.warehouse,'bay',b.bay,'capacity',b.capacity,'spot',b.spot,'note',b.note,
    'active',b.active,'created_by',b.created_by,'created_at',b.created_at,
    'retired_at',b.retired_at,'retired_by',b.retired_by,'replaced_by',b.replaced_by,
    'replaced_by_bay',(select r.bay from bay_scan_bays r where r.id=b.replaced_by),
    'count',(select count(*) from bay_scan_current c where c.bay_id=b.id),
    'last_at',(select max(c.assigned_at) from bay_scan_current c where c.bay_id=b.id))
  from bay_scan_bays b where b.id=p_id
$$;

-- Put one tag in a bay (p_bay_id) or take it out of wherever it is (p_bay_id null).
-- Only moves "current" if this scan is newer than what's there, so a phone
-- that was offline and syncs late can't drag a pallet back to an old bay.
create or replace function public._bay_apply(
  p_tag text, p_bay_id bigint, p_action text, p_at timestamptz,
  p_by text, p_device text, p_note text, p_client_id text)
returns json
language plpgsql volatile set search_path = public as $$
declare
  v_tag  text := left(_bay_norm(p_tag),80);
  v_bay  bay_scan_bays%rowtype;
  v_cur  bay_scan_current%rowtype;
  v_from bay_scan_bays%rowtype;
  v_mid  bigint;
  v_at   timestamptz := coalesce(p_at, now());
  v_stale boolean := false;
begin
  if v_tag is null then return json_build_object('ok',false,'error','no_tag'); end if;
  if v_at > now() + interval '10 minutes' then v_at := now(); end if;
  if p_bay_id is not null then
    select * into v_bay from bay_scan_bays where id=p_bay_id;
    if not found then return json_build_object('ok',false,'error','no_bay','tag',v_tag); end if;
    if not v_bay.active and p_action <> 'rename' then
      return json_build_object('ok',false,'error','bay_retired','tag',v_tag,'bay',v_bay.bay,
        'replaced_by_bay',(select r.bay from bay_scan_bays r where r.id=v_bay.replaced_by));
    end if;
  end if;

  select * into v_cur from bay_scan_current where tag=v_tag for update;
  if found then
    select * into v_from from bay_scan_bays where id=v_cur.bay_id;
    v_stale := v_cur.assigned_at > v_at;
  end if;

  insert into bay_scan_moves (client_id, tag, action, warehouse, bay_id, bay, from_bay_id, from_bay, from_warehouse, note, scanned_by, device, scanned_at)
  values (nullif(left(p_client_id,80),''), v_tag, p_action,
          v_bay.warehouse, v_bay.id, v_bay.bay,
          v_from.id, v_from.bay, v_from.warehouse,
          left(p_note,200), left(p_by,80), left(p_device,120), v_at)
  on conflict (client_id) do nothing
  returning id into v_mid;
  if v_mid is null then   -- this exact scan was already saved (a retry)
    return json_build_object('ok',true,'dup',true,'tag',v_tag,'bay_id',p_bay_id);
  end if;

  if not v_stale then
    if p_bay_id is null then
      delete from bay_scan_current where tag=v_tag;
    else
      insert into bay_scan_current (tag, warehouse, bay_id, assigned_at, assigned_by, move_id)
      values (v_tag, v_bay.warehouse, v_bay.id, v_at, left(p_by,80), v_mid)
      on conflict (tag) do update
        set warehouse=excluded.warehouse, bay_id=excluded.bay_id, assigned_at=excluded.assigned_at,
            assigned_by=excluded.assigned_by, move_id=excluded.move_id;
    end if;
  end if;

  return json_build_object('ok',true,'tag',v_tag,'move_id',v_mid,'stale',v_stale,
    'bay_id',v_bay.id,'bay',v_bay.bay,'warehouse',v_bay.warehouse,
    'from_bay_id',v_from.id,'from_bay',v_from.bay,'from_warehouse',v_from.warehouse,'from_at',v_cur.assigned_at,
    'same_bay',v_from.id is not null and v_from.id = v_bay.id,
    'count',case when v_bay.id is not null then (select count(*) from bay_scan_current c where c.bay_id=v_bay.id) end,
    'capacity',v_bay.capacity);
end;
$$;

-- ------------------------------------------------------------
-- Bays in a warehouse (with tag counts). p_retired = also list old names.
-- ------------------------------------------------------------
create or replace function public.toolkit_bay_list(p_warehouse text, p_retired boolean default false)
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('ok',true,'warehouse',_bay_norm(p_warehouse),'bays',coalesce(json_agg(x.j order by x.active desc, x.bay),'[]'::json))
  from (
    select b.active, b.bay,
      json_build_object('id',b.id,'bay',b.bay,'capacity',b.capacity,'spot',b.spot,'note',b.note,'active',b.active,
        'created_by',b.created_by,'created_at',b.created_at,'retired_at',b.retired_at,'retired_by',b.retired_by,
        'replaced_by_bay',r.bay,'count',coalesce(c.n,0),'last_at',c.last_at) j
    from bay_scan_bays b
    left join bay_scan_bays r on r.id=b.replaced_by
    left join (select bay_id, count(*) n, max(assigned_at) last_at from bay_scan_current group by bay_id) c on c.bay_id=b.id
    where b.warehouse=_bay_norm(p_warehouse) and (b.active or coalesce(p_retired,false))
  ) x
$$;

-- ------------------------------------------------------------
-- Add a bay. p = {warehouse, bay, capacity, spot, note, by}
-- ------------------------------------------------------------
create or replace function public.toolkit_bay_add(p jsonb)
returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  v_wh  text := _bay_norm(p->>'warehouse');
  v_bay text := left(_bay_norm(p->>'bay'),40);
  v_cap integer := case when (p->>'capacity') ~ '^\d{1,5}$' then (p->>'capacity')::int else 240 end;
  v_id  bigint;
begin
  if v_wh is null or v_wh !~ '^WHSE\d{1,3}$' then return json_build_object('ok',false,'error','bad_warehouse'); end if;
  if v_bay is null then return json_build_object('ok',false,'error','no_bay'); end if;
  if v_cap < 1 then v_cap := 240; end if;
  if exists (select 1 from bay_scan_bays where warehouse=v_wh and bay=v_bay and active) then
    return json_build_object('ok',false,'error','exists','bay',(select _bay_json(id) from bay_scan_bays where warehouse=v_wh and bay=v_bay and active));
  end if;
  insert into bay_scan_bays (warehouse, bay, capacity, spot, note, created_by)
  values (v_wh, v_bay, v_cap, nullif(left(trim(p->>'spot'),60),''), nullif(left(trim(p->>'note'),200),''), left(p->>'by',80))
  returning id into v_id;
  return json_build_object('ok',true,'bay',_bay_json(v_id));
end;
$$;

-- ------------------------------------------------------------
-- Change a bay's capacity / physical spot / note. p = {id, capacity, spot, note, by}
-- ------------------------------------------------------------
create or replace function public.toolkit_bay_update(p jsonb)
returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id bigint := case when (p->>'id') ~ '^\d+$' then (p->>'id')::bigint end;
begin
  if v_id is null or not exists (select 1 from bay_scan_bays where id=v_id) then return json_build_object('ok',false,'error','no_bay'); end if;
  update bay_scan_bays set
    capacity = case when (p->>'capacity') ~ '^\d{1,5}$' and (p->>'capacity')::int > 0 then (p->>'capacity')::int else capacity end,
    spot     = case when p ? 'spot' then nullif(left(trim(p->>'spot'),60),'') else spot end,
    note     = case when p ? 'note' then nullif(left(trim(p->>'note'),200),'') else note end
  where id=v_id;
  return json_build_object('ok',true,'bay',_bay_json(v_id));
end;
$$;

-- ------------------------------------------------------------
-- The customer gave the same physical space a new bay name.
-- p = {id, new_bay, by, tags: 'move' | 'clear'}
--   move  — pallets still in the old bay go to the new name
--   clear — pallets still in the old bay are taken out (consumed / returned)
-- The old name is retired (kept for history); capacity and spot carry over.
-- ------------------------------------------------------------
create or replace function public.toolkit_bay_rename(p jsonb)
returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id   bigint := case when (p->>'id') ~ '^\d+$' then (p->>'id')::bigint end;
  v_old  bay_scan_bays%rowtype;
  v_new  text := left(_bay_norm(p->>'new_bay'),40);
  v_mode text := case when p->>'tags'='clear' then 'clear' else 'move' end;
  v_by   text := left(p->>'by',80);
  v_nid  bigint;
  v_n    integer := 0;
  r      record;
begin
  select * into v_old from bay_scan_bays where id=v_id for update;
  if not found then return json_build_object('ok',false,'error','no_bay'); end if;
  if not v_old.active then return json_build_object('ok',false,'error','bay_retired'); end if;
  if v_new is null then return json_build_object('ok',false,'error','no_bay'); end if;
  if v_new = v_old.bay then return json_build_object('ok',false,'error','same_name'); end if;
  if exists (select 1 from bay_scan_bays where warehouse=v_old.warehouse and bay=v_new and active) then
    return json_build_object('ok',false,'error','exists');
  end if;

  update bay_scan_bays set active=false, retired_at=now(), retired_by=v_by where id=v_id;
  insert into bay_scan_bays (warehouse, bay, capacity, spot, note, created_by)
  values (v_old.warehouse, v_new, v_old.capacity, v_old.spot, v_old.note, v_by)
  returning id into v_nid;
  update bay_scan_bays set replaced_by=v_nid where id=v_id;

  for r in select tag from bay_scan_current where bay_id=v_id loop
    if v_mode='move' then
      perform _bay_apply(r.tag, v_nid, 'rename', now(), v_by, null, 'Bay renamed '||v_old.bay||' → '||v_new, null);
    else
      perform _bay_apply(r.tag, null, 'clear', now(), v_by, null, 'Cleared when bay '||v_old.bay||' was renamed to '||v_new, null);
    end if;
    v_n := v_n + 1;
  end loop;

  return json_build_object('ok',true,'old',_bay_json(v_id),'bay',_bay_json(v_nid),'tags',v_n,'mode',v_mode);
end;
$$;

-- ------------------------------------------------------------
-- Take every tag out of a bay (all consumed / sent back). Bay stays open.
-- p = {id, by, note}
-- ------------------------------------------------------------
create or replace function public.toolkit_bay_clear(p jsonb)
returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id bigint := case when (p->>'id') ~ '^\d+$' then (p->>'id')::bigint end;
  v_n  integer := 0;
  r    record;
begin
  if v_id is null or not exists (select 1 from bay_scan_bays where id=v_id) then return json_build_object('ok',false,'error','no_bay'); end if;
  for r in select tag from bay_scan_current where bay_id=v_id loop
    perform _bay_apply(r.tag, null, 'clear', now(), left(p->>'by',80), null, coalesce(nullif(left(trim(p->>'note'),200),''),'Bay cleared'), null);
    v_n := v_n + 1;
  end loop;
  return json_build_object('ok',true,'cleared',v_n,'bay',_bay_json(v_id));
end;
$$;

-- ------------------------------------------------------------
-- Retire a bay name for good (no new name). Any tags still in it are cleared.
-- Undo with p.restore=true (only if no active bay has taken that name).
-- p = {id, by, restore}
-- ------------------------------------------------------------
create or replace function public.toolkit_bay_retire(p jsonb)
returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id bigint := case when (p->>'id') ~ '^\d+$' then (p->>'id')::bigint end;
  v_b  bay_scan_bays%rowtype;
  v_n  integer := 0;
  r    record;
begin
  select * into v_b from bay_scan_bays where id=v_id for update;
  if not found then return json_build_object('ok',false,'error','no_bay'); end if;
  if coalesce((p->>'restore')::boolean,false) then
    if v_b.active then return json_build_object('ok',true,'bay',_bay_json(v_id)); end if;
    if exists (select 1 from bay_scan_bays where warehouse=v_b.warehouse and bay=v_b.bay and active) then
      return json_build_object('ok',false,'error','exists');
    end if;
    update bay_scan_bays set active=true, retired_at=null, retired_by=null, replaced_by=null where id=v_id;
    return json_build_object('ok',true,'bay',_bay_json(v_id));
  end if;
  for r in select tag from bay_scan_current where bay_id=v_id loop
    perform _bay_apply(r.tag, null, 'clear', now(), left(p->>'by',80), null, 'Cleared when bay '||v_b.bay||' was retired', null);
    v_n := v_n + 1;
  end loop;
  update bay_scan_bays set active=false, retired_at=now(), retired_by=left(p->>'by',80) where id=v_id;
  return json_build_object('ok',true,'cleared',v_n,'bay',_bay_json(v_id));
end;
$$;

-- ------------------------------------------------------------
-- Save scans (the app sends them in batches; also works offline-then-sync).
-- p_moves = [{client_id, tag, bay_id (null = take out of its bay), scanned_at,
--             scanned_by, device, note}]
-- Returns one result per scan, in the same order.
-- ------------------------------------------------------------
create or replace function public.toolkit_bay_scan(p_moves jsonb)
returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  v_out json[] := '{}';
  m     jsonb;
  v_bay bigint;
begin
  if jsonb_typeof(p_moves) <> 'array' then return json_build_object('ok',false,'error','bad_moves'); end if;
  if jsonb_array_length(p_moves) > 500 then return json_build_object('ok',false,'error','too_many'); end if;
  for m in select x from jsonb_array_elements(p_moves) as t(x) order by coalesce(nullif(x->>'scanned_at','')::timestamptz, now()) loop
    v_bay := case when (m->>'bay_id') ~ '^\d+$' then (m->>'bay_id')::bigint end;
    v_out := v_out || (_bay_apply(m->>'tag', v_bay, case when v_bay is null then 'clear' else 'assign' end,
                                  nullif(m->>'scanned_at','')::timestamptz, m->>'scanned_by', m->>'device', m->>'note', m->>'client_id')::jsonb
                       || jsonb_build_object('client_id', m->>'client_id'))::json;
  end loop;
  return json_build_object('ok',true,'results',to_json(v_out),'saved_at',now());
end;
$$;

-- ------------------------------------------------------------
-- What's in a bay now (newest first), with inventory details when the tag
-- matches a pallet in current_inventory (Customer ID or LWH ID).
-- ------------------------------------------------------------
create or replace function public.toolkit_bay_contents(p_bay_id bigint)
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('ok',true,'bay',_bay_json(p_bay_id),
    'tags',coalesce((
      select json_agg(json_build_object('tag',c.tag,'assigned_at',c.assigned_at,'assigned_by',c.assigned_by,
               'item',i.item_number,'description',i.item_description,'lot',i.lot_number,'qty',i.quantity,
               'customer',i.customer,'lwh_id',i.pallet_id,'wms_bay',i.bay_name,'wms_warehouse',i.warehouse)
             order by c.assigned_at desc)
      from bay_scan_current c
      left join lateral (
        (select * from current_inventory ci where ci.customer_id=c.tag limit 1)
        union all
        (select * from current_inventory ci where ci.pallet_id=case when c.tag ~ '^\d{1,18}$' then c.tag::bigint end limit 1)
        limit 1) i on true
      where c.bay_id=p_bay_id),'[]'::json))
$$;

-- ------------------------------------------------------------
-- Find a tag: where it is now, when it was put there, and its history.
-- Exact match first; if none, up to 25 tags that contain what was typed.
-- ------------------------------------------------------------
create or replace function public.toolkit_bay_tag_lookup(p_search text)
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_q    text := left(_bay_norm(p_search),80);
  v_tags text[];
begin
  if v_q is null or length(v_q) < 3 then return json_build_object('ok',false,'error','too_short'); end if;
  select array_agg(distinct tag) into v_tags from bay_scan_moves where tag = v_q;
  if v_tags is null then
    select array_agg(t) into v_tags from (
      select distinct tag t from bay_scan_moves where tag like '%'||v_q||'%' order by 1 limit 25) s;
  end if;
  return json_build_object('ok',true,'search',v_q,'exact',coalesce(v_q = any(v_tags),false),
    'tags',coalesce((
      select json_agg(json_build_object(
        'tag',t.tag,
        'current',(select json_build_object('warehouse',c.warehouse,'bay_id',c.bay_id,'bay',b.bay,'spot',b.spot,
                           'assigned_at',c.assigned_at,'assigned_by',c.assigned_by)
                   from bay_scan_current c join bay_scan_bays b on b.id=c.bay_id where c.tag=t.tag),
        'last_move',(select json_build_object('action',m.action,'bay',m.bay,'from_bay',m.from_bay,'at',m.scanned_at,'by',m.scanned_by,'note',m.note)
                     from bay_scan_moves m where m.tag=t.tag order by m.scanned_at desc, m.id desc limit 1),
        'history',(select coalesce(json_agg(json_build_object('action',h.action,'warehouse',coalesce(h.warehouse,h.from_warehouse),'bay',h.bay,
                           'from_bay',h.from_bay,'at',h.scanned_at,'by',h.scanned_by,'note',h.note) order by h.scanned_at desc, h.id desc),'[]'::json)
                   from (select * from bay_scan_moves m where m.tag=t.tag order by m.scanned_at desc, m.id desc limit 50) h),
        'inventory',(select json_build_object('item',i.item_number,'description',i.item_description,'lot',i.lot_number,'qty',i.quantity,
                            'customer',i.customer,'lwh_id',i.pallet_id,'wms_bay',i.bay_name,'warehouse',i.warehouse,'received_on',i.received_on)
                     from ((select * from current_inventory ci where ci.customer_id=t.tag limit 1)
                           union all
                           (select * from current_inventory ci where ci.pallet_id=case when t.tag ~ '^\d{1,18}$' then t.tag::bigint end limit 1)
                           limit 1) i)
      ) order by t.tag)
      from unnest(v_tags) as t(tag)),'[]'::json));
end;
$$;

-- who can call what: only the toolkit_bay_* functions, nothing else
revoke all on function public._bay_norm(text) from public, anon, authenticated;
revoke all on function public._bay_json(bigint) from public, anon, authenticated;
revoke all on function public._bay_apply(text,bigint,text,timestamptz,text,text,text,text) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'toolkit_bay_list(text,boolean)','toolkit_bay_add(jsonb)','toolkit_bay_update(jsonb)',
    'toolkit_bay_rename(jsonb)','toolkit_bay_clear(jsonb)','toolkit_bay_retire(jsonb)',
    'toolkit_bay_scan(jsonb)','toolkit_bay_contents(bigint)','toolkit_bay_tag_lookup(text)']
  loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;
