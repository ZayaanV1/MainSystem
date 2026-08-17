import { openDB, type IDBPDatabase } from 'idb';
import { supabase } from './supabase';

/**
 * The offline write queue.
 *
 * Rule 5 of this project: never silently lose data. Optimistic UI is fine; a
 * failed sync must be visible and recoverable. So every write goes through
 * here rather than straight to the network — a write made in the metro is
 * durable on disk before the UI claims it succeeded, and replays on reconnect.
 *
 * PHASE 0 SCOPE: this is the mechanism, exercised by one write type
 * (`app_settings` updates). Phase 1 routes assignments, events and checklist
 * completions through the same queue without changing anything here. Building
 * full offline coverage for features that do not exist yet would be work spent
 * on guesses.
 *
 * What this deliberately does NOT do is resolve conflicts. There is one user
 * on a handful of devices; last write wins is correct and anything cleverer
 * would be inventing a problem.
 */

const DB_NAME = 'life-planner';
const STORE = 'outbox';
const DB_VERSION = 1;

export type OutboxOp = 'insert' | 'update' | 'upsert' | 'delete';

export interface OutboxEntry {
  id: string;
  table: string;
  op: OutboxOp;
  payload: Record<string, unknown>;
  /** Column/value pairs identifying the target row, for update and delete. */
  match?: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

/**
 * A strictly increasing timestamp.
 *
 * Date.now() has millisecond resolution, and writes queued in a tight loop —
 * a syllabus import, a burst of taps — routinely land in the same
 * millisecond. The replay index then orders them arbitrarily, which breaks
 * the one guarantee the queue makes: that an edit never reaches the server
 * before the insert that created the row.
 *
 * Nudging forward on collision keeps ordering exact within a session, and a
 * later session's clock is far past anything a previous one produced.
 */
let lastStamp = 0;
function nextStamp(): number {
  const now = Date.now();
  lastStamp = now > lastStamp ? now : lastStamp + 1;
  return lastStamp;
}

let dbPromise: Promise<IDBPDatabase> | null = null;
let storageUnavailable = false;

/**
 * How long to wait for IndexedDB before giving up on it.
 *
 * `indexedDB.open` can hang indefinitely rather than fail: a blocked version
 * upgrade from another tab, storage eviction mid-flight, Safari private
 * browsing. Awaiting that forever means every tap does nothing, reports
 * nothing, and saves nothing — the worst possible reading of rule 5, and it
 * was reproduced in a real browser rather than imagined.
 */
const OPEN_TIMEOUT_MS = 3000;

async function db(): Promise<IDBPDatabase | null> {
  if (storageUnavailable) return null;

  dbPromise ??= Promise.race([
    openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
      },
      blocked: () => setState({ error: 'Another tab is upgrading storage. Close it and retry.' }),
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('IndexedDB did not open')), OPEN_TIMEOUT_MS),
    ),
  ]);

  try {
    return await dbPromise;
  } catch {
    // Degrade rather than hang. Writes still go out, they simply are not
    // durable across a reload — and the user is told, instead of tapping into
    // a void.
    storageUnavailable = true;
    dbPromise = null;
    return null;
  }
}

/* -------------------------------------------------------------- listeners  */

type Listener = (state: OutboxState) => void;

export interface OutboxState {
  pending: number;
  /** Set when the last flush failed. Shown in the UI; never swallowed. */
  error: string | null;
  syncing: boolean;
}

let state: OutboxState = { pending: 0, error: null, syncing: false };
const listeners = new Set<Listener>();

export function subscribeOutbox(fn: Listener): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

function setState(next: Partial<OutboxState>) {
  state = { ...state, ...next };
  for (const fn of listeners) fn(state);
}

async function refreshCount() {
  const database = await db();
  if (!database) return;
  setState({ pending: await database.count(STORE) });
}

/* ------------------------------------------------------------------ queue  */

/**
 * Durably queues a write and starts a flush. Resolves as soon as the write is
 * on disk — not when it reaches the server. The caller updates the UI
 * optimistically; `subscribeOutbox` is how the UI learns if it later failed.
 */
export async function enqueue(
  table: string,
  op: OutboxOp,
  payload: Record<string, unknown>,
  match?: Record<string, unknown>,
): Promise<void> {
  const entry: OutboxEntry = {
    id: crypto.randomUUID(),
    table,
    op,
    payload,
    match,
    createdAt: nextStamp(),
    attempts: 0,
  };

  const database = await db();

  if (!database) {
    // No durable queue. Send straight away and report the outcome — degraded,
    // but never silent, and never a tap that does nothing.
    const error = await apply(entry);
    setState({ error: error ? `Couldn't save. ${error}` : null });
    return;
  }

  await database.put(STORE, entry);
  await refreshCount();

  // Deliberately not awaited. The caller's UI updates optimistically the
  // moment the write is durable on disk; whether it has reached the server yet
  // is the outbox's problem, reported through subscribeOutbox.
  void flush();
}

/**
 * Replays queued writes oldest-first, stopping at the first failure.
 *
 * Order matters and is preserved: a later edit to a row must not be applied
 * before the insert that created it. Stopping rather than skipping is what
 * guarantees that.
 *
 * The outer loop is load-bearing, not defensive tidiness. A single pass reads
 * the queue once, and anything enqueued while that pass is in flight has its
 * own flush() call swallowed by the `syncing` guard below — so those writes
 * would sit on disk forever with no error and no retry. That is exactly what
 * happened importing a syllabus: six rows queued in a tight loop, one written.
 * Re-reading until the queue is genuinely empty closes the window.
 */
let inFlight: Promise<void> | null = null;

export function flush(): Promise<void> {
  // Returning the in-flight promise rather than resolving immediately means
  // `await flush()` actually waits for the queue to drain. The previous
  // version resolved straight away whenever a flush was already running, so a
  // caller could not tell "already done" from "not started".
  if (inFlight) return inFlight;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return Promise.resolve();

  inFlight = drain().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function drain(): Promise<void> {
  setState({ syncing: true });

  try {
    const database = await db();
    if (!database) return; // degraded mode: writes already went out directly

    for (;;) {
      const entries = (await database.getAllFromIndex(STORE, 'createdAt')) as OutboxEntry[];
      if (entries.length === 0) break;

      for (const entry of entries) {
        const error = await apply(entry);

        if (error) {
          entry.attempts += 1;
          entry.lastError = error;
          await database.put(STORE, entry);
          setState({ error: `Couldn't sync. ${error}` });
          return;
        }

        await database.delete(STORE, entry.id);
        await refreshCount();
      }
    }

    setState({ error: null });
  } finally {
    setState({ syncing: false });
  }
}

async function apply(entry: OutboxEntry): Promise<string | null> {
  try {
    const table = supabase.from(entry.table);

    let result;
    switch (entry.op) {
      case 'insert':
        result = await table.insert(entry.payload);
        break;
      case 'upsert':
        result = await table.upsert(entry.payload);
        break;
      case 'update': {
        let q = table.update(entry.payload);
        for (const [k, v] of Object.entries(entry.match ?? {})) q = q.eq(k, v);
        result = await q;
        break;
      }
      case 'delete': {
        let q = table.delete();
        for (const [k, v] of Object.entries(entry.match ?? {})) q = q.eq(k, v);
        result = await q;
        break;
      }
    }

    return result?.error ? result.error.message : null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Discards the queue. Only ever called from an explicit user action. */
export async function clearOutbox(): Promise<void> {
  const database = await db();
  if (database) await database.clear(STORE);
  await refreshCount();
  setState({ error: null, pending: 0 });
}

/* ------------------------------------------------------------ lifecycle    */

let started = false;

/** Flushes on reconnect and when the app is brought back to the foreground. */
export function startOutbox(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  window.addEventListener('online', () => void flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flush();
  });

  void refreshCount().then(() => flush());
}
