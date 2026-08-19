-- =============================================================================
-- 0016_weekly_review.sql — the weekly review.
--
-- A second scheduled message, on a chosen weekday, summarising the week that
-- just finished and the one starting. It rides the same delivery layer, the
-- same channels and the same one-per-local-day index as the morning digest.
--
-- Off by default. A second recurring notification is a real cost to attention,
-- and one that arrives unasked is the kind of thing that gets the whole app
-- muted.
-- =============================================================================

alter type public.delivery_kind add value if not exists 'weekly';

alter table public.app_settings
  add column if not exists weekly_review_enabled boolean not null default false,
  -- ISO weekday: 1 is Monday, 7 is Sunday. Sunday by default, which is when
  -- the week ahead is a question worth asking rather than a fact already
  -- underway.
  add column if not exists weekly_review_weekday smallint not null default 7
    check (weekly_review_weekday between 1 and 7);
