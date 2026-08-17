import { describe, it, expect } from 'vitest';
import { DEFAULT_THRESHOLDS, startBy, startByIsDue, urgencyFor } from './urgency';

const utc = (iso: string) => new Date(iso);

/** Mon 17 Aug 2026, 12:00 EDT. */
const NOW = utc('2026-08-17T16:00:00Z');

/** Local noon on a given Toronto day, as a stored UTC instant. */
const dueOn = (day: string) => utc(`${day}T16:00:00Z`);

describe('the proximity ramp matches the specified windows', () => {
  const state = (day: string) => urgencyFor(dueOn(day), { now: NOW }).state;

  it('is overdue when past due and not done', () => {
    expect(state('2026-08-16')).toBe('overdue');
    expect(state('2026-08-01')).toBe('overdue');
  });

  it('is critical within 48 hours, today included', () => {
    expect(state('2026-08-17')).toBe('critical');
    expect(state('2026-08-18')).toBe('critical');
    expect(state('2026-08-19')).toBe('critical');
  });

  it('is urgent at three to five days', () => {
    expect(state('2026-08-20')).toBe('urgent');
    expect(state('2026-08-22')).toBe('urgent');
  });

  it('is approaching at six to fourteen days', () => {
    expect(state('2026-08-23')).toBe('approaching');
    expect(state('2026-08-31')).toBe('approaching');
  });

  it('is distant beyond fifteen days', () => {
    expect(state('2026-09-01')).toBe('distant');
    expect(state('2026-12-01')).toBe('distant');
  });

  it('has no gaps or overlaps across the whole ramp', () => {
    // Walk a month and assert the state only ever moves in one direction.
    const order = ['overdue', 'critical', 'urgent', 'approaching', 'distant'];
    let lastIndex = 0;
    for (let d = -3; d <= 30; d++) {
      const day = new Date(Date.UTC(2026, 7, 17 + d)).toISOString().slice(0, 10);
      const idx = order.indexOf(urgencyFor(dueOn(day), { now: NOW }).state);
      expect(idx, `no state for ${day}`).toBeGreaterThanOrEqual(0);
      expect(idx, `ramp went backwards at ${day}`).toBeGreaterThanOrEqual(lastIndex);
      lastIndex = idx;
    }
  });
});

describe('done and undated', () => {
  it('reports done regardless of how overdue it was', () => {
    const u = urgencyFor(dueOn('2026-01-01'), { now: NOW, done: true });
    expect(u.state).toBe('done');
    expect(u.colourVar).toBe('--t-done');
  });

  it('treats an undated item as unscheduled, not as urgent', () => {
    const u = urgencyFor(null, { now: NOW });
    expect(u.state).toBe('undated');
    expect(u.label).toBe('No date');
    expect(u.days).toBeNull();
  });
});

describe('the colour law', () => {
  it('only ever returns time tokens, never macro or course ones', () => {
    const days = ['2026-08-10', '2026-08-17', '2026-08-20', '2026-08-25', '2026-09-30'];
    for (const d of days) {
      expect(urgencyFor(dueOn(d), { now: NOW }).colourVar).toMatch(/^--t-/);
    }
    expect(urgencyFor(null, { now: NOW }).colourVar).toMatch(/^--t-/);
    expect(urgencyFor(dueOn('2026-08-17'), { now: NOW, done: true }).colourVar).toMatch(/^--t-/);
  });

  it('never returns a literal colour value', () => {
    for (const d of ['2026-08-10', '2026-08-18', '2026-09-30']) {
      expect(urgencyFor(dueOn(d), { now: NOW }).colourVar).not.toMatch(/#|rgb|hsl/);
    }
  });

  it('always pairs the colour with a written label', () => {
    for (const d of ['2026-08-10', '2026-08-17', '2026-08-25', '2026-12-01']) {
      expect(urgencyFor(dueOn(d), { now: NOW }).label.length).toBeGreaterThan(0);
    }
  });
});

describe('labels state facts without assigning blame', () => {
  it('counts lateness plainly', () => {
    expect(urgencyFor(dueOn('2026-08-16'), { now: NOW }).label).toBe('1 day late');
    expect(urgencyFor(dueOn('2026-08-14'), { now: NOW }).label).toBe('3 days late');
  });

  it('names today and tomorrow rather than counting them', () => {
    expect(urgencyFor(dueOn('2026-08-17'), { now: NOW }).label).toBe('Due today');
    expect(urgencyFor(dueOn('2026-08-18'), { now: NOW }).label).toBe('Due tomorrow');
  });

  it('never scolds, apologises, or exclaims', () => {
    const banned = /you|your|should|forgot|!|behind|failed|again/i;
    for (let d = -10; d <= 40; d++) {
      const day = new Date(Date.UTC(2026, 7, 17 + d)).toISOString().slice(0, 10);
      expect(banned.test(urgencyFor(dueOn(day), { now: NOW }).label), day).toBe(false);
    }
  });
});

describe('thresholds are editable', () => {
  it('honours a tighter critical window', () => {
    const tight = { ...DEFAULT_THRESHOLDS, critical_days: 0 };
    expect(urgencyFor(dueOn('2026-08-17'), { now: NOW, thresholds: tight }).state).toBe('critical');
    expect(urgencyFor(dueOn('2026-08-18'), { now: NOW, thresholds: tight }).state).toBe('urgent');
  });

  it('honours a wider approaching window', () => {
    const wide = { ...DEFAULT_THRESHOLDS, approaching_days: 30 };
    expect(urgencyFor(dueOn('2026-09-10'), { now: NOW, thresholds: wide }).state).toBe('approaching');
  });
});

describe('DST does not shift the ramp', () => {
  it('counts calendar days across the fall-back', () => {
    const beforeFallBack = utc('2026-10-31T16:00:00Z'); // Sat 31 Oct, 12:00 EDT
    const u = urgencyFor(utc('2026-11-01T17:00:00Z'), { now: beforeFallBack }); // Sun, 12:00 EST
    expect(u.days).toBe(1);
    expect(u.label).toBe('Due tomorrow');
  });

  it('does not report something due tonight as due tomorrow', () => {
    // 23:00 EDT today is 03:00Z tomorrow. A naive UTC comparison calls this
    // tomorrow and drops it off the Today view.
    const u = urgencyFor(utc('2026-08-18T03:00:00Z'), { now: NOW });
    expect(u.label).toBe('Due today');
  });
});

describe('start by — manufacturing an earlier date that also feels real', () => {
  it('is null without a due date or an effort estimate', () => {
    expect(startBy(null, 180)).toBeNull();
    expect(startBy(dueOn('2026-09-01'), null)).toBeNull();
    expect(startBy(dueOn('2026-09-01'), 0)).toBeNull();
  });

  it('allows a day per 90 focused minutes', () => {
    // 6 hours of work = 4 days at 90 minutes a day.
    expect(startBy(dueOn('2026-09-10'), 360)).toBe('2026-09-06');
  });

  it('rounds part-days up rather than down', () => {
    // 100 minutes is two days, not one — under-allowing produces a start date
    // that was never achievable.
    expect(startBy(dueOn('2026-09-10'), 100)).toBe('2026-09-08');
  });

  it('always leaves at least a day, even for a trivial task', () => {
    expect(startBy(dueOn('2026-09-10'), 5)).toBe('2026-09-09');
  });

  it('lets a hand-set override win', () => {
    // Changing the derivation rule later must never rewrite a date set by hand.
    expect(startBy(dueOn('2026-09-10'), 360, '2026-08-20')).toBe('2026-08-20');
  });

  it('happily lands in the past, which is the useful part', () => {
    const start = startBy(dueOn('2026-08-18'), 900); // 15 hours
    expect(start).toBe('2026-08-08');
    expect(startByIsDue(start, NOW)).toBe(true);
  });

  it('is measured against the due date in local time', () => {
    // Due 00:30 EDT on 10 Sep is 04:30Z. Measuring from the UTC date would
    // count from the 10th correctly, but a late-evening due time would not.
    expect(startBy(utc('2026-09-10T02:00:00Z'), 180)).toBe('2026-09-07'); // 22:00 EDT on the 9th
  });
});

describe('startByIsDue', () => {
  it('is false while the start date is still ahead', () => {
    expect(startByIsDue('2026-08-20', NOW)).toBe(false);
  });

  it('is true on the day itself', () => {
    expect(startByIsDue('2026-08-17', NOW)).toBe(true);
  });

  it('is false when there is no start date to be due', () => {
    expect(startByIsDue(null, NOW)).toBe(false);
  });
});
