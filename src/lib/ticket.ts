import { activeTimezone, addDays, daysBetween, formatDay, formatTime, localDayKey, type DayKey } from './time';
import type { Urgency } from './urgency';

/**
 * What a ticket prints: the stub's figure and unit, and the "when" for the
 * meta line beside it.
 *
 * The stub answers "how long" at a glance — days for most work, the clock
 * time for something due later today, minutes once it is under an hour — and
 * the meta line never repeats what the stub already says. A ticket due at
 * 3 p.m. today has "3:00 / p.m." in the stub and no time in its meta; one due
 * Wednesday has "3 / days" in the stub and "Wed" in its meta, because the
 * count alone does not say which day that is.
 */

export interface TicketFace {
  big: string;
  unit: string;
  /** The due day or time for the meta line, or null when the stub says it. */
  when: string | null;
}

const weekdayShort = (day: DayKey) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${day}T12:00:00Z`));

function split(time: string): { hm: string; period: string } {
  const m = /^(\d{1,2}:\d{2})\s*(.*)$/u.exec(time);
  return m ? { hm: m[1], period: m[2] } : { hm: time, period: '' };
}

export function ticketFace(
  u: Urgency,
  due: Date | null,
  hasTime: boolean,
  now: Date,
  tz: string = activeTimezone(),
): TicketFace {
  if (u.state === 'done') return { big: '✓', unit: 'done', when: due ? dayAndTime(due, hasTime, now, tz) : null };
  if (!due) return { big: '—', unit: 'no date', when: null };

  const today = localDayKey(now, tz);
  const day = localDayKey(due, tz);

  if (u.state === 'overdue') {
    const late = daysBetween(day, today);
    if (late > 0) {
      const when = late <= 6 ? `was due ${weekdayShort(day)}` : `was due ${formatDay(day, tz)}`;
      return { big: String(late), unit: late === 1 ? 'day late' : 'days late', when };
    }
    // Passed earlier today: the time it was due is the useful number.
    const { hm, period } = split(formatTime(due, tz));
    return hasTime
      ? { big: hm, unit: `${period} · late`.trim(), when: null }
      : { big: 'Today', unit: 'late', when: null };
  }

  if (day === today) {
    if (!hasTime) return { big: 'Today', unit: 'end of day', when: null };
    const minutes = Math.round((due.getTime() - now.getTime()) / 60_000);
    // Under an hour, the count is what matters and the time moves to the meta.
    if (minutes > 0 && minutes < 60) return { big: String(minutes), unit: 'min', when: formatTime(due, tz) };
    const { hm, period } = split(formatTime(due, tz));
    return { big: hm, unit: period, when: null };
  }

  const days = daysBetween(today, day);
  return { big: String(days), unit: days === 1 ? 'day' : 'days', when: dayAndTime(due, hasTime, now, tz) };
}

/** "Wed", "Wed 5:00 p.m.", or "Fri, Oct 16" beyond the coming week. */
function dayAndTime(due: Date, hasTime: boolean, now: Date, tz: string): string {
  const today = localDayKey(now, tz);
  const day = localDayKey(due, tz);
  const near = day >= today && day <= addDays(today, 6);
  const d = near ? weekdayShort(day) : formatDay(day, tz);
  return hasTime ? `${d} ${formatTime(due, tz)}` : d;
}

/** The stub figure's size class: a clock time and a word step down to fit. */
export function stubSize(big: string): string {
  if (big.includes(':')) return big.length > 4 ? 'stub-time stub-time-long' : 'stub-time';
  return big.length > 3 ? 'stub-word' : '';
}
