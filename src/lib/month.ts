import { addDays, daysBetween, isoWeekday, localDayKey, type DayKey } from './time';
import type { Assignment, PlannerEvent } from './planner';

/**
 * The month grid.
 *
 * One principle governs what this screen may show: it displays what is DUE,
 * never what was done. A month of past days marked complete-or-not is a
 * completion history in a calendar's clothing, and rule 3 forbids exactly that
 * — thirty little failures laid out in a grid is the most efficient way to
 * make an app unopenable.
 *
 * So a cell's weight comes from how much is scheduled on it. A quiet past day
 * and a quiet future day look identical, because they are.
 */

export interface MonthCell {
  day: DayKey;
  /** False for the leading and trailing days that pad the grid to whole weeks. */
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  assignments: Assignment[];
  events: PlannerEvent[];
}

export interface MonthGrid {
  /** 'YYYY-MM' */
  month: string;
  /** Whole weeks, Monday-first, covering the month. Six rows at most. */
  weeks: MonthCell[][];
  /** Undated work, which belongs to no cell and must not vanish. */
  undated: Assignment[];
}

/** First day of the month containing `day`. */
export function startOfMonth(day: DayKey): DayKey {
  return `${day.slice(0, 7)}-01`;
}

/** Shift by whole months, clamping the day so 31 Jan minus a month is 31 Dec. */
export function shiftMonth(day: DayKey, months: number): DayKey {
  const [y, m] = day.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

/**
 * A month, named.
 *
 * Formatted in UTC on purpose, and it takes no timezone. The input is a
 * calendar date, not an instant — "2026-08" is August wherever you read it,
 * and running it through a zone would introduce the possibility of an
 * off-by-one at a month boundary in exchange for nothing. The noon anchor is
 * belt and braces on the same point.
 */
export function monthLabel(day: DayKey): string {
  const [y, m] = day.split('-').map(Number);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, 15, 12)));
}

function daysInMonth(month: DayKey): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function buildMonth(
  anchor: DayKey,
  assignments: Assignment[],
  events: PlannerEvent[],
  today: DayKey,
  timezone?: string,
): MonthGrid {
  const first = startOfMonth(anchor);
  const length = daysInMonth(first);

  // Monday-first, because a week that starts on Sunday splits the weekend
  // across two rows and the weekend is when most of this work actually happens.
  const lead = isoWeekday(first) - 1;
  const gridStart = addDays(first, -lead);

  const byDay = new Map<DayKey, { a: Assignment[]; e: PlannerEvent[] }>();
  const bucket = (d: DayKey) => {
    if (!byDay.has(d)) byDay.set(d, { a: [], e: [] });
    return byDay.get(d)!;
  };

  const undated: Assignment[] = [];

  for (const a of assignments) {
    if (a.status === 'done') continue;
    if (!a.due_at) {
      undated.push(a);
      continue;
    }
    bucket(localDayKey(new Date(a.due_at), timezone)).a.push(a);
  }

  for (const e of events) {
    bucket(localDayKey(new Date(e.starts_at), timezone)).e.push(e);
  }

  // Whole weeks only: enough rows to cover the last day of the month.
  const span = lead + length;
  const rows = Math.ceil(span / 7);

  const weeks: MonthCell[][] = [];
  for (let w = 0; w < rows; w++) {
    const week: MonthCell[] = [];
    for (let d = 0; d < 7; d++) {
      const day = addDays(gridStart, w * 7 + d);
      const held = byDay.get(day);
      week.push({
        day,
        inMonth: day.slice(0, 7) === first.slice(0, 7),
        isToday: day === today,
        isPast: daysBetween(today, day) < 0,
        assignments: (held?.a ?? []).sort((x, y) =>
          (x.due_at ?? '').localeCompare(y.due_at ?? ''),
        ),
        events: (held?.e ?? []).sort((x, y) => x.starts_at.localeCompare(y.starts_at)),
      });
    }
    weeks.push(week);
  }

  return { month: first.slice(0, 7), weeks, undated };
}

/**
 * How loaded a cell is, as a step rather than a raw count.
 *
 * Three steps, because the grid answers "which weeks are heavy" and a precise
 * count at this size is unreadable anyway. Rendered as dots, never as a number
 * and never as a colour alone.
 *
 * The steps are 1, 2, 3-or-more rather than anything wider, because of what a
 * real semester looks like: most days hold nothing, a busy day holds one, and
 * three things landing together IS the wall this view exists to show. Bucketing
 * 2-3 together made the worst day of the month look like an ordinary one.
 */
export function load(cell: MonthCell): 0 | 1 | 2 | 3 {
  const n = cell.assignments.length + cell.events.length;
  return Math.min(3, n) as 0 | 1 | 2 | 3;
}
