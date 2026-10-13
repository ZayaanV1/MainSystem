import { addDays, isoWeekday, localDayKey, wallClockToUTC, type DayKey } from './time.ts';

/**
 * A class typed by hand: one weekly pattern, written out as real events.
 *
 * For the student whose school gives no calendar file. Every other way a
 * class reaches this app is a live feed or a pasted .ics; without either, a
 * Tuesday-and-Thursday lecture was twenty-six events typed one at a time,
 * which nobody does, so the week the whole term hangs on was simply missing.
 *
 * THE PREVIEW AND THE WRITE ARE THE SAME FUNCTION
 *
 * The form shows every date before anything is written (rule 6), and those
 * dates come from `meetingDays` below — the same call the save makes. A
 * preview drawn by a second implementation is how a preview ends up lying.
 *
 * WALL-CLOCK TIME, CONVERTED ONE DAY AT A TIME
 *
 * A 10:15 lecture is at 10:15 on both sides of a clock change. So each
 * session's instant is converted from its own date and the account's zone,
 * never computed as "the first one plus seven days", which would move every
 * class after 1 November by an hour.
 *
 * Pure: no database, no clock, no host zone. The zone is always passed in.
 */

export interface ClassPattern {
  /** ISO weekdays, 1 = Monday .. 7 = Sunday. */
  weekdays: number[];
  /** Wall-clock 'HH:MM' in the account's zone. */
  start_time: string;
  end_time: string;
  first_day: DayKey;
  last_day: DayKey;
  /** Days it does not meet: reading week, a holiday, a cancelled lecture. */
  skip_days: DayKey[];
}

/**
 * The most sessions one class may make.
 *
 * The same cap as repeating work. A daily class over a whole year is a
 * mistake in the form rather than a timetable, and the preview says when it
 * has been reached rather than quietly stopping short of the last day.
 */
export const MAX_CLASSES = 200;

/** 'HH:MM' (seconds tolerated, as some time inputs send them) to parts. */
export function parseClock(value: string): { hour: number; minute: number } | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(value.trim());
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

/** Minutes past midnight for a wall-clock time, or null if it is not one. */
export function clockMinutes(value: string): number | null {
  const t = parseClock(value);
  return t ? t.hour * 60 + t.minute : null;
}

/**
 * Every day the pattern lands on, skipped days included, in order.
 *
 * Skipped days stay in this list because the preview draws them — struck
 * through, tappable to bring back — and a skip that vanished from the grid
 * could not be undone.
 */
export function classDays(p: ClassPattern): DayKey[] {
  const wanted = new Set(p.weekdays);
  if (wanted.size === 0 || !p.first_day || !p.last_day || p.last_day < p.first_day) return [];

  const out: DayKey[] = [];
  for (let day = p.first_day; day <= p.last_day; day = addDays(day, 1)) {
    if (wanted.has(isoWeekday(day))) out.push(day);
    if (out.length >= MAX_CLASSES) break;
  }
  return out;
}

/** The days the class actually meets: the pattern, less what was skipped. */
export function meetingDays(p: ClassPattern): DayKey[] {
  const skipped = new Set(p.skip_days);
  return classDays(p).filter((d) => !skipped.has(d));
}

export interface Session {
  starts_at: string;
  ends_at: string;
}

/** One meeting as stored instants, from its own date in the account's zone. */
export function sessionOn(day: DayKey, p: ClassPattern, tz: string): Session {
  const start = parseClock(p.start_time);
  const end = parseClock(p.end_time);
  if (!start || !end) throw new Error(`Not a time of day: ${p.start_time} to ${p.end_time}`);
  return {
    starts_at: wallClockToUTC(day, start.hour, start.minute, 0, tz).toISOString(),
    ends_at: wallClockToUTC(day, end.hour, end.minute, 0, tz).toISOString(),
  };
}

/** The zone's offset from UTC at local noon on a day, in minutes. */
function noonOffset(day: DayKey, tz: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return (Date.UTC(y, m - 1, d, 12) - wallClockToUTC(day, 12, 0, 0, tz).getTime()) / 60_000;
}

export interface ClockChange {
  /** The first local day on the new offset. */
  day: DayKey;
  /** 'back' gains an hour (autumn in the north), 'forward' loses one. */
  direction: 'back' | 'forward';
}

/**
 * The clock changes inside a term, so the preview can say the class keeps
 * its time across them. Most terms have one; a full year has two; a zone
 * without daylight saving has none.
 */
export function clockChanges(first: DayKey, last: DayKey, tz: string): ClockChange[] {
  if (!first || !last || last < first) return [];
  const out: ClockChange[] = [];
  let before = noonOffset(first, tz);
  for (let day = addDays(first, 1); day <= last; day = addDays(day, 1)) {
    const now = noonOffset(day, tz);
    if (now !== before) out.push({ day, direction: now < before ? 'back' : 'forward' });
    before = now;
  }
  return out;
}

export interface ClassInstance {
  id: string;
  starts_at: string;
  ends_at: string | null;
}

export interface ClassPlan {
  insert: Session[];
  /** Rows kept on their day, with the instants they should now have. */
  update: (Session & { id: string })[];
  remove: string[];
  /** How many updates move a session to another time. */
  moved: number;
  /** Sessions before `from`, left exactly as they were. */
  before: number;
}

/**
 * What it takes to make the stored sessions match a pattern from a day on.
 *
 * Nothing before `from` is touched, which is what lets an edit say "the 9
 * before 14 Oct stay exactly as they were" and mean it — a class that moved
 * rooms in week six did not meet in the new room in week two. From `from`
 * on, a stored session on a day the pattern still meets is updated IN PLACE,
 * so its id survives; one on a day it no longer meets is removed; a meeting
 * day with nothing stored gets a new session.
 *
 * `refresh` is set when the title, course or room changed: every kept session
 * then needs rewriting even though its time did not move. Two stored on one
 * day (which nothing should make) are reduced to one.
 *
 * Creating a class is this with nothing stored and `from` its first day;
 * ending one is this with an earlier last day and `from` the day after it.
 */
export function planClass(
  existing: ClassInstance[],
  next: ClassPattern,
  from: DayKey,
  tz: string,
  refresh: boolean,
): ClassPlan {
  const wanted = new Set(meetingDays(next).filter((d) => d >= from));
  const plan: ClassPlan = { insert: [], update: [], remove: [], moved: 0, before: 0 };
  const covered = new Set<DayKey>();

  const ordered = [...existing].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  for (const row of ordered) {
    const day = localDayKey(new Date(row.starts_at), tz);
    if (day < from) {
      plan.before += 1;
      continue;
    }
    if (!wanted.has(day) || covered.has(day)) {
      plan.remove.push(row.id);
      continue;
    }
    covered.add(day);
    const session = sessionOn(day, next, tz);
    const moves =
      Date.parse(session.starts_at) !== Date.parse(row.starts_at) ||
      (row.ends_at === null ? true : Date.parse(session.ends_at) !== Date.parse(row.ends_at));
    if (moves) plan.moved += 1;
    if (moves || refresh) plan.update.push({ id: row.id, ...session });
  }

  for (const day of [...wanted].sort()) {
    if (!covered.has(day)) plan.insert.push(sessionOn(day, next, tz));
  }
  return plan;
}

const WEEKDAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "Tue, Thu", for the list and the preview. */
export function describeDays(weekdays: number[]): string {
  const days = [...new Set(weekdays)].sort((a, b) => a - b);
  if (days.length === 7) return 'Every day';
  if (days.join() === '1,2,3,4,5') return 'Weekdays';
  return days.map((d) => WEEKDAY[d] ?? '').filter(Boolean).join(', ');
}
