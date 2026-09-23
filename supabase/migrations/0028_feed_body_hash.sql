-- =============================================================================
-- 0028_feed_body_hash.sql — knowing a feed has not changed, without asking it.
--
-- 0027 built the cheap path for an unchanged feed on conditional requests: send
-- the last ETag, get a 304 with no body. Verified against a real Google feed on
-- the day it shipped, that path never fires for Google — Google Calendar
-- publishes neither an ETag nor a Last-Modified header, so every five-minute
-- sync downloaded the whole calendar, parsed it, read back every mirrored row,
-- and diffed them, to discover that nothing had moved.
--
-- A hash of the body answers the same question on our side. If the bytes are
-- identical to the last ones read, nothing in them can have changed, and the
-- parse, the database read and the diff are all skipped. That is the common
-- case for any calendar, every five minutes.
--
-- It does not skip forever. The mirror covers a window of days that slides
-- forward daily, so an unchanged feed is still read in full every twelve hours
-- (last_parsed_at) for next month's occurrences to appear.
-- =============================================================================

alter table public.calendar_feeds
  add column if not exists last_body_hash text;

comment on column public.calendar_feeds.last_body_hash is
  'SHA-256 of the feed body at the last full read. Google sends no ETag, so '
  'this is how an unchanged feed is recognised without parsing it.';
