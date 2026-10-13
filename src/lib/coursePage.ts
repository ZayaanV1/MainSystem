import { supabase } from './supabase';
import type { Assignment, PlannerEvent } from './planner';

/**
 * A course's page: the parts a person writes (notes, office hours, contacts,
 * links, the syllabus as it was read), beside everything the app already
 * knows about the course.
 *
 * The page exists before its row does. Nothing is created on opening it; a
 * row appears the first time something is written, so a course nobody has
 * annotated costs nothing.
 */

export interface CourseLink {
  label: string;
  url: string;
}

export interface CoursePage {
  notes: string;
  office_hours: string;
  contacts: string;
  links: CourseLink[];
  syllabus_text: string | null;
}

export const EMPTY_PAGE: CoursePage = { notes: '', office_hours: '', contacts: '', links: [], syllabus_text: null };

/** An event of the course, with what it is worth when it is an exam or presentation. */
export type CourseEvent = PlannerEvent & { weight_percent: number | null; grade_percent: number | null };

export interface CourseFact {
  id: string;
  fact: string;
  created_at: string;
}

/** Everything on the page, read at once. A failed read says so; it never shows an empty page as though it were one. */
export async function loadCourse(courseId: string): Promise<{
  page: CoursePage;
  work: Assignment[];
  events: CourseEvent[];
  facts: CourseFact[];
  failed: boolean;
}> {
  const [page, work, events, facts] = await Promise.all([
    supabase.from('course_pages').select('notes, office_hours, contacts, links, syllabus_text').eq('course_id', courseId).maybeSingle(),
    supabase
      .from('assignments')
      .select(
        'id, course_id, title, due_at, due_has_time, effort_minutes, actual_minutes, status, notes, start_by_override, remind_at, weight_percent, grade_percent, link',
      )
      .eq('course_id', courseId)
      .order('due_at', { ascending: true, nullsFirst: false }),
    supabase
      .from('events')
      .select('id, course_id, title, kind, starts_at, ends_at, all_day, location, feed_id, weight_percent, grade_percent')
      .eq('course_id', courseId)
      .order('starts_at', { ascending: true }),
    supabase.from('memory_facts').select('id, fact, created_at').eq('course_id', courseId).order('created_at', { ascending: true }),
  ]);
  const row = page.data as Partial<CoursePage> | null;
  return {
    page: {
      ...EMPTY_PAGE,
      ...(row ?? {}),
      links: Array.isArray(row?.links) ? (row.links as CourseLink[]).filter((l) => l && typeof l.url === 'string') : [],
    },
    work: (work.data ?? []) as Assignment[],
    events: ((events.data ?? []) as CourseEvent[]).map((e) => ({
      ...e,
      weight_percent: e.weight_percent == null ? null : Number(e.weight_percent),
      grade_percent: e.grade_percent == null ? null : Number(e.grade_percent),
    })),
    facts: (facts.data ?? []) as CourseFact[],
    failed: Boolean(page.error || work.error || events.error || facts.error),
  };
}

/**
 * Writes part of the page. An upsert of only the fields given, so saving the
 * office hours never overwrites notes typed on another device a moment ago.
 * The error is returned to be shown beside the field, whose text is kept.
 */
export async function saveCoursePage(userId: string, courseId: string, patch: Partial<CoursePage>): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('course_pages')
    .upsert({ course_id: courseId, user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'course_id' });
  return { error: error ? 'Couldn’t save that. What you typed is still here; try again.' : null };
}

/** Keeps the syllabus text a course's deadlines were read from, so its page can show it. Best effort: the import itself never waits on this. */
export async function keepSyllabusText(userId: string, courseId: string | null, text: string): Promise<void> {
  if (!courseId || text.trim().length < 20) return;
  await saveCoursePage(userId, courseId, { syllabus_text: text.trim().slice(0, 60000) });
}

/** Forgets one thing Abood knew. The same delete as Settings' memory list. */
export async function forgetCourseFact(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('memory_facts').delete().eq('id', id);
  return { error: error ? 'Couldn’t remove that. Try again.' : null };
}

/** http(s) only, the same rule the database holds work links to; a bare domain gets https. */
export function normaliseUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}
