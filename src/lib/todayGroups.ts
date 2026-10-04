import { addDays, daysBetween, localDayKey, type DayKey } from './time';

/**
 * Today's work, grouped by when it is due.
 *
 * One list sorted by date asked the reader to do the grouping: was the third
 * row today or Thursday? Five headings answer that before a title is read,
 * and they are the five questions a morning actually asks — what is late,
 * what is today, what is tomorrow, what is this week, and what is out there.
 *
 * Late is anything whose moment has passed, including something due at 3 p.m.
 * when it is now 4 p.m.: it is no longer "today's" in the sense that matters.
 * A date-only deadline is stored at the end of its day, so it is late only
 * once that day is over, never at 00:01 on the day itself.
 */

export type GroupId = 'late' | 'today' | 'tomorrow' | 'week' | 'later' | 'none';

export const GROUP_LABEL: Record<GroupId, string> = {
  late: 'Late',
  today: 'Today',
  tomorrow: 'Tomorrow',
  week: 'This week',
  later: 'Later',
  none: 'No date',
};

export const GROUP_ORDER: GroupId[] = ['late', 'today', 'tomorrow', 'week', 'later', 'none'];

/** Folded unless the reader opens them: the far future and the undated. */
export const FOLDED_BY_DEFAULT: ReadonlySet<GroupId> = new Set(['later', 'none']);

export function groupOf(
  due: string | null,
  now: Date,
  today: DayKey = localDayKey(now),
): GroupId {
  if (!due) return 'none';
  const at = new Date(due);
  if (at.getTime() < now.getTime()) return 'late';
  const day = localDayKey(at);
  if (day === today) return 'today';
  if (day === addDays(today, 1)) return 'tomorrow';
  if (daysBetween(today, day) <= 6) return 'week';
  return 'later';
}

export interface WorkGroup<T> {
  id: GroupId;
  label: string;
  items: T[];
}

/** Non-empty groups, in reading order, each keeping the input's order. */
export function groupWork<T extends { due_at: string | null }>(
  items: readonly T[],
  now: Date,
  today: DayKey = localDayKey(now),
): WorkGroup<T>[] {
  const buckets = new Map<GroupId, T[]>();
  for (const item of items) {
    const g = groupOf(item.due_at, now, today);
    const list = buckets.get(g);
    if (list) list.push(item);
    else buckets.set(g, [item]);
  }
  return GROUP_ORDER.filter((g) => buckets.has(g)).map((g) => ({
    id: g,
    label: GROUP_LABEL[g],
    items: buckets.get(g)!,
  }));
}
