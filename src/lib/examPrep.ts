import { addDays, daysBetween, type DayKey } from './time';

/**
 * A prep plan for an exam: a few sessions, spaced out before it.
 *
 * Spaced rather than crammed: the sessions sit 10, 7, 4, 2 and 1 days before
 * the exam, and only the ones still ahead are offered, so an exam on Thursday
 * planned on Monday gets three. Each is a concrete first move with a size,
 * not "study", which is the original paralysis in one word.
 *
 * Arithmetic only, no model: it works offline and costs nothing. Nothing is
 * written from here; the plan is shown to be edited, kept or dropped (rule 6).
 */

export interface PrepSession {
  day: DayKey;
  title: string;
  effort_minutes: number;
}

const STEPS: { before: number; title: string; minutes: number }[] = [
  { before: 10, title: 'Gather every topic onto one summary sheet', minutes: 60 },
  { before: 7, title: 'Work through the weakest topics', minutes: 75 },
  { before: 4, title: 'Practice problems, mixed topics', minutes: 60 },
  { before: 2, title: 'A practice exam, timed', minutes: 90 },
  { before: 1, title: 'Light review of the summary sheet', minutes: 30 },
];

export function prepSessions(examDay: DayKey, today: DayKey): PrepSession[] {
  const ahead = daysBetween(today, examDay);
  if (ahead <= 0) return [];
  return STEPS.filter((s) => s.before <= ahead).map((s) => ({
    day: addDays(examDay, -s.before),
    title: s.title,
    effort_minutes: s.minutes,
  }));
}
