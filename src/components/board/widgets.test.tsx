import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SIZES, WIDGET_TYPES, type Widget } from '../../lib/board';
import type { Assignment, Course, PlannerEvent } from '../../lib/planner';
import type { DayKey } from '../../lib/time';
import { WidgetBody, weekRows, type WidgetContext } from './widgets';

/**
 * Every widget at every size it offers, drawn from one ordinary week, and
 * the things it shows checked for a way to open them. Widgets that drew a
 * date, a class or a mark with nothing to press are what this guards.
 */

const course: Course = { id: 'c1', name: 'Calculus', code: 'MATH101', colour_index: 1, archived: false };
const work = (id: string, title: string, due: string): Assignment =>
  ({
    id, course_id: 'c1', title, due_at: due, due_has_time: true, effort_minutes: 30, actual_minutes: null,
    status: 'todo', notes: null, start_by_override: null, remind_at: null, weight_percent: 20, grade_percent: null,
  }) as Assignment;
const event = (id: string, title: string, kind: PlannerEvent['kind'], start: string, end: string): PlannerEvent =>
  ({ id, course_id: 'c1', title, kind, starts_at: start, ends_at: end, all_day: false, location: 'Room 4' }) as PlannerEvent;

const today = '2026-11-10' as DayKey;
const ctx: WidgetContext = {
  userId: 'u1',
  today,
  now: new Date('2026-11-10T15:00:00Z'), // 10:00 in Toronto
  assignments: [
    work('a1', 'Essay draft', '2026-11-10T22:00:00Z'),
    work('a2', 'Problem set', '2026-11-13T04:59:00Z'),
  ],
  events: [
    event('e1', 'Lecture', 'class', '2026-11-10T17:00:00Z', '2026-11-10T18:00:00Z'),
    event('e2', 'Midterm', 'exam', '2026-11-14T15:00:00Z', '2026-11-14T17:00:00Z'),
  ],
  courses: [course],
  inbox: [],
  deferrals: {},
  checklist: [],
  isDone: () => false,
  onToggleItem: () => {},
  onFinish: () => {},
  onOpen: () => {},
  onOpenDay: () => {},
  onOpenCourse: () => {},
  onOpenSchedule: () => {},
  sized: (m) => m,
  capture: async () => {},
  goals: [],
  goalsFailed: false,
  onGoalStep: () => {},
  grades: { rows: [{ course_id: 'c1', weight_percent: 20, grade_percent: 80 }], failed: false },
  term: { first: '2026-09-02' as DayKey, last: '2026-12-05' as DayKey },
  assistOn: true,
  gradesOn: true,
  still: false,
};

const draw = (type: Widget['type'], size: Widget['size']) =>
  renderToStaticMarkup(<WidgetBody w={{ id: 'w', type, size, opts: {} }} ctx={ctx} />);

describe('board widgets', () => {
  it('draws every widget at every size it offers', () => {
    for (const type of WIDGET_TYPES) for (const size of SIZES[type]) expect(() => draw(type, size), `${type} ${size}`).not.toThrow();
  });

  it.each([
    ['due', 'peg', 'Open Essay draft'],
    ['due', 'strip', 'Open Essay draft'],
    ['class', 'strip', 'Open Tue, Nov 10'],
    ['class', 's', 'Open Tue, Nov 10'],
    ['class', 'm', 'Open Tue, Nov 10'],
    ['week', 'm', 'Open Problem set'],
    ['week', 'tall', 'Open Sat, Nov 14'],
    ['exams', 's', 'Open Sat, Nov 14'],
    ['exams', 'm', 'Open Sat, Nov 14'],
    ['clockday', 'm', 'Open Essay draft'],
    ['grades', 's', 'Open MATH101'],
    ['grades', 'm', 'Open MATH101'],
  ] as const)('%s at %s can be opened', (type, size, label) => {
    expect(draw(type, size)).toContain(`aria-label="${label}"`);
  });

  it('gives the day planner a tap on each class block', () => {
    expect(draw('agenda', 'tall')).toMatch(/class="bw-tl-b"[^>]*><button type="button" class="bw-hit"/u);
  });

  it('makes each day of the week strip a button that picks the day, not one that leaves', () => {
    const html = draw('week', 'm');
    expect(html.match(/<button type="button"[^>]*aria-pressed="false"/gu)?.length).toBe(7);
    expect(html).toContain('aria-label="Tue, Nov 10, 1 due"');
    expect(html).toContain('aria-label="Wed, Nov 11, nothing due"');
  });

  it('lists the week, or only the picked day', () => {
    const days = ['2026-11-10', '2026-11-11', '2026-11-12'] as DayKey[];
    const byDay = new Map<DayKey, string[]>([[days[0], ['essay']], [days[2], ['set', 'quiz']]]);
    expect(weekRows(days, byDay, null).map((r) => r.t)).toEqual(['essay', 'set', 'quiz']);
    expect(weekRows(days, byDay, days[2]).map((r) => r.t)).toEqual(['set', 'quiz']);
    expect(weekRows(days, byDay, days[1])).toEqual([]);
    // A pick left over from yesterday shows the week, not an empty list.
    expect(weekRows(days, byDay, '2026-11-09' as DayKey).length).toBe(3);
  });

  it('never calls a calendar deadline an exam, or an all-day exam a midnight one', () => {
    const due = { ...event('e3', 'WeBWorK 9 is due', 'other', '2026-11-12T04:59:00Z', '2026-11-12T05:00:00Z'), feed_id: 'f1' };
    const allDay = { ...event('e4', 'Final', 'exam', '2026-11-13T05:00:00Z', '2026-11-14T05:00:00Z'), all_day: true };
    const html = renderToStaticMarkup(
      <WidgetBody w={{ id: 'w', type: 'week', size: 'l', opts: {} }} ctx={{ ...ctx, events: [...ctx.events!, due, allDay] }} />,
    );
    expect(html).toContain('<span>WeBWorK 9 is due</span>');
    expect(html).not.toContain('Exam: WeBWorK');
    expect(html).toContain('All day');
    expect(html).not.toMatch(/Exam: Final<\/span><\/span><span class="bw-unit">12:00/u);
  });
});
