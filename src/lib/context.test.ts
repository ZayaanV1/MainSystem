import { describe, it, expect } from 'vitest';
import { buildContext, type ContextInput } from '../../supabase/functions/_shared/context';

const base: ContextInput = {
  today: '2026-08-19',
  now: '18:00',
  assignments: [],
  events: [],
  checklist: [],
  food: { totals: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }, targets: null, items: [] },
  savedMeals: [],
  weights: [],
};

const ctx = (o: Partial<ContextInput>) => buildContext({ ...base, ...o });

describe('buildContext', () => {
  it('collects every id the model may cite or act on', () => {
    const { knownIds } = ctx({
      assignments: [{ id: 'a1', title: 'Essay', due_at: '2026-09-01T03:59:00Z', due_has_time: true, status: 'todo', effort_minutes: 120 }],
      events: [{ id: 'e1', title: 'Midterm', kind: 'exam', starts_at: '2026-10-22T22:00:00Z', all_day: false }],
      checklist: [{ id: 'c1', title: 'Adderall', done_today: true, doses_remaining: 28 }],
      savedMeals: [{ id: 'm1', name: 'Shake', calories: 270, protein_g: 34 }],
    });
    expect([...knownIds].sort()).toEqual(['a1', 'c1', 'e1', 'm1']);
  });

  it('does not put weigh-in days in the id set', () => {
    // Nothing can be cited or acted on by date, and letting a date pass the
    // id check would weaken the one guard against a fabricated reference.
    const { knownIds } = ctx({ weights: [{ local_day: '2026-08-18', kg: 74.6 }] });
    expect(knownIds.size).toBe(0);
  });

  it('states what is left of each macro so the model never does arithmetic', () => {
    // "How much protein have I got left" is the question it will be asked
    // most, and a model doing subtraction is a model that can be wrong.
    const { text } = ctx({
      food: {
        totals: { calories: 2000, protein_g: 98, carbs_g: 200, fat_g: 40 },
        targets: { calories: [2900, 3100], protein: [160, 175], carbs: [350, 400], fat: [70, 80] },
        items: [],
      },
    });
    expect(text).toContain('left to reach the bottom of each range: 900 kcal, protein 62 g');
  });

  it('never states a negative remainder once a target is met', () => {
    const { text } = ctx({
      food: {
        totals: { calories: 3200, protein_g: 190, carbs_g: 420, fat_g: 90 },
        targets: { calories: [2900, 3100], protein: [160, 175], carbs: [350, 400], fat: [70, 80] },
        items: [],
      },
    });
    expect(text).toContain('left to reach the bottom of each range: 0 kcal, protein 0 g, carbs 0 g, fat 0 g');
  });

  it('says a section is empty rather than omitting it', () => {
    // An absent heading reads as "not provided"; an empty one reads as
    // "nothing there", and only the second supports an honest answer.
    const { text } = ctx({});
    expect(text).toContain('(nothing open)');
    expect(text).toContain('(none in the next month)');
    expect(text).toContain('(nothing due today)');
    expect(text).toContain('(none saved)');
    expect(text).toContain('(none recorded)');
  });

  it('renders a deadline in local time, not UTC', () => {
    // The bug this exists for: 2026-08-21T03:59Z is Thursday 23:59 in Toronto,
    // and slicing the ISO string reports it as Friday 03:59 — a deadline moved
    // a day later, stated confidently. It got past a first live test looking
    // entirely plausible.
    const { text } = ctx({
      assignments: [{ id: 'a1', title: 'Assembly lab 2', due_at: '2026-08-21T03:59:00Z', due_has_time: true, status: 'todo', effort_minutes: null }],
    });
    expect(text).toContain('due 2026-08-20 23:59');
    expect(text).not.toContain('2026-08-21');
  });

  it('renders an event in local time too', () => {
    // 22:00Z in August is 18:00 EDT.
    const { text } = ctx({
      events: [{ id: 'e1', title: 'Midterm', kind: 'exam', starts_at: '2026-08-25T22:00:00Z', all_day: false }],
    });
    expect(text).toContain('2026-08-25 18:00');
  });

  it('gets the offset right on the other side of DST', () => {
    // January is EST, UTC-5: 03:59Z is 22:59 the previous day.
    const { text } = ctx({
      assignments: [{ id: 'a1', title: 'Winter essay', due_at: '2027-01-15T03:59:00Z', due_has_time: true, status: 'todo', effort_minutes: null }],
    });
    expect(text).toContain('due 2027-01-14 22:59');
  });

  it('says so rather than guessing when a timestamp is unreadable', () => {
    const { text } = ctx({
      assignments: [{ id: 'a1', title: 'Broken', due_at: 'not-a-date', due_has_time: true, status: 'todo', effort_minutes: null }],
    });
    expect(text).toContain('unknown time');
  });

  it('reports how long work has been sitting there', () => {
    // "What have I been putting off" is a question the spec names, and
    // without age the only honest answer is that the data does not say.
    const { text } = ctx({
      assignments: [{ id: 'a1', title: 'Lab report', due_at: null, due_has_time: false, status: 'todo', effort_minutes: null, created_at: '2026-07-20T14:00:00Z' }],
    });
    expect(text).toContain('on the list 30 days');
  });

  it('does not label something added today as having sat there', () => {
    const { text } = ctx({
      assignments: [{ id: 'a1', title: 'Fresh', due_at: null, due_has_time: false, status: 'todo', effort_minutes: null, created_at: '2026-08-19T14:00:00Z' }],
    });
    expect(text).not.toContain('on the list');
  });

  it('shows a dateless assignment as having no date', () => {
    const { text } = ctx({
      assignments: [{ id: 'a1', title: 'Lab report', due_at: null, due_has_time: false, status: 'todo', effort_minutes: null }],
    });
    expect(text).toContain('[a1] Lab report — no date');
  });

  it('drops the time from an assignment that has none, keeping the local day', () => {
    // Still converted: the local day of 2026-09-01T03:59Z is 31 August.
    const { text } = ctx({
      assignments: [{ id: 'a1', title: 'Essay', due_at: '2026-09-01T03:59:00Z', due_has_time: false, status: 'todo', effort_minutes: null }],
    });
    expect(text).toContain('due 2026-08-31');
    expect(text).not.toContain('03:59');
  });

  it('reports the dose count, which is the one number worth being exact about', () => {
    const { text } = ctx({
      checklist: [{ id: 'c1', title: 'Adderall XR 20mg', done_today: false, doses_remaining: 3 }],
    });
    expect(text).toContain('not done today, 3 doses left');
  });

  it('omits a dose count for items that do not track one', () => {
    const { text } = ctx({ checklist: [{ id: 'c1', title: 'Creatine', done_today: true, doses_remaining: null }] });
    expect(text).toContain('[c1] Creatine — done today');
    expect(text).not.toContain('doses left');
  });
});
