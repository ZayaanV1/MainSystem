-- 0047: six palette themes, 'oxide', 'static', 'sangria', 'brass', 'bronze'
-- and 'velvet' (26 Oct 2026), each built from a three-colour palette.
--
-- Same shape as 0041: the theme column's check names every theme the app can
-- draw. Widening it touches no rows.

alter table public.app_settings
  drop constraint if exists app_settings_theme_check;

alter table public.app_settings
  add constraint app_settings_theme_check
    check (theme is null or theme in (
      'cloisonne', 'letterpress', 'instrument', 'fjord', 'contrast', 'nothing',
      'arc', 'cupertino', 'field', 'kraft',
      'oxide', 'static', 'sangria', 'brass', 'bronze', 'velvet'
    ));
