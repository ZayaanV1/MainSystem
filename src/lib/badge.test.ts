import { describe, expect, it } from 'vitest';
import { badgeCount } from './badge';
import type { Assignment } from './planner';

const work = (due_at: string | null, status: Assignment['status'] = 'todo') =>
  ({ id: Math.random().toString(36), course_id: null, title: 'x', due_at, due_has_time: true, status }) as Assignment;

describe('badgeCount', () => {
  // 2026-10-12 in Toronto runs from 04:00Z to 04:00Z the next day.
  it('counts open work due today, in the local day', () => {
    expect(badgeCount([work('2026-10-12T15:00:00Z'), work('2026-10-13T03:59:00Z')], '2026-10-12')).toBe(2);
  });

  it('never counts overdue work, which would only ever grow', () => {
    expect(badgeCount([work('2026-10-11T15:00:00Z'), work('2026-10-01T15:00:00Z')], '2026-10-12')).toBe(0);
  });

  it('falls as the day is done, and ignores undated and later work', () => {
    expect(badgeCount([work('2026-10-12T15:00:00Z', 'done'), work(null), work('2026-10-14T15:00:00Z')], '2026-10-12')).toBe(0);
  });
});
