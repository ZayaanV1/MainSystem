import { addDays, localDayKey } from './time';
import type { Assignment, Course, PlannerEvent } from './planner';
import type { SearchHit } from './searchRank';

/**
 * Where an empty Search starts.
 *
 * An empty box with "type two letters" under it asked the reader to know what
 * to type. Most searches are one of four questions — what is late, what is
 * due this week, when are the exams, what has no date — or "everything for
 * this course", and all five can be answered from the day already loaded, so
 * each is one tap and costs no query.
 */

export type JumpId = 'late' | 'week' | 'exams' | 'none';

export interface Jump {
  id: JumpId;
  label: string;
  hits: SearchHit[];
}

interface Loaded {
  assignments: Assignment[];
  events: PlannerEvent[];
  courses: Course[];
}

const codeOf = (courses: Course[], id: string | null) => {
  const c = courses.find((x) => x.id === id);
  return c ? (c.code ?? c.name) : null;
};

function workHit(a: Assignment, courses: Course[], tz?: string): SearchHit {
  return {
    kind: 'assignment',
    id: a.id,
    title: a.title,
    detail: codeOf(courses, a.course_id),
    day: a.due_at ? localDayKey(new Date(a.due_at), tz) : null,
    done: a.status === 'done',
  };
}

function eventHit(e: PlannerEvent, courses: Course[], tz?: string): SearchHit {
  return {
    kind: 'event',
    id: e.id,
    title: e.title,
    detail: [e.kind === 'other' ? null : e.kind, codeOf(courses, e.course_id)].filter(Boolean).join(' · ') || null,
    day: localDayKey(new Date(e.starts_at), tz),
    done: false,
  };
}

/** The four jumps that have something in them, in reading order. */
export function jumps(data: Loaded, now: Date, tz?: string): Jump[] {
  const today = localDayKey(now, tz);
  const weekEnd = addDays(today, 6);
  const open = data.assignments.filter((a) => a.status !== 'done');
  const late = open.filter((a) => a.due_at && new Date(a.due_at).getTime() < now.getTime());
  const week = open.filter((a) => {
    if (!a.due_at || new Date(a.due_at).getTime() < now.getTime()) return false;
    const day = localDayKey(new Date(a.due_at), tz);
    return day <= weekEnd;
  });
  const exams = data.events
    .filter((e) => e.kind === 'exam' && new Date(e.ends_at ?? e.starts_at).getTime() >= now.getTime())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const undated = open.filter((a) => !a.due_at);

  const all: Jump[] = [
    { id: 'late', label: 'Late', hits: late.map((a) => workHit(a, data.courses, tz)) },
    { id: 'week', label: 'Due this week', hits: week.map((a) => workHit(a, data.courses, tz)) },
    { id: 'exams', label: 'Exams', hits: exams.map((e) => eventHit(e, data.courses, tz)) },
    { id: 'none', label: 'No date', hits: undated.map((a) => workHit(a, data.courses, tz)) },
  ];
  return all.filter((j) => j.hits.length > 0);
}

/** Everything open in one course: its work, then what is coming on its calendar. */
export function courseHits(data: Loaded, courseId: string, now: Date, tz?: string): SearchHit[] {
  const work = data.assignments
    .filter((a) => a.course_id === courseId && a.status !== 'done')
    .map((a) => workHit(a, data.courses, tz));
  const events = data.events
    .filter((e) => e.course_id === courseId && new Date(e.ends_at ?? e.starts_at).getTime() >= now.getTime())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, 12)
    .map((e) => eventHit(e, data.courses, tz));
  return [...work, ...events];
}

/**
 * A title cut around what was typed, so the match can be marked. Case
 * insensitive; every occurrence; never splits inside the text in a way that
 * changes it (the pieces join back to the original).
 */
export function splitMatch(text: string, query: string): { text: string; match: boolean }[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const out: { text: string; match: boolean }[] = [];
  let at = 0;
  for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, at)) {
    if (i > at) out.push({ text: text.slice(at, i), match: false });
    out.push({ text: text.slice(i, i + q.length), match: true });
    at = i + q.length;
  }
  if (at < text.length) out.push({ text: text.slice(at), match: false });
  return out.length > 0 ? out : [{ text, match: false }];
}
