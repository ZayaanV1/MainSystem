import { describe, it, expect, beforeAll } from 'vitest';
import { groupOf, groupWork } from './todayGroups';
import { setActiveTimezone } from './time';

beforeAll(() => setActiveTimezone('America/Toronto'));

// Sunday 4 Oct 2026, 4:00 p.m. EDT.
const now = new Date('2026-10-04T16:00:00-04:00');
const today = '2026-10-04';
const at = (iso: string) => new Date(iso).toISOString();

describe('groupOf', () => {
  it('puts the undated under No date', () => {
    expect(groupOf(null, now, today)).toBe('none');
  });

  it('calls something due at 3 p.m. late at 4 p.m. the same day', () => {
    expect(groupOf(at('2026-10-04T15:00:00-04:00'), now, today)).toBe('late');
  });

  it('keeps tonight in Today', () => {
    expect(groupOf(at('2026-10-04T23:59:00-04:00'), now, today)).toBe('today');
  });

  it('reads the local day, not the UTC one: 9 p.m. Monday is Tomorrow, though it is Tuesday in UTC', () => {
    expect(groupOf(at('2026-10-05T21:00:00-04:00'), now, today)).toBe('tomorrow');
  });

  it('runs This week to six days out and Later after', () => {
    expect(groupOf(at('2026-10-10T12:00:00-04:00'), now, today)).toBe('week');
    expect(groupOf(at('2026-10-11T12:00:00-04:00'), now, today)).toBe('later');
  });

  it('holds across the November DST change', () => {
    const nov = new Date('2026-10-31T12:00:00-04:00');
    // 1 Nov 2026: clocks go back. 8 p.m. EST on the 1st is still "Tomorrow".
    expect(groupOf(at('2026-11-01T20:00:00-05:00'), nov, '2026-10-31')).toBe('tomorrow');
  });
});

describe('groupWork', () => {
  it('returns only the groups that have work, in reading order, keeping item order', () => {
    const items = [
      { id: 'a', due_at: null },
      { id: 'b', due_at: at('2026-10-04T18:00:00-04:00') },
      { id: 'c', due_at: at('2026-10-02T23:59:00-04:00') },
      { id: 'd', due_at: at('2026-10-04T20:00:00-04:00') },
    ];
    const groups = groupWork(items, now, today);
    expect(groups.map((g) => g.id)).toEqual(['late', 'today', 'none']);
    expect(groups[1].items.map((i) => i.id)).toEqual(['b', 'd']);
    expect(groups[1].label).toBe('Today');
  });
});
