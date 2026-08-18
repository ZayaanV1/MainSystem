import { describe, it, expect } from 'vitest';
import { buildMonth, load, monthLabel, shiftMonth, startOfMonth } from './month';
import type { Assignment, PlannerEvent } from './planner';

const TODAY = '2026-08-18';
const noon = (day: string) => `${day}T16:00:00.000Z`; // 12:00 EDT

const task = (o: Partial<Assignment> & { id: string }): Assignment => ({
  course_id: null,
  title: o.id,
  due_at: null,
  due_has_time: false,
  effort_minutes: null,
  status: 'todo',
  notes: null,
  start_by_override: null,
  remind_at: null,
  ...o,
});

const ev = (id: string, starts_at: string): PlannerEvent => ({
  id,
  course_id: null,
  title: id,
  kind: 'exam',
  starts_at,
  ends_at: null,
  all_day: true,
  location: null,
});

describe('month arithmetic', () => {
  it('finds the first of the month', () => {
    expect(startOfMonth('2026-08-18')).toBe('2026-08-01');
  });

  it('shifts months without overflowing', () => {
    expect(shiftMonth('2026-08-18', 1)).toBe('2026-09-01');
    expect(shiftMonth('2026-01-31', -1)).toBe('2025-12-01');
    expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01');
    expect(shiftMonth('2026-01-01', -13)).toBe('2024-12-01');
  });

  it('labels the month readably', () => {
    expect(monthLabel('2026-08-18')).toContain('August');
    expect(monthLabel('2026-08-18')).toContain('2026');
  });
});

describe('the grid', () => {
  const grid = () => buildMonth('2026-08-18', [], [], TODAY);

  it('is whole weeks, Monday first', () => {
    const g = grid();
    for (const week of g.weeks) expect(week).toHaveLength(7);
    // 1 Aug 2026 is a Saturday, so the grid starts on Monday 27 July.
    expect(g.weeks[0][0].day).toBe('2026-07-27');
  });

  it('covers every day of the month exactly once', () => {
    const g = grid();
    const inMonth = g.weeks.flat().filter((c) => c.inMonth).map((c) => c.day);
    expect(inMonth).toHaveLength(31);
    expect(new Set(inMonth).size).toBe(31);
    expect(inMonth[0]).toBe('2026-08-01');
    expect(inMonth[30]).toBe('2026-08-31');
  });

  it('marks padding days as outside the month', () => {
    const g = grid();
    expect(g.weeks[0][0].inMonth).toBe(false);
    expect(g.weeks[0][5].day).toBe('2026-08-01');
    expect(g.weeks[0][5].inMonth).toBe(true);
  });

  it('uses no more rows than the month needs', () => {
    // February 2027 starts on a Monday and has 28 days: exactly four rows.
    expect(buildMonth('2027-02-10', [], [], TODAY).weeks).toHaveLength(4);
  });

  it('handles a leap February', () => {
    const g = buildMonth('2028-02-10', [], [], TODAY);
    expect(g.weeks.flat().filter((c) => c.inMonth)).toHaveLength(29);
  });

  it('marks today and distinguishes past from future', () => {
    const g = grid();
    const cells = g.weeks.flat();
    expect(cells.filter((c) => c.isToday).map((c) => c.day)).toEqual([TODAY]);
    expect(cells.find((c) => c.day === '2026-08-17')!.isPast).toBe(true);
    expect(cells.find((c) => c.day === TODAY)!.isPast).toBe(false);
    expect(cells.find((c) => c.day === '2026-08-19')!.isPast).toBe(false);
  });
});

describe('what lands in a cell', () => {
  it('places work on its local day', () => {
    // 03:59Z on the 20th is 23:59 EDT on the 19th.
    const g = buildMonth('2026-08-18', [task({ id: 'a', due_at: '2026-08-20T03:59:00.000Z' })], [], TODAY);
    const cells = g.weeks.flat();
    expect(cells.find((c) => c.day === '2026-08-19')!.assignments).toHaveLength(1);
    expect(cells.find((c) => c.day === '2026-08-20')!.assignments).toHaveLength(0);
  });

  it('places events too', () => {
    const g = buildMonth('2026-08-18', [], [ev('Midterm', noon('2026-08-25'))], TODAY);
    expect(g.weeks.flat().find((c) => c.day === '2026-08-25')!.events).toHaveLength(1);
  });

  it('keeps undated work out of the grid but not out of the result', () => {
    const g = buildMonth('2026-08-18', [task({ id: 'floating' })], [], TODAY);
    expect(g.undated.map((a) => a.id)).toEqual(['floating']);
    expect(g.weeks.flat().every((c) => c.assignments.length === 0)).toBe(true);
  });

  it('leaves finished work out entirely', () => {
    const g = buildMonth(
      '2026-08-18',
      [task({ id: 'done', due_at: noon('2026-08-20'), status: 'done' })],
      [],
      TODAY,
    );
    expect(g.weeks.flat().every((c) => c.assignments.length === 0)).toBe(true);
    expect(g.undated).toHaveLength(0);
  });

  it('shows work in the padding days, since those days are real', () => {
    const g = buildMonth('2026-08-18', [task({ id: 'july', due_at: noon('2026-07-30') })], [], TODAY);
    const cell = g.weeks.flat().find((c) => c.day === '2026-07-30')!;
    expect(cell.inMonth).toBe(false);
    expect(cell.assignments).toHaveLength(1);
  });
});

describe('load is a step, not a score', () => {
  const cellWith = (n: number) =>
    buildMonth(
      '2026-08-18',
      Array.from({ length: n }, (_, i) => task({ id: `t${i}`, due_at: noon('2026-08-20') })),
      [],
      TODAY,
    ).weeks.flat().find((c) => c.day === '2026-08-20')!;

  it('is zero for an empty day', () => {
    expect(load(cellWith(0))).toBe(0);
  });

  it('rises one per item and caps at three', () => {
    expect(load(cellWith(1))).toBe(1);
    expect(load(cellWith(2))).toBe(2);
    expect(load(cellWith(3))).toBe(3);
    expect(load(cellWith(12))).toBe(3);
  });

  it('makes a three-deadline day maximally loud', () => {
    // A real September put three deadlines on the 30th, and the earlier
    // bucketing drew it identically to a two-deadline day. The crunch day is
    // the entire reason to look at a month.
    expect(load(cellWith(3))).toBeGreaterThan(load(cellWith(2)));
  });
});

describe('rule 3 — the grid shows what is due, never what was done', () => {
  it('exposes no completion state on any cell', () => {
    // A month of past days marked complete-or-not is a completion history in a
    // calendar's clothing. Thirty small failures in a grid is the most
    // efficient way to make an app unopenable.
    const g = buildMonth('2026-08-18', [task({ id: 'a', due_at: noon('2026-08-05') })], [], TODAY);
    const cell = g.weeks.flat().find((c) => c.day === '2026-08-05')!;

    const keys = Object.keys(cell).join(' ');
    expect(keys).not.toMatch(/done|complete|missed|streak|score/i);
  });

  it('treats a quiet past day and a quiet future day identically', () => {
    const g = buildMonth('2026-08-18', [], [], TODAY);
    const past = g.weeks.flat().find((c) => c.day === '2026-08-10')!;
    const future = g.weeks.flat().find((c) => c.day === '2026-08-26')!;
    expect(load(past)).toBe(load(future));
  });
});
