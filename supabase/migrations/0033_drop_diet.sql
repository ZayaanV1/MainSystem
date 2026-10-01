-- =============================================================================
-- 0033_drop_diet.sql — the diet tracker is gone.
--
-- The food log, macro targets, saved meals and weigh-ins were removed from the
-- app in October 2026: this is a planner for academic work, and food tracking
-- was the largest part of it that was not. Nothing in the app or the edge
-- functions reads or writes these tables any more.
--
-- Dropped rather than left behind, because a table nothing reads is a write-
-- only table with extra steps: it still holds personal data, still counts
-- against the free tier, and still reads as a feature in every review of the
-- schema. Anyone who wants their history should export it BEFORE this runs;
-- after it, the rows are gone.
--
-- Order follows the foreign keys: items reference entries. saved_meals'
-- touch trigger goes with its table. The enum goes last, once nothing uses it.
-- =============================================================================

drop table if exists public.food_items;
drop table if exists public.food_entries;
drop table if exists public.saved_meals;
drop table if exists public.macro_targets;
drop table if exists public.bodyweight;

drop type if exists public.food_source;

-- Usage rows for a path that no longer exists. Harmless, but they would show
-- up as a fifth kind in anything that reads the table.
delete from public.ai_usage where kind = 'food';
