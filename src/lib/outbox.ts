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

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    },
  });
  return dbPromise;
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
  const count = await (await db()).count(STORE);
  setState({ pending: count });
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
    createdAt: Date.now(),
    attempts: 0,
  };

  await (await db()).put(STORE, entry);
  await refreshCount();

  void flush();
}

/**
 * Replays queued writes oldest-first, stopping at the first failure.
 *
 * Order matters and is preserved: a later edit to a row must not be applied
 * before the insert that created it. Stopping rather than skipping is what
 * guarantees that.
 */
export async function flush(): Promise<void> {
  if (state.syncing) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  setState({ syncing: true });

  try {
    const database = await db();
    const entries = (await database.getAllFromIndex(STORE, 'createdAt')) as OutboxEntry[];

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
  await (await db()).clear(STORE);
  await refreshCount();
  setState({ error: null });
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
