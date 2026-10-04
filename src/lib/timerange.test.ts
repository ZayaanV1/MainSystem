import { describe, it, expect } from 'vitest';
import { formatTimeRange } from './time';

const tz = 'America/Toronto';
// 4 Oct 2026 is EDT, UTC-4.
const at = (hhmm: string) => new Date(`2026-10-04T${hhmm}:00-04:00`);

describe('formatTimeRange', () => {
  it('writes one period when both ends share it', () => {
    expect(formatTimeRange(at('10:15'), at('11:30'), tz)).toBe('10:15 – 11:30 a.m.');
    expect(formatTimeRange(at('17:00'), at('18:00'), tz)).toBe('5:00 – 6:00 p.m.');
  });

  it('keeps both periods across noon, so a morning class never reads as p.m.', () => {
    expect(formatTimeRange(at('11:30'), at('13:00'), tz)).toBe('11:30 a.m. – 1:00 p.m.');
  });

  it('is the start alone when there is no end', () => {
    expect(formatTimeRange(at('09:00'), null, tz)).toBe('9:00 a.m.');
  });

  it('spaces the dash, never "10:15a.m.-11:30a.m."', () => {
    expect(formatTimeRange(at('10:15'), at('11:30'), tz)).not.toMatch(/\d[ap]|m\.-/u);
  });
});
