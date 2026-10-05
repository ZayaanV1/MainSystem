import { describe, it, expect, beforeAll } from 'vitest';
import { dayChoices, dayLabel, reminderAt, reminderLabel, reminderMode, timeLabel } from './dueChoices';
import { setActiveTimezone } from './time';

const tz = 'America/Toronto';
beforeAll(() => setActiveTimezone(tz));

// Sunday 4 Oct 2026.
const today = '2026-10-04';

describe('dayLabel', () => {
  it('names the near days and dates the far ones', () => {
    expect(dayLabel('2026-10-04', today)).toBe('Today');
    expect(dayLabel('2026-10-05', today)).toBe('Tomorrow');
    expect(dayLabel('2026-10-09', today)).toBe('Fri 9');
    expect(dayLabel('2026-10-11', today)).toBe('Next Sun');
    expect(dayLabel('2026-10-15', today)).toBe('Thu 15 Oct');
  });
});

describe('dayChoices', () => {
  it('offers today, tomorrow, Friday, Sunday and a week out, in order, without repeats', () => {
    // From Sunday, the coming Sunday IS a week out: one chip, not two.
    expect(dayChoices(today, null).map((c) => c.label)).toEqual(['Today', 'Tomorrow', 'Fri 9', 'Next Sun']);
  });

  it('keeps the current due day as a chip when it is none of those', () => {
    const labels = dayChoices(today, '2026-10-21').map((c) => c.label);
    expect(labels[labels.length - 1]).toBe('Wed 21 Oct');
  });

  it('keeps the day the editor opened with after another is chosen, so the row does not shift', () => {
    const labels = dayChoices(today, '2026-10-09', '2026-10-21').map((c) => c.label);
    expect(labels).toContain('Wed 21 Oct');
  });

  it('from a Thursday, Friday is tomorrow and Sunday is in three days', () => {
    expect(dayChoices('2026-10-08', null).map((c) => c.label)).toEqual(['Today', 'Tomorrow', 'Sun 11', 'Next Thu']);
  });
});

describe('timeLabel', () => {
  it('reads the stored times the way the app writes times', () => {
    expect(timeLabel(null)).toBe('End of day');
    expect(timeLabel('09:00')).toBe('9:00 a.m.');
    expect(timeLabel('12:00')).toBe('Noon');
    expect(timeLabel('17:00')).toBe('5:00 p.m.');
    expect(timeLabel('23:59')).toBe('11:59 p.m.');
  });
});

describe('reminders relative to the deadline', () => {
  it('computes local wall-clock instants, across the November DST change', () => {
    // Due Mon 2 Nov; the day before is Sun 1 Nov, the day the clocks go back.
    expect(reminderAt('dayBefore', '2026-11-02', tz)).toBe('2026-11-01T23:00:00.000Z'); // 6 p.m. EST
    expect(reminderAt('twoDays', '2026-11-02', tz)).toBe('2026-10-31T22:00:00.000Z'); // 6 p.m. EDT
    expect(reminderAt('morning', '2026-11-02', tz)).toBe('2026-11-02T13:00:00.000Z'); // 8 a.m. EST
  });

  it('has no reminder without a due day', () => {
    expect(reminderAt('morning', null, tz)).toBeNull();
  });

  it('recognises a stored reminder as the chip that made it, and anything else as exact', () => {
    const due = '2026-10-07';
    expect(reminderMode(reminderAt('dayBefore', due, tz), due, tz)).toBe('dayBefore');
    expect(reminderMode('2026-10-06T14:30:00.000Z', due, tz)).toBe('exact');
    expect(reminderMode(null, due, tz)).toBe('none');
  });

  it('reads a reminder back in words', () => {
    expect(reminderLabel('2026-10-06T22:00:00.000Z', today, tz)).toBe('Tue 6 Oct, 6:00 p.m.');
  });
});
