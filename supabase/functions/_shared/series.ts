import { addDays, daysBetween, isoWeekday, type DayKey } from './time.ts';

/**
 * Turning a recurring pattern into the days it actually falls on.
 *
 * Kept as a pure function over strings so it can be tested exhaustively
 * without a database, a clock or a timezone — this is arithmetic on local
 * calendar days, and every bug this project has had with dates came from
 * mixing that arithmetic with instants.
 */

export type SeriesRecurrence = 'weekdays' | 'interval';

export interface AssignmentSeries {
  id: string;
  title: string;
  course_id: string | null;
  recurrence: SeriesRecurrence;
  /** ISO weekdays, 1 = Monday .. 7 = Sunday. Used when recurrence = weekdays. */
  weekdays: number[] | null;
  interval_days: number | null;
  anchor_day: DayKey;
  until_day: DayKey;
  due_time: string | null;
  effort_minutes: number | null;
  weight_percent: number | null;
  active: boolean;
}

/**
 * How far past `until_day` a generator run will never reach.
 *
 * A term is the unit here. Generating the whole series at once is deliberate
 * and is the reason `until_day` is required: a rolling horizon means a series
 * silently stops at whatever date the last run happened to reach, which looks
 * exactly like a bug and is invisible until someone notices a missing lab.
 */
export const MAX_INSTANCES = 200;

/**
 * Every day this series falls on, in order.
 *
 * Never before the anchor. An interval series is due ON its anchor and every
 * N days after — the same rule the checklist uses, so the two features cannot
 * disagree about what "every 14 days from the 3rd" means.
 */
export function seriesDays(series: AssignmentSeries): DayKey[] {
  if (!series.active) return [];

  const span = daysBetween(series.anchor_day, series.until_day);
  if (span < 0) return [];

  const out: DayKey[] = [];

  if (series.recurrence === 'weekdays') {
    const wanted = new Set(series.weekdays ?? []);
    if (wanted.size === 0) return [];

    for (let i = 0; i <= span; i++) {
      const day = addDays(series.anchor_day, i);
      if (wanted.has(isoWeekday(day))) out.push(day);
      // A cap rather than an error: a pattern that would produce thousands of
      // rows is a misconfiguration, and silently truncating is safer than
      // either throwing at the user or writing them all.
      if (out.length >= MAX_INSTANCES) break;
    }
    return out;
  }

  const step = series.interval_days;
  if (!step || step <= 0) return [];

  for (let i = 0; i <= span; i += step) {
    out.push(addDays(series.anchor_day, i));
    if (out.length >= MAX_INSTANCES) break;
  }
  return out;
}

/**
 * The days that still need an instance created.
 *
 * IDEMPOTENT BY CONSTRUCTION, which is the property that matters most here.
 * This runs whenever a series is created or edited and whenever the planner
 * loads, so it has to be safe to run a hundred times. It compares against the
 * days that already exist and returns only the gap — so a second run returns
 * nothing, and a run after one instance was deleted by hand returns exactly
 * that one.
 *
 * `existing` is every day already carrying an instance of this series,
 * INCLUDING completed ones. Filtering to open work would regenerate every lab
 * the moment it was ticked off, which is the worst possible failure for this
 * feature: an app that keeps handing back work you already finished.
 */
export function missingDays(series: AssignmentSeries, existing: DayKey[]): DayKey[] {
  const have = new Set(existing);
  return seriesDays(series).filter((d) => !have.has(d));
}

/**
 * A human sentence describing the pattern, for the editor and the row.
 *
 * Written out rather than shown as a set of toggles, because "Tue, Thu until
 * 11 Dec" is checkable at a glance and a grid of highlighted weekday buttons
 * is not — and a recurrence the user cannot verify is one they will not trust
 * enough to rely on.
 */
const WEEKDAY_NAME = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function describeSeries(series: AssignmentSeries): string {
  if (series.recurrence === 'weekdays') {
    const names = (series.weekdays ?? [])
      .slice()
      .sort((a, b) => a - b)
      .map((d) => WEEKDAY_NAME[d] ?? '')
      .filter(Boolean);

    if (names.length === 0) return 'No days chosen';
    if (names.length === 7) return 'Every day';
    return `Every ${names.join(', ')}`;
  }

  const n = series.interval_days ?? 0;
  if (n === 7) return 'Every week';
  if (n === 14) return 'Every two weeks';
  return `Every ${n} days`;
}
