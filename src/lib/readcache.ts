import { openDB, type IDBPDatabase } from 'idb';

/**
 * The last good copy of a screen, so the app opens on the subway.
 *
 * The outbox has always made WRITES durable — a thought captured in a tunnel
 * survives the reload. Reads had nothing. Opening the app with no connection
 * meant every query returned an error, which until recently rendered as
 * "Nothing due." and now renders as a load-failure banner over an empty
 * screen. Better, and still not the answer: the honest answer is the day you
 * saw an hour ago.
 *
 * WHY THIS IS A SEPARATE DATABASE FROM THE OUTBOX
 *
 * Different durability contracts, and conflating them would weaken the
 * stronger one. Outbox entries are the only copy of something the user typed
 * and must never be evicted to make room. These are a convenience copy of
 * data the server already holds, and throwing them away costs nothing. Sharing
 * a store would mean a cache eviction could take unsent writes with it.
 *
 * WHAT IS NEVER CACHED
 *
 * Anything a stale answer would make dangerous. The chatbot's replies are not
 * cached: a model's answer about "what is due today" that is a day old is the
 * confidently-wrong-deadline failure with a longer fuse. Nor is the AI daily
 * summary, for the same reason — it is prose asserting facts about a specific
 * day.
 */

const DB_NAME = 'life-planner-cache';
const DB_VERSION = 1;
const STORE = 'screens';

/**
 * How old a cached screen may be before it is not worth showing.
 *
 * Twelve hours rather than a day, because the cache key is a local day and a
 * copy older than this is likely to be from before something important
 * changed. Past this the app prefers an honest empty state to a plausible
 * wrong one.
 */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Same reasoning as the outbox: `open` can hang forever rather than fail. */
const OPEN_TIMEOUT_MS = 3000;

let dbPromise: Promise<IDBPDatabase> | null = null;
let unavailable = false;

async function db(): Promise<IDBPDatabase | null> {
  if (unavailable) return null;

  dbPromise ??= Promise.race([
    openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: 'key' });
        }
      },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('cache did not open')), OPEN_TIMEOUT_MS),
    ),
  ]);

  try {
    return await dbPromise;
  } catch {
    // A cache that cannot open is not an error worth showing anyone. The app
    // simply behaves as it did before this file existed.
    unavailable = true;
    dbPromise = null;
    return null;
  }
}

interface Cached<T> {
  key: string;
  at: number;
  value: T;
}

export interface CacheHit<T> {
  value: T;
  /** When it was stored. The UI says this out loud rather than implying fresh. */
  at: number;
}

/**
 * Stores a screen's data under a key that includes the local day.
 *
 * The day matters: a cached "today" from yesterday is not a stale copy of
 * today, it is a copy of a different day, and serving it would silently
 * present last night's deadlines as this morning's.
 */
export async function putCache<T>(key: string, value: T): Promise<void> {
  const database = await db();
  if (!database) return;
  try {
    await database.put(STORE, { key, at: Date.now(), value } satisfies Cached<T>);
  } catch {
    // Quota, private mode, eviction mid-write. None of these are worth
    // interrupting anyone over — the live path is unaffected.
  }
}

export async function getCache<T>(key: string): Promise<CacheHit<T> | null> {
  const database = await db();
  if (!database) return null;
  try {
    const row = (await database.get(STORE, key)) as Cached<T> | undefined;
    if (!row) return null;
    if (Date.now() - row.at > MAX_AGE_MS) return null;
    return { value: row.value, at: row.at };
  } catch {
    return null;
  }
}

/**
 * Drops everything. Called on sign-out.
 *
 * A cache that outlived its session would show one account's day to whoever
 * signed in next on the same device, which is a data-crossing bug wearing the
 * costume of a performance feature.
 */
export async function clearCache(): Promise<void> {
  const database = await db();
  if (!database) return;
  try {
    await database.clear(STORE);
  } catch {
    /* nothing to do and nothing worth saying */
  }
}

/** "3 minutes ago", for the banner. Never a bare timestamp. */
export function ageLabel(at: number, now: number = Date.now()): string {
  const mins = Math.floor((now - at) / 60_000);
  if (mins < 1) return 'a moment ago';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return '1 hour ago';
  return `${hours} hours ago`;
}
