/**
 * feeds — keeping subscribed calendars live.
 *
 * Two ways in, one sync underneath:
 *
 *   - pg_cron, every five minutes, with the shared secret: sync every feed
 *     that is due, across every account.
 *   - The app, with a user's JWT: preview an address before subscribing,
 *     subscribe, or refresh this account's feeds now — which the client does
 *     whenever the app is opened or brought back to the front, so the
 *     calendar is current at the moment someone is actually looking at it.
 *
 * The rules this is built around are in the migration (0027): a mirror is a
 * copy the user asked for once, it is read-only in the app, and removing the
 * feed removes it. This file's own rules are about the network — see
 * `fetchFeed` — and about never letting two runs fight over one feed.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { parseFeed, type FeedParse } from '../_shared/feed.ts';
import { botChallengeReason, checkFeedUrl, isBotChallenge, isPrivateAddress } from '../_shared/feedurl.ts';
import {
  courseCodeOf,
  diffMirror,
  duplicatesTracked,
  fingerprintInstances,
  kindOf,
  mirrorInsertRows,
  normaliseCode,
  type MirrorInstance,
  type MirrorRow,
} from '../_shared/feedsync.ts';
import { addDays, todayKey } from '../_shared/time.ts';

const env = (k: string): string => Deno.env.get(k) ?? '';

const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const CRON_SECRET = env('CRON_SECRET');
const APP_URL = env('APP_URL');

/**
 * How far back and forward a mirror reaches.
 *
 * A month back so the current month's grid is complete; six months forward,
 * which covers a term and the start of the next. Bounded because a personal
 * calendar can carry a decade of history, and every mirrored row is a row on
 * a free tier shared by every account.
 */
const DAYS_BACK = 31;
const DAYS_FORWARD = 183;

/** A refresh-on-open more often than this is served from what is already there. */
const USER_THROTTLE_MS = 60_000;
/** The cron fires every five minutes; this keeps an overlapping run from repeating work. */
const CRON_DUE_MS = 4 * 60_000;
/** A feed whose body has not been read for this long is re-read even if it answers 304. */
const FULL_READ_MS = 12 * 60 * 60_000;
/** How long a claimed feed stays claimed if the run holding it dies. */
const LEASE_MS = 90_000;

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
/** Stop starting new syncs after this, so a cron run finishes inside its budget. */
const CRON_BUDGET_MS = 45_000;

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed =
    origin === APP_URL ||
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin) ||
    /^http:\/\/localhost(:\d+)?$/i.test(origin) ||
    /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin);

  return {
    'Access-Control-Allow-Origin': allowed && origin ? origin : APP_URL || '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ============================================================================
   The network
   ========================================================================= */

type Fetched =
  | { kind: 'unchanged' }
  | { kind: 'body'; text: string; etag: string | null; lastModified: string | null }
  | { kind: 'error'; reason: string; retryAfterMs?: number };

/**
 * Whether a hostname resolves only to public addresses.
 *
 * The second half of the forgery defence (the first is in feedurl.ts). A name
 * that looks public can be pointed at 127.0.0.1 or the metadata service, and
 * the only way to know is to ask DNS what it actually points at.
 *
 * If this runtime does not offer DNS resolution at all, the name checks in
 * feedurl.ts still stand on their own; that is reported in the log rather
 * than treated as a failure of every feed. If it does offer it and the answer
 * includes anything private, the fetch does not happen.
 */
async function resolvesPublic(host: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  // deno-lint-ignore no-explicit-any
  const resolve = (Deno as any).resolveDns as
    | ((name: string, type: 'A' | 'AAAA') => Promise<string[]>)
    | undefined;
  if (typeof resolve !== 'function') {
    console.warn('feeds: Deno.resolveDns unavailable; relying on hostname checks only');
    return { ok: true };
  }

  const found: string[] = [];
  for (const type of ['A', 'AAAA'] as const) {
    try {
      found.push(...(await resolve(host, type)));
    } catch {
      // No records of this type is normal — plenty of hosts are IPv4-only.
    }
  }

  if (found.length === 0) return { ok: false, reason: 'Couldn’t find that address. Check it was copied in full.' };
  if (found.some(isPrivateAddress)) {
    return { ok: false, reason: 'That address points somewhere the app isn’t allowed to reach.' };
  }
  return { ok: true };
}

/**
 * Fetches a feed, safely.
 *
 * Redirects are followed BY HAND, and every hop is checked again: an address
 * that passes every check and then redirects to http://169.254.169.254/ is
 * the textbook way around a check that only looks at the first URL. The body
 * is read with a byte cap, so a hostile or broken server cannot hand the
 * function an unbounded response.
 */
async function fetchFeed(
  startUrl: string,
  conditional: { etag: string | null; lastModified: string | null } | null,
): Promise<Fetched> {
  let url = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = checkFeedUrl(url);
    if (!checked.ok) return { kind: 'error', reason: checked.reason };

    const host = new URL(checked.url).hostname;
    const dns = await resolvesPublic(host);
    if (!dns.ok) return { kind: 'error', reason: dns.reason };

    const headers: Record<string, string> = {
      accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1',
      'user-agent': 'Planner calendar sync',
    };
    // Conditional headers only on the first request. They describe the
    // original URL's last response, not whatever a redirect lands on.
    if (hop === 0 && conditional?.etag) headers['if-none-match'] = conditional.etag;
    if (hop === 0 && conditional?.lastModified) headers['if-modified-since'] = conditional.lastModified;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(checked.url, { headers, redirect: 'manual', signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      const aborted = e instanceof Error && e.name === 'AbortError';
      return {
        kind: 'error',
        reason: aborted
          ? 'The calendar’s server took too long to answer. Trying again next time.'
          : 'Couldn’t reach the calendar’s server. Trying again next time.',
      };
    }

    try {
      if (res.status === 304) return { kind: 'unchanged' };

      // Before anything reads the status as success: a firewall's bot check
      // answers 202 with an empty page, which would otherwise be reported as
      // the wrong address having been pasted.
      if (isBotChallenge(res.headers)) {
        return { kind: 'error', reason: botChallengeReason(checked.url) };
      }

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) return { kind: 'error', reason: 'The calendar’s server sent an unusable redirect.' };
        url = new URL(location, checked.url).toString();
        continue;
      }

      /*
       * Rate limited. Verified in production on the day this shipped: Google
       * answered 429 after about a dozen reads of one feed in fifteen minutes.
       * Retrying on the normal five-minute cycle is exactly how a throttle is
       * prolonged — and edge functions share egress addresses, so hammering
       * Google from here is not only this account's problem. So the feed is
       * held until Google's own Retry-After, or ten minutes if it gives none,
       * clamped so a hostile header cannot park a feed for a day.
       */
      if (res.status === 429) {
        const header = res.headers.get('retry-after');
        let wait = 10 * 60_000;
        if (header) {
          const secs = Number(header);
          const at = Date.parse(header);
          if (Number.isFinite(secs)) wait = secs * 1000;
          else if (Number.isFinite(at)) wait = at - Date.now();
        }
        wait = Math.min(Math.max(wait, 2 * 60_000), 60 * 60_000);
        const who = host === 'calendar.google.com' ? 'Google' : 'The calendar’s server';
        return {
          kind: 'error',
          reason: `${who} is limiting how often this calendar can be read. Trying again in about ${Math.round(wait / 60_000)} minutes.`,
          retryAfterMs: wait,
        };
      }

      if ([401, 403, 404, 410].includes(res.status)) {
        return {
          kind: 'error',
          reason:
            'That address no longer works. If you reset it in your calendar’s settings, copy the new one and add it again.',
        };
      }

      if (!res.ok) {
        return {
          kind: 'error',
          reason: `The calendar’s server answered with an error (${res.status}). Trying again next time.`,
        };
      }

      const text = await readCapped(res);
      if (text === null) {
        return { kind: 'error', reason: 'That calendar is too large to read (over 8 MB).' };
      }
      if (!/BEGIN:VCALENDAR/i.test(text)) {
        return {
          kind: 'error',
          reason: 'That address didn’t return a calendar. Check you copied the feed address, not a link to the page.',
        };
      }

      return {
        kind: 'body',
        text,
        etag: res.headers.get('etag'),
        lastModified: res.headers.get('last-modified'),
      };
    } finally {
      clearTimeout(timer);
      // An unread body holds the connection open. Anything not consumed above
      // (a redirect, an error) is released here.
      if (!res.bodyUsed) await res.body?.cancel().catch(() => {});
    }
  }

  return { kind: 'error', reason: 'The calendar’s address redirects too many times.' };
}

/** The body as text, or null if it is larger than MAX_BYTES. */
async function readCapped(res: Response): Promise<string | null> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > MAX_BYTES) return null;

  const reader = res.body?.getReader();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const joined = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    joined.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/* ============================================================================
   The sync
   ========================================================================= */

/** SHA-256 of the body, hex. Native and fast; a 1 MB feed hashes in a few ms. */
async function bodyHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface FeedRow {
  id: string;
  user_id: string;
  url: string;
  etag: string | null;
  last_modified: string | null;
  last_parsed_at: string | null;
  last_body_hash: string | null;
}

interface SyncResult {
  id: string;
  status: 'ok' | 'unchanged' | 'error' | 'busy';
  added?: number;
  updated?: number;
  removed?: number;
  error?: string;
}

function windowFor(zone: string) {
  const today = todayKey(new Date(), zone);
  return { zone, from: addDays(today, -DAYS_BACK), to: addDays(today, DAYS_FORWARD) };
}

/**
 * Claims a feed for this run, or reports that another run holds it.
 *
 * A conditional update is the whole mechanism: it succeeds for exactly one of
 * two racing callers. The claim expires by itself, so a run that dies holding
 * it cannot wedge the feed.
 */
// deno-lint-ignore no-explicit-any
async function claim(admin: any, feedId: string): Promise<boolean> {
  const now = new Date();
  const { data } = await admin
    .from('calendar_feeds')
    .update({ syncing_until: new Date(now.getTime() + LEASE_MS).toISOString() })
    .eq('id', feedId)
    .or(`syncing_until.is.null,syncing_until.lt.${now.toISOString()}`)
    .select('id');
  return Array.isArray(data) && data.length === 1;
}

/**
 * Writes a parsed feed into its mirror.
 *
 * Reads and deletes are scoped by BOTH the feed and the account. The
 * composite foreign key already makes a cross-account row impossible to
 * write; this makes it impossible to act on even if one existed. This process
 * runs as the service role, and service-role code that trusts one guard on a
 * cross-account path is one migration away from a bad day.
 */
// deno-lint-ignore no-explicit-any
async function applyMirror(admin: any, feed: { id: string; user_id: string }, instances: MirrorInstance[]) {
  const { data: existing, error: readError } = await admin
    .from('events')
    .select('id, feed_uid, starts_at, ends_at, title, location, all_day, course_id, kind')
    .eq('feed_id', feed.id)
    .eq('user_id', feed.user_id);
  if (readError) throw new Error(readError.message);

  const diff = diffMirror((existing ?? []) as MirrorRow[], instances);

  // Removals first: they free identity slots an insert may need.
  for (let i = 0; i < diff.remove.length; i += 200) {
    const { error } = await admin
      .from('events')
      .delete()
      .in('id', diff.remove.slice(i, i + 200))
      .eq('feed_id', feed.id)
      .eq('user_id', feed.user_id);
    if (error) throw new Error(error.message);
  }

  const rows = mirrorInsertRows(diff.insert, feed.user_id, feed.id);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from('events').insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }

  for (let i = 0; i < diff.update.length; i += 10) {
    const results = await Promise.all(
      diff.update.slice(i, i + 10).map((u) =>
        admin
          .from('events')
          .update({
            title: u.title,
            location: u.location,
            ends_at: u.ends_at,
            all_day: u.all_day,
            course_id: u.course_id,
            kind: u.kind,
          })
          .eq('id', u.id)
          .eq('feed_id', feed.id)
          .eq('user_id', feed.user_id),
      ),
    );
    const failed = results.find((r: { error: unknown }) => r.error);
    if (failed) throw new Error((failed.error as { message: string }).message);
  }

  return { added: diff.insert.length, updated: diff.update.length, removed: diff.remove.length };
}

/**
 * What each occurrence IS, in terms of this account: its course, whether it is
 * an exam, and whether it is already on screen as something the account owns.
 *
 * Three small reads — courses, dated work and hand-added events in the window
 * — so a mirror of a timetable arrives colour-coded by course, a mirrored
 * midterm gets the night-before reminder every exam gets, and a mirrored
 * "Quiz #3 is due" does not sit next to the "Quiz 3" the account is already
 * tracking. Nothing here creates anything; it only labels and hides copies.
 */
async function enrich(
  // deno-lint-ignore no-explicit-any
  admin: any,
  userId: string,
  parsed: FeedParse,
  win: { from: string; to: string },
): Promise<MirrorInstance[]> {
  const fromIso = new Date(Date.parse(win.from + 'T00:00:00Z') - 86_400_000).toISOString();
  const toIso = new Date(Date.parse(win.to + 'T00:00:00Z') + 2 * 86_400_000).toISOString();

  const [courses, work, owned] = await Promise.all([
    admin.from('courses').select('id, code, name').eq('user_id', userId).eq('archived', false),
    admin
      .from('assignments')
      .select('title, due_at')
      .eq('user_id', userId)
      .gte('due_at', fromIso)
      .lte('due_at', toIso),
    admin
      .from('events')
      .select('title, starts_at')
      .eq('user_id', userId)
      .is('feed_id', null)
      .gte('starts_at', fromIso)
      .lte('starts_at', toIso),
  ]);
  if (courses.error || work.error || owned.error) {
    throw new Error((courses.error ?? work.error ?? owned.error).message);
  }

  const byCode = new Map<string, string>();
  for (const c of (courses.data ?? []) as { id: string; code: string | null; name: string }[]) {
    const code = normaliseCode(c.code) ?? normaliseCode(c.name);
    if (code) byCode.set(code, c.id);
  }

  const tracked = [
    ...((work.data ?? []) as { title: string; due_at: string }[]).map((w) => ({ at: w.due_at, title: w.title })),
    ...((owned.data ?? []) as { title: string; starts_at: string }[]).map((e) => ({ at: e.starts_at, title: e.title })),
  ];

  const out: MirrorInstance[] = [];
  for (const inst of parsed.instances) {
    if (duplicatesTracked(inst, tracked)) continue;
    const code = courseCodeOf(inst.title);
    out.push({ ...inst, courseId: code ? byCode.get(code) ?? null : null, kind: kindOf(inst.title) });
  }
  return out;
}

/** One feed, start to finish. Never throws: failures are recorded on the feed. */
async function syncFeed(
  // deno-lint-ignore no-explicit-any
  admin: any,
  feed: FeedRow,
  zone: string,
  opts: { force: boolean; body?: string; parsed?: FeedParse },
): Promise<SyncResult> {
  if (!(await claim(admin, feed.id))) return { id: feed.id, status: 'busy' };

  const now = new Date();
  const stamp = now.toISOString();

  try {
    let fetched: Fetched;
    if (opts.body !== undefined) {
      fetched = { kind: 'body', text: opts.body, etag: null, lastModified: null };
    } else {
      const staleBody =
        !feed.last_parsed_at || now.getTime() - Date.parse(feed.last_parsed_at) > FULL_READ_MS;
      fetched = await fetchFeed(
        feed.url,
        opts.force || staleBody ? null : { etag: feed.etag, lastModified: feed.last_modified },
      );
    }

    if (fetched.kind === 'error') {
      await admin
        .from('calendar_feeds')
        .update({
          last_attempt_at: stamp,
          last_status: 'error',
          last_error: fetched.reason,
          // The lease doubles as "not before": a rate-limited feed stays
          // claimed until the back-off ends, so neither the cron nor a
          // refresh-on-open touches it early. `claim` already refuses a feed
          // whose lease is in the future; nothing else needed to change.
          syncing_until: fetched.retryAfterMs
            ? new Date(now.getTime() + fetched.retryAfterMs).toISOString()
            : null,
        })
        .eq('id', feed.id);
      return { id: feed.id, status: 'error', error: fetched.reason };
    }

    if (fetched.kind === 'unchanged') {
      await admin
        .from('calendar_feeds')
        .update({
          last_attempt_at: stamp,
          last_synced_at: stamp,
          last_status: 'unchanged',
          last_error: null,
          syncing_until: null,
        })
        .eq('id', feed.id);
      return { id: feed.id, status: 'unchanged' };
    }

    // Reused when the caller already parsed this exact body. Subscribing used
    // to parse twice — once to read the calendar's name, again here — and
    // doubling the most expensive step is how the first sync of a large
    // calendar ran out of CPU and was killed before it wrote anything.
    const parsed = opts.parsed ?? parseFeed(fetched.text, windowFor(zone));

    /*
     * Nothing on the calendar changed: skip the read of every mirrored row,
     * the diff and the writes. The fingerprint is of what was PARSED, not of
     * the bytes — see fingerprintInstances for why the bytes cannot be trusted.
     * A full diff still runs every twelve hours regardless, which repairs the
     * mirror if its rows were ever changed underneath it.
     */
    // Fingerprint what will actually be MIRRORED — after course links and
    // duplicate-hiding — not only what the feed said. Adding a course or a
    // piece of work changes the mirror without the feed changing at all, and a
    // fingerprint of the feed alone would skip exactly that sync.
    const instances = await enrich(admin, feed.user_id, parsed, windowFor(zone));
    const hash = await bodyHash(
      fingerprintInstances(instances, parsed.problems) +
        instances.map((i) => `|${i.courseId ?? ''}|${i.kind}`).join(''),
    );
    const diffedRecently =
      feed.last_parsed_at !== null && now.getTime() - Date.parse(feed.last_parsed_at) < FULL_READ_MS;
    if (!opts.force && hash === feed.last_body_hash && diffedRecently) {
      await admin
        .from('calendar_feeds')
        .update({
          last_attempt_at: stamp,
          last_synced_at: stamp,
          last_status: 'unchanged',
          last_error: null,
          syncing_until: null,
        })
        .eq('id', feed.id);
      return { id: feed.id, status: 'unchanged' };
    }

    const counts = await applyMirror(admin, feed, instances);
    const changed = counts.added + counts.updated + counts.removed > 0;

    await admin
      .from('calendar_feeds')
      .update({
        ...(changed ? { last_changed_at: stamp } : {}),
        last_attempt_at: stamp,
        last_synced_at: stamp,
        last_parsed_at: stamp,
        last_status: 'ok',
        last_error: null,
        last_problems: parsed.problems,
        last_body_hash: hash,
        etag: fetched.etag,
        last_modified: fetched.lastModified,
        syncing_until: null,
      })
      .eq('id', feed.id);

    return { id: feed.id, status: 'ok', ...counts };
  } catch (e) {
    const reason = 'Couldn’t save this calendar’s events. Trying again next time.';
    console.error('feeds: sync failed', feed.id, e);
    await admin
      .from('calendar_feeds')
      .update({ last_attempt_at: stamp, last_status: 'error', last_error: reason, syncing_until: null })
      .eq('id', feed.id);
    return { id: feed.id, status: 'error', error: reason };
  }
}

// deno-lint-ignore no-explicit-any
async function zoneOf(admin: any, userId: string): Promise<string> {
  const { data } = await admin
    .from('app_settings')
    .select('timezone')
    .eq('user_id', userId)
    .maybeSingle();
  // Same fallback as dispatch: UTC rather than a city nobody chose.
  return (data?.timezone as string | null) ?? 'UTC';
}

const FEED_COLUMNS = 'id, user_id, url, etag, last_modified, last_parsed_at, last_body_hash';

/* ============================================================================
   Entry
   ========================================================================= */

Deno.serve(async (req: Request): Promise<Response> => {
  const CORS = corsFor(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...CORS },
    });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- the scheduler -------------------------------------------------------
  const presented = req.headers.get('x-cron-secret') ?? '';
  if (CRON_SECRET && presented && timingSafeEqual(presented, CRON_SECRET)) {
    const started = Date.now();
    const dueBefore = new Date(started - CRON_DUE_MS).toISOString();

    const { data, error } = await admin
      .from('calendar_feeds')
      .select(FEED_COLUMNS)
      .or(`last_attempt_at.is.null,last_attempt_at.lt.${dueBefore}`)
      .order('last_attempt_at', { ascending: true, nullsFirst: true })
      .limit(100);
    if (error) return json({ error: error.message }, 500);

    const zones = new Map<string, string>();
    const results: SyncResult[] = [];

    for (const feed of (data ?? []) as FeedRow[]) {
      // Stop starting new work near the budget; whatever is left is first in
      // line next time, because the query orders by staleness.
      if (Date.now() - started > CRON_BUDGET_MS) break;
      if (!zones.has(feed.user_id)) zones.set(feed.user_id, await zoneOf(admin, feed.user_id));
      results.push(await syncFeed(admin, feed, zones.get(feed.user_id)!, { force: false }));
    }

    return json({ ran: 'scheduled', synced: results.length, results });
  }

  // ---- a signed-in user ------------------------------------------------------
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'not authorised' }, 401);

  const { data: userData, error: userError } = await admin.auth.getUser(authHeader.slice(7));
  if (userError || !userData?.user) return json({ error: 'not authorised' }, 401);
  const userId = userData.user.id;

  let body: { action?: string; url?: string; label?: string; id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: 'The request was not readable.' }, 400);
  }

  const zone = await zoneOf(admin, userId);

  // ---- preview: read it, show what it holds, write nothing ------------------
  if (body.action === 'preview') {
    const checked = checkFeedUrl(body.url ?? '');
    if (!checked.ok) return json({ ok: false, reason: checked.reason });

    const fetched = await fetchFeed(checked.url, null);
    if (fetched.kind !== 'body') {
      return json({ ok: false, reason: fetched.kind === 'error' ? fetched.reason : 'Nothing came back.' });
    }

    const parsed = parseFeed(fetched.text, windowFor(zone));
    const now = Date.now();
    return json({
      ok: true,
      url: checked.url,
      name: parsed.name,
      count: parsed.instances.length,
      upcoming: parsed.instances.filter((i) => Date.parse(i.startsAt) >= now).slice(0, 5),
      problems: parsed.problems,
    });
  }

  // ---- add: subscribe and fill the mirror straight away -----------------------
  if (body.action === 'add') {
    const checked = checkFeedUrl(body.url ?? '');
    if (!checked.ok) return json({ ok: false, reason: checked.reason });

    // Read BEFORE saving, so an address that returns a web page is refused
    // with a reason now rather than saved and failing quietly every five
    // minutes after.
    const fetched = await fetchFeed(checked.url, null);
    if (fetched.kind !== 'body') {
      return json({ ok: false, reason: fetched.kind === 'error' ? fetched.reason : 'Nothing came back.' });
    }

    const parsed = parseFeed(fetched.text, windowFor(zone));
    const label =
      (body.label ?? '').trim().slice(0, 80) ||
      parsed.name?.slice(0, 80) ||
      new URL(checked.url).hostname;

    const { data: feed, error } = await admin
      .from('calendar_feeds')
      .insert({ user_id: userId, url: checked.url, label })
      .select(FEED_COLUMNS)
      .single();

    if (error) {
      if (error.code === '23505') return json({ ok: false, reason: 'That calendar is already added.' });
      if (error.code === '23514') return json({ ok: false, reason: error.message });
      return json({ ok: false, reason: 'Couldn’t save that calendar. Try again.' });
    }

    const result = await syncFeed(admin, feed as FeedRow, zone, {
      force: true,
      body: fetched.text,
      parsed,
    });
    return json({ ok: result.status !== 'error', result, reason: result.error });
  }

  // ---- sync: the app was opened; bring this account's feeds up to date -------
  if (body.action === 'sync' || body.action === 'refresh') {
    let query = admin
      .from('calendar_feeds')
      .select('id, user_id, url, etag, last_modified, last_parsed_at, last_body_hash, last_attempt_at')
      .eq('user_id', userId);
    if (body.action === 'refresh' && body.id) query = query.eq('id', body.id);

    const { data, error } = await query;
    if (error) return json({ ok: false, reason: 'Couldn’t read your calendars.' }, 500);

    const now = Date.now();
    const results: SyncResult[] = [];
    for (const feed of (data ?? []) as (FeedRow & { last_attempt_at: string | null })[]) {
      // Opening the app twice in a minute is not a reason to fetch twice.
      // An explicit "refresh" gets a shorter leash than a passive open.
      const throttle = body.action === 'refresh' ? 15_000 : USER_THROTTLE_MS;
      if (feed.last_attempt_at && now - Date.parse(feed.last_attempt_at) < throttle) continue;
      results.push(await syncFeed(admin, feed, zone, { force: body.action === 'refresh' }));
    }

    /*
     * The latest change across this account's feeds, whoever made it. The app
     * compares this against what it has already loaded, which catches a
     * change the CRON applied while the app sat open — a case where this very
     * call changed nothing and "did anything change just now" would say no.
     */
    const { data: stamps } = await admin
      .from('calendar_feeds')
      .select('last_changed_at')
      .eq('user_id', userId);
    const changedAt = ((stamps ?? []) as { last_changed_at: string | null }[])
      .map((r) => (r.last_changed_at ? Date.parse(r.last_changed_at) : 0))
      .reduce((a, b) => Math.max(a, b), 0);

    return json({ ok: true, changedAt, results });
  }

  return json({ ok: false, reason: 'Unknown action.' }, 400);
});
