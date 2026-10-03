import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

/**
 * Failures that will never succeed, and the queue carrying on past them.
 *
 * The outbox used to stop at the first error and retry that one write for
 * ever. For a write the server refuses permanently — a unique key, a foreign
 * key to a row deleted elsewhere — that meant every write behind it sat on
 * disk, shown as done on screen, and never reached the server. Normal use
 * produced one: the same checklist item ticked on two devices. These pin the
 * replacement: refused writes are set aside where they can be seen, retried
 * and discarded, and nothing behind them is held hostage.
 */

const sent: { table: string; op: string; payload: Record<string, unknown> }[] = [];
const refuse = new Map<string, { message: string; code?: string }>();

/** Refuse any write whose payload title (or body) matches. */
const keyOf = (p: Record<string, unknown>) => String(p.title ?? p.body ?? p.local_day ?? '');

vi.mock('./supabase', () => {
  const result = (table: string, op: string, payload: Record<string, unknown>) => {
    const err = refuse.get(keyOf(payload));
    if (err) return Promise.resolve({ error: err });
    sent.push({ table, op, payload });
    return Promise.resolve({ error: null });
  };
  const chain = (table: string, op: string, payload: Record<string, unknown>) => {
    const q = {
      eq: () => q,
      then: (r: (v: unknown) => void) => void result(table, op, payload).then(r),
    };
    return q;
  };
  return {
    supabase: {
      from: (table: string) => ({
        insert: (payload: Record<string, unknown>) => result(table, 'insert', payload),
        upsert: (payload: Record<string, unknown>) => result(table, 'upsert', payload),
        update: (payload: Record<string, unknown>) => chain(table, 'update', payload),
        delete: () => chain(table, 'delete', {}),
      }),
    },
  };
});

const outbox = await import('./outbox');
const { clearOutbox, enqueue, flush, outboxState, retryFailed, discardFailed, setOutboxOwner, classify } = outbox;

async function offline<T>(fn: () => Promise<T>): Promise<T> {
  vi.stubGlobal('navigator', { onLine: false });
  try {
    return await fn();
  } finally {
    vi.stubGlobal('navigator', { onLine: true });
  }
}

beforeEach(async () => {
  sent.length = 0;
  refuse.clear();
  vi.stubGlobal('navigator', { onLine: true });
  await setOutboxOwner(null);
  await clearOutbox();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('classifying a failure', () => {
  it('retries what might work next time and sets aside what never will', () => {
    expect(classify('insert', null)).toBe('ok');
    expect(classify('insert', { message: 'Failed to fetch' })).toBe('transient');
    expect(classify('update', { message: 'JWT expired', code: 'PGRST301' })).toBe('transient');
    expect(classify('update', { message: 'duplicate', code: '23505' })).toBe('permanent');
    expect(classify('insert', { message: 'fk', code: '23503' })).toBe('permanent');
    expect(classify('insert', { message: 'check', code: '23514' })).toBe('permanent');
    expect(classify('insert', { message: 'keys', code: 'PGRST102' })).toBe('permanent');
  });

  it('counts a duplicate insert as already done', () => {
    expect(classify('insert', { message: 'duplicate key', code: '23505' })).toBe('already');
  });
});

describe('a write the server refuses for good', () => {
  it('is set aside, and the writes behind it still land', async () => {
    await offline(async () => {
      await enqueue('courses', 'update', { title: 'clash', archived: false }, { id: 'c1' });
      await enqueue('inbox_items', 'insert', { body: 'behind it' });
      await enqueue('assignments', 'update', { title: 'also behind' }, { id: 'a1' });
    });
    refuse.set('clash', { message: 'duplicate key value', code: '23505' });

    await flush();

    expect(sent.map((s) => keyOf(s.payload))).toEqual(['behind it', 'also behind']);
    expect(outboxState().pending).toBe(0);
    expect(outboxState().failed).toHaveLength(1);
    expect(outboxState().failed[0].reason).toMatch(/same name already exists/);
    expect(outboxState().error).toBeNull();
  });

  it('takes the writes that depend on a refused insert aside with it', async () => {
    const parent = await offline(async () => {
      const p = await enqueue('assignments', 'insert', { title: 'parent' });
      await enqueue('subtasks', 'insert', { title: 'child step', assignment_id: p.payload.id });
      await enqueue('assignments', 'update', { title: 'edit parent' }, { id: p.payload.id });
      await enqueue('inbox_items', 'insert', { body: 'unrelated' });
      return p;
    });
    refuse.set('parent', { message: 'violates check', code: '23514' });

    await flush();

    expect(sent.map((s) => keyOf(s.payload))).toEqual(['unrelated']);
    const failed = outboxState().failed;
    expect(failed).toHaveLength(3);
    expect(failed[0].payload.id).toBe(parent.payload.id);
    expect(failed[1].reason).toMatch(/depends on a change/);
  });

  it('comes back on Try again, and lands once the cause is gone', async () => {
    await offline(() => enqueue('inbox_items', 'insert', { body: 'refused once' }));
    refuse.set('refused once', { message: 'check', code: '23514' });
    await flush();
    expect(outboxState().failed).toHaveLength(1);

    refuse.clear();
    await retryFailed();
    await flush();

    expect(outboxState().failed).toHaveLength(0);
    expect(sent.map((s) => keyOf(s.payload))).toEqual(['refused once']);
  });

  it('goes away on Discard and is never sent', async () => {
    await offline(() => enqueue('inbox_items', 'insert', { body: 'let it go' }));
    refuse.set('let it go', { message: 'check', code: '23514' });
    await flush();

    await discardFailed(outboxState().failed[0].id);
    refuse.clear();
    await flush();

    expect(outboxState().failed).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });
});

describe('a duplicate of something that already exists', () => {
  it('counts as done rather than as a failure', async () => {
    await offline(() => enqueue('checklist_completions', 'insert', { item_id: 'i1', local_day: '2026-10-02' }));
    refuse.set('2026-10-02', { message: 'duplicate key value', code: '23505' });

    await flush();

    expect(outboxState().failed).toHaveLength(0);
    expect(outboxState().pending).toBe(0);
    expect(outboxState().error).toBeNull();
  });
});

describe('idempotent inserts', () => {
  it('gives every insert an id made on the device', async () => {
    const entry = await enqueue('inbox_items', 'insert', { body: 'needs an id' });
    await flush();

    expect(typeof entry.payload.id).toBe('string');
    expect(sent[0].payload.id).toBe(entry.payload.id);
  });

  it('keeps an id the caller already chose', async () => {
    await enqueue('assignments', 'insert', { id: 'chosen', title: 'mine' });
    await flush();
    expect(sent[0].payload.id).toBe('chosen');
  });
});

describe('what the screen should already show', () => {
  it('lists queued writes as pending and applied ones with the time they landed', async () => {
    await offline(() => enqueue('inbox_items', 'insert', { body: 'in the queue' }));
    expect(outboxState().writes.map((w) => w.appliedAt)).toEqual([null]);

    await flush();
    const after = outboxState().writes;
    expect(after).toHaveLength(1);
    expect(typeof after[0].appliedAt).toBe('number');
  });
});

describe('one device, two accounts', () => {
  it('never sends or shows one account’s writes as another’s', async () => {
    await setOutboxOwner('account-a');
    await offline(() => enqueue('inbox_items', 'insert', { body: 'a private thought' }));

    await setOutboxOwner('account-b');
    await flush();

    expect(sent).toHaveLength(0);
    expect(outboxState().pending).toBe(0);
    expect(outboxState().writes).toHaveLength(0);

    await setOutboxOwner('account-a');
    await flush();
    expect(sent.map((s) => keyOf(s.payload))).toEqual(['a private thought']);
  });
});
