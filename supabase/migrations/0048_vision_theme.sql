-- 0048: the Vision theme (29 Oct 2026), frosted glass over a room at dusk,
-- with a dock and a dashboard on a desk-wide screen.
--
-- Same shape as 0041 and 0047: the theme column's check names every theme the
-- app can draw. Widening it touches no rows.

alter table public.app_settings
  drop constraint if exists app_settings_theme_check;

alter table public.app_settings
  add constraint app_settings_theme_check
    check (theme is null or theme in (
      'cloisonne', 'letterpress', 'instrument', 'fjord', 'contrast', 'nothing',
      'arc', 'cupertino', 'field', 'kraft',
      'oxide', 'static', 'sangria', 'brass', 'bronze', 'velvet',
      'vision'
    ));

-- Vision's own photo, when the account chose one: a path in the board-photos
-- bucket, inside the account's own folder (the bucket's access rule). Null is
-- the bundled photo.
alter table public.app_settings
  add column if not exists backdrop text
    check (backdrop is null or (length(backdrop) <= 200 and backdrop ~ '^[0-9a-f-]{36}/'));

-- app_settings is read through a column list (0034), so the new column must
-- be granted or the app cannot see it.
grant select (backdrop) on public.app_settings to authenticated;
