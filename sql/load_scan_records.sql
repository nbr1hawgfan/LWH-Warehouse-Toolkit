-- ============================================================
-- LWH Toolkit v1.65.0 — Load Tag Scan records
-- Run this once in the Supabase SQL Editor (same project as inventory).
-- Safe to re-run. Needs sql/missed_punches.sql to have been run first
-- (the Records lookup uses the same manager passcode).
--
-- What it does:
--   load_scan_loads / load_scan_tags  — a permanent record of every load
--                                       scanned in Load Tag Scan.
--   toolkit_save_load_scan(load)      — the ONLY way the app can write.
--                                       It saves one load (and its tags)
--                                       by its private load key; it can't
--                                       read, change or delete other loads.
--   toolkit_load_scan_records(...)    — manager lookup (passcode): recent
--                                       loads, or search by tag / load #.
--   The tables themselves are not reachable through the public key.
-- ============================================================

create table if not exists public.load_scan_loads (
  id            uuid primary key default gen_random_uuid(),
  client_key    text not null unique,          -- private key made by the device for this load
  customer      text,
  load_no       text,
  trailer       text,
  expected      integer,
  tag_count     integer not null default 0,
  scanned_by    text,
  device        text,
  started_at    timestamptz,
  finished_at   timestamptz,
  first_saved_at timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create table if not exists public.load_scan_tags (
  id          bigserial primary key,
  load_id     uuid not null references public.load_scan_loads(id) on delete cascade,
  seq         integer not null,
  tag         text not null,
  scanned_at  timestamptz,
  source      text,
  unique (load_id, tag)
);
create index if not exists load_scan_tags_tag_idx on public.load_scan_tags (tag);
create index if not exists load_scan_loads_updated_idx on public.load_scan_loads (updated_at desc);
create index if not exists load_scan_loads_load_no_idx on public.load_scan_loads (lower(load_no));

alter table public.load_scan_loads enable row level security;   -- no policies = no direct API access
alter table public.load_scan_tags  enable row level security;
revoke all on public.load_scan_loads from anon, authenticated;
revoke all on public.load_scan_tags  from anon, authenticated;

-- ------------------------------------------------------------
-- Save (create or update) one load. Called by the app after scans.
-- p_load = {client_key, customer, load_no, trailer, expected, scanned_by,
--           device, started_at, finished_at, tags:[{tag, scanned_at, source}]}
-- The tag list sent is the full current list (so removing a tag in the
-- app removes it here too).
-- ------------------------------------------------------------
create or replace function public.toolkit_save_load_scan(p_load jsonb)
returns json
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_key   text := left(trim(coalesce(p_load->>'client_key','')), 80);
  v_tags  jsonb := coalesce(p_load->'tags','[]'::jsonb);
  v_id    uuid;
  v_n     integer;
  ts      timestamptz;
  t_txt   text;
begin
  if length(v_key) < 16 then return json_build_object('ok',false,'error','bad_key'); end if;
  if jsonb_typeof(v_tags) <> 'array' then return json_build_object('ok',false,'error','bad_tags'); end if;
  v_n := jsonb_array_length(v_tags);
  if v_n > 400 then return json_build_object('ok',false,'error','too_many_tags'); end if;

  insert into load_scan_loads as l (client_key, customer, load_no, trailer, expected, scanned_by, device, started_at, finished_at, tag_count, updated_at)
  values (v_key,
          left(p_load->>'customer',120), left(p_load->>'load_no',60), left(p_load->>'trailer',40),
          case when (p_load->>'expected') ~ '^\d{1,4}$' then (p_load->>'expected')::int end,
          left(p_load->>'scanned_by',80), left(p_load->>'device',120),
          nullif(p_load->>'started_at','')::timestamptz, nullif(p_load->>'finished_at','')::timestamptz,
          v_n, now())
  on conflict (client_key) do update
     set customer=excluded.customer, load_no=excluded.load_no, trailer=excluded.trailer,
         expected=excluded.expected, scanned_by=coalesce(excluded.scanned_by,l.scanned_by),
         device=excluded.device, started_at=coalesce(l.started_at,excluded.started_at),
         finished_at=excluded.finished_at, tag_count=excluded.tag_count, updated_at=now()
  returning id into v_id;

  -- replace this load's tag list with what the app has now
  delete from load_scan_tags where load_id = v_id;
  insert into load_scan_tags (load_id, seq, tag, scanned_at, source)
  select v_id, x.ord::int, left(trim(x.t->>'tag'),80),
         nullif(x.t->>'scanned_at','')::timestamptz, left(x.t->>'source',20)
  from jsonb_array_elements(v_tags) with ordinality as x(t, ord)
  where length(trim(coalesce(x.t->>'tag',''))) between 1 and 80
  on conflict (load_id, tag) do nothing;

  return json_build_object('ok',true,'load_id',v_id,'tag_count',(select count(*) from load_scan_tags where load_id=v_id),'saved_at',now());
end;
$$;
revoke all on function public.toolkit_save_load_scan(jsonb) from public;
grant execute on function public.toolkit_save_load_scan(jsonb) to anon, authenticated;

-- ------------------------------------------------------------
-- Manager lookup (same passcode as Missed Punches).
--   p_search  — a tag (or part of one) or a load / trailer #; blank = recent
--   p_days    — how far back to list when not searching (default 30)
-- Returns loads (newest first) with their tags.
-- ------------------------------------------------------------
create or replace function public.toolkit_load_scan_records(
  p_passcode text,
  p_search   text default '',
  p_days     integer default 30
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
    select l.* from load_scan_loads l
    where case
      when v_q = '' then l.updated_at >= now() - make_interval(days => greatest(1,least(coalesce(p_days,30),3650)))
      else upper(coalesce(l.load_no,'')) like '%'||v_q||'%'
        or upper(coalesce(l.trailer,'')) like '%'||v_q||'%'
        or upper(coalesce(l.customer,'')) like '%'||v_q||'%'
        or exists (select 1 from load_scan_tags t where t.load_id=l.id and upper(t.tag) like '%'||v_q||'%')
    end
    order by coalesce(l.finished_at,l.updated_at) desc
    limit 200
  )
  select coalesce(json_agg(json_build_object(
      'id',p.id,'customer',p.customer,'load_no',p.load_no,'trailer',p.trailer,'expected',p.expected,
      'tag_count',p.tag_count,'scanned_by',p.scanned_by,'started_at',p.started_at,'finished_at',p.finished_at,
      'first_saved_at',p.first_saved_at,'updated_at',p.updated_at,
      'tags',(select coalesce(json_agg(json_build_object('seq',t.seq,'tag',t.tag,'scanned_at',t.scanned_at,'source',t.source,
                                                         'match',v_q<>'' and upper(t.tag) like '%'||v_q||'%') order by t.seq),'[]'::json)
              from load_scan_tags t where t.load_id=p.id)
    ) order by coalesce(p.finished_at,p.updated_at) desc),'[]'::json)
  into v_rows from picked p;

  return json_build_object('ok',true,'search',v_q,'loads',v_rows);
end;
$$;
revoke all on function public.toolkit_load_scan_records(text,text,integer) from public;
grant execute on function public.toolkit_load_scan_records(text,text,integer) to anon, authenticated;
