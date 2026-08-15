import { describe, it, expect } from 'vitest';
import {
  addDays,
  daysBetween,
  daysUntil,
  endOfDayUTC,
  formatDay,
  isToday,
  localDayKey,
  startOfDayUTC,
  todayKey,
  wallClockToUTC,
  zoneAbbrev,
} from './time';

/**
 * Toronto's 2026 DST transitions, which every test below is built around:
 *
 *   Sun 8 Mar 2026, 02:00 EST  -> 03:00 EDT   (spring forward, 23-hour day)
 *   Sun 1 Nov 2026, 02:00 EDT  -> 01:00 EST   (fall back,      25-hour day)
 *
 * Midnight exists and is unambiguous on both days, because both transitions
 * happen at 02:00. That is what makes local midnight a safe day boundary.
 */

const utc = (iso: string) => new Date(iso);

describe('localDayKey — a day is the local day, not the UTC day', () => {
  it('assigns a late-evening instant to the local date, not tomorrow', () => {
    // 02:00Z on 15 Aug is 22:00 EDT on 14 Aug. This is the single most common
    // way a planner shows a task on the wrong day.
    expect(localDayKey(utc('2026-08-15T02:00:00Z'))).toBe('2026-08-14');
  });

  it('handles the same trap in winter, when the offset is different', () => {
    // 02:00Z on 15 Jan is 21:00 EST on 14 Jan.
    expect(localDayKey(utc('2026-01-15T02:00:00Z'))).toBe('2026-01-14');
  });

  it('rolls over exactly at local midnight in summer', () => {
    expect(localDayKey(utc('2026-08-15T03:59:59Z'))).toBe('2026-08-14');
    expect(localDayKey(utc('2026-08-15T04:00:00Z'))).toBe('2026-08-15');
  });

  it('rolls over exactly at local midnight in winter', () => {
    expect(localDayKey(utc('2026-01-15T04:59:59Z'))).toBe('2026-01-14');
    expect(localDayKey(utc('2026-01-15T05:00:00Z'))).toBe('2026-01-15');
  });

  it('todayKey agrees with localDayKey', () => {
    const now = utc('2026-08-15T18:30:00Z');
    expect(todayKey(now)).toBe(localDayKey(now));
  });
});

describe('startOfDayUTC — local midnight, across both DST transitions', () => {
  it('is UTC-5 the day the clocks spring forward (transition is at 02:00)', () => {
    expect(startOfDayUTC('2026-03-08').toISOString()).toBe('2026-03-08T05:00:00.000Z');
  });

  it('is UTC-4 the day after springing forward', () => {
    expect(startOfDayUTC('2026-03-09').toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });

  it('is UTC-4 the day the clocks fall back (transition is at 02:00)', () => {
    expect(startOfDayUTC('2026-11-01').toISOString()).toBe('2026-11-01T04:00:00.000Z');
  });

  it('is UTC-5 the day after falling back', () => {
    expect(startOfDayUTC('2026-11-02').toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });
});

describe('day length — the boundaries stay airtight when a day is not 24h', () => {
  it('the spring-forward day is 23 hours long', () => {
    const ms = endOfDayUTC('2026-03-08').getTime() - startOfDayUTC('2026-03-08').getTime();
    expect(ms / 3_600_000).toBe(23);
  });

  it('the fall-back day is 25 hours long', () => {
    const ms = endOfDayUTC('2026-11-01').getTime() - startOfDayUTC('2026-11-01').getTime();
    expect(ms / 3_600_000).toBe(25);
  });

  it('an entry logged in the repeated hour still belongs to that day', () => {
    // 01:30 EDT and 01:30 EST both occur on 1 Nov. Neither may leak into
    // 31 Oct or 2 Nov, or a day's food log silently loses an entry.
    const firstPass = utc('2026-11-01T05:30:00Z'); // 01:30 EDT
    const secondPass = utc('2026-11-01T06:30:00Z'); // 01:30 EST
    expect(localDayKey(firstPass)).toBe('2026-11-01');
    expect(localDayKey(secondPass)).toBe('2026-11-01');
  });

  it('leaves no gap between one day ending and the next beginning', () => {
    for (const day of ['2026-03-07', '2026-03-08', '2026-10-31', '2026-11-01']) {
      expect(endOfDayUTC(day).getTime()).toBe(startOfDayUTC(addDays(day, 1)).getTime());
    }
  });
});

describe('wallClockToUTC — the 07:00 digest fires at 07:00 all year', () => {
  it('is 12:00Z in winter', () => {
    expect(wallClockToUTC('2026-01-15', 7).toISOString()).toBe('2026-01-15T12:00:00.000Z');
  });

  it('is 11:00Z in summer', () => {
    expect(wallClockToUTC('2026-08-15', 7).toISOString()).toBe('2026-08-15T11:00:00.000Z');
  });

  it('shifts by exactly one hour the morning after springing forward', () => {
    expect(wallClockToUTC('2026-03-07', 7).toISOString()).toBe('2026-03-07T12:00:00.000Z');
    expect(wallClockToUTC('2026-03-08', 7).toISOString()).toBe('2026-03-08T11:00:00.000Z');
  });

  it('shifts back by exactly one hour the morning the clocks fall back', () => {
    expect(wallClockToUTC('2026-10-31', 7).toISOString()).toBe('2026-10-31T11:00:00.000Z');
    expect(wallClockToUTC('2026-11-01', 7).toISOString()).toBe('2026-11-01T12:00:00.000Z');
  });

  it('handles a non-zero minute, for a configured digest time', () => {
    expect(wallClockToUTC('2026-08-15', 7, 30).toISOString()).toBe('2026-08-15T11:30:00.000Z');
  });
});

describe('addDays / daysBetween — calendar arithmetic, immune to DST', () => {
  it('crosses the spring-forward boundary as a single day', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(daysBetween('2026-03-07', '2026-03-08')).toBe(1);
  });

  it('crosses the fall-back boundary as a single day', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1);
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('handles February in a non-leap year', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('handles February in a leap year', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('round-trips over a span containing both transitions', () => {
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
    expect(addDays('2026-01-01', 365)).toBe('2027-01-01');
  });

  it('is negative when going backwards', () => {
    expect(daysBetween('2026-08-15', '2026-08-10')).toBe(-5);
  });
});

describe('daysUntil — what drives the proximity colour flags', () => {
  const now = utc('2026-08-15T16:00:00Z'); // 12:00 EDT, Sat 15 Aug

  it('is 0 for something due later today', () => {
    expect(daysUntil(utc('2026-08-15T23:00:00Z'), now)).toBe(0); // 19:00 EDT
  });

  it('is still 0 for something due at 11pm tonight', () => {
    // 23:00 EDT on the 15th is 03:00Z on the 16th. A naive UTC comparison
    // reads this as tomorrow and drops it off the Today view.
    expect(daysUntil(utc('2026-08-16T03:00:00Z'), now)).toBe(0);
  });

  it('is 1 for something due tomorrow morning', () => {
    expect(daysUntil(utc('2026-08-16T13:00:00Z'), now)).toBe(1); // 09:00 EDT
  });

  it('is negative for something overdue', () => {
    expect(daysUntil(utc('2026-08-13T13:00:00Z'), now)).toBe(-2);
  });

  it('counts calendar days, not 24-hour blocks, across the fall-back', () => {
    const late = utc('2026-10-31T16:00:00Z'); // 12:00 EDT, Sat 31 Oct
    expect(daysUntil(utc('2026-11-01T17:00:00Z'), late)).toBe(1); // 12:00 EST, Sun
  });
});

describe('isToday', () => {
  const now = utc('2026-08-15T16:00:00Z');

  it('is true for an instant later the same local day', () => {
    expect(isToday(utc('2026-08-16T03:00:00Z'), now)).toBe(true); // 23:00 EDT
  });

  it('is false once the local day has rolled over', () => {
    expect(isToday(utc('2026-08-16T04:00:00Z'), now)).toBe(false); // 00:00 EDT
  });
});

describe('display helpers', () => {
  it('reports the correct zone abbreviation on each side of a transition', () => {
    expect(zoneAbbrev(utc('2026-01-15T12:00:00Z'))).toBe('EST');
    expect(zoneAbbrev(utc('2026-08-15T12:00:00Z'))).toBe('EDT');
  });

  it('formats a day key on its own local date, not the UTC one', () => {
    // startOfDayUTC('2026-08-15') is 04:00Z; formatting must not read that
    // back as the 15th in UTC and the 14th locally, or vice versa.
    expect(formatDay('2026-08-15')).toContain('15');
    expect(formatDay('2026-08-15')).toContain('Sat');
  });
});
