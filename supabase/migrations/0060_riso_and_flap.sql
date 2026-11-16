-- 0060: two more themes, Risograph and Split-flap (16 Nov 2026).
--
-- `look` (0051) is checked against the themes that exist. Until this runs, an
-- account choosing either new theme keeps it on that device only, and the app
-- says the save failed.

alter table public.app_settings drop constraint if exists app_settings_look_check;
alter table public.app_settings
  add constraint app_settings_look_check
    check (look is null or look in ('glass', 'dots', 'riso', 'flap', 'plain'));
