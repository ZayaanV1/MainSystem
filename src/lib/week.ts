import { addDays, localDayKey, type DayKey } from './time';
import type { Assignment, PlannerEvent } from './planner';

/**
 * Grouping work into days for the Week view.
 *
 * Pure, because the two things that make this view worth having are both easy
 * to get wrong silently: work landing on the wrong day because a late-evening
 * deadline was read in UTC, and undated work vanishing because it does not fit
 * into any day at all.
 */

export interface DayGroup {
  day: DayKey;
  assignments: Assignment[];
  events: PlannerEvent[];
}

export interface WeekGrouping {
  days: DayGroup[];
  /**
   * Overdue work, shown once above the week rather than repeated on the day it
   * was due. It is not "this week's work" — it is the thing most likely to be
   * forgotten, so it gets its own place at the top.
   */
  overdue: Assignment[];
  /**
   * Work with no date. Never dropped: an assignment without a date is the
   * easiest kind to lose, and a view that silently omits it teaches you the
   * app is not the whole picture.
   */
  undated: Assignment[];
  /** Work due after the visible window, so the count is never a surprise. */
  laterCount: number;
}

export function groupWeek(
  assignments: Assignment[],
  events: PlannerEvent[],
  from: DayKey,
  days: number,
  timezone?: string,
): WeekGrouping {
  const window = Array.from({ length: days }, (_, i) => addDays(from, i));
  const last = window[window.length - 1];

  const groups = new Map<DayKey, DayGroup>(
    window.map((day) => [day, { day, assignments: [], events: [] }]),
  );

  const overdue: Assignment[] = [];
  const undated: Assignment[] = [];
  let laterCount = 0;

  for (const a of assignments) {
    if (a.status === 'done') continue;

    if (!a.due_at) {
      undated.push(a);
      continue;
    }

    const day = localDayKey(new Date(a.due_at), timezone);

    if (day < from) overdue.push(a);
    else if (day > last) laterCount += 1;
    else groups.get(day)!.assignments.push(a);
  }

  for (const e of events) {
    const day = localDayKey(new Date(e.starts_at), timezone);
    if (day >= from && day <= last) groups.get(day)!.events.push(e);
  }

  // Within a day, earlier first; undated-within-a-day cannot happen because a
  // day group is keyed on having a date.
  for (const g of groups.values()) {
    g.assignments.sort((x, y) => (x.due_at ?? '').localeCompare(y.due_at ?? ''));
    g.events.sort((x, y) => x.starts_at.localeCompare(y.starts_at));
  }

  return {
    days: window.map((d) => groups.get(d)!),
    overdue: overdue.sort((x, y) => (x.due_at ?? '').localeCompare(y.due_at ?? '')),
    undated,
    laterCount,
  };
}

/** Total estimated effort in a group, for the Phase 6 workload forecast. */
export function effortMinutes(group: DayGroup): number {
  return group.assignments.reduce((n, a) => n + (a.effort_minutes ?? 0), 0);
}
