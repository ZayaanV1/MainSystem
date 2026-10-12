-- 0036: the account's theme, Today's arrangement, and modules switched off.
--
-- Per account rather than per device, chosen deliberately: a theme and an
-- arrangement are about how a person works, so the phone and the laptop should
-- agree. Light or dark stays per device (localStorage), because the right mode
-- depends on where that screen is.
--
-- Hiding never deletes. today_hidden and modules_off name what is not shown;
-- clearing them brings everything back exactly as it was.

alter table public.app_settings
  add column if not exists theme text
    check (theme is null or theme in ('cloisonne', 'letterpress', 'instrument', 'fjord', 'contrast')),
  -- Null means the default order. Unknown names are ignored by the app, so a
  -- section added later appears in its default place for everyone.
  add column if not exists today_order text[],
  add column if not exists today_hidden text[] not null default '{}',
  add column if not exists modules_off text[] not null default '{}';

-- app_settings is read through a column list (0034), so each new column must
-- be granted or the app cannot see it.
grant select (theme, today_order, today_hidden, modules_off) on public.app_settings to authenticated;
