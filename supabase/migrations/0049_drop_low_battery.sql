-- 0049: low-battery mode is gone (29 Oct 2026), removed at the owner's request
-- along with its screen, its menu item and its module switch. The column that
-- held whether it was on has nothing left to read it.
--
-- Apply only once the build without it is live: the build before reads it on
-- every open of Today, and would fail that read until it was replaced.

alter table public.app_settings drop column if exists low_battery;
