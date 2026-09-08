import { supabase } from './supabase';
import { enqueue } from './outbox';
import { recentDays, type ChecklistItem } from './checklist';
import { HISTORY_DAYS } from '../../supabase/functions/_shared/history';
import { missingDays } from '../../supabase/functions/_shared/series';
import { clearCache, getCache, putCache } from './readcache';
import {
  endOfDayUTC,
  localDayKey,
  localHourMinute,
  detectedTimezone,
  setActiveTimezone,
  startOfDayUTC,
  todayKey,
  wallClockToUTC,
  type DayKey,
} from './time';

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
  /** How long it actually took. Null unless volunteered. */
  actual_minutes: number | null;
  status: 'todo' | 'doing' | 'done';
  notes: string | null;
  start_by_override: DayKey | null;
  remind_at: string | null;
  /**
   * Share of the final course grade, 0-100, or null when unknown.
   *
   * The syllabus importer has always extracted this and always thrown it away
   * — into a free-text note for events, and nowhere at all for assignments.
   */
  weight_percent: number | null;
  /** What this assessment actually scored, 0-100. Entered by hand. */
  grade_percent: number | null;
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
  /**
   * Which of the ten queries came back as an error.
   *
   * This exists because the alternative is worse than an error screen. Every
   * read below used to end in `data ?? []`, and Supabase returns
   * `{ data: null, error }` on failure — so a dropped connection, a 5xx, a
   * rate limit and an RLS denial all arrived as an empty array. Today then
   * rendered "Nothing due.", which is a real and correct-looking code path.
   *
   * The app was confidently telling people their day was clear when it had
   * simply failed to look. That is the confidently-wrong-deadline failure the
   * spec calls worse than having no chatbot at all, sitting on the one screen
   * rule 1 says the product is.
   *
   * Empty means everything loaded. A non-empty list names what did not, so
   * the screen can say so instead of inventing a quiet day.
   */
  failed: string[];
  /**
   * Set when this came from the offline cache, so the screen can say so.
   *
   * Null on a live load. A cached day presented as a live one is a quiet lie
   * about how current the deadlines are.
   */
  cachedAt: number | null;
  items: ChecklistItem[];
  completions: Completion[];
  inbox: InboxItem[];
  courses: Course[];
  assignments: Assignment[];
  events: PlannerEvent[];
  subtasks: Subtask[];
  /**
   * How many times each assignment has been pushed, by id.
   *
   * Derived by counting rows rather than read from a cached column, which is
   * the same rule that keeps missed days as absent rows. Only ids that have
   * actually moved appear.
   */
  deferrals: Record<string, number>;
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

/**
 * Reads the account's timezone and points the time layer at it.
 *
 * Must finish before anything else loads. Every "today" in the app resolves
 * through the active zone, and `loadToday` computes its query windows from
 * `todayKey()` at the top of the function — so setting the zone anywhere
 * inside that call is already too late for the load it is part of. On a night
 * either side of midnight, too late means the first screen shows the wrong day.
 *
 * Called once from the shell, awaited before the first render.
 */
export async function adoptAccountTimezone(userId: string): Promise<string> {
  const { data } = await supabase.from('app_settings').select('timezone').limit(1);

  const stored = (data ?? [])[0]?.timezone as string | undefined;

  // Null means nobody has chosen yet. The browser knows better than any city
  // this app could pick, and the answer is written back rather than merely
  // used — the scheduler has no browser to ask, and a digest computed in a
  // different zone from the app is the same wrong-day bug wearing a hat.
  if (!stored) {
    const detected = detectedTimezone();
    setActiveTimezone(detected);
    await supabase.from('app_settings').update({ timezone: detected }).eq('user_id', userId);
    return detected;
  }

  setActiveTimezone(stored);
  return stored;
}

export async function loadToday(today: DayKey = todayKey()): Promise<TodayData> {
  // Completions are fetched for the full HISTORY window, not the five days the
  // day-strip shows. Fetching only five made the history grid draw every older
  // day as untouched — a month of completed days rendered as a wall of blanks,
  // which is precisely the shaming display rule 3 forbids, produced by nothing
  // but a query limit.
  const window = recentDays(today, Math.max(BACKFILL_DAYS, HISTORY_DAYS));

  const [items, completions, inbox, courses, assignments, events, subtasks, completedToday, settings, deferralRows] =
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
        'id, course_id, title, due_at, due_has_time, effort_minutes, actual_minutes, status, notes, start_by_override, remind_at, weight_percent, grade_percent',
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
        'id, course_id, title, due_at, due_has_time, effort_minutes, actual_minutes, status, notes, start_by_override, weight_percent, grade_percent',
      )
      .eq('status', 'done')
      .gte('completed_at', startOfDayUTC(today).toISOString())
      .lt('completed_at', endOfDayUTC(today).toISOString()),

    supabase.from('app_settings').select('low_battery').limit(1),

    // Every deferral row for open work. Counted here rather than stored, so
    // the number can never drift from what actually happened.
    supabase.from('deferrals').select('assignment_id'),
  ]);

  /**
   * Names the reads that failed. The label is what the user would call the
   * thing, not the table, because it is shown to them.
   */
  const failed: string[] = [];
  const check = (label: string, r: { error: unknown }) => {
    if (r.error) failed.push(label);
  };
  check('your checklist', items);
  check('your checklist history', completions);
  check('your inbox', inbox);
  check('your courses', courses);
  check('your work', assignments);
  check('your calendar', events);
  check('the steps on your work', subtasks);
  check("what you finished today", completedToday);
  check('your settings', settings);
  check('deferrals', deferralRows);

  const deferrals: Record<string, number> = {};
  for (const row of (deferralRows.data ?? []) as { assignment_id: string }[]) {
    deferrals[row.assignment_id] = (deferrals[row.assignment_id] ?? 0) + 1;
  }

  /*
   * A total failure is the offline case, and the honest answer there is the
   * day you last saw rather than a blank screen. A PARTIAL failure is not:
   * mixing fresh rows with cached ones would produce a day that never existed,
   * so the banner names what is missing and the rest stands.
   *
   * `failed.length === 10` rather than `> 0` for exactly that reason.
   */
  if (failed.length === 10) {
    const hit = await getCache<TodayData>(`today:${today}`);
    if (hit) return { ...hit.value, failed: [], cachedAt: hit.at };
  }

  const result: TodayData = {
    failed,
    items: (items.data ?? []) as ChecklistItem[],
    completions: (completions.data ?? []) as Completion[],
    inbox: (inbox.data ?? []) as InboxItem[],
    courses: (courses.data ?? []) as Course[],
    assignments: (assignments.data ?? []) as Assignment[],
    events: (events.data ?? []) as PlannerEvent[],
    subtasks: (subtasks.data ?? []) as Subtask[],
    completedToday: (completedToday.data ?? []) as Assignment[],
    deferrals,
    lowBattery: Boolean((settings.data ?? [])[0]?.low_battery),
    cachedAt: null,
  };

  // Only a complete day is worth keeping. Caching a partial one would mean a
  // later offline open served a day with a section silently missing from it.
  if (failed.length === 0) void putCache(`today:${today}`, result);

  return result;
}

/**
 * Estimate-versus-actual pairs, for calibration.
 *
 * Only finished work that carries both numbers. Everything else is silence
 * rather than a filled-in guess.
 */
export async function loadCalibrationPairs(): Promise<{ estimated: number; actual: number }[]> {
  const { data } = await supabase
    .from('assignments')
    .select('effort_minutes, actual_minutes')
    .eq('status', 'done')
    .not('effort_minutes', 'is', null)
    .not('actual_minutes', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(60);

  return ((data ?? []) as { effort_minutes: number; actual_minutes: number }[]).map((r) => ({
    estimated: Number(r.effort_minutes),
    actual: Number(r.actual_minutes),
  }));
}

/**
 * Archives a course, or brings it back.
 *
 * Nothing is deleted. Last term's work is the record of what happened, and a
 * planner that quietly discards it stops being trustworthy for the one
 * question you eventually ask it — what did I actually do.
 *
 * Archiving only stops the course appearing in chips, filters and syllabus
 * matching, which is the actual complaint by week two of a new term.
 */
export async function setCourseArchived(id: string, archived: boolean): Promise<void> {
  await enqueue('courses', 'update', { archived }, { id });
}

/** Every course including archived ones, for the archive screen. */
export async function loadAllCourses(): Promise<Course[]> {
  const { data } = await supabase
    .from('courses')
    .select('id, name, code, colour_index, archived')
    .order('archived')
    .order('name');

  return (data ?? []) as Course[];
}

/* ------------------------------------------------------------- own key --- */

/**
 * Whether this account has its own Gemini key, without ever reading it back.
 *
 * The key is write-only from the app's point of view. There is no reason to
 * pull a secret into the browser to render a row that only needs to say
 * "set" or "not set", and a value that is never fetched cannot leak from a
 * screenshot, a bug report or a stray log.
 */
export async function hasOwnApiKey(): Promise<boolean> {
  const { data } = await supabase
    .from('app_settings')
    .select('gemini_api_key')
    .limit(1);

  return Boolean((data ?? [])[0]?.gemini_api_key);
}

/** Sets or clears it. Passing null goes back to the shared key. */
export async function setOwnApiKey(
  userId: string,
  key: string | null,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('app_settings')
    .update({ gemini_api_key: key && key.trim() ? key.trim() : null })
    .eq('user_id', userId);

  return { error: error ? error.message : null };
}

/* -------------------------------------------------------- calendar feed --- */

/**
 * The subscribable feed URL, creating a token on first use.
 *
 * `rotate` is the revoke button: the old link stops working immediately, which
 * matters because that URL is readable by anyone who has it.
 */
export async function calendarFeedUrl(userId: string, rotate = false): Promise<string | null> {
  const { data, error } = await supabase.rpc('ensure_ics_token', {
    p_user_id: userId,
    p_rotate: rotate,
  });

  if (error || !data) return null;
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/calendar?token=${data}`;
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
    /** Share of the final course grade. The syllabus importer supplies this. */
    weight_percent?: number | null;
  },
): Promise<void> {
  await enqueue('assignments', 'insert', {
    user_id: userId,
    title: fields.title.trim(),
    course_id: fields.course_id ?? null,
    due_at: fields.due_at ?? null,
    due_has_time: fields.due_has_time ?? false,
    effort_minutes: fields.effort_minutes ?? null,
    weight_percent: fields.weight_percent ?? null,
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

/**
 * Pushes a piece of work to a later day, and records that it moved.
 *
 * One tap, no friction, no comment — the spec is explicit that deferring must
 * cost nothing, because a deferral that feels like an admission is one that
 * gets avoided by simply not opening the app.
 *
 * The move is recorded as a row rather than incremented on the assignment.
 * Six pushes over six months is a task you keep meaning to get to; six in a
 * week is a task that is blocked, and only dated rows can tell those apart.
 */
export async function deferAssignment(
  userId: string,
  assignment: Assignment,
  toDay: DayKey,
): Promise<void> {
  const fromDay = assignment.due_at ? localDayKey(new Date(assignment.due_at)) : null;

  // The time of day is preserved. A task due at 09:00 that moves to tomorrow
  // is still due at 09:00, and silently resetting it to end-of-day would move
  // the deadline further than the tap asked for.
  const time = assignment.due_at && assignment.due_has_time
    ? localHourMinute(new Date(assignment.due_at))
    : null;

  await enqueue('assignments', 'update', {
    due_at: time
      ? wallClockToUTC(toDay, time.hour, time.minute).toISOString()
      : assignmentDueAt(toDay, null),
  }, { id: assignment.id });

  await enqueue('deferrals', 'insert', {
    user_id: userId,
    assignment_id: assignment.id,
    from_day: fromDay,
    to_day: toDay,
  });
}

/**
 * Records how long something actually took.
 *
 * Always optional. Asking for it as a required step would put friction on
 * marking work done, which is the one action that has to stay free, and a
 * number given under duress is not worth calibrating against.
 */
export async function setActualMinutes(id: string, minutes: number | null): Promise<void> {
  await enqueue('assignments', 'update', { actual_minutes: minutes }, { id });
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
  /** Off by default; a second recurring notification has to be asked for. */
  weekly_review_enabled: boolean;
  /** ISO weekday, 1 Monday to 7 Sunday. Shares the digest's send time. */
  weekly_review_weekday: number;
}

export async function loadDigestSettings(): Promise<DigestSettings | null> {
  const { data } = await supabase
    .from('app_settings')
    .select('digest_hour, digest_minute, digest_enabled, assignment_window_days, event_window_days, weekly_review_enabled, weekly_review_weekday')
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
      weekly_review_enabled: fields.weekly_review_enabled,
      weekly_review_weekday: Math.min(7, Math.max(1, fields.weekly_review_weekday)),
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

/**
 * Creates a course and hands the row back.
 *
 * Written straight through rather than queued, unlike `addCourse`. Onboarding
 * needs the id immediately: the syllabus step attaches a whole term's work to
 * it, and a queued insert returns nothing to attach to.
 *
 * The trade is that this one write does not survive being offline. That is the
 * right way round here — someone completing a first run has just signed in and
 * very likely just called a model, and if it does fail the course can be added
 * again from Courses with nothing lost but a moment.
 */
export async function createCourse(
  userId: string,
  name: string,
  colourIndex: number,
  code?: string,
): Promise<Course | null> {
  const { data } = await supabase
    .from('courses')
    .insert({
      user_id: userId,
      name: name.trim(),
      code: code?.trim() || null,
      colour_index: colourIndex,
    })
    .select('id, name, code, colour_index, archived')
    .single();

  return (data as Course) ?? null;
}

/** Marks the first run as done, however it ended. */
export async function finishOnboarding(userId: string): Promise<void> {
  await supabase
    .from('app_settings')
    .update({ onboarded_at: new Date().toISOString() })
    .eq('user_id', userId);
}

/**
 * Whether the first run still needs to happen.
 *
 * Null means it has not. Set on finish OR skip: someone who dismissed it made
 * a choice, and showing it again next launch would be the app overruling them.
 */
export async function needsOnboarding(): Promise<boolean> {
  const { data } = await supabase.from('app_settings').select('onboarded_at').limit(1);
  return (data ?? [])[0]?.onboarded_at == null;
}

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
  weight_percent: number | null;
  grade_percent: number | null;
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
      weight_percent: fields.weight_percent,
      grade_percent: fields.grade_percent,
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

/**
 * Every piece of work that carries a weight, for the course rollup.
 *
 * Deliberately fetches DONE work as well. The whole point of the rollup is
 * what has already been decided, and filtering to open work would report a
 * course as almost entirely unmarked the moment its assessments were ticked
 * off — which is precisely backwards.
 *
 * Archived courses are included too. Last term's record is the one thing a
 * planner must not quietly discard, and a grade summary that vanished at the
 * end of term would be discarding exactly the part worth keeping.
 */
export async function loadWeightedWork(): Promise<{ rows: Assignment[]; failed: boolean }> {
  const { data, error } = await supabase
    .from('assignments')
    .select(
      'id, course_id, title, due_at, due_has_time, effort_minutes, actual_minutes, status, notes, start_by_override, remind_at, weight_percent, grade_percent',
    )
    .not('weight_percent', 'is', null)
    .order('weight_percent', { ascending: false });

  return { rows: (data ?? []) as Assignment[], failed: Boolean(error) };
}

/* ============================================================================
   Recurring coursework.
   ========================================================================= */

export type { AssignmentSeries } from '../../supabase/functions/_shared/series';

/**
 * Creates a series and materialises its instances in one go.
 *
 * The instances are real assignment rows. Each carries its own status, weight
 * and grade from the moment it exists, so ticking off week three has no effect
 * on week four and marking one does not mark the rest.
 *
 * Not routed through the offline outbox, deliberately. The outbox exists so a
 * single capture survives a tunnel; this writes a parent row and up to two
 * hundred children that all reference its id, and replaying that correctly
 * from a queue means ordering guarantees the outbox does not offer. A series
 * is also never created in a hurry — it is a start-of-term action at a desk.
 * Failing loudly here is better than half a term of labs appearing later in
 * the wrong order.
 */
export async function createSeries(
  userId: string,
  fields: Omit<SeriesFields, 'id'>,
): Promise<{ created: number; error: string | null }> {
  const { data, error } = await supabase
    .from('assignment_series')
    .insert({
      user_id: userId,
      title: fields.title.trim(),
      course_id: fields.course_id,
      recurrence: fields.recurrence,
      weekdays: fields.recurrence === 'weekdays' ? fields.weekdays : null,
      interval_days: fields.recurrence === 'interval' ? fields.interval_days : null,
      anchor_day: fields.anchor_day,
      until_day: fields.until_day,
      due_time: fields.due_time,
      effort_minutes: fields.effort_minutes,
      weight_percent: fields.weight_percent,
    })
    .select('*')
    .single();

  if (error || !data) return { created: 0, error: error?.message ?? 'Could not save the pattern.' };

  return generateInstances(userId, data as unknown as AssignmentSeriesRow);
}

interface AssignmentSeriesRow {
  id: string;
  title: string;
  course_id: string | null;
  recurrence: 'weekdays' | 'interval';
  weekdays: number[] | null;
  interval_days: number | null;
  anchor_day: DayKey;
  until_day: DayKey;
  due_time: string | null;
  effort_minutes: number | null;
  weight_percent: number | null;
  active: boolean;
}

/**
 * Writes the rows a series is missing.
 *
 * Idempotent, because `missingDays` compares against what already exists —
 * including instances that are already DONE. Filtering to open work would
 * regenerate every lab the moment it was ticked off, which is the worst
 * failure this feature could have: an app that keeps handing back finished
 * work.
 */
export async function generateInstances(
  userId: string,
  row: AssignmentSeriesRow,
): Promise<{ created: number; error: string | null }> {
  const existing = await supabase
    .from('assignments')
    .select('due_at')
    .eq('series_id', row.id);

  if (existing.error) return { created: 0, error: existing.error.message };

  const have = ((existing.data ?? []) as { due_at: string | null }[])
    .map((r) => (r.due_at ? localDayKey(new Date(r.due_at)) : null))
    .filter((d): d is DayKey => d !== null);

  const days = missingDays(row, have);
  if (days.length === 0) return { created: 0, error: null };

  /*
   * Every row carries every key, including the nulls. PostgREST rejects a bulk
   * insert whose objects have differing key sets (PGRST102, "All object keys
   * must match") — the bug that once made a meal log 758 kcal instead of
   * 1,244, silently. It has since arrived twice more in places with no guard,
   * so this is written uniformly on purpose rather than by spreading optional
   * fields.
   */
  const rows = days.map((day) => ({
    user_id: userId,
    series_id: row.id,
    title: row.title,
    course_id: row.course_id,
    due_at: assignmentDueAt(day, row.due_time),
    due_has_time: Boolean(row.due_time),
    effort_minutes: row.effort_minutes,
    weight_percent: row.weight_percent,
    grade_percent: null,
    notes: null,
    start_by_override: null,
    remind_at: null,
  }));

  const { error } = await supabase.from('assignments').insert(rows);
  return { created: error ? 0 : rows.length, error: error?.message ?? null };
}

export interface SeriesFields {
  title: string;
  course_id: string | null;
  recurrence: 'weekdays' | 'interval';
  weekdays: number[];
  interval_days: number | null;
  anchor_day: DayKey;
  until_day: DayKey;
  due_time: string | null;
  effort_minutes: number | null;
  weight_percent: number | null;
}

/**
 * Deletes this account and everything in it.
 *
 * Irreversible, and there is no soft-delete hiding behind it — the twenty-one
 * foreign keys to auth.users cascade, so the row going means the data goes.
 * A planner that claims to delete and quietly retains is worse than one that
 * cannot delete at all, because the claim is the thing people rely on.
 *
 * The cache is cleared first for the same reason it is on sign-out: a device
 * still holding the last-seen day of a deleted account is exactly the copy
 * this action promised to remove.
 */
export async function deleteAccount(): Promise<{ error: string | null }> {
  await clearCache();

  const { error } = await supabase.rpc('delete_own_account');
  if (error) return { error: error.message };

  // The session now references a user that no longer exists. Ending it locally
  // stops the app from spending the next minute retrying queries as a ghost.
  await supabase.auth.signOut();
  return { error: null };
}
