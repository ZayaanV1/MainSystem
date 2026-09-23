import { supabase } from './supabase';

/**
 * Subscribed calendars, from the app's side.
 *
 * The server does the fetching — a browser cannot, since calendar hosts send
 * no CORS headers, and it must not, since the address is a secret that should
 * not have to sit in every device's memory to stay current. What the app
 * adds is TIMING: the server syncs every five minutes regardless, and the app
 * asks for a sync the moment it is opened or brought back to the front, so
 * the calendar is current exactly when someone is looking at it.
 */

export interface CalendarFeed {
  id: string;
  label: string;
  url: string;
  last_synced_at: string | null;
  last_attempt_at: string | null;
  last_status: 'ok' | 'unchanged' | 'error' | null;
  last_error: string | null;
  last_problems: string[];
  /** Counted from the mirrored rows when read — never stored. */
  event_total: number;
  created_at: string;
}

export interface FeedPreviewEvent {
  uid: string;
  title: string;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
}

export type FeedPreview =
  | {
      ok: true;
      url: string;
      name: string | null;
      count: number;
      upcoming: FeedPreviewEvent[];
      problems: string[];
    }
  | { ok: false; reason: string };

async function call(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, reason: 'You are signed out. Sign in and try again.' };

  let res: Response;
  try {
    res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/feeds`, {
      method: 'POST',
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, reason: 'You look to be offline. Try again when you’re connected.' };
  }

  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: `The calendar service answered with an error (${res.status}).` };
  }
}

const reasonOf = (body: Record<string, unknown>) =>
  typeof body.reason === 'string' ? body.reason : 'That didn’t work. Try again.';

export async function loadFeeds(): Promise<{ feeds: CalendarFeed[]; error: string | null }> {
  // `events(count)` is counted by PostgREST from the rows themselves, which is
  // the only count that cannot disagree with what the calendar shows.
  const { data, error } = await supabase
    .from('calendar_feeds')
    .select(
      'id, label, url, last_synced_at, last_attempt_at, last_status, last_error, last_problems, created_at, events(count)',
    )
    .order('created_at', { ascending: true });
  if (error) return { feeds: [], error: error.message };

  type Row = Omit<CalendarFeed, 'event_total'> & { events?: { count: number }[] };
  return {
    feeds: ((data ?? []) as unknown as Row[]).map(({ events, ...f }) => ({
      ...f,
      event_total: events?.[0]?.count ?? 0,
    })),
    error: null,
  };
}

/** Reads the address and reports what it holds. Writes nothing. */
export async function previewFeed(url: string): Promise<FeedPreview> {
  const body = await call({ action: 'preview', url });
  if (body.ok !== true) return { ok: false, reason: reasonOf(body) };
  return body as unknown as FeedPreview;
}

export async function addFeed(url: string, label: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const body = await call({ action: 'add', url, label });
  if (body.ok !== true) return { ok: false, reason: reasonOf(body) };
  announceChange();
  return { ok: true };
}

/**
 * Removes a feed and, by cascade, every event it mirrored.
 *
 * Done directly rather than through the function: it is a plain delete of a
 * row this account owns, which RLS already scopes, and the foreign key does
 * the rest. Unsubscribing that left the events behind would not be
 * unsubscribing — they would sit there going quietly out of date.
 */
export async function removeFeed(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('calendar_feeds').delete().eq('id', id);
  if (!error) announceChange();
  return { error: error?.message ?? null };
}

export async function renameFeed(id: string, label: string): Promise<{ error: string | null }> {
  const trimmed = label.trim().slice(0, 80);
  if (!trimmed) return { error: 'A calendar needs a name.' };
  const { error } = await supabase.from('calendar_feeds').update({ label: trimmed }).eq('id', id);
  if (!error) announceChange();
  return { error: error?.message ?? null };
}

/** An explicit "refresh this one now". Skips the conditional request. */
export async function refreshFeed(id: string): Promise<{ ok: boolean; reason?: string }> {
  const body = await call({ action: 'refresh', id });
  if (body.ok !== true) return { ok: false, reason: reasonOf(body) };
  const changedAt = typeof body.changedAt === 'number' ? body.changedAt : 0;
  if (changedAt > seenChangeAt) {
    seenChangeAt = changedAt;
    announceChange();
  }
  return { ok: true };
}

/* ============================================================================
   Refresh on open
   ========================================================================= */

/**
 * Local throttle, in front of the server's.
 *
 * Switching between apps fires `visibilitychange` constantly, and each one
 * would otherwise be a request. The server enforces its own minute too; this
 * just stops the request being made at all. Per-tab, deliberately: two
 * devices opening the app are two people wanting a fresh calendar.
 */
const LOCAL_THROTTLE_MS = 45_000;
let lastAsked = 0;
let inFlight: Promise<void> | null = null;

/**
 * The newest mirror change this tab has already shown.
 *
 * Starts a minute before the page loaded rather than at zero: anything older
 * than the page is already in what the page loaded, and starting at zero
 * would reload Today once on every open for no reason. The minute is slack
 * for a device clock that runs ahead of the server's — the failure it guards
 * against is a MISSED reload, which is the worse of the two.
 */
let seenChangeAt = Date.now() - 60_000;

/**
 * Asks the server to bring this account's feeds up to date.
 *
 * Fire-and-forget from the caller's side, and never blocking: the screen has
 * already rendered from the database by the time this is called, and rule 1's
 * two seconds are not spent waiting on Google. If anything actually changed,
 * listeners are told and reload in place.
 */
export function syncFeedsNow(): Promise<void> {
  const now = Date.now();
  if (inFlight) return inFlight;
  if (now - lastAsked < LOCAL_THROTTLE_MS) return Promise.resolve();
  lastAsked = now;

  inFlight = (async () => {
    try {
      const body = await call({ action: 'sync' });
      const changedAt = typeof body.changedAt === 'number' ? body.changedAt : 0;
      if (body.ok === true && changedAt > seenChangeAt) {
        seenChangeAt = changedAt;
        announceChange();
      }
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

const listeners = new Set<() => void>();

/**
 * Subscribe to "the mirrored calendar changed".
 *
 * An event rather than a revision bump, and that is not a style choice: the
 * app's revision counter re-MOUNTS Today, which would throw away whatever is
 * half-typed in the capture box. A background sync that erased a thought
 * mid-sentence every few minutes would be worse than no sync at all.
 */
export function onFeedsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announceChange() {
  for (const fn of listeners) fn();
}

/**
 * Keeps the mirror live while the app is actually in front.
 *
 * On open, on return to the front, and every two minutes while visible. The
 * two minutes is what makes "live" true for an app left open on a desk: the
 * cron keeps the database current every five, and this is how an open screen
 * finds out. Nothing runs while the tab is hidden — a background tab polling a
 * calendar nobody is looking at is battery spent on nothing.
 *
 * Returns a cleanup for the caller's effect.
 */
export function keepFeedsLive(): () => void {
  const WHILE_VISIBLE_MS = 2 * 60_000;
  let timer: ReturnType<typeof setInterval> | null = null;

  const start = () => {
    void syncFeedsNow();
    if (!timer) timer = setInterval(() => void syncFeedsNow(), WHILE_VISIBLE_MS);
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop());

  if (document.visibilityState === 'visible') start();
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    stop();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
