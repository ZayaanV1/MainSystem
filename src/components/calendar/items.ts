import type { CSSProperties } from 'react';
import { courseVar, type Assignment, type Course, type PlannerEvent } from '../../lib/planner';
import { minuteOfDay, progressThrough, readTitle, type ReadTitle } from '../../lib/blocks';
import { urgencyFor, type Urgency } from '../../lib/urgency';
import { formatTime, localDayKey, type DayKey } from '../../lib/time';
import type { DayGroup } from '../../lib/week';

/**
 * One day's events and deadlines as a single timeline, in the shape every
 * block style draws from.
 *
 * Built once here so the five styles cannot drift apart on the facts: which
 * event is happening now, how long something runs, what an event is called,
 * where a deadline sits in the day. A style decides how things look, never
 * what they are.
 */

export type BlockState = 'past' | 'now' | 'upcoming';

export interface EventItem {
  kind: 'event';
  id: string;
  event: PlannerEvent;
  course?: Course;
  start: Date;
  end: Date | null;
  allDay: boolean;
  /** Minutes past local midnight. */
  startMin: number;
  /** Clamped to the end of the day for anything that runs past midnight. */
  endMin: number | null;
  /** Length in minutes, or null for an instant. */
  mins: number | null;
  read: ReadTitle;
  headline: string;
  /** The course's full name, when it adds something the headline lacks. */
  detail: string | null;
  /** Room and campus, or the location as given. */
  place: string | null;
  state: BlockState;
  /** How far through it now is, while it is under way. */
  progress: number | null;
}

export interface DueItem {
  kind: 'due';
  id: string;
  assignment: Assignment;
  course?: Course;
  at: Date;
  /** False when only a date was given — "sometime that day". */
  timed: boolean;
  startMin: number;
  urgency: Urgency;
  state: 'past' | 'upcoming';
  steps: { done: number; total: number } | null;
}

export type Item = EventItem | DueItem;

/**
 * A block's course, as the custom property its tints resolve against.
 *
 * A block with no course is glass rather than a tint. Travel, the gym and
 * a study block are most of a real week, and washing them in cream made them
 * the brightest things on it — the calendar's loudest colour belonging to the
 * things that are nobody's course. Quiet glass lets the courses carry the
 * colour, which is the information.
 */
export function tint(course?: Course, extra: Record<string, string | number> = {}): CSSProperties {
  const v = courseVar(course?.colour_index);
  const colour = v
    ? { '--b': `var(${v}-rgb)` }
    : {
        '--blk-wash': 'var(--glass-fill)',
        '--blk-wash-top': 'var(--glass-fill-hover)',
        '--blk-edge': 'var(--glass-edge)',
        '--blk-glow': 'var(--glass-fill)',
        '--blk-mark': 'var(--text-low)',
      };
  return { ...colour, ...extra } as CSSProperties;
}

/** "8:45 a.m." split so the numerals and the suffix can be set differently. */
export function clock(d: Date): { hm: string; suffix: string } {
  const text = formatTime(d);
  const m = /^(\d{1,2}:\d{2})\s*(.*)$/u.exec(text);
  return m ? { hm: m[1], suffix: m[2] } : { hm: text, suffix: '' };
}

/** "9 a.m.", for the hour axis. Matches formatTime's en-CA suffixes. */
export function hourLabel(h: number): string {
  const hh = h % 24;
  return `${hh % 12 || 12} ${hh < 12 ? 'a.m.' : 'p.m.'}`;
}

function placeOf(event: PlannerEvent, read: ReadTitle): string | null {
  if (event.location) {
    // "MB S2.210, SGW Campus, Concordia University" -> "MB S2.210 · SGW Campus".
    // The institution is on every row of a university timetable, which makes
    // it the one part that tells you nothing.
    const parts = event.location
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    return parts.slice(0, 2).join(' · ');
  }
  return read.room;
}

export function buildDay(
  group: DayGroup,
  courseFor: (id: string | null) => Course | undefined,
  progressFor: (id: string) => { done: number; total: number } | null,
  now: Date,
): Item[] {
  const events: EventItem[] = group.events.map((e) => {
    const start = new Date(e.starts_at);
    const end = e.ends_at ? new Date(e.ends_at) : null;
    const course = courseFor(e.course_id);
    const read = readTitle(e.title);
    const startMin = e.all_day ? 0 : minuteOfDay(start);

    let endMin: number | null = null;
    if (end) {
      const sameDay = localDayKey(end) === group.day;
      endMin = sameDay ? Math.max(startMin + 1, minuteOfDay(end)) : 24 * 60;
    }

    const name = course?.name?.trim();
    const detail =
      name && name !== course?.code && !e.title.toLowerCase().includes(name.toLowerCase())
        ? name
        : null;

    const finished = end ? end.getTime() <= now.getTime() : start.getTime() <= now.getTime();
    const progress = progressThrough(start, end, now);

    return {
      kind: 'event',
      id: e.id,
      event: e,
      course,
      start,
      end,
      allDay: e.all_day,
      startMin,
      endMin,
      mins: end && !e.all_day ? Math.round((end.getTime() - start.getTime()) / 60_000) : null,
      read,
      headline: read.headline,
      detail,
      place: placeOf(e, read),
      state: progress !== null ? 'now' : finished && !e.all_day ? 'past' : 'upcoming',
      progress,
    };
  });

  const dues: DueItem[] = group.assignments.map((a) => {
    const at = new Date(a.due_at!);
    return {
      kind: 'due',
      id: a.id,
      assignment: a,
      course: courseFor(a.course_id),
      at,
      timed: a.due_has_time,
      // Date-only work sorts to the end of its day, which is when it is due.
      startMin: a.due_has_time ? minuteOfDay(at) : 24 * 60,
      urgency: urgencyFor(at, { done: a.status === 'done', now }),
      state: a.due_has_time && at.getTime() <= now.getTime() ? 'past' : 'upcoming',
      steps: progressFor(a.id),
    };
  });

  const rank = (i: Item) => (i.kind === 'event' && i.allDay ? -1 : i.startMin);
  // Events before deadlines at the same minute: the class at 23:59 is rare,
  // the deadline at 23:59 is every week, and it reads as the day's last word.
  return [...events, ...dues].sort(
    (x, y) => rank(x) - rank(y) || (x.kind === y.kind ? 0 : x.kind === 'event' ? -1 : 1),
  );
}

/** The spans the time-based styles lay out: timed events with a length. */
export function spansOf(items: Item[]) {
  return items
    .filter((i): i is EventItem => i.kind === 'event' && !i.allDay && i.endMin !== null)
    .map((i) => ({ id: i.id, start: i.startMin, end: i.endMin! }));
}

const WEEKDAY = new Intl.DateTimeFormat('en-CA', { weekday: 'long', timeZone: 'UTC' });
const WEEKDAY_SHORT = new Intl.DateTimeFormat('en-CA', { weekday: 'short', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('en-CA', { month: 'long', timeZone: 'UTC' });

/**
 * Names for a day key. Read at noon UTC from the key itself, so no zone can
 * move it — the key is already the account's local date.
 */
export function dayNames(day: DayKey) {
  const noon = new Date(`${day}T12:00:00Z`);
  return {
    weekday: WEEKDAY.format(noon),
    weekdayShort: WEEKDAY_SHORT.format(noon).replace('.', ''),
    month: MONTH.format(noon),
    date: Number(day.slice(8, 10)),
  };
}

/** "3 h", "45 min" — a day's estimated effort, for the header tag. */
export function effortLabel(minutes: number): string {
  return minutes >= 60 ? `${Math.round((minutes / 60) * 10) / 10} h` : `${minutes} min`;
}
