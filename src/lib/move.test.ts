import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: { table: string; op: string; payload: Record<string, unknown>; match?: Record<string, unknown> }[] = [];
vi.mock('./outbox', () => ({
  enqueue: async (table: string, op: string, payload: Record<string, unknown>, match?: Record<string, unknown>) => {
    calls.push({ table, op, payload, match });
    return {};
  },
}));
vi.mock('./supabase', () => ({ supabase: {} }));

const { moveAssignment } = await import('./planner');
type A = Parameters<typeof moveAssignment>[1];

// Due Thursday 15 Oct at 09:00 Toronto (13:00Z).
const work = { id: 'w1', due_at: '2026-10-15T13:00:00.000Z', due_has_time: true } as A;

describe('moveAssignment', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('keeps the time of day, and records a move later as a deferral', async () => {
    await moveAssignment('u1', work, '2026-10-17');
    expect(calls[0]).toMatchObject({ table: 'assignments', op: 'update', payload: { due_at: '2026-10-17T13:00:00.000Z' }, match: { id: 'w1' } });
    expect(calls[1]).toMatchObject({ table: 'deferrals', op: 'insert', payload: { assignment_id: 'w1', from_day: '2026-10-15', to_day: '2026-10-17' } });
  });

  it('does not call pulling work earlier a deferral', async () => {
    await moveAssignment('u1', work, '2026-10-13');
    expect(calls.map((c) => c.table)).toEqual(['assignments']);
  });

  it('undoes exactly: the old deadline back, and the deferral it wrote removed', async () => {
    const undo = await moveAssignment('u1', work, '2026-10-17');
    const deferralId = calls[1].payload.id;
    calls.length = 0;
    await undo();
    expect(calls).toEqual([
      { table: 'assignments', op: 'update', payload: { due_at: '2026-10-15T13:00:00.000Z' }, match: { id: 'w1' } },
      { table: 'deferrals', op: 'delete', payload: {}, match: { id: deferralId } },
    ]);
  });
});
