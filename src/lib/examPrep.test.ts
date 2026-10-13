import { describe, expect, it } from 'vitest';
import { prepSessions } from './examPrep';

describe('prepSessions', () => {
  it('spaces sessions 10, 7, 4, 2 and 1 days out when there is time', () => {
    expect(prepSessions('2026-10-30', '2026-10-12').map((s) => s.day)).toEqual([
      '2026-10-20',
      '2026-10-23',
      '2026-10-26',
      '2026-10-28',
      '2026-10-29',
    ]);
  });

  it('offers only the sessions still ahead', () => {
    // Thursday's exam, planned on Monday: 2 and 1 days out.
    const s = prepSessions('2026-10-15', '2026-10-12');
    expect(s.map((x) => x.title)).toEqual(['A practice exam, timed', 'Light review of the summary sheet']);
  });

  it('never schedules a session in the past or on the exam day', () => {
    for (const s of prepSessions('2026-10-20', '2026-10-12')) {
      expect(s.day >= '2026-10-12' && s.day < '2026-10-20').toBe(true);
    }
  });

  it('has nothing to offer once the exam is today or past', () => {
    expect(prepSessions('2026-10-12', '2026-10-12')).toEqual([]);
    expect(prepSessions('2026-10-01', '2026-10-12')).toEqual([]);
  });

  it('gives each session a size', () => {
    expect(prepSessions('2026-10-30', '2026-10-12').every((s) => s.effort_minutes > 0)).toBe(true);
  });
});
