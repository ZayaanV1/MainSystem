/**
 * Deadlines that live only in a subscribed calendar.
 *
 * A school that posts due dates to Moodle puts them in the calendar feed, and
 * the planner mirrors them as events. Until 15 Nov 2026 only tracked work
 * counted as "due", so the briefing said "your day is clear" above two things
 * due at 11:59 that night, and the week strip and Month marked nothing. One
 * rule, shared by the app and the briefing, so they cannot disagree again.
 */

export interface CalendarEvent {
  title: string;
  feed_id?: string | null;
  starts_at: string;
}

export interface TrackedWork {
  title: string;
  due_at: string | null;
}

/**
 * A subscribed-calendar event that reads like something to hand in ("Lab 3
 * is due", "WeBWorK 8 closes"). A lecture never does, and neither does
 * anything the account added itself: that is already what it says it is.
 */
export function looksLikeDeadline(e: Pick<CalendarEvent, 'title' | 'feed_id'>): boolean {
  return Boolean(e.feed_id) && /\b(due|deadline|closes|submi\w*|assignment|homework|quiz|webwork|problem set|lab report)\b/i.test(e.title);
}

/** Whether work with this title and due time already exists, so a deadline is never counted or tracked twice. */
export function alreadyTracked(e: Pick<CalendarEvent, 'title' | 'starts_at'>, work: TrackedWork[]): boolean {
  const title = e.title.trim().toLowerCase();
  return work.some((a) => a.title.trim().toLowerCase() === title && a.due_at !== null && Date.parse(a.due_at) === Date.parse(e.starts_at));
}

/** The calendar's deadlines that no piece of work stands for yet: due all the same. */
export function untrackedDeadlines<E extends CalendarEvent>(events: readonly E[], work: TrackedWork[]): E[] {
  return events.filter((e) => looksLikeDeadline(e) && !alreadyTracked(e, work));
}
