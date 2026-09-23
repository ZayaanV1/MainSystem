-- =============================================================================
-- 0027_calendar_feeds.sql — a calendar the app reads on a schedule.
--
-- The app has published an .ics since Phase 7 and, since the timetable
-- importer, could read one — once, from a paste. That importer argued its own
-- case well: "a timetable is set at the start of term and barely moves; a
-- paste is the honest size of the problem."
--
-- That is true of a university timetable and false of the calendar a person
-- actually lives in. A Google Calendar changes daily: a supervisor moves a
-- meeting, a society adds a talk, a shift gets swapped. Re-pasting a feed
-- every time something moves is not a workflow anybody sustains, and a
-- timetable that is quietly a week out of date is worse than no timetable,
-- because it is consulted with confidence.
--
-- WHY A FEED URL AND NOT THE GOOGLE CALENDAR API
--
-- Google Calendar publishes a per-calendar secret address in iCalendar format
-- — Settings, "Secret address in iCal format". It is a plain https URL that
-- returns the same .ics this app already parses.
--
-- The API alternative costs a Google Cloud project, an OAuth consent screen,
-- refresh-token storage and rotation, watch-channel renewal, and — the part
-- that actually decides it — `calendar.readonly` is a sensitive scope. An
-- unverified app is capped at a hundred test users and shows every one of
-- them a screen saying Google has not verified it. This project is
-- "architected for many" by its own charter, so shipping an integration with
-- a hard ceiling at a hundred accounts and a scare screen is the wrong shape.
--
-- The URL costs none of that, and it is not a Google feature: Outlook,
-- Apple Calendar, and essentially every university timetable system publish
-- the same thing. One mechanism, every provider.
--
-- HOW THIS SITS WITH RULE 6 — "never silently write"
--
-- It is a real tension and worth stating rather than stepping around. Rule 6
-- exists so a MODEL never puts a row in the database that a person did not
-- see: AI-parsed food, AI-extracted dates, chatbot actions. The thing being
-- guarded against is a guess presented as a fact.
--
-- A feed is not a guess. It is a copy, and the user confirmed the copying
-- once, by adding the feed. Asking them to approve each event would make a
-- subscription strictly worse than the paste it replaces.
--
-- What keeps it honest is that mirrored events are a separate class and can
-- never be confused with the user's own:
--
--   * they carry `feed_id`, so their origin is always answerable;
--   * the app renders them as read-only — editing one would be editing a
--     local copy that the next sync silently reverts, which is the worst
--     possible behaviour;
--   * deleting the feed deletes them, so unsubscribing actually unsubscribes;
--   * a sync only ever touches rows carrying its own `feed_id`.
--
-- The paste importer stays exactly as it is. It writes ORDINARY events the
-- user owns and edits, which is the right answer for a fixed term timetable
-- and the wrong one for a living calendar. Two mechanisms, two jobs.
-- =============================================================================

create table if not exists public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- What the user calls it. Defaulted from the feed's own X-WR-CALNAME when
  -- it has one, because "Calendar" is not a name you can pick between two of.
  label text not null check (length(trim(label)) > 0),

  -- https only, enforced here because the client is not the only writer and
  -- because this URL is fetched BY THE SERVER. A stored `http://` would make
  -- a secret calendar address travel in clear text; a stored `file://` or
  -- `gopher://` would be asking the platform to do something else entirely.
  url text not null check (
    length(url) <= 2000 and url ~* '^https://[^[:space:]]+$'
  ),

  -- There is deliberately no "paused" state. A mirror that stops updating
  -- but keeps showing its events is a calendar that is quietly wrong, and it
  -- would be consulted with exactly the confidence a live one earns. A feed is
  -- either syncing or removed.

  -- A lease, not a lock. The 5-minute cron and a refresh-on-open can land on
  -- the same feed in the same second; both would compute the same new
  -- instances and the second bulk insert would fail on the identity index,
  -- taking every other new event in that batch down with it. A sync claims
  -- the feed by moving this forward with a conditional update, and a claim
  -- that is never released simply expires, so a crashed run cannot wedge a
  -- feed forever.
  syncing_until timestamptz,

  -- Conditional-request state. A feed that has not changed answers 304 and
  -- costs a few hundred bytes instead of a term of lectures, which is what
  -- makes a frequent refresh affordable on a shared free tier.
  etag text,
  last_modified text,

  -- Observability for a process with no user watching it. Every one of these
  -- is read by something: a subscription that silently stopped working is
  -- the failure this whole feature exists to prevent, so its state is shown.
  --
  --   last_attempt_at   when a sync last RAN, success or not. The throttle and
  --                     the cron's "is this due" both read this, so a feed
  --                     that keeps failing is retried on schedule rather than
  --                     hammered.
  --   last_synced_at    when a sync last SUCCEEDED. What "updated 3 min ago"
  --                     means on screen.
  --   last_parsed_at    when the body was last actually read. A 304 costs
  --                     nothing but tells the sync nothing either — and the
  --                     window it mirrors slides forward every day, so an
  --                     unchanged feed still needs a full read daily for next
  --                     month's occurrences to appear.
  --   last_problems     what the reader could not understand, named. Shown.
  --   last_changed_at   when a sync last actually CHANGED the mirror. An app
  --                     left open compares this against what it has already
  --                     loaded — otherwise a change applied by the cron would
  --                     never reach a screen that was open when it happened.
  last_attempt_at timestamptz,
  last_changed_at timestamptz,
  last_synced_at timestamptz,
  last_parsed_at timestamptz,
  last_status text check (last_status is null or last_status in ('ok', 'unchanged', 'error')),
  last_error text,
  last_problems text[] not null default '{}',

  -- Deliberately NO stored event count. The project's structural guard
  -- forbids `_count` columns, written for streaks, and the reason carries
  -- over: a stored tally is a second answer to a question the rows already
  -- answer, and the two drift. The app counts the mirrored events when it
  -- shows them, which is always right by construction.

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The same calendar twice is two copies of every lecture.
  constraint calendar_feeds_unique_url unique (user_id, url),

  -- The target of the composite foreign key below. `id` is already unique on
  -- its own; this exists so an event can be required to point at a feed
  -- owned by the SAME account.
  constraint calendar_feeds_id_owner unique (id, user_id)
);

-- Every statement below is safe to run twice. A migration that half-applies
-- and cannot be re-run is repaired by hand, in production, under pressure.
drop trigger if exists calendar_feeds_touch on public.calendar_feeds;
create trigger calendar_feeds_touch before update on public.calendar_feeds
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- At most ten feeds per account.
--
-- Every feed is fetched every five minutes from a shared free tier, so the
-- number an account can add is a cost, not only a preference. Enforced in the
-- database because the table is writable through RLS — a limit that lived only
-- in the edge function would be a limit on the polite path.
-- -----------------------------------------------------------------------------
create or replace function private.calendar_feeds_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.calendar_feeds where user_id = new.user_id) >= 10 then
    raise exception 'Ten calendars is the limit. Remove one to add another.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function private.calendar_feeds_cap() from public, anon, authenticated;

drop trigger if exists calendar_feeds_cap on public.calendar_feeds;
create trigger calendar_feeds_cap before insert on public.calendar_feeds
  for each row execute function private.calendar_feeds_cap();

alter table public.calendar_feeds enable row level security;

drop policy if exists "own calendar feeds" on public.calendar_feeds;
create policy "own calendar feeds" on public.calendar_feeds
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- The mirror columns on events.
--
-- `feed_uid` is the VEVENT's own UID. It is what makes a sync a DIFF rather
-- than a delete-and-reinsert: without it, every refresh would drop every event
-- and create new rows with new ids, breaking any reminder pointing at one and
-- making "what changed" unanswerable.
--
-- A recurring VEVENT expands to many instances sharing one UID, so the
-- identity of a mirrored event is (feed, uid, start) rather than (feed, uid).
-- -----------------------------------------------------------------------------
alter table public.events
  add column if not exists feed_id uuid;

-- -----------------------------------------------------------------------------
-- Ownership is enforced by the key itself, not by the sync being careful.
--
-- The sync runs as the service role, which bypasses RLS. If the only link
-- were `feed_id -> calendar_feeds(id)`, any account could stamp ANOTHER
-- account's feed id onto its own events — RLS on events checks user_id, not
-- whose feed the id belongs to — and the next sync of that feed would see
-- rows it did not produce, classify them as stale, and delete them. One
-- account's scheduled job deleting another account's data.
--
-- A composite key makes the forged row impossible to write: (feed_id,
-- user_id) must match a feed that user actually owns. The sync ALSO scopes
-- every read and delete by user_id, because two independent guards on a
-- cross-account path is the right number.
-- -----------------------------------------------------------------------------
alter table public.events
  drop constraint if exists events_feed_owner_fk;
alter table public.events
  add constraint events_feed_owner_fk
  foreign key (feed_id, user_id)
  references public.calendar_feeds(id, user_id)
  on delete cascade;

alter table public.events
  add column if not exists feed_uid text;

create unique index if not exists events_feed_identity_idx
  on public.events (feed_id, feed_uid, starts_at)
  where feed_id is not null;

-- The sync's own working query: "every event this feed currently owns".
create index if not exists events_feed_idx
  on public.events (feed_id)
  where feed_id is not null;

-- The cron's working query: "which feeds are due".
create index if not exists calendar_feeds_due_idx
  on public.calendar_feeds (last_attempt_at nulls first);

comment on table public.calendar_feeds is
  'A subscribed iCalendar URL — a Google/Outlook secret address or a '
  'university timetable. Events it produces carry events.feed_id, are '
  'read-only in the app, and are removed when the feed is.';

comment on column public.events.feed_id is
  'Set when this event is mirrored from a subscribed feed rather than created '
  'by the user. Mirrored events are read-only: an edit would be reverted by '
  'the next sync.';

-- -----------------------------------------------------------------------------
-- The schedule: every five minutes.
--
-- Five rather than the digest's fifteen because the requirement is that the
-- calendar is live, and five minutes is the interval at which "live" stops
-- being noticeably false for a calendar. The cost is bounded twice over: a
-- feed that has not changed answers a conditional request with a 304 and no
-- body, and the function itself skips any feed synced in the last four
-- minutes, so an overlap between this and a refresh-on-open is free.
--
-- The URL is DERIVED from the dispatch URL already in Vault, and the secret
-- is the same one. An install that already delivers a morning digest gets
-- live calendars with no further configuration, and one that does not yet
-- gets a tick that does nothing quietly — the same rule dispatch_tick follows.
-- -----------------------------------------------------------------------------
create or replace function private.feeds_tick()
returns void
language plpgsql
security definer
set search_path = private, public, vault, net
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'dispatch_url' limit 1;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret' limit 1;

  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url     := replace(v_url, '/functions/v1/dispatch', '/functions/v1/feeds'),
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'x-cron-secret', v_secret
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function private.feeds_tick() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('life-planner-feeds');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'life-planner-feeds',
  '*/5 * * * *',
  $$select private.feeds_tick()$$
);
