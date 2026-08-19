import type { DayKey } from './time';

/**
 * The pure half of search: what a hit is, how it is escaped, how it is ranked.
 *
 * Split from the querying so the ranking can be tested without constructing a
 * Supabase client, which cannot be built in the test environment. The rules
 * here are the part worth pinning; the queries are a round trip.
 */

export type SearchKind = 'assignment' | 'event' | 'inbox' | 'course' | 'food';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  /** Date, course, whatever distinguishes two similarly named things. */
  detail: string | null;
  /** Local day it belongs to, for ordering and display. */
  day: DayKey | null;
  done: boolean;
}

/** Postgres `ilike` wildcards, escaped so a literal % does not match everything. */
export function pattern(query: string): string {
  return `%${query.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Scores a hit against the query.
 *
 * Lower is better. The ordering that matters: something whose title starts
 * with what you typed beats something that merely contains it, and open work
 * beats finished work, because searching is nearly always a prelude to acting
 * rather than to auditing.
 */
export function score(hit: SearchHit, query: string): number {
  const q = query.trim().toLowerCase();
  const t = hit.title.toLowerCase();

  let s = 0;
  if (t === q) s += 0;
  else if (t.startsWith(q)) s += 1;
  else if (t.includes(q)) s += 2;
  else s += 3;

  if (hit.done) s += 4;

  // Undated things sort after dated ones of the same relevance: a deadline is
  // more actionable than a note with no date.
  if (!hit.day) s += 0.5;

  return s;
}

/**
 * One row per thing.
 *
 * Food is searched per item and reported per entry, so a meal containing both
 * "chicken breast" and "chicken stock" would otherwise appear twice pointing
 * at the same place.
 */
export function dedupe(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  return hits.filter((h) => {
    const key = `${h.kind}:${h.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Relevance first, then newest, which is how the results are shown. */
export function rankHits(hits: SearchHit[], query: string, limit: number): SearchHit[] {
  return dedupe(hits)
    .sort((a, b) => {
      const d = score(a, query) - score(b, query);
      if (d !== 0) return d;
      // Newest first within a relevance tier: this term beats last term.
      return (b.day ?? '').localeCompare(a.day ?? '');
    })
    .slice(0, limit);
}
