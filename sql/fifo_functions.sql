-- ============================================================
-- LWH Toolkit v1.57.0 — FIFO / Aging
-- Run this once in the Supabase SQL Editor (same project as inventory).
-- Safe to re-run any time.
--
-- Creates two read-only functions over current_inventory:
--
--   toolkit_fifo_item(p_item)          → every on-hand pallet of one item,
--                                        oldest received first (pick order)
--   toolkit_aging_pallets(p_min_days)  → every on-hand pallet received at
--                                        least p_min_days ago, oldest first
--
-- Both count each pallet_id once (DISTINCT ON), the same duplicate-pallet
-- protection as get_item_inventory_summary and the Data Health check.
-- Age is calculated from received_on at query time, so it's always current
-- even between inventory syncs.
-- ============================================================

create or replace function public.toolkit_fifo_item(p_item text)
returns table(
  pallet_id        bigint,
  customer         text,
  item_number      text,
  item_description text,
  lot_number       text,
  quantity         numeric,
  warehouse        text,
  bay_name         text,
  bay_status       text,
  received_on      date,
  age_days         integer
)
language sql
stable
security definer
set search_path = public
as $$
  with matches as (
    select distinct on (ci.pallet_id) ci.*
    from current_inventory ci
    where coalesce(ci.is_active_inventory, true)
      and ci.pallet_id is not null
      -- exact item number (any case); if there's none, fall back to "starts with"
      and (
        upper(trim(ci.item_number)) = upper(trim(p_item))
        or (
          not exists (select 1 from current_inventory x
                      where upper(trim(x.item_number)) = upper(trim(p_item))
                        and coalesce(x.is_active_inventory, true))
          and upper(ci.item_number) like upper(trim(p_item)) || '%'
        )
      )
    order by ci.pallet_id, ci.synced_at desc nulls last
  )
  select m.pallet_id, m.customer, m.item_number, m.item_description, m.lot_number,
         m.quantity, m.warehouse, m.bay_name, m.bay_status,
         m.received_on::date,
         (current_date - m.received_on::date)::int
  from matches m
  where length(trim(coalesce(p_item, ''))) >= 2
  order by m.received_on asc nulls last, m.pallet_id
  limit 1000;
$$;

create or replace function public.toolkit_aging_pallets(p_min_days integer default 90)
returns table(
  pallet_id        bigint,
  customer         text,
  item_number      text,
  item_description text,
  lot_number       text,
  quantity         numeric,
  warehouse        text,
  bay_name         text,
  bay_status       text,
  received_on      date,
  age_days         integer
)
language sql
stable
security definer
set search_path = public
as $$
  select d.pallet_id, d.customer, d.item_number, d.item_description, d.lot_number,
         d.quantity, d.warehouse, d.bay_name, d.bay_status,
         d.received_on::date,
         (current_date - d.received_on::date)::int
  from (
    select distinct on (ci.pallet_id) ci.*
    from current_inventory ci
    where coalesce(ci.is_active_inventory, true)
      and ci.pallet_id is not null
      and ci.received_on is not null
      and ci.received_on::date <= current_date - greatest(coalesce(p_min_days, 90), 0)
    order by ci.pallet_id, ci.synced_at desc nulls last
  ) d
  order by d.received_on asc, d.customer, d.item_number
  limit 5000;
$$;

revoke all on function public.toolkit_fifo_item(text) from public;
revoke all on function public.toolkit_aging_pallets(integer) from public;
grant execute on function public.toolkit_fifo_item(text) to anon, authenticated;
grant execute on function public.toolkit_aging_pallets(integer) to anon, authenticated;

-- Quick tests (swap in a real item number):
-- select * from public.toolkit_fifo_item('ABC123');
-- select count(*) from public.toolkit_aging_pallets(90);
