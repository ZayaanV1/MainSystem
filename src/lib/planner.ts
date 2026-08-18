import { supabase } from './supabase';
import { enqueue } from './outbox';
import { recentDays, type ChecklistItem } from './checklist';
import { todayKey, wallClockToUTC, type DayKey } from './time';

/**
 * Data access for the planner.
 *
 * Reads go straight to Supabase. Writes go through the IndexedDB outbox, so a
 * tap made on the metro is durable on disk before the interface claims it
 * worked, and replays on reconnect.
 *
 * The one asymmetry worth knowing: the medication dose count is maintained by
 * a database trigger, not here. So after a completion syncs, the count has to
 * be re-read rather than guessed at locally — which is why `loadToday` is
 * called again when the outbox drains.
 */

export interface InboxItem {
  id: string;
  body: string;
  source: string;
  created_at: string;
}

export interface Course {
  id: string;
  name: string;
  code: string | null;
  colour_index: number;
  archived: boolean;
}

export interface Assignment {
  id: string;
  course_id: string | null;
  title: string;
  due_at: string | null;
  due_has_time: boolean;
  effort_minutes: number | null;
  status: 'todo' | 'doing' | 'done';
  notes: string | null;
  start_by_override: DayKey | null;
}

/** Course colour tokens, by the index stored on the row. */
export function courseVar(colourIndex: number | null | undefined): string | undefined {
  if (!colourIndex) return undefined;
  return `--c-${Math.min(8, Math.max(1, colourIndex))}`;
}

export interface Completion {
  item_id: string;
  local_day: DayKey;
}

export interface TodayData {
  items: ChecklistItem[];
  completions: Completion[];
  inbox: InboxItem[];
  courses: Course[];
  assignments: Assignment[];
}

/** How many days of back-fill are offered. Bounded on purpose. */
export const BACKFILL_DAYS = 5;

export async function loadToday(today: DayKey = todayKey()): Promise<TodayData> {
  const window = recentDays(today, BACKFILL_DAYS);

  const [items, completions, inbox, courses, assignments] = await Promise.all([
    supabase
      .from('checklist_items')
      .select(
        'id, title, recurrence, weekdays, interval_days, anchor_day, active, sort_order, tracks_doses, doses_remaining, doses_per_completion, refill_warning_days',
      )
      .eq('active', true)
      .order('sort_order'),

    supabase
      .from('checklist_completions')
      .select('item_id, local_day')
      .gte('local_day', window[0])
      .lte('local_day', window[window.length - 1]),

    supabase
      .from('inbox_items')
      .select('id, body, source, created_at')
      .is('triaged_at', null)
      .is('dismissed_at', null)
      .order('created_at', { ascending: false }),

    supabase
      .from('courses')
      .select('id, name, code, colour_index, archived')
      .eq('archived', false)
      .order('name'),

    // Undated work is fetched too. An assignment without a date is the easiest
    // kind to lose, so it must not be filtered out of the only screen that
    // shows anything.
    supabase
      .from('assignments')
      .select(
        'id, course_id, title, due_at, due_has_time, effort_minutes, status, notes, start_by_override',
      )
      .neq('status', 'done')
      .order('due_at', { ascending: true, nullsFirst: false }),
  ]);

  return {
    items: (items.data ?? []) as ChecklistItem[],
    completions: (completions.data ?? []) as Completion[],
    inbox: (inbox.data ?? []) as InboxItem[],
    courses: (courses.data ?? []) as Course[],
    assignments: (assignments.data ?? []) as Assignment[],
  };
}

/* ------------------------------------------------------------ assignments */

export async function addAssignment(
  userId: string,
  fields: {
    title: string;
    course_id?: string | null;
    due_at?: string | null;
    due_has_time?: boolean;
    effort_minutes?: number | null;
  },
): Promise<void> {
  await enqueue('assignments', 'insert', {
    user_id: userId,
    title: fields.title.trim(),
    course_id: fields.course_id ?? null,
    due_at: fields.due_at ?? null,
    due_has_time: fields.due_has_time ?? false,
    effort_minutes: fields.effort_minutes ?? null,
  });
}

export async function setAssignmentStatus(
  id: string,
  status: Assignment['status'],
): Promise<void> {
  await enqueue(
    'assignments',
    'update',
    { status, completed_at: status === 'done' ? new Date().toISOString() : null },
    { id },
  );
}

/* ------------------------------------------------------------- checklist */

export interface ChecklistFields {
  title: string;
  recurrence: 'daily' | 'weekdays' | 'interval';
  weekdays: number[] | null;
  interval_days: number | null;
  anchor_day: DayKey | null;
  tracks_doses: boolean;
  doses_remaining: number | null;
  doses_per_completion: number;
  refill_warning_days: number;
}

export async function addChecklistItem(
  userId: string,
  fields: ChecklistFields,
  sortOrder: number,
): Promise<void> {
  await enqueue('checklist_items', 'insert', {
    user_id: userId,
    sort_order: sortOrder,
    ...normaliseChecklist(fields),
  });
}

export async function updateChecklistItem(
  id: string,
  fields: ChecklistFields,
): Promise<void> {
  await enqueue('checklist_items', 'update', normaliseChecklist(fields), { id });
}

/**
 * Items are deactivated, never deleted.
 *
 * Deleting would cascade away every completion attached to it, quietly
 * rewriting history — and the medication record in particular is worth
 * keeping even after the prescription changes.
 */
export async function deactivateChecklistItem(id: string): Promise<void> {
  await enqueue('checklist_items', 'update', { active: false }, { id });
}

/**
 * Clears the fields that do not apply to the chosen recurrence.
 *
 * The database rejects a weekdays item with no weekdays and an interval item
 * with no interval, but it will happily store a daily item carrying stale
 * weekday data from a previous edit — which then reappears if the recurrence
 * is switched back, silently and wrongly.
 */
function normaliseChecklist(f: ChecklistFields) {
  return {
    title: f.title.trim(),
    recurrence: f.recurrence,
    weekdays: f.recurrence === 'weekdays' ? f.weekdays : null,
    interval_days: f.recurrence === 'interval' ? f.interval_days : null,
    anchor_day: f.recurrence === 'interval' ? f.anchor_day : null,
    tracks_doses: f.tracks_doses,
    doses_remaining: f.tracks_doses ? (f.doses_remaining ?? 0) : null,
    doses_per_completion: Math.max(1, f.doses_per_completion),
    refill_warning_days: Math.max(0, f.refill_warning_days),
  };
}

/* ---------------------------------------------------------------- courses */

export async function addCourse(
  userId: string,
  name: string,
  colourIndex: number,
  code?: string,
): Promise<void> {
  await enqueue('courses', 'insert', {
    user_id: userId,
    name: name.trim(),
    code: code?.trim() || null,
    colour_index: colourIndex,
  });
}

/**
 * Quick capture.
 *
 * One field, no validation beyond "not blank", no course, no date, no type.
 * Every question asked here is a chance for the thought to evaporate before it
 * is recorded, so none are asked.
 */
export async function capture(userId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) return;

  await enqueue('inbox_items', 'insert', {
    user_id: userId,
    body: text,
    source: 'app',
  });
}

export async function dismissInboxItem(id: string): Promise<void> {
  await enqueue('inbox_items', 'update', { dismissed_at: new Date().toISOString() }, { id });
}

/**
 * Check or uncheck an item for a given local day.
 *
 * Deleting the row rather than flagging it is what makes the dose trigger
 * symmetrical: an accidental tap costs nothing because unchecking hands the
 * dose straight back.
 *
 * `backfilled` is recorded for any day that is not today. It never surfaces in
 * the interface as a judgement — it exists so an export can tell the
 * difference, and nothing else reads it.
 */
export async function setCompletion(
  userId: string,
  itemId: string,
  day: DayKey,
  done: boolean,
  today: DayKey = todayKey(),
): Promise<void> {
  if (done) {
    await enqueue('checklist_completions', 'insert', {
      user_id: userId,
      item_id: itemId,
      local_day: day,
      backfilled: day !== today,
    });
  } else {
    await enqueue('checklist_completions', 'delete', {}, { item_id: itemId, local_day: day });
  }
}

/** Fast membership lookup for "was this item done on this day". */
export function completionKey(itemId: string, day: DayKey): string {
  return `${itemId}|${day}`;
}

export function completionSet(completions: Completion[]): Set<string> {
  return new Set(completions.map((c) => completionKey(c.item_id, c.local_day)));
}

/* ------------------------------------------------------------ assignment edit */

export interface AssignmentFields {
  title: string;
  course_id: string | null;
  /** Local calendar date, or null for undated work. */
  due_day: DayKey | null;
  /** Local wall-clock 'HH:MM', or null for "some time that day". */
  due_time: string | null;
  effort_minutes: number | null;
  notes: string | null;
}

/**
 * An assignment with no time is due at the END of its day.
 *
 * Midnight would make "due Friday" read as overdue for the whole of Friday,
 * which is the fastest way to stop trusting the colour on the left edge.
 */
export function assignmentDueAt(
  day: DayKey | null,
  time: string | null,
  timezone?: string,
): string | null {
  if (!day) return null;
  const [h, m] = time ? time.split(':').map(Number) : [23, 59];
  return wallClockToUTC(day, h, m, 0, timezone).toISOString();
}

export async function updateAssignment(id: string, fields: AssignmentFields): Promise<void> {
  await enqueue(
    'assignments',
    'update',
    {
      title: fields.title.trim(),
      course_id: fields.course_id,
      due_at: assignmentDueAt(fields.due_day, fields.due_time),
      due_has_time: Boolean(fields.due_time),
      effort_minutes: fields.effort_minutes,
      notes: fields.notes?.trim() || null,
    },
    { id },
  );
}

/**
 * Genuinely deletes.
 *
 * Unlike a checklist item, an assignment carries no history worth preserving
 * once it is gone — and a planner you cannot remove things from accumulates
 * into a wall of things you are not doing, which is its own reason to stop
 * opening it.
 */
export async function deleteAssignment(id: string): Promise<void> {
  await enqueue('assignments', 'delete', {}, { id });
}
