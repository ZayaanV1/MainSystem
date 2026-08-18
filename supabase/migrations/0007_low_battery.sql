-- =============================================================================
-- 0007_low_battery.sql — what survives a bad day.
--
-- Low-battery mode collapses the day to two or three non-negotiables and hides
-- everything else. On a bad day a full dashboard is a wall of evidence that you
-- are behind, and that is the day the app stops getting opened. It is a
-- survival feature, which is why it ships in Phase 2 rather than Phase 7.
--
-- The app cannot infer what is non-negotiable. Only the person can: medication
-- almost certainly, eating something probably, a shower maybe, a problem set
-- almost certainly not. So it is a flag, set by hand.
--
-- Dose-tracking items are marked essential on the way in, because an item you
-- bothered to count pills for is one you cannot afford to skip. That is a
-- starting position, not a decision — it can be changed like any other.
-- =============================================================================

alter table public.checklist_items
  add column essential boolean not null default false;

comment on column public.checklist_items.essential is
  'Shown in low-battery mode. Everything not marked essential is hidden there, '
  'not deprioritised — hiding is the entire point.';

-- Anything already tracking doses starts essential.
update public.checklist_items set essential = true where tracks_doses;

-- Low-battery mode is already persisted on app_settings.low_battery, so it
-- survives a reinstall. The day you need it is not the day to rediscover a
-- toggle.
comment on column public.app_settings.low_battery is
  'A global visual and content state, not a filter. Server-side so it survives '
  'a reinstall, because the day it is needed is not the day to go looking for it.';
