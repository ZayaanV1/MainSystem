import { openDB, type IDBPDatabase } from 'idb';
import { supabase } from './supabase';
import { formatDay } from './time';

/**
 * The offline write queue.
 *
 * Rule 5 of this project: never silently lose data. Optimistic UI is fine; a
 * failed sync must be visible and recoverable. So every write goes through
 * here rather than straight to the network — a write made in the metro is
 * durable on disk before the UI claims it succeeded, and replays on reconnect.
 *
 * What this deliberately does NOT do is resolve conflicts. Last write wins is
 * correct for one person on a handful of devices, and anything cleverer would
 * be inventing a problem.
 *
 * TWO KINDS OF FAILURE, Oct 2026
 *
 * The queue used to stop at the first error and retry that same write for
 * ever. That is right for a dropped connection and fatal for a write that can
 * never succeed — a unique key, a foreign key to a row deleted on another
 * device. One of those sat at the head of the queue and every tick and capture
 * behind it stayed optimistic on screen, never reached the server, and
 * vanished on the next reload, with no button anywhere to get out. Normal use
 * produced one: the same checklist item ticked on two devices.
 *
 * So failures are now classified. A transient one (offline, a 5xx, an expired
 * token) stops the queue and retries on a backing-off timer, because order
 * matters and the next attempt will probably work. A permanent one is moved
 * aside into its own store, together with anything that depended on it, and
 * the queue keeps draining. What was moved aside is shown in plain words with
 * Try again and Discard, so it is visible AND recoverable rather than either
 * blocking everything or disappearing.
 *
 * A duplicate of something that already exists counts as done: every insert
 * now carries an id made on the device, so a retry after a lost response
 * collides with its own earlier success rather than writing a second row.
 */

const DB_NAME = 'life-planner';
const STORE = 'outbox';
const FAILED = 'failed';
const DB_VERSION = 2;

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
  /**
   * The account that queued it.
   *
   * A shared laptop that signs one account out and another in must never
   * replay the first account's writes as the second — and must never show
   * the second the first one's captured thoughts in a list of failed changes.
   */
  owner?: string | null;
}

/** A write the server refused for good, kept until it is retried or discarded. */
export interface FailedEntry extends OutboxEntry {
  failedAt: number;
  /** What went wrong, in the user's words. */
  reason: string;
}

/**
 * A write the screen should already show.
 *
 * Pending ones have `appliedAt` null. Recently applied ones are kept for a
 * short while with the time they landed, so a screen whose data was read
 * BEFORE they landed can keep showing them until its next reload — otherwise a
 * tick would flash back off in the gap between reaching the server and the
 * screen re-reading it.
 */
export interface PendingWrite {
  entry: OutboxEntry;
  appliedAt: number | null;
}

/** Tables whose primary key is a uuid the device can make up front. */
const TABLES_WITH_ID = new Set([
  'inbox_items',
  'assignments',
  'events',
  'deferrals',
  'subtasks',
  'checklist_items',
  'checklist_completions',
  'courses',
]);

/** How long an applied write stays in the optimistic layer. */
const APPLIED_KEEP_MS = 120_000;

/** Backing-off retry after a transient failure. */
const RETRY_STEPS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

/**
 * A strictly increasing timestamp.
 *
 * Date.now() has millisecond resolution, and writes queued in a tight loop —
 * a syllabus import, a burst of taps — routinely land in the same
 * millisecond. The replay index then orders them arbitrarily, which breaks
 * the one guarantee the queue makes: that an edit never reaches the server
 * before the insert that created the row.
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
 * nothing, and saves nothing.
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
        // Version 2 adds the store for writes the server refused for good.
        // Version 1's queue is untouched by the upgrade.
        if (!database.objectStoreNames.contains(FAILED)) {
          database.createObjectStore(FAILED, { keyPath: 'id' });
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

/* ---------------------------------------------------------------- owner --- */

let owner: string | null = null;

/** Called by the shell once the session is known, and with null on sign-out. */
export function setOutboxOwner(userId: string | null): Promise<void> {
  if (owner === userId) return Promise.resolve();
  owner = userId;
  return refresh();
}

const mine = (e: OutboxEntry) => e.owner == null || owner == null || e.owner === owner;

/* -------------------------------------------------------------- listeners  */

type Listener = (state: OutboxState) => void;

export interface OutboxState {
  pending: number;
  /** Set when the last flush hit a transient failure. Shown in the UI; never swallowed. */
  error: string | null;
  syncing: boolean;
  /** Writes the server refused for good, oldest first. */
  failed: FailedEntry[];
  /** Everything the screen should already be showing. See PendingWrite. */
  writes: PendingWrite[];
}

let state: OutboxState = { pending: 0, error: null, syncing: false, failed: [], writes: [] };
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

/** The queue as last read from disk, oldest first. */
let queue: OutboxEntry[] = [];
/** Writes that reached the server in the last couple of minutes. */
let applied: { entry: OutboxEntry; appliedAt: number }[] = [];

function writes(): PendingWrite[] {
  const cutoff = Date.now() - APPLIED_KEEP_MS;
  applied = applied.filter((a) => a.appliedAt >= cutoff);
  return [
    ...applied.filter((a) => mine(a.entry)).map((a) => ({ entry: a.entry, appliedAt: a.appliedAt })),
    ...queue.filter(mine).map((entry) => ({ entry, appliedAt: null })),
  ];
}

async function refresh(): Promise<void> {
  const database = await db();
  if (database) {
    queue = (await database.getAllFromIndex(STORE, 'createdAt')) as OutboxEntry[];
    const failed = ((await database.getAll(FAILED)) as FailedEntry[])
      .filter(mine)
      .sort((a, b) => a.createdAt - b.createdAt);
    setState({ pending: queue.filter(mine).length, failed, writes: writes() });
  } else {
    setState({ writes: writes() });
  }
}

function noteApplied(entry: OutboxEntry) {
  applied.push({ entry, appliedAt: Date.now() });
}

/* -------------------------------------------------------- classification  */

export type Verdict = 'ok' | 'already' | 'transient' | 'permanent';

interface WriteError {
  message?: string;
  code?: string;
}

/**
 * What a write's result means for the queue.
 *
 * Errors with no code are a network failure, a timeout or a 5xx, and are worth
 * retrying. Postgres classes 22 (bad data) and 23 (integrity) and PostgREST's
 * request and schema errors will fail identically every time. An expired token
 * (PGRST3xx) refreshes on its own and is transient.
 */
export function classify(op: OutboxOp, error: WriteError | null | undefined): Verdict {
  if (!error) return 'ok';
  const code = error.code ?? '';

  // The row is already there: a retried insert colliding with its own earlier
  // success, or a tick that another device already made. Either way the state
  // the write asked for is the state the server has.
  if (code === '23505' && op === 'insert') return 'already';

  if (/^2[23]/.test(code)) return 'permanent';
  if (/^42/.test(code)) return 'permanent';
  if (/^PGRST[12]/.test(code)) return 'permanent';
  return 'transient';
}

/** The refusal, in words a person can act on. */
export function reasonFor(op: OutboxOp, error: WriteError): string {
  const code = error.code ?? '';
  if (code === '23505') return 'Something with the same name already exists.';
  if (code === '23503') return 'What it belongs to no longer exists, probably removed on another device.';
  if (code === '42501') return 'This account is not allowed to make that change.';
  if (/^2[23]/.test(code)) return 'The server refused one of the values.';
  if (/^(42|PGRST2)/.test(code)) return 'The app and the server disagree about this change. Reload the app and try again.';
  void op;
  return error.message || 'The server refused it.';
}

/** A queued change, described the way the person would describe doing it. */
export function describeWrite(entry: OutboxEntry): string {
  const p = entry.payload;
  const quote = (v: unknown) => {
    const s = String(v ?? '').trim();
    return s.length > 60 ? `“${s.slice(0, 59)}…”` : `“${s}”`;
  };
  const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDay(v) : 'a day');

  switch (entry.table) {
    case 'inbox_items':
      if (entry.op === 'insert') return `Capturing ${quote(p.body)}`;
      if (p.triaged_at) return 'Sorting an inbox item into work';
      if (p.dismissed_at) return 'Dismissing an inbox item';
      return 'Changing an inbox item';
    case 'assignments':
      if (entry.op === 'insert') return `Adding ${quote(p.title)}`;
      if (entry.op === 'delete') return 'Deleting a piece of work';
      if (p.status === 'done') return 'Marking work done';
      if (p.status === 'todo') return 'Reopening a piece of work';
      if ('title' in p) return `Editing ${quote(p.title)}`;
      if ('due_at' in p) return 'Moving a deadline';
      return 'Changing a piece of work';
    case 'checklist_completions':
      return entry.op === 'delete'
        ? `Unticking an item for ${day(entry.match?.local_day)}`
        : `Ticking an item for ${day(p.local_day)}`;
    case 'checklist_items':
      if (entry.op === 'insert') return `Adding ${quote(p.title)} to the checklist`;
      if (p.active === false) return 'Removing a checklist item';
      if (p.active === true) return 'Restoring a checklist item';
      return 'Editing a checklist item';
    case 'courses':
      if (entry.op === 'insert') return `Adding the course ${quote(p.code || p.name)}`;
      if (p.archived === true) return 'Archiving a course';
      if (p.archived === false) return 'Restoring a course';
      return 'Changing a course';
    case 'subtasks':
      if (entry.op === 'insert') return `Adding the step ${quote(p.title)}`;
      if (entry.op === 'delete') return 'Removing a step';
      return 'Ticking a step';
    case 'deferrals':
      return 'Recording a move to another day';
    case 'events':
      if (entry.op === 'insert') return `Adding ${quote(p.title)} to the calendar`;
      if (entry.op === 'delete') return 'Removing a calendar entry';
      return 'Changing a calendar entry';
    default:
      return 'Saving a change';
  }
}

/* ------------------------------------------------------------------ queue  */

/**
 * Durably queues a write and starts a flush. Resolves as soon as the write is
 * on disk — not when it reaches the server. The caller's screen shows it at
 * once through the optimistic layer; `subscribeOutbox` is how the UI learns if
 * it later failed.
 */
export async function enqueue(
  table: string,
  op: OutboxOp,
  payload: Record<string, unknown>,
  match?: Record<string, unknown>,
): Promise<OutboxEntry> {
  // An id made here makes the insert idempotent: replayed after a response
  // that never arrived, it collides with itself instead of duplicating.
  const body =
    op === 'insert' && TABLES_WITH_ID.has(table) && !('id' in payload)
      ? { id: crypto.randomUUID(), ...payload }
      : payload;

  const entry: OutboxEntry = {
    id: crypto.randomUUID(),
    table,
    op,
    payload: body,
    match,
    createdAt: nextStamp(),
    attempts: 0,
    owner,
  };

  const database = await db();

  if (!database) {
    // No durable queue. Send straight away and report the outcome — degraded,
    // but never silent, and never a tap that does nothing.
    const result = await apply(entry);
    const verdict = classify(op, result);
    if (verdict === 'ok' || verdict === 'already') {
      noteApplied(entry);
      setState({ error: null, writes: writes() });
    } else {
      setState({ error: `Couldn't save. ${result?.message ?? 'The server refused it.'}` });
    }
    return entry;
  }

  await database.put(STORE, entry);
  await refresh();

  // Deliberately not awaited. The caller's UI updates optimistically the
  // moment the write is durable on disk; whether it has reached the server yet
  // is the outbox's problem, reported through subscribeOutbox.
  void flush();
  return entry;
}

/**
 * Replays queued writes oldest-first.
 *
 * Order matters and is preserved: a transient failure stops the queue rather
 * than skipping past it, so a later edit can never land before the insert that
 * created its row. A permanent failure is moved aside with its dependents and
 * the queue carries on.
 *
 * The outer loop is load-bearing: anything enqueued while a pass is in flight
 * has its own flush() swallowed by the in-flight guard, so the queue is
 * re-read until it is genuinely empty.
 */
let inFlight: Promise<void> | null = null;

export function flush(): Promise<void> {
  if (inFlight) return inFlight;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return Promise.resolve();

  // One tab drains at a time. Two tabs replaying the same queue would each
  // send every write — harmless now that inserts are idempotent, but wasteful,
  // and an update interleaved between them could land twice out of order.
  const locks = typeof navigator !== 'undefined'
    ? (navigator as Navigator & { locks?: LockManager }).locks
    : undefined;
  const run = locks?.request
    ? locks.request('life-planner-outbox', () => drain())
    : drain();

  inFlight = Promise.resolve(run).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function signedIn(): Promise<boolean> {
  // Tests stand up a client with no auth half; treat that as signed in.
  const auth = (supabase as { auth?: { getSession?: () => Promise<{ data: { session: unknown } }> } }).auth;
  if (!auth?.getSession) return true;
  try {
    const { data } = await auth.getSession();
    return Boolean(data.session);
  } catch {
    return true;
  }
}

async function drain(): Promise<void> {
  setState({ syncing: true });

  try {
    const database = await db();
    if (!database) return; // degraded mode: writes already went out directly

    // Signed out, every write would come back as a permission error and be
    // set aside as permanent. Wait for a session instead.
    if (!(await signedIn())) return;

    for (;;) {
      const entries = ((await database.getAllFromIndex(STORE, 'createdAt')) as OutboxEntry[]).filter(mine);
      if (entries.length === 0) break;

      const aside = new Set<string>();

      for (const entry of entries) {
        if (aside.has(entry.id)) continue;

        const result = await apply(entry);
        const verdict = classify(entry.op, result);

        if (verdict === 'transient') {
          entry.attempts += 1;
          entry.lastError = result?.message ?? 'unknown error';
          await database.put(STORE, entry);
          await refresh();
          setState({ error: `Couldn't sync. ${entry.lastError}` });
          scheduleRetry();
          return;
        }

        if (verdict === 'permanent') {
          const reason = reasonFor(entry.op, result ?? {});
          const dependents = dependentsOf(entry, entries);
          for (const e of [entry, ...dependents]) {
            const failed: FailedEntry = {
              ...e,
              attempts: e.attempts + 1,
              lastError: e === entry ? result?.message : 'Depends on a change that could not be saved.',
              failedAt: Date.now(),
              reason: e === entry ? reason : 'It depends on a change that could not be saved.',
            };
            await database.put(FAILED, failed);
            await database.delete(STORE, e.id);
            aside.add(e.id);
          }
          await refresh();
          continue;
        }

        noteApplied(entry);
        await database.delete(STORE, entry.id);
        await refresh();
      }
    }

    retryStep = 0;
    setState({ error: null });
  } finally {
    setState({ syncing: false, writes: writes() });
  }
}

/**
 * Later writes that cannot succeed once this one has failed.
 *
 * Only an insert has dependents: if the row was never created, an edit to it,
 * a step under it or a deferral of it would reach the server and do nothing
 * (or fail on the foreign key), so they wait beside it rather than being
 * applied out of context. A failed update or delete leaves the row in place,
 * and later changes to it are still meaningful.
 */
function dependentsOf(failed: OutboxEntry, entries: OutboxEntry[]): OutboxEntry[] {
  if (failed.op !== 'insert') return [];
  const target = failed.payload.id;
  if (typeof target !== 'string') return [];
  return entries.filter(
    (e) =>
      e.createdAt > failed.createdAt &&
      (Object.values(e.payload).includes(target) || Object.values(e.match ?? {}).includes(target)),
  );
}

async function apply(entry: OutboxEntry): Promise<WriteError | null> {
  try {
    const table = supabase.from(entry.table);

    let result: { error: WriteError | null } | undefined;
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

    return result?.error ?? null;
  } catch (e) {
    return { message: (e as Error).message };
  }
}

/* ---------------------------------------------------------------- retry  */

let retryStep = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRetry() {
  if (retryTimer) return;
  const delay = RETRY_STEPS_MS[Math.min(retryStep, RETRY_STEPS_MS.length - 1)];
  retryStep += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flush();
  }, delay);
}

function cancelRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryStep = 0;
}

/** Retry now, from a button. Resets the back-off. */
export function retryNow(): Promise<void> {
  cancelRetry();
  return flush();
}

/**
 * Puts set-aside writes back on the queue, in their original order.
 *
 * Re-stamped after everything already queued, so a retried insert still lands
 * before the edits that were set aside with it.
 */
export async function retryFailed(ids?: string[]): Promise<void> {
  const database = await db();
  if (!database) return;
  const failed = ((await database.getAll(FAILED)) as FailedEntry[])
    .filter(mine)
    .filter((f) => !ids || ids.includes(f.id))
    .sort((a, b) => a.createdAt - b.createdAt);

  for (const f of failed) {
    const { failedAt: _f, reason: _r, ...entry } = f;
    await database.put(STORE, { ...entry, createdAt: nextStamp() });
    await database.delete(FAILED, f.id);
  }
  await refresh();
  void retryNow();
}

/** Drops one set-aside write for good. Only ever called from an explicit tap. */
export async function discardFailed(id: string): Promise<void> {
  const database = await db();
  if (!database) return;
  await database.delete(FAILED, id);
  await refresh();
}

/** Discards the queue and everything set aside. Tests and explicit resets only. */
export async function clearOutbox(): Promise<void> {
  cancelRetry();
  const database = await db();
  if (database) {
    await database.clear(STORE);
    await database.clear(FAILED);
  }
  queue = [];
  applied = [];
  setState({ error: null, pending: 0, failed: [], writes: [] });
}

/* ------------------------------------------------------------ lifecycle    */

let started = false;

/** Flushes on reconnect and when the app is brought back to the foreground. */
export function startOutbox(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  window.addEventListener('online', () => void retryNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flush();
  });

  void refresh().then(() => flush());
}

/** The current state, for `useSyncExternalStore`. */
export function outboxState(): OutboxState {
  return state;
}
