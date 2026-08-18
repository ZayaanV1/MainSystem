import { addDays, formatDay, formatTime, localDayKey, type DayKey } from './time.ts';
import type { OutboundMessage } from './types.ts';

/**
 * Exam escalation.
 *
 * An exam that appears as one line among nine in the morning digest has been
 * mentioned, not communicated. The things that actually hurt to forget deserve
 * their own arrival, on their own day.
 *
 * T minus one, not T minus zero. A reminder on the morning of an exam is
 * information you already have and can do nothing with; the night before is
 * the last moment preparation is still possible.
 */

export interface EscalatableEvent {
  id: string;
  title: string;
  kind: 'exam' | 'lab' | 'presentation' | 'other';
  starts_at: string;
  all_day: boolean;
  location: string | null;
}

/**
 * Which kinds earn their own notification.
 *
 * Deliberately narrow. If everything escalates, nothing does — the second
 * notification becomes as ignorable as the first, and then so does the digest.
 */
const ESCALATES = new Set(['exam', 'presentation']);

export function shouldEscalate(event: EscalatableEvent): boolean {
  return ESCALATES.has(event.kind);
}

/** Events happening tomorrow, in the user's local calendar. */
export function dueForEscalation(
  events: EscalatableEvent[],
  today: DayKey,
  timezone?: string,
): EscalatableEvent[] {
  const tomorrow = addDays(today, 1);

  return events
    .filter(shouldEscalate)
    .filter((e) => localDayKey(new Date(e.starts_at), timezone) === tomorrow)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

/**
 * The message.
 *
 * States the fact and the time, and stops. No "are you ready", no "don't
 * forget", no exclamation mark — the night before an exam is the worst
 * possible moment to be nudged by software with an opinion.
 */
export function renderEscalation(
  events: EscalatableEvent[],
  today: DayKey,
  timezone?: string,
  appUrl?: string,
): OutboundMessage {
  const tomorrow = addDays(today, 1);

  const lines = events.map((e) => {
    const when = e.all_day ? 'time not set' : formatTime(new Date(e.starts_at), timezone);
    const where = e.location ? `, ${e.location}` : '';
    return `${e.title} — ${when}${where}`;
  });

  return {
    title: events.length === 1 ? 'Tomorrow' : `Tomorrow, ${formatDay(tomorrow, timezone)}`,
    body: lines.join('\n'),
    deepLink: appUrl,
  };
}

/**
 * The idempotency key.
 *
 * Keyed on the event rather than the day, so two exams tomorrow escalate once
 * each and neither suppresses the other — and so a rescheduled exam escalates
 * again for its new date.
 */
export function escalationKey(event: EscalatableEvent, day: DayKey): string {
  return `${day}:${event.id}`;
}
