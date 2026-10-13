import { activeTimezone, addDays, daysBetween, formatTime, localDayKey, type DayKey } from './time';
import type { Urgency } from './urgency';

/**
 * What a list row prints at its right edge.
 *
 * The rule from the iPhone review (12 Oct): "when" is said once. Today's
 * headings already say Late, Today or Tomorrow, and Week's say the day, so
 * the row adds only what its heading does not: a time, a weekday, how late.
 * A ticket printed the countdown, the stub's unit and the date in its meta,
 * which is the same fact three times on a 72 px row.
 *
 * `dayShown` is for a row under a heading that names its day (Week's days,
 * Today's Tomorrow group): the time alone, or nothing. Due today and late
 * still say "End of day" and "1 day late", because those are the facts that
 * change what you do next, whatever the heading says.
 *
 * Null is a normal answer: an undated or finished row has nothing to add.
 */
export function rowWhen(
  u: Urgency,
  due: Date | null,
  hasTime: boolean,
  now: Date,
  { dayShown = false, tz = activeTimezone() }: { dayShown?: boolean; tz?: string } = {},
): string | null {
  if (!due || u.state === 'done') return null;
  const today = localDayKey(now, tz);
  const day = localDayKey(due, tz);
  const time = hasTime ? formatTime(due, tz) : null;

  if (u.state === 'overdue') {
    const late = daysBetween(day, today);
    if (late > 0) return late === 1 ? '1 day late' : `${late} days late`;
    // Passed earlier today: the time it was due is the useful fact.
    return time ?? 'Late';
  }

  if (day === today) {
    if (!time) return 'End of day';
    const minutes = Math.round((due.getTime() - now.getTime()) / 60_000);
    // Under an hour, how long is what matters.
    if (minutes > 0 && minutes < 60) return `In ${minutes} min`;
    return time;
  }

  if (dayShown) return time;
  if (day === addDays(today, 1)) return time ? `Tomorrow ${time}` : 'Tomorrow';
  if (daysBetween(today, day) <= 6) return time ? `${weekdayShort(day)} ${time}` : weekdayShort(day);
  return monthDay(day);
}

/** "Thu". Noon UTC, so no zone can move the day. */
export function weekdayShort(day: DayKey): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${day}T12:00:00Z`));
}

/** "Oct 24". */
export function monthDay(day: DayKey): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(
    new Date(`${day}T12:00:00Z`),
  );
}
