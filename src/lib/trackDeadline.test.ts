import { describe, expect, it } from 'vitest';
import { alreadyTracked, looksLikeDeadline } from './planner';

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
});
