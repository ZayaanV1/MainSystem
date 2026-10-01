import { supabase } from './supabase';
import { localDayKey } from './time';
import { pattern, rankHits, type SearchHit } from './searchRank';

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

export async function search(query: string, limit = 20): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const like = pattern(q);

  const [assignments, events, inbox, courses] = await Promise.all([
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
    supabase.from('courses').select('id, name, code').or(`name.ilike.${like},code.ilike.${like}`).limit(limit),
  ]);

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

  return rankHits(hits, q, limit);
}
