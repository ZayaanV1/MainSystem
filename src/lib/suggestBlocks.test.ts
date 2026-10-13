import { describe, expect, it } from 'vitest';
import { suggestBlocks, type BlockWork, type Busy, type SuggestOptions } from './suggestBlocks';
import type { DayKey } from './time';

// A fake zone where instants are written as local: "2026-10-12T14:30" is
// 14:30 on the 12th. Keeps the arithmetic under test, not the time layer.
const local = (d: Date) => ({ day: d.toISOString().slice(0, 10) as DayKey, minute: d.getUTCHours() * 60 + d.getUTCMinutes() });
const o: SuggestOptions = { today: '2026-10-12', nowMinute: 8 * 60, local };
const w = (id: string, due: string, effort: number | null, extra: Partial<BlockWork> = {}): BlockWork => ({
  id, title: id, course_id: null, due_at: `${due}Z`, effort_minutes: effort, status: 'todo', ...extra,
});
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

describe('suggestBlocks', () => {
  it('places work in the first free time, soonest due first', () => {
    const { suggestions } = suggestBlocks([w('later', '2026-10-15T23:59', 60), w('soon', '2026-10-13T23:59', 60)], [], o);
    expect(suggestions[0]).toMatchObject({ workId: 'soon', day: '2026-10-12', start: 9 * 60, minutes: 60 });
    expect(suggestions[1]).toMatchObject({ workId: 'later', day: '2026-10-12' });
    expect(suggestions[1].start).toBeGreaterThanOrEqual(10 * 60 + 10);
  });

  it('works around timed events, with a buffer', () => {
    const busy: Busy[] = [{ day: '2026-10-12', start: 9 * 60, end: 12 * 60 }];
    const { suggestions } = suggestBlocks([w('a', '2026-10-13T23:59', 60)], busy, o);
    expect(hm(suggestions[0].start)).toBe('12:10');
  });

  it('spreads long work over days, 90 minutes at most per block and one block per day', () => {
    const { suggestions } = suggestBlocks([w('essay', '2026-10-16T23:59', 300)], [], o);
    expect(suggestions.map((s) => [s.day, s.minutes])).toEqual([
      ['2026-10-12', 90],
      ['2026-10-13', 90],
      ['2026-10-14', 90],
      ['2026-10-15', 30],
    ]);
  });

  it('never ends a block after the work is due', () => {
    const { suggestions } = suggestBlocks([w('lab', '2026-10-12T10:00', 120)], [], o);
    for (const s of suggestions) expect(s.start + s.minutes).toBeLessThanOrEqual(10 * 60);
  });

  it('starts today after now, not in the past', () => {
    const { suggestions } = suggestBlocks([w('a', '2026-10-14T23:59', 60)], [], { ...o, nowMinute: 15 * 60 + 2 });
    expect(suggestions[0].day).toBe('2026-10-12');
    expect(suggestions[0].start).toBeGreaterThanOrEqual(15 * 60 + 12);
  });

  it('counts unestimated work rather than inventing minutes for it', () => {
    const r = suggestBlocks([w('vague', '2026-10-14T23:59', null)], [], o);
    expect(r.suggestions).toEqual([]);
    expect(r.unsized).toBe(1);
  });

  it('says when work could not all be placed', () => {
    const busy: Busy[] = [{ day: '2026-10-12', start: 0, end: 24 * 60 }];
    const r = suggestBlocks([w('a', '2026-10-12T23:59', 60)], busy, o);
    expect(r.suggestions).toEqual([]);
    expect(r.unplaced).toBe(1);
  });

  it('suggests at most four hours on any one day', () => {
    const many = ['a', 'b', 'c', 'd'].map((id) => w(id, '2026-10-12T23:59', 90));
    const { suggestions } = suggestBlocks(many, [], o);
    expect(suggestions.reduce((n, s) => n + s.minutes, 0)).toBeLessThanOrEqual(240);
  });

  it('prefers a gap that holds a whole session over the first short one', () => {
    // Free 9:00-9:40, then busy until 11:00, then free.
    const busy: Busy[] = [{ day: '2026-10-12', start: 9 * 60 + 50, end: 11 * 60 }];
    const { suggestions } = suggestBlocks([w('a', '2026-10-12T23:59', 90)], busy, o);
    expect(hm(suggestions[0].start)).toBe('11:10');
    expect(suggestions[0].minutes).toBe(90);
  });

  it('leaves overdue work alone rather than calling it unplaced', () => {
    const r = suggestBlocks([w('late', '2026-10-11T23:59', 60), w('gone', '2026-10-12T07:00', 60)], [], o);
    expect(r).toEqual({ suggestions: [], unsized: 0, unplaced: 0 });
  });

  it('ignores finished work', () => {
    expect(suggestBlocks([w('done', '2026-10-13T23:59', 60, { status: 'done' })], [], o).suggestions).toEqual([]);
  });
});
