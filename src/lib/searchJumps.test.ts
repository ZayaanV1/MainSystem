import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { courseHits, jumps, splitMatch } from './searchJumps';
import { readRecent, rememberOpened } from './recent';
import { setActiveTimezone } from './time';
import type { Assignment, Course, PlannerEvent } from './planner';

const tz = 'America/Toronto';
beforeAll(() => setActiveTimezone(tz));

const now = new Date('2026-10-04T10:00:00-04:00');
const course: Course = { id: 'c1', code: 'PHYS 205', name: 'Waves', colour_index: 5 } as Course;
const work = (id: string, due: string | null, extra: Partial<Assignment> = {}) =>
  ({ id, title: id, course_id: 'c1', due_at: due, status: 'todo', ...extra }) as Assignment;
const event = (id: string, starts: string, kind: PlannerEvent['kind']) =>
  ({ id, title: id, course_id: 'c1', kind, starts_at: starts, ends_at: null, all_day: false, location: null }) as PlannerEvent;

const data = {
  courses: [course],
  assignments: [
    work('late', '2026-10-03T23:59:00-04:00'),
    work('tonight', '2026-10-04T23:59:00-04:00'),
    work('saturday', '2026-10-10T23:59:00-04:00'),
    work('later', '2026-10-20T23:59:00-04:00'),
    work('undated', null),
    work('finished', '2026-10-05T23:59:00-04:00', { status: 'done' }),
  ],
  events: [event('Midterm', '2026-10-06T18:00:00-04:00', 'exam'), event('Lecture', '2026-10-05T10:00:00-04:00', 'other')],
};

describe('jumps', () => {
  it('answers late, this week, exams and no date from the loaded day', () => {
    const j = Object.fromEntries(jumps(data, now, tz).map((x) => [x.id, x.hits.map((h) => h.id)]));
    expect(j.late).toEqual(['late']);
    expect(j.week).toEqual(['tonight', 'saturday']);
    expect(j.exams).toEqual(['Midterm']);
    expect(j.none).toEqual(['undated']);
  });

  it('leaves out a jump with nothing in it', () => {
    const quiet = { ...data, events: [] };
    expect(jumps(quiet, now, tz).map((x) => x.id)).not.toContain('exams');
  });
});

describe('courseHits', () => {
  it('lists the course’s open work, then what is coming on its calendar', () => {
    expect(courseHits(data, 'c1', now, tz).map((h) => h.id)).toEqual([
      'late', 'tonight', 'saturday', 'later', 'undated', 'Lecture', 'Midterm',
    ]);
  });
});

describe('splitMatch', () => {
  it('marks every case-insensitive occurrence and joins back to the original', () => {
    const parts = splitMatch('Lab 2 report, lab 3', 'lab');
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(['Lab', 'lab']);
    expect(parts.map((p) => p.text).join('')).toBe('Lab 2 report, lab 3');
  });

  it('leaves text alone when nothing matches', () => {
    expect(splitMatch('Quiz', 'lab')).toEqual([{ text: 'Quiz', match: false }]);
  });
});

describe('recent', () => {
  beforeEach(() => localStorage.clear());

  it('keeps each piece of work once, most recent first, at most six', () => {
    for (let i = 0; i < 8; i++) rememberOpened({ id: `a${i}`, title: `A${i}` });
    rememberOpened({ id: 'a3', title: 'A3' });
    const list = readRecent();
    expect(list).toHaveLength(6);
    expect(list[0].id).toBe('a3');
    expect(new Set(list.map((o) => o.id)).size).toBe(6);
  });
});
