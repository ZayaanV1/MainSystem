import { describe, it, expect } from 'vitest';
import { applyPending } from './optimistic';
import type { OutboxEntry, PendingWrite } from './outbox';
import type { Assignment, TodayData } from './planner';
import type { ChecklistItem } from './checklist';

/**
 * The optimistic layer: the last read of the server plus every write it does
 * not contain yet. Two of the bugs it replaced are pinned here by name — the
 * double tap that showed done when it was not, and Fill-in-a-day showing a
 * synced tick as unticked.
 */

const TODAY = '2026-10-03';
const LOADED_AT = 1_000_000;

let stamp = LOADED_AT;
function entry(table: string, op: OutboxEntry['op'], payload: Record<string, unknown>, match?: Record<string, unknown>): OutboxEntry {
  stamp += 1;
  return { id: `e${stamp}`, table, op, payload, match, createdAt: stamp, attempts: 0 };
}
const pending = (e: OutboxEntry): PendingWrite => ({ entry: e, appliedAt: null });
const landed = (e: OutboxEntry, at: number): PendingWrite => ({ entry: e, appliedAt: at });

function work(id: string, over: Partial<Assignment> = {}): Assignment {
  return {
    id, course_id: null, title: id, due_at: null, due_has_time: false, effort_minutes: null,
    actual_minutes: null, status: 'todo', notes: null, start_by_override: null, remind_at: null,
    weight_percent: null, grade_percent: null, link: null, ...over,
  };
}

function item(id: string, over: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id, title: id, recurrence: 'daily', weekdays: null, interval_days: null, anchor_day: null,
    active: true, sort_order: 1, essential: false, remind_at: null, tracks_doses: false,
    doses_remaining: null, doses_per_completion: 1, refill_warning_days: 3, ...over,
  };
}

function day(over: Partial<TodayData> = {}): TodayData {
  return {
    failed: [], cachedAt: null, loadedAt: LOADED_AT, items: [], completions: [], inbox: [],
    courses: [], assignments: [], events: [], subtasks: [], deferrals: {}, completedToday: [],
    lowBattery: false, ...over,
  };
}

describe('checklist ticks', () => {
  it('shows a queued tick at once', () => {
    const view = applyPending(day({ items: [item('meds')] }), [
      pending(entry('checklist_completions', 'insert', { item_id: 'meds', local_day: TODAY })),
    ], TODAY);
    expect(view.completions).toEqual([{ item_id: 'meds', local_day: TODAY }]);
  });

  it('reads a double tap as a tick and an untick, ending unticked', () => {
    const view = applyPending(day({ items: [item('meds')] }), [
      pending(entry('checklist_completions', 'insert', { item_id: 'meds', local_day: TODAY })),
      pending(entry('checklist_completions', 'delete', {}, { item_id: 'meds', local_day: TODAY })),
    ], TODAY);
    expect(view.completions).toEqual([]);
  });

  it('shows a synced back-fill as done, not inverted', () => {
    // The Fill-in-a-day bug: the write has landed and the re-read contains it.
    const tick = entry('checklist_completions', 'insert', { item_id: 'meds', local_day: '2026-10-02', backfilled: true });
    const view = applyPending(
      day({ loadedAt: LOADED_AT + 500, completions: [{ item_id: 'meds', local_day: '2026-10-02' }] }),
      [landed(tick, LOADED_AT + 100)],
      TODAY,
    );
    expect(view.completions).toEqual([{ item_id: 'meds', local_day: '2026-10-02' }]);
  });

  it('keeps a tick that landed after the read began, so it never flashes off', () => {
    const tick = entry('checklist_completions', 'insert', { item_id: 'meds', local_day: TODAY });
    const view = applyPending(day(), [landed(tick, LOADED_AT + 10)], TODAY);
    expect(view.completions).toHaveLength(1);
  });

  it('spends a dose for today, and not for a back-filled day', () => {
    const meds = item('meds', { tracks_doses: true, doses_remaining: 10, doses_per_completion: 2 });
    const todayTick = applyPending(day({ items: [meds] }), [
      pending(entry('checklist_completions', 'insert', { item_id: 'meds', local_day: TODAY, backfilled: false })),
    ], TODAY);
    expect(todayTick.items[0].doses_remaining).toBe(8);

    const backfill = applyPending(day({ items: [meds] }), [
      pending(entry('checklist_completions', 'insert', { item_id: 'meds', local_day: '2026-10-01', backfilled: true })),
    ], TODAY);
    expect(backfill.items[0].doses_remaining).toBe(10);
  });
});

describe('work', () => {
  it('moves work marked done out of the list at once', () => {
    const view = applyPending(day({ assignments: [work('lab'), work('essay')] }), [
      pending(entry('assignments', 'update', { status: 'done', completed_at: 'x' }, { id: 'lab' })),
    ], TODAY);
    expect(view.assignments.map((a) => a.id)).toEqual(['essay']);
    expect(view.completedToday.map((a) => a.id)).toEqual(['lab']);
  });

  it('brings reopened work back', () => {
    const view = applyPending(day({ completedToday: [work('lab', { status: 'done' })] }), [
      pending(entry('assignments', 'update', { status: 'todo', completed_at: null }, { id: 'lab' })),
    ], TODAY);
    expect(view.assignments.map((a) => a.id)).toEqual(['lab']);
    expect(view.completedToday).toEqual([]);
  });

  it('re-sorts a deferred piece of work by its new date', () => {
    const view = applyPending(
      day({ assignments: [work('a', { due_at: '2026-10-03T12:00:00Z' }), work('b', { due_at: '2026-10-03T20:00:00Z' })] }),
      [pending(entry('assignments', 'update', { due_at: '2026-10-04T12:00:00Z' }, { id: 'a' }))],
      TODAY,
    );
    expect(view.assignments.map((a) => a.id)).toEqual(['b', 'a']);
  });

  it('counts a queued deferral', () => {
    const view = applyPending(day({ deferrals: { a: 2 } }), [
      pending(entry('deferrals', 'insert', { assignment_id: 'a', to_day: TODAY })),
    ], TODAY);
    expect(view.deferrals.a).toBe(3);
  });

  it('adds new work once, however many times it is replayed', () => {
    const add = entry('assignments', 'insert', { id: 'new', title: 'New thing' });
    const view = applyPending(day({ assignments: [work('new')] }), [pending(add), pending(add)], TODAY);
    expect(view.assignments.filter((a) => a.id === 'new')).toHaveLength(1);
  });
});

describe('the inbox', () => {
  it('shows a capture the moment it is made, newest first, offline included', () => {
    const view = applyPending(
      day({ inbox: [{ id: 'old', body: 'older', source: 'app', created_at: '2026-10-01T00:00:00Z' }] }),
      [pending(entry('inbox_items', 'insert', { id: 'new', body: 'chem lab report??', source: 'app' }))],
      TODAY,
    );
    expect(view.inbox.map((i) => i.body)).toEqual(['chem lab report??', 'older']);
  });

  it('removes what has been sorted or dismissed', () => {
    const view = applyPending(
      day({ inbox: [{ id: 'x', body: 'x', source: 'app', created_at: '' }] }),
      [pending(entry('inbox_items', 'update', { triaged_at: 'now', converted_to: 'a' }, { id: 'x' }))],
      TODAY,
    );
    expect(view.inbox).toEqual([]);
  });
});

describe('steps', () => {
  it('adds, ticks and removes a step without waiting for the server', () => {
    const add = entry('subtasks', 'insert', { id: 's1', assignment_id: 'a', title: 'Open a doc', position: 0 });
    const tick = entry('subtasks', 'update', { done: true }, { id: 's1' });
    const view = applyPending(day(), [pending(add), pending(tick)], TODAY);
    expect(view.subtasks).toEqual([expect.objectContaining({ id: 's1', done: true, title: 'Open a doc' })]);

    const gone = applyPending(view, [pending(entry('subtasks', 'delete', {}, { id: 's1' }))], TODAY);
    expect(gone.subtasks).toEqual([]);
  });
});

describe('nothing to replay', () => {
  it('returns the same object, so screens do not re-render for nothing', () => {
    const data = day();
    const stale = entry('inbox_items', 'insert', { id: 'n', body: 'landed long ago' });
    expect(applyPending(data, [landed(stale, LOADED_AT - 5)], TODAY)).toBe(data);
  });
});
