import { addDays, type DayKey } from './time.ts';
import { dueOn, isDueOn, type ChecklistItem } from './checklist.ts';

/**
 * Checklist history.
 *
 * This is the most dangerous screen in the app to get wrong. Rule 3 exists
 * because a completion history is one design decision away from a wall of
 * evidence that you are failing, and the day that wall appears is the day the
 * app stops being opened.
 *
 * So the framing is deliberate: this is a BACK-FILL TOOL that happens to show
 * history, not a history view that happens to allow back-fill. Its job is to
 * make "I did that, I just didn't tick it" a single tap. Everything it
 * displays serves that, and nothing it displays scores anything.
 *
 * The rules, agreed and not negotiable:
 *   - no counts, no percentages, no "best run", no streak of any kind
 *   - an empty day renders as ground, never as a hole or a mark
 *   - bounded window; no scrolling back through months
 *
 * There is deliberately no function here that returns a total, a ratio or a
 * longest-anything. If one appears later, that is the rule being broken.
 */

/** Five weeks. Long enough to see a pattern, short enough not to be a record. */
export const HISTORY_WEEKS = 5;
export const HISTORY_DAYS = HISTORY_WEEKS * 7;

export type DayFill =
  /** Nothing was expected. Not an achievement and not a failure. */
  | 'none-due'
  /** Something was expected and none of it is ticked. Renders as ground. */
  | 'open'
  /** Some of what was expected is ticked. */
  | 'partial'
  /** All of it is ticked. */
  | 'complete';

export interface HistoryDay {
  day: DayKey;
  fill: DayFill;
  isToday: boolean;
  isFuture: boolean;
}

/**
 * The state of one day.
 *
 * Four states, not a number. The distinction between "some" and "all" is what
 * tells you whether back-filling is worth a tap, which is the entire purpose —
 * but it is never rendered as "1 of 2", because that is a score.
 */
export function dayFill(
  items: ChecklistItem[],
  completedIds: Set<string>,
  day: DayKey,
): DayFill {
  const due = items.filter((i) => isDueOn(i, day));
  if (due.length === 0) return 'none-due';

  const done = due.filter((i) => completedIds.has(i.id)).length;
  if (done === 0) return 'open';
  return done === due.length ? 'complete' : 'partial';
}

export interface CompletionRecord {
  item_id: string;
  local_day: DayKey;
}

/**
 * The window, oldest first, ending today.
 *
 * Ends today rather than at the end of the week: tomorrow's empty cell is not
 * information, and a row of future blanks reads as things already missed.
 */
export function buildHistory(
  items: ChecklistItem[],
  completions: CompletionRecord[],
  today: DayKey,
  days: number = HISTORY_DAYS,
): HistoryDay[] {
  const byDay = new Map<DayKey, Set<string>>();
  for (const c of completions) {
    if (!byDay.has(c.local_day)) byDay.set(c.local_day, new Set());
    byDay.get(c.local_day)!.add(c.item_id);
  }

  const start = addDays(today, -(days - 1));

  return Array.from({ length: days }, (_, i) => {
    const day = addDays(start, i);
    return {
      day,
      fill: dayFill(items, byDay.get(day) ?? new Set(), day),
      isToday: day === today,
      isFuture: false,
    };
  });
}

/** Rows of seven, oldest week first, for a grid. */
export function asWeeks(history: HistoryDay[]): HistoryDay[][] {
  const weeks: HistoryDay[][] = [];
  for (let i = 0; i < history.length; i += 7) weeks.push(history.slice(i, i + 7));
  return weeks;
}

/**
 * What a day offers, in words.
 *
 * Used as the accessible name and never shown as a visible score. Note what is
 * absent: no "you missed", no "incomplete", no count. A day with nothing ticked
 * is described by what can be done about it, not by what did not happen.
 */
export function describeDay(day: HistoryDay, formatted: string): string {
  switch (day.fill) {
    case 'none-due':
      return `${formatted}, nothing was on the list`;
    case 'open':
      return `${formatted}, nothing ticked yet — tap to fill it in`;
    case 'partial':
      return `${formatted}, partly ticked — tap to fill it in`;
    case 'complete':
      return `${formatted}, all ticked`;
  }
}

/** The items due on a day, for the back-fill list. */
export function itemsFor(items: ChecklistItem[], day: DayKey): ChecklistItem[] {
  return dueOn(items, day);
}
