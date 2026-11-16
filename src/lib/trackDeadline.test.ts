import { describe, expect, it } from 'vitest';
import { alreadyTracked, looksLikeDeadline, untrackedDeadlines } from './planner';
import { dueCount } from './week';

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
});
