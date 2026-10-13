-- =============================================================================
-- 0038_classes.sql — a class typed by hand, Oct 2026.
--
-- For the student whose school gives no calendar file. Until now a class only
-- arrived through a live feed (0027) or a pasted .ics, both as events of kind
-- `other`. Every planner this one competes with lets you type a repeating
-- class, and setting up a timetable is the most complained-about job in
-- student-planner reviews. Without a file, a Tuesday-and-Thursday lecture was
-- twenty-six events typed one at a time.
--
-- MATERIALISED, LIKE assignment_series (0023)
--
-- The pattern is a row; its sessions are real events, so Today's Up next,
-- Week and Month draw them with the code that already draws every other event.
-- Each session is converted from its own date in the account's zone, so a
-- 10:15 lecture stays at 10:15 across a clock change.
--
-- UNLIKE REPEATING WORK, A CLASS CAN BE EDITED AS A SERIES
--
-- Repeating work has no editor because a finished lab carries state an edit
-- would have to guess about. A class carries none: it is attended, never
-- ticked off. So an edit can rewrite the sessions from a chosen day on —
-- updating in place, so ids hold — and leave every earlier one as it was.
--
-- ONE TRANSACTION PER SAVE
--
-- A save is a parent row plus up to two hundred inserts, updates and removals.
-- Done as separate requests, a dropped connection halfway leaves a class half
-- moved, with nothing on screen to say which half. `save_class` applies the
-- whole plan or none of it. It runs as the CALLER (security invoker), so RLS
-- confines it to the caller's own rows exactly as the REST API would, and it
-- takes the account from auth.uid(), never from an argument.
-- =============================================================================

-- A class is attended, not handed in: the briefing reads it as timetable and
-- it never gets the night-before escalation, which is for exams and
-- presentations only. Not used anywhere in this file: a value added to an enum
-- cannot be used in the transaction that adds it.
alter type public.event_kind add value if not exists 'class';

create table if not exists public.class_series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,

  -- "COEN 231 Lecture": the course code is part of the title, because Search,
  -- Abood, Month's tiles and a subscribed phone calendar read the title and
  -- none of them can see a course colour.
  title text not null check (length(trim(title)) > 0),

  -- ISO weekdays, 1 = Monday .. 7 = Sunday.
  weekdays smallint[] not null
    check (cardinality(weekdays) > 0 and weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]),

  -- Wall-clock times in the account's zone, never instants: the instant of
  -- 10:15 changes on 1 November and the class does not.
  start_time text not null check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time text not null check (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),

  location text,

  first_day date not null,
  last_day date not null,

  -- Days it does not meet: reading week, a holiday, a cancelled lecture. Kept
  -- on the pattern so a later edit cannot bring a skipped session back.
  skip_days date[] not null default '{}',

  created_at timestamptz not null default now(),

  constraint class_series_span check (last_day >= first_day),
  constraint class_series_order check (end_time > start_time),
  -- The target of the composite key below.
  constraint class_series_id_owner unique (id, user_id)
);

alter table public.class_series enable row level security;

drop policy if exists "own class series" on public.class_series;
create policy "own class series" on public.class_series
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists class_series_user_idx
  on public.class_series (user_id, last_day);

comment on table public.class_series is
  'A weekly class typed by hand. Its sessions are rows in events (kind class) '
  'carrying series_id; deleting the pattern keeps any session it did not remove.';

alter table public.events
  add column if not exists series_id uuid;

-- Ownership is part of the key, as for feeds (0027): (series_id, user_id) must
-- name a class that account owns, so no account can attach its events to
-- another's class. Deleting a class clears the link on any session it left
-- behind rather than deleting it — only series_id is set null, since user_id
-- is never null.
alter table public.events
  drop constraint if exists events_series_owner_fk;
alter table public.events
  add constraint events_series_owner_fk
  foreign key (series_id, user_id)
  references public.class_series(id, user_id)
  on delete set null (series_id);

-- An event comes from one place: a subscribed calendar or a typed class.
alter table public.events
  drop constraint if exists events_one_origin;
alter table public.events
  add constraint events_one_origin check (series_id is null or feed_id is null);

create index if not exists events_series_idx
  on public.events (series_id, starts_at)
  where series_id is not null;

-- -----------------------------------------------------------------------------
-- save_class — write a class and its sessions, all or nothing.
--
-- The client works out the plan (`planClass`, the same pure function the
-- preview uses) and this applies it. Sessions take their title, course and
-- room from the class row, so a session can never disagree with its class.
-- Updates and removals touch only this class's own sessions, and if any of
-- them is no longer there — changed on another device since the plan was made
-- — the whole save is refused rather than half applied.
-- -----------------------------------------------------------------------------
create or replace function public.save_class(
  p_class jsonb,
  p_insert jsonb,
  p_update jsonb,
  p_remove uuid[]
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid := (p_class->>'id')::uuid;
  v_title text;
  v_course uuid;
  v_location text;
  v_count integer;
  v_written integer := 0;
begin
  if v_user is null then
    raise exception 'Sign in to save a class.' using errcode = '42501';
  end if;

  insert into public.class_series as s
    (id, user_id, course_id, title, weekdays, start_time, end_time, location, first_day, last_day, skip_days)
  values (
    v_id,
    v_user,
    nullif(p_class->>'course_id', '')::uuid,
    trim(p_class->>'title'),
    array(select jsonb_array_elements_text(p_class->'weekdays'))::smallint[],
    p_class->>'start_time',
    p_class->>'end_time',
    nullif(trim(coalesce(p_class->>'location', '')), ''),
    (p_class->>'first_day')::date,
    (p_class->>'last_day')::date,
    array(select jsonb_array_elements_text(coalesce(p_class->'skip_days', '[]'::jsonb)))::date[]
  )
  on conflict (id) do update set
    course_id = excluded.course_id,
    title = excluded.title,
    weekdays = excluded.weekdays,
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    location = excluded.location,
    first_day = excluded.first_day,
    last_day = excluded.last_day,
    skip_days = excluded.skip_days
  returning s.title, s.course_id, s.location into v_title, v_course, v_location;

  delete from public.events
   where id = any(coalesce(p_remove, '{}'))
     and series_id = v_id;
  get diagnostics v_count = row_count;
  if v_count <> coalesce(cardinality(p_remove), 0) then
    raise exception 'This class changed somewhere else. Nothing was saved.' using errcode = '40001';
  end if;
  v_written := v_written + v_count;

  update public.events e
     set starts_at = x.starts_at,
         ends_at = x.ends_at,
         title = v_title,
         course_id = v_course,
         location = v_location
    from jsonb_to_recordset(coalesce(p_update, '[]'::jsonb)) as x(id uuid, starts_at timestamptz, ends_at timestamptz)
   where e.id = x.id
     and e.series_id = v_id;
  get diagnostics v_count = row_count;
  if v_count <> jsonb_array_length(coalesce(p_update, '[]'::jsonb)) then
    raise exception 'This class changed somewhere else. Nothing was saved.' using errcode = '40001';
  end if;
  v_written := v_written + v_count;

  insert into public.events (user_id, course_id, title, kind, starts_at, ends_at, all_day, location, series_id)
  select v_user, v_course, v_title, 'class', x.starts_at, x.ends_at, false, v_location, v_id
    from jsonb_to_recordset(coalesce(p_insert, '[]'::jsonb)) as x(starts_at timestamptz, ends_at timestamptz);
  get diagnostics v_count = row_count;
  v_written := v_written + v_count;

  return v_written;
end;
$$;

-- -----------------------------------------------------------------------------
-- delete_class — the class, and the sessions the caller chose to remove.
--
-- The caller passes the sessions still to come, and the ones that already
-- happened only if asked to. Anything left keeps its place on the calendar
-- with its link cleared by the foreign key.
-- -----------------------------------------------------------------------------
create or replace function public.delete_class(p_id uuid, p_remove uuid[])
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to delete a class.' using errcode = '42501';
  end if;

  delete from public.events
   where id = any(coalesce(p_remove, '{}'))
     and series_id = p_id;
  get diagnostics v_count = row_count;

  delete from public.class_series where id = p_id;
  return v_count;
end;
$$;

-- Supabase grants EXECUTE on every new function to anon. Neither of these
-- can do anything without a signed-in caller, and there is no reason to offer
-- them to one.
revoke all on function public.save_class(jsonb, jsonb, jsonb, uuid[]) from public, anon;
revoke all on function public.delete_class(uuid, uuid[]) from public, anon;
grant execute on function public.save_class(jsonb, jsonb, jsonb, uuid[]) to authenticated;
grant execute on function public.delete_class(uuid, uuid[]) to authenticated;
