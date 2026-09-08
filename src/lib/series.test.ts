import { describe, it, expect } from 'vitest';
import {
  seriesDays,
  missingDays,
  describeSeries,
  MAX_INSTANCES,
  type AssignmentSeries,
} from '../../supabase/functions/_shared/series';

const series = (o: Partial<AssignmentSeries>): AssignmentSeries => ({
  id: 's1',
  title: 'Lab',
  course_id: null,
  recurrence: 'weekdays',
  weekdays: [2], // Tuesday
  interval_days: null,
  // 2026-09-01 is a Tuesday.
  anchor_day: '2026-09-01',
  until_day: '2026-09-30',
  due_time: null,
  effort_minutes: null,
  weight_percent: null,
  active: true,
  ...o,
});

describe('seriesDays', () => {
  it('lands on every matching weekday within the span', () => {
    expect(seriesDays(series({}))).toEqual([
      '2026-09-01',
      '2026-09-08',
      '2026-09-15',
      '2026-09-22',
      '2026-09-29',
    ]);
  });

  it('handles two weekdays a week', () => {
    // Tuesdays and Thursdays, one week.
    const days = seriesDays(series({ weekdays: [2, 4], until_day: '2026-09-07' }));
    expect(days).toEqual(['2026-09-01', '2026-09-03']);
  });

  it('steps by interval from the anchor, inclusive', () => {
    const days = seriesDays(
      series({ recurrence: 'interval', interval_days: 14, weekdays: null, until_day: '2026-10-15' }),
    );
    expect(days).toEqual(['2026-09-01', '2026-09-15', '2026-09-29', '2026-10-13']);
  });

  it('never generates before the anchor', () => {
    // Configuring a pattern today must not make it look as though a term of
    // instances was already missed. Same rule the checklist follows.
    const days = seriesDays(series({ anchor_day: '2026-09-15' }));
    expect(days.every((d) => d >= '2026-09-15')).toBe(true);
  });

  it('never generates past until_day', () => {
    const days = seriesDays(series({ until_day: '2026-09-15' }));
    expect(days).toEqual(['2026-09-01', '2026-09-08', '2026-09-15']);
  });

  it('produces nothing for an inactive series', () => {
    // Turning a series off stops FUTURE generation and touches nothing
    // already generated — the same contract as archiving a course.
    expect(seriesDays(series({ active: false }))).toEqual([]);
  });

  it('produces nothing when the span is inverted', () => {
    expect(seriesDays(series({ anchor_day: '2026-09-30', until_day: '2026-09-01' }))).toEqual([]);
  });

  it('produces nothing when a weekday series names no days', () => {
    expect(seriesDays(series({ weekdays: [] }))).toEqual([]);
    expect(seriesDays(series({ weekdays: null }))).toEqual([]);
  });

  it('produces nothing when an interval series has no interval', () => {
    expect(seriesDays(series({ recurrence: 'interval', interval_days: null }))).toEqual([]);
  });

  it('caps a runaway pattern rather than writing thousands of rows', () => {
    // A five-year daily span is a misconfiguration. Truncating is safer than
    // either throwing at the user or generating the lot.
    const days = seriesDays(
      series({ weekdays: [1, 2, 3, 4, 5, 6, 7], until_day: '2031-09-01' }),
    );
    expect(days).toHaveLength(MAX_INSTANCES);
  });

  it('crosses a month and a year boundary correctly', () => {
    const days = seriesDays(
      series({ anchor_day: '2026-12-29', until_day: '2027-01-19', weekdays: [2] }),
    );
    expect(days).toEqual(['2026-12-29', '2027-01-05', '2027-01-12', '2027-01-19']);
  });
});

describe('missingDays', () => {
  it('returns the whole series when nothing exists yet', () => {
    expect(missingDays(series({ until_day: '2026-09-15' }), [])).toHaveLength(3);
  });

  it('is idempotent — a second run asks for nothing', () => {
    // This runs on create, on edit and on load, so it has to be safe to run a
    // hundred times.
    const s = series({ until_day: '2026-09-15' });
    const first = missingDays(s, []);
    expect(missingDays(s, first)).toEqual([]);
  });

  it('regenerates exactly one day when one instance was deleted by hand', () => {
    const s = series({ until_day: '2026-09-15' });
    const all = seriesDays(s);
    const minusMiddle = all.filter((d) => d !== '2026-09-08');
    expect(missingDays(s, minusMiddle)).toEqual(['2026-09-08']);
  });

  it('does NOT regenerate a day whose instance is already done', () => {
    // The worst available failure for this feature: an app that keeps handing
    // back work you already finished. `existing` therefore includes completed
    // instances, and this asserts the caller's contract holds.
    const s = series({ until_day: '2026-09-15' });
    const all = seriesDays(s);
    expect(missingDays(s, all)).toEqual([]);
  });

  it('asks for nothing once the series has been turned off', () => {
    expect(missingDays(series({ active: false }), [])).toEqual([]);
  });

  it('ignores existing days that are not part of the pattern', () => {
    // A one-off assignment that happens to sit on a Wednesday must not
    // suppress the Tuesday the series actually wants.
    const s = series({ until_day: '2026-09-08' });
    expect(missingDays(s, ['2026-09-02', '2026-09-01'])).toEqual(['2026-09-08']);
  });
});

describe('describeSeries', () => {
  it('names the weekdays in week order, not the order they were tapped', () => {
    expect(describeSeries(series({ weekdays: [4, 2] }))).toBe('Every Tue, Thu');
  });

  it('collapses a full week', () => {
    expect(describeSeries(series({ weekdays: [1, 2, 3, 4, 5, 6, 7] }))).toBe('Every day');
  });

  it('reads common intervals as words', () => {
    const i = (n: number) =>
      describeSeries(series({ recurrence: 'interval', interval_days: n, weekdays: null }));
    expect(i(7)).toBe('Every week');
    expect(i(14)).toBe('Every two weeks');
    expect(i(10)).toBe('Every 10 days');
  });

  it('says so when a weekday series names no days', () => {
    expect(describeSeries(series({ weekdays: [] }))).toBe('No days chosen');
  });
});
