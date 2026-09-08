-- =============================================================================
-- 0023_assignment_series.sql — recurring coursework.
--
-- A weekly lab was twelve rows typed twelve times. A Tuesday tutorial over a
-- thirteen-week term was thirteen. Checklist items have recurred since 0003;
-- assignments and events never have, which is the largest remaining friction
-- in a STUDENT planner — the most predictable data in a term was the most
-- laborious to enter.
--
-- MATERIALISED, NOT COMPUTED, AND THAT IS THE WHOLE DESIGN
--
-- Checklist recurrence is virtual: `isDueOn` computes whether "Vitamin D" is
-- expected today and stores nothing per day. That works because every instance
-- is identical and stateless — one dose is interchangeable with another, and
-- missed days stay the absence of a row, which is how rule 3 is enforced
-- structurally.
--
-- Coursework instances diverge, and every way they diverge is per-instance
-- state a computed series has nowhere to put:
--
--   Lab 3 is due the 14th and Lab 4 the 21st.
--   You finished Lab 3 and not Lab 4, so status differs.
--   The weekly quiz is worth 2% and the final report 20%.
--   You scored 88 on one and 71 on another.
--   Reading week moved exactly one of them by seven days.
--
-- So the pattern is a row, and the instances are real assignments generated
-- from it. Each carries its own due date, status, weight and grade, and can be
-- edited or deleted without the others noticing.
--
-- WHY series_id IS `on delete set null`
--
-- Deleting a series must never delete the work already done under it. Last
-- term's record is the one thing a planner must not quietly discard, and a
-- cascade here would mean "stop repeating this" silently erased a term of
-- completed labs and the grades attached to them. Orphaned instances stay
-- exactly as they were and simply stop belonging to a pattern.
--
-- WHY THERE IS AN `until_day` AND NOT AN INFINITE SERIES
--
-- Generation happens over a bounded horizon, so an unbounded series would
-- quietly stop at the horizon and look like a bug. A term has an end; saying
-- so makes the last instance a fact rather than an artefact of how far ahead
-- the generator happened to run.
-- =============================================================================

create table public.assignment_series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,

  title text not null check (length(trim(title)) > 0),

  -- 'weekdays' covers "every Tuesday" and "Tuesdays and Thursdays".
  -- 'interval' covers "every 14 days" — the biweekly lab.
  -- 'daily' is accepted by the shared enum and refused below: a piece of
  -- coursework due every single day is not a thing, and allowing it would let
  -- one tap generate a hundred rows.
  recurrence public.recurrence_kind not null,
  weekdays smallint[],
  interval_days smallint check (interval_days is null or interval_days > 0),

  -- The series starts here and never generates before it, so configuring a
  -- pattern today cannot make it look as though you missed all of last month.
  anchor_day date not null,
  -- The last day an instance may fall on. Required: see the header.
  until_day date not null,

  -- Applied to every generated instance, which is the point — "each lab is
  -- worth 5%" is stated once rather than thirteen times.
  due_time text,
  effort_minutes integer check (effort_minutes is null or effort_minutes > 0),
  weight_percent numeric(5, 2)
    check (weight_percent is null or (weight_percent > 0 and weight_percent <= 100)),

  -- Turning a series off stops future generation and touches nothing already
  -- generated, exactly like archiving a course.
  active boolean not null default true,

  created_at timestamptz not null default now(),

  constraint assignment_series_span check (until_day >= anchor_day),
  constraint assignment_series_not_daily check (recurrence <> 'daily'),
  constraint assignment_series_weekdays_present
    check (recurrence <> 'weekdays' or (weekdays is not null and array_length(weekdays, 1) > 0)),
  constraint assignment_series_interval_present
    check (recurrence <> 'interval' or interval_days is not null)
);

alter table public.assignment_series enable row level security;

create policy "own assignment series" on public.assignment_series
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.assignments
  add column if not exists series_id uuid
    references public.assignment_series(id) on delete set null;

-- The generator asks "which days of this series already exist" on every run,
-- so this is the index that keeps it from being a table scan.
create index if not exists assignments_series_idx
  on public.assignments (series_id, due_at)
  where series_id is not null;

create index if not exists assignment_series_user_idx
  on public.assignment_series (user_id)
  where active;

comment on table public.assignment_series is
  'A recurring pattern of coursework. Instances are real rows in assignments, '
  'each with its own status, weight and grade; deleting a series orphans them '
  'rather than removing them.';
