-- =============================================================================
-- 0017_daily_summary.sql — the summary shown when the app opens.
--
-- Cached per local day, and that is the whole reason this table exists.
-- Without it, every launch is a model call: slow on the one screen that has to
-- answer in under two seconds, and — now that one key serves every account —
-- a shared quota spent on re-answering a question whose answer has not changed.
--
-- Invalidated by a fingerprint of the work it describes rather than by a
-- timer. Ticking something off should change the summary; opening the app four
-- times in an hour should not.
-- =============================================================================

create table public.daily_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  local_day text not null check (local_day ~ '^\d{4}-\d{2}-\d{2}$'),
  body text not null,

  -- A hash of the assignments, events and checklist state the summary was
  -- written from. When it differs, the summary is stale and gets rewritten.
  fingerprint text not null,

  created_at timestamptz not null default now(),

  unique (user_id, local_day)
);

create index daily_summaries_recent on public.daily_summaries (user_id, local_day desc);

alter table public.daily_summaries enable row level security;

create policy "own daily summaries" on public.daily_summaries
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
