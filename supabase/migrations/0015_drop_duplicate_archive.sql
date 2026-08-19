-- =============================================================================
-- 0015_drop_duplicate_archive.sql — undo a column that already existed.
--
-- 0014 added courses.archived_at without checking that 0003 had already added
-- courses.archived, along with a partial index on it and a filter in the app's
-- own course query.
--
-- Two columns for one fact is how a fact ends up with two answers. The boolean
-- is the one everything already reads, so the newer column goes rather than
-- the older one — a rename would have meant touching a working query and a
-- working index to no benefit.
--
-- Nothing was ever written to archived_at, so there is no data to migrate.
-- =============================================================================

drop index if exists public.courses_active;
alter table public.courses drop column if exists archived_at;
