-- =============================================================================
-- 0020_onboarding.sql — remember that the first run happened.
--
-- A timestamp rather than a boolean, because "when did this account start" is
-- a question worth being able to answer later and costs nothing to keep now.
--
-- Null means it has not run. It is set when the flow is finished OR skipped:
-- someone who dismissed it has made a choice, and showing it again on the next
-- launch would be the app overruling them.
-- =============================================================================

alter table public.app_settings
  add column if not exists onboarded_at timestamptz;
