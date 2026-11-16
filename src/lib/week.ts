import { addDays, localDayKey, type DayKey } from './time';
import { untrackedDeadlines, type Assignment, type PlannerEvent } from './planner';

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
  /**
   * Work due after the visible window, soonest first. Listed, not counted,
   * since Schedule took over from Today's work list (19 Oct 2026): it is now
   * the one place the whole of the work is seen.
   */
  later: Assignment[];
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
  const later: Assignment[] = [];

  for (const a of assignments) {
    if (a.status === 'done') continue;

    if (!a.due_at) {
      undated.push(a);
      continue;
    }

    const day = localDayKey(new Date(a.due_at), timezone);

    if (day < from) overdue.push(a);
    else if (day > last) later.push(a);
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
    later: later.sort((x, y) => (x.due_at ?? '').localeCompare(y.due_at ?? '')),
  };
}

/**
 * How many things are due on a day: tracked work, plus the calendar's own
 * deadlines that nothing tracks yet. Counting work alone drew an empty day
 * over two things due that night.
 */
export function dueCount(group: Pick<DayGroup, 'assignments' | 'events'>): number {
  return group.assignments.length + untrackedDeadlines(group.events, group.assignments).length;
}

/**
 * A commute or other buffer between two things: short, timed, no course, and
 * named for getting somewhere. Schedule draws these as a break in the day's
 * rail rather than as rows of their own: five "Travel" rows on a Monday
 * outweighed its three lectures (the 15 Nov 2026 audit).
 */
export function isBuffer(e: Pick<PlannerEvent, 'title' | 'course_id' | 'all_day' | 'starts_at' | 'ends_at'>): boolean {
  if (e.all_day || e.course_id || !e.ends_at) return false;
  const minutes = (Date.parse(e.ends_at) - Date.parse(e.starts_at)) / 60_000;
  // Leading emoji and punctuation are how calendars decorate these titles.
  const words = e.title.replace(/^[^\p{L}]+/u, '');
  return minutes > 0 && minutes <= 60 && /^(travel|commute|transit|bus|metro|train|drive|walk)\b/i.test(words);
}

/**
 * A day in the order Schedule draws it: what is due first (tracked work, then
 * the calendar's own deadlines nothing tracks yet), then the timetable.
 */
export function dayParts(group: Pick<DayGroup, 'assignments' | 'events'>): { calendarDue: PlannerEvent[]; timetable: PlannerEvent[] } {
  const calendarDue = untrackedDeadlines(group.events, group.assignments);
  return { calendarDue, timetable: group.events.filter((e) => !calendarDue.includes(e)) };
}

/** Total estimated effort in a group, for the Phase 6 workload forecast. */
export function effortMinutes(group: DayGroup): number {
  return group.assignments.reduce((n, a) => n + (a.effort_minutes ?? 0), 0);
}
