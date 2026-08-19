-- =============================================================================
-- 0021_backfill_onboarded.sql — accounts that already started are not new.
--
-- 0020 added onboarded_at as null for everyone, which is correct for accounts
-- created after it and wrong for every account created before: they look like
-- a first run despite already holding a term's work. The owner of this project
-- would have opened the app and been asked to set up courses they added weeks
-- ago.
--
-- Backfilled from evidence rather than from a date. An account with a course, a
-- checklist item or a piece of work has demonstrably been through setup,
-- whatever the flag says — and evidence survives a database being restored,
-- reseeded or migrated in a different order.
--
-- created_at is used as the timestamp, since that is closer to when setup
-- actually happened than now() would be.
-- =============================================================================

update public.app_settings s
   set onboarded_at = coalesce(s.onboarded_at, now())
 where s.onboarded_at is null
   and (
     exists (select 1 from public.courses c where c.user_id = s.user_id)
     or exists (select 1 from public.checklist_items i where i.user_id = s.user_id)
     or exists (select 1 from public.assignments a where a.user_id = s.user_id)
   );
