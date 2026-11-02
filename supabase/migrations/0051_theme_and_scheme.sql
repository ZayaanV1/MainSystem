-- 0051: the theme and the colour scheme, separated (2 Nov 2026).
--
-- `theme` keeps its name and now holds only the colour scheme. The new `look`
-- column is the theme proper, the material it is drawn in: Glass, Dot matrix
-- or Plain. Null in either is "never chosen", which the app reads as Glass in
-- Dusk (the scheme named 'vision'), so every new account starts on glass.
--
-- An account that chose a scheme keeps exactly what it sees: Dot matrix's old
-- palette stays its scheme under the Dot matrix theme, and every other chosen
-- scheme moves to Plain. Accounts that never chose (theme null, which was also
-- how Cloisonné was saved) start on Glass with everyone else.

alter table public.app_settings
  add column if not exists look text
    check (look is null or look in ('glass', 'dots', 'plain'));

update public.app_settings
   set look = case theme when 'nothing' then 'dots' else 'plain' end
 where theme is not null
   and theme <> 'vision'
   and look is null;

-- app_settings is read through a column list (0034).
grant select (look) on public.app_settings to authenticated;
