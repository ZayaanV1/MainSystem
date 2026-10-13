import { supabase } from './supabase';
import { localDayKey } from './time';
import { orValue, pattern, rankHits, type SearchHit } from './searchRank';

export type { SearchHit, SearchKind } from './searchRank';

/**
 * Finding anything, from one box.
 *
 * The problem this solves is specific: by week ten a term has a few hundred
 * rows across four tables, and "where did I put that" becomes its own task.
 * A search that only covered assignments would send you hunting through the
 * other three.
 *
 * Ranked so exact-ish title matches come before incidental ones, and open work
 * before finished work — the overwhelmingly common reason to search is to act
 * on something, not to audit it.
 */

export async function search(
  query: string,
  limit = 20,
): Promise<{ hits: SearchHit[]; failed: boolean }> {
  const q = query.trim();
  if (q.length < 2) return { hits: [], failed: false };

  const like = pattern(q);
  const quoted = orValue(like);

  const [assignments, events, inbox, courses, pages] = await Promise.all([
    supabase
      .from('assignments')
      .select('id, title, due_at, status, courses(code, name)')
      .ilike('title', like)
      .limit(limit),
    supabase
      .from('events')
      .select('id, title, kind, starts_at, courses(code, name)')
      .ilike('title', like)
      .limit(limit),
    supabase
      .from('inbox_items')
      .select('id, body, created_at, triaged_at')
      .ilike('body', like)
      .limit(limit),
    supabase.from('courses').select('id, name, code').or(`name.ilike.${quoted},code.ilike.${quoted}`).limit(limit),
    // What was written on a course's page: "where are office hours" finds
    // the course whose page says so.
    supabase
      .from('course_pages')
      .select('course_id, notes, office_hours, contacts, courses(code, name)')
      .or(`notes.ilike.${quoted},office_hours.ilike.${quoted},contacts.ilike.${quoted}`)
      .limit(limit),
  ]);

  // A failed read is not "nothing matches". Offline, every table errors, and
  // the screen used to report that confidently as an empty result.
  const failed = [assignments, events, inbox, courses, pages].some((r) => r.error);

  const hits: SearchHit[] = [];

  type WithCourse = { courses?: { code?: string; name?: string } | null };
  const courseOf = (r: WithCourse) => r.courses?.code ?? r.courses?.name ?? null;

  for (const a of (assignments.data ?? []) as (WithCourse & {
    id: string; title: string; due_at: string | null; status: string;
  })[]) {
    hits.push({
      kind: 'assignment',
      id: a.id,
      title: a.title,
      detail: courseOf(a),
      day: a.due_at ? localDayKey(new Date(a.due_at)) : null,
      done: a.status === 'done',
    });
  }

  for (const e of (events.data ?? []) as (WithCourse & {
    id: string; title: string; kind: string; starts_at: string;
  })[]) {
    hits.push({
      kind: 'event',
      id: e.id,
      title: e.title,
      detail: [e.kind, courseOf(e)].filter(Boolean).join(' · ') || null,
      day: localDayKey(new Date(e.starts_at)),
      done: false,
    });
  }

  for (const i of (inbox.data ?? []) as {
    id: string; body: string; created_at: string; triaged_at: string | null;
  }[]) {
    hits.push({
      kind: 'inbox',
      id: i.id,
      title: i.body,
      detail: i.triaged_at ? 'sorted' : 'not sorted yet',
      day: localDayKey(new Date(i.created_at)),
      done: Boolean(i.triaged_at),
    });
  }

  for (const c of (courses.data ?? []) as { id: string; name: string; code: string | null }[]) {
    hits.push({
      kind: 'course',
      id: c.id,
      title: c.code ? `${c.code} — ${c.name}` : c.name,
      detail: 'course',
      day: null,
      done: false,
    });
  }

  // A page whose writing matches, unless its course already matched by name.
  for (const p of (pages.data ?? []) as (WithCourse & {
    course_id: string; notes: string; office_hours: string; contacts: string;
  })[]) {
    if (hits.some((h) => h.kind === 'course' && h.id === p.course_id)) continue;
    const field = [p.office_hours, p.contacts, p.notes].find((v) => v.toLowerCase().includes(q.toLowerCase())) ?? p.notes;
    const name = p.courses?.code && p.courses?.name ? `${p.courses.code} — ${p.courses.name}` : (courseOf(p) ?? 'A course');
    hits.push({
      kind: 'course',
      id: p.course_id,
      title: name,
      detail: snippet(field, q),
      day: null,
      done: false,
    });
  }

  return { hits: rankHits(hits, q, limit), failed };
}

/** The words around a match, on one line: "…office hours Tue 2–4 in EV 3.301…". */
export function snippet(text: string, q: string, radius = 40): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = flat.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return flat.slice(0, radius * 2);
  const from = Math.max(0, at - radius);
  const to = Math.min(flat.length, at + q.length + radius);
  return `${from > 0 ? '…' : ''}${flat.slice(from, to)}${to < flat.length ? '…' : ''}`;
}
