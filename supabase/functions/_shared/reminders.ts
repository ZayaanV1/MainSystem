import { minutesSinceLocal, type DayKey } from './time.ts';
import { isDueOn, type ChecklistItem } from './checklist.ts';
import type { OutboundMessage } from './types.ts';

/**
 * Per-item reminders.
 *
 * The digest answers "what does today look like", once, in the morning. A
 * reminder answers "now". Different jobs, so they arrive separately.
 *
 * The rule that decides whether this feature is useful or hateful: a reminder
 * about something already done is pure nagging, and nagging is how a channel
 * becomes one you swipe away without reading. Everything below is arranged so
 * that a finished thing is silent.
 */

/** How late a reminder may still be worth sending. */
export const REMINDER_WINDOW_MINUTES = 30;

export interface RemindableItem extends ChecklistItem {
  /** Local wall-clock 'HH:MM:SS' or 'HH:MM'. */
  remind_at: string | null;
}

export interface RemindableAssignment {
  id: string;
  title: string;
  status: string;
  remind_at: string | null;
}

function parseClock(value: string): { hour: number; minute: number } | null {
  const m = value.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;

  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;

  return { hour, minute };
}

/**
 * Checklist reminders due right now.
 *
 * Three conditions, all necessary: the item recurs today, it is not already
 * ticked, and its time has arrived within the catch-up window. The second is
 * the one that makes this bearable to live with.
 */
export function checklistRemindersDue(
  items: RemindableItem[],
  completedIds: Set<string>,
  localDay: DayKey,
  now: Date,
  timezone?: string,
): RemindableItem[] {
  return items.filter((item) => {
    if (!item.remind_at) return false;
    if (!isDueOn(item, localDay)) return false;
    if (completedIds.has(item.id)) return false;

    const clock = parseClock(item.remind_at);
    if (!clock) return false;

    const elapsed = minutesSinceLocal(clock.hour, clock.minute, now, timezone);
    return elapsed >= 0 && elapsed <= REMINDER_WINDOW_MINUTES;
  });
}

/**
 * Assignment reminders due right now.
 *
 * A single instant rather than a recurring time, and never for finished work.
 * The window keeps a missed scheduler tick from losing the reminder entirely,
 * while stopping one from arriving hours after it was any use.
 */
export function assignmentRemindersDue(
  assignments: RemindableAssignment[],
  now: Date,
): RemindableAssignment[] {
  return assignments.filter((a) => {
    if (!a.remind_at || a.status === 'done') return false;

    const elapsedMs = now.getTime() - new Date(a.remind_at).getTime();
    return elapsedMs >= 0 && elapsedMs <= REMINDER_WINDOW_MINUTES * 60_000;
  });
}

/**
 * The message. A name and nothing else.
 *
 * The reminder's whole content is that it arrived now. Padding it with
 * encouragement would make the notification longer without making it more
 * useful, and would be one more thing to read at the moment you are least
 * inclined to.
 */
export function renderReminder(title: string, appUrl?: string): OutboundMessage {
  return { title: 'Now', body: title, deepLink: appUrl };
}

/** Keyed per day for repeating items, so tomorrow's reminder is a new one. */
export function checklistReminderKey(itemId: string, localDay: DayKey): string {
  return `checklist:${localDay}:${itemId}`;
}

/**
 * Keyed on the time as well as the assignment, so moving a reminder arms it
 * again rather than leaving it silently spent.
 */
export function assignmentReminderKey(assignmentId: string, remindAt: string): string {
  return `assignment:${assignmentId}:${remindAt}`;
}
