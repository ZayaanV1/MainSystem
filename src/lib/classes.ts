import { supabase } from './supabase';
import { addDays, todayKey, type DayKey } from './time';
import { clockMinutes, type ClassInstance, type ClassPattern, type ClassPlan } from '../../supabase/functions/_shared/classes';
import type { Course } from './planner';

/**
 * Classes typed by hand: reading them, and saving a plan for one.
 *
 * The pattern arithmetic is in `_shared/classes.ts` and runs in the form, so
 * the preview and the write are one function. This file only moves rows.
 *
 * NOT THROUGH THE OUTBOX, AND NEVER HALF WRITTEN
 *
 * A class is a parent row and up to two hundred sessions, and an edit moves,
 * adds and removes sessions together. Replayed from the outbox, that needs an
 * ordering it does not promise; sent as separate requests, a dropped
 * connection leaves a class half moved with nothing on screen to say which
 * half. So a save is one call to `save_class`, which applies the whole plan in
 * one transaction or none of it, and the form keeps everything typed when it
 * fails. Setting up a timetable is a start-of-term action at a desk, not a
 * capture on the metro.
 */

export interface ClassSeries extends ClassPattern {
  id: string;
  course_id: string | null;
  title: string;
  location: string | null;
}

export interface ClassSummary {
  series: ClassSeries;
  /** Its sessions, oldest first. */
  sessions: ClassInstance[];
  /**
   * False for a class that ended more than half a year ago, whose sessions
   * are not read: a few years of terms would otherwise run into PostgREST's
   * 1,000-row cap and drop the newest classes' sessions without a word.
   */
  loaded: boolean;
}

/** How far back a class's sessions are still read for the list. */
const RECENT_DAYS = 183;

export async function loadClasses(): Promise<{ items: ClassSummary[]; error: string | null }> {
  const res = await supabase
    .from('class_series')
    .select('id, course_id, title, weekdays, start_time, end_time, location, first_day, last_day, skip_days')
    .order('last_day', { ascending: false })
    .limit(200);
  if (res.error) return { items: [], error: res.error.message };

  const rows = ((res.data ?? []) as unknown as ClassSeries[]).map((r) => ({
    ...r,
    weekdays: (r.weekdays ?? []).map(Number),
    skip_days: r.skip_days ?? [],
  }));
  const cutoff = addDays(todayKey(), -RECENT_DAYS);
  const recent = rows.filter((r) => r.last_day >= cutoff).map((r) => r.id);

  const bySeries = new Map<string, ClassInstance[]>();
  if (recent.length > 0) {
    const sessions = await supabase
      .from('events')
      .select('id, series_id, starts_at, ends_at')
      .in('series_id', recent)
      .order('starts_at', { ascending: true })
      .limit(1000);
    if (sessions.error) return { items: [], error: sessions.error.message };
    for (const s of (sessions.data ?? []) as (ClassInstance & { series_id: string })[]) {
      const list = bySeries.get(s.series_id) ?? [];
      list.push({ id: s.id, starts_at: s.starts_at, ends_at: s.ends_at });
      bySeries.set(s.series_id, list);
    }
  }

  const today = todayKey();
  const items = rows.map((series) => ({
    series,
    sessions: bySeries.get(series.id) ?? [],
    loaded: series.last_day >= cutoff,
  }));
  // A timetable's order for what is running — the earliest weekday, then the
  // earliest time — and the most recently ended after it.
  const running = items.filter((i) => i.series.last_day >= today).sort((a, b) => timetableOrder(a.series) - timetableOrder(b.series));
  const ended = items.filter((i) => i.series.last_day < today);
  return { items: [...running, ...ended], error: null };
}

function timetableOrder(s: ClassSeries): number {
  return Math.min(...s.weekdays) * 24 * 60 + (clockMinutes(s.start_time) ?? 0);
}

/** Why a save did not happen, in words that say what to do. */
function saveError(message: string): string {
  if (/changed somewhere else/i.test(message)) return message;
  if (/fetch|network|load failed|timed? ?out/i.test(message)) {
    return 'Could not reach the server, so nothing was saved. Try again once you are online.';
  }
  return `Nothing was saved: ${message}`;
}

/** Writes a class and applies a plan for its sessions, all or nothing. */
export async function saveClass(series: ClassSeries, plan: ClassPlan): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('save_class', {
    p_class: {
      id: series.id,
      course_id: series.course_id,
      title: series.title.trim(),
      weekdays: [...series.weekdays].sort((a, b) => a - b),
      start_time: series.start_time,
      end_time: series.end_time,
      location: series.location?.trim() || null,
      first_day: series.first_day,
      last_day: series.last_day,
      skip_days: [...series.skip_days].sort(),
    },
    p_insert: plan.insert,
    p_update: plan.update.map(({ id, starts_at, ends_at }) => ({ id, starts_at, ends_at })),
    p_remove: plan.remove,
  });
  return { error: error ? saveError(error.message) : null };
}

/**
 * Deletes a class and the sessions given. Sessions not given stay on the
 * calendar as ordinary events, which is how the ones that already happened
 * are kept as a record unless the user asks otherwise.
 */
export async function deleteClass(id: string, remove: string[]): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('delete_class', { p_id: id, p_remove: remove });
  return { error: error ? saveError(error.message).replace('saved', 'deleted') : null };
}

/**
 * The prefix a class's title starts with: its course's code, or its name when
 * it has no code. "COEN 231 Lecture" is stored whole, because Search, Abood
 * and a subscribed phone calendar read the title and cannot see a colour; the
 * form shows the code as a fixed prefix and edits only the rest.
 */
export function coursePrefix(course: Course | undefined): string {
  return course ? (course.code ?? course.name).trim() : '';
}

/** The part of a stored title the form edits, without its course prefix. */
export function titleName(title: string, course: Course | undefined): string {
  const prefix = coursePrefix(course);
  return prefix && title.startsWith(`${prefix} `) ? title.slice(prefix.length + 1) : title;
}

/** The days a class has met and is still to meet, as of a day. */
export function sessionCounts(sessions: ClassInstance[], now: Date): { happened: number; toCome: number } {
  const t = now.getTime();
  const toCome = sessions.filter((s) => Date.parse(s.starts_at) >= t).length;
  return { happened: sessions.length - toCome, toCome };
}

/**
 * The span of the current term, read from the classes typed by hand: the
 * earliest first day and the latest last day of every class still running
 * or ending within the last week. Null when there are none, so the term is
 * never invented from a guessed start date.
 */
export async function termSpan(today: DayKey): Promise<{ span: { first: DayKey; last: DayKey } | null; error: string | null }> {
  const { data, error } = await supabase
    .from('class_series')
    .select('first_day, last_day')
    .gte('last_day', addDays(today, -7))
    .limit(100);
  if (error) return { span: null, error: error.message };
  const rows = (data ?? []) as { first_day: DayKey; last_day: DayKey }[];
  if (!rows.length) return { span: null, error: null };
  return {
    span: {
      first: rows.reduce((m, r) => (r.first_day < m ? r.first_day : m), rows[0].first_day),
      last: rows.reduce((m, r) => (r.last_day > m ? r.last_day : m), rows[0].last_day),
    },
    error: null,
  };
}
