import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

/**
 * The outbox is the whole of rule 5: never silently lose data.
 *
 * "Lose" turns out to include "keep safely on disk and never send", which is
 * how a real bug got in — six rows queued in a tight loop during a syllabus
 * import, one written, five stranded with no error anywhere. Durable is not
 * the same as delivered, and these tests hold that line.
 */

const rows: { table: string; payload: Record<string, unknown> }[] = [];
let failNext: string | null = null;

vi.mock('./supabase', () => {
  const make = (table: string) => ({
    insert: (payload: Record<string, unknown>) => {
      if (failNext) {
        const message = failNext;
        failNext = null;
        return Promise.resolve({ error: { message } });
      }
      rows.push({ table, payload });
      return Promise.resolve({ error: null });
    },
    upsert: (payload: Record<string, unknown>) => {
      rows.push({ table, payload });
      return Promise.resolve({ error: null });
    },
    update: (payload: Record<string, unknown>) => {
      const q = {
        eq: () => q,
        then: (r: (v: unknown) => void) => {
          rows.push({ table, payload });
          r({ error: null });
        },
      };
      return q;
    },
    delete: () => {
      const q = {
        eq: () => q,
        then: (r: (v: unknown) => void) => {
          rows.push({ table, payload: { deleted: true } });
          r({ error: null });
        },
      };
      return q;
    },
  });
  return { supabase: { from: make } };
});

const { clearOutbox, enqueue, flush, subscribeOutbox } = await import('./outbox');

beforeEach(async () => {
  rows.length = 0;
  failNext = null;
  vi.stubGlobal('navigator', { onLine: true });
  await clearOutbox();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a single write', () => {
  it('reaches the server', async () => {
    await enqueue('inbox_items', 'insert', { body: 'one thought' });
    await flush();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ table: 'inbox_items', payload: { body: 'one thought' } });
  });
});

describe('a burst of writes — the syllabus import case', () => {
  it('delivers every row, not just the first', async () => {
    // The exact shape of the bug: enqueue in a tight loop without awaiting a
    // flush between them. Each enqueue kicks off a flush; all but the first
    // hit the `syncing` guard and return immediately.
    const titles = Array.from({ length: 12 }, (_, i) => `Assignment ${i + 1}`);

    await Promise.all(titles.map((title) => enqueue('assignments', 'insert', { title })));
    await flush();

    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r.payload.title).sort()).toEqual(titles.sort());
  });

  it('leaves the queue empty afterwards', async () => {
    await Promise.all(
      Array.from({ length: 6 }, (_, i) => enqueue('assignments', 'insert', { n: i })),
    );
    await flush();

    let pending = -1;
    const stop = subscribeOutbox((s) => {
      pending = s.pending;
    });
    stop();

    expect(pending).toBe(0);
  });

  it('preserves order, so an edit never lands before its insert', async () => {
    // Queued inside a single millisecond, which is the case that broke: a
    // timestamp index cannot separate them and falls back to random key order.
    vi.stubGlobal('navigator', { onLine: false });
    for (const title of ['first', 'second', 'third']) {
      await enqueue('assignments', 'insert', { title });
    }
    vi.stubGlobal('navigator', { onLine: true });
    await flush();

    expect(rows.map((r) => r.payload.title)).toEqual(['first', 'second', 'third']);
  });

  it('keeps order across many same-millisecond writes', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const expected = Array.from({ length: 30 }, (_, i) => `row ${i}`);
    for (const title of expected) await enqueue('assignments', 'insert', { title });
    vi.stubGlobal('navigator', { onLine: true });
    await flush();

    expect(rows.map((r) => r.payload.title)).toEqual(expected);
  });
});

describe('failure is visible and recoverable', () => {
  /**
   * enqueue() kicks off a flush of its own, which is exactly what it should do
   * in the app but makes a failure impossible to inject at a chosen moment.
   * Queuing offline parks the work without sending it, so the test controls
   * when the first attempt happens.
   */
  async function queueOffline(...titles: string[]) {
    vi.stubGlobal('navigator', { onLine: false });
    for (const title of titles) await enqueue('assignments', 'insert', { title });
    vi.stubGlobal('navigator', { onLine: true });
  }

  it('surfaces the error rather than swallowing it', async () => {
    let seen: string | null = null;
    const stop = subscribeOutbox((s) => {
      seen = s.error;
    });

    await queueOffline('will fail');
    failNext = 'network unreachable';
    await flush();
    stop();

    expect(seen).toMatch(/Couldn't sync/);
    expect(seen).toMatch(/network unreachable/);
  });

  it('keeps the failed write for a later attempt', async () => {
    await queueOffline('retry me');
    failNext = 'boom';
    await flush();
    expect(rows).toHaveLength(0);

    // Second attempt, no failure injected: the work is still there.
    await flush();
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.title).toBe('retry me');
  });

  it('stops at the failure instead of skipping past it', async () => {
    await queueOffline('a', 'b', 'c');

    failNext = 'transient';
    await flush();

    // 'a' failed, so 'b' and 'c' must wait rather than jumping the queue.
    expect(rows).toHaveLength(0);

    await flush();
    expect(rows.map((r) => r.payload.title)).toEqual(['a', 'b', 'c']);
  });

  it('clears the error once the queue drains', async () => {
    let seen: string | null = 'not yet';
    await queueOffline('x');
    failNext = 'boom';
    await flush();

    await flush();
    const stop = subscribeOutbox((s) => {
      seen = s.error;
    });
    stop();

    expect(seen).toBeNull();
  });
});

describe('offline', () => {
  it('queues without sending, and sends nothing until back online', async () => {
    vi.stubGlobal('navigator', { onLine: false });

    await enqueue('inbox_items', 'insert', { body: 'written on the metro' });
    await flush();
    expect(rows).toHaveLength(0);

    vi.stubGlobal('navigator', { onLine: true });
    await flush();
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.body).toBe('written on the metro');
  });

  it('reports work waiting while offline, so it is never a silent hold', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await enqueue('inbox_items', 'insert', { body: 'a' });
    await enqueue('inbox_items', 'insert', { body: 'b' });

    let pending = 0;
    const stop = subscribeOutbox((s) => {
      pending = s.pending;
    });
    stop();

    expect(pending).toBe(2);
  });
});

describe('every operation shape survives the round trip', () => {
  it('handles update and delete as well as insert', async () => {
    await enqueue('assignments', 'update', { status: 'done' }, { id: 'a1' });
    await enqueue('checklist_completions', 'delete', {}, { item_id: 'i1', local_day: '2026-08-17' });
    await flush();

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ table: 'assignments', payload: { status: 'done' } });
    expect(rows[1]).toMatchObject({ table: 'checklist_completions' });
  });
});
