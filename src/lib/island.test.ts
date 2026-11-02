import { describe, expect, it } from 'vitest';
import { islandDay } from './island';
import type { Assignment, PlannerEvent, TodayData } from './planner';

// Regina keeps UTC-6 all year, so no tzdata change can move these fixtures.
const TZ = 'America/Regina';
// 14:00 in Regina on 1 Nov 2026.
const NOW = new Date('2026-11-01T20:00:00Z');

function work(id: string, due: string | null, over: Partial<Assignment> = {}): Assignment {
  return {
    id, course_id: null, title: id, due_at: due, due_has_time: true, effort_minutes: null,
    actual_minutes: null, status: 'todo', notes: null, start_by_override: null, remind_at: null,
    weight_percent: null, grade_percent: null, link: null, ...over,
  };
}

function event(id: string, start: string, end: string | null, allDay = false): PlannerEvent {
  return { id, course_id: null, title: id, kind: 'other', starts_at: start, ends_at: end, all_day: allDay, location: null };
}

function day(over: Partial<TodayData>): TodayData {
  return {
    failed: [], cachedAt: null, loadedAt: 0, items: [], completions: [], inbox: [],
    courses: [], assignments: [], events: [], subtasks: [], deferrals: {}, completedToday: [],
    ...over,
  };
}

describe('islandDay', () => {
  it('shows nothing before the day has loaded', () => {
    expect(islandDay(null, NOW, TZ)).toEqual({ due: [], events: [] });
  });

  it('keeps work due today and late work, soonest first, and drops the rest', () => {
    const { due } = islandDay(
      day({
        assignments: [
          work('tonight', '2026-11-02T05:59:00Z'), // 23:59 tonight in Regina
          work('late', '2026-10-30T20:00:00Z'),
          work('tomorrow', '2026-11-02T20:00:00Z'),
          work('undated', null),
          work('finished', '2026-11-01T21:00:00Z', { status: 'done' }),
        ],
      }),
      NOW,
      TZ,
    );
    expect(due.map((a) => a.id)).toEqual(['late', 'tonight']);
  });

  it('reads today in the account zone, not UTC', () => {
    // 01:30 UTC on 2 Nov is still 19:30 on 1 Nov in Regina: today there, though not in UTC.
    const { due } = islandDay(day({ assignments: [work('evening', '2026-11-02T01:30:00Z')] }), NOW, TZ);
    expect(due.map((a) => a.id)).toEqual(['evening']);
  });

  it('lists the rest of today: all-day first, finished events gone', () => {
    const { events } = islandDay(
      day({
        events: [
          event('study', '2026-11-01T23:00:00Z', '2026-11-02T00:30:00Z'),
          event('lecture', '2026-11-01T17:00:00Z', '2026-11-01T18:20:00Z'),
          event('now', '2026-11-01T19:30:00Z', '2026-11-01T20:30:00Z'),
          event('holiday', '2026-11-01T06:00:00Z', null, true),
          event('tomorrow', '2026-11-02T18:00:00Z', null),
        ],
      }),
      NOW,
      TZ,
    );
    expect(events.map((e) => e.id)).toEqual(['holiday', 'now', 'study']);
  });
});
