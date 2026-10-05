-- ============================================================
-- LWH Toolkit v1.66.0 — Outbound Loads (emergency outbound WMS + BOL)
-- Run this once in the Supabase SQL Editor (same project as inventory).
-- Safe to re-run. Needs sql/missed_punches.sql to have been run first
-- (overrides and the Records lookup use the same manager passcode).
--
-- What it does:
--   outbound_loads / outbound_scans   — every outbound load built in the
--                                       app, and every pallet scanned onto
--                                       it (for re-entry into the WMS later).
--   outbound_parties                  — ship-from / ship-to / bill-to
--                                       addresses learned from saved loads
--                                       (the "smart save" suggestions).
--
--   toolkit_outbound_save(load)       — the ONLY way the app writes. Saves
--                                       one load by its private key. Refuses
--                                       any pallet that is already on a
--                                       different (non-void) load, and says
--                                       which BOL has it.
--   toolkit_outbound_shipped_ids()    — pallet IDs already on loads, so every
--                                       device can block a double-ship before
--                                       the pallet goes on the trailer.
--   toolkit_outbound_lookups()        — saved addresses + recent carriers.
--   toolkit_outbound_verify(passcode) — checks a manager passcode for an
--                                       override (not-in-inventory pallet,
--                                       wrong warehouse, short ship, reopen).
--   toolkit_outbound_records(...)     — manager lookup of every load from
--                                       every device, with its pallets.
--   toolkit_outbound_manage(...)      — manager: mark a load entered in the
--                                       WMS / not entered, or void it (frees
--                                       its pallets).
--   The tables themselves are not reachable through the public key.
-- ============================================================

create table if not exists public.outbound_loads (
  id            uuid primary key default gen_random_uuid(),
  client_key    text not null unique,
  bol_no        text,
  status        text not null default 'open',    -- open | closed | void
  warehouse     text,
  sub_customer  text,
  bill_to_ref   text,
  appt          text,
  pro_no        text,
  carrier       text,
  trailer       text,
  seal          text,
  comments      text,
  ship_from     jsonb,
  ship_to       jsonb,
  bill_to       jsonb,
  lines         jsonb,
  events        jsonb,
  pallet_count  integer not null default 0,
  unit_count    numeric not null default 0,
  created_by    text,
  device        text,
  created_at    timestamptz,
  closed_at     timestamptz,
  closed_by     text,
  wms_entered_at timestamptz,
  wms_entered_by text,
  voided_at     timestamptz,
  voided_by     text,
  void_reason   text,
  first_saved_at timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create table if not exists public.outbound_scans (
  id           bigserial primary key,
  load_id      uuid not null references public.outbound_loads(id) on delete cascade,
  seq          integer not null,
  lwh_id       text not null,
  customer_id  text,
  item         text,
  item_desc    text,
  lot          text,
  qty          numeric,
  po           text,
  line_id      text,
  warehouse    text,
  scanned_at   timestamptz,
  scanned_by   text,
  source       text,
  raw          text,
  exception    boolean not null default false,
  override     jsonb,
  unique (load_id, lwh_id)
);
create index if not exists outbound_scans_lwh_idx on public.outbound_scans (upper(lwh_id));
create index if not exists outbound_scans_cust_idx on public.outbound_scans (upper(customer_id));
create index if not exists outbound_loads_updated_idx on public.outbound_loads (updated_at desc);
create index if not exists outbound_loads_bol_idx on public.outbound_loads (upper(bol_no));

create table if not exists public.outbound_parties (
  key        text primary key,          -- kind|name|addr1, lower-cased
  kind       text not null,             -- ship_from | ship_to | bill_to
  name       text not null,
  code       text,
  addr1      text,
  addr2      text,
  city       text,
  phone      text,
  use_count  integer not null default 1,
  last_used  timestamptz not null default now()
);

alter table public.outbound_loads   enable row level security;   -- no policies = no direct API access
alter table public.outbound_scans   enable row level security;
alter table public.outbound_parties enable row level security;
revoke all on public.outbound_loads   from anon, authenticated;
revoke all on public.outbound_scans   from anon, authenticated;
revoke all on public.outbound_parties from anon, authenticated;

-- ------------------------------------------------------------
-- Save (create or update) one load. The scan list sent is the full
-- current list, so removing a pallet in the app removes it here too.
-- Returns {ok, load_id, saved_at, conflicts:[{lwh_id, bol_no}], voided}
-- ------------------------------------------------------------
create or replace function public.toolkit_outbound_save(p_load jsonb)
returns json
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_key     text := left(trim(coalesce(p_load->>'client_key','')), 80);
  v_scans   jsonb := coalesce(p_load->'scans','[]'::jsonb);
  v_status  text := case when p_load->>'status' in ('open','closed') then p_load->>'status' else 'open' end;
  v_bol     text := left(trim(coalesce(p_load->>'bol_no','')), 40);
  v_id      uuid;
  v_cur     outbound_loads%rowtype;
  v_conf    json;
  k         text;
  p         jsonb;
begin
  if length(v_key) < 16 then return json_build_object('ok',false,'error','bad_key'); end if;
  if jsonb_typeof(v_scans) <> 'array' then return json_build_object('ok',false,'error','bad_scans'); end if;
  if jsonb_array_length(v_scans) > 600 then return json_build_object('ok',false,'error','too_many_scans'); end if;

  -- one save at a time, so two devices can't put the same pallet on two loads
  perform pg_advisory_xact_lock(hashtext('toolkit_outbound_save'));

  select * into v_cur from outbound_loads where client_key = v_key;
  if found and v_cur.status = 'void' then
    return json_build_object('ok',true,'voided',true,'load_id',v_cur.id,'void_reason',v_cur.void_reason,'voided_by',v_cur.voided_by);
  end if;

  if v_bol <> '' and exists (select 1 from outbound_loads l where upper(l.bol_no) = upper(v_bol)
                               and l.client_key <> v_key and l.status <> 'void') then
    return json_build_object('ok',false,'error','bol_taken');
  end if;

  insert into outbound_loads as l (client_key, bol_no, status, warehouse, sub_customer, bill_to_ref, appt, pro_no,
      carrier, trailer, seal, comments, ship_from, ship_to, bill_to, lines, events, created_by, device,
      created_at, closed_at, closed_by, updated_at)
  values (v_key, nullif(v_bol,''), v_status,
      left(p_load->>'warehouse',60), left(p_load->>'sub_customer',120), left(p_load->>'bill_to_ref',60),
      left(p_load->>'appt',40), left(p_load->>'pro_no',40), left(p_load->>'carrier',120),
      left(p_load->>'trailer',40), left(p_load->>'seal',60), left(p_load->>'comments',1000),
      p_load->'ship_from', p_load->'ship_to', p_load->'bill_to', p_load->'lines', p_load->'events',
      left(p_load->>'created_by',80), left(p_load->>'device',120),
      nullif(p_load->>'created_at','')::timestamptz, nullif(p_load->>'closed_at','')::timestamptz,
      left(p_load->>'closed_by',80), now())
  on conflict (client_key) do update
     set bol_no=excluded.bol_no, status=excluded.status, warehouse=excluded.warehouse,
         sub_customer=excluded.sub_customer, bill_to_ref=excluded.bill_to_ref, appt=excluded.appt,
         pro_no=excluded.pro_no, carrier=excluded.carrier, trailer=excluded.trailer, seal=excluded.seal,
         comments=excluded.comments, ship_from=excluded.ship_from, ship_to=excluded.ship_to,
         bill_to=excluded.bill_to, lines=excluded.lines, events=excluded.events,
         created_by=coalesce(l.created_by,excluded.created_by), device=excluded.device,
         created_at=coalesce(l.created_at,excluded.created_at), closed_at=excluded.closed_at,
         closed_by=excluded.closed_by, updated_at=now()
  returning id into v_id;

  -- pallets already on a different, non-void load
  select coalesce(json_agg(json_build_object('lwh_id',c.lwh_id,'bol_no',c.bol_no)),'[]'::json) into v_conf
  from (
    select distinct on (upper(trim(x.s->>'lwh_id'))) trim(x.s->>'lwh_id') as lwh_id, coalesce(l.bol_no,'(no BOL #)') as bol_no
    from jsonb_array_elements(v_scans) x(s)
    join outbound_scans s on upper(s.lwh_id) = upper(trim(x.s->>'lwh_id'))
    join outbound_loads l on l.id = s.load_id
    where l.id <> v_id and l.status <> 'void'
  ) c;

  delete from outbound_scans where load_id = v_id;
  insert into outbound_scans (load_id, seq, lwh_id, customer_id, item, item_desc, lot, qty, po, line_id,
      warehouse, scanned_at, scanned_by, source, raw, exception, override)
  select v_id, x.ord::int, left(trim(x.s->>'lwh_id'),80), left(x.s->>'customer_id',80), left(x.s->>'item',80),
         left(x.s->>'item_desc',200), left(x.s->>'lot',60),
         case when (x.s->>'qty') ~ '^-?\d+(\.\d+)?$' then (x.s->>'qty')::numeric end,
         left(x.s->>'po',60), left(x.s->>'line_id',40), left(x.s->>'warehouse',60),
         nullif(x.s->>'scanned_at','')::timestamptz, left(x.s->>'scanned_by',80), left(x.s->>'source',20),
         left(x.s->>'raw',120), coalesce((x.s->>'exception')::boolean,false), x.s->'override'
  from jsonb_array_elements(v_scans) with ordinality as x(s, ord)
  where length(trim(coalesce(x.s->>'lwh_id',''))) between 1 and 80
    and not exists (select 1 from outbound_scans s join outbound_loads l on l.id=s.load_id
                    where upper(s.lwh_id)=upper(trim(x.s->>'lwh_id')) and l.id<>v_id and l.status<>'void')
  on conflict (load_id, lwh_id) do nothing;

  update outbound_loads set
    pallet_count = (select count(*) from outbound_scans where load_id=v_id),
    unit_count   = (select coalesce(sum(qty),0) from outbound_scans where load_id=v_id)
  where id = v_id;

  -- learn addresses for the smart-save suggestions
  foreach k in array array['ship_from','ship_to','bill_to'] loop
    p := p_load->k;
    if p is not null and jsonb_typeof(p)='object' and length(trim(coalesce(p->>'name','')))>0 then
      insert into outbound_parties as op (key, kind, name, code, addr1, addr2, city, phone)
      values (lower(k||'|'||trim(p->>'name')||'|'||trim(coalesce(p->>'addr1',''))), k,
              left(trim(p->>'name'),120), left(p->>'code',40), left(p->>'addr1',160), left(p->>'addr2',160),
              left(p->>'city',120), left(p->>'phone',40))
      on conflict (key) do update set code=excluded.code, addr2=excluded.addr2, city=excluded.city,
             phone=excluded.phone, use_count=op.use_count+case when op.last_used < now()-interval '10 minutes' then 1 else 0 end,
             last_used=now();
    end if;
  end loop;

  return json_build_object('ok',true,'load_id',v_id,'saved_at',now(),'conflicts',v_conf,
    'pallet_count',(select count(*) from outbound_scans where load_id=v_id));
end;
$$;
revoke all on function public.toolkit_outbound_save(jsonb) from public;
grant execute on function public.toolkit_outbound_save(jsonb) to anon, authenticated;

-- ------------------------------------------------------------
-- Pallet IDs already on non-void loads (last 120 days):
-- [[lwh_id, customer_id, bol_no, client_key, status], ...]
-- ------------------------------------------------------------
create or replace function public.toolkit_outbound_shipped_ids()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object('ok',true,'at',now(),'ids',coalesce(json_agg(json_build_array(s.lwh_id,s.customer_id,l.bol_no,l.client_key,l.status)),'[]'::json))
  from outbound_scans s join outbound_loads l on l.id=s.load_id
  where l.status <> 'void' and l.updated_at >= now() - interval '120 days';
$$;
revoke all on function public.toolkit_outbound_shipped_ids() from public;
grant execute on function public.toolkit_outbound_shipped_ids() to anon, authenticated;

-- ------------------------------------------------------------
-- Saved addresses + recent carriers for suggestions
-- ------------------------------------------------------------
create or replace function public.toolkit_outbound_lookups()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object('ok',true,
    'parties',(select coalesce(json_agg(json_build_object('kind',kind,'name',name,'code',code,'addr1',addr1,'addr2',addr2,'city',city,'phone',phone,'uses',use_count) order by last_used desc),'[]'::json)
               from (select * from outbound_parties order by last_used desc limit 500) p),
    'carriers',(select coalesce(json_agg(c order by n desc),'[]'::json)
               from (select carrier as c, count(*) n from outbound_loads where coalesce(carrier,'')<>'' and status<>'void'
                     group by carrier order by count(*) desc limit 100) x));
$$;
revoke all on function public.toolkit_outbound_lookups() from public;
grant execute on function public.toolkit_outbound_lookups() to anon, authenticated;

-- ------------------------------------------------------------
-- Manager passcode check for overrides (shared lockout)
-- ------------------------------------------------------------
create or replace function public.toolkit_outbound_verify(p_passcode text)
returns json
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_err text;
begin
  v_err := toolkit_manager_check(p_passcode);
  if v_err is not null then return json_build_object('ok',false,'error',v_err); end if;
  return json_build_object('ok',true);
end;
$$;
revoke all on function public.toolkit_outbound_verify(text) from public;
grant execute on function public.toolkit_outbound_verify(text) to anon, authenticated;

-- ------------------------------------------------------------
-- Manager lookup: every load from every device, with pallets.
--   p_search — BOL #, bill-to ref, trailer, seal, customer, carrier,
--              ship-to name or a pallet ID / customer ID; blank = recent
--   p_days   — how far back to list when not searching
--   p_filter — 'all' | 'not_entered' (closed, not yet entered in WMS) | 'open' | 'void'
-- ------------------------------------------------------------
create or replace function public.toolkit_outbound_records(
  p_passcode text,
  p_search   text default '',
  p_days     integer default 14,
  p_filter   text default 'all'
)
returns json
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_err  text;
  v_q    text := upper(trim(coalesce(p_search,'')));
  v_rows json;
begin
  v_err := toolkit_manager_check(p_passcode);
  if v_err is not null then return json_build_object('ok',false,'error',v_err); end if;

  with picked as (
    select l.* from outbound_loads l
    where (case coalesce(p_filter,'all')
             when 'not_entered' then l.status='closed' and l.wms_entered_at is null
             when 'open' then l.status='open'
             when 'void' then l.status='void'
             else true end)
      and (case
      when v_q = '' then l.updated_at >= now() - make_interval(days => greatest(1,least(coalesce(p_days,14),3650)))
      else upper(coalesce(l.bol_no,'')) like '%'||v_q||'%'
        or upper(coalesce(l.bill_to_ref,'')) like '%'||v_q||'%'
        or upper(coalesce(l.trailer,'')) like '%'||v_q||'%'
        or upper(coalesce(l.seal,'')) like '%'||v_q||'%'
        or upper(coalesce(l.sub_customer,'')) like '%'||v_q||'%'
        or upper(coalesce(l.carrier,'')) like '%'||v_q||'%'
        or upper(coalesce(l.ship_to->>'name','')) like '%'||v_q||'%'
        or exists (select 1 from outbound_scans s where s.load_id=l.id
                   and (upper(s.lwh_id) like '%'||v_q||'%' or upper(coalesce(s.customer_id,'')) like '%'||v_q||'%'))
    end)
    order by coalesce(l.closed_at,l.updated_at) desc
    limit 200
  )
  select coalesce(json_agg(json_build_object(
      'client_key',p.client_key,'bol_no',p.bol_no,'status',p.status,'warehouse',p.warehouse,'sub_customer',p.sub_customer,
      'bill_to_ref',p.bill_to_ref,'appt',p.appt,'pro_no',p.pro_no,'carrier',p.carrier,'trailer',p.trailer,'seal',p.seal,
      'comments',p.comments,'ship_from',p.ship_from,'ship_to',p.ship_to,'bill_to',p.bill_to,'lines',p.lines,'events',p.events,
      'pallet_count',p.pallet_count,'unit_count',p.unit_count,'created_by',p.created_by,'created_at',p.created_at,
      'closed_at',p.closed_at,'closed_by',p.closed_by,'wms_entered_at',p.wms_entered_at,'wms_entered_by',p.wms_entered_by,
      'voided_at',p.voided_at,'voided_by',p.voided_by,'void_reason',p.void_reason,'updated_at',p.updated_at,
      'scans',(select coalesce(json_agg(json_build_object('seq',s.seq,'lwh_id',s.lwh_id,'customer_id',s.customer_id,'item',s.item,
                 'item_desc',s.item_desc,'lot',s.lot,'qty',s.qty,'po',s.po,'line_id',s.line_id,'warehouse',s.warehouse,
                 'scanned_at',s.scanned_at,'scanned_by',s.scanned_by,'source',s.source,'exception',s.exception,'override',s.override,
                 'match',v_q<>'' and (upper(s.lwh_id) like '%'||v_q||'%' or upper(coalesce(s.customer_id,'')) like '%'||v_q||'%'))
               order by s.seq),'[]'::json) from outbound_scans s where s.load_id=p.id)
    ) order by coalesce(p.closed_at,p.updated_at) desc),'[]'::json)
  into v_rows from picked p;

  return json_build_object('ok',true,'search',v_q,'loads',v_rows);
end;
$$;
revoke all on function public.toolkit_outbound_records(text,text,integer,text) from public;
grant execute on function public.toolkit_outbound_records(text,text,integer,text) to anon, authenticated;

-- ------------------------------------------------------------
-- Manager actions on one load:
--   'wms_entered' — mark it re-entered in the WMS
--   'wms_pending' — undo that
--   'void'        — void the load (frees its pallets for other loads)
-- ------------------------------------------------------------
create or replace function public.toolkit_outbound_manage(
  p_passcode   text,
  p_client_key text,
  p_action     text,
  p_by         text default null,
  p_reason     text default null
)
returns json
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_err text; v_n int;
begin
  v_err := toolkit_manager_check(p_passcode);
  if v_err is not null then return json_build_object('ok',false,'error',v_err); end if;
  if p_action = 'wms_entered' then
    update outbound_loads set wms_entered_at=now(), wms_entered_by=left(p_by,80), updated_at=now() where client_key=p_client_key;
  elsif p_action = 'wms_pending' then
    update outbound_loads set wms_entered_at=null, wms_entered_by=null, updated_at=now() where client_key=p_client_key;
  elsif p_action = 'void' then
    update outbound_loads set status='void', voided_at=now(), voided_by=left(p_by,80), void_reason=left(p_reason,300), updated_at=now()
    where client_key=p_client_key;
  else
    return json_build_object('ok',false,'error','bad_action');
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then return json_build_object('ok',false,'error','not_found'); end if;
  return json_build_object('ok',true);
end;
$$;
revoke all on function public.toolkit_outbound_manage(text,text,text,text,text) from public;
grant execute on function public.toolkit_outbound_manage(text,text,text,text,text) to anon, authenticated;
