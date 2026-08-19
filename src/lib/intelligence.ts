import { addDays, daysBetween, localDayKey, type DayKey } from './time';

/**
 * Phase 6: choosing, forecasting, and learning how wrong the estimates are.
 *
 * The rule running through all of it is that a number shown here must be
 * either measured or plainly labelled as a guess. A forecast that quietly
 * assumes an unestimated task takes an hour, or a calibration built on two
 * data points, is an invented number wearing the clothes of a measurement.
 */

export interface Task {
  id: string;
  title: string;
  due_at: string | null;
  effort_minutes: number | null;
  status: string;
  /** How many times this has been pushed. Derived from rows, never cached. */
  deferrals?: number;
}

/* ------------------------------------------------------------- what now --- */

export interface Choice {
  task: Task;
  /** Why this one, in words. A pick with no reason is indistinguishable from random. */
  because: string;
}

/**
 * One task. Not a list.
 *
 * "Decision paralysis in front of a 14-item list is a real failure mode, and a
 * list-based planner can make it worse." So this returns exactly one thing,
 * with the reason it was chosen, and nothing else.
 *
 * Deliberately NOT most-overdue-first. That is the same trap low-battery mode
 * avoids: the most overdue item is the one that has been avoided longest,
 * usually because it is the worst, and offering it as the answer to "what now"
 * is how the button stops getting pressed.
 *
 * Stuck work is held back for the same reason, and this was found the hard
 * way. With a fifteen-minute budget the first version offered the task that
 * had been deferred seven times — because it had no estimate, and unestimated
 * work was treated as fitting any budget. A task avoided seven times will be
 * avoided an eighth; it needs breaking down, which is what the stuck panel
 * says, and serving it here just spends the button's credibility.
 *
 * Order of preference: work that is known to fit the time and is due soonest;
 * then work with no estimate, which might fit; then, if nothing fits, the
 * smallest thing there is — because the honest answer to "I have twenty
 * minutes and everything is big" is a small piece of something, not a
 * three-hour block that will not get started.
 */
export function whatNow(
  tasks: Task[],
  options: { minutesAvailable?: number | null; now?: Date; stuckAt?: number } = {},
): Choice | null {
  const open = tasks.filter((t) => t.status !== 'done');
  if (open.length === 0) return null;

  const now = options.now ?? new Date();
  const budget = options.minutesAvailable ?? null;
  const stuckAt = options.stuckAt ?? 6;

  // Work that has been pushed past the threshold is held back — but only if
  // there is something else. When it is all that is left, saying "nothing"
  // would be a lie, so it is offered with the reason stated plainly.
  const fresh = open.filter((t) => (t.deferrals ?? 0) < stuckAt);
  const pool = fresh.length > 0 ? fresh : open;
  const onlyStuckLeft = fresh.length === 0;

  const dueRank = (t: Task) => (t.due_at ? new Date(t.due_at).getTime() : Number.MAX_SAFE_INTEGER);
  const bySoonestThenSmallest = (a: Task, b: Task) => {
    const d = dueRank(a) - dueRank(b);
    if (d !== 0) return d;
    return (a.effort_minutes ?? Infinity) - (b.effort_minutes ?? Infinity);
  };

  const note = (task: Task) =>
    onlyStuckLeft
      ? `Everything left has been pushed several times. This is the soonest of them.`
      : reasonFor(task, now, budget);

  if (budget === null) {
    const pick = [...pool].sort(bySoonestThenSmallest)[0];
    return { task: pick, because: note(pick) };
  }

  // Known to fit, first. Guessing a duration for unestimated work would hide
  // it, but preferring it would keep serving whatever nobody has sized — and
  // the unsized things are disproportionately the vague, avoided ones.
  const knownToFit = pool.filter((t) => t.effort_minutes !== null && t.effort_minutes <= budget);
  if (knownToFit.length > 0) {
    const pick = [...knownToFit].sort(bySoonestThenSmallest)[0];
    return { task: pick, because: note(pick) };
  }

  const unsized = pool.filter((t) => t.effort_minutes === null);
  if (unsized.length > 0) {
    const pick = [...unsized].sort(bySoonestThenSmallest)[0];
    return {
      task: pick,
      because: `Nothing sized fits ${budget} minutes. This one has no estimate, so it might.`,
    };
  }

  // Everything is bigger than the time available. Offer the smallest rather
  // than nothing: a piece of it still beats not starting.
  const smallest = [...pool].sort(
    (a, b) => (a.effort_minutes ?? Infinity) - (b.effort_minutes ?? Infinity),
  )[0];

  return {
    task: smallest,
    because: `Nothing fits ${budget} minutes. This is the smallest thing on the list.`,
  };
}

function reasonFor(task: Task, now: Date, budget: number | null): string {
  if (task.due_at) {
    const days = daysBetween(localDayKey(now), localDayKey(new Date(task.due_at)));
    if (days < 0) return 'This is past its date.';
    if (days === 0) return 'This is due today.';
    if (days === 1) return 'This is due tomorrow.';
    if (days <= 7) return `This is due in ${days} days, the soonest of anything open.`;
    return `This is the next thing with a date, ${days} days out.`;
  }

  if (budget !== null && task.effort_minutes !== null) {
    return `Nothing has a date, and this fits ${budget} minutes.`;
  }
  return 'Nothing has a date, so this is just the next one.';
}

/* ------------------------------------------------------------- forecast --- */

export interface Forecast {
  /** Days in the window that still have work due. */
  days: { day: DayKey; minutes: number }[];
  totalMinutes: number;
  /** How many of the tasks counted had no estimate. */
  unestimated: number;
  /** Written summary, or null when there is nothing to warn about. */
  warning: string | null;
}

/**
 * Work due in the next N days, against the days left to do it.
 *
 * "Colour flags report the fire; this predicts it."
 *
 * Unestimated work is COUNTED but not given invented minutes. A forecast that
 * silently assumed an hour each would produce a confident total built partly
 * on nothing; instead the total is what is actually known and the unestimated
 * count is stated beside it, so an underestimate is visible as an
 * underestimate.
 */
export function forecast(
  tasks: Task[],
  options: { from?: DayKey; days?: number; hoursPerDay?: number } = {},
): Forecast {
  const from = options.from ?? localDayKey(new Date());
  const span = options.days ?? 7;
  const hoursPerDay = options.hoursPerDay ?? 4;

  const until = addDays(from, span);
  const byDay = new Map<DayKey, number>();
  let unestimated = 0;
  let totalMinutes = 0;

  for (const t of tasks) {
    if (t.status === 'done' || !t.due_at) continue;

    const day = localDayKey(new Date(t.due_at));
    if (day < from || day > until) continue;

    if (t.effort_minutes === null) {
      unestimated += 1;
      continue;
    }

    byDay.set(day, (byDay.get(day) ?? 0) + t.effort_minutes);
    totalMinutes += t.effort_minutes;
  }

  const days = [...byDay.entries()]
    .map(([day, minutes]) => ({ day, minutes }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));

  const capacity = span * hoursPerDay * 60;
  const hours = Math.round(totalMinutes / 60);

  let warning: string | null = null;
  if (totalMinutes > capacity) {
    warning = `The next ${span} days hold ${hours} hours of work. That is more than ${hoursPerDay} hours a day.`;
  } else if (hours >= 1 && totalMinutes > capacity * 0.6) {
    warning = `${hours} hours of work in the next ${span} days.`;
  }

  if (warning && unestimated > 0) {
    warning +=
      unestimated === 1
        ? ' One more has no estimate and is not counted.'
        : ` ${unestimated} more have no estimate and are not counted.`;
  }

  return { days, totalMinutes, unestimated, warning };
}

/* ---------------------------------------------------------- calibration --- */

export interface Calibration {
  /** actual / estimated, across everything with both. */
  factor: number;
  samples: number;
  /** Written form, or null when there is not enough to say anything. */
  summary: string | null;
}

/**
 * How wrong the estimates have been.
 *
 * Silent below a floor of samples. Two finished tasks is not a tendency, and
 * "you underestimate by 2.2x" derived from two data points is a number that
 * sounds measured and is not.
 *
 * The median is used rather than the mean, because one task that turned out to
 * be five times its estimate should not become the rule.
 */
export function calibration(
  pairs: { estimated: number; actual: number }[],
  minSamples = 5,
): Calibration {
  const usable = pairs.filter(
    (p) => Number.isFinite(p.estimated) && Number.isFinite(p.actual) && p.estimated > 0 && p.actual > 0,
  );

  if (usable.length < minSamples) {
    return { factor: 1, samples: usable.length, summary: null };
  }

  const ratios = usable.map((p) => p.actual / p.estimated).sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  const median =
    ratios.length % 2 === 0 ? (ratios[mid - 1] + ratios[mid]) / 2 : ratios[mid];

  const factor = Math.round(median * 10) / 10;

  let summary: string | null;
  if (factor >= 1.2) {
    summary = `Work tends to take ${factor}x your estimate, across ${usable.length} finished.`;
  } else if (factor <= 0.8) {
    summary = `Work tends to take ${factor}x your estimate — less than you expect, across ${usable.length} finished.`;
  } else {
    summary = `Estimates have been about right, across ${usable.length} finished.`;
  }

  return { factor, samples: usable.length, summary };
}

/** An estimate adjusted by what has actually happened. Null when unknown. */
export function adjustedEstimate(minutes: number | null, cal: Calibration): number | null {
  if (minutes === null || cal.summary === null) return null;
  return Math.round((minutes * cal.factor) / 5) * 5;
}

/* ------------------------------------------------------------ deferrals --- */

/**
 * Tasks that have moved often enough to be worth looking at.
 *
 * "That's not laziness; it's a task that's too vague, too big, or blocked."
 * The copy says exactly that, because a count with no interpretation reads as
 * an accusation, and this one is meant as a diagnosis.
 */
export function stuckTasks(tasks: Task[], threshold = 6): { task: Task; note: string }[] {
  return tasks
    .filter((t) => t.status !== 'done' && (t.deferrals ?? 0) >= threshold)
    .sort((a, b) => (b.deferrals ?? 0) - (a.deferrals ?? 0))
    .map((task) => ({
      task,
      note: `Moved ${task.deferrals} times. That usually means it is too vague, too big, or waiting on something.`,
    }));
}
