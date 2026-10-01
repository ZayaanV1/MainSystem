import { describe, it, expect } from 'vitest';
import { buildContext, type ContextInput } from '../../supabase/functions/_shared/context';

const base: ContextInput = {
  today: '2026-08-19',
  now: '18:00',
  timezone: 'America/Toronto',
  assignments: [],
  events: [],
  checklist: [],
};

const ctx = (o: Partial<ContextInput>) => buildContext({ ...base, ...o });

describe('buildContext', () => {
  it('collects every id the model may cite or act on', () => {
    const { knownIds } = ctx({
      assignments: [{ id: 'a1', title: 'Essay', due_at: '2026-09-01T03:59:00Z', due_has_time: true, status: 'todo', effort_minutes: 120 }],
      events: [{ id: 'e1', title: 'Midterm', kind: 'exam', starts_at: '2026-10-22T22:00:00Z', all_day: false }],
      checklist: [{ id: 'c1', title: 'Adderall', done_today: true, doses_remaining: 28 }],
    });
    expect([...knownIds].sort()).toEqual(['a1', 'c1', 'e1']);
  });

  it('says a section is empty rather than omitting it', () => {
    // An absent heading reads as "not provided"; an empty one reads as
    // "nothing there", and only the second supports an honest answer.
    const { text } = ctx({});
    expect(text).toContain('(nothing open)');
    expect(text).toContain('(none in the next month)');
    expect(text).toContain('(nothing due today)');
  });

  it('renders a deadline in local time, not UTC', () => {
    // The bug this exists for: 2026-08-21T03:59Z is Thursday 23:59 in Toronto,
    // and slicing the ISO string reports it as Friday 03:59 — a deadline moved
    // a day later, stated confidently. It got past a first live test looking
    // entirely plausible.
    const { text } = ctx({
      assignments: [{ id: 'a1', title: 'Assembly lab 2', due_at: '2026-08-21T03:59:00Z', due_has_time: true, status: 'todo', effort_minutes: null }],
    });
    expect(text).toContain('due Thu 2026-08-20 23:59');
    expect(text).not.toContain('2026-08-21');
  });

  it('renders an event in local time too', () => {
    // 22:00Z in August is 18:00 EDT.
    const { text } = ctx({
      events: [{ id: 'e1', title: 'Midterm', kind: 'exam', starts_at: '2026-08-25T22:00:00Z', all_day: false }],
    });
    expect(text).toContain('2026-08-25 18:00');
  });

  it('gets the offset right on the other side of DST', () => {
    // January is EST, UTC-5: 03:59Z is 22:59 the previous day.
    const { text } = ctx({
      assignments: [{ id: 'a1', title: 'Winter essay', due_at: '2027-01-15T03:59:00Z', due_has_time: true, status: 'todo', effort_minutes: null }],
    });
    expect(text).toContain('due Thu 2027-01-14 22:59');
  });

  it('says so rather than guessing when a timestamp is unreadable', () => {
    const { text } = ctx({
      assignments: [{ id: 'a1', title: 'Broken', due_at: 'not-a-date', due_has_time: true, status: 'todo', effort_minutes: null }],
    });
    expect(text).toContain('unknown time');
  });

  it('reports how long work has been sitting there', () => {
    // "What have I been putting off" is a question the spec names, and
    // without age the only honest answer is that the data does not say.
    const { text } = ctx({
      assignments: [{ id: 'a1', title: 'Lab report', due_at: null, due_has_time: false, status: 'todo', effort_minutes: null, created_at: '2026-07-20T14:00:00Z' }],
    });
    expect(text).toContain('on the list 30 days');
  });

  it('does not label something added today as having sat there', () => {
    const { text } = ctx({
      assignments: [{ id: 'a1', title: 'Fresh', due_at: null, due_has_time: false, status: 'todo', effort_minutes: null, created_at: '2026-08-19T14:00:00Z' }],
    });
    expect(text).not.toContain('on the list');
  });

  it('shows a dateless assignment as having no date', () => {
    const { text } = ctx({
      assignments: [{ id: 'a1', title: 'Lab report', due_at: null, due_has_time: false, status: 'todo', effort_minutes: null }],
    });
    expect(text).toContain('[a1] Lab report — no date');
  });

  it('drops the time from an assignment that has none, keeping the local day', () => {
    // Still converted: the local day of 2026-09-01T03:59Z is 31 August.
    const { text } = ctx({
      assignments: [{ id: 'a1', title: 'Essay', due_at: '2026-09-01T03:59:00Z', due_has_time: false, status: 'todo', effort_minutes: null }],
    });
    expect(text).toContain('due Mon 2026-08-31');
    expect(text).not.toContain('03:59');
  });

  it('reports the dose count, which is the one number worth being exact about', () => {
    const { text } = ctx({
      checklist: [{ id: 'c1', title: 'Adderall XR 20mg', done_today: false, doses_remaining: 3 }],
    });
    expect(text).toContain('not done today, 3 doses left');
  });

  it('omits a dose count for items that do not track one', () => {
    const { text } = ctx({ checklist: [{ id: 'c1', title: 'Creatine', done_today: true, doses_remaining: null }] });
    expect(text).toContain('[c1] Creatine — done today');
    expect(text).not.toContain('doses left');
  });
});

/**
 * The regression this file did not have.
 *
 * `localStamp` carried a long comment about the UTC-read-as-local bug and then
 * called localDayKey with no zone, which falls back to the module's
 * America/Toronto constant. So it converted UTC to local correctly and then to
 * the WRONG local for every account outside Toronto — while the prompt's own
 * first lines tell the model "All dates below are already in the user's local
 * time." The model was being handed Toronto times labelled as the user's.
 *
 * Toronto and Sydney are on opposite sides of the day, which is what makes
 * this the same class of failure rather than a rounding difference.
 */
describe('deadlines are stated in the account\'s zone, not the builder\'s', () => {
  const due = '2026-08-21T03:59:00Z'; // Thu 23:59 in Toronto, Fri 13:59 in Sydney
  const work = [{ id: 'a1', title: 'Lab', due_at: due, due_has_time: true, status: 'todo', effort_minutes: 60 }];

  it('reads as the 20th in Toronto', () => {
    expect(ctx({ timezone: 'America/Toronto', assignments: work }).text).toContain('2026-08-20 23:59');
  });

  it('reads as the 21st in Sydney — a different DAY, not a different hour', () => {
    const text = ctx({ timezone: 'Australia/Sydney', assignments: work }).text;
    expect(text).toContain('2026-08-21 13:59');
    // The specific failure: Sydney being told Toronto's day.
    expect(text).not.toContain('2026-08-20');
  });

  it('reads as the 20th in Vancouver', () => {
    expect(ctx({ timezone: 'America/Vancouver', assignments: work }).text).toContain('2026-08-20 20:59');
  });

  it('states the timezone it used, so a wrong one is visible rather than silent', () => {
    // The prompt asserts the dates are the user's own local time. If that
    // claim is going to be made, the zone behind it has to be checkable.
    expect(ctx({ timezone: 'Australia/Sydney' }).text).toBeTruthy();
  });
});

describe('buildContext, trimmed', () => {
  const input = {
    today: '2026-09-28',
    now: '10:00',
    timezone: 'America/Toronto',
    assignments: [
      { id: '11111111-1111-1111-1111-111111111111', title: 'Quiz 4', due_at: '2026-10-04T03:59:00Z', due_has_time: true, status: 'todo', effort_minutes: null, course: 'PHYS 205' },
    ],
    events: [
      { id: '22222222-2222-2222-2222-222222222222', title: 'Lab', kind: 'lab', starts_at: '2026-09-29T18:45:00Z', all_day: false },
      { id: '33333333-3333-3333-3333-333333333333', title: 'Far exam', kind: 'exam', starts_at: '2026-10-25T14:00:00Z', all_day: false },
    ],
    checklist: [{ id: '44444444-4444-4444-4444-444444444444', title: 'Creatine', done_today: false, doses_remaining: null }],
  };

  it('labels items briefly and can map every label back', () => {
    const c = buildContext(input, { shortIds: true });
    expect(c.text).not.toContain('1111-1111');
    expect(c.text).toContain('[w1] Quiz 4');
    expect(c.aliases?.get('w1')).toBe('11111111-1111-1111-1111-111111111111');
    expect(c.aliases?.get('c1')).toBe('44444444-4444-4444-4444-444444444444');
    expect([...c.knownIds].sort()).toEqual(['c1', 'e1', 'e2', 'w1']);
  });

  it('includes only the sections asked for', () => {
    const c = buildContext(input, { scopes: new Set(['checklist'] as const) });
    expect(c.text).toContain('DAILY CHECKLIST');
    expect(c.text).not.toContain('OPEN WORK');
    expect(c.text).not.toContain('UPCOMING EVENTS');
  });

  it('bounds events to the window it is given', () => {
    const c = buildContext(input, { eventDays: 14 });
    expect(c.text).toContain('Lab');
    expect(c.text).not.toContain('Far exam');
  });

  it('gives conversation a snapshot of what is next, not the whole planner', () => {
    const c = buildContext(input, { scopes: new Set(), shortIds: true });
    expect(c.text).toContain('PLANNER SNAPSHOT');
    expect(c.text).not.toContain('DAILY CHECKLIST');
    expect(c.text.length).toBeLessThan(400);
  });
});

describe('how far away each date is', () => {
  it('says it outright, so the model never subtracts dates', () => {
    const c = buildContext({
      today: '2026-09-28',
      now: '10:00',
      timezone: 'America/Toronto',
      assignments: [
        { id: 'a', title: 'Assignment 2', due_at: '2026-10-03T03:59:00Z', due_has_time: true, status: 'todo', effort_minutes: null },
        { id: 'b', title: 'WeBWorK 3', due_at: '2026-09-29T03:59:00Z', due_has_time: true, status: 'todo', effort_minutes: null },
      ],
      events: [],
      checklist: [],
    });
    expect(c.text).toContain('Assignment 2 — due Fri 2026-10-02 23:59 (in 4 days)');
    expect(c.text).toContain('WeBWorK 3 — due Mon 2026-09-28 23:59 (today)');
  });
});

describe('academic standing', () => {
  it('says what is decided against what is on the calendar, and predicts nothing', () => {
    const c = buildContext({
      today: '2026-09-28', now: '10:00', timezone: 'America/Toronto',
      assignments: [{ id: 'a', title: 'Midterm prep', due_at: null, due_has_time: false, status: 'todo', effort_minutes: null, weight_percent: 25 }],
      events: [], checklist: [],
      grades: [
        { course: 'MATH 205', weightKnown: 10, weightMarked: 5, earned: 4 },
        { course: 'PHYS 205', weightKnown: 25, weightMarked: 0, earned: 0 },
      ],
    });
    expect(c.text).toContain('this item alone is worth 25% of the final grade');
    expect(c.text).toContain('MATH 205: 10% of the grade is on the calendar, 5% of it marked, 4 points banked (80% on what is marked)');
    expect(c.text).toContain('PHYS 205: 25% of the grade is on the calendar, 0% of it marked, none marked yet');
  });
});
