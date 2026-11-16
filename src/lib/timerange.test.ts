import { describe, it, expect, vi } from 'vitest';
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

  it('writes the period itself, whatever the runtime calls it', () => {
    // Safari formats en-CA as "5:00 PM"; the shared-period rule then never
    // matched and a phone printed "5:00 PM – 8:00 PM".
    const Real = Intl.DateTimeFormat;
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locale?: string, options?: Intl.DateTimeFormatOptions) {
      const real = new Real(locale, options);
      return {
        format: (d: Date) => real.format(d),
        formatToParts: (d: Date) =>
          real.formatToParts(d).map((p) => (p.type === 'dayPeriod' ? { ...p, value: /^p/i.test(p.value) ? 'PM' : 'AM' } : p)),
      } as Intl.DateTimeFormat;
    } as never);
    // A zone no other test here has asked for, so the formatter is made under the stub.
    const zone = 'America/Halifax';
    expect(formatTimeRange(at('16:00'), at('19:00'), zone)).toBe('5:00 – 8:00 p.m.');
    expect(formatTimeRange(at('10:30'), at('12:00'), zone)).toBe('11:30 a.m. – 1:00 p.m.');
    spy.mockRestore();
  });
});
