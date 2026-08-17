import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * What happens when IndexedDB is not available.
 *
 * Not hypothetical: `indexedDB.open` was observed hanging forever in a real
 * browser, and because every write awaited it, every tap did nothing, reported
 * nothing and saved nothing. Safari private browsing, storage eviction and a
 * version upgrade blocked by another tab all produce the same shape.
 *
 * Degraded is acceptable. Silent is not.
 */

// Never settles, exactly like the failure that was observed.
vi.mock('idb', () => ({ openDB: () => new Promise(() => {}) }));

const sent: { table: string; payload: Record<string, unknown> }[] = [];
let failNext: string | null = null;

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => ({
      insert: (payload: Record<string, unknown>) => {
        if (failNext) {
          const message = failNext;
          failNext = null;
          return Promise.resolve({ error: { message } });
        }
        sent.push({ table, payload });
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

const { enqueue, subscribeOutbox } = await import('./outbox');

beforeEach(() => {
  sent.length = 0;
  failNext = null;
  vi.stubGlobal('navigator', { onLine: true });
});

describe('when IndexedDB never opens', () => {
  it('still sends the write instead of hanging forever', async () => {
    await enqueue('inbox_items', 'insert', { body: 'a thought worth keeping' });

    expect(sent).toHaveLength(1);
    expect(sent[0].payload.body).toBe('a thought worth keeping');
  }, 10_000);

  it('reports a failed write rather than swallowing it', async () => {
    let seen: string | null = null;
    const stop = subscribeOutbox((s) => {
      seen = s.error;
    });

    failNext = 'server unreachable';
    await enqueue('assignments', 'insert', { title: 'will fail' });
    stop();

    expect(seen).toMatch(/Couldn't save/);
    expect(seen).toMatch(/server unreachable/);
  }, 10_000);

  it('clears the error after a write that works', async () => {
    failNext = 'boom';
    await enqueue('assignments', 'insert', { title: 'one' });

    await enqueue('assignments', 'insert', { title: 'two' });

    let seen: string | null = 'unset';
    const stop = subscribeOutbox((s) => {
      seen = s.error;
    });
    stop();

    expect(seen).toBeNull();
    expect(sent.map((s) => s.payload.title)).toEqual(['two']);
  }, 10_000);

  it('pays the open timeout once, then stays fast', async () => {
    // The very first write in this file absorbed the 3s timeout — that run is
    // visible in the suite duration. Once storage is known to be unavailable,
    // every subsequent write must be immediate: a syllabus import of thirty
    // rows cannot take three seconds each.
    const started = Date.now();
    for (let i = 0; i < 10; i++) {
      await enqueue('assignments', 'insert', { title: `row ${i}` });
    }
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(500);
    expect(sent).toHaveLength(10);
  }, 15_000);
});
