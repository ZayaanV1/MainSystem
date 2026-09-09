import { describe, it, expect } from 'vitest';
import {
  adjustedEstimate,
  calibration,
  forecast,
  stuckTasks,
  whatNow,
  type Task,
} from './intelligence';

const NOW = new Date('2026-08-19T14:00:00Z'); // 10:00 Toronto, EDT

/** An assignment due at 23:59 local on the given day. */
const due = (day: string) => `${day}T23:59:00-04:00`;

const task = (o: Partial<Task> & { id: string }): Task => ({
  title: o.id,
  due_at: null,
  effort_minutes: null,
  status: 'todo',
  ...o,
});

describe('whatNow', () => {
  it('returns nothing when there is nothing open', () => {
    expect(whatNow([])).toBeNull();
    expect(whatNow([task({ id: 'a', status: 'done' })])).toBeNull();
  });

  it('returns exactly one task, never a list', () => {
    const choice = whatNow(
      [task({ id: 'a', due_at: due('2026-08-25') }), task({ id: 'b', due_at: due('2026-08-20') })],
      { now: NOW },
    );
    expect(choice?.task.id).toBe('b');
  });

  it('does not pick the most overdue thing', () => {
    // The same trap low-battery mode avoids: the most overdue item is the one
    // avoided longest, usually because it is the worst, and offering it as the
    // answer to "what now" is how the button stops getting pressed.
    //
    // Soonest-due still wins, and an overdue item IS the soonest — so this
    // asserts the reason given is honest about that rather than pretending.
    const choice = whatNow([task({ id: 'old', due_at: due('2026-08-01') })], { now: NOW });
    expect(choice?.because).toBe('This is past its date.');
  });

  it('respects the time available', () => {
    const choice = whatNow(
      [
        task({ id: 'big', due_at: due('2026-08-20'), effort_minutes: 180 }),
        task({ id: 'small', due_at: due('2026-08-22'), effort_minutes: 20 }),
      ],
      { minutesAvailable: 30, now: NOW },
    );
    expect(choice?.task.id).toBe('small');
  });

  it('offers the smallest thing when nothing fits, rather than nothing', () => {
    // "I have 20 minutes and everything is big" deserves a small piece of
    // something, not silence.
    const choice = whatNow(
      [
        task({ id: 'huge', effort_minutes: 300, due_at: due('2026-08-20') }),
        task({ id: 'big', effort_minutes: 120, due_at: due('2026-08-21') }),
      ],
      { minutesAvailable: 20, now: NOW },
    );
    expect(choice?.task.id).toBe('big');
    expect(choice?.because).toMatch(/Nothing fits 20 minutes/);
  });

  it('offers unestimated work when nothing sized fits, and says so', () => {
    // Guessing a duration to exclude it would hide real work behind a number
    // nobody entered — but it is a fallback, not a preference.
    const choice = whatNow([task({ id: 'unknown', due_at: due('2026-08-20') })], {
      minutesAvailable: 15,
      now: NOW,
    });
    expect(choice?.task.id).toBe('unknown');
    expect(choice?.because).toMatch(/no estimate, so it might/);
  });

  it('prefers work known to fit over work of unknown size', () => {
    // The unsized things are disproportionately the vague, avoided ones, so
    // preferring them would keep serving exactly what gets skipped.
    const choice = whatNow(
      [
        task({ id: 'unsized', due_at: due('2026-08-20') }),
        task({ id: 'sized', due_at: due('2026-08-24'), effort_minutes: 20 }),
      ],
      { minutesAvailable: 30, now: NOW },
    );
    expect(choice?.task.id).toBe('sized');
  });

  it('holds back work that has been pushed past the threshold', () => {
    // Found live: with a 15-minute budget the first version offered the task
    // deferred seven times, because it had no estimate. A task avoided seven
    // times will be avoided an eighth — it needs breaking down, which is what
    // the stuck panel says.
    const choice = whatNow(
      [
        task({ id: 'stuck', due_at: due('2026-08-20'), deferrals: 7 }),
        task({ id: 'ordinary', due_at: due('2026-08-28'), effort_minutes: 45 }),
      ],
      { minutesAvailable: 15, now: NOW },
    );
    expect(choice?.task.id).toBe('ordinary');
  });

  it('offers stuck work anyway when it is all that is left, and says why', () => {
    // Saying "nothing" when there is something would be a lie.
    const choice = whatNow([task({ id: 'stuck', due_at: due('2026-08-20'), deferrals: 9 })], {
      now: NOW,
    });
    expect(choice?.task.id).toBe('stuck');
    expect(choice?.because).toMatch(/pushed several times/);
  });

  it('prefers the smaller of two things due the same day', () => {
    const choice = whatNow(
      [
        task({ id: 'bigger', due_at: due('2026-08-20'), effort_minutes: 90 }),
        task({ id: 'smaller', due_at: due('2026-08-20'), effort_minutes: 30 }),
      ],
      { now: NOW },
    );
    expect(choice?.task.id).toBe('smaller');
  });

  it('still answers when nothing has a date', () => {
    const choice = whatNow([task({ id: 'a', effort_minutes: 30 })], { now: NOW });
    expect(choice?.task.id).toBe('a');
    expect(choice?.because).toMatch(/Nothing has a date/);
  });

  it('says why in words, always', () => {
    for (const [day, expected] of [
      ['2026-08-19', 'This is due today.'],
      ['2026-08-20', 'This is due tomorrow.'],
    ] as const) {
      const choice = whatNow([task({ id: 'x', due_at: due(day) })], { now: NOW });
      expect(choice?.because).toBe(expected);
    }
  });
});

describe('forecast', () => {
  it('sums work due in the window', () => {
    const f = forecast(
      [
        task({ id: 'a', due_at: due('2026-08-20'), effort_minutes: 120 }),
        task({ id: 'b', due_at: due('2026-08-22'), effort_minutes: 180 }),
      ],
      { from: '2026-08-19', days: 7 },
    );
    expect(f.totalMinutes).toBe(300);
    expect(f.days).toEqual([
      { day: '2026-08-20', minutes: 120 },
      { day: '2026-08-22', minutes: 180 },
    ]);
  });

  it('counts unestimated work without inventing minutes for it', () => {
    // A forecast that silently assumed an hour each would be a confident total
    // built partly on nothing.
    const f = forecast(
      [
        task({ id: 'a', due_at: due('2026-08-20'), effort_minutes: 600 }),
        task({ id: 'b', due_at: due('2026-08-21') }),
        task({ id: 'c', due_at: due('2026-08-21') }),
      ],
      { from: '2026-08-19', days: 7, hoursPerDay: 1 },
    );
    expect(f.totalMinutes).toBe(600);
    expect(f.unestimated).toBe(2);
    expect(f.warning).toMatch(/2 more have no estimate and are not counted/);
  });

  it('gets the grammar right for a single unestimated task', () => {
    // "1 more has no estimate and are not counted" shipped to a live screen.
    const f = forecast(
      [
        task({ id: 'a', due_at: due('2026-08-20'), effort_minutes: 600 }),
        task({ id: 'b', due_at: due('2026-08-21') }),
      ],
      { from: '2026-08-19', days: 7, hoursPerDay: 1 },
    );
    expect(f.warning).toMatch(/One more has no estimate and is not counted\./);
  });

  it('warns when the window holds more than the daily capacity', () => {
    const f = forecast(
      [task({ id: 'a', due_at: due('2026-08-21'), effort_minutes: 19 * 60 })],
      { from: '2026-08-19', days: 5, hoursPerDay: 2 },
    );
    expect(f.warning).toBe('The next 5 days hold 19 hours of work. That is more than 2 hours a day.');
  });

  it('says nothing when the week is quiet', () => {
    const f = forecast([task({ id: 'a', due_at: due('2026-08-21'), effort_minutes: 30 })], {
      from: '2026-08-19',
      days: 7,
      hoursPerDay: 4,
    });
    expect(f.warning).toBeNull();
  });

  it('ignores work outside the window and work already done', () => {
    const f = forecast(
      [
        task({ id: 'far', due_at: due('2026-12-01'), effort_minutes: 600 }),
        task({ id: 'done', due_at: due('2026-08-20'), effort_minutes: 600, status: 'done' }),
        task({ id: 'undated', effort_minutes: 600 }),
      ],
      { from: '2026-08-19', days: 7 },
    );
    expect(f.totalMinutes).toBe(0);
    expect(f.days).toEqual([]);
  });
});

describe('calibration', () => {
  const pair = (estimated: number, actual: number) => ({ estimated, actual });

  it('says nothing until there is enough to say', () => {
    // Two finished tasks is not a tendency, and "2.2x" from two points is a
    // number that sounds measured and is not.
    const c = calibration([pair(60, 120), pair(30, 90)]);
    expect(c.summary).toBeNull();
    expect(c.samples).toBe(2);
  });

  it('reports a consistent underestimate', () => {
    const c = calibration(Array.from({ length: 5 }, () => pair(60, 120)));
    expect(c.factor).toBe(2);
    expect(c.summary).toBe('Work tends to take 2x your estimate, across 5 finished.');
  });

  it('uses the median so one disaster does not become the rule', () => {
    const c = calibration([
      pair(60, 60), pair(60, 60), pair(60, 66), pair(60, 60), pair(60, 1200),
    ]);
    expect(c.factor).toBe(1);
    expect(c.summary).toMatch(/about right/);
  });

  it('reports an overestimate too, without praising it', () => {
    const c = calibration(Array.from({ length: 6 }, () => pair(120, 60)));
    expect(c.factor).toBe(0.5);
    expect(c.summary).toMatch(/less than you expect/);
    expect(c.summary).not.toMatch(/good|well done|great/i);
  });

  it('ignores unusable pairs', () => {
    const c = calibration([
      pair(0, 60), pair(60, 0), pair(NaN, 60), pair(60, 120), pair(60, 120),
    ], 2);
    expect(c.samples).toBe(2);
  });
});

describe('adjustedEstimate', () => {
  it('is null until calibration has something to say', () => {
    expect(adjustedEstimate(60, calibration([]))).toBeNull();
  });

  it('scales and rounds to a usable number', () => {
    const c = calibration(Array.from({ length: 5 }, () => ({ estimated: 60, actual: 90 })));
    expect(adjustedEstimate(60, c)).toBe(90);
    expect(adjustedEstimate(50, c)).toBe(75);
  });

  it('is null for work with no estimate', () => {
    const c = calibration(Array.from({ length: 5 }, () => ({ estimated: 60, actual: 90 })));
    expect(adjustedEstimate(null, c)).toBeNull();
  });
});

describe('stuckTasks', () => {
  it('surfaces only what has moved past the threshold', () => {
    const stuck = stuckTasks([
      task({ id: 'a', deferrals: 6 }),
      task({ id: 'b', deferrals: 2 }),
      task({ id: 'c', deferrals: 9 }),
    ]);
    expect(stuck.map((s) => s.task.id)).toEqual(['c', 'a']);
  });

  it('diagnoses rather than accuses', () => {
    // "That's not laziness; it's a task that's too vague, too big, or blocked."
    const [stuck] = stuckTasks([task({ id: 'a', deferrals: 7 })]);
    expect(stuck.note).toMatch(/too vague, too big, or waiting on something/);
    expect(stuck.note).not.toMatch(/should|lazy|again|failed|keep|still/i);
  });

  it('ignores finished work however often it moved', () => {
    expect(stuckTasks([task({ id: 'a', deferrals: 20, status: 'done' })])).toEqual([]);
  });

  it('says nothing about work that has never moved', () => {
    expect(stuckTasks([task({ id: 'a' })])).toEqual([]);
  });
});

describe('what now, once the syllabus has said what things are worth', () => {
  const at = (d: string) => `${d}T16:00:00.000Z`;
  const NOW = new Date('2026-09-09T12:00:00Z');

  const task = (o: Partial<Task> & { id: string }): Task => ({
    title: o.id,
    due_at: null,
    effort_minutes: null,
    status: 'todo',
    ...o,
  });

  it('prefers the heavier item when two are due the same day', () => {
    // The distinction the app could not make until weight was stored: a 30%
    // midterm and a 2% quiz due the same afternoon are not the same task.
    const choice = whatNow(
      [
        task({ id: 'quiz', due_at: at('2026-09-11'), weight_percent: 2 }),
        task({ id: 'midterm', due_at: at('2026-09-11'), weight_percent: 30 }),
      ],
      { now: NOW },
    );
    expect(choice?.task.id).toBe('midterm');
  });

  it('never lets weight outrank a deadline', () => {
    // The trap this function exists to avoid. The heaviest item is usually the
    // biggest and most daunting, so leading with it on the screen built to
    // remove decisions is how the button stops getting pressed.
    const choice = whatNow(
      [
        task({ id: 'final', due_at: at('2026-12-01'), weight_percent: 50 }),
        task({ id: 'lab', due_at: at('2026-09-10'), weight_percent: 3 }),
      ],
      { now: NOW },
    );
    expect(choice?.task.id).toBe('lab');
  });

  it('treats unweighted work as average, not as worthless', () => {
    // "No weight recorded" and "worth nothing" are different facts. Reading
    // the first as the second would bury everything whose syllabus has not
    // been imported — which early in a term is nearly everything.
    const choice = whatNow(
      [
        task({ id: 'unknown', due_at: at('2026-09-11') }),
        task({ id: 'tiny', due_at: at('2026-09-11'), weight_percent: 2 }),
      ],
      { now: NOW },
    );
    expect(choice?.task.id).toBe('unknown');
  });

  it('mentions the weight only when it is big enough to be the reason', () => {
    const heavy = whatNow([task({ id: 'm', due_at: at('2026-09-09'), weight_percent: 30 })], { now: NOW });
    expect(heavy?.because).toContain('30% of the grade');

    // Appending "worth 2%" to everything would turn the one sentence this
    // screen exists to produce into boilerplate, and would be quietly
    // discouraging about the small things.
    const light = whatNow([task({ id: 'q', due_at: at('2026-09-09'), weight_percent: 2 })], { now: NOW });
    expect(light?.because).not.toContain('%');
  });

  it('still says nothing about weight when there is none', () => {
    const choice = whatNow([task({ id: 'x', due_at: at('2026-09-09') })], { now: NOW });
    expect(choice?.because).toBe('This is due today.');
  });
});
