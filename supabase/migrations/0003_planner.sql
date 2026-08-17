-- =============================================================================
-- 0003_planner.sql — Phase 1 content tables.
--
-- Unlocked by the Phase 0 push proof: a scheduled server job delivered a real
-- notification on 17 Aug 2026, so feature work may begin.
--
-- The shape of this schema is driven by one rule above all others: minimum
-- required fields at capture. Almost every column here is nullable, and that
-- is deliberate rather than sloppy. Every NOT NULL is a chance for the thought
-- to evaporate before it is recorded.
--
-- Every table has RLS keyed to auth.uid(), including the child tables, which
-- carry a denormalised user_id so a policy never has to join to find an owner.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- courses
--
-- colour_index rather than a colour value: the palette lives in tokens.css and
-- nowhere else, so the database stores which of the eight course slots is used
-- and has no opinion about what that looks like.
-- -----------------------------------------------------------------------------
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  name text not null,
  code text,
  colour_index smallint not null default 1 check (colour_index between 1 and 8),

  -- Term archiving is Phase 7, but the flag costs nothing now and means the
  -- first semester's courses do not have to be deleted to get them out of the
  -- way later.
  archived boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger courses_touch before update on public.courses
  for each row execute function public.touch_updated_at();

create index courses_active_idx on public.courses (user_id) where not archived;

-- -----------------------------------------------------------------------------
-- inbox_items — quick capture.
--
-- The highest-value feature in the app, and the simplest table in it. One
-- required field. No course, no due date, no category, no type. Triage is a
-- separate activity that happens later, or never.
--
-- Items are never deleted by triage, only stamped: `triaged_at` records that a
-- decision was made, `converted_to` records what it became. Capture that
-- silently loses things is worse than no capture.
-- -----------------------------------------------------------------------------
create table public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  body text not null check (length(trim(body)) > 0),

  -- Where it came from, so the Telegram capture path can be told apart from
  -- typing into the app. Useful for knowing which capture route actually gets
  -- used, which is worth knowing before optimising either.
  source text not null default 'app',

  triaged_at timestamptz,
  converted_to uuid,
  dismissed_at timestamptz,

  created_at timestamptz not null default now()
);

-- The inbox view: untriaged, newest first.
create index inbox_untriaged_idx on public.inbox_items (user_id, created_at desc)
  where triaged_at is null and dismissed_at is null;

-- -----------------------------------------------------------------------------
-- assignments
--
-- due_at is NULLABLE. An assignment you know about but cannot date yet is
-- still worth recording, and refusing to store it is how it ends up nowhere.
--
-- due_has_time distinguishes "due Friday" from "due Friday at 17:00". Storing
-- midnight and pretending is a lie that shows up later as a task that looks
-- overdue all day.
-- -----------------------------------------------------------------------------
create type public.assignment_status as enum ('todo', 'doing', 'done');

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,

  title text not null check (length(trim(title)) > 0),

  due_at timestamptz,
  due_has_time boolean not null default false,

  effort_minutes integer check (effort_minutes is null or effort_minutes > 0),

  status public.assignment_status not null default 'todo',
  notes text,

  -- "Start by" is normally derived from due_at and effort_minutes, because
  -- with ADHD the due date is often the only date that feels real and this
  -- manufactures an earlier one that also does. Stored only when the user
  -- overrides it, so changing the derivation rule later does not silently
  -- rewrite dates they set by hand.
  start_by_override date,

  completed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger assignments_touch before update on public.assignments
  for each row execute function public.touch_updated_at();

-- Drives Today, Week, and the digest's "due within N days" query.
create index assignments_due_idx on public.assignments (user_id, due_at)
  where status <> 'done';

create index assignments_course_idx on public.assignments (user_id, course_id);

-- -----------------------------------------------------------------------------
-- subtasks
--
-- Belong to an assignment, but carry user_id so RLS never needs a join.
-- Populated by hand, or in bulk by the Phase 4 task-breakdown button.
-- -----------------------------------------------------------------------------
create table public.subtasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,

  title text not null check (length(trim(title)) > 0),
  done boolean not null default false,
  position integer not null default 0,

  created_at timestamptz not null default now()
);

create index subtasks_assignment_idx on public.subtasks (assignment_id, position);

-- -----------------------------------------------------------------------------
-- events — exams, labs, presentations.
--
-- A distinct type rather than an assignment with a flag, because they behave
-- differently: you do not complete an exam, you attend it, and it earns extra
-- emphasis plus the Phase 2 T-1 escalation.
-- -----------------------------------------------------------------------------
create type public.event_kind as enum ('exam', 'lab', 'presentation', 'other');

create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,

  title text not null check (length(trim(title)) > 0),
  kind public.event_kind not null default 'other',

  starts_at timestamptz not null,
  ends_at timestamptz check (ends_at is null or ends_at >= starts_at),
  all_day boolean not null default false,

  location text,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();

create index events_upcoming_idx on public.events (user_id, starts_at);

-- -----------------------------------------------------------------------------
-- checklist_items — recurring daily things.
--
-- Recurrence is deliberately limited to the three shapes the spec asks for.
-- A general recurrence engine is a well-known way to spend three weeks, and
-- nothing here needs one.
-- -----------------------------------------------------------------------------
create type public.recurrence_kind as enum ('daily', 'weekdays', 'interval');

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  title text not null check (length(trim(title)) > 0),

  recurrence public.recurrence_kind not null default 'daily',
  -- ISO weekdays, 1 = Monday .. 7 = Sunday. Used only when recurrence =
  -- 'weekdays'.
  weekdays smallint[],
  -- Used only when recurrence = 'interval'.
  interval_days smallint check (interval_days is null or interval_days > 0),
  anchor_day date,

  active boolean not null default true,
  sort_order integer not null default 0,

  -- Medication refill counter. Only meaningful when tracks_doses is true.
  -- This is the highest-stakes number in the app: it is the difference between
  -- noticing a refill is needed and running out on a Sunday.
  tracks_doses boolean not null default false,
  doses_remaining integer check (doses_remaining is null or doses_remaining >= 0),
  doses_per_completion smallint not null default 1 check (doses_per_completion > 0),
  refill_warning_days smallint not null default 7 check (refill_warning_days >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A weekdays recurrence with no weekdays would silently never appear, and an
  -- interval recurrence with no interval would divide by nothing. Both are
  -- rejected at write time rather than discovered as a missing row.
  constraint recurrence_is_complete check (
    (recurrence = 'daily')
    or (recurrence = 'weekdays' and weekdays is not null and array_length(weekdays, 1) > 0)
    or (recurrence = 'interval' and interval_days is not null and anchor_day is not null)
  )
);

create trigger checklist_items_touch before update on public.checklist_items
  for each row execute function public.touch_updated_at();

create index checklist_active_idx on public.checklist_items (user_id, sort_order)
  where active;

-- -----------------------------------------------------------------------------
-- checklist_completions
--
-- local_day is text in the user's timezone, exactly as delivery_log does it,
-- and for the same reason: a "day" is the local day and must not be
-- reinterpreted by the database's own notion of one. It also makes back-filling
-- a missed day a plain insert with a different string, which is what keeps
-- missed days trivially recoverable rather than a special case.
--
-- No streak column exists here, and none should. Missed days are the absence
-- of a row, never a counter.
-- -----------------------------------------------------------------------------
create table public.checklist_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.checklist_items(id) on delete cascade,

  local_day text not null check (local_day ~ '^\d{4}-\d{2}-\d{2}$'),
  completed_at timestamptz not null default now(),

  -- Recorded when the row was added for an earlier day, so back-filling is
  -- visible in an export without ever being surfaced as a judgement.
  backfilled boolean not null default false,

  unique (item_id, local_day)
);

create index checklist_completions_day_idx
  on public.checklist_completions (user_id, local_day);

-- -----------------------------------------------------------------------------
-- Row level security. Every table, no exceptions.
-- -----------------------------------------------------------------------------
alter table public.courses enable row level security;
alter table public.inbox_items enable row level security;
alter table public.assignments enable row level security;
alter table public.subtasks enable row level security;
alter table public.events enable row level security;
alter table public.checklist_items enable row level security;
alter table public.checklist_completions enable row level security;

create policy "own courses" on public.courses
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own inbox" on public.inbox_items
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own assignments" on public.assignments
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own subtasks" on public.subtasks
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own events" on public.events
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own checklist items" on public.checklist_items
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own checklist completions" on public.checklist_completions
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- Medication dose counting.
--
-- Done in the database rather than the client so the count cannot drift when a
-- completion is toggled twice, replayed from the offline outbox, or undone.
-- The doses figure is the one number in this app that being wrong about has
-- consequences outside the app.
-- -----------------------------------------------------------------------------
create or replace function public.apply_dose_delta()
returns trigger
language plpgsql
as $$
declare
  v_tracks boolean;
  v_per smallint;
  v_item uuid;
begin
  v_item := coalesce(new.item_id, old.item_id);

  select tracks_doses, doses_per_completion into v_tracks, v_per
    from public.checklist_items where id = v_item;

  if not coalesce(v_tracks, false) then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    update public.checklist_items
       set doses_remaining = greatest(0, coalesce(doses_remaining, 0) - v_per)
     where id = v_item;
  elsif tg_op = 'DELETE' then
    -- Undo must give the dose back, or unchecking a box quietly loses one.
    update public.checklist_items
       set doses_remaining = coalesce(doses_remaining, 0) + v_per
     where id = v_item;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger checklist_completion_doses
  after insert or delete on public.checklist_completions
  for each row execute function public.apply_dose_delta();
