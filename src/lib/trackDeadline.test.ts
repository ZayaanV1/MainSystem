import { describe, expect, it } from 'vitest';
import { alreadyTracked, looksLikeDeadline, untrackedDeadlines } from './planner';
import { dayParts, dueCount, isBuffer } from './week';

describe('tracking a calendar deadline as work', () => {
  it('offers it only on subscribed deadlines, never on a lecture or an own event', () => {
    expect(looksLikeDeadline({ title: 'Lab 3 report is due', feed_id: 'f' })).toBe(true);
    expect(looksLikeDeadline({ title: 'WeBWorK 8 closes', feed_id: 'f' })).toBe(true);
    expect(looksLikeDeadline({ title: 'COEN 231 Lecture', feed_id: 'f' })).toBe(false);
    expect(looksLikeDeadline({ title: 'Lab 3 report is due', feed_id: null })).toBe(false);
  });
  it('is not offered twice once the work exists', () => {
    const e = { title: 'Lab 3 report is due', starts_at: '2026-11-20T04:59:00Z' };
    expect(alreadyTracked(e, [{ title: 'lab 3 report is due', due_at: '2026-11-20T04:59:00.000Z' }])).toBe(true);
    expect(alreadyTracked(e, [{ title: 'Lab 3 report is due', due_at: null }])).toBe(false);
  });
  it('counts a calendar deadline as due until work stands for it', () => {
    const due = { title: 'MATH 205 - Assignment 9 Due (WeBWorK)', feed_id: 'f', starts_at: '2026-11-16T04:59:00Z' };
    const lecture = { title: 'MATH 205 Lecture', feed_id: 'f', starts_at: '2026-11-16T18:15:00Z' };
    expect(untrackedDeadlines([due, lecture], [])).toEqual([due]);
    expect(untrackedDeadlines([due], [{ title: due.title, due_at: due.starts_at }])).toEqual([]);
    // The day that read "nothing due" above two deadlines.
    expect(dueCount({ assignments: [], events: [due, lecture] as never })).toBe(1);
    expect(dueCount({ assignments: [{ title: due.title, due_at: due.starts_at }] as never, events: [due] as never })).toBe(1);
  });
  it('puts the calendar deadline with what is due and leaves the lecture on the timetable', () => {
    const due = { title: 'Lab 3 report is due', feed_id: 'f', starts_at: '2026-11-16T04:59:00Z' };
    const lecture = { title: 'MATH 205 Lecture', feed_id: 'f', starts_at: '2026-11-16T18:15:00Z' };
    const parts = dayParts({ assignments: [], events: [lecture, due] as never });
    expect(parts.calendarDue).toEqual([due]);
    expect(parts.timetable).toEqual([lecture]);
  });

  it('knows a commute from a class', () => {
    const e = (title: string, minutes: number, course_id: string | null = null) => ({
      title, course_id, all_day: false, starts_at: '2026-11-16T13:15:00Z',
      ends_at: new Date(Date.parse('2026-11-16T13:15:00Z') + minutes * 60_000).toISOString(),
    });
    expect(isBuffer(e('\u{1F68C} Travel', 30))).toBe(true);
    expect(isBuffer(e('Commute home', 45))).toBe(true);
    // Too long to be a gap, has a course, or is simply something else.
    expect(isBuffer(e('Travel to the conference', 240))).toBe(false);
    expect(isBuffer(e('Travel', 30, 'c1'))).toBe(false);
    expect(isBuffer(e('Gym', 30))).toBe(false);
    expect(isBuffer(e('Busy', 30))).toBe(false);
  });
});
