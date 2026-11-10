import { formatTime, localDayKey } from './time.ts';

/**
 * Something real happening in their day that a friend could text about.
 *
 * Tomo's best first texts came from signals, not silence ("you're probably mid
 * gym session going by your calendar"; two things due tonight and the gap
 * before the next block). Abood gets the same, worked out here in code and
 * handed over as plain sentences, so the model never computes a time itself:
 * a window it got wrong would be a confidently wrong deadline by another name.
 */

export interface Slot {
  title: string;
  start: Date;
  end: Date;
}

export interface Due {
  title: string;
  due: Date;
}

/** A free stretch shorter than this is not worth pointing at. */
const MIN_WINDOW_MIN = 45;
/** "Right now" means it started within this long ago, so it is not the end of a three-hour lecture. */
const JUST_STARTED_MIN = 30;

const MIN = 60_000;

/** The first free stretch from now until the earliest of tonight's deadlines, or null. */
export function freeWindow(now: Date, slots: Slot[], until: Date): { start: Date; end: Date } | null {
  let cursor = now.getTime();
  const sorted = slots.filter((s) => s.end.getTime() > cursor).sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const s of sorted) {
    const start = Math.min(s.start.getTime(), until.getTime());
    if (start - cursor >= MIN_WINDOW_MIN * MIN) return { start: new Date(cursor), end: new Date(start) };
    cursor = Math.max(cursor, s.end.getTime());
    if (cursor >= until.getTime()) return null;
  }
  return until.getTime() - cursor >= MIN_WINDOW_MIN * MIN ? { start: new Date(cursor), end: until } : null;
}

/**
 * One sentence about today worth a text, or null. Two or more things due later
 * today with a free stretch before them wins; otherwise something that has
 * just started.
 */
export function checkinSignal(now: Date, slots: Slot[], dues: Due[], tz: string): string | null {
  const today = localDayKey(now, tz);
  const tonight = dues
    .filter((d) => d.due.getTime() > now.getTime() && localDayKey(d.due, tz) === today)
    .sort((a, b) => a.due.getTime() - b.due.getTime());
  if (tonight.length >= 2) {
    const w = freeWindow(now, slots, tonight[0].due);
    if (w) {
      const list = tonight.map((d) => `${d.title} (${formatTime(d.due, tz)})`).join(', ');
      return `Due later today: ${list}. Their next free stretch is ${formatTime(w.start, tz)} to ${formatTime(w.end, tz)}.`;
    }
  }
  const current = slots.find(
    (s) => s.start.getTime() <= now.getTime() && now.getTime() < s.end.getTime() && now.getTime() - s.start.getTime() <= JUST_STARTED_MIN * MIN,
  );
  if (current) {
    return `Going by their schedule, right now they are at: ${current.title} (${formatTime(current.start, tz)} to ${formatTime(current.end, tz)}).`;
  }
  return null;
}
