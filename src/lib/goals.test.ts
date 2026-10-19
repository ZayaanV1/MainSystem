import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
import { SEGMENT_LIMIT, clampGoal, goalProgress, type Goal } from './goals';

const goal = (fields: Partial<Goal> = {}): Goal => ({
  id: 'g',
  title: 'Read Leviathan',
  unit: 'chapters',
  have: 9,
  target: 15,
  by_day: '2026-11-06',
  ...fields,
});

describe('goalProgress', () => {
  it('reads the chapter tracker as drawn: nine of fifteen, six to go', () => {
    const p = goalProgress(goal(), '2026-10-18');
    expect(p.left).toBe(6);
    expect(p.reached).toBe(false);
    expect(p.share).toBeCloseTo(0.6);
    expect(p.daysLeft).toBe(19);
    expect(p.segments?.filter(Boolean)).toHaveLength(9);
    expect(p.segments).toHaveLength(15);
  });

  it('draws one fill instead of segments past the limit', () => {
    expect(goalProgress(goal({ target: SEGMENT_LIMIT + 1 }), '2026-10-18').segments).toBeNull();
    expect(goalProgress(goal({ target: SEGMENT_LIMIT }), '2026-10-18').segments).toHaveLength(SEGMENT_LIMIT);
  });

  it('stays reached, and never counts below zero days', () => {
    const p = goalProgress(goal({ have: 15 }), '2026-12-01');
    expect(p.reached).toBe(true);
    expect(p.left).toBe(0);
    expect(p.daysLeft).toBe(0);
  });

  it('has no days left to count without a by-date', () => {
    expect(goalProgress(goal({ by_day: null }), '2026-10-18').daysLeft).toBeNull();
  });
});

describe('clampGoal', () => {
  it('keeps the count inside the target and the target at least one', () => {
    expect(clampGoal({ have: 20, target: 15 })).toEqual({ have: 15, target: 15 });
    expect(clampGoal({ have: -3, target: 0 })).toEqual({ have: 0, target: 1 });
    expect(clampGoal({ have: Number.NaN, target: Number.NaN })).toEqual({ have: 0, target: 1 });
    expect(clampGoal({ have: 2.6, target: 9.4 })).toEqual({ have: 3, target: 9 });
  });
});
