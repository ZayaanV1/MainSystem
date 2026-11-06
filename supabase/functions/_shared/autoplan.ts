import { addDays, formatTime, isoWeekday, localDayKey, wallClockToUTC, type DayKey } from './time.ts';

/**
 * Autoplan: work sessions placed in free time, and re-placed as the week
 * changes (6 Nov 2026, the Reclaim teardown in replica/reclaim.md).
 *
 * Replaces lib/suggestBlocks.ts, which proposed blocks once and then saved
 * them as ordinary events that knew nothing about the work: they did not move
 * when a deadline did, did not go when the work was finished, and did not
 * count as progress. A block here belongs to its work and to the app.
 *
 * The rules, each a guard against a way an auto-scheduler goes wrong (the
 * Motion reviews in replica/fixes.md: work placed on top of events, wrong
 * weekdays):
 *  - Every timed event is busy, with a buffer either side. All-day events are
 *    not: a holiday is not a booked hour. Nothing the person owns is moved.
 *  - Times are built from wall-clock study hours in the account's zone, so a
 *    DST day is the right length and no host zone can shift a weekday.
 *  - Work with the least room to spare goes first, not the soonest due: six
 *    hours due Friday comes before twenty minutes due Thursday.
 *  - A block always ends before the work is due. One block per piece of work
 *    per day, unless one a day cannot fit it in time.
 *  - Only work with an estimate is placed. Inventing an hour for unsized work
 *    would be confident and built on nothing; it is counted instead.
 *  - Pinned blocks, blocks starting within LOCK_MINUTES and blocks under way
 *    never move, so the plan does not shift under you as you sit down.
 */

export const BUFFER = 10;
export const MIN_BLOCK = 30;
export const MAX_BLOCK = 90;
export const LOCK_MINUTES = 120;
export const HORIZON_DAYS = 14;
const DEFAULT_HOURS: [number, number] = [9 * 60, 21 * 60];
const MIN = 60_000;

export interface PlanWork {
  id: string;
  title: string;
  due_at: string | null;
  effort_minutes: number | null;
  status: string;
  start_after?: DayKey | null;
  up_next?: boolean;
  weight_percent?: number | null;
}

export interface PlanBlockRow {
  id: string;
  assignment_id: string;
  starts_at: string;
  minutes: number;
  state: 'planned' | 'done' | 'skipped';
  pinned: boolean;
  done_minutes: number | null;
  reason?: string | null;
}

/** A busy interval, in epoch milliseconds. */
export interface Interval {
  start: number;
  end: number;
}

export interface PlanInput {
  now: Date;
  tz: string;
  work: PlanWork[];
  busy: Interval[];
  /** Every existing block for open work: done ones count as progress, kept ones as busy. */
  blocks: PlanBlockRow[];
  /** ISO weekday -> [from, to] in minutes from local midnight. Null is 9:00-21:00 daily. */
  studyHours: Record<string, [number, number]> | null;
  offDays: DayKey[];
  dayCap: number;
  /** How long work actually takes against its estimate (median, 1 when unknown). */
  factor: number;
  horizonDays?: number;
}

export interface Placed {
  assignment_id: string;
  starts_at: string;
  minutes: number;
  reason: string;
}

export interface AtRisk {
  assignment_id: string;
  title: string;
  /** Minutes still needed that there is no free time for before it is due. */
  short: number;
  due_at: string;
}

export interface PlanResult {
  placed: Placed[];
  atRisk: AtRisk[];
  /** Open work with a date ahead and no estimate: not placed, and said so. */
  unsized: number;
}

/** A block the engine must leave where it is. */
export function isKept(b: PlanBlockRow, now: Date): boolean {
  if (b.state !== 'planned') return false;
  const start = Date.parse(b.starts_at);
  return b.pinned || (start < now.getTime() + LOCK_MINUTES * MIN && start + b.minutes * MIN > now.getTime());
}

const ceil5 = (n: number) => Math.ceil(n / 5) * 5;
const roundUp = (ms: number, minutes: number) => Math.ceil(ms / (minutes * MIN)) * minutes * MIN;

/** Free intervals left after taking `cut` out of `free`. */
function subtract(free: Interval[], cut: Interval): Interval[] {
  const out: Interval[] = [];
  for (const f of free) {
    if (cut.end <= f.start || cut.start >= f.end) out.push(f);
    else {
      if (cut.start > f.start) out.push({ start: f.start, end: cut.start });
      if (cut.end < f.end) out.push({ start: cut.end, end: f.end });
    }
  }
  return out;
}

function hoursLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m}` : `${h} h`;
}

export function plan(input: PlanInput): PlanResult {
  const { now, tz } = input;
  const nowMs = now.getTime();
  const today = localDayKey(now, tz);
  const horizon = input.horizonDays ?? HORIZON_DAYS;
  const lastDay = addDays(today, horizon - 1);
  const off = new Set(input.offDays);
  const earliest = roundUp(nowMs + BUFFER * MIN, 5);

  // The study window of each day in the horizon, as instants.
  const days: { day: DayKey; free: Interval[]; used: number }[] = [];
  for (let d = today; d <= lastDay; d = addDays(d, 1)) {
    const hours = input.studyHours ? input.studyHours[String(isoWeekday(d))] : DEFAULT_HOURS;
    if (off.has(d) || !hours || hours[1] <= hours[0]) {
      days.push({ day: d, free: [], used: 0 });
      continue;
    }
    const from = wallClockToUTC(d, Math.floor(hours[0] / 60), hours[0] % 60, 0, tz).getTime();
    const to = wallClockToUTC(d, Math.floor(hours[1] / 60), hours[1] % 60, 0, tz).getTime();
    const start = Math.max(from, earliest);
    days.push({ day: d, free: start < to ? [{ start, end: to }] : [], used: 0 });
  }
  const dayOf = (ms: number) => days.find((d) => d.day === localDayKey(new Date(ms), tz));
  const take = (cut: Interval) => {
    for (const d of days) d.free = subtract(d.free, cut);
  };

  for (const b of input.busy) take({ start: b.start - BUFFER * MIN, end: b.end + BUFFER * MIN });

  // Progress and kept time, per piece of work.
  const progress = new Map<string, number>();
  const skipped = new Map<string, Interval[]>();
  for (const b of input.blocks) {
    const start = Date.parse(b.starts_at);
    const span = { start, end: start + b.minutes * MIN };
    if (b.state === 'done') {
      progress.set(b.assignment_id, (progress.get(b.assignment_id) ?? 0) + (b.done_minutes ?? b.minutes));
    } else if (b.state === 'skipped') {
      skipped.set(b.assignment_id, [...(skipped.get(b.assignment_id) ?? []), span]);
    } else if (isKept(b, now)) {
      progress.set(b.assignment_id, (progress.get(b.assignment_id) ?? 0) + b.minutes);
      take({ start: span.start - BUFFER * MIN, end: span.end + BUFFER * MIN });
      const d = dayOf(start);
      if (d) d.used += b.minutes;
    }
  }

  const horizonEnd = wallClockToUTC(addDays(lastDay, 1), 0, 0, 0, tz).getTime();
  const open = input.work.filter((w) => w.status !== 'done');
  let unsized = 0;

  interface Job {
    w: PlanWork;
    remaining: number;
    /** The block must end by this instant. */
    deadline: number;
    dated: boolean;
    notBefore: number;
    slack: number;
  }
  const freeBetween = (from: number, to: number) =>
    days.reduce((sum, d) => sum + d.free.reduce((s, f) => s + Math.max(0, Math.min(f.end, to) - Math.max(f.start, from)), 0), 0) / MIN;

  const jobs: Job[] = [];
  for (const w of open) {
    const due = w.due_at ? Date.parse(w.due_at) : null;
    // Late work still needs doing; it gets free time without a deadline it can miss again.
    const dated = due !== null && due > nowMs;
    if (!w.effort_minutes || w.effort_minutes <= 0) {
      if (dated && (due as number) <= horizonEnd) unsized += 1;
      continue;
    }
    const remaining = ceil5(w.effort_minutes * input.factor) - (progress.get(w.id) ?? 0);
    if (remaining <= 0) continue;
    const deadline = dated ? Math.min(due as number, horizonEnd) : horizonEnd;
    const notBefore = w.start_after ? Math.max(earliest, wallClockToUTC(w.start_after, 0, 0, 0, tz).getTime()) : earliest;
    jobs.push({ w, remaining, deadline, dated, notBefore, slack: freeBetween(notBefore, deadline) - remaining });
  }

  // Up next first; then dated work by least room to spare; then by weight and
  // due date; undated work after everything dated.
  jobs.sort(
    (a, b) =>
      Number(Boolean(b.w.up_next)) - Number(Boolean(a.w.up_next)) ||
      Number(b.dated) - Number(a.dated) ||
      a.slack - b.slack ||
      (b.w.weight_percent ?? 0) - (a.w.weight_percent ?? 0) ||
      a.deadline - b.deadline,
  );

  const placed: Placed[] = [];
  const atRisk: AtRisk[] = [];

  for (const job of jobs) {
    const { w } = job;
    const avoid = skipped.get(w.id) ?? [];
    const why = w.up_next
      ? 'you put it next'
      : !job.dated
        ? 'no due date, so it takes time after dated work'
        : job.slack < 120
          ? 'it has the least room to spare'
          : 'the soonest free time before it is due';
    const dueWords = job.dated ? `Due ${localDayKey(new Date(job.deadline), tz)} ${formatTime(new Date(job.deadline), tz)}` : 'No due date';

    // Pass one: one block a day. Pass two, only if that was not enough: more
    // blocks on days that still have room, because missing a deadline is
    // worse than a second sitting.
    for (let pass = 0; pass < 2 && job.remaining > 0; pass++) {
      for (const d of days) {
        if (job.remaining <= 0) break;
        if (pass === 0 && placed.some((p) => p.assignment_id === w.id && localDayKey(new Date(p.starts_at), tz) === d.day)) continue;
        const room = input.dayCap - d.used;
        const smallest = Math.min(MIN_BLOCK, job.remaining);
        if (room < smallest) continue;
        const gaps = d.free
          .map((f) => ({ start: roundUp(Math.max(f.start, job.notBefore), 5), end: Math.min(f.end, job.deadline) }))
          .filter((g) => g.end - g.start >= smallest * MIN && !avoid.some((s) => s.start < g.end && s.end > g.start));
        if (!gaps.length) continue;
        const want = Math.min(MAX_BLOCK, job.remaining, room);
        const gap = gaps.find((g) => g.end - g.start >= want * MIN) ?? gaps.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
        let minutes = Math.min(want, Math.floor((gap.end - gap.start) / MIN / 5) * 5);
        // No stub: a leftover under half an hour is folded into this block when it fits.
        const rest = job.remaining - minutes;
        if (rest > 0 && rest < MIN_BLOCK && (gap.end - gap.start) / MIN >= job.remaining && job.remaining <= room) minutes = job.remaining;
        if (minutes < smallest) continue;
        const start = gap.start;
        placed.push({
          assignment_id: w.id,
          starts_at: new Date(start).toISOString(),
          minutes,
          reason: `${dueWords} · ${hoursLabel(job.remaining)} left · here because ${why}`,
        });
        take({ start: start - BUFFER * MIN, end: start + (minutes + BUFFER) * MIN });
        d.used += minutes;
        job.remaining -= minutes;
      }
    }
    if (job.remaining > 0 && job.dated && w.due_at && Date.parse(w.due_at) <= horizonEnd) {
      atRisk.push({ assignment_id: w.id, title: w.title, short: job.remaining, due_at: w.due_at });
    }
  }

  placed.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return { placed, atRisk, unsized };
}

/** Median of actual over estimate, from five finished pieces of work; 1 below that. Same rule as lib/intelligence.ts calibration. */
export function factorFrom(pairs: { effort_minutes: number | null; actual_minutes: number | null }[]): number {
  const r = pairs
    .filter((p) => (p.effort_minutes ?? 0) > 0 && (p.actual_minutes ?? 0) > 0)
    .map((p) => (p.actual_minutes as number) / (p.effort_minutes as number))
    .sort((a, b) => a - b);
  if (r.length < 5) return 1;
  const mid = Math.floor(r.length / 2);
  const median = r.length % 2 ? r[mid] : (r[mid - 1] + r[mid]) / 2;
  // Bounded, so one odd term cannot double every block on the calendar.
  return Math.min(2.5, Math.max(0.5, Math.round(median * 10) / 10));
}

/* ============================================================================
   Replanning against the database
   ========================================================================= */

// deno-lint-ignore no-explicit-any
type Db = any;

export interface ReplanResult {
  /** Planned and done blocks from now on, sorted, after the replan. */
  blocks: PlanBlockRow[];
  atRisk: AtRisk[];
  unsized: number;
  /** Blocks that moved or went. Kept rows are never counted. */
  moved: number;
  added: number;
  /** What was removed and what was written, so the replan can be undone. */
  undo: { removed: PlanBlockRow[]; addedIds: string[] } | null;
  disabled: boolean;
}

async function must<T>(q: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

const BLOCK_COLUMNS = 'id, assignment_id, starts_at, minutes, state, pinned, done_minutes, reason';

/**
 * Read everything the engine needs, plan, and write the difference.
 *
 * Takes any Supabase client: the app's (bound by RLS), or a function's service
 * client, in which case every query is scoped by user_id here as well. Old
 * blocks that land exactly where the new plan wants them are kept as they are,
 * so a replan that changes nothing writes nothing.
 *
 * shortcut: two devices replanning in the same instant can both insert; the
 * next replan removes the duplicate as unmatched. A lease would be the upgrade
 * if that is ever seen.
 */
export async function replan(db: Db, userId: string, tz: string, now: Date = new Date()): Promise<ReplanResult> {
  const settings = await must<Record<string, unknown> | null>(
    db.from('app_settings').select('study_hours, plan_off_days, plan_day_cap, autoplan').eq('user_id', userId).maybeSingle(),
  );
  const since = new Date(now.getTime() - 60 * 24 * 60 * MIN).toISOString();
  const horizonEnd = wallClockToUTC(addDays(localDayKey(now, tz), HORIZON_DAYS), 0, 0, 0, tz).toISOString();

  const [work, pairs, events, blocks] = await Promise.all([
    must<PlanWork[]>(
      db
        .from('assignments')
        .select('id, title, due_at, effort_minutes, status, start_after, up_next, weight_percent')
        .eq('user_id', userId)
        .neq('status', 'done')
        .limit(300),
    ),
    must<{ effort_minutes: number | null; actual_minutes: number | null }[]>(
      db
        .from('assignments')
        .select('effort_minutes, actual_minutes')
        .eq('user_id', userId)
        .eq('status', 'done')
        .not('actual_minutes', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(60),
    ),
    must<{ starts_at: string; ends_at: string | null; all_day: boolean }[]>(
      db
        .from('events')
        .select('starts_at, ends_at, all_day')
        .eq('user_id', userId)
        .eq('all_day', false)
        .lt('starts_at', horizonEnd)
        .gte('starts_at', new Date(now.getTime() - 24 * 60 * MIN).toISOString())
        .limit(1000),
    ),
    must<PlanBlockRow[]>(db.from('planned_blocks').select(BLOCK_COLUMNS).eq('user_id', userId).gte('starts_at', since).order('starts_at')),
  ]);

  const openIds = new Set(work.map((w) => w.id));
  const nowMs = now.getTime();
  const future = (b: PlanBlockRow) => Date.parse(b.starts_at) + b.minutes * MIN > nowMs;

  // Blocks whose work is finished or gone, and planned blocks whose time has
  // passed without being marked done, are removed. A passed block is not a
  // miss: it is simply not progress, and its minutes are planned again.
  const stale = blocks.filter((b) => b.state === 'planned' && (!openIds.has(b.assignment_id) ? future(b) : !future(b)));
  const live = blocks.filter((b) => openIds.has(b.assignment_id) && !stale.includes(b));

  if (settings?.autoplan === false) {
    return {
      blocks: live.filter((b) => future(b) && b.state !== 'skipped'),
      atRisk: [],
      unsized: 0,
      moved: 0,
      added: 0,
      undo: null,
      disabled: true,
    };
  }

  const movable = live.filter((b) => b.state === 'planned' && future(b) && !isKept(b, now));
  const fixed = live.filter((b) => !movable.includes(b));

  const result = plan({
    now,
    tz,
    work,
    busy: events.map((e) => {
      const start = Date.parse(e.starts_at);
      return { start, end: e.ends_at ? Date.parse(e.ends_at) : start + 60 * MIN };
    }),
    blocks: fixed,
    studyHours: (settings?.study_hours as Record<string, [number, number]> | null) ?? null,
    offDays: ((settings?.plan_off_days as string[] | null) ?? []) as DayKey[],
    dayCap: Number(settings?.plan_day_cap ?? 240),
    factor: factorFrom(pairs),
  });

  const sameSlot = (b: PlanBlockRow, p: Placed) =>
    b.assignment_id === p.assignment_id && Date.parse(b.starts_at) === Date.parse(p.starts_at) && b.minutes === p.minutes;
  const keptOld = movable.filter((b) => result.placed.some((p) => sameSlot(b, p)));
  const removed = [...stale, ...movable.filter((b) => !keptOld.includes(b))];
  const toAdd = result.placed.filter((p) => !keptOld.some((b) => sameSlot(b, p)));

  if (removed.length) {
    await must(db.from('planned_blocks').delete().eq('user_id', userId).in('id', removed.map((b) => b.id)));
  }
  let addedRows: PlanBlockRow[] = [];
  if (toAdd.length) {
    // Every key on every row (PGRST102).
    addedRows = await must<PlanBlockRow[]>(
      db
        .from('planned_blocks')
        .insert(
          toAdd.map((p) => ({
            user_id: userId,
            assignment_id: p.assignment_id,
            starts_at: p.starts_at,
            minutes: p.minutes,
            reason: p.reason,
            state: 'planned',
            pinned: false,
          })),
        )
        .select(BLOCK_COLUMNS),
    );
  }
  // Reasons are refreshed on kept blocks only in memory: the slot is the fact.
  const all = [...fixed, ...keptOld, ...addedRows]
    .filter((b) => future(b) && b.state !== 'skipped')
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  const movedOld = movable.filter((b) => !keptOld.includes(b)).length;
  return {
    blocks: all,
    atRisk: result.atRisk,
    unsized: result.unsized,
    moved: movedOld,
    added: addedRows.length,
    undo: removed.length || addedRows.length ? { removed, addedIds: addedRows.map((b) => b.id) } : null,
    disabled: false,
  };
}

/**
 * Take a replan back: its new blocks go, and the blocks it moved return where
 * they were, pinned, because otherwise the next replan would move them again.
 */
export async function undoReplan(db: Db, userId: string, undo: NonNullable<ReplanResult['undo']>): Promise<void> {
  if (undo.addedIds.length) await must(db.from('planned_blocks').delete().eq('user_id', userId).in('id', undo.addedIds));
  const back = undo.removed.filter((b) => b.state === 'planned' && Date.parse(b.starts_at) > Date.now());
  if (back.length) {
    await must(
      db.from('planned_blocks').insert(
        back.map((b) => ({
          user_id: userId,
          assignment_id: b.assignment_id,
          starts_at: b.starts_at,
          minutes: b.minutes,
          reason: b.reason ?? null,
          state: 'planned',
          pinned: true,
        })),
      ),
    );
  }
}
