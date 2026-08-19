import { describe, it, expect } from 'vitest';
import { score, type SearchHit } from './searchRank';

const hit = (o: Partial<SearchHit> & { title: string }): SearchHit => ({
  kind: 'assignment',
  id: o.title,
  detail: null,
  day: '2026-08-19',
  done: false,
  ...o,
});

/** Sorts the way search() does, so ordering is asserted rather than described. */
const rank = (hits: SearchHit[], q: string) =>
  [...hits].sort((a, b) => score(a, q) - score(b, q)).map((h) => h.title);

describe('search ranking', () => {
  it('puts an exact title first', () => {
    expect(
      rank([hit({ title: 'Lab report draft' }), hit({ title: 'Lab' })], 'lab'),
    ).toEqual(['Lab', 'Lab report draft']);
  });

  it('prefers a title that starts with the query over one that merely contains it', () => {
    expect(
      rank([hit({ title: 'Second lab report' }), hit({ title: 'Lab report two' })], 'lab'),
    ).toEqual(['Lab report two', 'Second lab report']);
  });

  it('puts open work above finished work', () => {
    // Searching is nearly always a prelude to acting on something.
    expect(
      rank([hit({ title: 'Lab report', done: true }), hit({ title: 'Lab report', done: false })], 'lab report'),
    ).toEqual(['Lab report', 'Lab report']);

    const [first] = [hit({ title: 'Lab', done: true }), hit({ title: 'Lab', done: false })]
      .sort((a, b) => score(a, 'lab') - score(b, 'lab'));
    expect(first.done).toBe(false);
  });

  it('outranks a finished exact match with an open partial one', () => {
    // Acting beats auditing: an open thing you can still do is more useful
    // than a perfect match you already finished.
    const hits = [hit({ title: 'Lab', done: true }), hit({ title: 'Lab report draft', done: false })];
    expect(rank(hits, 'lab')[0]).toBe('Lab report draft');
  });

  it('sorts a dated thing above an undated one of equal relevance', () => {
    const hits = [hit({ title: 'Lab', day: null }), hit({ title: 'Lab', day: '2026-08-19' })];
    const [first] = [...hits].sort((a, b) => score(a, 'lab') - score(b, 'lab'));
    expect(first.day).toBe('2026-08-19');
  });

  it('is case and whitespace insensitive', () => {
    expect(score(hit({ title: 'Lab Report' }), '  lab report  ')).toBe(
      score(hit({ title: 'lab report' }), 'lab report'),
    );
  });
});
