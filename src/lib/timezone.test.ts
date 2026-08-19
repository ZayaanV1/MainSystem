import { describe, it, expect, beforeEach } from 'vitest';
import {
  activeTimezone,
  localDayKey,
  setActiveTimezone,
  todayKey,
  wallClockToUTC,
  formatTime,
} from './time';

/**
 * The account's timezone, not the browser's.
 *
 * This is the multi-user version of the failure the whole time layer exists to
 * prevent. While there was one user in one city, a hardcoded zone was correct.
 * With many, a user in Vancouver reading a day computed in Toronto is off by
 * three hours — which silently moves what "due today" means, and moves it
 * without any error to notice.
 *
 * Every case below is a real instant near a boundary, because the middle of
 * the afternoon agrees in every zone and proves nothing.
 */
describe('the active timezone follows the account', () => {
  beforeEach(() => {
    setActiveTimezone('America/Toronto');
  });

  it('is settable and readable', () => {
    setActiveTimezone('Asia/Tokyo');
    expect(activeTimezone()).toBe('Asia/Tokyo');
  });

  it('changes which day an instant falls on', () => {
    // 02:00 UTC on 20 Aug: still the 19th in Toronto, already the 20th in Tokyo.
    const instant = new Date('2026-08-20T02:00:00Z');

    setActiveTimezone('America/Toronto');
    expect(localDayKey(instant)).toBe('2026-08-19');

    setActiveTimezone('Asia/Tokyo');
    expect(localDayKey(instant)).toBe('2026-08-20');
  });

  it('changes what "today" is', () => {
    const now = new Date('2026-08-20T05:30:00Z');

    setActiveTimezone('America/Vancouver');
    expect(todayKey(now)).toBe('2026-08-19');

    setActiveTimezone('Europe/London');
    expect(todayKey(now)).toBe('2026-08-20');
  });

  it('changes the instant a wall-clock deadline lands on', () => {
    // "Due 23:59 on the 20th" is a different moment in each city, which is the
    // entire point: the deadline belongs to the term, not to UTC.
    setActiveTimezone('America/Toronto');
    const toronto = wallClockToUTC('2026-08-20', 23, 59).toISOString();

    setActiveTimezone('Asia/Tokyo');
    const tokyo = wallClockToUTC('2026-08-20', 23, 59).toISOString();

    expect(toronto).toBe('2026-08-21T03:59:00.000Z');
    expect(tokyo).toBe('2026-08-20T14:59:00.000Z');
  });

  it('survives a DST boundary in whichever zone is active', () => {
    // Toronto leaves DST on 1 Nov 2026; London left it a week earlier.
    setActiveTimezone('America/Toronto');
    expect(wallClockToUTC('2026-11-01', 12, 0).toISOString()).toBe('2026-11-01T17:00:00.000Z');

    setActiveTimezone('Europe/London');
    expect(wallClockToUTC('2026-11-01', 12, 0).toISOString()).toBe('2026-11-01T12:00:00.000Z');
  });

  it('renders a time in the account zone', () => {
    const instant = new Date('2026-08-20T20:00:00Z');

    setActiveTimezone('America/Toronto');
    const toronto = formatTime(instant);

    setActiveTimezone('Asia/Tokyo');
    const tokyo = formatTime(instant);

    expect(toronto).not.toBe(tokyo);
    expect(toronto).toMatch(/4:00/);
    expect(tokyo).toMatch(/5:00/);
  });

  it('keeps working when handed a zone that does not exist', () => {
    // A bad value in a settings row must not make every date in the app throw.
    setActiveTimezone('America/Toronto');
    setActiveTimezone('Not/AZone');
    expect(activeTimezone()).toBe('America/Toronto');
    expect(() => todayKey()).not.toThrow();
  });

  it('ignores an empty or missing zone rather than resetting to a default', () => {
    setActiveTimezone('Asia/Tokyo');
    setActiveTimezone(undefined);
    setActiveTimezone(null);
    setActiveTimezone('');
    expect(activeTimezone()).toBe('Asia/Tokyo');
  });

  it('still honours an explicitly passed zone over the active one', () => {
    // The shared functions keep their tz argument precisely so the server can
    // stay per-request. This proves the wrapper does not swallow it.
    setActiveTimezone('Asia/Tokyo');
    expect(localDayKey(new Date('2026-08-20T02:00:00Z'), 'America/Toronto')).toBe('2026-08-19');
  });
});
