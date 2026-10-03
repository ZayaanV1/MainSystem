import type { PendingWrite } from './outbox';
import type { Assignment, Completion, Course, InboxItem, PlannerEvent, Subtask, TodayData } from './planner';
import type { ChecklistItem } from './checklist';
import type { DayKey } from './time';

/**
 * What the screen shows: the last read of the server, plus every write that
 * has not made it into that read yet.
 *
 * WHY ONE LAYER
 *
 * Only checklist ticks used to be optimistic, each screen keeping its own set
 * of "taps in flight". Everything else — marking work done, pushing it to
 * tomorrow, capturing, triaging, adding a step — queued the write and then
 * waited for a reload after it reached the server. Online that was half a
 * second to two seconds of a row ignoring the tap; offline the row never
 * changed and a captured thought never appeared, though seeing it appear is
 * the only confirmation capture gives. And the per-screen sets were wrong in
 * two ways of their own: Today's only ever added, so a double tap showed done
 * when it was not, and Fill-in-a-day's was never cleared, so once the tick
 * synced it inverted the correct server state and showed it unticked.
 *
 * The outbox already knows exactly which writes the server does not have.
 * Replaying them over the loaded data is the whole of optimistic UI, for every
 * screen at once, with no state of its own to drift.
 *
 * WHICH WRITES
 *
 * Everything still queued, plus anything that reached the server AFTER this
 * data was read (`appliedAt >= loadedAt`) — the read cannot contain it, and
 * dropping it would flash the tick back off until the next reload. Writes that
 * landed before the read are already in it and are skipped.
 *
 * Every step is idempotent: an insert whose id is already present adds
 * nothing, a tick already ticked stays one tick. So the overlap between "applied
 * just after the read started" and "included in the read anyway" can never
 * double anything.
 */
export function applyPending(data: TodayData, writes: PendingWrite[], today: DayKey): TodayData {
  const relevant = writes.filter((w) => w.appliedAt === null || w.appliedAt >= data.loadedAt);
  if (relevant.length === 0) return data;

  let assignments = [...data.assignments];
  let completedToday = [...data.completedToday];
  let inbox = [...data.inbox];
  let completions = [...data.completions];
  let items = [...data.items];
  let subtasks = [...data.subtasks];
  let courses = [...data.courses];
  let events = [...data.events];
  const deferrals = { ...data.deferrals };

  for (const { entry, appliedAt } of relevant) {
    const p = entry.payload;
    const targetId = (entry.op === 'insert' ? p.id : entry.match?.id) as string | undefined;

    switch (entry.table) {
      case 'assignments': {
        if (entry.op === 'insert') {
          if (!targetId || assignments.some((a) => a.id === targetId) || completedToday.some((a) => a.id === targetId)) break;
          const row = assignmentFrom(p);
          if (row.status === 'done') completedToday = [...completedToday, row];
          else assignments = [...assignments, row];
        } else if (entry.op === 'delete') {
          assignments = assignments.filter((a) => a.id !== targetId);
          completedToday = completedToday.filter((a) => a.id !== targetId);
        } else {
          const patch = pick<Assignment>(p);
          const open = assignments.find((a) => a.id === targetId);
          const closed = completedToday.find((a) => a.id === targetId);
          const current = open ?? closed;
          if (!current) break;
          const next = { ...current, ...patch };
          assignments = assignments.filter((a) => a.id !== targetId);
          completedToday = completedToday.filter((a) => a.id !== targetId);
          if (next.status === 'done') completedToday = [...completedToday, next];
          else assignments = [...assignments, next];
        }
        break;
      }

      case 'inbox_items': {
        if (entry.op === 'insert') {
          if (!targetId || inbox.some((i) => i.id === targetId)) break;
          const row: InboxItem = {
            id: targetId,
            body: String(p.body ?? ''),
            source: String(p.source ?? 'app'),
            created_at: new Date(entry.createdAt).toISOString(),
          };
          // Newest first, which is the order the inbox is read in.
          inbox = [row, ...inbox];
        } else if (entry.op === 'update' && (p.triaged_at || p.dismissed_at)) {
          inbox = inbox.filter((i) => i.id !== targetId);
        } else if (entry.op === 'delete') {
          inbox = inbox.filter((i) => i.id !== targetId);
        }
        break;
      }

      case 'checklist_completions': {
        if (entry.op === 'insert') {
          const itemId = String(p.item_id);
          const day = String(p.local_day) as DayKey;
          if (completions.some((c) => c.item_id === itemId && c.local_day === day)) break;
          completions = [...completions, { item_id: itemId, local_day: day } as Completion];
          // Today spends a dose, any other day only records — the same rule
          // the database trigger applies, so the count does not lag the tick.
          if (day === today && !p.backfilled) items = adjustDoses(items, itemId, -1);
        } else if (entry.op === 'delete') {
          const itemId = String(entry.match?.item_id);
          const day = String(entry.match?.local_day) as DayKey;
          const had = completions.some((c) => c.item_id === itemId && c.local_day === day);
          completions = completions.filter((c) => !(c.item_id === itemId && c.local_day === day));
          if (had && day === today) items = adjustDoses(items, itemId, +1);
        }
        break;
      }

      case 'checklist_items': {
        if (entry.op === 'insert') {
          if (!targetId || items.some((i) => i.id === targetId)) break;
          items = [...items, { active: true, ...pick<ChecklistItem>(p) } as ChecklistItem]
            .sort((a, b) => a.sort_order - b.sort_order);
        } else if (entry.op === 'update') {
          if (p.active === false) items = items.filter((i) => i.id !== targetId);
          else items = items.map((i) => (i.id === targetId ? { ...i, ...pick<ChecklistItem>(p) } : i));
        }
        break;
      }

      case 'subtasks': {
        if (entry.op === 'insert') {
          if (!targetId || subtasks.some((s) => s.id === targetId)) break;
          subtasks = [...subtasks, { done: false, ...pick<Subtask>(p) } as Subtask];
        } else if (entry.op === 'update') {
          subtasks = subtasks.map((s) => (s.id === targetId ? { ...s, ...pick<Subtask>(p) } : s));
        } else if (entry.op === 'delete') {
          subtasks = subtasks.filter((s) => s.id !== targetId);
        }
        break;
      }

      case 'deferrals': {
        // Deferral rows carry no id in the loaded data, so only writes still
        // queued are counted. One that landed a moment ago is missing from the
        // count until the next read, which is a lag of one; counting it could
        // double it, which would be a wrong number.
        if (entry.op === 'insert' && appliedAt === null) {
          const id = String(p.assignment_id);
          deferrals[id] = (deferrals[id] ?? 0) + 1;
        }
        break;
      }

      case 'courses': {
        if (entry.op === 'insert') {
          if (!targetId || courses.some((c) => c.id === targetId)) break;
          courses = [...courses, { code: null, archived: false, ...pick<Course>(p) } as Course]
            .sort((a, b) => a.name.localeCompare(b.name));
        } else if (entry.op === 'update') {
          if (p.archived === true) courses = courses.filter((c) => c.id !== targetId);
          else courses = courses.map((c) => (c.id === targetId ? { ...c, ...pick<Course>(p) } : c));
        }
        break;
      }

      case 'events': {
        if (entry.op === 'insert') {
          if (!targetId || events.some((e) => e.id === targetId)) break;
          events = [...events, eventFrom(p)].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
        } else if (entry.op === 'delete') {
          events = events.filter((e) => e.id !== targetId);
        }
        break;
      }
    }
  }

  return {
    ...data,
    assignments: sortWork(assignments),
    completedToday,
    inbox,
    completions,
    items,
    subtasks: subtasks.sort((a, b) => a.position - b.position),
    courses,
    events,
    deferrals,
  };
}

/** Columns a write may carry that the screen does not hold. */
const SERVER_ONLY = new Set(['user_id', 'series_id', 'completed_at', 'converted_to', 'triaged_at', 'dismissed_at', 'backfilled']);

function pick<T>(payload: Record<string, unknown>): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) if (!SERVER_ONLY.has(k)) out[k] = v;
  return out as Partial<T>;
}

function assignmentFrom(p: Record<string, unknown>): Assignment {
  return {
    id: String(p.id),
    course_id: null,
    title: '',
    due_at: null,
    due_has_time: false,
    effort_minutes: null,
    actual_minutes: null,
    status: 'todo',
    notes: null,
    start_by_override: null,
    remind_at: null,
    weight_percent: null,
    grade_percent: null,
    link: null,
    ...pick<Assignment>(p),
  };
}

function eventFrom(p: Record<string, unknown>): PlannerEvent {
  return {
    id: String(p.id),
    course_id: null,
    title: '',
    kind: 'other',
    starts_at: new Date().toISOString(),
    ends_at: null,
    all_day: false,
    location: null,
    feed_id: null,
    source: null,
    ...pick<PlannerEvent>(p),
  };
}

function adjustDoses(items: ChecklistItem[], itemId: string, direction: 1 | -1): ChecklistItem[] {
  return items.map((i) => {
    if (i.id !== itemId || !i.tracks_doses || i.doses_remaining === null) return i;
    const step = Math.max(1, i.doses_per_completion);
    return { ...i, doses_remaining: Math.max(0, i.doses_remaining + direction * step) };
  });
}

/** Due date ascending with undated work last — the order Today's query returns. */
function sortWork(rows: Assignment[]): Assignment[] {
  return [...rows].sort((a, b) => {
    if (a.due_at === b.due_at) return 0;
    if (a.due_at === null) return 1;
    if (b.due_at === null) return -1;
    return a.due_at.localeCompare(b.due_at);
  });
}
