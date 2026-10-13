import { addDays, type DayKey } from './time';

/**
 * Suggested blocks: when to do the work, placed in the time that is actually
 * free.
 *
 * A suggestion, never a schedule. Nothing here moves anything; it proposes
 * blocks that become calendar events only when kept (rule 6). It is the
 * opposite of an auto-scheduler that rearranges a day on its own, which is
 * the failure the teardown names in the tools that do this.
 *
 * The rules, each a guard against a way this goes wrong:
 *  - Only work with an estimate is placed. Inventing an hour for unsized work
 *    would be confident and built on nothing; it is counted instead.
 *  - Soonest due goes first, and a block always ends before the work is due.
 *  - Timed events are busy, with a buffer either side; all-day events are
 *    not, because a holiday or "reading week" is not a booked hour.
 *  - One block per piece of work per day, so a five-hour essay is spread over
 *    days rather than stacked into one; at most four hours suggested a day.
 *  - Blocks are 30 to 90 minutes. A gap shorter than half an hour is not
 *    offered as somewhere to start something.
 */

export interface BlockWork {
  id: string;
  title: string;
  course_id: string | null;
  /** The instant it is due, as stored. */
  due_at: string | null;
  effort_minutes: number | null;
  status: string;
}

/** A busy interval on one local day, in minutes from midnight. */
export interface Busy {
  day: DayKey;
  start: number;
  end: number;
}

export interface Suggestion {
  workId: string;
  title: string;
  course_id: string | null;
  day: DayKey;
  /** Minutes from local midnight. */
  start: number;
  minutes: number;
}

export interface SuggestOptions {
  today: DayKey;
  /** Minutes from local midnight, now. Blocks today start after this. */
  nowMinute: number;
  /** Local day and minute of an instant, in the account's zone. */
  local: (instant: Date) => { day: DayKey; minute: number };
  /** The hours blocks may sit in. */
  from?: number;
  to?: number;
  horizonDays?: number;
}

const BUFFER = 10;
const MIN_BLOCK = 30;
const MAX_BLOCK = 90;
const DAY_CAP = 240;

const roundUp = (m: number, step = 15) => Math.ceil(m / step) * step;

export function suggestBlocks(
  work: BlockWork[],
  busy: Busy[],
  o: SuggestOptions,
): { suggestions: Suggestion[]; unsized: number; unplaced: number } {
  const from = o.from ?? 9 * 60;
  const to = o.to ?? 21 * 60;
  const horizon = o.horizonDays ?? 7;
  const lastDay = addDays(o.today, horizon - 1);

  // Still ahead: overdue work is already on Today under Late, and a block
  // that ends before a deadline already gone cannot exist.
  const open = work.filter((w) => {
    if (w.status === 'done' || !w.due_at) return false;
    const due = o.local(new Date(w.due_at));
    return due.day > o.today || (due.day === o.today && due.minute > o.nowMinute);
  });
  const inRange = open.filter((w) => o.local(new Date(w.due_at as string)).day <= addDays(lastDay, 1));
  const unsized = inRange.filter((w) => !w.effort_minutes).length;
  const queue = inRange
    .filter((w) => (w.effort_minutes ?? 0) > 0)
    .sort((a, b) => (a.due_at as string).localeCompare(b.due_at as string));

  // Busy time per day, kept sorted, including blocks placed as we go.
  const taken = new Map<DayKey, { start: number; end: number }[]>();
  for (const b of busy) {
    const list = taken.get(b.day) ?? [];
    list.push({ start: b.start - BUFFER, end: b.end + BUFFER });
    taken.set(b.day, list);
  }
  const placedPerDay = new Map<DayKey, number>();

  function freeOn(day: DayKey, notBefore: number, notAfter: number): { start: number; end: number }[] {
    const lo = Math.max(from, day === o.today ? roundUp(o.nowMinute + BUFFER) : from);
    const hi = Math.min(to, notAfter);
    if (hi - lo < MIN_BLOCK) return [];
    const blocks = [...(taken.get(day) ?? [])].sort((a, b) => a.start - b.start);
    const gaps: { start: number; end: number }[] = [];
    let at = Math.max(lo, notBefore);
    for (const b of blocks) {
      if (b.end <= at) continue;
      if (b.start >= hi) break;
      if (b.start > at) gaps.push({ start: at, end: Math.min(b.start, hi) });
      at = Math.max(at, b.end);
    }
    if (at < hi) gaps.push({ start: at, end: hi });
    return gaps.filter((g) => g.end - g.start >= MIN_BLOCK);
  }

  const suggestions: Suggestion[] = [];
  let unplaced = 0;
  for (const w of queue) {
    let remaining = w.effort_minutes as number;
    const due = o.local(new Date(w.due_at as string));
    for (let day = o.today; day <= due.day && day <= lastDay && remaining > 0; day = addDays(day, 1)) {
      const used = placedPerDay.get(day) ?? 0;
      if (used >= DAY_CAP) continue;
      // On the due day itself, the block must end before the deadline.
      const notAfter = day === due.day ? due.minute : 24 * 60;
      // A gap that holds a whole session, if the day has one; otherwise the
      // longest that holds at least half an hour.
      const want = Math.min(MAX_BLOCK, remaining);
      const gaps = freeOn(day, 0, notAfter).filter((g) => g.end - g.start >= Math.min(MIN_BLOCK, remaining));
      const gap = gaps.find((g) => g.end - roundUp(g.start, 5) >= want) ?? [...gaps].sort((a, b) => b.end - b.start - (a.end - a.start))[0];
      if (!gap) continue;
      const minutes = Math.min(MAX_BLOCK, remaining, gap.end - gap.start, DAY_CAP - used);
      if (minutes < Math.min(MIN_BLOCK, remaining)) continue;
      const start = roundUp(gap.start, 5);
      if (start + minutes > gap.end) continue;
      suggestions.push({ workId: w.id, title: w.title, course_id: w.course_id, day, start, minutes });
      taken.set(day, [...(taken.get(day) ?? []), { start: start - BUFFER, end: start + minutes + BUFFER }]);
      placedPerDay.set(day, used + minutes);
      remaining -= minutes;
    }
    if (remaining > 0) unplaced += 1;
  }
  suggestions.sort((a, b) => a.day.localeCompare(b.day) || a.start - b.start);
  return { suggestions, unsized, unplaced };
}
