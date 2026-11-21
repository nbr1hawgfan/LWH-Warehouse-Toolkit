-- Cycle count analytics (Toolkit v1.102.0). Applied as Supabase migration "cycle_count_analytics".
-- Combines Toolkit counts (cyc_*) and customer-app counts (cc_*, e.g. the Trane app) into one report.

-- Daily on-hand snapshot so weekly "% of the warehouse counted" uses what was on hand that week.
create table if not exists public.inv_onhand_daily (
  day date not null,
  warehouse text not null,
  customer text not null,
  pallets int not null,
  bays int not null,
  primary key (day, warehouse, customer)
);
alter table public.inv_onhand_daily enable row level security;

create or replace function public.inv_onhand_snapshot() returns int
language sql security definer set search_path to 'public' as $$
  with ins as (
    insert into inv_onhand_daily (day, warehouse, customer, pallets, bays)
    select (now() at time zone 'America/Chicago')::date, trim(warehouse), upper(trim(customer)), count(*),
           count(distinct nullif(trim(bay_name),''))
      from current_inventory
     where coalesce(is_active_inventory,true) and coalesce(trim(warehouse),'') <> '' and coalesce(trim(customer),'') <> ''
     group by 2, 3
    on conflict (day, warehouse, customer) do update set pallets = excluded.pallets, bays = excluded.bays
    returning 1)
  select count(*)::int from ins;
$$;
revoke all on function public.inv_onhand_snapshot() from public, anon, authenticated;
select public.inv_onhand_snapshot();
select cron.schedule('inv-onhand-daily', '7 11 * * *', 'select public.inv_onhand_snapshot()');

-- Every finished count line from both systems, one shape.
--   res: match | qty | bay | qty_bay | missing | extra
--   err_reviewed: still an error after the manager's review (not "found / count was wrong",
--                 "shipped during count" or "recounted OK"; for customer-app counts: WMS adjusted or not marked)
create or replace function public.cca_lines(p_from date, p_to date)
returns table (src text, count_id bigint, title text, day date, warehouse text, customer text, bay text, item text,
               expected boolean, res text, err_reviewed boolean, resolution text, counter text)
language sql stable security definer set search_path to 'public' as $$
  select 'toolkit', c.id, c.title, (coalesce(c.submitted_at, c.closed_at) at time zone 'America/Chicago')::date,
         c.warehouse, upper(coalesce(nullif(trim(l.customer),''), c.customer, 'UNKNOWN')),
         coalesce(nullif(l.cnt_bay,''), l.exp_bay), l.item, l.expected, l.result,
         l.result <> 'match' and coalesce(l.resolution,'') not in ('Found — count was wrong','Shipped / moved during count','Recounted — OK'),
         l.resolution, l.counted_name
    from cyc_counts c join cyc_lines l on l.count_id = c.id
   where c.status = 'closed' and l.result in ('match','qty','bay','qty_bay','missing','extra')
     and (coalesce(c.submitted_at, c.closed_at) at time zone 'America/Chicago')::date between p_from and p_to
  union all
  select 'customer_app', c.id, c.title, (coalesce(c.submitted_at, c.closed_at) at time zone 'America/Chicago')::date,
         coalesce(nullif(l.location_code,''), '?'), upper(c.customer_code),
         coalesce(nullif(l.counted_bay,''), l.bay), l.item_number, l.expected,
         case l.result when 'counted' then 'match' when 'qty_diff' then 'qty' when 'wrong_bay' then 'bay'
                       when 'unknown' then 'extra' else l.result end,
         l.result not in ('match','counted') and (l.wms_adjusted or coalesce(l.resolution,'') = ''),
         l.resolution, l.counted_by
    from cc_counts c join cc_lines l on l.count_id = c.id
   where c.status = 'closed' and not coalesce(l.voided,false)
     and l.result in ('match','counted','qty_diff','wrong_bay','missing','extra','unknown')
     and (coalesce(c.submitted_at, c.closed_at) at time zone 'America/Chicago')::date between p_from and p_to;
$$;
revoke all on function public.cca_lines(date, date) from public, anon, authenticated;

create or replace function public.cyc_analytics(p_from date default null, p_to date default null,
                                                p_wh text default null, p_customer text default null)
returns json language plpgsql stable security definer set search_path to 'public' as $$
declare v int := lwh_request_emp();
        f date := coalesce(p_from, (now() at time zone 'America/Chicago')::date - 90);
        t date := coalesce(p_to, (now() at time zone 'America/Chicago')::date);
        wh text := nullif(upper(trim(coalesce(p_wh,''))),'');
        cu text := nullif(upper(trim(coalesce(p_customer,''))),'');
        r json;
begin
  if v is null then return cyc_err('sign_in'); end if;
  if not cyc_is_mgr(v) then return json_build_object('ok',false,'error','Managers only.'); end if;
  if t < f or t - f > 800 then return json_build_object('ok',false,'error','Pick a date range of two years or less.'); end if;

  with L as (
    select * from cca_lines(f, t) x
     where (wh is null or x.warehouse = wh) and (cu is null or x.customer = cu)
  ), oh as (
    select count(*)::int as pallets, count(distinct (trim(warehouse), nullif(trim(bay_name),'')))::int as bays
      from current_inventory
     where coalesce(is_active_inventory,true)
       and (wh is null or trim(warehouse) = wh) and (cu is null or upper(trim(customer)) = cu)
  ), wk as (
    select date_trunc('week', L.day)::date as ws, count(distinct (src,count_id)) as counts, count(*) as lines,
           count(*) filter (where res='match') as matched,
           count(*) filter (where res<>'match') as diffs,
           count(*) filter (where err_reviewed) as errs,
           count(*) filter (where expected) as checked,
           count(distinct (warehouse, bay)) as bays
      from L group by 1
  ), wk2 as (
    select wk.*, coalesce(
             (select sum(d.pallets) from inv_onhand_daily d
               where d.day = (select max(d2.day) from inv_onhand_daily d2 where d2.day <= wk.ws + 6)
                 and (wh is null or d.warehouse = wh) and (cu is null or d.customer = cu)),
             (select oh.pallets from oh))::int as onhand
      from wk
  ), grp as (
    select 'customer' as g, customer as k, count(distinct (src,count_id)) as counts, count(*) as lines,
           count(*) filter (where res='match') as matched, count(*) filter (where err_reviewed) as errs,
           count(*) filter (where expected) as checked from L group by customer
    union all
    select 'warehouse', warehouse, count(distinct (src,count_id)), count(*), count(*) filter (where res='match'),
           count(*) filter (where err_reviewed), count(*) filter (where expected) from L group by warehouse
    union all
    select 'counter', coalesce(nullif(counter,''),'(not recorded)'), count(distinct (src,count_id)), count(*),
           count(*) filter (where res='match'), count(*) filter (where err_reviewed), count(*) filter (where expected)
      from L group by 2
  )
  select json_build_object('ok', true, 'target', 98, 'from', f, 'to', t, 'warehouse', wh, 'customer', cu,
    'onhand', (select row_to_json(oh) from oh),
    'totals', (select json_build_object(
        'counts', count(distinct (src,count_id)), 'lines', count(*),
        'match', count(*) filter (where res='match'), 'qty', count(*) filter (where res='qty'),
        'bay', count(*) filter (where res='bay'), 'qty_bay', count(*) filter (where res='qty_bay'),
        'missing', count(*) filter (where res='missing'), 'extra', count(*) filter (where res='extra'),
        'errors_reviewed', count(*) filter (where err_reviewed),
        'checked', count(*) filter (where expected),
        'bays', count(distinct (warehouse, bay)),
        'accuracy', round(100.0 * count(*) filter (where res='match') / nullif(count(*),0), 2),
        'accuracy_reviewed', round(100.0 * (count(*) - count(*) filter (where err_reviewed)) / nullif(count(*),0), 2))
      from L),
    'weeks', coalesce((select json_agg(json_build_object('week', ws, 'counts', counts, 'lines', lines, 'match', matched,
                 'diffs', diffs, 'errors_reviewed', errs, 'checked', checked, 'bays', bays, 'onhand', onhand,
                 'coverage', round(100.0 * checked / nullif(onhand,0), 1),
                 'accuracy', round(100.0 * matched / nullif(lines,0), 2),
                 'accuracy_reviewed', round(100.0 * (lines - errs) / nullif(lines,0), 2)) order by ws) from wk2), '[]'::json),
    'by_customer', coalesce((select json_agg(json_build_object('key',k,'counts',counts,'lines',lines,'match',matched,'errors_reviewed',errs,'checked',checked,
                    'accuracy', round(100.0*matched/nullif(lines,0),2), 'accuracy_reviewed', round(100.0*(lines-errs)/nullif(lines,0),2)) order by lines desc)
                    from grp where g='customer'), '[]'::json),
    'by_warehouse', coalesce((select json_agg(json_build_object('key',k,'counts',counts,'lines',lines,'match',matched,'errors_reviewed',errs,'checked',checked,
                    'accuracy', round(100.0*matched/nullif(lines,0),2), 'accuracy_reviewed', round(100.0*(lines-errs)/nullif(lines,0),2)) order by k)
                    from grp where g='warehouse'), '[]'::json),
    'by_counter', coalesce((select json_agg(json_build_object('key',k,'counts',counts,'lines',lines,'match',matched,'errors_reviewed',errs,
                    'accuracy', round(100.0*matched/nullif(lines,0),2), 'accuracy_reviewed', round(100.0*(lines-errs)/nullif(lines,0),2)) order by lines desc)
                    from grp where g='counter'), '[]'::json),
    'problem_bays', coalesce((select json_agg(x) from (select warehouse, bay, count(*) filter (where res<>'match') as diffs, count(*) as lines
                    from L group by 1,2 having count(*) filter (where res<>'match') > 0 order by 3 desc, 1, 2 limit 15) x), '[]'::json),
    'problem_items', coalesce((select json_agg(x) from (select customer, item, count(*) filter (where res<>'match') as diffs, count(*) as lines
                    from L where coalesce(item,'') <> '' group by 1,2 having count(*) filter (where res<>'match') > 0 order by 3 desc, 1, 2 limit 15) x), '[]'::json),
    'resolutions', coalesce((select json_agg(x) from (select coalesce(nullif(resolution,''),'(not marked)') as resolution, count(*) as n,
                    bool_or(err_reviewed) as counts_as_error from L where res<>'match' group by 1 order by 2 desc) x), '[]'::json),
    'counts', coalesce((select json_agg(x order by x.day desc, x.id desc) from (
                    select src, count_id as id, max(title) as title, max(L.day) as day, string_agg(distinct warehouse, ', ') as warehouse,
                           string_agg(distinct customer, ', ') as customers, count(*) as lines, count(*) filter (where res='match') as match,
                           count(*) filter (where err_reviewed) as errors_reviewed,
                           round(100.0*count(*) filter (where res='match')/nullif(count(*),0),2) as accuracy,
                           round(100.0*(count(*)-count(*) filter (where err_reviewed))/nullif(count(*),0),2) as accuracy_reviewed,
                           string_agg(distinct counter, ', ') as counters
                      from L group by src, count_id) x), '[]'::json),
    'customers', coalesce((select json_agg(z.c order by z.c) from (select distinct upper(trim(customer)) as c from current_inventory
                    where coalesce(is_active_inventory,true) and coalesce(trim(customer),'') <> ''
                    union select distinct upper(customer_code) from cc_counts) z), '[]'::json),
    'snapshots_since', (select min(d.day) from inv_onhand_daily d)
  ) into r;
  return r;
end $$;
revoke all on function public.cyc_analytics(date, date, text, text) from public;
grant execute on function public.cyc_analytics(date, date, text, text) to anon, authenticated;
