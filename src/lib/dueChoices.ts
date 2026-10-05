import { addDays, activeTimezone, daysBetween, formatTime, localDayKey, wallClockToUTC, type DayKey } from './time';

/**
 * The editor's one-tap choices for when work is due and when to be reminded.
 *
 * The two things changed most often on a piece of work were the two set with
 * the browser's own pickers — "dd/mm/yyyy, --:-- --" on a phone — so each is a
 * row of chips now, with the exact pickers one chip away. Nothing stored
 * changes: a day key, an optional "HH:MM", and one reminder instant.
 */

export interface DayChoice {
  day: DayKey;
  label: string;
}

const parts = (day: DayKey) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
      .formatToParts(new Date(`${day}T12:00:00Z`))
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;

/** "Today", "Tomorrow", "Fri 9", "Next Sun", or "Thu 15 Oct" further out. */
export function dayLabel(day: DayKey, today: DayKey): string {
  const d = daysBetween(today, day);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  const p = parts(day);
  if (d > 1 && d < 7) return `${p.weekday} ${p.day}`;
  if (d === 7) return `Next ${p.weekday}`;
  return `${p.weekday} ${p.day} ${p.month}`;
}

/**
 * Today, tomorrow, the coming Friday and Sunday (where most deadlines land),
 * and a week out, plus the current due day when it is none of those, so the
 * value already set is always one of the chips and always visibly chosen.
 * The editor passes the day it opened with as well: a chip that vanished the
 * moment another was tapped shifted the whole row under the finger.
 */
export function dayChoices(today: DayKey, ...current: (DayKey | null)[]): DayChoice[] {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const until = (target: number) => ((target - weekday + 7) % 7) || 7;
  const days = new Set<DayKey>([today, addDays(today, 1), addDays(today, until(5)), addDays(today, until(0)), addDays(today, 7)]);
  for (const day of current) if (day) days.add(day);
  return [...days].sort().map((day) => ({ day, label: dayLabel(day, today) }));
}

/** Common deadline times. null is "end of day", which is how a date-only deadline is stored. */
export const TIME_CHOICES: (string | null)[] = [null, '09:00', '12:00', '17:00', '23:59'];

/** "End of day", "Noon", "5:00 p.m." */
export function timeLabel(time: string | null): string {
  if (time === null) return 'End of day';
  if (time === '12:00') return 'Noon';
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'a.m.' : 'p.m.'}`;
}

/**
 * Reminders relative to the deadline. Chosen this way they follow the due
 * date while it is being changed in the editor — pick "day before", then move
 * the deadline, and the reminder moves with it — and they are stored as the
 * same single instant as before.
 */
export type ReminderMode = 'none' | 'morning' | 'dayBefore' | 'twoDays' | 'exact';

export const REMINDER_CHOICES: { mode: ReminderMode; label: string }[] = [
  { mode: 'none', label: 'None' },
  { mode: 'morning', label: 'Morning of' },
  { mode: 'dayBefore', label: 'Day before' },
  { mode: 'twoDays', label: '2 days before' },
  { mode: 'exact', label: 'Exact time' },
];

/** 8 a.m. on the day, or 6 p.m. one or two days before. */
export function reminderAt(mode: ReminderMode, dueDay: DayKey | null, tz: string = activeTimezone()): string | null {
  if (!dueDay) return null;
  switch (mode) {
    case 'morning':
      return wallClockToUTC(dueDay, 8, 0, 0, tz).toISOString();
    case 'dayBefore':
      return wallClockToUTC(addDays(dueDay, -1), 18, 0, 0, tz).toISOString();
    case 'twoDays':
      return wallClockToUTC(addDays(dueDay, -2), 18, 0, 0, tz).toISOString();
    default:
      return null;
  }
}

/** Which chip a stored reminder is, so reopening the editor shows the same choice. */
export function reminderMode(remindAt: string | null, dueDay: DayKey | null, tz: string = activeTimezone()): ReminderMode {
  if (!remindAt) return 'none';
  const at = new Date(remindAt).getTime();
  for (const mode of ['morning', 'dayBefore', 'twoDays'] as const) {
    const candidate = reminderAt(mode, dueDay, tz);
    if (candidate && new Date(candidate).getTime() === at) return mode;
  }
  return 'exact';
}

/** "Tue 6 Oct, 6:00 p.m.": a reminder read back in words. */
export function reminderLabel(remindAt: string, today: DayKey, tz: string = activeTimezone()): string {
  const at = new Date(remindAt);
  const day = localDayKey(at, tz);
  const d = daysBetween(today, day);
  const p = parts(day);
  const when = d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `${p.weekday} ${p.day} ${p.month}`;
  return `${when}, ${formatTime(at, tz)}`;
}
