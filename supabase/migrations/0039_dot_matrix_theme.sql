-- 0039: a sixth theme, 'nothing' (shown as "Dot matrix").
--
-- The theme column's check names every theme the app can draw, so a new one
-- must be added here or saving it fails with a constraint error. The column
-- was declared with an inline check in 0036, which Postgres names
-- app_settings_theme_check. Widening it touches no rows: every stored value
-- is already in the new list.

alter table public.app_settings
  drop constraint if exists app_settings_theme_check;

alter table public.app_settings
  add constraint app_settings_theme_check
    check (theme is null or theme in ('cloisonne', 'letterpress', 'instrument', 'fjord', 'contrast', 'nothing'));
