-- =============================================================================
-- 0009_reminders.sql — optional per-item reminders, separate from the digest.
--
-- The digest answers "what does today look like" once, in the morning. A
-- reminder answers "now" — medication at 08:00, a deadline at 16:00 on the day
-- it is due. Different jobs, so different notifications.
--
-- Two shapes, because the two things being reminded about are not alike:
--
--   A checklist item repeats, so it stores a local wall-clock TIME and fires on
--   every day the item is due — and only while it is still outstanding. A
--   reminder for something already done is pure nagging, and nagging is how a
--   notification channel becomes one you swipe away without reading.
--
--   An assignment happens once, so it stores a single instant.
--
-- Both are nullable and both default to nothing. A reminder you did not ask for
-- is an interruption.
-- =============================================================================

alter table public.checklist_items
  add column remind_at time;

comment on column public.checklist_items.remind_at is
  'Local wall-clock time to send a reminder on days this item is due and still '
  'outstanding. Null means no reminder. Stored as a time, not a timestamp, so '
  '08:00 stays 08:00 across both DST transitions.';

alter table public.assignments
  add column remind_at timestamptz;

comment on column public.assignments.remind_at is
  'A single instant to send one reminder. Null means no reminder. Cleared '
  'implicitly by the dedupe key changing if the time is edited, so a moved '
  'reminder arms again rather than being silently spent.';

create index assignments_reminder_idx on public.assignments (user_id, remind_at)
  where remind_at is not null and status <> 'done';
