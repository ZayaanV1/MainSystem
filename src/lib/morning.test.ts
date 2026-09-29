import { describe, it, expect } from 'vitest';
import { fallbackMorning, morningSchedule, strayTimes } from '../../supabase/functions/_shared/morning';

const TZ = 'America/Toronto';

describe('the morning text', () => {
  // Mon 21 Sep 2026, EDT (UTC-4).
  const events = [
    { title: 'Gym', starts_at: '2026-09-21T21:00:00Z', all_day: false },
    { title: 'Travel', starts_at: '2026-09-21T14:00:00Z', all_day: false },
    { title: 'FB S150 - COEN 231-U - TUT', starts_at: '2026-09-21T15:45:00Z', all_day: false },
  ];
  const work = [{ title: 'Assignment 2', due_at: '2026-09-22T03:59:00Z', due_has_time: true, course: 'MATH 205' }];

  it('lists the day in order, in local time, the way a friend writes it', () => {
    const m = morningSchedule(events, work, TZ);
    expect(m.lines).toEqual([
      '10:00 Travel',
      '11:45 COEN 231 tutorial (room FB S150)',
      '5:00 Gym',
      'due at 11:59pm: Assignment 2 (MATH 205)',
    ]);
    expect(m.shape).toBe('busy');
  });

  it('refuses a written text that names a time the calendar did not give', () => {
    const m = morningSchedule(events, work, TZ);
    expect(strayTimes(['saw travel at 10:00, COEN 231 at 11:45, gym at 5:00, assignment 2 due at 11:59pm'], m.times)).toEqual([]);
    expect(strayTimes(['gym at 5:00 to 8:00'], m.times)).toEqual(['8:00']);
    // The UTC instant read out as local is the classic wrong deadline.
    expect(strayTimes(['due at 3:59am'], m.times)).toEqual(['3:59am']);
  });

  it('has a plain version that is right without a model, including an empty day', () => {
    const m = morningSchedule(events, work, TZ);
    const [hi, list] = fallbackMorning(m, 'Monday', true);
    expect(hi).toContain('morning bro');
    expect(list).toContain('11:45 COEN 231 tutorial');
    expect(fallbackMorning(morningSchedule([], [], TZ), 'Sunday', false)[1]).toContain('sunday looks wide open');
  });
});
