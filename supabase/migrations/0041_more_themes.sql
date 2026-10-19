-- 0041: four more themes, 'arc', 'cupertino', 'field' and 'kraft' (19 Oct 2026),
-- the four kept from the Ten Themes prototype's eight candidates.
--
-- Same shape as 0039: the theme column's check names every theme the app can
-- draw, so saving a new one fails with a constraint error until it is listed
-- here. Widening the check touches no rows, because every stored value is
-- already in the new list.

alter table public.app_settings
  drop constraint if exists app_settings_theme_check;

alter table public.app_settings
  add constraint app_settings_theme_check
    check (theme is null or theme in (
      'cloisonne', 'letterpress', 'instrument', 'fjord', 'contrast', 'nothing',
      'arc', 'cupertino', 'field', 'kraft'
    ));
