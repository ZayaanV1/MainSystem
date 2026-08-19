import { describe, it, expect } from 'vitest';
import { weeklyTrend, weekStartOf, weightChange, type DayPoint } from './trend';

describe('weekStartOf', () => {
  it('anchors to the Monday on or before', () => {
    // 17 Aug 2026 is a Monday.
    expect(weekStartOf('2026-08-17')).toBe('2026-08-17');
    expect(weekStartOf('2026-08-19')).toBe('2026-08-17');
    expect(weekStartOf('2026-08-23')).toBe('2026-08-17'); // Sunday
    expect(weekStartOf('2026-08-24')).toBe('2026-08-24'); // next Monday
  });

  it('crosses a month and a year boundary', () => {
    expect(weekStartOf('2026-09-01')).toBe('2026-08-31');
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28');
  });

  it('is unmoved by DST', () => {
    // 1 Nov 2026 is a Sunday and a 25-hour day in Toronto.
    expect(weekStartOf('2026-11-01')).toBe('2026-10-26');
    expect(weekStartOf('2026-03-08')).toBe('2026-03-02');
  });
});

describe('weeklyTrend', () => {
  it('averages weight and calories within a week', () => {
    const days: DayPoint[] = [
      { day: '2026-08-17', kg: 74.0, calories: 3000 },
      { day: '2026-08-18', kg: 74.6, calories: 2800 },
      { day: '2026-08-19', kg: 74.4, calories: 3100 },
    ];
    expect(weeklyTrend(days)).toEqual([
      { weekStart: '2026-08-17', kg: 74.3, calories: 2967, weighedDays: 3, loggedDays: 3 },
    ]);
  });

  it('separates weeks and returns them oldest first', () => {
    const days: DayPoint[] = [
      { day: '2026-08-24', kg: 75 },
      { day: '2026-08-17', kg: 74 },
    ];
    expect(weeklyTrend(days).map((w) => w.weekStart)).toEqual(['2026-08-17', '2026-08-24']);
  });

  it('reports a week with no weigh-ins as null, never as zero', () => {
    // A gap is a week you did not stand on the scale. Drawing it as a plunge
    // to zero would be both wrong and alarming.
    const weeks = weeklyTrend([{ day: '2026-08-17', calories: 2900 }]);
    expect(weeks[0].kg).toBeNull();
    expect(weeks[0].weighedDays).toBe(0);
    expect(weeks[0].calories).toBe(2900);
  });

  it('ignores days logged as zero calories rather than averaging them in', () => {
    // Zero means the app was not opened, not that nothing was eaten. Counting
    // it would drag the average down as a penalty for a bad day.
    const weeks = weeklyTrend([
      { day: '2026-08-17', calories: 3000 },
      { day: '2026-08-18', calories: 0 },
    ]);
    expect(weeks[0].calories).toBe(3000);
    expect(weeks[0].loggedDays).toBe(1);
  });

  it('returns nothing for no data at all', () => {
    expect(weeklyTrend([])).toEqual([]);
  });
});

describe('weightChange', () => {
  const week = (weekStart: string, kg: number | null) => ({
    weekStart,
    kg,
    calories: null,
    weighedDays: kg === null ? 0 : 1,
    loggedDays: 0,
  });

  it('needs two weighed weeks before it says anything', () => {
    expect(weightChange([])).toBeNull();
    expect(weightChange([week('2026-08-17', 74)])).toBeNull();
    expect(weightChange([week('2026-08-17', 74), week('2026-08-24', null)])).toBeNull();
  });

  it('reports the change between the two most recent weighed weeks', () => {
    const change = weightChange([week('2026-08-17', 74.0), week('2026-08-24', 74.8)]);
    expect(change).toEqual({ kg: 0.8, weeksApart: 1 });
  });

  it('skips unweighed weeks rather than giving up', () => {
    // Missing a week's weigh-ins should widen the comparison, not erase it.
    const change = weightChange([
      week('2026-08-10', 73.5),
      week('2026-08-17', null),
      week('2026-08-24', 74.5),
    ]);
    expect(change).toEqual({ kg: 1, weeksApart: 2 });
  });

  it('reports a loss as a negative number without comment', () => {
    // There is no target weight in this app, so neither direction is graded.
    expect(weightChange([week('2026-08-17', 75), week('2026-08-24', 74.2)])?.kg).toBe(-0.8);
  });
});
