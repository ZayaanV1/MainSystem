-- =============================================================================
-- 0013_intelligence.sql — Phase 6 groundwork.
--
-- Two additions, and the shape of the first one is the interesting decision.
--
-- The spec asks to "quietly flag tasks that have moved six times", which needs
-- a deferral count. A `deferral_count` column would be the obvious way and it
-- trips the structural guard in migrations.test.ts that forbids `_count$`.
--
-- The guard was right and the design changed rather than the guard. That test
-- exists because rule 3 has been violated by well-meaning refactors before,
-- and its stated principle is that missed days are "the absence of a row,
-- never a number". Deferrals follow the same rule: they are rows, and the
-- count is derived.
--
-- That is also strictly more useful. Six deferrals in six months is a task you
-- keep meaning to get to; six in a week is a task that is blocked, and only
-- rows can tell those apart.
--
-- The framing matters as much as the storage. This counts the TASK's
-- stuckness, not the person's consistency — "this has moved six times" points
-- at a task that is too vague, too big or blocked, which is what the spec says
-- it means. It never accumulates into something the user can lose.
-- =============================================================================

create table public.deferrals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,

  -- Where it moved from and to, so a run of one-day pushes is distinguishable
  -- from one long postponement.
  from_day text check (from_day is null or from_day ~ '^\d{4}-\d{2}-\d{2}$'),
  to_day text not null check (to_day ~ '^\d{4}-\d{2}-\d{2}$'),

  created_at timestamptz not null default now()
);

create index deferrals_by_assignment on public.deferrals (assignment_id, created_at desc);
create index deferrals_by_user on public.deferrals (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- How long it actually took.
--
-- Nullable and it stays null unless volunteered. Asking "how long did that
-- take?" as a required step would put friction on marking something done,
-- which is the one action in the app that has to stay free — and an estimate
-- extracted under duress is not data worth calibrating against.
--
-- Calibration simply waits until there are pairs to learn from.
-- -----------------------------------------------------------------------------
alter table public.assignments add column if not exists actual_minutes integer
  check (actual_minutes is null or (actual_minutes > 0 and actual_minutes <= 6000));

alter table public.deferrals enable row level security;

create policy "own deferrals" on public.deferrals
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
