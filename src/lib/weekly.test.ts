import { describe, it, expect } from 'vitest';
import { buildWeekly, decideWeekly, type WeeklyInput, type WeeklySettings } from '../../supabase/functions/_shared/weekly';

const base: WeeklyInput = {
  today: '2026-08-23', // a Sunday
  finished: [],
  upcoming: [],
  overdue: [],
  stuck: [],
};

const w = (o: Partial<WeeklyInput>) => buildWeekly({ ...base, ...o });

const settings = (o: Partial<WeeklySettings> = {}): WeeklySettings => ({
  timezone: 'America/Toronto',
  weekly_review_enabled: true,
  weekly_review_weekday: 7,
  digest_hour: 7,
  digest_minute: 0,
  ...o,
});

/** 2026-08-23 is a Sunday. 11:00Z is 07:00 EDT. */
const sundayAt = (utcHour: number, minute = 0) =>
  new Date(Date.UTC(2026, 7, 23, utcHour, minute));

describe('decideWeekly', () => {
  it('sends on the chosen weekday inside the window', () => {
    expect(decideWeekly(settings(), sundayAt(11), false)).toMatchObject({ send: true });
  });

  it('does not send on other days', () => {
    // Saturday.
    const saturday = new Date(Date.UTC(2026, 7, 22, 11));
    expect(decideWeekly(settings(), saturday, false)).toMatchObject({ send: false, reason: 'wrong-day' });
  });

  it('respects a different chosen weekday', () => {
    const monday = new Date(Date.UTC(2026, 7, 24, 11));
    expect(decideWeekly(settings({ weekly_review_weekday: 1 }), monday, false)).toMatchObject({ send: true });
  });

  it('is off unless asked for', () => {
    // A second recurring notification arriving unasked is how the whole app
    // gets muted.
    expect(decideWeekly(settings({ weekly_review_enabled: false }), sundayAt(11), false))
      .toMatchObject({ send: false, reason: 'disabled' });
  });

  it('does not send twice', () => {
    expect(decideWeekly(settings(), sundayAt(11), true)).toMatchObject({ send: false, reason: 'already-sent' });
  });

  it('waits until the time, and gives up long after it', () => {
    expect(decideWeekly(settings(), sundayAt(9), false)).toMatchObject({ send: false, reason: 'too-early' });
    expect(decideWeekly(settings(), sundayAt(20), false)).toMatchObject({ send: false, reason: 'window-missed' });
  });

  it('still sends a little late, because a late review beats none', () => {
    expect(decideWeekly(settings(), sundayAt(12, 30), false)).toMatchObject({ send: true });
  });
});

describe('buildWeekly', () => {
  it('names what was finished rather than counting it', () => {
    // "You finished 4 things" invites a comparison with last week, which is
    // the first step to a score.
    const m = w({ finished: [{ title: 'Lab 2' }, { title: 'Essay draft' }] });
    expect(m.body).toContain('Finished: Lab 2, Essay draft.');
    expect(m.body).not.toMatch(/\b2 things finished|you finished 2\b/i);
  });

  it('summarises the week ahead with the estimate it actually has', () => {
    const m = w({
      upcoming: [
        { title: 'A', due_day: '2026-08-25', effort_minutes: 120 },
        { title: 'B', due_day: '2026-08-27', effort_minutes: 180 },
        { title: 'C', due_day: '2026-08-28', effort_minutes: null },
      ],
    });
    expect(m.body).toContain('Next seven days: 3 things due, 5 hours of it estimated, 1 with no estimate.');
  });

  it('says a quiet week is quiet, without lamenting it', () => {
    const m = w({});
    expect(m.body).toBe('Nothing is due in the next seven days.');
    expect(m.body).not.toMatch(/nothing done|no progress|missed|should/i);
  });

  it('reports overdue work as a fact', () => {
    const m = w({ overdue: [{ title: 'Problem set 3', due_day: '2026-08-18' }] });
    expect(m.body).toContain('Past its date: Problem set 3.');
    expect(m.body).not.toMatch(/still|again|failed|behind/i);
  });

  it('suggests breaking down the most-pushed task', () => {
    const m = w({ stuck: [{ title: 'Group project', deferrals: 8 }] });
    expect(m.body).toContain('"Group project" has moved 8 times.');
    expect(m.body).toMatch(/breaking into a first step, or dropping/);
  });

  it('never mentions streaks or consecutive weeks', () => {
    const m = w({
      finished: [{ title: 'A' }],
      upcoming: [{ title: 'B', due_day: '2026-08-25', effort_minutes: 60 }],
      overdue: [{ title: 'C', due_day: '2026-08-18' }],
      stuck: [{ title: 'D', deferrals: 7 }],
    });
    expect(m.body).not.toMatch(/streak|in a row|consecutive|last week|best week|keep it up/i);
  });

  it('truncates a long list rather than sending a wall of text', () => {
    const m = w({ finished: Array.from({ length: 9 }, (_, i) => ({ title: `T${i}` })) });
    expect(m.body).toContain('and 3 more.');
  });

  it('titles the message with the week that is starting', () => {
    // Sent on Sunday, which belongs to the week ahead rather than the one
    // just gone.
    expect(w({}).title).toBe('Week of Aug 24');
  });
});
