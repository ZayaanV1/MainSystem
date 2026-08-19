-- =============================================================================
-- 0018_timezone_unset.sql — let "no timezone chosen yet" be representable.
--
-- app_settings.timezone was NOT NULL DEFAULT 'America/Toronto', which was
-- exactly right when there was one account in that city. As a product it means
-- every new signup is silently placed in Toronto — and because the value is
-- never empty, the client's "fall back to the browser's zone" branch could
-- never fire. A user in Vancouver would get a Toronto day with nothing
-- anywhere reporting a problem.
--
-- Nullable, so the column can say "nobody has chosen". The client detects the
-- browser's zone on first run and writes it back; the scheduler, which has no
-- browser to ask, falls back to UTC rather than to a city it invented.
--
-- Existing rows keep the value they have. This is not a reset.
-- =============================================================================

alter table public.app_settings alter column timezone drop not null;
alter table public.app_settings alter column timezone drop default;

-- The signup trigger inserted only user_id and relied on the default, so it
-- needs no change: new rows now land with timezone null, which is the point.
