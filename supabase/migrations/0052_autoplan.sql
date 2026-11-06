-- 0052: Autoplan, and Abood able to change anything (6 Nov 2026).
--
-- planned_blocks are work sessions the planner places in free time and keeps
-- re-placing as the week changes (_shared/autoplan.ts). They belong to the
-- app, not to the person: only unpinned, unlocked, future blocks ever move,
-- and nothing of the person's (events, feeds, work) is rewritten by a replan.
--
-- connector_changes, the undo log, widens to every table Abood or a connected
-- AI app can now write.

create table if not exists public.planned_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  starts_at timestamptz not null,
  minutes smallint not null check (minutes between 5 and 600),
  -- planned: the engine may move it. done: it happened and counts as progress.
  -- skipped: declined; the engine will not put this work back in that slot.
  state text not null default 'planned' check (state in ('planned', 'done', 'skipped')),
  -- Pinned by a person (or Abood on their word): never moved by a replan.
  pinned boolean not null default false,
  -- Minutes actually worked, when a block is done for less or more than planned.
  done_minutes smallint check (done_minutes is null or done_minutes between 0 and 600),
  -- Why the engine put it here, in words. Shown on "why is this here".
  reason text check (reason is null or length(reason) <= 300),
  created_at timestamptz not null default now()
);

create index if not exists planned_blocks_user_start on public.planned_blocks (user_id, starts_at);
create index if not exists planned_blocks_assignment on public.planned_blocks (assignment_id);

alter table public.planned_blocks enable row level security;
revoke all on public.planned_blocks from anon;

drop policy if exists "own planned blocks" on public.planned_blocks;
create policy "own planned blocks" on public.planned_blocks
  for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.assignments a where a.id = assignment_id and a.user_id = auth.uid())
  );

-- What the engine reads from a piece of work, beyond its estimate and due date.
alter table public.assignments
  add column if not exists start_after date,
  add column if not exists up_next boolean not null default false;

-- Study hours per ISO weekday (1 = Monday): {"1": [540, 1260], ...}, minutes
-- from local midnight. Null means 9:00-21:00 every day. A weekday absent from
-- a set value is a day off. plan_off_days are single dates taken out
-- ("I'm off Saturday"); plan_day_cap is the most work planned in one day.
alter table public.app_settings
  add column if not exists study_hours jsonb
    check (study_hours is null or jsonb_typeof(study_hours) = 'object'),
  add column if not exists plan_off_days date[] not null default '{}',
  add column if not exists plan_day_cap smallint not null default 240
    check (plan_day_cap between 30 and 720),
  add column if not exists autoplan boolean not null default true;

-- app_settings is read through a column list (0034).
grant select (study_hours, plan_off_days, plan_day_cap, autoplan) on public.app_settings to authenticated;

alter table public.connector_changes drop constraint if exists connector_changes_target_table_check;
alter table public.connector_changes
  add constraint connector_changes_target_table_check check (target_table in (
    'assignments', 'events', 'inbox_items', 'courses', 'course_pages', 'subtasks',
    'checklist_items', 'checklist_completions', 'goals', 'planned_blocks',
    'app_settings', 'class_series', 'assignment_series'
  ));
