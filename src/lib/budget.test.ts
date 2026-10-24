import { describe, it, expect } from 'vitest';
import {
  caps,
  globalCaps,
  meterFor,
  release,
  reserve,
  standDownMessage,
} from '../../supabase/functions/_shared/budget';

/**
 * The daily AI limits protect one shared free key, so what matters is that
 * they hold when requests overlap and that hitting a wall never costs a
 * question. The database function does the arithmetic (tested against real
 * Postgres in supabase/migrations.test.ts); these test what the code around it
 * does with each answer.
 */

/** Answers the reservation rpc the way the SQL function does, one slot at a time. */
function fakeDb(limit: number, shared = Infinity) {
  let used = 0;
  let sharedUsed = 0;
  const calls: string[] = [];
  return {
    calls,
    used: () => used,
    db: {
      rpc: async (name: string) => {
        calls.push(name);
        if (name === 'release_ai_use') {
          used = Math.max(0, used - 1);
          return { data: null, error: null };
        }
        if (sharedUsed >= shared) return { data: -2, error: null };
        if (used >= limit) return { data: -1, error: null };
        used++;
        sharedUsed++;
        return { data: used, error: null };
      },
    },
  };
}

describe('reserve', () => {
  it('lets the first calls through and says how many are left', async () => {
    const f = fakeDb(3);
    const a = await reserve(f.db, 'u', 'chat', '2026-10-23', false);
    expect(a).toMatchObject({ allowed: true, held: true });
    expect(a.remaining).toBe(caps().chat - 1);
  });

  it('holds exactly the limit when fifty ask at once', async () => {
    const f = fakeDb(5);
    const all = await Promise.all(Array.from({ length: 50 }, () => reserve(f.db, 'u', 'chat', '2026-10-23', false)));
    expect(all.filter((r) => r.allowed)).toHaveLength(5);
    expect(all.filter((r) => !r.allowed && r.denied === 'account')).toHaveLength(45);
  });

  it('tells the account limit from the shared ceiling', async () => {
    const f = fakeDb(10, 0);
    expect(await reserve(f.db, 'u', 'chat', 'd', false)).toMatchObject({ allowed: false, denied: 'shared', held: false });
  });

  it('never counts an account on its own key', async () => {
    const f = fakeDb(0);
    const r = await reserve(f.db, 'u', 'chat', 'd', true);
    expect(r).toMatchObject({ allowed: true, held: false });
    expect(f.calls).toEqual([]);
  });

  it('fails open when the reservation cannot be made, so a broken table does not take the app down', async () => {
    const broken = { rpc: async () => ({ data: null, error: { message: 'down' } }) };
    expect(await reserve(broken, 'u', 'summary', 'd', false)).toMatchObject({ allowed: true, held: false });
  });
});

describe('release', () => {
  it('gives back a slot that was held, and only that', async () => {
    const f = fakeDb(2);
    const slot = await reserve(f.db, 'u', 'guide', 'd', false);
    expect(f.used()).toBe(1);
    await release(f.db, 'u', 'guide', 'd', slot);
    expect(f.used()).toBe(0);

    const own = await reserve(f.db, 'u', 'guide', 'd', true);
    await release(f.db, 'u', 'guide', 'd', own);
    expect(f.calls.filter((c) => c === 'release_ai_use')).toHaveLength(1);
  });
});

describe('meterFor', () => {
  it('says yes until the budget is spent, with no slot to give back', async () => {
    const f = fakeDb(2);
    const ok = meterFor(f.db, 'u', 'embed', 'd', false);
    expect([await ok(), await ok(), await ok()]).toEqual([true, true, false]);
  });
});

describe('the numbers', () => {
  it('has a cap for every kind and a shared ceiling that is a multiple of it', () => {
    const per = caps();
    const shared = globalCaps();
    for (const k of Object.keys(per) as (keyof typeof per)[]) {
      expect(per[k]).toBeGreaterThan(0);
      expect(shared[k]).toBe(per[k] * 25);
    }
  });

  it('says which wall was hit and points at the way out for the shared one', () => {
    expect(standDownMessage('chat')).toMatch(/resets at midnight/);
    expect(standDownMessage('chat', 'shared')).toMatch(/own key in Settings/);
  });
});
