import { describe, it, expect } from 'vitest';
import {
  MAX_CLASSES,
  classDays,
  clockChanges,
  clockMinutes,
  describeDays,
  meetingDays,
  parseClock,
  planClass,
  sessionOn,
  type ClassInstance,
  type ClassPattern,
} from '../../supabase/functions/_shared/classes';

/**
 * A class typed by hand. Every assertion names its zone, so these mean the
 * same thing under every host zone `npm run test:tz` runs them in — the bug
 * this guards against is a time that is right on the laptop it was written
 * on and an hour out everywhere else.
 */

const TORONTO = 'America/Toronto';
const VANCOUVER = 'America/Vancouver';
const SYDNEY = 'Australia/Sydney';
const KOLKATA = 'Asia/Kolkata';

/** Tue and Thu lectures, 10:15 to 11:30, for the fall term. 8 Sep 2026 is a Tuesday. */
const lecture = (over: Partial<ClassPattern> = {}): ClassPattern => ({
  weekdays: [2, 4],
  start_time: '10:15',
  end_time: '11:30',
  first_day: '2026-09-08',
  last_day: '2026-12-08',
  skip_days: [],
  ...over,
});

describe('which days a class meets', () => {
  it('lands on the chosen weekdays, first and last day included', () => {
    const days = classDays(lecture());
    expect(days[0]).toBe('2026-09-08');
    expect(days.at(-1)).toBe('2026-12-08');
    expect(days).toHaveLength(27);
    expect(days.every((d) => [2, 4].includes(new Date(`${d}T12:00:00Z`).getUTCDay()))).toBe(true);
  });

  it('never starts before the first day, whatever weekday that is', () => {
    // A Wednesday start for a Tue/Thu class: the first meeting is Thursday.
    expect(classDays(lecture({ first_day: '2026-09-09' }))[0]).toBe('2026-09-10');
  });

  it('keeps skipped days in the pattern but not in the meetings', () => {
    const p = lecture({ skip_days: ['2026-10-13', '2026-10-15'] });
    expect(classDays(p)).toContain('2026-10-13');
    expect(meetingDays(p)).not.toContain('2026-10-13');
    expect(meetingDays(p)).not.toContain('2026-10-15');
    expect(meetingDays(p)).toHaveLength(25);
  });

  it('makes nothing from no days, or from a last day before the first', () => {
    expect(classDays(lecture({ weekdays: [] }))).toEqual([]);
    expect(classDays(lecture({ last_day: '2026-09-01' }))).toEqual([]);
  });

  it('stops at the cap rather than making a thousand rows', () => {
    const daily = lecture({ weekdays: [1, 2, 3, 4, 5, 6, 7], last_day: '2028-09-08' });
    expect(classDays(daily)).toHaveLength(MAX_CLASSES);
  });
});

describe('each session keeps its wall-clock time', () => {
  it('stays at 10:15 across Toronto\'s change on 1 November', () => {
    const before = sessionOn('2026-10-27', lecture(), TORONTO);
    const after = sessionOn('2026-11-03', lecture(), TORONTO);
    // EDT is UTC-4, EST is UTC-5: the same 10:15, an hour apart in UTC.
    expect(before).toEqual({ starts_at: '2026-10-27T14:15:00.000Z', ends_at: '2026-10-27T15:30:00.000Z' });
    expect(after).toEqual({ starts_at: '2026-11-03T15:15:00.000Z', ends_at: '2026-11-03T16:30:00.000Z' });
  });

  it('uses the account\'s zone, not Toronto: Vancouver', () => {
    expect(sessionOn('2026-10-27', lecture(), VANCOUVER).starts_at).toBe('2026-10-27T17:15:00.000Z');
    expect(sessionOn('2026-11-03', lecture(), VANCOUVER).starts_at).toBe('2026-11-03T18:15:00.000Z');
  });

  it('crosses a southern spring change the other way: Sydney on 4 October', () => {
    // AEST is UTC+10 and AEDT UTC+11, so the second lands on the previous UTC day.
    expect(sessionOn('2026-09-29', lecture(), SYDNEY).starts_at).toBe('2026-09-29T00:15:00.000Z');
    expect(sessionOn('2026-10-06', lecture(), SYDNEY).starts_at).toBe('2026-10-05T23:15:00.000Z');
  });

  it('needs nothing special where there is no daylight saving', () => {
    expect(sessionOn('2026-09-29', lecture(), KOLKATA).starts_at).toBe('2026-09-29T04:45:00.000Z');
    expect(sessionOn('2026-11-03', lecture(), KOLKATA).starts_at).toBe('2026-11-03T04:45:00.000Z');
  });

  it('refuses a time that is not one rather than writing midnight', () => {
    expect(() => sessionOn('2026-10-27', lecture({ start_time: '' }), TORONTO)).toThrow();
  });
});

describe('reading a time of day', () => {
  it('reads HH:MM, tolerates seconds, and refuses the rest', () => {
    expect(parseClock('09:05')).toEqual({ hour: 9, minute: 5 });
    expect(parseClock('23:59:00')).toEqual({ hour: 23, minute: 59 });
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('9:05')).toBeNull();
    expect(clockMinutes('10:15')).toBe(615);
    expect(clockMinutes('')).toBeNull();
  });
});

describe('naming the clock change in a term', () => {
  it('finds Toronto\'s autumn change', () => {
    expect(clockChanges('2026-09-08', '2026-12-08', TORONTO)).toEqual([{ day: '2026-11-01', direction: 'back' }]);
  });

  it('finds Sydney\'s spring change', () => {
    expect(clockChanges('2026-09-01', '2026-12-01', SYDNEY)).toEqual([{ day: '2026-10-04', direction: 'forward' }]);
  });

  it('finds both in a full year, and none where there are none', () => {
    expect(clockChanges('2026-01-05', '2026-12-18', TORONTO)).toEqual([
      { day: '2026-03-08', direction: 'forward' },
      { day: '2026-11-01', direction: 'back' },
    ]);
    expect(clockChanges('2026-01-05', '2026-12-18', KOLKATA)).toEqual([]);
  });
});

describe('planning a write', () => {
  /** What a class would have stored, each with an id. */
  const stored = (p: ClassPattern, tz = TORONTO): ClassInstance[] =>
    meetingDays(p).map((d, i) => ({ id: `s${i}`, ...sessionOn(d, p, tz) }));

  it('creates every meeting, and nothing else, from nothing', () => {
    const p = lecture({ skip_days: ['2026-10-13'] });
    const plan = planClass([], p, p.first_day, TORONTO, false);
    expect(plan.insert).toHaveLength(26);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(plan.insert[0]).toEqual({ starts_at: '2026-09-08T14:15:00.000Z', ends_at: '2026-09-08T15:30:00.000Z' });
  });

  it('changes nothing when nothing changed', () => {
    const plan = planClass(stored(lecture()), lecture(), '2026-10-14', TORONTO, false);
    expect(plan).toMatchObject({ insert: [], update: [], remove: [], moved: 0, before: 11 });
  });

  it('moves only the sessions from the chosen day, in place', () => {
    const rows = stored(lecture());
    const plan = planClass(rows, lecture({ start_time: '10:30', end_time: '11:45' }), '2026-10-14', TORONTO, false);
    // Eleven met before Wed 14 Oct (8 Sep to 13 Oct) and are left alone.
    expect(plan.before).toBe(11);
    expect(plan.moved).toBe(16);
    expect(plan.update).toHaveLength(16);
    expect(plan.insert).toEqual([]);
    expect(plan.remove).toEqual([]);
    // Updated in place: the ids are the stored ones from the 15th on.
    expect(plan.update[0].id).toBe(rows[11].id);
    expect(plan.update[0].starts_at).toBe('2026-10-15T14:30:00.000Z');
    // And after the change the new time is still 10:30 local.
    const nov = plan.update.find((u) => u.starts_at.startsWith('2026-11-03'));
    expect(nov?.starts_at).toBe('2026-11-03T15:30:00.000Z');
  });

  it('swaps a day: Thursdays go, Fridays come, earlier weeks untouched', () => {
    const plan = planClass(stored(lecture()), lecture({ weekdays: [2, 5] }), '2026-10-14', TORONTO, false);
    // Thu 15 Oct .. Thu 3 Dec: eight Thursdays removed; Fri 16 Oct .. Fri 4 Dec: eight Fridays added.
    expect(plan.remove).toHaveLength(8);
    expect(plan.insert).toHaveLength(8);
    expect(plan.insert[0].starts_at).toBe('2026-10-16T14:15:00.000Z');
    expect(plan.update).toEqual([]);
    expect(plan.before).toBe(11);
  });

  it('rewrites kept sessions for a new room or title without counting a move', () => {
    const plan = planClass(stored(lecture()), lecture(), '2026-10-14', TORONTO, true);
    expect(plan.update).toHaveLength(16);
    expect(plan.moved).toBe(0);
  });

  it('removes a session when its day is skipped later', () => {
    const plan = planClass(stored(lecture()), lecture({ skip_days: ['2026-10-20'] }), '2026-10-14', TORONTO, false);
    expect(plan.remove).toEqual(['s12']);
    expect(plan.insert).toEqual([]);
  });

  it('ends a class by removing what comes after the last day', () => {
    const rows = stored(lecture());
    const plan = planClass(rows, lecture({ last_day: '2026-11-20' }), '2026-11-21', TORONTO, false);
    // 24 Nov, 26 Nov, 1 Dec, 3 Dec, 8 Dec.
    expect(plan.remove).toHaveLength(5);
    expect(plan.insert).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.before).toBe(22);
  });

  it('collapses two sessions on one day to one', () => {
    const rows = stored(lecture());
    const twin = { ...rows[20], id: 'twin' };
    const plan = planClass([...rows, twin], lecture(), '2026-10-14', TORONTO, false);
    expect(plan.remove).toHaveLength(1);
    expect(plan.insert).toEqual([]);
  });

  it('reads a stored session\'s day in the account\'s zone, not UTC', () => {
    // 21:00 in Vancouver is 04:00Z the next day. Read as UTC it would be the
    // wrong day and get removed as off-pattern.
    const evening = lecture({ start_time: '21:00', end_time: '22:15' });
    const plan = planClass(stored(evening, VANCOUVER), evening, '2026-10-14', VANCOUVER, false);
    expect(plan).toMatchObject({ insert: [], update: [], remove: [] });
  });
});

describe('describing the days', () => {
  it('writes them out', () => {
    expect(describeDays([4, 2])).toBe('Tue, Thu');
    expect(describeDays([1, 2, 3, 4, 5])).toBe('Weekdays');
    expect(describeDays([1, 2, 3, 4, 5, 6, 7])).toBe('Every day');
  });
});
