import { describe, it, expect, beforeAll } from 'vitest';
import { rowWhen } from './rowWhen';
import { setActiveTimezone } from './time';
import { urgencyFor } from './urgency';

const tz = 'America/Toronto';
beforeAll(() => setActiveTimezone(tz));

// Monday 12 Oct 2026, 10:20 a.m. EDT.
const now = new Date('2026-10-12T10:20:00-04:00');
const when = (iso: string | null, hasTime = true, dayShown = false, done = false) => {
  const due = iso ? new Date(iso) : null;
  return rowWhen(urgencyFor(due, { now, done }), due, hasTime, now, { dayShown, tz });
};

describe('rowWhen', () => {
  it('says how late, in days, once a day has passed', () => {
    expect(when('2026-10-11T23:59:00-04:00', false)).toBe('1 day late');
    expect(when('2026-10-09T17:00:00-04:00')).toBe('3 days late');
  });

  it('gives the time for something that passed earlier today', () => {
    expect(when('2026-10-12T09:00:00-04:00')).toBe('9:00 a.m.');
  });

  it('says End of day for a date-only deadline today, even under a heading that names the day', () => {
    expect(when('2026-10-12T23:59:00-04:00', false)).toBe('End of day');
    expect(when('2026-10-12T23:59:00-04:00', false, true)).toBe('End of day');
  });

  it('gives the time for later today, and minutes under an hour', () => {
    expect(when('2026-10-12T15:00:00-04:00')).toBe('3:00 p.m.');
    expect(when('2026-10-12T10:45:00-04:00')).toBe('In 25 min');
  });

  it('names the day only when the heading does not', () => {
    expect(when('2026-10-13T23:59:00-04:00', false)).toBe('Tomorrow');
    expect(when('2026-10-13T23:59:00-04:00', false, true)).toBeNull();
    expect(when('2026-10-13T09:00:00-04:00', true, true)).toBe('9:00 a.m.');
    expect(when('2026-10-15T23:59:00-04:00', false)).toBe('Thu');
    expect(when('2026-10-18T17:00:00-04:00')).toBe('Sun 5:00 p.m.');
  });

  it('writes the date beyond the coming week', () => {
    expect(when('2026-10-24T23:59:00-04:00', false)).toBe('Oct 24');
  });

  it('has nothing to add for undated or finished work', () => {
    expect(when(null)).toBeNull();
    expect(when('2026-10-11T23:59:00-04:00', false, false, true)).toBeNull();
  });
});
