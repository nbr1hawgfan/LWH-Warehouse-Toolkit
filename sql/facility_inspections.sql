-- Monthly Facility Inspections (Warehouse Toolkit v1.88.0) — project tjivcqxnkftujceumdtx (LWH Companion)
-- APPLIED Nov 17, 2026 (migrations facility_inspections_*). Kept here for reference.
--
-- Replaces the Google Form monthly safety inspection. Warehouses, the Trailer Shop and the Corporate
-- Office are inspected once a month; big buildings are split into zones (5th St. = South End +
-- North End) so two people can each do half. One inspection per zone per month.
--
--   insp_locations     sites, keyed by the BirdsEye code (WHSE10…), with equipment flags
--   insp_zones         parts of a site that are inspected separately (most sites: "Whole building")
--   insp_items         the checklist. Each item says which kinds of site it's for and, optionally,
--                      which equipment the site must have (propane / electric / forklifts / compressor / docks)
--   insp_location_items  per-site exceptions: force an item on (include=true) or off (false)
--   insp_inspections   one per zone per month: draft → submitted
--   insp_answers       one per item: meets / not / na, comment, plus a copy of the item's wording
--   insp_photos        photos (private bucket insp-photos, through Edge Function insp-photo)
--   insp_actions       corrective actions, opened automatically for every "Doesn't Meet Standard"
--   insp_assignments   who is assigned which zone for a month (optional — any inspector can do any zone)
--   insp_admins / insp_inspectors   admins (Tim, Ryan) and extra inspectors beyond the warehouse manager list
--   insp_settings      report recipients, reminder timing, due days, rotation order, mailer key
--
-- Who: inspectors = warehouse manager list (msg_wh_managers) + insp_inspectors + admins.
-- All functions check the Toolkit sign-in (x-lwh-session via lwh_request_emp()) and are in
-- lwh_protected_rpcs. Tables are closed (RLS on, no policies). The mailer (gas/InspectionMailer.gs)
-- uses insp_mail_run(key); the photo Edge Function uses the service role.

-- ============================================================ tables
create table if not exists public.insp_locations (
  code           text primary key,
  name           text not null,
  address        text,
  kind           text not null check (kind in ('warehouse','shop','office')),
  has_propane    boolean not null default false,
  has_electric   boolean not null default false,
  has_compressor boolean not null default false,
  has_docks      boolean not null default false,
  active         boolean not null default true,
  sort           int not null default 100,
  updated_at     timestamptz not null default now()
);

create table if not exists public.insp_zones (
  id            bigserial primary key,
  location_code text not null references public.insp_locations(code) on update cascade,
  name          text not null,
  sort          int not null default 100,
  active        boolean not null default true,
  unique (location_code, name)
);

create table if not exists public.insp_items (
  id             serial primary key,
  legacy_no      int unique,                 -- number on the old Google Form (1–39)
  section        text not null,
  text           text not null,
  kinds          text[] not null default array['warehouse','shop','office'],
  requires       text check (requires in ('propane','electric','forklifts','compressor','docks')),
  photo_required boolean not null default true,   -- photo needed when marked Doesn't Meet
  sort           int not null default 1000,
  active         boolean not null default true,
  updated_at     timestamptz not null default now()
);

create table if not exists public.insp_location_items (
  location_code text not null references public.insp_locations(code) on update cascade,
  item_id       int  not null references public.insp_items(id),
  include       boolean not null,
  primary key (location_code, item_id)
);

create table if not exists public.insp_inspections (
  id            uuid primary key default gen_random_uuid(),
  zone_id       bigint not null references public.insp_zones(id),
  location_code text not null,
  period        date not null check (extract(day from period) = 1),
  status        text not null default 'draft' check (status in ('draft','submitted')),
  started_by    int,
  started_name  text,
  started_at    timestamptz not null default now(),
  updated_by    int,
  updated_at    timestamptz not null default now(),
  submitted_by  int,
  submitted_name text,
  submitted_at  timestamptz,
  notes         text,
  meets_count   int not null default 0,
  not_count     int not null default 0,
  na_count      int not null default 0,
  item_count    int not null default 0,
  emailed_at    timestamptz,
  reopened_at   timestamptz,
  reopened_by   int,
  unique (zone_id, period)
);
create index if not exists insp_inspections_period on public.insp_inspections(period);

create table if not exists public.insp_answers (
  inspection_id uuid not null references public.insp_inspections(id) on delete cascade,
  item_id       int  not null references public.insp_items(id),
  result        text not null check (result in ('meets','not','na')),
  comment       text,
  section       text,
  item_text     text,
  legacy_no     int,
  sort          int,
  updated_at    timestamptz not null default now(),
  primary key (inspection_id, item_id)
);

create table if not exists public.insp_actions (
  id              bigserial primary key,
  inspection_id   uuid not null references public.insp_inspections(id),
  last_inspection_id uuid references public.insp_inspections(id),
  location_code   text not null,
  zone_id         bigint not null,
  item_id         int not null,
  section         text,
  item_text       text,
  comment         text,
  opened_at       timestamptz not null default now(),
  opened_by       int,
  opened_name     text,
  times_found     int not null default 1,
  assigned_emp    int,
  assigned_name   text,
  due_on          date,
  status          text not null default 'open' check (status in ('open','closed')),
  closed_at       timestamptz,
  closed_by       int,
  closed_name     text,
  close_note      text,
  log             jsonb not null default '[]'::jsonb
);
create index if not exists insp_actions_open on public.insp_actions(status, location_code);

create table if not exists public.insp_photos (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid references public.insp_inspections(id) on delete cascade,
  action_id     bigint references public.insp_actions(id),
  item_id       int,
  kind          text not null check (kind in ('finding','fix')),
  storage_path  text not null,
  bytes         int,
  uploaded_by   int,
  created_at    timestamptz not null default now(),
  uploaded_at   timestamptz,
  removed_at    timestamptz
);
create index if not exists insp_photos_insp on public.insp_photos(inspection_id);
create index if not exists insp_photos_action on public.insp_photos(action_id);

create table if not exists public.insp_assignments (
  period   date not null,
  zone_id  bigint not null references public.insp_zones(id),
  emp_id   int not null,
  emp_name text,
  set_by   int,
  set_at   timestamptz not null default now(),
  primary key (period, zone_id)
);

create table if not exists public.insp_admins (
  emp_id   int primary key,
  name     text,
  active   boolean not null default true
);

create table if not exists public.insp_inspectors (       -- extra inspectors beyond the warehouse manager list
  emp_id   int primary key,
  name     text,
  email    text,
  active   boolean not null default true,
  added_at timestamptz not null default now()
);

create table if not exists public.insp_settings (
  id              int primary key default 1 check (id = 1),
  recipients      text[] not null default '{}',     -- extra emails that get every submitted report
  reminder_days   int not null default 5,           -- "still open" reminder this many days before month end
  due_days        int not null default 14,          -- default due date for corrective actions
  rotation        int[] not null default '{}',      -- employee IDs in rotation order (for "suggest next")
  mailer_key_hash text,
  updated_at      timestamptz not null default now()
);
insert into public.insp_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.insp_reminders (
  period  date not null,
  kind    text not null,
  sent_at timestamptz not null default now(),
  primary key (period, kind)
);

alter table public.insp_locations      enable row level security;
alter table public.insp_zones          enable row level security;
alter table public.insp_items          enable row level security;
alter table public.insp_location_items enable row level security;
alter table public.insp_inspections    enable row level security;
alter table public.insp_answers        enable row level security;
alter table public.insp_actions        enable row level security;
alter table public.insp_photos         enable row level security;
alter table public.insp_assignments    enable row level security;
alter table public.insp_admins         enable row level security;
alter table public.insp_inspectors     enable row level security;
alter table public.insp_settings       enable row level security;
alter table public.insp_reminders      enable row level security;

-- ============================================================ seed: sites, zones, admins
insert into public.insp_locations (code, name, address, kind, has_propane, has_electric, has_compressor, has_docks, sort) values
  ('WHSE10','5th St.',            '5th St.',          'warehouse', true, false, true, true, 10),
  ('WHSE11','3109 S. 5th St.',    '3109 S. 5th St.',  'warehouse', true, true,  true, true, 20),
  ('WHSE70','501 Fresno St.',     '501 Fresno St.',   'warehouse', true, false, true, true, 30),
  ('WHSE85','8505 Ball Road',     '8505 Ball Road',   'warehouse', true, false, true, true, 40),
  ('WHSE60','810 S. 28th St. (VB)','810 S. 28th St.-VB','warehouse', true, false, true, true, 50),
  ('WHSE41','1400 S. 6th',        '1400 S. 6th',      'warehouse', true, false, true, true, 60),
  ('WHSE40','1300 S. 6th',        '1300 S. 6th',      'warehouse', true, true,  true, true, 70),
  ('CORP',  'Corporate Office',   null,               'office',    false,false, false,false, 80),
  ('SHOP',  'Trailer Shop',       null,               'shop',      false,false, true, false, 90)
on conflict (code) do nothing;

insert into public.insp_zones (location_code, name, sort) values
  ('WHSE10','South End',10),('WHSE10','North End',20),
  ('WHSE11','Whole building',10),('WHSE70','Whole building',10),('WHSE85','Whole building',10),
  ('WHSE60','Whole building',10),('WHSE41','Whole building',10),('WHSE40','Whole building',10),
  ('CORP','Whole building',10),('SHOP','Whole building',10)
on conflict (location_code, name) do nothing;

insert into public.insp_admins (emp_id, name) values (93945,'Timothy G. Jennings'),(12345,'Ryan E. Hewitt')
on conflict (emp_id) do nothing;

-- ============================================================ seed: checklist
-- Original Google Form items keep their number in legacy_no (wording fixes applied).
-- kinds: W = warehouse, S = shop, O = office.
insert into public.insp_items (legacy_no, section, text, kinds, requires, photo_required, sort) values
  -- Fire & Emergency
  (1,'Fire & Emergency','Emergency exits are clearly marked, unobstructed, and easily accessible.','{warehouse,shop,office}',null,true,110),
  (2,'Fire & Emergency','Fire extinguishers are present, properly charged, in their designated locations, and signed off monthly.','{warehouse,shop,office}',null,true,120),
  (3,'Fire & Emergency','First aid kits are available, adequately stocked, and accessible.','{warehouse,shop,office}',null,true,130),
  (4,'Fire & Emergency','Safety signs and warnings are visible and appropriately placed.','{warehouse,shop,office}',null,true,140),
  (null,'Fire & Emergency','Eyewash station is accessible, unobstructed, and checked/flushed.','{warehouse,shop}','electric',true,150),
  -- Housekeeping & Storage
  (5,'Housekeeping & Storage','Stored materials are secured and limited in height to specifications to prevent collapse.','{warehouse,shop}',null,true,210),
  (6,'Housekeeping & Storage','Work areas are clean, organized, trash cans emptied, and free of clutter.','{warehouse,shop,office}',null,true,220),
  (7,'Housekeeping & Storage','Aisles and walkways are clear of debris.','{warehouse,shop,office}',null,true,230),
  (10,'Housekeeping & Storage','Storage racks and shelves are stable and appropriately used.','{warehouse,shop}',null,true,240),
  (35,'Housekeeping & Storage','Waste and scrap materials are properly disposed of.','{warehouse,shop,office}',null,true,250),
  (36,'Housekeeping & Storage','Flammable materials are stored in designated areas.','{warehouse,shop}',null,true,260),
  (null,'Housekeeping & Storage','Spill kit is available and stocked.','{warehouse,shop}',null,true,270),
  -- Docks & Barriers
  (8,'Docks & Barriers','Docks and dock plates are functional, and safety barriers are in place when not in use.','{warehouse,shop}','docks',true,310),
  (null,'Docks & Barriers','Wheel chocks or dock locks are used on trailers at the doors.','{warehouse,shop}','docks',true,320),
  (null,'Docks & Barriers','Trailer stands are placed under trailers dropped without a tractor.','{warehouse,shop}','docks',true,330),
  (9,'Docks & Barriers','Safety barriers or guardrails are in place where needed.','{warehouse,shop}',null,true,340),
  -- PPE, Labeling & SDS
  (11,'PPE, Labeling & SDS','Adequate supplies of PPE are available and in good condition.','{warehouse,shop}',null,true,410),
  (12,'PPE, Labeling & SDS','Steel or composite toed footwear is worn in areas where necessary.','{warehouse,shop}',null,true,420),
  (13,'PPE, Labeling & SDS','Containers are properly labeled.','{warehouse,shop}',null,true,430),
  (null,'PPE, Labeling & SDS','Safety Data Sheets (SDS) binder is present, current, and accessible.','{warehouse,shop}',null,true,440),
  -- Security
  (14,'Security','Site is secured with fence and gates; gates are closed and locked.','{warehouse,shop,office}',null,true,510),
  (15,'Security','Access controls (ID cards, locks, etc.) are in place and functioning properly.','{warehouse,shop,office}',null,true,520),
  (16,'Security','Security cameras and alarms are operational and monitored effectively.','{warehouse,shop,office}',null,true,530),
  (17,'Security','Interior and exterior lighting is adequate for safety and security.','{warehouse,shop,office}',null,true,540),
  -- Electrical & Building
  (18,'Electrical & Building','Electrical outlets, cords, and wiring are in good condition without visible damage.','{warehouse,shop,office}',null,true,610),
  (19,'Electrical & Building','36" of clear space is maintained in front of electrical panels.','{warehouse,shop,office}',null,true,620),
  (20,'Electrical & Building','Circuit breakers and electrical panels are accessible and labeled.','{warehouse,shop,office}',null,true,630),
  (21,'Electrical & Building','No roof or wall leaks observed.','{warehouse,shop,office}',null,true,640),
  (31,'Electrical & Building','Adequate ventilation is provided to prevent the buildup of heat or gas emissions.','{warehouse,shop}',null,true,650),
  -- Forklift Operations
  (22,'Forklift Operations','All lift operators are properly trained and certified.','{warehouse,shop}','forklifts',false,710),
  (23,'Forklift Operations','All lift operators are conducting daily pre-shift forklift inspections.','{warehouse,shop}','forklifts',false,720),
  (24,'Forklift Operations','Lift operators were observed traveling at a safe speed and direction and wearing seatbelts.','{warehouse,shop}','forklifts',false,730),
  (25,'Forklift Operations','Lift operators were conscious of load centering and weight capacities.','{warehouse,shop}','forklifts',false,740),
  -- Propane
  (26,'Propane','Propane tanks not in use are secured to prevent tipping.','{warehouse,shop}','propane',true,810),
  -- Battery Charging
  (27,'Battery Charging','Proper battery charging/changing practices are in place.','{warehouse,shop}','electric',true,910),
  (28,'Battery Charging','Battery charging stations are free of exposed wires and damage.','{warehouse,shop}','electric',true,920),
  -- Air Compressors
  (null,'Air Compressors','Compressor and air hoses are in good condition, guards in place, no leaks.','{warehouse,shop}','compressor',true,1010),
  (null,'Air Compressors','Compressed air used for cleaning is reduced to less than 30 psi.','{warehouse,shop}','compressor',false,1020),
  -- Tools & Equipment
  (29,'Tools & Equipment','Machines and equipment are properly guarded and have safety features in place.','{warehouse,shop}',null,true,1110),
  (30,'Tools & Equipment','Damaged or excessively worn equipment is tagged out or removed from service.','{warehouse,shop}',null,true,1120),
  (32,'Tools & Equipment','Tools are stored and secured when not in use.','{warehouse,shop}',null,true,1130),
  (33,'Tools & Equipment','Tool and maintenance areas are organized and not a tripping hazard.','{warehouse,shop}',null,true,1140),
  (34,'Tools & Equipment','Tools in need of repair are properly tagged and placed out of service.','{warehouse,shop}',null,true,1150),
  -- Trailer Shop
  (null,'Trailer Shop','Lockout/tagout procedures are followed during repairs.','{shop}',null,false,1210),
  (null,'Trailer Shop','Gas cylinders are chained upright, with oxygen stored apart from fuel gas.','{shop}',null,true,1220),
  (null,'Trailer Shop','Jacks and jack stands are rated for the load and in good condition.','{shop}',null,true,1230),
  (null,'Trailer Shop','Trailers being worked on are chocked and supported.','{shop}',null,true,1240),
  (null,'Trailer Shop','A tire inflation cage or clip-on chuck is used when inflating tires.','{shop}',null,true,1250),
  (null,'Trailer Shop','Grinder guards and tool rests are in place and adjusted.','{shop}',null,true,1260),
  (null,'Trailer Shop','Used oil, antifreeze, and solvents are stored in labeled, closed containers.','{shop}',null,true,1270),
  -- Incident Reporting & Plans
  (37,'Incident Reporting & Plans','Emergency response plans are regularly reviewed and communicated to employees.','{warehouse,shop,office}',null,false,1310),
  (38,'Incident Reporting & Plans','Any first aid injuries reported were forwarded to Site Management.','{warehouse,shop,office}',null,false,1320),
  (39,'Incident Reporting & Plans','There are policies and procedures for reporting accidents or injuries.','{warehouse,shop,office}',null,false,1330)
on conflict do nothing;

-- The Trailer Shop has no electric lifts but needs the eyewash item.
insert into public.insp_location_items (location_code, item_id, include)
select 'SHOP', id, true from public.insp_items where text like 'Eyewash station%'
on conflict do nothing;

-- ============================================================ helpers (internal)
create or replace function public.insp_today()
returns date language sql stable set search_path = public as $$ select (now() at time zone 'America/Chicago')::date $$;

create or replace function public.insp_period(p date)
returns date language sql immutable set search_path = public as $$ select date_trunc('month', p)::date $$;

create or replace function public.insp_is_admin(p_emp int)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from insp_admins where emp_id = p_emp and active)
$$;

create or replace function public.insp_can_inspect(p_emp int)
returns boolean language sql stable security definer set search_path = public as $$
  select p_emp is not null and (insp_is_admin(p_emp) or whm_is_manager(p_emp)
     or exists(select 1 from insp_inspectors where emp_id = p_emp and active))
$$;

create or replace function public.insp_emp_name(p_emp int)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select coalesce(nullif(trim(full_name),''), first_name) from emp_employees where emp_id = p_emp),
    (select name from msg_wh_managers where emp_id = p_emp),
    (select name from insp_inspectors where emp_id = p_emp),
    (select name from insp_admins where emp_id = p_emp),
    'Employee ' || p_emp)
$$;

create or replace function public.insp_emp_email(p_emp int)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(trim(email),'') from msg_wh_managers where emp_id = p_emp and is_active),
    (select nullif(trim(email),'') from insp_inspectors where emp_id = p_emp and active))
$$;

-- Does an item apply at a site? Exceptions first, then kind + equipment.
create or replace function public.insp_applies(i public.insp_items, l public.insp_locations)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select include from insp_location_items x where x.location_code = l.code and x.item_id = i.id),
    i.active and l.kind = any(i.kinds) and case i.requires
      when 'propane'    then l.has_propane
      when 'electric'   then l.has_electric
      when 'forklifts'  then l.has_propane or l.has_electric
      when 'compressor' then l.has_compressor
      when 'docks'      then l.has_docks
      else true end)
  and i.active
$$;

create or replace function public.insp_items_for(p_code text)
returns setof public.insp_items language sql stable security definer set search_path = public as $$
  select i.* from insp_items i, insp_locations l
   where l.code = p_code and insp_applies(i, l) order by i.sort, i.id
$$;

create or replace function public.insp_err(p text)
returns json language sql immutable set search_path = public as $$ select json_build_object('ok', false, 'error', p) $$;

-- Who's calling (signed-in Toolkit session) — null if not allowed to inspect.
create or replace function public.insp_caller()
returns int language plpgsql stable security definer set search_path = public as $$
declare v int := lwh_request_emp();
begin
  if v is null or not insp_can_inspect(v) then return null; end if;
  return v;
end $$;

create or replace function public.insp_no_access()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if lwh_request_emp() is null then return insp_err('sign_in'); end if;
  return insp_err('no_access');
end $$;

create or replace function public.insp_photos_json(p_inspection uuid)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', id, 'item_id', item_id, 'kind', kind) order by created_at), '[]'::json)
    from insp_photos where inspection_id = p_inspection and kind = 'finding' and uploaded_at is not null and removed_at is null
$$;

-- ============================================================ read
create or replace function public.insp_bootstrap()
returns json language plpgsql stable security definer set search_path = public as $$
declare v int := insp_caller(); v_admin boolean; s insp_settings%rowtype;
begin
  if v is null then return insp_no_access(); end if;
  v_admin := insp_is_admin(v);
  select * into s from insp_settings where id = 1;
  return json_build_object('ok', true,
    'today', insp_today(),
    'me', json_build_object('emp_id', v, 'name', insp_emp_name(v), 'is_admin', v_admin),
    'locations', coalesce((select json_agg(json_build_object(
        'code', l.code, 'name', l.name, 'address', l.address, 'kind', l.kind,
        'has_propane', l.has_propane, 'has_electric', l.has_electric, 'has_compressor', l.has_compressor, 'has_docks', l.has_docks,
        'active', l.active, 'sort', l.sort,
        'zones', coalesce((select json_agg(json_build_object('id', z.id, 'name', z.name, 'sort', z.sort, 'active', z.active) order by z.sort, z.id)
                             from insp_zones z where z.location_code = l.code), '[]'::json),
        'items', coalesce((select json_agg(i.id order by i.sort, i.id) from insp_items_for(l.code) i), '[]'::json),
        'overrides', coalesce((select json_object_agg(x.item_id, x.include) from insp_location_items x where x.location_code = l.code), '{}'::json)
      ) order by l.sort, l.code) from insp_locations l), '[]'::json),
    'items', coalesce((select json_agg(json_build_object('id', i.id, 'legacy_no', i.legacy_no, 'section', i.section, 'text', i.text,
        'kinds', i.kinds, 'requires', i.requires, 'photo_required', i.photo_required, 'sort', i.sort, 'active', i.active) order by i.sort, i.id)
      from insp_items i), '[]'::json),
    'inspectors', coalesce((select json_agg(x order by x.name) from (
        select m.emp_id, insp_emp_name(m.emp_id) as name from msg_wh_managers m where m.is_active
        union select i.emp_id, insp_emp_name(i.emp_id) from insp_inspectors i where i.active
        union select a.emp_id, insp_emp_name(a.emp_id) from insp_admins a where a.active) x), '[]'::json),
    'open_actions', (select count(*) from insp_actions where status = 'open'),
    'overdue_actions', (select count(*) from insp_actions where status = 'open' and due_on < insp_today()),
    'settings', case when v_admin then json_build_object('recipients', s.recipients, 'reminder_days', s.reminder_days,
        'due_days', s.due_days, 'rotation', s.rotation, 'mailer_set', s.mailer_key_hash is not null,
        'extra_inspectors', coalesce((select json_agg(json_build_object('emp_id', emp_id, 'name', name, 'email', email, 'active', active) order by name) from insp_inspectors), '[]'::json),
        'admins', coalesce((select json_agg(json_build_object('emp_id', emp_id, 'name', insp_emp_name(emp_id), 'active', active) order by name) from insp_admins), '[]'::json))
      else null end);
end $$;

create or replace function public.insp_month(p_period date default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare v int := insp_caller(); v_p date := insp_period(coalesce(p_period, insp_today()));
begin
  if v is null then return insp_no_access(); end if;
  return json_build_object('ok', true, 'period', v_p,
    'zones', coalesce((select json_agg(json_build_object(
        'zone_id', z.id, 'location_code', z.location_code,
        'assigned', (select json_build_object('emp_id', a.emp_id, 'name', a.emp_name) from insp_assignments a where a.period = v_p and a.zone_id = z.id),
        'inspection', (select json_build_object('id', i.id, 'status', i.status, 'started_name', i.started_name, 'started_at', i.started_at,
            'updated_at', i.updated_at, 'submitted_name', i.submitted_name, 'submitted_at', i.submitted_at,
            'meets', i.meets_count, 'not', i.not_count, 'na', i.na_count, 'total', i.item_count,
            'answered', (select count(*) from insp_answers x where x.inspection_id = i.id))
          from insp_inspections i where i.zone_id = z.id and i.period = v_p)
      ) order by z.sort, z.id) from insp_zones z join insp_locations l on l.code = z.location_code
       where (z.active and l.active) or exists(select 1 from insp_inspections i where i.zone_id = z.id and i.period = v_p)), '[]'::json),
    'actions_by_location', coalesce((select json_object_agg(location_code, n) from
        (select location_code, count(*) n from insp_actions where status = 'open' group by location_code) t), '{}'::json));
end $$;

create or replace function public.insp_get(p_zone_id bigint, p_period date)
returns json language plpgsql stable security definer set search_path = public as $$
declare v int := insp_caller(); i insp_inspections%rowtype; v_p date := insp_period(p_period);
begin
  if v is null then return insp_no_access(); end if;
  select * into i from insp_inspections where zone_id = p_zone_id and period = v_p;
  if not found then return json_build_object('ok', true, 'inspection', null, 'answers', '[]'::json, 'photos', '[]'::json,
      'open_actions', (select coalesce(json_agg(json_build_object('id', a.id, 'item_id', a.item_id, 'opened_at', a.opened_at, 'times_found', a.times_found)), '[]'::json)
                         from insp_actions a where a.zone_id = p_zone_id and a.status = 'open')); end if;
  return insp_detail_json(i.id);
end $$;

create or replace function public.insp_detail_json(p_id uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('ok', true,
    'inspection', json_build_object('id', i.id, 'zone_id', i.zone_id, 'location_code', i.location_code, 'period', i.period, 'status', i.status,
        'zone_name', (select name from insp_zones where id = i.zone_id), 'location_name', (select name from insp_locations where code = i.location_code),
        'started_by', i.started_by, 'started_name', i.started_name, 'started_at', i.started_at, 'updated_at', i.updated_at,
        'submitted_name', i.submitted_name, 'submitted_at', i.submitted_at, 'notes', i.notes,
        'meets', i.meets_count, 'not', i.not_count, 'na', i.na_count, 'total', i.item_count, 'reopened_at', i.reopened_at),
    'answers', coalesce((select json_agg(json_build_object('item_id', a.item_id, 'result', a.result, 'comment', a.comment,
        'section', a.section, 'text', a.item_text, 'legacy_no', a.legacy_no, 'sort', a.sort) order by a.sort, a.item_id)
      from insp_answers a where a.inspection_id = i.id), '[]'::json),
    'photos', insp_photos_json(i.id),
    'open_actions', (select coalesce(json_agg(json_build_object('id', a.id, 'item_id', a.item_id, 'opened_at', a.opened_at, 'times_found', a.times_found)), '[]'::json)
                       from insp_actions a where a.zone_id = i.zone_id and a.status = 'open'))
  from insp_inspections i where i.id = p_id
$$;

create or replace function public.insp_detail(p_id uuid)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if insp_caller() is null then return insp_no_access(); end if;
  if not exists(select 1 from insp_inspections where id = p_id) then return insp_err('not_found'); end if;
  return insp_detail_json(p_id);
end $$;

create or replace function public.insp_history(p_from date default null, p_to date default null, p_location text default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare v_from date := insp_period(coalesce(p_from, insp_today() - 365)); v_to date := insp_period(coalesce(p_to, insp_today()));
begin
  if insp_caller() is null then return insp_no_access(); end if;
  return json_build_object('ok', true, 'from', v_from, 'to', v_to,
    'rows', coalesce((select json_agg(json_build_object('id', i.id, 'period', i.period, 'location_code', i.location_code,
        'location_name', l.name, 'zone_name', z.name, 'status', i.status, 'submitted_name', coalesce(i.submitted_name, i.started_name),
        'submitted_at', i.submitted_at, 'meets', i.meets_count, 'not', i.not_count, 'na', i.na_count, 'total', i.item_count,
        'photos', (select count(*) from insp_photos p where p.inspection_id = i.id and p.uploaded_at is not null and p.removed_at is null))
        order by i.period desc, l.sort, z.sort)
      from insp_inspections i join insp_zones z on z.id = i.zone_id join insp_locations l on l.code = i.location_code
     where i.period between v_from and v_to and (p_location is null or p_location = '' or i.location_code = p_location)), '[]'::json));
end $$;

-- Every answer in a date range (for the Excel export).
create or replace function public.insp_export(p_from date, p_to date, p_location text default null)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if insp_caller() is null then return insp_no_access(); end if;
  return json_build_object('ok', true, 'rows', coalesce((select json_agg(json_build_object(
      'period', i.period, 'location_code', i.location_code, 'location_name', l.name, 'zone_name', z.name,
      'status', i.status, 'inspector', coalesce(i.submitted_name, i.started_name), 'submitted_at', i.submitted_at,
      'section', a.section, 'legacy_no', a.legacy_no, 'item', a.item_text, 'result', a.result, 'comment', a.comment)
      order by i.period, l.sort, z.sort, a.sort)
    from insp_inspections i join insp_zones z on z.id = i.zone_id join insp_locations l on l.code = i.location_code
    join insp_answers a on a.inspection_id = i.id
   where i.period between insp_period(p_from) and insp_period(p_to) and (p_location is null or p_location = '' or i.location_code = p_location)), '[]'::json));
end $$;

-- ============================================================ write: inspections
create or replace function public.insp_ensure_draft(p_emp int, p_zone_id bigint, p_period date)
returns json language plpgsql security definer set search_path = public as $$
declare z insp_zones%rowtype; i insp_inspections%rowtype; v_p date := insp_period(p_period);
begin
  select * into z from insp_zones where id = p_zone_id;
  if not found then return insp_err('Zone not found.'); end if;
  if v_p > insp_period(insp_today()) then return insp_err('That month hasn''t started yet.'); end if;
  if v_p < insp_period(insp_today()) - interval '2 months' and not insp_is_admin(p_emp) then
    return insp_err('Only an admin can start an inspection for a month that long ago.');
  end if;
  insert into insp_inspections (zone_id, location_code, period, started_by, started_name, updated_by)
  values (p_zone_id, z.location_code, v_p, p_emp, insp_emp_name(p_emp), p_emp)
  on conflict (zone_id, period) do nothing;
  select * into i from insp_inspections where zone_id = p_zone_id and period = v_p;
  return json_build_object('ok', true, 'id', i.id, 'status', i.status);
end $$;

-- Save answers (draft), or submit. p_answers: [{item_id, result, comment}] — the full set on screen.
create or replace function public.insp_save(p_zone_id bigint, p_period date, p_answers jsonb, p_notes text default null, p_submit boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare v int := insp_caller(); r json; i insp_inspections%rowtype; l insp_locations%rowtype;
        v_missing json; v_nocomment json; v_nophoto json; v_due int; a record; v_act bigint;
begin
  if v is null then return insp_no_access(); end if;
  r := insp_ensure_draft(v, p_zone_id, p_period);
  if not (r->>'ok')::boolean then return r; end if;
  select * into i from insp_inspections where id = (r->>'id')::uuid for update;
  if i.status = 'submitted' then return insp_err('already_submitted'); end if;
  select * into l from insp_locations where code = i.location_code;

  -- Replace the answers with what's on screen (only items that apply here).
  delete from insp_answers where inspection_id = i.id;
  insert into insp_answers (inspection_id, item_id, result, comment, section, item_text, legacy_no, sort)
  select i.id, it.id, x.result, nullif(left(trim(coalesce(x.comment,'')), 2000), ''), it.section, it.text, it.legacy_no, it.sort
    from jsonb_to_recordset(coalesce(p_answers,'[]'::jsonb)) as x(item_id int, result text, comment text)
    join insp_items_for(i.location_code) it on it.id = x.item_id
   where x.result in ('meets','not','na')
  on conflict (inspection_id, item_id) do nothing;

  update insp_inspections set notes = nullif(left(trim(coalesce(p_notes,'')), 4000), ''), updated_by = v, updated_at = now(),
         meets_count = (select count(*) from insp_answers where inspection_id = i.id and result = 'meets'),
         not_count   = (select count(*) from insp_answers where inspection_id = i.id and result = 'not'),
         na_count    = (select count(*) from insp_answers where inspection_id = i.id and result = 'na'),
         item_count  = (select count(*) from insp_items_for(i.location_code))
   where id = i.id;

  if not coalesce(p_submit, false) then
    return json_build_object('ok', true, 'id', i.id, 'status', 'draft');
  end if;

  -- Submit: everything answered, every "Doesn't Meet" has a comment and (where required) a photo.
  select coalesce(json_agg(it.id), '[]'::json) into v_missing from insp_items_for(i.location_code) it
   where not exists(select 1 from insp_answers x where x.inspection_id = i.id and x.item_id = it.id);
  select coalesce(json_agg(x.item_id), '[]'::json) into v_nocomment from insp_answers x
   where x.inspection_id = i.id and x.result = 'not' and coalesce(x.comment,'') = '';
  select coalesce(json_agg(x.item_id), '[]'::json) into v_nophoto from insp_answers x join insp_items it on it.id = x.item_id
   where x.inspection_id = i.id and x.result = 'not' and it.photo_required
     and not exists(select 1 from insp_photos p where p.inspection_id = i.id and p.item_id = x.item_id and p.kind = 'finding'
                     and p.uploaded_at is not null and p.removed_at is null);
  if json_array_length(v_missing) + json_array_length(v_nocomment) + json_array_length(v_nophoto) > 0 then
    return json_build_object('ok', false, 'error', 'incomplete', 'missing', v_missing, 'no_comment', v_nocomment, 'no_photo', v_nophoto);
  end if;

  update insp_inspections set status = 'submitted', submitted_by = v, submitted_name = insp_emp_name(v), submitted_at = now(),
         emailed_at = null
   where id = i.id;

  -- Corrective actions. A finding that's already open for this zone and item counts as "found again".
  select due_days into v_due from insp_settings where id = 1;
  -- Resubmitted after a reopen: drop open actions from this inspection whose item no longer fails.
  delete from insp_actions ac where ac.inspection_id = i.id and ac.status = 'open' and ac.times_found = 1
     and jsonb_array_length(ac.log) = 0 and ac.assigned_emp is null
     and not exists(select 1 from insp_answers x where x.inspection_id = i.id and x.item_id = ac.item_id and x.result = 'not')
     and not exists(select 1 from insp_photos p where p.action_id = ac.id);
  for a in select x.* from insp_answers x where x.inspection_id = i.id and x.result = 'not' loop
    v_act := null;
    select id into v_act from insp_actions where zone_id = i.zone_id and item_id = a.item_id and status = 'open' order by opened_at limit 1;
    if v_act is null then
      insert into insp_actions (inspection_id, last_inspection_id, location_code, zone_id, item_id, section, item_text, comment,
                                opened_by, opened_name, due_on)
      values (i.id, i.id, i.location_code, i.zone_id, a.item_id, a.section, a.item_text, a.comment, v, insp_emp_name(v),
              insp_today() + coalesce(v_due, 14));
    elsif (select last_inspection_id from insp_actions where id = v_act) is distinct from i.id then
      update insp_actions set times_found = times_found + 1, last_inspection_id = i.id,
             comment = coalesce(a.comment, comment),
             log = log || jsonb_build_array(jsonb_build_object('at', now(), 'by', insp_emp_name(v), 'what',
                   'Found again in the ' || to_char(i.period, 'FMMonth YYYY') || ' inspection' || coalesce(': ' || a.comment, '')))
       where id = v_act;
    end if;
  end loop;

  return json_build_object('ok', true, 'id', i.id, 'status', 'submitted',
    'actions', (select count(*) from insp_answers where inspection_id = i.id and result = 'not'));
end $$;

create or replace function public.insp_reopen(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v int := insp_caller();
begin
  if v is null then return insp_no_access(); end if;
  if not insp_is_admin(v) then return insp_err('Only an admin can reopen a submitted inspection.'); end if;
  update insp_inspections set status = 'draft', reopened_at = now(), reopened_by = v where id = p_id and status = 'submitted';
  if not found then return insp_err('not_found'); end if;
  return json_build_object('ok', true);
end $$;

-- Throw away a draft (admin, or whoever started it).
create or replace function public.insp_discard(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v int := insp_caller(); i insp_inspections%rowtype;
begin
  if v is null then return insp_no_access(); end if;
  select * into i from insp_inspections where id = p_id;
  if not found or i.status <> 'draft' then return insp_err('Only a draft can be discarded.'); end if;
  if not insp_is_admin(v) and i.started_by is distinct from v then return insp_err('Only the person who started it or an admin can discard this draft.'); end if;
  if exists(select 1 from insp_actions where inspection_id = p_id or last_inspection_id = p_id) then
    return insp_err('This inspection was submitted before — reopened inspections can''t be discarded.');
  end if;
  update insp_photos set removed_at = now(), inspection_id = null where inspection_id = p_id;
  delete from insp_inspections where id = p_id;
  return json_build_object('ok', true);
end $$;

-- ============================================================ photos (Edge Function insp-photo, service role)
create or replace function public.insp_photo_register(p_token text, p_zone_id bigint, p_period date, p_item_id int, p_action_id bigint, p_bytes int)
returns json language plpgsql security definer set search_path = public as $$
declare v int := whm_session_emp(p_token); r json; v_insp uuid; v_loc text; v_kind text; v_id uuid := gen_random_uuid(); v_n int;
begin
  if v is null then return insp_err('signed_out'); end if;
  if not insp_can_inspect(v) then return insp_err('no_access'); end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 8388608 then return insp_err('Photo must be under 8 MB.'); end if;
  if (select count(*) from insp_photos where uploaded_by = v and created_at > now() - interval '1 hour') >= 150 then
    return insp_err('Too many photos this hour. Try again later.');
  end if;
  if p_action_id is not null then
    select location_code into v_loc from insp_actions where id = p_action_id;
    if v_loc is null then return insp_err('Corrective action not found.'); end if;
    v_kind := 'fix';
    if (select count(*) from insp_photos where action_id = p_action_id and kind = 'fix' and removed_at is null) >= 6 then
      return insp_err('That action already has 6 photos.');
    end if;
  else
    r := insp_ensure_draft(v, p_zone_id, p_period);
    if not (r->>'ok')::boolean then return r; end if;
    v_insp := (r->>'id')::uuid;
    if r->>'status' = 'submitted' then return insp_err('already_submitted'); end if;
    select location_code into v_loc from insp_inspections where id = v_insp;
    if not exists(select 1 from insp_items_for(v_loc) it where it.id = p_item_id) then return insp_err('That item isn''t on this checklist.'); end if;
    v_kind := 'finding';
    select count(*) into v_n from insp_photos where inspection_id = v_insp and item_id = p_item_id and removed_at is null and uploaded_at is not null;
    if v_n >= 6 then return insp_err('6 photos per item at most.'); end if;
  end if;
  insert into insp_photos (id, inspection_id, action_id, item_id, kind, storage_path, bytes, uploaded_by)
  values (v_id, v_insp, p_action_id, p_item_id, v_kind, to_char(insp_today(), 'YYYY-MM') || '/' || v_loc || '/' || v_id || '.jpg', p_bytes, v);
  return json_build_object('ok', true, 'id', v_id, 'path', (select storage_path from insp_photos where id = v_id), 'inspection_id', v_insp);
end $$;

create or replace function public.insp_photo_uploaded(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update insp_photos set uploaded_at = now() where id = p_id
$$;

-- Signed-link access: any inspector may view any inspection photo.
create or replace function public.insp_photo_paths(p_token text, p_ids uuid[])
returns json language plpgsql stable security definer set search_path = public as $$
declare v int := whm_session_emp(p_token);
begin
  if v is null then return insp_err('signed_out'); end if;
  if not insp_can_inspect(v) then return insp_err('no_access'); end if;
  return json_build_object('ok', true, 'photos', coalesce((select json_agg(json_build_object('id', id, 'path', storage_path))
    from insp_photos where id = any(p_ids) and uploaded_at is not null and removed_at is null), '[]'::json));
end $$;

-- Remove a photo from a draft (or from an open action).
create or replace function public.insp_photo_remove(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v int := insp_caller(); p insp_photos%rowtype;
begin
  if v is null then return insp_no_access(); end if;
  select * into p from insp_photos where id = p_id;
  if not found then return insp_err('not_found'); end if;
  if p.inspection_id is not null and (select status from insp_inspections where id = p.inspection_id) <> 'draft' then
    return insp_err('Photos on a submitted inspection can''t be removed.');
  end if;
  if p.action_id is not null and (select status from insp_actions where id = p.action_id) <> 'open' then
    return insp_err('Photos on a closed action can''t be removed.');
  end if;
  if p.uploaded_by is distinct from v and not insp_is_admin(v) then return insp_err('Only the person who took it or an admin can remove this photo.'); end if;
  update insp_photos set removed_at = now() where id = p_id;
  return json_build_object('ok', true);
end $$;

-- ============================================================ corrective actions
create or replace function public.insp_actions_list(p_status text default 'open', p_location text default null)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if insp_caller() is null then return insp_no_access(); end if;
  return json_build_object('ok', true, 'today', insp_today(), 'rows', coalesce((select json_agg(json_build_object(
      'id', a.id, 'location_code', a.location_code, 'location_name', l.name, 'zone_name', z.name, 'zone_id', a.zone_id,
      'item_id', a.item_id, 'section', a.section, 'text', a.item_text, 'comment', a.comment,
      'opened_at', a.opened_at, 'opened_name', a.opened_name, 'times_found', a.times_found,
      'period', (select period from insp_inspections where id = a.inspection_id),
      'last_period', (select period from insp_inspections where id = a.last_inspection_id),
      'inspection_id', a.inspection_id,
      'assigned_emp', a.assigned_emp, 'assigned_name', a.assigned_name, 'due_on', a.due_on, 'status', a.status,
      'closed_at', a.closed_at, 'closed_name', a.closed_name, 'close_note', a.close_note, 'log', a.log,
      'photos', coalesce((select json_agg(json_build_object('id', p.id, 'kind', p.kind) order by p.created_at) from insp_photos p
                 where p.uploaded_at is not null and p.removed_at is null and
                   ((p.kind = 'finding' and p.item_id = a.item_id and p.inspection_id in (a.inspection_id, a.last_inspection_id))
                    or (p.kind = 'fix' and p.action_id = a.id))), '[]'::json))
      order by a.status, a.due_on nulls last, a.opened_at)
    from insp_actions a join insp_locations l on l.code = a.location_code join insp_zones z on z.id = a.zone_id
   where (coalesce(p_status,'open') = 'all' or a.status = coalesce(p_status,'open'))
     and (coalesce(p_status,'open') <> 'closed' or a.closed_at > now() - interval '400 days')
     and (p_location is null or p_location = '' or a.location_code = p_location)), '[]'::json));
end $$;

-- p_data: {assigned_emp (null = nobody), due_on, note, close: true + close_note, reopen: true}
create or replace function public.insp_action_update(p_id bigint, p_data jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare v int := insp_caller(); a insp_actions%rowtype; v_name text; v_emp int; v_what text[] := '{}';
begin
  if v is null then return insp_no_access(); end if;
  select * into a from insp_actions where id = p_id for update;
  if not found then return insp_err('not_found'); end if;
  v_name := insp_emp_name(v);

  if coalesce((p_data->>'reopen')::boolean, false) then
    if a.status <> 'closed' then return insp_err('That action is already open.'); end if;
    update insp_actions set status = 'open', closed_at = null, closed_by = null, closed_name = null,
           log = log || jsonb_build_array(jsonb_build_object('at', now(), 'by', v_name, 'what', 'Reopened' || coalesce(': ' || nullif(trim(p_data->>'note'),''), '')))
     where id = p_id;
    return json_build_object('ok', true);
  end if;
  if a.status = 'closed' then return insp_err('That action is closed. Reopen it first.'); end if;

  if p_data ? 'assigned_emp' then
    v_emp := nullif(p_data->>'assigned_emp','')::int;
    if v_emp is distinct from a.assigned_emp then
      update insp_actions set assigned_emp = v_emp, assigned_name = case when v_emp is null then null else insp_emp_name(v_emp) end where id = p_id;
      v_what := v_what || case when v_emp is null then 'Unassigned' else 'Assigned to ' || insp_emp_name(v_emp) end;
    end if;
  end if;
  if p_data ? 'due_on' and (p_data->>'due_on') is distinct from a.due_on::text then
    update insp_actions set due_on = nullif(p_data->>'due_on','')::date where id = p_id;
    v_what := v_what || ('Due ' || coalesce(to_char(nullif(p_data->>'due_on','')::date, 'FMMon FMDD, YYYY'), 'date cleared'));
  end if;
  if nullif(trim(p_data->>'note'),'') is not null and not coalesce((p_data->>'close')::boolean, false) then
    v_what := v_what || left(trim(p_data->>'note'), 1000);
  end if;
  if coalesce((p_data->>'close')::boolean, false) then
    if nullif(trim(p_data->>'close_note'),'') is null then return insp_err('Say what was done to fix it.'); end if;
    update insp_actions set status = 'closed', closed_at = now(), closed_by = v, closed_name = v_name,
           close_note = left(trim(p_data->>'close_note'), 2000) where id = p_id;
    v_what := v_what || ('Closed: ' || left(trim(p_data->>'close_note'), 1000));
  end if;
  if array_length(v_what, 1) > 0 then
    update insp_actions set log = log || (select jsonb_agg(jsonb_build_object('at', now(), 'by', v_name, 'what', w)) from unnest(v_what) w)
     where id = p_id;
  end if;
  return json_build_object('ok', true);
end $$;

-- ============================================================ admin
create or replace function public.insp_admin_save(p_kind text, p_data jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare v int := insp_caller(); v_id bigint; v_p date; v_emp int; z bigint;
begin
  if v is null then return insp_no_access(); end if;
  if not insp_is_admin(v) and p_kind <> 'assign' then return insp_err('Admins only.'); end if;

  if p_kind = 'location' then
    if coalesce(trim(p_data->>'code'),'') !~ '^[A-Z0-9_-]{2,12}$' then return insp_err('Code must be 2–12 capital letters or numbers (like WHSE90).'); end if;
    if coalesce(trim(p_data->>'name'),'') = '' then return insp_err('Enter a name.'); end if;
    insert into insp_locations (code, name, address, kind, has_propane, has_electric, has_compressor, has_docks, active, sort)
    values (trim(p_data->>'code'), trim(p_data->>'name'), nullif(trim(p_data->>'address'),''), coalesce(p_data->>'kind','warehouse'),
            coalesce((p_data->>'has_propane')::boolean,false), coalesce((p_data->>'has_electric')::boolean,false),
            coalesce((p_data->>'has_compressor')::boolean,false), coalesce((p_data->>'has_docks')::boolean,false),
            coalesce((p_data->>'active')::boolean,true), coalesce((p_data->>'sort')::int, 100))
    on conflict (code) do update set name = excluded.name, address = excluded.address, kind = excluded.kind,
       has_propane = excluded.has_propane, has_electric = excluded.has_electric, has_compressor = excluded.has_compressor,
       has_docks = excluded.has_docks, active = excluded.active, sort = excluded.sort, updated_at = now();
    if not exists(select 1 from insp_zones where location_code = trim(p_data->>'code')) then
      insert into insp_zones (location_code, name, sort) values (trim(p_data->>'code'), 'Whole building', 10);
    end if;

  elsif p_kind = 'zone' then
    if coalesce(trim(p_data->>'name'),'') = '' then return insp_err('Enter a zone name.'); end if;
    if nullif(p_data->>'id','') is null then
      insert into insp_zones (location_code, name, sort) values (p_data->>'location_code', trim(p_data->>'name'), coalesce((p_data->>'sort')::int, 100));
    else
      update insp_zones set name = trim(p_data->>'name'), sort = coalesce((p_data->>'sort')::int, sort),
             active = coalesce((p_data->>'active')::boolean, active) where id = (p_data->>'id')::bigint;
    end if;

  elsif p_kind = 'item' then
    if coalesce(trim(p_data->>'text'),'') = '' or coalesce(trim(p_data->>'section'),'') = '' then return insp_err('Enter the section and the wording.'); end if;
    if nullif(p_data->>'id','') is null then
      insert into insp_items (section, text, kinds, requires, photo_required, sort, active)
      values (trim(p_data->>'section'), trim(p_data->>'text'),
              coalesce((select array_agg(x) from jsonb_array_elements_text(p_data->'kinds') x), array['warehouse','shop']),
              nullif(p_data->>'requires',''), coalesce((p_data->>'photo_required')::boolean, true),
              coalesce((p_data->>'sort')::int, (select coalesce(max(sort),0) + 10 from insp_items where section = trim(p_data->>'section'))),
              coalesce((p_data->>'active')::boolean, true));
    else
      update insp_items set section = trim(p_data->>'section'), text = trim(p_data->>'text'),
             kinds = coalesce((select array_agg(x) from jsonb_array_elements_text(p_data->'kinds') x), kinds),
             requires = nullif(p_data->>'requires',''), photo_required = coalesce((p_data->>'photo_required')::boolean, photo_required),
             sort = coalesce((p_data->>'sort')::int, sort), active = coalesce((p_data->>'active')::boolean, active), updated_at = now()
       where id = (p_data->>'id')::int;
    end if;

  elsif p_kind = 'override' then
    if p_data->'include' is null or jsonb_typeof(p_data->'include') = 'null' then
      delete from insp_location_items where location_code = p_data->>'location_code' and item_id = (p_data->>'item_id')::int;
    else
      insert into insp_location_items (location_code, item_id, include)
      values (p_data->>'location_code', (p_data->>'item_id')::int, (p_data->>'include')::boolean)
      on conflict (location_code, item_id) do update set include = excluded.include;
    end if;

  elsif p_kind = 'assign' then
    -- Admins assign anyone; anyone else can only take an unassigned zone for themselves.
    v_p := insp_period(coalesce(nullif(p_data->>'period','')::date, insp_today()));
    v_emp := nullif(p_data->>'emp_id','')::int;
    if v_emp is not null and not insp_can_inspect(v_emp) then return insp_err('That person isn''t on the inspector list.'); end if;
    for z in select (x)::bigint from jsonb_array_elements_text(coalesce(p_data->'zone_ids','[]'::jsonb)) x loop
      if not insp_is_admin(v) then
        if v_emp is distinct from v or exists(select 1 from insp_assignments where period = v_p and zone_id = z and emp_id <> v) then
          return insp_err('Only an admin can assign zones to other people.');
        end if;
      end if;
      if v_emp is null then delete from insp_assignments where period = v_p and zone_id = z;
      else
        insert into insp_assignments (period, zone_id, emp_id, emp_name, set_by) values (v_p, z, v_emp, insp_emp_name(v_emp), v)
        on conflict (period, zone_id) do update set emp_id = excluded.emp_id, emp_name = excluded.emp_name, set_by = v, set_at = now();
      end if;
    end loop;

  elsif p_kind = 'settings' then
    update insp_settings set
      recipients = coalesce((select array_agg(distinct lower(trim(x))) from jsonb_array_elements_text(p_data->'recipients') x
                              where trim(x) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'), '{}'),
      reminder_days = greatest(1, least(20, coalesce((p_data->>'reminder_days')::int, reminder_days))),
      due_days = greatest(1, least(120, coalesce((p_data->>'due_days')::int, due_days))),
      rotation = coalesce((select array_agg(x::int) from jsonb_array_elements_text(p_data->'rotation') x where x ~ '^\d+$'), rotation),
      updated_at = now()
     where id = 1;

  elsif p_kind = 'inspector' then
    v_emp := nullif(p_data->>'emp_id','')::int;
    if v_emp is null then return insp_err('Enter the employee ID.'); end if;
    insert into insp_inspectors (emp_id, name, email, active)
    values (v_emp, coalesce(nullif(trim(p_data->>'name'),''), insp_emp_name(v_emp)), nullif(lower(trim(p_data->>'email')),''), coalesce((p_data->>'active')::boolean, true))
    on conflict (emp_id) do update set name = excluded.name, email = excluded.email, active = excluded.active;

  elsif p_kind = 'admin' then
    v_emp := nullif(p_data->>'emp_id','')::int;
    if v_emp is null then return insp_err('Enter the employee ID.'); end if;
    if v_emp = v and not coalesce((p_data->>'active')::boolean, true) then return insp_err('You can''t remove yourself as an admin.'); end if;
    insert into insp_admins (emp_id, name, active) values (v_emp, insp_emp_name(v_emp), coalesce((p_data->>'active')::boolean, true))
    on conflict (emp_id) do update set active = excluded.active;

  else
    return insp_err('bad_kind');
  end if;
  return json_build_object('ok', true);
end $$;

-- ============================================================ mailer (gas/InspectionMailer.gs, every 15 minutes)
-- Returns (and marks as sent) the newly submitted inspections and any reminders that are due.
create or replace function public.insp_mail_run(p_key text)
returns json language plpgsql security definer set search_path = public as $$
declare s insp_settings%rowtype; v_p date := insp_period(insp_today()); v_days_left int;
        v_reports json; v_reminders jsonb := '[]'::jsonb; v_admin_to text[]; v_open json;
begin
  select * into s from insp_settings where id = 1;
  if s.mailer_key_hash is null or encode(sha256(convert_to(coalesce(p_key,''),'UTF8')),'hex') <> s.mailer_key_hash then
    return insp_err('bad_key');
  end if;
  v_admin_to := array(select distinct e from (
      select insp_emp_email(emp_id) e from insp_admins where active
      union select unnest(s.recipients)) t where e is not null);

  -- 1. Submitted inspections not emailed yet.
  with due as (
    select i.id from insp_inspections i where i.status = 'submitted' and i.emailed_at is null
     order by i.submitted_at limit 10 for update skip locked
  ), marked as (
    update insp_inspections i set emailed_at = now() from due where i.id = due.id returning i.*
  )
  select coalesce(json_agg(json_build_object(
      'to', (select array(select distinct e from unnest(v_admin_to || insp_emp_email(m.submitted_by)) e where e is not null)),
      'id', m.id, 'period', m.period, 'location_code', m.location_code,
      'location_name', (select name from insp_locations where code = m.location_code),
      'zone_name', (select name from insp_zones where id = m.zone_id),
      'zones_in_location', (select count(*) from insp_zones where location_code = m.location_code and active),
      'submitted_name', m.submitted_name, 'submitted_at', m.submitted_at, 'notes', m.notes,
      'meets', m.meets_count, 'not', m.not_count, 'na', m.na_count, 'total', m.item_count,
      'reopened', m.reopened_at is not null,
      'findings', coalesce((select json_agg(json_build_object('section', a.section, 'text', a.item_text, 'comment', a.comment,
            'legacy_no', a.legacy_no,
            'photos', (select count(*) from insp_photos p where p.inspection_id = m.id and p.item_id = a.item_id and p.uploaded_at is not null and p.removed_at is null),
            'times_found', (select times_found from insp_actions ac where ac.zone_id = m.zone_id and ac.item_id = a.item_id and ac.status = 'open' order by opened_at limit 1))
          order by a.sort) from insp_answers a where a.inspection_id = m.id and a.result = 'not'), '[]'::json),
      'na_items', coalesce((select json_agg(a.item_text order by a.sort) from insp_answers a where a.inspection_id = m.id and a.result = 'na'), '[]'::json))
    order by m.submitted_at), '[]'::json)
    into v_reports from marked m;

  -- 2. Start of month: tell each assigned inspector which zones are theirs (once per month, from the 1st).
  if not exists(select 1 from insp_reminders where period = v_p and kind = 'start')
     and exists(select 1 from insp_assignments where period = v_p) then
    insert into insp_reminders (period, kind) values (v_p, 'start');
    v_reminders := v_reminders || coalesce((select jsonb_agg(jsonb_build_object('kind', 'start', 'period', v_p,
        'to', jsonb_build_array(insp_emp_email(t.emp_id)), 'name', insp_emp_name(t.emp_id), 'zones', t.zones))
      from (select a.emp_id, jsonb_agg(jsonb_build_object('location', l.name, 'zone', z.name, 'zones_in_location',
                   (select count(*) from insp_zones zz where zz.location_code = l.code and zz.active)) order by l.sort, z.sort) zones
              from insp_assignments a join insp_zones z on z.id = a.zone_id join insp_locations l on l.code = z.location_code
             where a.period = v_p group by a.emp_id) t where insp_emp_email(t.emp_id) is not null), '[]'::jsonb);
  end if;

  -- 3. Near month end: zones not submitted yet → their assignee, and a full list to admins/recipients.
  v_days_left := (v_p + interval '1 month')::date - insp_today();
  if v_days_left <= s.reminder_days and not exists(select 1 from insp_reminders where period = v_p and kind = 'due') then
    insert into insp_reminders (period, kind) values (v_p, 'due');
    with openz as (
      select z.id, l.name location, z.name zone, l.sort ls, z.sort zs,
             (select count(*) from insp_zones zz where zz.location_code = l.code and zz.active) zones_in_location,
             a.emp_id, (select status from insp_inspections i where i.zone_id = z.id and i.period = v_p) st
        from insp_zones z join insp_locations l on l.code = z.location_code
        left join insp_assignments a on a.period = v_p and a.zone_id = z.id
       where z.active and l.active
         and not exists(select 1 from insp_inspections i where i.zone_id = z.id and i.period = v_p and i.status = 'submitted'))
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_open from (
      select jsonb_build_object('kind', 'due', 'period', v_p, 'days_left', v_days_left,
             'to', jsonb_build_array(insp_emp_email(o.emp_id)), 'name', insp_emp_name(o.emp_id),
             'zones', jsonb_agg(jsonb_build_object('location', o.location, 'zone', o.zone, 'zones_in_location', o.zones_in_location,
                                                   'status', coalesce(o.st, 'not started')) order by o.ls, o.zs)) x
        from openz o where o.emp_id is not null and insp_emp_email(o.emp_id) is not null group by o.emp_id
      union all
      select jsonb_build_object('kind', 'due_summary', 'period', v_p, 'days_left', v_days_left, 'to', to_jsonb(v_admin_to),
             'zones', jsonb_agg(jsonb_build_object('location', o.location, 'zone', o.zone, 'zones_in_location', o.zones_in_location,
                      'status', coalesce(o.st, 'not started'), 'assigned', insp_emp_name(o.emp_id)) order by o.ls, o.zs),
             'overdue_actions', (select count(*) from insp_actions where status = 'open' and due_on < insp_today()))
        from openz o having count(*) > 0 and cardinality(v_admin_to) > 0) t;
    v_reminders := v_reminders || v_open::jsonb;
  end if;

  return json_build_object('ok', true, 'reports', v_reports, 'reminders', v_reminders);
end $$;

-- ============================================================ access
do $$
declare f text;
begin
  foreach f in array array[
    'insp_bootstrap()','insp_month(date)','insp_get(bigint,date)','insp_detail(uuid)','insp_history(date,date,text)',
    'insp_export(date,date,text)','insp_save(bigint,date,jsonb,text,boolean)','insp_reopen(uuid)','insp_discard(uuid)',
    'insp_photo_remove(uuid)','insp_actions_list(text,text)','insp_action_update(bigint,jsonb)','insp_admin_save(text,jsonb)',
    'insp_mail_run(text)']
  loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
  -- Internal / service-role only.
  foreach f in array array[
    'insp_photo_register(text,bigint,date,int,bigint,int)','insp_photo_uploaded(uuid)','insp_photo_paths(text,uuid[])',
    'insp_ensure_draft(int,bigint,date)','insp_detail_json(uuid)','insp_caller()','insp_no_access()','insp_is_admin(int)',
    'insp_can_inspect(int)','insp_emp_name(int)','insp_emp_email(int)','insp_items_for(text)','insp_photos_json(uuid)',
    'insp_applies(public.insp_items,public.insp_locations)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

insert into public.lwh_protected_rpcs (fn, note) values
  ('insp_bootstrap','Facility Inspections'),('insp_month','Facility Inspections'),('insp_get','Facility Inspections'),
  ('insp_detail','Facility Inspections'),('insp_history','Facility Inspections'),('insp_export','Facility Inspections'),
  ('insp_save','Facility Inspections'),('insp_reopen','Facility Inspections'),('insp_discard','Facility Inspections'),
  ('insp_photo_remove','Facility Inspections'),('insp_actions_list','Facility Inspections'),
  ('insp_action_update','Facility Inspections'),('insp_admin_save','Facility Inspections')
on conflict (fn) do update set note = excluded.note;

-- Private bucket for photos (Edge Function insp-photo signs links for 1 hour).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('insp-photos', 'insp-photos', false, 8388608, array['image/jpeg'])
on conflict (id) do nothing;

-- ============================================================ MAILER KEY
-- Make up a long random key, put it in the Apps Script's Script Properties as INSP_MAILER_KEY, and
-- run this in the SQL Editor with the same key (do NOT save the real key in this file):
--   update public.insp_settings set mailer_key_hash = encode(sha256(convert_to('PASTE-KEY-HERE','UTF8')),'hex') where id = 1;
