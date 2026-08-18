-- =============================================================================
-- 0008_dedupe_key.sql — idempotency for notifications that are not the digest.
--
-- The existing guarantee is "one digest per local day", expressed as a unique
-- index on (user_id, kind, local_day). That shape cannot express what
-- escalations need: two exams tomorrow must escalate once EACH, so keying on
-- the day alone would let the first one silently suppress the second.
--
-- A nullable dedupe_key generalises it. Escalations key on day plus event id,
-- so a rescheduled exam escalates again for its new date, and per-item
-- reminders will key on day plus item id when they arrive.
--
-- The scheduler is deliberately dumb and fires every 15 minutes. Every kind of
-- notification therefore needs something that makes re-entry harmless, and it
-- should be the database rather than a check that can be forgotten.
-- =============================================================================

alter table public.delivery_log add column dedupe_key text;

comment on column public.delivery_log.dedupe_key is
  'Identity of a non-digest notification, so the 15-minute scheduler can '
  're-enter its window without sending twice. Null for digests, which are '
  'already unique per local day.';

create unique index delivery_log_dedupe
  on public.delivery_log (user_id, kind, dedupe_key)
  where dedupe_key is not null and status = 'sent';
