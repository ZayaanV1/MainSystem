import { supabase } from './supabase';
import { enqueue } from './outbox';
import { recentDays, type ChecklistItem } from './checklist';
import { HISTORY_DAYS } from '../../supabase/functions/_shared/history';
import { endOfDayUTC, startOfDayUTC, todayKey, wallClockToUTC, type DayKey } from './time';

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
  remind_at: string | null;
}

/** Course colour tokens, by the index stored on the row. */
export function courseVar(colourIndex: number | null | undefined): string | undefined {
  if (!colourIndex) return undefined;
  return `--c-${Math.min(8, Math.max(1, colourIndex))}`;
}

export interface Subtask {
  id: string;
  assignment_id: string;
  title: string;
  done: boolean;
  position: number;
}

export interface Completion {
  item_id: string;
  local_day: DayKey;
}

export interface PlannerEvent {
  id: string;
  course_id: string | null;
  title: string;
  kind: 'exam' | 'lab' | 'presentation' | 'other';
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
}

export interface TodayData {
  items: ChecklistItem[];
  completions: Completion[];
  inbox: InboxItem[];
  courses: Course[];
  assignments: Assignment[];
  events: PlannerEvent[];
  subtasks: Subtask[];
  /**
   * Work finished today.
   *
   * Fetched only so the app can tell "you cleared it" apart from "there was
   * never anything". Congratulating an empty day you did nothing to earn is
   * the kind of hollow praise you can feel, and it devalues the real thing.
   */
  completedToday: Assignment[];
  /** Persisted server-side, so a bad day does not start by finding a toggle. */
  lowBattery: boolean;
}

/** How many days the Today day-strip offers. Bounded on purpose. */
export const BACKFILL_DAYS = 5;

export async function loadToday(today: DayKey = todayKey()): Promise<TodayData> {
  // Completions are fetched for the full HISTORY window, not the five days the
  // day-strip shows. Fetching only five made the history grid draw every older
  // day as untouched — a month of completed days rendered as a wall of blanks,
  // which is precisely the shaming display rule 3 forbids, produced by nothing
  // but a query limit.
  const window = recentDays(today, Math.max(BACKFILL_DAYS, HISTORY_DAYS));

  const [items, completions, inbox, courses, assignments, events, subtasks, completedToday, settings] =
    await Promise.all([
    supabase
      .from('checklist_items')
      .select(
        'id, title, recurrence, weekdays, interval_days, anchor_day, active, sort_order, essential, remind_at, tracks_doses, doses_remaining, doses_per_completion, refill_warning_days',
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
        'id, course_id, title, due_at, due_has_time, effort_minutes, status, notes, start_by_override, remind_at',
      )
      .neq('status', 'done')
      .order('due_at', { ascending: true, nullsFirst: false }),

    // Events from the start of today onwards. Past events are not shown
    // anywhere — an exam you already sat is not information, it is clutter.
    supabase
      .from('events')
      .select('id, course_id, title, kind, starts_at, ends_at, all_day, location')
      .gte('starts_at', startOfDayUTC(today).toISOString())
      .order('starts_at', { ascending: true }),

    supabase
      .from('subtasks')
      .select('id, assignment_id, title, done, position')
      .order('position', { ascending: true }),

    supabase
      .from('assignments')
      .select(
        'id, course_id, title, due_at, due_has_time, effort_minutes, status, notes, start_by_override',
      )
      .eq('status', 'done')
      .gte('completed_at', startOfDayUTC(today).toISOString())
      .lt('completed_at', endOfDayUTC(today).toISOString()),

    supabase.from('app_settings').select('low_battery').limit(1),
  ]);

  return {
    items: (items.data ?? []) as ChecklistItem[],
    completions: (completions.data ?? []) as Completion[],
    inbox: (inbox.data ?? []) as InboxItem[],
    courses: (courses.data ?? []) as Course[],
    assignments: (assignments.data ?? []) as Assignment[],
    events: (events.data ?? []) as PlannerEvent[],
    subtasks: (subtasks.data ?? []) as Subtask[],
    completedToday: (completedToday.data ?? []) as Assignment[],
    lowBattery: Boolean((settings.data ?? [])[0]?.low_battery),
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

/**
 * Creates a calendar event.
 *
 * An event with no stated time is all-day and starts at the BEGINNING of its
 * day. An assignment with no time is due at the END of its day, and the two
 * rules are opposite on purpose: "due Friday" that reads as overdue all Friday
 * destroys trust in the edge colour, and an exam stored at 23:59 makes the
 * T-1 escalation fire a day early. Both of those have already happened once.
 */
export async function addEvent(
  userId: string,
  fields: {
    title: string;
    kind: PlannerEvent['kind'];
    day: DayKey;
    /** Local wall-clock 'HH:MM', or null for all day. */
    time: string | null;
    course_id?: string | null;
    notes?: string | null;
  },
): Promise<void> {
  const [hour, minute] = fields.time ? fields.time.split(':').map(Number) : [0, 0];
  const startsAt = fields.time
    ? wallClockToUTC(fields.day, hour, minute)
    : startOfDayUTC(fields.day);

  await enqueue('events', 'insert', {
    user_id: userId,
    title: fields.title.trim(),
    kind: fields.kind,
    course_id: fields.course_id ?? null,
    starts_at: startsAt.toISOString(),
    all_day: !fields.time,
    notes: fields.notes ?? null,
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

/* --------------------------------------------------------------- subtasks */

/**
 * Break a piece of work into first moves.
 *
 * "Write research paper" is paralysis; "open a doc and write three possible
 * thesis sentences" is not. Subtasks exist to manufacture that second thing,
 * and in Phase 4 the breakdown button will fill them in automatically — which
 * is why adding one asks for nothing but a line of text.
 */
export async function addSubtask(
  userId: string,
  assignmentId: string,
  title: string,
  position: number,
): Promise<void> {
  const text = title.trim();
  if (!text) return;

  await enqueue('subtasks', 'insert', {
    user_id: userId,
    assignment_id: assignmentId,
    title: text,
    position,
  });
}

export async function setSubtaskDone(id: string, done: boolean): Promise<void> {
  await enqueue('subtasks', 'update', { done }, { id });
}

export async function deleteSubtask(id: string): Promise<void> {
  await enqueue('subtasks', 'delete', {}, { id });
}

/** How far along a piece of work is. Null when it has no subtasks. */
export function subtaskProgress(
  subtasks: Subtask[],
  assignmentId: string,
): { done: number; total: number } | null {
  const mine = subtasks.filter((s) => s.assignment_id === assignmentId);
  if (mine.length === 0) return null;
  return { done: mine.filter((s) => s.done).length, total: mine.length };
}

/* ------------------------------------------------------------- checklist */

export interface ChecklistFields {
  title: string;
  essential: boolean;
  /** Local 'HH:MM', or null for no reminder. */
  remind_at: string | null;
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
    essential: f.essential,
    remind_at: f.remind_at || null,
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

/* -------------------------------------------------------------- settings */

export interface DigestSettings {
  digest_hour: number;
  digest_minute: number;
  digest_enabled: boolean;
  assignment_window_days: number;
  event_window_days: number;
}

export async function loadDigestSettings(): Promise<DigestSettings | null> {
  const { data } = await supabase
    .from('app_settings')
    .select('digest_hour, digest_minute, digest_enabled, assignment_window_days, event_window_days')
    .limit(1);

  return (data?.[0] as DigestSettings) ?? null;
}

/**
 * Written straight through rather than queued.
 *
 * The scheduler reads these on its own timetable, so a change sitting in the
 * outbox would mean the digest quietly kept its old time until the app
 * happened to sync — and the whole point of changing it is that the new time
 * is the one you want tomorrow morning.
 */
export async function saveDigestSettings(
  userId: string,
  fields: DigestSettings,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('app_settings')
    .update({
      digest_hour: Math.min(23, Math.max(0, fields.digest_hour)),
      digest_minute: Math.min(59, Math.max(0, fields.digest_minute)),
      digest_enabled: fields.digest_enabled,
      assignment_window_days: Math.min(90, Math.max(1, fields.assignment_window_days)),
      event_window_days: Math.min(90, Math.max(1, fields.event_window_days)),
    })
    .eq('user_id', userId);

  return { error: error ? error.message : null };
}

/* ----------------------------------------------------------- low battery */

/**
 * Turning the day down, or back up.
 *
 * Written straight through rather than queued, and awaited. This is the one
 * setting whose whole value is that it takes effect the instant it is asked
 * for — a bad day is not the moment to wonder whether a tap registered.
 */
export async function setLowBattery(userId: string, on: boolean): Promise<void> {
  await supabase.from('app_settings').update({ low_battery: on }).eq('user_id', userId);
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

/**
 * Turn a captured thought into a piece of work.
 *
 * Two writes that must both land: the assignment is created, and the inbox
 * item is stamped rather than deleted. Stamping keeps the original wording —
 * "chem lab report??" is sometimes more informative than the tidy title it
 * became — and makes it possible to see later what capture actually caught.
 *
 * The id is generated here rather than by the database so the second write can
 * point at the first without waiting for a round trip. That is what lets
 * triage work with no connection at all.
 */
export async function triageToAssignment(
  userId: string,
  itemId: string,
  fields: AssignmentFields,
): Promise<void> {
  const id = crypto.randomUUID();

  await enqueue('assignments', 'insert', {
    id,
    user_id: userId,
    title: fields.title.trim(),
    course_id: fields.course_id,
    due_at: assignmentDueAt(fields.due_day, fields.due_time),
    due_has_time: Boolean(fields.due_time),
    effort_minutes: fields.effort_minutes,
    notes: fields.notes?.trim() || null,
    remind_at: fields.remind_at,
  });

  await enqueue(
    'inbox_items',
    'update',
    { triaged_at: new Date().toISOString(), converted_to: id },
    { id: itemId },
  );
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
  /** A single instant, or null. Stored as ISO. */
  remind_at: string | null;
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
      remind_at: fields.remind_at,
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
