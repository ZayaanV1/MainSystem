import { addDays, type DayKey } from './time';

/**
 * Weekly averages of weight against calories.
 *
 * This is the only honest read on whether the surplus is right, and it is
 * deliberately weekly. Daily weight is mostly water, glycogen and salt; a
 * chart of it would show a two-kilo swing across a Tuesday and invite a
 * reaction to noise. Averaging a week against that week's average intake is
 * the smallest window where the signal is real.
 *
 * Weeks with no readings are absent rather than zero. A gap is a week you
 * did not weigh yourself, not a week you weighed nothing, and drawing it as a
 * plunge to zero would be both wrong and alarming.
 *
 * Nothing here says whether a direction is good. There is no target weight in
 * this app and no arrow pointing at one — the numbers are shown, and what to
 * do about them is not the planner's business.
 */

export interface DayPoint {
  day: DayKey;
  kg?: number;
  calories?: number;
}

export interface WeekPoint {
  /** Monday of the week, as the label. */
  weekStart: DayKey;
  /** Mean of the readings actually taken, or null if there were none. */
  kg: number | null;
  /** Mean daily calories across days that were logged, or null. */
  calories: number | null;
  /** How many days carried a weight reading and a food log. */
  weighedDays: number;
  loggedDays: number;
}

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;

/**
 * The Monday on or before a day.
 *
 * Weeks are anchored to Monday because the app's week view already is, and
 * two different week boundaries in one app is a way to make two charts
 * disagree about the same numbers.
 */
export function weekStartOf(day: DayKey): DayKey {
  const [y, m, d] = day.split('-').map(Number);
  // Deliberately UTC arithmetic on a plain calendar date: this is a date
  // computation, not a moment, so a timezone would only add a DST hazard.
  const date = new Date(Date.UTC(y, m - 1, d));
  const isoWeekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  return addDays(day, -(isoWeekday - 1));
}

/** Groups daily points into weeks, oldest first. */
export function weeklyTrend(days: DayPoint[]): WeekPoint[] {
  const weeks = new Map<DayKey, { kg: number[]; calories: number[] }>();

  for (const point of days) {
    const key = weekStartOf(point.day);
    const bucket = weeks.get(key) ?? { kg: [], calories: [] };
    if (typeof point.kg === 'number') bucket.kg.push(point.kg);
    // A logged day of zero calories is a day with no food logged, not a fast.
    // Counting it would drag the average down for not opening the app.
    if (typeof point.calories === 'number' && point.calories > 0) {
      bucket.calories.push(point.calories);
    }
    weeks.set(key, bucket);
  }

  return [...weeks.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([weekStart, b]) => ({
      weekStart,
      kg: mean(b.kg),
      calories: b.calories.length ? Math.round(mean(b.calories) as number) : null,
      weighedDays: b.kg.length,
      loggedDays: b.calories.length,
    }));
}

/**
 * Change in weekly average weight between the two most recent weeks that both
 * have readings.
 *
 * Consecutive weeks are not required. Missing a week's weigh-ins should not
 * erase the comparison — it should just mean the change covers more time, and
 * `weeksApart` says how much.
 */
export function weightChange(weeks: WeekPoint[]): { kg: number; weeksApart: number } | null {
  const weighed = weeks.filter((w) => w.kg !== null);
  if (weighed.length < 2) return null;

  const latest = weighed[weighed.length - 1];
  const previous = weighed[weighed.length - 2];

  const from = weeks.indexOf(previous);
  const to = weeks.indexOf(latest);

  return {
    kg: Math.round(((latest.kg as number) - (previous.kg as number)) * 10) / 10,
    weeksApart: to - from,
  };
}
