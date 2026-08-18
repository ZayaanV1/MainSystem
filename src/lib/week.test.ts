import { describe, it, expect } from 'vitest';
import { effortMinutes, groupWeek } from './week';
import type { Assignment, PlannerEvent } from './planner';

const FROM = '2026-08-17'; // Monday

const utcNoon = (day: string) => `${day}T16:00:00.000Z`; // 12:00 EDT
const utcLate = (day: string) => `${day}T03:59:00.000Z`; // 23:59 EDT the day BEFORE

const task = (o: Partial<Assignment> & { title: string }): Assignment => ({
  id: o.title,
  course_id: null,
  due_at: null,
  due_has_time: false,
  effort_minutes: null,
  status: 'todo',
  notes: null,
  start_by_override: null,
  ...o,
});

const event = (title: string, starts_at: string): PlannerEvent => ({
  id: title,
  course_id: null,
  title,
  kind: 'exam',
  starts_at,
  ends_at: null,
  all_day: true,
  location: null,
});

describe('grouping a week', () => {
  it('returns exactly the requested days, in order', () => {
    const g = groupWeek([], [], FROM, 7);
    expect(g.days.map((d) => d.day)).toEqual([
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
      '2026-08-23',
    ]);
  });

  it('places work on its local day, not its UTC one', () => {
    // 03:59Z on the 19th is 23:59 EDT on the 18th. Reading this in UTC puts a
    // deadline on the wrong day, which is the whole reason this is tested.
    const g = groupWeek([task({ title: 'Essay', due_at: utcLate('2026-08-19') })], [], FROM, 7);

    expect(g.days.find((d) => d.day === '2026-08-18')!.assignments).toHaveLength(1);
    expect(g.days.find((d) => d.day === '2026-08-19')!.assignments).toHaveLength(0);
  });

  it('lifts overdue work out of the week rather than burying it', () => {
    const g = groupWeek([task({ title: 'Late', due_at: utcNoon('2026-08-10') })], [], FROM, 7);
    expect(g.overdue.map((a) => a.title)).toEqual(['Late']);
    expect(g.days.every((d) => d.assignments.length === 0)).toBe(true);
  });

  it('keeps undated work instead of dropping it', () => {
    // The easiest kind to lose, and a view that omits it teaches you the app
    // is not the whole picture.
    const g = groupWeek([task({ title: 'Sort out bike' })], [], FROM, 7);
    expect(g.undated.map((a) => a.title)).toEqual(['Sort out bike']);
  });

  it('counts work beyond the window rather than hiding it', () => {
    const g = groupWeek(
      [
        task({ title: 'Next month', due_at: utcNoon('2026-09-20') }),
        task({ title: 'Also later', due_at: utcNoon('2026-10-01') }),
      ],
      [],
      FROM,
      7,
    );
    expect(g.laterCount).toBe(2);
  });

  it('leaves finished work out entirely', () => {
    const g = groupWeek(
      [task({ title: 'Done already', due_at: utcNoon('2026-08-18'), status: 'done' })],
      [],
      FROM,
      7,
    );
    expect(g.days.every((d) => d.assignments.length === 0)).toBe(true);
    expect(g.overdue).toHaveLength(0);
    expect(g.undated).toHaveLength(0);
  });

  it('places events on their day too', () => {
    const g = groupWeek([], [event('Midterm', utcNoon('2026-08-20'))], FROM, 7);
    expect(g.days.find((d) => d.day === '2026-08-20')!.events.map((e) => e.title)).toEqual([
      'Midterm',
    ]);
  });

  it('ignores events outside the window', () => {
    const g = groupWeek([], [event('Final', utcNoon('2026-12-10'))], FROM, 7);
    expect(g.days.every((d) => d.events.length === 0)).toBe(true);
  });

  it('orders within a day by time', () => {
    const g = groupWeek(
      [
        task({ title: 'Evening', due_at: `2026-08-18T23:00:00.000Z` }),
        task({ title: 'Morning', due_at: `2026-08-18T13:00:00.000Z` }),
      ],
      [],
      FROM,
      7,
    );
    expect(g.days.find((d) => d.day === '2026-08-18')!.assignments.map((a) => a.title)).toEqual([
      'Morning',
      'Evening',
    ]);
  });
});

describe('across a DST boundary', () => {
  it('still produces seven consecutive local days', () => {
    const g = groupWeek([], [], '2026-10-29', 7);
    expect(g.days.map((d) => d.day)).toEqual([
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
    ]);
  });

  it('puts work due in the repeated hour on the right day', () => {
    // 01:30 EST on 1 Nov is 06:30Z, after the clocks go back.
    const g = groupWeek(
      [task({ title: 'Repeated hour', due_at: '2026-11-01T06:30:00.000Z' })],
      [],
      '2026-10-29',
      7,
    );
    expect(g.days.find((d) => d.day === '2026-11-01')!.assignments).toHaveLength(1);
  });
});

describe('effortMinutes', () => {
  it('sums estimates and ignores missing ones', () => {
    const g = groupWeek(
      [
        task({ title: 'A', due_at: utcNoon('2026-08-18'), effort_minutes: 120 }),
        task({ title: 'B', due_at: utcNoon('2026-08-18'), effort_minutes: 45 }),
        task({ title: 'C', due_at: utcNoon('2026-08-18') }),
      ],
      [],
      FROM,
      7,
    );
    expect(effortMinutes(g.days.find((d) => d.day === '2026-08-18')!)).toBe(165);
  });

  it('is zero for an empty day', () => {
    const g = groupWeek([], [], FROM, 7);
    expect(effortMinutes(g.days[0])).toBe(0);
  });
});
