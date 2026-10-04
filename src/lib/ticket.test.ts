import { describe, it, expect, beforeAll } from 'vitest';
import { ticketFace, stubSize } from './ticket';
import { setActiveTimezone } from './time';
import { urgencyFor } from './urgency';

const tz = 'America/Toronto';
beforeAll(() => setActiveTimezone(tz));

// Sunday 4 Oct 2026, 10:00 a.m. EDT.
const now = new Date('2026-10-04T10:00:00-04:00');
const face = (iso: string | null, hasTime = true) => {
  const due = iso ? new Date(iso) : null;
  return ticketFace(urgencyFor(due, { now }), due, hasTime, now, tz);
};

describe('ticketFace', () => {
  it('prints the clock time for later today, and no time in the meta', () => {
    expect(face('2026-10-04T15:00:00-04:00')).toEqual({ big: '3:00', unit: 'p.m.', when: null });
  });

  it('counts minutes under an hour, and moves the time to the meta', () => {
    expect(face('2026-10-04T10:45:00-04:00')).toEqual({ big: '45', unit: 'min', when: '10:45 a.m.' });
  });

  it('says Today / end of day for a date-only deadline, never "0 today"', () => {
    expect(face('2026-10-04T23:59:00-04:00', false)).toEqual({ big: 'Today', unit: 'end of day', when: null });
  });

  it('counts days and names the weekday within the week', () => {
    expect(face('2026-10-07T23:59:00-04:00', false)).toEqual({ big: '3', unit: 'days', when: 'Wed' });
    expect(face('2026-10-05T09:00:00-04:00')).toEqual({ big: '1', unit: 'day', when: 'Mon 9:00 a.m.' });
  });

  it('writes the date beyond the coming week', () => {
    expect(face('2026-10-16T23:59:00-04:00', false).when).toBe('Fri, Oct 16');
  });

  it('says how late, and when it was due', () => {
    expect(face('2026-10-03T23:59:00-04:00', false)).toEqual({ big: '1', unit: 'day late', when: 'was due Sat' });
  });

  it('prints the passed time for something late from earlier today', () => {
    expect(face('2026-10-04T09:00:00-04:00')).toEqual({ big: '9:00', unit: 'a.m. · late', when: null });
  });

  it('says no date for undated work', () => {
    expect(face(null)).toEqual({ big: '—', unit: 'no date', when: null });
  });
});

describe('stubSize', () => {
  it('steps a time and a word down so they fit the stub', () => {
    expect(stubSize('3')).toBe('');
    expect(stubSize('12')).toBe('');
    expect(stubSize('3:00')).toBe('stub-time');
    expect(stubSize('11:59')).toBe('stub-time stub-time-long');
    expect(stubSize('Today')).toBe('stub-word');
  });
});
