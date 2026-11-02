import type { Assignment, PlannerEvent, TodayData } from './planner';
import { localDayKey } from './time';
import { urgencyFor } from './urgency';

/**
 * What Vision's island shows (components/VisionIsland.tsx): today's work and
 * what is still to happen today. Only today, never a tally of past days.
 */

export interface IslandDay {
  /** Open work due today or already late, soonest first. */
  due: Assignment[];
  /** Today's events not yet over, in order; all-day ones first. */
  events: PlannerEvent[];
}

export function islandDay(data: TodayData | null, now: Date, tz?: string): IslandDay {
  if (!data) return { due: [], events: [] };
  const today = localDayKey(now, tz);
  const due = data.assignments
    .filter((a) => {
      if (a.status === 'done' || !a.due_at) return false;
      const u = urgencyFor(new Date(a.due_at), { now, timezone: tz });
      return u.state === 'overdue' || u.days === 0;
    })
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''));
  const events = data.events
    .filter((e) => localDayKey(new Date(e.starts_at), tz) === today && (e.all_day || new Date(e.ends_at ?? e.starts_at) > now))
    .sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.starts_at.localeCompare(b.starts_at));
  return { due, events };
}
