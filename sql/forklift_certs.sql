-- ============================================================
-- LWH Toolkit v1.76.0 — Forklift Certification
-- Run this in the Supabase SQL Editor (same project as inventory).
-- Requires sql/missed_punches.sql to have been run first (it creates the
-- shared manager passcode check, toolkit_manager_check).
--
-- >>> This repo is public. Never put real email addresses, the mailer key,
-- >>> or the manager passcode in this file. Emails are entered in the app
-- >>> (Forklift Certs → Settings). The mailer key is set at the bottom.
--
-- How it works
--   1. Employee takes the written test in the Toolkit (Forklift Test).
--      Questions come from fc_questions; the correct answers never leave
--      the database — scoring happens in fc_submit_test().
--   2. Pass (default 90%+) → status "awaiting practical". A manager/trainer
--      does the hands-on driving evaluation in Forklift Certs and signs off.
--   3. Practical pass → certificate issued (LWH-FL-YYYY-NNNN), good for
--      3 years (OSHA 1910.178(l)(4)(iii)). Any older cert for that employee
--      is marked "superseded".
--   4. Emails go out through a small Google Apps Script (gas/ folder). The
--      app hands the script a one-time token; the script asks this database
--      who to send to — the app can never pick the recipients itself.
--
-- v1.76.1 adds imported certs + fc_mgr_update_cert (bottom of file).
-- Safe to re-run. Question seed only adds missing questions (edits made in
-- the app are kept).
-- ============================================================

-- ---------- Tables ----------
create table if not exists public.fc_settings (
  id                  integer primary key default 1 check (id = 1),
  questions_per_test  integer not null default 12 check (questions_per_test >= 12),
  pass_pct            numeric not null default 90 check (pass_pct between 50 and 100),
  cert_years          integer not null default 3 check (cert_years between 1 and 3),
  max_fails_per_day   integer not null default 3 check (max_fails_per_day between 1 and 10),
  hr_emails           text not null default '',
  mailer_url          text not null default '',
  mailer_key_hash     text,
  updated_at          timestamptz not null default now()
);
insert into public.fc_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.fc_managers (
  id          bigint generated always as identity primary key,
  name        text not null,
  email       text not null default '',
  location    text not null default '',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.fc_questions (
  id          bigint generated always as identity primary key,
  q_code      text not null unique,
  question    text not null,
  correct     text not null,
  options     text[] not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  updated_at  timestamptz not null default now(),
  check (correct = any(options)),
  check (cardinality(options) between 2 and 6)
);

create table if not exists public.fc_attempts (
  id              uuid primary key default gen_random_uuid(),
  emp_id          integer not null,
  emp_name        text not null,
  location        text,
  team            text,
  emp_email       text not null default '',
  manager_id      bigint references public.fc_managers(id),
  truck_types     text[] not null default '{}',
  training_date   date,
  served          jsonb not null,               -- [{id, options[]}] exactly as shown
  answers         jsonb,                        -- [{id, answer, correct:bool}]
  correct_count   integer,
  total           integer,
  score_pct       numeric,
  pass_pct        numeric not null,
  status          text not null default 'in_progress'
                  check (status in ('in_progress','failed','awaiting_practical','certified','practical_failed','abandoned')),
  started_at      timestamptz not null default now(),
  submitted_at    timestamptz,
  practical_at    timestamptz,
  evaluator_name  text,
  practical_notes text,
  checklist       jsonb,
  mail_token      text,
  mail_token_at   timestamptz,
  emailed_at      timestamptz
);
create index if not exists fc_attempts_emp_idx on public.fc_attempts (emp_id, started_at desc);
create index if not exists fc_attempts_status_idx on public.fc_attempts (status);

create sequence if not exists public.fc_cert_seq;

create table if not exists public.fc_certs (
  id              bigint generated always as identity primary key,
  cert_no         text not null unique,
  attempt_id      uuid not null references public.fc_attempts(id),
  emp_id          integer not null,
  emp_name        text not null,
  location        text,
  team            text,
  emp_email       text not null default '',
  manager_id      bigint references public.fc_managers(id),
  truck_types     text[] not null,
  training_date   date,
  written_score   numeric not null,
  written_date    date not null,
  practical_date  date not null,
  evaluator_name  text not null,
  issued_on       date not null,
  expires_on      date not null,
  status          text not null default 'active' check (status in ('active','revoked','superseded')),
  revoked_reason  text,
  revoked_at      timestamptz,
  mail_token      text,
  mail_token_at   timestamptz,
  emailed_at      timestamptz,
  reminded_60_at  timestamptz,
  reminded_30_at  timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists fc_certs_emp_idx on public.fc_certs (emp_id, issued_on desc);

-- Locked down: no direct API access to any table. Everything goes through
-- the functions below.
alter table public.fc_settings  enable row level security;
alter table public.fc_managers  enable row level security;
alter table public.fc_questions enable row level security;
alter table public.fc_attempts  enable row level security;
alter table public.fc_certs     enable row level security;
revoke all on public.fc_settings, public.fc_managers, public.fc_questions,
              public.fc_attempts, public.fc_certs from anon, authenticated;
revoke all on sequence public.fc_cert_seq from anon, authenticated;

-- ---------- Question seed (from forklift_test.xlsx) ----------
insert into public.fc_questions (q_code, question, correct, options, sort_order) values
  ('Q1', 'The one thing that should always be done every time when operating a forklift?', 'Wearing a seatbelt', array['Always driving backwards with or without a load', 'Checking tire pressure', 'Wearing a seatbelt', 'Talking on a cellphone']::text[], 1),
  ('Q2', 'How often should operators inspect their forklifts before operation, at a minimum?', 'Each Shift', array['Each Shift', 'Hourly', 'Weekly', 'Monthly']::text[], 2),
  ('Q3', 'When mounting and dismounting a forklift, always face', 'Toward the forklift', array['Away from the forklift.', 'Do whatever is most comfortable.', 'Toward the forklift', 'Just jump on or off at will.']::text[], 3),
  ('Q4', 'When operating a forklift the operator must always look', 'In the direction of travel.', array['In the mirrors', 'Towards the break room or area.', 'Forward', 'In the direction of travel.']::text[], 4),
  ('Q5', 'What should you do when approaching an intersection or cross aisle?', 'Slow down and sound horn', array['Check for hazards by leaning out of the lift chassis', 'Turn as quickly as possible', 'Go through it as quickly as possible.', 'Slow down and sound horn']::text[], 5),
  ('Q6', 'To lift people using a forklift, the operator must', 'None of the above', array['Move a truck near a wall or pole to help with a fall', 'Use a pallet', 'Lift people with just bare forks', 'None of the above']::text[], 6),
  ('Q7', 'In all situations who has the right of way', 'Pedestrians', array['The larger forklift', 'Forklift approaching from the right', 'Forklift with the senior lift operator', 'Pedestrians']::text[], 7),
  ('Q8', 'How high should a load be transported on a smooth surface?', '2 to 3 inches off the surface', array['2 to 3 inches off the surface', 'Low enough to see over the load', 'Raised above operator line of sight', '6 to 7 inches from surface']::text[], 8),
  ('Q9', 'When traveling down an incline or ramp direction of travel is always', 'Back down when loaded', array['Use your own judgement', 'Back down when loaded', 'Always back down', 'Either way it doesn''t matter']::text[], 9),
  ('Q10', 'When is it safe to travel with a load at its maximum height', 'Never', array['Never', 'When it improves your vision', 'Always because it''s quicker', 'Whenever there is sufficient height']::text[], 10),
  ('Q11', 'Before driving into a trailer, what must be done?', 'Check that the wheels are chocked or trailer secured to building', array['Talk to driver and see how their day is going', 'Turn on forklift lights', 'Check that the wheels are chocked or trailer secured to building', 'Check your forklift for fuel or charge']::text[], 11),
  ('Q12', 'The forklift horn should be used to', 'Warn pedestrians and other traffic at intersections and blind spots', array['Make others get out of your path so they don''t slow you down', 'Warn pedestrians and other traffic at intersections and blind spots', 'Let your supervisor know you are busy', 'To say hi to a co-worker across the way']::text[], 12),
  ('Q13', 'Which is NOT allowed during refueling or charging your forklift', 'Smoking or open flame', array['Wearing proper PPE', 'Staying alert and attentive to the process', 'Smoking or open flame', 'Ensuring you are not blocking access to emergency equipment']::text[], 13),
  ('Q14', 'When should the load capacity of a forklift ever be exceeded', 'Not at any time', array['When supervisor says so', 'Not at any time', 'Only if lifting less than 2 inches off surface', 'When you can''t read the nameplate']::text[], 14),
  ('Q15', 'When is it safe to allow another person to ride on the lift with you?', 'Never', array['Never', 'If they don''t feel like walking', 'If you are only going a few feet', 'To help you see around your load']::text[], 15),
  ('Q16', 'What distance should there be between moving forklifts?', 'A safe braking distance', array['Close enough to communicate with other operator', 'As far as two aisles away', 'A safe braking distance', 'Whatever distance as long a supervisor not around']::text[], 16),
  ('Q17', 'When parking or leaving your forklift, you should', 'Park or leave forklift in designated area or away from traffic', array['Next to the break room so you don''t walk as far', 'In a drive aisle or walkway', 'Park or leave forklift in designated area or away from traffic', 'Blocking fire or emergency exits']::text[], 17)
on conflict (q_code) do nothing;


-- ============================================================
-- Helpers (not callable from the app)
-- ============================================================
create or replace function public.fc_token()
returns text language sql volatile as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;
revoke all on function public.fc_token() from public, anon, authenticated;

create or replace function public.fc_today()
returns date language sql stable as $$
  select (now() at time zone 'America/Chicago')::date;
$$;

-- active | expiring (≤60 days) | expired | revoked | superseded
create or replace function public.fc_cert_state(p_status text, p_expires date)
returns text language sql stable as $$
  select case
    when p_status <> 'active' then p_status
    when p_expires < fc_today() then 'expired'
    when p_expires <= fc_today() + 60 then 'expiring'
    else 'active' end;
$$;

create or replace function public.fc_cert_json(c public.fc_certs)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', c.id, 'cert_no', c.cert_no, 'attempt_id', c.attempt_id,
    'emp_id', c.emp_id, 'name', c.emp_name, 'location', c.location, 'team', c.team,
    'emp_email', c.emp_email, 'manager_id', c.manager_id,
    'manager', (select m.name from fc_managers m where m.id = c.manager_id),
    'truck_types', c.truck_types, 'training_date', c.training_date,
    'written_score', c.written_score, 'written_date', c.written_date,
    'practical_date', c.practical_date, 'evaluator', c.evaluator_name,
    'issued_on', c.issued_on, 'expires_on', c.expires_on,
    'status', c.status, 'state', fc_cert_state(c.status, c.expires_on),
    'days_left', c.expires_on - fc_today(),
    'revoked_reason', c.revoked_reason, 'emailed_at', c.emailed_at);
$$;
revoke all on function public.fc_cert_json(public.fc_certs) from public, anon, authenticated;

-- Employee + manager + HR, de-duplicated, blanks dropped.
create or replace function public.fc_recipients(p_emp_email text, p_manager_id bigint)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct lower(e)), '{}') from (
    select trim(p_emp_email) as e
    union all select trim(m.email) from fc_managers m where m.id = p_manager_id
    union all select trim(x) from fc_settings s, unnest(string_to_array(s.hr_emails, ',')) x where s.id = 1
  ) t where e ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
$$;
revoke all on function public.fc_recipients(text, bigint) from public, anon, authenticated;


-- ============================================================
-- Employee side (no passcode)
-- ============================================================

-- Who is this, do they already hold a cert, are they waiting on a driving
-- evaluation, and the manager list for the "Your manager" dropdown
-- (names only — manager emails never leave the database here).
create or replace function public.fc_lookup_employee(p_emp_id integer)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_emp  emp_employees%rowtype;
  v_cert fc_certs%rowtype;
  v_pend fc_attempts%rowtype;
  v_set  fc_settings%rowtype;
begin
  select * into v_set from fc_settings where id = 1;
  select * into v_emp from emp_employees where emp_id = p_emp_id order by updated_at desc nulls last limit 1;
  if not found then return json_build_object('found', false); end if;

  select * into v_cert from fc_certs where emp_id = p_emp_id and status = 'active'
    order by issued_on desc, id desc limit 1;
  select * into v_pend from fc_attempts where emp_id = p_emp_id and status = 'awaiting_practical'
    order by submitted_at desc limit 1;

  return json_build_object(
    'found', true,
    'emp', json_build_object('id', v_emp.emp_id, 'name', coalesce(v_emp.full_name, v_emp.first_name),
                             'location', v_emp.location, 'team', v_emp.team,
                             'active', coalesce(v_emp.is_active, true)),
    'cert', case when v_cert.id is null then null
                  else (fc_cert_json(v_cert)::jsonb - 'emp_email' - 'manager_id' - 'attempt_id' - 'emailed_at') end,
    'pending', case when v_pend.id is null then null else json_build_object(
                 'attempt_id', v_pend.id, 'score_pct', v_pend.score_pct, 'submitted_at', v_pend.submitted_at) end,
    'managers', (select coalesce(json_agg(json_build_object('id', id, 'name', name, 'location', location)
                   order by name), '[]'::json) from fc_managers where is_active),
    'questions_per_test', v_set.questions_per_test,
    'pass_pct', v_set.pass_pct);
end;
$$;

create or replace function public.fc_start_test(
  p_emp_id        integer,
  p_email         text,
  p_manager_id    bigint,
  p_truck_types   text[],
  p_training_date date
)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  v_emp   emp_employees%rowtype;
  v_set   fc_settings%rowtype;
  v_fails integer;
  v_first timestamptz;
  v_served jsonb;
  v_qs    json;
  v_id    uuid;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  select * into v_set from fc_settings where id = 1;
  select * into v_emp from emp_employees where emp_id = p_emp_id order by updated_at desc nulls last limit 1;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if v_emp.is_active = false then return json_build_object('ok', false, 'error', 'inactive'); end if;
  if p_manager_id is null or not exists (select 1 from fc_managers where id = p_manager_id and is_active) then
    return json_build_object('ok', false, 'error', 'need_manager');
  end if;
  if coalesce(cardinality(p_truck_types), 0) = 0 then
    return json_build_object('ok', false, 'error', 'need_truck');
  end if;
  if v_email <> '' and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return json_build_object('ok', false, 'error', 'bad_email');
  end if;

  -- Retake limit: N failed written tests in the last 24 hours.
  select count(*), min(submitted_at) into v_fails, v_first
    from fc_attempts where emp_id = p_emp_id and status = 'failed' and submitted_at > now() - interval '24 hours';
  if v_fails >= v_set.max_fails_per_day then
    return json_build_object('ok', false, 'error', 'too_many_attempts',
                             'retry_at', v_first + interval '24 hours');
  end if;

  if (select count(*) from fc_questions where is_active) < v_set.questions_per_test then
    return json_build_object('ok', false, 'error', 'not_enough_questions');
  end if;

  -- Any test left open on another phone is closed out.
  update fc_attempts set status = 'abandoned' where emp_id = p_emp_id and status = 'in_progress';

  -- Random questions, answer choices shuffled — "None/All of the above" stays last.
  with picked as (
    select q.id, q.question, row_number() over () as n,
           (select array_agg(o order by (o ~* '^(none|all) of the above'), random()) from unnest(q.options) o) as opts
    from (select * from fc_questions where is_active order by random() limit v_set.questions_per_test) q
  )
  select jsonb_agg(jsonb_build_object('id', id, 'options', to_jsonb(opts)) order by n),
         json_agg(json_build_object('id', id, 'question', question, 'options', opts) order by n)
    into v_served, v_qs from picked;

  insert into fc_attempts (emp_id, emp_name, location, team, emp_email, manager_id, truck_types,
                           training_date, served, pass_pct)
  values (p_emp_id, coalesce(v_emp.full_name, v_emp.first_name), v_emp.location, v_emp.team, v_email,
          p_manager_id, p_truck_types, coalesce(p_training_date, fc_today()), v_served, v_set.pass_pct)
  returning id into v_id;

  return json_build_object('ok', true, 'attempt_id', v_id, 'questions', v_qs,
                           'total', jsonb_array_length(v_served), 'pass_pct', v_set.pass_pct);
end;
$$;

-- p_answers: {"<question id>": "<answer text>", ...}
create or replace function public.fc_submit_test(p_attempt_id uuid, p_answers jsonb)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  v_a       fc_attempts%rowtype;
  v_graded  jsonb;
  v_correct integer;
  v_total   integer;
  v_pct     numeric;
  v_pass    boolean;
  v_missed  json;
  v_token   text := fc_token();
begin
  select * into v_a from fc_attempts where id = p_attempt_id for update;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if v_a.status <> 'in_progress' then return json_build_object('ok', false, 'error', 'already_submitted'); end if;
  if v_a.started_at < now() - interval '3 hours' then
    update fc_attempts set status = 'abandoned' where id = v_a.id;
    return json_build_object('ok', false, 'error', 'expired');
  end if;

  select jsonb_agg(jsonb_build_object(
           'id', q.id,
           'answer', p_answers ->> (s ->> 'id'),
           'correct', lower(trim(coalesce(p_answers ->> (s ->> 'id'), ''))) = lower(trim(q.correct)))
         order by s.ord)
    into v_graded
  from jsonb_array_elements(v_a.served) with ordinality s(s, ord)
  join fc_questions q on q.id = (s ->> 'id')::bigint;

  select count(*) filter (where (g ->> 'correct')::boolean), count(*)
    into v_correct, v_total from jsonb_array_elements(v_graded) g;
  v_pct  := round(v_correct * 100.0 / greatest(v_total, 1), 1);
  v_pass := v_pct >= v_a.pass_pct;

  -- Missed questions are shown without the right answer.
  select coalesce(json_agg(q.question order by g.ord), '[]'::json) into v_missed
  from jsonb_array_elements(v_graded) with ordinality g(g, ord)
  join fc_questions q on q.id = (g ->> 'id')::bigint
  where not (g ->> 'correct')::boolean;

  update fc_attempts set
    answers = v_graded, correct_count = v_correct, total = v_total, score_pct = v_pct,
    status = case when v_pass then 'awaiting_practical' else 'failed' end,
    submitted_at = now(), mail_token = v_token, mail_token_at = now()
  where id = v_a.id;

  return json_build_object('ok', true, 'attempt_id', v_a.id, 'passed', v_pass,
    'correct', v_correct, 'total', v_total, 'score_pct', v_pct, 'pass_pct', v_a.pass_pct,
    'missed', v_missed, 'mail_token', v_token,
    'mailer_url', (select mailer_url from fc_settings where id = 1));
end;
$$;

-- Public check for the QR code on certificates and wallet cards.
create or replace function public.fc_verify(p_cert_no text)
returns json language sql stable security definer set search_path = public as $$
  select coalesce((
    select json_build_object('found', true, 'cert_no', c.cert_no, 'name', c.emp_name,
      'location', c.location, 'truck_types', c.truck_types, 'issued_on', c.issued_on,
      'expires_on', c.expires_on, 'evaluator', c.evaluator_name,
      'state', fc_cert_state(c.status, c.expires_on))
    from fc_certs c where upper(c.cert_no) = upper(trim(p_cert_no))
  ), json_build_object('found', false));
$$;


-- ============================================================
-- Manager side (shared manager passcode — same as Missed Punches)
-- ============================================================
create or replace function public.fc_mgr_dashboard(p_passcode text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare v_err text;
begin
  v_err := toolkit_manager_check(p_passcode);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;

  return json_build_object('ok', true,
    'today', fc_today(),
    'settings', (select json_build_object('questions_per_test', questions_per_test, 'pass_pct', pass_pct,
                   'cert_years', cert_years, 'max_fails_per_day', max_fails_per_day,
                   'hr_emails', hr_emails, 'mailer_url', mailer_url,
                   'mailer_key_set', mailer_key_hash is not null)
                 from fc_settings where id = 1),
    'managers', (select coalesce(json_agg(json_build_object('id', id, 'name', name, 'email', email,
                   'location', location, 'is_active', is_active) order by is_active desc, name), '[]'::json)
                 from fc_managers),
    'questions', (select coalesce(json_agg(json_build_object('id', id, 'q_code', q_code, 'question', question,
                   'correct', correct, 'options', options, 'is_active', is_active, 'sort_order', sort_order)
                   order by sort_order, id), '[]'::json) from fc_questions),
    'pending', (select coalesce(json_agg(json_build_object('attempt_id', a.id, 'emp_id', a.emp_id,
                   'name', a.emp_name, 'location', a.location, 'team', a.team, 'emp_email', a.emp_email,
                   'manager_id', a.manager_id, 'manager', m.name, 'truck_types', a.truck_types,
                   'training_date', a.training_date, 'score_pct', a.score_pct,
                   'correct', a.correct_count, 'total', a.total, 'submitted_at', a.submitted_at)
                   order by a.submitted_at), '[]'::json)
                from fc_attempts a left join fc_managers m on m.id = a.manager_id
                where a.status = 'awaiting_practical'),
    'certs', (select coalesce(json_agg(fc_cert_json(c) order by c.emp_name, c.issued_on desc), '[]'::json)
              from fc_certs c),
    'attempts', (select coalesce(json_agg(json_build_object('attempt_id', a.id, 'emp_id', a.emp_id,
                   'name', a.emp_name, 'location', a.location, 'manager', m.name,
                   'truck_types', a.truck_types, 'status', a.status, 'score_pct', a.score_pct,
                   'correct', a.correct_count, 'total', a.total, 'started_at', a.started_at,
                   'submitted_at', a.submitted_at, 'practical_at', a.practical_at,
                   'evaluator', a.evaluator_name, 'notes', a.practical_notes)
                   order by a.started_at desc), '[]'::json)
                 from (select * from fc_attempts where status <> 'in_progress'
                       order by started_at desc limit 500) a
                 left join fc_managers m on m.id = a.manager_id));
end;
$$;

-- Driving evaluation sign-off. Pass → certificate issued.
create or replace function public.fc_mgr_practical(
  p_passcode     text,
  p_attempt_id   uuid,
  p_passed       boolean,
  p_evaluator    text,
  p_eval_date    date,
  p_truck_types  text[],
  p_checklist    jsonb,
  p_notes        text
)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  v_err   text;
  v_a     fc_attempts%rowtype;
  v_set   fc_settings%rowtype;
  v_cert  fc_certs%rowtype;
  v_date  date := coalesce(p_eval_date, fc_today());
  v_token text := fc_token();
begin
  v_err := toolkit_manager_check(p_passcode);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  if coalesce(trim(p_evaluator), '') = '' then return json_build_object('ok', false, 'error', 'need_evaluator'); end if;

  select * into v_a from fc_attempts where id = p_attempt_id for update;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if v_a.status <> 'awaiting_practical' then return json_build_object('ok', false, 'error', 'not_pending'); end if;
  if v_date > fc_today() or v_date < v_a.submitted_at::date - 30 then
    return json_build_object('ok', false, 'error', 'bad_date');
  end if;

  update fc_attempts set
    status = case when p_passed then 'certified' else 'practical_failed' end,
    practical_at = now(), evaluator_name = trim(p_evaluator), checklist = p_checklist,
    practical_notes = nullif(trim(coalesce(p_notes, '')), ''),
    truck_types = case when coalesce(cardinality(p_truck_types), 0) > 0 then p_truck_types else truck_types end
  where id = v_a.id
  returning * into v_a;

  if not p_passed then return json_build_object('ok', true, 'passed', false); end if;

  select * into v_set from fc_settings where id = 1;
  update fc_certs set status = 'superseded' where emp_id = v_a.emp_id and status = 'active';

  insert into fc_certs (cert_no, attempt_id, emp_id, emp_name, location, team, emp_email, manager_id,
                        truck_types, training_date, written_score, written_date, practical_date,
                        evaluator_name, issued_on, expires_on, mail_token, mail_token_at)
  values ('LWH-FL-' || to_char(v_date, 'YYYY') || '-' || lpad(nextval('fc_cert_seq')::text, 4, '0'),
          v_a.id, v_a.emp_id, v_a.emp_name, v_a.location, v_a.team, v_a.emp_email, v_a.manager_id,
          v_a.truck_types, v_a.training_date, v_a.score_pct, v_a.submitted_at::date, v_date,
          v_a.evaluator_name, v_date, (v_date + make_interval(years => v_set.cert_years))::date,
          v_token, now())
  returning * into v_cert;

  return json_build_object('ok', true, 'passed', true, 'cert', fc_cert_json(v_cert),
                           'mail_token', v_token, 'mailer_url', v_set.mailer_url);
end;
$$;

create or replace function public.fc_mgr_revoke(p_passcode text, p_cert_id bigint, p_reason text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare v_err text;
begin
  v_err := toolkit_manager_check(p_passcode);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  if coalesce(trim(p_reason), '') = '' then return json_build_object('ok', false, 'error', 'need_reason'); end if;
  update fc_certs set status = 'revoked', revoked_reason = trim(p_reason), revoked_at = now()
   where id = p_cert_id and status = 'active';
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  return json_build_object('ok', true);
end;
$$;

-- New one-time email token, for "Email again".
-- p_kind: 'cert' (p_id = cert id) | 'result' (p_id = attempt id)
create or replace function public.fc_mgr_mail_token(p_passcode text, p_kind text, p_id text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare v_err text; v_token text := fc_token();
begin
  v_err := toolkit_manager_check(p_passcode);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  if p_kind = 'cert' then
    update fc_certs set mail_token = v_token, mail_token_at = now() where id = p_id::bigint;
  elsif p_kind = 'result' then
    update fc_attempts set mail_token = v_token, mail_token_at = now()
     where id = p_id::uuid and status not in ('in_progress', 'abandoned');
  else
    return json_build_object('ok', false, 'error', 'bad_kind');
  end if;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  return json_build_object('ok', true, 'mail_token', v_token,
                           'mailer_url', (select mailer_url from fc_settings where id = 1));
end;
$$;

create or replace function public.fc_mgr_save_settings(p_passcode text, p_settings jsonb)
returns json language plpgsql volatile security definer set search_path = public as $$
declare v_err text;
begin
  v_err := toolkit_manager_check(p_passcode);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  update fc_settings set
    questions_per_test = coalesce((p_settings ->> 'questions_per_test')::int, questions_per_test),
    pass_pct           = coalesce((p_settings ->> 'pass_pct')::numeric, pass_pct),
    cert_years         = coalesce((p_settings ->> 'cert_years')::int, cert_years),
    max_fails_per_day  = coalesce((p_settings ->> 'max_fails_per_day')::int, max_fails_per_day),
    hr_emails          = coalesce(p_settings ->> 'hr_emails', hr_emails),
    mailer_url         = coalesce(trim(p_settings ->> 'mailer_url'), mailer_url),
    updated_at         = now()
  where id = 1;
  return json_build_object('ok', true);
exception when check_violation or invalid_text_representation then
  return json_build_object('ok', false, 'error', 'bad_value');
end;
$$;

create or replace function public.fc_mgr_save_manager(p_passcode text, p_manager jsonb)
returns json language plpgsql volatile security definer set search_path = public as $$
declare v_err text; v_id bigint := nullif(p_manager ->> 'id', '')::bigint;
begin
  v_err := toolkit_manager_check(p_passcode);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  if coalesce(trim(p_manager ->> 'name'), '') = '' then return json_build_object('ok', false, 'error', 'need_name'); end if;
  if v_id is null then
    insert into fc_managers (name, email, location, is_active)
    values (trim(p_manager ->> 'name'), lower(trim(coalesce(p_manager ->> 'email', ''))),
            trim(coalesce(p_manager ->> 'location', '')), coalesce((p_manager ->> 'is_active')::boolean, true))
    returning id into v_id;
  else
    update fc_managers set name = trim(p_manager ->> 'name'),
      email = lower(trim(coalesce(p_manager ->> 'email', ''))),
      location = trim(coalesce(p_manager ->> 'location', '')),
      is_active = coalesce((p_manager ->> 'is_active')::boolean, true)
    where id = v_id;
  end if;
  return json_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.fc_mgr_save_question(p_passcode text, p_q jsonb)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  v_err  text;
  v_id   bigint := nullif(p_q ->> 'id', '')::bigint;
  v_opts text[];
begin
  v_err := toolkit_manager_check(p_passcode);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  select array_agg(trim(o)) into v_opts
    from jsonb_array_elements_text(p_q -> 'options') o where trim(o) <> '';
  if coalesce(trim(p_q ->> 'question'), '') = '' or coalesce(cardinality(v_opts), 0) < 2
     or not (trim(p_q ->> 'correct') = any(v_opts)) then
    return json_build_object('ok', false, 'error', 'bad_question');
  end if;
  if v_id is null then
    insert into fc_questions (q_code, question, correct, options, sort_order, is_active)
    values ('Q' || (select coalesce(max(id), 0) + 1 from fc_questions) || '-' || substr(fc_token(), 1, 4),
            trim(p_q ->> 'question'), trim(p_q ->> 'correct'), v_opts,
            (select coalesce(max(sort_order), 0) + 1 from fc_questions),
            coalesce((p_q ->> 'is_active')::boolean, true))
    returning id into v_id;
  else
    update fc_questions set question = trim(p_q ->> 'question'), correct = trim(p_q ->> 'correct'),
      options = v_opts, is_active = coalesce((p_q ->> 'is_active')::boolean, true), updated_at = now()
    where id = v_id;
  end if;
  return json_build_object('ok', true, 'id', v_id);
end;
$$;


-- ============================================================
-- Mailer (called by the Google Apps Script in gas/)
-- ============================================================

-- One-time: the app gets a token when a test is submitted / a cert is
-- issued (or a manager clicks "Email again"). The script trades it for the
-- recipients and the details. Tokens are good for 1 day and work once.
create or replace function public.fc_mail_payload(p_kind text, p_id text, p_token text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare v_a fc_attempts%rowtype; v_c fc_certs%rowtype;
begin
  if coalesce(p_token, '') = '' then return json_build_object('ok', false, 'error', 'bad_token'); end if;

  if p_kind = 'cert' then
    select * into v_c from fc_certs where id = p_id::bigint and mail_token = p_token
       and mail_token_at > now() - interval '1 day' for update;
    if not found then return json_build_object('ok', false, 'error', 'bad_token'); end if;
    update fc_certs set mail_token = null, emailed_at = now() where id = v_c.id;
    return json_build_object('ok', true, 'kind', 'cert',
      'to', fc_recipients(v_c.emp_email, v_c.manager_id), 'cert', fc_cert_json(v_c));

  elsif p_kind = 'result' then
    select * into v_a from fc_attempts where id = p_id::uuid and mail_token = p_token
       and mail_token_at > now() - interval '1 day' for update;
    if not found then return json_build_object('ok', false, 'error', 'bad_token'); end if;
    update fc_attempts set mail_token = null, emailed_at = now() where id = v_a.id;
    return json_build_object('ok', true, 'kind', 'result',
      'to', fc_recipients(v_a.emp_email, v_a.manager_id),
      'result', json_build_object('emp_id', v_a.emp_id, 'name', v_a.emp_name, 'location', v_a.location,
        'manager', (select name from fc_managers where id = v_a.manager_id),
        'truck_types', v_a.truck_types, 'score_pct', v_a.score_pct, 'pass_pct', v_a.pass_pct,
        'correct', v_a.correct_count, 'total', v_a.total, 'submitted_at', v_a.submitted_at,
        'passed', v_a.status in ('awaiting_practical', 'certified', 'practical_failed')));
  end if;
  return json_build_object('ok', false, 'error', 'bad_kind');
end;
$$;

-- Daily reminder run: certs reaching 60 and 30 days from expiring.
-- Needs the mailer key (set at the bottom of this file).
create or replace function public.fc_mail_expiring(p_key text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare v_hash text; v_items json;
begin
  select mailer_key_hash into v_hash from fc_settings where id = 1;
  if v_hash is null or encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex') <> v_hash then
    return json_build_object('ok', false, 'error', 'bad_key');
  end if;

  with due as (
    select c.*, case when c.expires_on - fc_today() <= 30 then 30 else 60 end as win
    from fc_certs c
    where c.status = 'active' and c.expires_on >= fc_today()
      and ((c.expires_on - fc_today() <= 30 and c.reminded_30_at is null)
        or (c.expires_on - fc_today() <= 60 and c.reminded_60_at is null))
  ), marked as (
    update fc_certs c set
      reminded_60_at = coalesce(c.reminded_60_at, now()),
      reminded_30_at = case when d.win = 30 then now() else c.reminded_30_at end
    from due d where c.id = d.id
    returning c.*, d.win
  )
  select coalesce(json_agg(json_build_object('window', m.win,
           'to', fc_recipients(m.emp_email, m.manager_id),
           'cert', json_build_object('cert_no', m.cert_no, 'name', m.emp_name, 'emp_id', m.emp_id,
             'location', m.location, 'truck_types', m.truck_types, 'expires_on', m.expires_on,
             'days_left', m.expires_on - fc_today()))), '[]'::json)
    into v_items from marked m;

  return json_build_object('ok', true, 'items', v_items);
end;
$$;


-- ---------- Who can call what ----------
-- Every function checks its own passcode / token / key; the tables stay closed.
revoke all on function
  public.fc_lookup_employee(integer),
  public.fc_start_test(integer, text, bigint, text[], date),
  public.fc_submit_test(uuid, jsonb),
  public.fc_verify(text),
  public.fc_mgr_dashboard(text),
  public.fc_mgr_practical(text, uuid, boolean, text, date, text[], jsonb, text),
  public.fc_mgr_revoke(text, bigint, text),
  public.fc_mgr_mail_token(text, text, text),
  public.fc_mgr_save_settings(text, jsonb),
  public.fc_mgr_save_manager(text, jsonb),
  public.fc_mgr_save_question(text, jsonb),
  public.fc_mail_payload(text, text, text),
  public.fc_mail_expiring(text)
from public;
grant execute on function
  public.fc_lookup_employee(integer),
  public.fc_start_test(integer, text, bigint, text[], date),
  public.fc_submit_test(uuid, jsonb),
  public.fc_verify(text),
  public.fc_mgr_dashboard(text),
  public.fc_mgr_practical(text, uuid, boolean, text, date, text[], jsonb, text),
  public.fc_mgr_revoke(text, bigint, text),
  public.fc_mgr_mail_token(text, text, text),
  public.fc_mgr_save_settings(text, jsonb),
  public.fc_mgr_save_manager(text, jsonb),
  public.fc_mgr_save_question(text, jsonb),
  public.fc_mail_payload(text, text, text),
  public.fc_mail_expiring(text)
to anon, authenticated;


-- ============================================================
-- MAILER KEY — for the daily expiration reminders.
-- Make up a long random key, put it in the Apps Script's Script
-- Properties as FC_MAILER_KEY, and run this line in the SQL Editor
-- with the same key (do NOT save the real key in this file):
--
--   update public.fc_settings set mailer_key_hash =
--     encode(sha256(convert_to('YOUR-LONG-RANDOM-KEY', 'UTF8')), 'hex') where id = 1;
-- ============================================================


-- ============================================================
-- v1.76.1 — Imported (pre-app) certifications + editing a cert
--   * Certs made before this app have no written test record, may not
--     have an employee ID yet, and may not list equipment. Those columns
--     are now optional and the row is marked source = 'import'.
--   * fc_mgr_update_cert(): managers set equipment / link an employee ID.
-- ============================================================
alter table public.fc_certs alter column attempt_id    drop not null;
alter table public.fc_certs alter column emp_id        drop not null;
alter table public.fc_certs alter column written_score drop not null;
alter table public.fc_certs alter column written_date  drop not null;
alter table public.fc_certs add column if not exists source    text not null default 'app';
alter table public.fc_certs add column if not exists import_note text;
do $$ begin
  alter table public.fc_certs add constraint fc_certs_source_chk check (source in ('app','import'));
exception when duplicate_object then null; end $$;

create or replace function public.fc_cert_json(c public.fc_certs)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', c.id, 'cert_no', c.cert_no, 'attempt_id', c.attempt_id,
    'emp_id', c.emp_id, 'name', c.emp_name, 'location', c.location, 'team', c.team,
    'emp_email', c.emp_email, 'manager_id', c.manager_id,
    'manager', (select m.name from fc_managers m where m.id = c.manager_id),
    'truck_types', c.truck_types, 'training_date', c.training_date,
    'written_score', c.written_score, 'written_date', c.written_date,
    'practical_date', c.practical_date, 'evaluator', c.evaluator_name,
    'issued_on', c.issued_on, 'expires_on', c.expires_on,
    'status', c.status, 'state', fc_cert_state(c.status, c.expires_on),
    'days_left', c.expires_on - fc_today(),
    'source', c.source, 'import_note', c.import_note,
    'revoked_reason', c.revoked_reason, 'emailed_at', c.emailed_at);
$$;
revoke all on function public.fc_cert_json(public.fc_certs) from public, anon, authenticated;

-- Set equipment, link / change the employee ID (pulls name, location and
-- team from the timeclock), or set the employee's email on a cert.
-- p_changes: {"truck_types": [...], "emp_id": 12345 | null, "emp_email": "..."}
create or replace function public.fc_mgr_update_cert(p_passcode text, p_cert_id bigint, p_changes jsonb)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  v_err text;
  v_c   fc_certs%rowtype;
  v_emp emp_employees%rowtype;
  v_new integer;
  v_trucks text[];
  v_email text;
begin
  v_err := toolkit_manager_check(p_passcode);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  select * into v_c from fc_certs where id = p_cert_id for update;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;

  if p_changes ? 'truck_types' then
    select coalesce(array_agg(trim(t)), '{}') into v_trucks
      from jsonb_array_elements_text(p_changes -> 'truck_types') t where trim(t) <> '';
    update fc_certs set truck_types = v_trucks where id = v_c.id;
  end if;

  if p_changes ? 'emp_email' then
    v_email := lower(trim(coalesce(p_changes ->> 'emp_email', '')));
    if v_email <> '' and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      return json_build_object('ok', false, 'error', 'bad_email');
    end if;
    update fc_certs set emp_email = v_email where id = v_c.id;
  end if;

  if p_changes ? 'emp_id' then
    v_new := nullif(p_changes ->> 'emp_id', '')::integer;
    if v_new is not null and v_new is distinct from v_c.emp_id then
      select * into v_emp from emp_employees where emp_id = v_new order by updated_at desc nulls last limit 1;
      if not found then return json_build_object('ok', false, 'error', 'emp_not_found'); end if;
      -- Linking an ID: this becomes that employee's current cert only if it's
      -- the newest one; otherwise it's kept as history.
      if v_c.status = 'active' and exists (select 1 from fc_certs where emp_id = v_new and status = 'active'
                                             and id <> v_c.id and issued_on > v_c.issued_on) then
        update fc_certs set status = 'superseded' where id = v_c.id;
      elsif v_c.status = 'active' then
        update fc_certs set status = 'superseded' where emp_id = v_new and status = 'active' and id <> v_c.id;
      end if;
      update fc_certs set emp_id = v_new, emp_name = coalesce(v_emp.full_name, v_emp.first_name),
        location = v_emp.location, team = v_emp.team where id = v_c.id;
    elsif v_new is null and coalesce(p_changes ->> 'emp_id', '') = '' and v_c.source = 'import' then
      update fc_certs set emp_id = null where id = v_c.id;
    end if;
  end if;

  select * into v_c from fc_certs where id = p_cert_id;
  return json_build_object('ok', true, 'cert', fc_cert_json(v_c));
exception when invalid_text_representation then
  return json_build_object('ok', false, 'error', 'bad_value');
end;
$$;
revoke all on function public.fc_mgr_update_cert(text, bigint, jsonb) from public;
grant execute on function public.fc_mgr_update_cert(text, bigint, jsonb) to anon, authenticated;


-- ============================================================
-- v1.77.0 — Classroom training in the app
--   * fc_training: one row per training session (start → finish).
--   * The written test needs classroom training finished within the last
--     90 days (setting: require_training). The training date on the
--     attempt / certificate comes from this record.
--   * Finishing is checked here: at least training_min_minutes must pass
--     between start and finish, and every module must be marked done.
-- ============================================================
alter table public.fc_settings add column if not exists require_training     boolean not null default true;
alter table public.fc_settings add column if not exists training_min_minutes integer not null default 20;
do $$ begin
  alter table public.fc_settings add constraint fc_settings_trainmin_chk check (training_min_minutes between 0 and 120);
exception when duplicate_object then null; end $$;

create table if not exists public.fc_training (
  id            uuid primary key default gen_random_uuid(),
  emp_id        integer not null,
  emp_name      text not null,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  modules       jsonb not null default '{}'::jsonb,   -- {"module_id": "timestamp done"}
  module_count  integer not null default 0,           -- how many modules the app had
  version       text
);
create index if not exists fc_training_emp_idx on public.fc_training (emp_id, completed_at desc);
alter table public.fc_training enable row level security;
revoke all on public.fc_training from anon, authenticated;

-- Latest finished training within 90 days (null if none).
create or replace function public.fc_training_current(p_emp_id integer)
returns public.fc_training language sql stable security definer set search_path = public as $$
  select * from fc_training where emp_id = p_emp_id and completed_at is not null
     and completed_at > now() - interval '90 days' order by completed_at desc limit 1;
$$;
revoke all on function public.fc_training_current(integer) from public, anon, authenticated;

-- Start (or resume, within 24 hours) a training session.
create or replace function public.fc_training_start(p_emp_id integer, p_module_count integer, p_version text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare v_emp emp_employees%rowtype; v_t fc_training%rowtype;
begin
  select * into v_emp from emp_employees where emp_id = p_emp_id order by updated_at desc nulls last limit 1;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if v_emp.is_active = false then return json_build_object('ok', false, 'error', 'inactive'); end if;
  select * into v_t from fc_training where emp_id = p_emp_id and completed_at is null
     and started_at > now() - interval '24 hours' order by started_at desc limit 1;
  if not found then
    insert into fc_training (emp_id, emp_name, module_count, version)
    values (p_emp_id, coalesce(v_emp.full_name, v_emp.first_name), greatest(coalesce(p_module_count, 0), 1), p_version)
    returning * into v_t;
  end if;
  return json_build_object('ok', true, 'training_id', v_t.id, 'modules', v_t.modules,
    'min_minutes', (select training_min_minutes from fc_settings where id = 1),
    'elapsed_sec', extract(epoch from now() - v_t.started_at)::int);
end;
$$;

create or replace function public.fc_training_module(p_training_id uuid, p_module text)
returns json language plpgsql volatile security definer set search_path = public as $$
begin
  update fc_training set modules = modules || jsonb_build_object(left(p_module, 40), now())
   where id = p_training_id and completed_at is null;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.fc_training_finish(p_training_id uuid)
returns json language plpgsql volatile security definer set search_path = public as $$
declare v_t fc_training%rowtype; v_min integer; v_left integer;
begin
  select * into v_t from fc_training where id = p_training_id for update;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if v_t.completed_at is not null then return json_build_object('ok', true, 'completed_at', v_t.completed_at); end if;
  if (select count(*) from jsonb_object_keys(v_t.modules)) < v_t.module_count then
    return json_build_object('ok', false, 'error', 'modules_left');
  end if;
  select training_min_minutes into v_min from fc_settings where id = 1;
  v_left := ceil(v_min * 60 - extract(epoch from now() - v_t.started_at))::int;
  if v_left > 0 then return json_build_object('ok', false, 'error', 'too_fast', 'seconds_left', v_left); end if;
  update fc_training set completed_at = now() where id = v_t.id returning * into v_t;
  return json_build_object('ok', true, 'completed_at', v_t.completed_at);
end;
$$;

-- Employee lookup now also says whether classroom training is current.
create or replace function public.fc_lookup_employee(p_emp_id integer)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_emp  emp_employees%rowtype;
  v_cert fc_certs%rowtype;
  v_pend fc_attempts%rowtype;
  v_set  fc_settings%rowtype;
  v_tr   fc_training%rowtype;
begin
  select * into v_set from fc_settings where id = 1;
  select * into v_emp from emp_employees where emp_id = p_emp_id order by updated_at desc nulls last limit 1;
  if not found then return json_build_object('found', false); end if;

  select * into v_cert from fc_certs where emp_id = p_emp_id and status = 'active'
    order by issued_on desc, id desc limit 1;
  select * into v_pend from fc_attempts where emp_id = p_emp_id and status = 'awaiting_practical'
    order by submitted_at desc limit 1;
  v_tr := fc_training_current(p_emp_id);

  return json_build_object(
    'found', true,
    'emp', json_build_object('id', v_emp.emp_id, 'name', coalesce(v_emp.full_name, v_emp.first_name),
                             'location', v_emp.location, 'team', v_emp.team,
                             'active', coalesce(v_emp.is_active, true)),
    'cert', case when v_cert.id is null then null
                  else (fc_cert_json(v_cert)::jsonb - 'emp_email' - 'manager_id' - 'attempt_id' - 'emailed_at') end,
    'pending', case when v_pend.id is null then null else json_build_object(
                 'attempt_id', v_pend.id, 'score_pct', v_pend.score_pct, 'submitted_at', v_pend.submitted_at) end,
    'training', case when v_tr.id is null then null else json_build_object(
                 'completed_at', v_tr.completed_at,
                 'good_until', (v_tr.completed_at + interval '90 days')) end,
    'require_training', v_set.require_training,
    'managers', (select coalesce(json_agg(json_build_object('id', id, 'name', name, 'location', location)
                   order by name), '[]'::json) from fc_managers where is_active),
    'questions_per_test', v_set.questions_per_test,
    'pass_pct', v_set.pass_pct);
end;
$$;

-- Start test: same as before, plus the classroom training check.
create or replace function public.fc_start_test(
  p_emp_id        integer,
  p_email         text,
  p_manager_id    bigint,
  p_truck_types   text[],
  p_training_date date
)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  v_emp   emp_employees%rowtype;
  v_set   fc_settings%rowtype;
  v_tr    fc_training%rowtype;
  v_fails integer;
  v_first timestamptz;
  v_served jsonb;
  v_qs    json;
  v_id    uuid;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_tdate date;
begin
  select * into v_set from fc_settings where id = 1;
  select * into v_emp from emp_employees where emp_id = p_emp_id order by updated_at desc nulls last limit 1;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if v_emp.is_active = false then return json_build_object('ok', false, 'error', 'inactive'); end if;
  if p_manager_id is null or not exists (select 1 from fc_managers where id = p_manager_id and is_active) then
    return json_build_object('ok', false, 'error', 'need_manager');
  end if;
  if coalesce(cardinality(p_truck_types), 0) = 0 then
    return json_build_object('ok', false, 'error', 'need_truck');
  end if;
  if v_email <> '' and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return json_build_object('ok', false, 'error', 'bad_email');
  end if;

  v_tr := fc_training_current(p_emp_id);
  if v_set.require_training and v_tr.id is null then
    return json_build_object('ok', false, 'error', 'need_training');
  end if;
  v_tdate := coalesce((v_tr.completed_at at time zone 'America/Chicago')::date, p_training_date, fc_today());

  select count(*), min(submitted_at) into v_fails, v_first
    from fc_attempts where emp_id = p_emp_id and status = 'failed' and submitted_at > now() - interval '24 hours';
  if v_fails >= v_set.max_fails_per_day then
    return json_build_object('ok', false, 'error', 'too_many_attempts',
                             'retry_at', v_first + interval '24 hours');
  end if;

  if (select count(*) from fc_questions where is_active) < v_set.questions_per_test then
    return json_build_object('ok', false, 'error', 'not_enough_questions');
  end if;

  update fc_attempts set status = 'abandoned' where emp_id = p_emp_id and status = 'in_progress';

  with picked as (
    select q.id, q.question, row_number() over () as n,
           (select array_agg(o order by (o ~* '^(none|all) of the above'), random()) from unnest(q.options) o) as opts
    from (select * from fc_questions where is_active order by random() limit v_set.questions_per_test) q
  )
  select jsonb_agg(jsonb_build_object('id', id, 'options', to_jsonb(opts)) order by n),
         json_agg(json_build_object('id', id, 'question', question, 'options', opts) order by n)
    into v_served, v_qs from picked;

  insert into fc_attempts (emp_id, emp_name, location, team, emp_email, manager_id, truck_types,
                           training_date, served, pass_pct)
  values (p_emp_id, coalesce(v_emp.full_name, v_emp.first_name), v_emp.location, v_emp.team, v_email,
          p_manager_id, p_truck_types, v_tdate, v_served, v_set.pass_pct)
  returning id into v_id;

  return json_build_object('ok', true, 'attempt_id', v_id, 'questions', v_qs,
                           'total', jsonb_array_length(v_served), 'pass_pct', v_set.pass_pct);
end;
$$;

-- Settings save: also the two training settings.
create or replace function public.fc_mgr_save_settings(p_passcode text, p_settings jsonb)
returns json language plpgsql volatile security definer set search_path = public as $$
declare v_err text;
begin
  v_err := toolkit_manager_check(p_passcode);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  update fc_settings set
    questions_per_test   = coalesce((p_settings ->> 'questions_per_test')::int, questions_per_test),
    pass_pct             = coalesce((p_settings ->> 'pass_pct')::numeric, pass_pct),
    cert_years           = coalesce((p_settings ->> 'cert_years')::int, cert_years),
    max_fails_per_day    = coalesce((p_settings ->> 'max_fails_per_day')::int, max_fails_per_day),
    require_training     = coalesce((p_settings ->> 'require_training')::boolean, require_training),
    training_min_minutes = coalesce((p_settings ->> 'training_min_minutes')::int, training_min_minutes),
    hr_emails            = coalesce(p_settings ->> 'hr_emails', hr_emails),
    mailer_url           = coalesce(trim(p_settings ->> 'mailer_url'), mailer_url),
    updated_at           = now()
  where id = 1;
  return json_build_object('ok', true);
exception when check_violation or invalid_text_representation then
  return json_build_object('ok', false, 'error', 'bad_value');
end;
$$;

-- Managers: training records (latest 500) + training settings.
create or replace function public.fc_mgr_training(p_passcode text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare v_err text;
begin
  v_err := toolkit_manager_check(p_passcode);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  return json_build_object('ok', true,
    'require_training', (select require_training from fc_settings where id = 1),
    'training_min_minutes', (select training_min_minutes from fc_settings where id = 1),
    'records', (select coalesce(json_agg(json_build_object('emp_id', t.emp_id, 'name', t.emp_name,
                  'started_at', t.started_at, 'completed_at', t.completed_at,
                  'modules_done', (select count(*) from jsonb_object_keys(t.modules)), 'module_count', t.module_count,
                  'minutes', round(extract(epoch from coalesce(t.completed_at, now()) - t.started_at) / 60))
                  order by coalesce(t.completed_at, t.started_at) desc), '[]'::json)
                from (select * from fc_training order by started_at desc limit 500) t));
end;
$$;

revoke all on function
  public.fc_training_start(integer, integer, text),
  public.fc_training_module(uuid, text),
  public.fc_training_finish(uuid),
  public.fc_mgr_training(text)
from public;
grant execute on function
  public.fc_training_start(integer, integer, text),
  public.fc_training_module(uuid, text),
  public.fc_training_finish(uuid),
  public.fc_mgr_training(text)
to anon, authenticated;


-- ============================================================
-- v1.77.1 — Shorter training (15 min minimum) + manager waiver for
-- recertification. A waiver counts as current classroom training for
-- 90 days, only for someone who already holds (or held) a cert.
-- ============================================================
update public.fc_settings set training_min_minutes = 15 where id = 1 and training_min_minutes = 20;
alter table public.fc_settings alter column training_min_minutes set default 15;
alter table public.fc_training add column if not exists waived_by    text;
alter table public.fc_training add column if not exists waive_reason text;
alter table public.fc_attempts add column if not exists training_waived boolean not null default false;
alter table public.fc_certs    add column if not exists training_waived boolean not null default false;

create or replace function public.fc_mgr_waive_training(p_passcode text, p_emp_id integer, p_manager text, p_reason text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare v_err text; v_emp emp_employees%rowtype; v_cert fc_certs%rowtype; v_id uuid;
begin
  v_err := toolkit_manager_check(p_passcode);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  if coalesce(trim(p_manager), '') = '' then return json_build_object('ok', false, 'error', 'need_evaluator'); end if;
  select * into v_emp from emp_employees where emp_id = p_emp_id order by updated_at desc nulls last limit 1;
  if not found then return json_build_object('ok', false, 'error', 'emp_not_found'); end if;
  select * into v_cert from fc_certs where emp_id = p_emp_id and status = 'active' order by issued_on desc limit 1;
  if not found then return json_build_object('ok', false, 'error', 'no_cert'); end if;
  insert into fc_training (emp_id, emp_name, completed_at, module_count, version, waived_by, waive_reason)
  values (p_emp_id, coalesce(v_emp.full_name, v_emp.first_name), now(), 0, 'waived', trim(p_manager),
          coalesce(nullif(trim(p_reason), ''), 'Recertification'))
  returning id into v_id;
  return json_build_object('ok', true, 'name', coalesce(v_emp.full_name, v_emp.first_name),
                           'cert_no', v_cert.cert_no, 'expires_on', v_cert.expires_on);
end;
$$;
revoke all on function public.fc_mgr_waive_training(text, integer, text, text) from public;
grant execute on function public.fc_mgr_waive_training(text, integer, text, text) to anon, authenticated;

-- Lookup: say when training was waived.
create or replace function public.fc_lookup_employee(p_emp_id integer)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_emp  emp_employees%rowtype;
  v_cert fc_certs%rowtype;
  v_pend fc_attempts%rowtype;
  v_set  fc_settings%rowtype;
  v_tr   fc_training%rowtype;
begin
  select * into v_set from fc_settings where id = 1;
  select * into v_emp from emp_employees where emp_id = p_emp_id order by updated_at desc nulls last limit 1;
  if not found then return json_build_object('found', false); end if;

  select * into v_cert from fc_certs where emp_id = p_emp_id and status = 'active'
    order by issued_on desc, id desc limit 1;
  select * into v_pend from fc_attempts where emp_id = p_emp_id and status = 'awaiting_practical'
    order by submitted_at desc limit 1;
  v_tr := fc_training_current(p_emp_id);

  return json_build_object(
    'found', true,
    'emp', json_build_object('id', v_emp.emp_id, 'name', coalesce(v_emp.full_name, v_emp.first_name),
                             'location', v_emp.location, 'team', v_emp.team,
                             'active', coalesce(v_emp.is_active, true)),
    'cert', case when v_cert.id is null then null
                  else (fc_cert_json(v_cert)::jsonb - 'emp_email' - 'manager_id' - 'attempt_id' - 'emailed_at') end,
    'pending', case when v_pend.id is null then null else json_build_object(
                 'attempt_id', v_pend.id, 'score_pct', v_pend.score_pct, 'submitted_at', v_pend.submitted_at) end,
    'training', case when v_tr.id is null then null else json_build_object(
                 'completed_at', v_tr.completed_at, 'waived_by', v_tr.waived_by,
                 'good_until', (v_tr.completed_at + interval '90 days')) end,
    'require_training', v_set.require_training,
    'managers', (select coalesce(json_agg(json_build_object('id', id, 'name', name, 'location', location)
                   order by name), '[]'::json) from fc_managers where is_active),
    'questions_per_test', v_set.questions_per_test,
    'pass_pct', v_set.pass_pct);
end;
$$;

-- Start test: a waiver leaves the training date empty and flags the attempt.
create or replace function public.fc_start_test(
  p_emp_id        integer,
  p_email         text,
  p_manager_id    bigint,
  p_truck_types   text[],
  p_training_date date
)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  v_emp   emp_employees%rowtype;
  v_set   fc_settings%rowtype;
  v_tr    fc_training%rowtype;
  v_fails integer;
  v_first timestamptz;
  v_served jsonb;
  v_qs    json;
  v_id    uuid;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_tdate date;
  v_waived boolean;
begin
  select * into v_set from fc_settings where id = 1;
  select * into v_emp from emp_employees where emp_id = p_emp_id order by updated_at desc nulls last limit 1;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if v_emp.is_active = false then return json_build_object('ok', false, 'error', 'inactive'); end if;
  if p_manager_id is null or not exists (select 1 from fc_managers where id = p_manager_id and is_active) then
    return json_build_object('ok', false, 'error', 'need_manager');
  end if;
  if coalesce(cardinality(p_truck_types), 0) = 0 then
    return json_build_object('ok', false, 'error', 'need_truck');
  end if;
  if v_email <> '' and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return json_build_object('ok', false, 'error', 'bad_email');
  end if;

  v_tr := fc_training_current(p_emp_id);
  if v_set.require_training and v_tr.id is null then
    return json_build_object('ok', false, 'error', 'need_training');
  end if;
  v_waived := v_tr.waived_by is not null;
  v_tdate := case when v_waived then null
                  else coalesce((v_tr.completed_at at time zone 'America/Chicago')::date, p_training_date, fc_today()) end;

  select count(*), min(submitted_at) into v_fails, v_first
    from fc_attempts where emp_id = p_emp_id and status = 'failed' and submitted_at > now() - interval '24 hours';
  if v_fails >= v_set.max_fails_per_day then
    return json_build_object('ok', false, 'error', 'too_many_attempts',
                             'retry_at', v_first + interval '24 hours');
  end if;

  if (select count(*) from fc_questions where is_active) < v_set.questions_per_test then
    return json_build_object('ok', false, 'error', 'not_enough_questions');
  end if;

  update fc_attempts set status = 'abandoned' where emp_id = p_emp_id and status = 'in_progress';

  with picked as (
    select q.id, q.question, row_number() over () as n,
           (select array_agg(o order by (o ~* '^(none|all) of the above'), random()) from unnest(q.options) o) as opts
    from (select * from fc_questions where is_active order by random() limit v_set.questions_per_test) q
  )
  select jsonb_agg(jsonb_build_object('id', id, 'options', to_jsonb(opts)) order by n),
         json_agg(json_build_object('id', id, 'question', question, 'options', opts) order by n)
    into v_served, v_qs from picked;

  insert into fc_attempts (emp_id, emp_name, location, team, emp_email, manager_id, truck_types,
                           training_date, training_waived, served, pass_pct)
  values (p_emp_id, coalesce(v_emp.full_name, v_emp.first_name), v_emp.location, v_emp.team, v_email,
          p_manager_id, p_truck_types, v_tdate, v_waived, v_served, v_set.pass_pct)
  returning id into v_id;

  return json_build_object('ok', true, 'attempt_id', v_id, 'questions', v_qs,
                           'total', jsonb_array_length(v_served), 'pass_pct', v_set.pass_pct);
end;
$$;

-- Carry the waiver flag onto the certificate.
create or replace function public.fc_certs_copy_waived()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.attempt_id is not null then
    select coalesce(a.training_waived, false) into new.training_waived from fc_attempts a where a.id = new.attempt_id;
  end if;
  return new;
end;
$$;
revoke all on function public.fc_certs_copy_waived() from public, anon, authenticated;
drop trigger if exists fc_certs_copy_waived on public.fc_certs;
create trigger fc_certs_copy_waived before insert on public.fc_certs
  for each row execute function public.fc_certs_copy_waived();

create or replace function public.fc_cert_json(c public.fc_certs)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', c.id, 'cert_no', c.cert_no, 'attempt_id', c.attempt_id,
    'emp_id', c.emp_id, 'name', c.emp_name, 'location', c.location, 'team', c.team,
    'emp_email', c.emp_email, 'manager_id', c.manager_id,
    'manager', (select m.name from fc_managers m where m.id = c.manager_id),
    'truck_types', c.truck_types, 'training_date', c.training_date, 'training_waived', c.training_waived,
    'written_score', c.written_score, 'written_date', c.written_date,
    'practical_date', c.practical_date, 'evaluator', c.evaluator_name,
    'issued_on', c.issued_on, 'expires_on', c.expires_on,
    'status', c.status, 'state', fc_cert_state(c.status, c.expires_on),
    'days_left', c.expires_on - fc_today(),
    'source', c.source, 'import_note', c.import_note,
    'revoked_reason', c.revoked_reason, 'emailed_at', c.emailed_at);
$$;
revoke all on function public.fc_cert_json(public.fc_certs) from public, anon, authenticated;

-- Managers' training list: include waivers.
create or replace function public.fc_mgr_training(p_passcode text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare v_err text;
begin
  v_err := toolkit_manager_check(p_passcode);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  return json_build_object('ok', true,
    'require_training', (select require_training from fc_settings where id = 1),
    'training_min_minutes', (select training_min_minutes from fc_settings where id = 1),
    'records', (select coalesce(json_agg(json_build_object('emp_id', t.emp_id, 'name', t.emp_name,
                  'started_at', t.started_at, 'completed_at', t.completed_at,
                  'waived_by', t.waived_by, 'waive_reason', t.waive_reason,
                  'modules_done', (select count(*) from jsonb_object_keys(t.modules)), 'module_count', t.module_count,
                  'minutes', round(extract(epoch from coalesce(t.completed_at, now()) - t.started_at) / 60))
                  order by coalesce(t.completed_at, t.started_at) desc), '[]'::json)
                from (select * from fc_training order by started_at desc limit 500) t));
end;
$$;


-- ============================================================
-- v1.78.0 — Employees list for managers: everyone in the timeclock with
-- their forklift cert, classroom training and test status.
-- ============================================================
create or replace function public.fc_mgr_employees(p_passcode text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare v_err text;
begin
  v_err := toolkit_manager_check(p_passcode);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  return json_build_object('ok', true,
    'synced_at', (select max(last_synced_at) from emp_sync_meta),
    'employees', (select coalesce(json_agg(json_build_object(
        'emp_id', e.emp_id, 'name', coalesce(e.full_name, e.first_name), 'location', e.location, 'team', e.team,
        'active', coalesce(e.is_active, true),
        'cert', case when c.id is null then null else json_build_object(
                  'id', c.id, 'cert_no', c.cert_no, 'issued_on', c.issued_on, 'expires_on', c.expires_on,
                  'state', fc_cert_state(c.status, c.expires_on), 'days_left', c.expires_on - fc_today(),
                  'truck_types', c.truck_types) end,
        'training', case when t.id is null then null else json_build_object(
                  'completed_at', t.completed_at, 'waived_by', t.waived_by) end,
        'in_training', exists (select 1 from fc_training x where x.emp_id = e.emp_id and x.completed_at is null
                                and x.started_at > now() - interval '24 hours'),
        'pending_eval', exists (select 1 from fc_attempts a where a.emp_id = e.emp_id and a.status = 'awaiting_practical'),
        'last_test', (select json_build_object('at', a.submitted_at, 'score_pct', a.score_pct, 'status', a.status)
                        from fc_attempts a where a.emp_id = e.emp_id and a.submitted_at is not null
                        order by a.submitted_at desc limit 1))
      order by coalesce(e.full_name, e.first_name)), '[]'::json)
      from (select distinct on (emp_id) * from emp_employees order by emp_id, updated_at desc nulls last) e
      left join lateral (select * from fc_certs c where c.emp_id = e.emp_id and c.status = 'active'
                         order by issued_on desc, id desc limit 1) c on true
      left join lateral (select * from fc_training_current(e.emp_id) t where t.id is not null) t on true));
end;
$$;
revoke all on function public.fc_mgr_employees(text) from public;
grant execute on function public.fc_mgr_employees(text) to anon, authenticated;
