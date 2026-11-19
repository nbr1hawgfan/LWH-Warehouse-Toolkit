-- CYCLE COUNTS (Warehouse Toolkit v1.92.0) — project tjivcqxnkftujceumdtx
--
-- Count what's really on the floor against current_inventory (the BirdsEye feed).
-- A manager picks a warehouse and what to count:
--   customer   — every pallet a customer has in that warehouse
--   item       — one item (optionally one customer)
--   item_lot   — one item + lot
--   bay        — one or more bays (every customer in them)
-- The expected pallets are frozen into cyc_lines when the count is created. Counters scan the
-- LWH ID (or the customer's pallet tag) in the bay they're standing in, and type the qty if the
-- count asks for it. Anything scanned that isn't expected is added as an "extra" (with where the
-- system thinks it really is). Submitting marks unscanned pallets "missing" and checks each
-- difference against the live inventory (shipped since? moved since?). Managers resolve each
-- difference and close the count.
--
-- Separate from the cc_* tables (the Trane / customer-portal cycle counts) — those are untouched.
--
-- Access: Toolkit sign-in (x-lwh-session -> lwh_request_emp()). Counting is open to any
-- signed-in employee; creating, reopening, resolving, closing and cancelling need a warehouse
-- manager (msg_wh_managers). Tables are closed (RLS on, no policies).

create table if not exists public.cyc_counts (
  id             bigint generated always as identity primary key,
  warehouse      text not null,
  scope_type     text not null check (scope_type in ('customer','item','item_lot','bay')),
  customer       text,
  item           text,
  lot            text,
  bays           text[] not null default '{}',
  title          text not null,
  blind          boolean not null default true,
  count_qty      boolean not null default true,
  status         text not null default 'open' check (status in ('open','review','closed','cancelled')),
  note           text,
  snapshot_at    timestamptz,
  created_by     int,
  created_name   text,
  created_at     timestamptz not null default now(),
  submitted_by   int,
  submitted_name text,
  submitted_at   timestamptz,
  closed_by      int,
  closed_name    text,
  closed_at      timestamptz,
  close_note     text
);
create index if not exists cyc_counts_status_idx on public.cyc_counts (status, created_at desc);

create table if not exists public.cyc_lines (
  id            bigint generated always as identity primary key,
  count_id      bigint not null references public.cyc_counts(id) on delete cascade,
  pallet_id     bigint,
  tag           text,
  customer      text,
  item          text,
  description   text,
  lot           text,
  expected      boolean not null default true,
  exp_bay       text,
  exp_qty       numeric,
  counted       boolean not null default false,
  cnt_bay       text,
  cnt_qty       numeric,
  counted_by    int,
  counted_name  text,
  counted_at    timestamptz,
  scanned       text,
  result        text check (result in ('match','qty','bay','qty_bay','missing','extra')),
  note          text,
  sys_where     text,          -- extras: where current_inventory says it is
  now_present   boolean,       -- at submit: still in current_inventory?
  now_bay       text,          -- at submit: its bay now
  resolution    text,
  resolved_name text,
  resolved_at   timestamptz
);
create index if not exists cyc_lines_count_idx  on public.cyc_lines (count_id);
create index if not exists cyc_lines_pallet_idx on public.cyc_lines (count_id, pallet_id);
create index if not exists cyc_lines_tag_idx    on public.cyc_lines (count_id, upper(tag));

alter table public.cyc_counts enable row level security;
alter table public.cyc_lines  enable row level security;

-- ============================================================ helpers (internal)
create or replace function public.cyc_err(p text) returns json language sql immutable as $$
  select json_build_object('ok', false, 'error', p);
$$;

create or replace function public.cyc_is_mgr(p_emp int) returns boolean
language sql stable security definer set search_path = public as $$
  select p_emp is not null and whm_is_manager(p_emp);
$$;

create or replace function public.cyc_name(p_emp int) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(whm_name(p_emp), p_emp::text);
$$;

-- Active inventory rows a scope covers.
create or replace function public.cyc_scope_rows(p_wh text, p_type text, p_customer text, p_item text, p_lot text, p_bays text[])
returns setof public.current_inventory language sql stable security definer set search_path = public as $$
  select ci.* from current_inventory ci
   where ci.warehouse = p_wh
     and coalesce(ci.is_active_inventory, true)
     and case p_type
           when 'customer' then upper(ci.customer) = upper(p_customer)
           when 'item'     then upper(ci.item_number) = upper(p_item)
                                and (coalesce(p_customer,'') = '' or upper(ci.customer) = upper(p_customer))
           when 'item_lot' then upper(ci.item_number) = upper(p_item) and upper(coalesce(ci.lot_number,'')) = upper(coalesce(p_lot,''))
                                and (coalesce(p_customer,'') = '' or upper(ci.customer) = upper(p_customer))
           when 'bay'      then upper(ci.bay_name) = any (select upper(b) from unnest(p_bays) b)
           else false end;
$$;

create or replace function public.cyc_line_result(l public.cyc_lines, p_count_qty boolean) returns text
language sql immutable as $$
  select case
    when not l.expected then 'extra'
    when not l.counted then 'missing'
    else (case
      when (l.cnt_bay is not null and l.exp_bay is not null and upper(l.cnt_bay) <> upper(l.exp_bay))
       and (p_count_qty and l.cnt_qty is not null and l.cnt_qty is distinct from l.exp_qty) then 'qty_bay'
      when (l.cnt_bay is not null and l.exp_bay is not null and upper(l.cnt_bay) <> upper(l.exp_bay)) then 'bay'
      when (p_count_qty and l.cnt_qty is not null and l.cnt_qty is distinct from l.exp_qty) then 'qty'
      else 'match' end) end;
$$;

create or replace function public.cyc_count_json(c public.cyc_counts) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', c.id, 'warehouse', c.warehouse, 'scope_type', c.scope_type, 'customer', c.customer, 'item', c.item,
    'lot', c.lot, 'bays', c.bays, 'title', c.title, 'blind', c.blind, 'count_qty', c.count_qty, 'status', c.status,
    'note', c.note, 'snapshot_at', c.snapshot_at, 'created_name', c.created_name, 'created_at', c.created_at,
    'submitted_name', c.submitted_name, 'submitted_at', c.submitted_at, 'closed_name', c.closed_name,
    'closed_at', c.closed_at, 'close_note', c.close_note,
    'expected', (select count(*) from cyc_lines l where l.count_id = c.id and l.expected),
    'counted',  (select count(*) from cyc_lines l where l.count_id = c.id and l.expected and l.counted),
    'extras',   (select count(*) from cyc_lines l where l.count_id = c.id and not l.expected),
    'diffs',    (select count(*) from cyc_lines l where l.count_id = c.id and l.result is not null and l.result <> 'match'),
    'open_diffs', (select count(*) from cyc_lines l where l.count_id = c.id and l.result is not null and l.result <> 'match' and l.resolution is null),
    'bays_seen', coalesce((select array_agg(distinct upper(l.cnt_bay)) from cyc_lines l where l.count_id = c.id and l.cnt_bay is not null), '{}'));
$$;

-- ============================================================ app RPCs
-- Who am I + warehouses with active inventory.
create or replace function public.cyc_boot()
returns json language plpgsql stable security definer set search_path = public as $$
declare v int := lwh_request_emp();
begin
  if v is null then return cyc_err('sign_in'); end if;
  return json_build_object('ok', true,
    'me', json_build_object('emp_id', v, 'name', cyc_name(v), 'is_manager', cyc_is_mgr(v)),
    'warehouses', coalesce((select json_agg(json_build_object('code', w, 'pallets', n) order by w)
                   from (select warehouse w, count(*) n from current_inventory
                          where coalesce(is_active_inventory,true) and warehouse is not null group by warehouse) x), '[]'::json),
    'synced_at', (select max(synced_at) from current_inventory));
end $$;

-- Picker suggestions within a warehouse: p_field = customer | item | lot | bay.
create or replace function public.cyc_suggest(p_wh text, p_field text, p_q text default '', p_customer text default '', p_item text default '')
returns json language plpgsql stable security definer set search_path = public as $$
declare v int := lwh_request_emp(); q text := upper(trim(coalesce(p_q,'')));
begin
  if v is null then return cyc_err('sign_in'); end if;
  return json_build_object('ok', true, 'rows', coalesce((select json_agg(x) from (
    select val, count(*) pallets, coalesce(sum(quantity),0) qty, max(item_description) descr
      from (select case p_field when 'customer' then customer when 'item' then item_number
                                when 'lot' then lot_number when 'bay' then bay_name end val,
                   quantity, case when p_field = 'item' then item_description end item_description
              from current_inventory
             where warehouse = p_wh and coalesce(is_active_inventory,true)
               and (coalesce(p_customer,'') = '' or upper(customer) = upper(p_customer))
               and (coalesce(p_item,'') = '' or upper(item_number) = upper(p_item))) s
     where val is not null and val <> '' and (q = '' or upper(val) like '%'||q||'%')
     group by val order by (case when upper(val) like q||'%' then 0 else 1 end), val limit 60) x), '[]'::json));
end $$;

-- How big a count would be, before creating it.
create or replace function public.cyc_preview(p_wh text, p_type text, p_scope jsonb)
returns json language plpgsql stable security definer set search_path = public as $$
declare v int := lwh_request_emp(); r record;
begin
  if v is null then return cyc_err('sign_in'); end if;
  select count(*) n, coalesce(sum(quantity),0) qty, count(distinct bay_name) bays, count(distinct customer) custs into r
    from cyc_scope_rows(p_wh, p_type, p_scope->>'customer', p_scope->>'item', p_scope->>'lot',
                        coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_scope->'bays','[]'::jsonb)) x), '{}'));
  return json_build_object('ok', true, 'pallets', r.n, 'qty', r.qty, 'bays', r.bays, 'customers', r.custs);
end $$;

create or replace function public.cyc_create(p_wh text, p_type text, p_scope jsonb, p_blind boolean, p_count_qty boolean, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v int := lwh_request_emp(); c cyc_counts%rowtype; v_bays text[]; v_title text; n int;
        v_cust text := nullif(trim(coalesce(p_scope->>'customer','')),'');
        v_item text := nullif(trim(coalesce(p_scope->>'item','')),'');
        v_lot  text := nullif(trim(coalesce(p_scope->>'lot','')),'');
begin
  if v is null then return cyc_err('sign_in'); end if;
  if not cyc_is_mgr(v) then return cyc_err('Only warehouse managers can start a cycle count.'); end if;
  if coalesce(p_wh,'') = '' then return cyc_err('Pick a warehouse.'); end if;
  v_bays := coalesce((select array_agg(distinct upper(trim(x))) from jsonb_array_elements_text(coalesce(p_scope->'bays','[]'::jsonb)) x where trim(x) <> ''), '{}');
  if p_type = 'customer' and v_cust is null then return cyc_err('Pick a customer.'); end if;
  if p_type in ('item','item_lot') and v_item is null then return cyc_err('Pick an item.'); end if;
  if p_type = 'item_lot' and v_lot is null then return cyc_err('Pick a lot.'); end if;
  if p_type = 'bay' and cardinality(v_bays) = 0 then return cyc_err('Pick at least one bay.'); end if;
  if p_type not in ('customer','item','item_lot','bay') then return cyc_err('Bad count type.'); end if;

  select count(*) into n from cyc_scope_rows(p_wh, p_type, v_cust, v_item, v_lot, v_bays);
  if n = 0 then return cyc_err('Nothing in inventory matches that — nothing to count.'); end if;
  if n > 3000 then return cyc_err(format('That''s %s pallets — too many for one count. Narrow it down (an item, a lot, or a few bays).', n)); end if;

  v_title := replace(p_wh,'WHSE','Whse ')||' · '||case p_type
    when 'customer' then v_cust
    when 'item'     then 'Item '||v_item||coalesce(' ('||v_cust||')','')
    when 'item_lot' then 'Item '||v_item||' Lot '||v_lot
    when 'bay'      then (case when cardinality(v_bays) <= 3 then 'Bay '||array_to_string(v_bays, ', ') else cardinality(v_bays)||' bays' end) end;

  insert into cyc_counts (warehouse, scope_type, customer, item, lot, bays, title, blind, count_qty, note, snapshot_at, created_by, created_name)
  values (p_wh, p_type, v_cust, v_item, v_lot, v_bays, v_title, coalesce(p_blind,true), coalesce(p_count_qty,true),
          nullif(trim(coalesce(p_note,'')),''), (select max(synced_at) from current_inventory), v, cyc_name(v))
  returning * into c;

  insert into cyc_lines (count_id, pallet_id, tag, customer, item, description, lot, expected, exp_bay, exp_qty)
  select c.id, r.pallet_id, r.customer_id, r.customer, r.item_number, r.item_description, r.lot_number, true, r.bay_name, r.quantity
    from cyc_scope_rows(p_wh, p_type, v_cust, v_item, v_lot, v_bays) r;

  return json_build_object('ok', true, 'id', c.id, 'pallets', n);
end $$;

create or replace function public.cyc_list(p_which text default 'active')
returns json language plpgsql stable security definer set search_path = public as $$
declare v int := lwh_request_emp();
begin
  if v is null then return cyc_err('sign_in'); end if;
  return json_build_object('ok', true, 'counts', coalesce((select json_agg(cyc_count_json(c) order by c.created_at desc)
    from (select * from cyc_counts c
           where case p_which when 'active' then c.status in ('open','review')
                              when 'closed' then c.status in ('closed','cancelled') and c.created_at > now() - interval '180 days'
                              else true end
           order by c.created_at desc limit 200) c), '[]'::json));
end $$;

-- One count with its lines. While a blind count is open, counters don't see expected pallets or
-- quantities — only what they've scanned and the bays to visit. Managers always see everything.
create or replace function public.cyc_get(p_id bigint)
returns json language plpgsql stable security definer set search_path = public as $$
declare v int := lwh_request_emp(); c cyc_counts%rowtype; v_mgr boolean; v_hide boolean;
begin
  if v is null then return cyc_err('sign_in'); end if;
  select * into c from cyc_counts where id = p_id;
  if not found then return cyc_err('Count not found.'); end if;
  v_mgr := cyc_is_mgr(v);
  v_hide := c.blind and c.status = 'open' and not v_mgr;
  return json_build_object('ok', true, 'is_manager', v_mgr, 'hidden', v_hide, 'count', cyc_count_json(c),
    'bays', coalesce((select json_agg(json_build_object('bay', b, 'expected', n, 'counted', k) order by b) from (
        select upper(coalesce(exp_bay, cnt_bay)) b, count(*) filter (where expected) n,
               count(*) filter (where counted) k
          from cyc_lines where count_id = p_id group by 1) x), '[]'::json),
    'lines', coalesce((select json_agg(json_build_object(
        'id', l.id, 'pallet_id', l.pallet_id, 'tag', l.tag, 'customer', l.customer, 'item', l.item,
        'description', l.description, 'lot', l.lot, 'expected', l.expected,
        'exp_bay', l.exp_bay,
        'exp_qty', case when v_hide then null else l.exp_qty end,
        'counted', l.counted, 'cnt_bay', l.cnt_bay, 'cnt_qty', l.cnt_qty, 'counted_name', l.counted_name,
        'counted_at', l.counted_at, 'scanned', l.scanned,
        'result', case when v_hide then null when l.result is not null then l.result
                       when l.counted or not l.expected then cyc_line_result(l, c.count_qty) end,
        'note', l.note, 'sys_where', l.sys_where, 'now_present', l.now_present, 'now_bay', l.now_bay,
        'resolution', l.resolution, 'resolved_name', l.resolved_name, 'resolved_at', l.resolved_at)
        order by upper(coalesce(l.exp_bay, l.cnt_bay)), l.customer, l.item, l.lot, l.pallet_id)
      from cyc_lines l where l.count_id = p_id and (not v_hide or l.counted or not l.expected)), '[]'::json));
end $$;

-- Scan one pallet. p_code = LWH ID or the customer's pallet tag.
create or replace function public.cyc_scan(p_id bigint, p_code text, p_bay text, p_qty numeric default null, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v int := lwh_request_emp(); c cyc_counts%rowtype; l cyc_lines%rowtype; ci current_inventory%rowtype;
        code text := upper(regexp_replace(trim(coalesce(p_code,'')),'^\][A-Za-z]\d',''));  -- strip AIM prefix like ]C1
        v_bay text := nullif(upper(trim(coalesce(p_bay,''))),'');
        v_id bigint; was boolean := false; v_res text;
begin
  if v is null then return cyc_err('sign_in'); end if;
  select * into c from cyc_counts where id = p_id;
  if not found then return cyc_err('Count not found.'); end if;
  if c.status <> 'open' then return cyc_err('This count was already submitted.'); end if;
  if code = '' then return cyc_err('Nothing scanned.'); end if;
  if c.count_qty and p_qty is null then return cyc_err('Enter the qty on the pallet.'); end if;
  if p_qty is not null and p_qty < 0 then return cyc_err('Qty can''t be negative.'); end if;
  if code ~ '^\d+$' and length(code) <= 12 then v_id := code::bigint; end if;

  select * into l from cyc_lines
   where count_id = p_id and ((v_id is not null and pallet_id = v_id) or upper(tag) = code or upper(scanned) = code)
   order by expected desc limit 1;

  if found then
    was := l.counted;
    update cyc_lines set counted = true, cnt_bay = coalesce(v_bay, cnt_bay), cnt_qty = coalesce(p_qty, cnt_qty),
           counted_by = v, counted_name = cyc_name(v), counted_at = now(), scanned = code,
           note = coalesce(nullif(trim(coalesce(p_note,'')),''), note)
     where id = l.id returning * into l;
  else
    -- Not expected here. Where does the system think it is?
    select * into ci from current_inventory
     where coalesce(is_active_inventory,true) and ((v_id is not null and pallet_id = v_id) or upper(customer_id) = code)
     order by synced_at desc nulls last limit 1;
    insert into cyc_lines (count_id, pallet_id, tag, customer, item, description, lot, expected, exp_bay, exp_qty,
                           counted, cnt_bay, cnt_qty, counted_by, counted_name, counted_at, scanned, note, sys_where)
    values (p_id, ci.pallet_id, coalesce(ci.customer_id, case when v_id is null then code end), ci.customer, ci.item_number,
            ci.item_description, ci.lot_number, false, null, ci.quantity,
            true, v_bay, p_qty, v, cyc_name(v), now(), code, nullif(trim(coalesce(p_note,'')),''),
            case when ci.pallet_id is null then 'Not in inventory'
                 else replace(ci.warehouse,'WHSE','Whse ')||' · '||coalesce(ci.bay_name,'no bay') end)
    returning * into l;
  end if;

  v_res := cyc_line_result(l, c.count_qty);
  return json_build_object('ok', true, 'line_id', l.id, 'again', was, 'expected', l.expected,
    'result', case when c.blind and not cyc_is_mgr(v) and v_res in ('qty','qty_bay') then (case when v_res = 'qty_bay' then 'bay' else 'match' end) else v_res end,
    'pallet_id', l.pallet_id, 'customer', l.customer, 'item', l.item, 'lot', l.lot,
    'exp_bay', l.exp_bay, 'sys_where', l.sys_where);
end $$;

create or replace function public.cyc_undo(p_line bigint)
returns json language plpgsql security definer set search_path = public as $$
declare v int := lwh_request_emp(); l cyc_lines%rowtype; s text;
begin
  if v is null then return cyc_err('sign_in'); end if;
  select * into l from cyc_lines where id = p_line;
  if not found then return cyc_err('Not found.'); end if;
  select status into s from cyc_counts where id = l.count_id;
  if s <> 'open' then return cyc_err('This count was already submitted.'); end if;
  if l.counted_by is distinct from v and not cyc_is_mgr(v) then return cyc_err('Only the person who scanned it (or a manager) can undo it.'); end if;
  if l.expected then
    update cyc_lines set counted = false, cnt_bay = null, cnt_qty = null, counted_by = null, counted_name = null,
           counted_at = null, scanned = null, note = null where id = p_line;
  else
    delete from cyc_lines where id = p_line;
  end if;
  return json_build_object('ok', true);
end $$;

-- Done counting. Unscanned expected pallets become "missing"; every difference is checked against
-- the live inventory so a pallet that shipped or moved during the count is easy to spot.
create or replace function public.cyc_submit(p_id bigint)
returns json language plpgsql security definer set search_path = public as $$
declare v int := lwh_request_emp(); c cyc_counts%rowtype;
begin
  if v is null then return cyc_err('sign_in'); end if;
  select * into c from cyc_counts where id = p_id for update;
  if not found then return cyc_err('Count not found.'); end if;
  if c.status <> 'open' then return cyc_err('Already submitted.'); end if;
  update cyc_lines l set result = cyc_line_result(l, c.count_qty) where l.count_id = p_id;
  update cyc_lines l set now_present = (ci.pallet_id is not null), now_bay = ci.bay_name
    from (select l2.id, ci2.pallet_id, ci2.bay_name from cyc_lines l2
            left join lateral (select pallet_id, bay_name from current_inventory x
                                where x.pallet_id = l2.pallet_id and coalesce(x.is_active_inventory,true) limit 1) ci2 on true
           where l2.count_id = p_id and l2.result <> 'match' and l2.pallet_id is not null) ci
   where l.id = ci.id;
  update cyc_counts set status = 'review', submitted_by = v, submitted_name = cyc_name(v), submitted_at = now() where id = p_id;
  return json_build_object('ok', true, 'count', cyc_count_json((select x from cyc_counts x where x.id = p_id)));
end $$;

-- Manager actions: reopen | close | cancel | resolve
create or replace function public.cyc_manage(p_id bigint, p_action text, p_line bigint default null, p_text text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v int := lwh_request_emp(); c cyc_counts%rowtype; t text := nullif(trim(coalesce(p_text,'')),'');
begin
  if v is null then return cyc_err('sign_in'); end if;
  if not cyc_is_mgr(v) then return cyc_err('Managers only.'); end if;
  select * into c from cyc_counts where id = p_id for update;
  if not found then return cyc_err('Count not found.'); end if;
  if p_action = 'reopen' then
    if c.status <> 'review' then return cyc_err('Only a submitted count can be reopened.'); end if;
    update cyc_lines set result = null, now_present = null, now_bay = null where count_id = p_id and resolution is null;
    update cyc_counts set status = 'open', submitted_by = null, submitted_name = null, submitted_at = null where id = p_id;
  elsif p_action = 'resolve' then
    if c.status <> 'review' then return cyc_err('Submit the count first.'); end if;
    update cyc_lines set resolution = t, resolved_name = case when t is null then null else cyc_name(v) end,
           resolved_at = case when t is null then null else now() end
     where id = p_line and count_id = p_id;
  elsif p_action = 'close' then
    if c.status <> 'review' then return cyc_err('Submit the count first.'); end if;
    update cyc_counts set status = 'closed', closed_by = v, closed_name = cyc_name(v), closed_at = now(), close_note = t where id = p_id;
  elsif p_action = 'cancel' then
    if c.status in ('closed','cancelled') then return cyc_err('Already finished.'); end if;
    update cyc_counts set status = 'cancelled', closed_by = v, closed_name = cyc_name(v), closed_at = now(), close_note = t where id = p_id;
  else
    return cyc_err('Bad action.');
  end if;
  return json_build_object('ok', true);
end $$;

-- ============================================================ access
do $$
declare f text;
begin
  foreach f in array array['cyc_boot()','cyc_suggest(text,text,text,text,text)','cyc_preview(text,text,jsonb)',
    'cyc_create(text,text,jsonb,boolean,boolean,text)','cyc_list(text)','cyc_get(bigint)',
    'cyc_scan(bigint,text,text,numeric,text)','cyc_undo(bigint)','cyc_submit(bigint)','cyc_manage(bigint,text,bigint,text)']
  loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
  foreach f in array array['cyc_err(text)','cyc_is_mgr(int)','cyc_name(int)',
    'cyc_scope_rows(text,text,text,text,text,text[])','cyc_line_result(public.cyc_lines,boolean)','cyc_count_json(public.cyc_counts)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

insert into public.lwh_protected_rpcs (fn, note) values
  ('cyc_boot','Cycle Counts'),('cyc_suggest','Cycle Counts'),('cyc_preview','Cycle Counts'),('cyc_create','Cycle Counts'),
  ('cyc_list','Cycle Counts'),('cyc_get','Cycle Counts'),('cyc_scan','Cycle Counts'),('cyc_undo','Cycle Counts'),
  ('cyc_submit','Cycle Counts'),('cyc_manage','Cycle Counts')
on conflict (fn) do update set note = excluded.note;
