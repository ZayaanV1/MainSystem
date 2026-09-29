-- The morning text.
--
-- "morning bro, hope you got some solid rest last night / saw travel at
-- 10:00, then COEN 212 at 11:45 ... / take it block by block, lmk if you need
-- anything" — one text a day, at an hour the account chooses, the same shape
-- every morning on purpose. Off unless turned on (Settings > Abood texts
-- first). Sent by the hourly checkin function; it does not depend on the
-- check-in window or on the last check-in having been answered, because a
-- morning run-down is useful whether or not yesterday's got a reply.

alter table public.app_settings
  add column if not exists abood_morning boolean not null default false,
  add column if not exists abood_morning_hour smallint not null default 9
    check (abood_morning_hour between 0 and 23),
  -- The local day the last one went out, so the hourly tick sends one a day
  -- and a retry inside the catch-up window cannot send two.
  add column if not exists abood_morning_sent_on date;
