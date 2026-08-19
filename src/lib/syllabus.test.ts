import { describe, it, expect } from 'vitest';
import { validateSyllabus } from '../../supabase/functions/_shared/syllabus';

/**
 * "An incomplete calendar is an untrusted calendar." Every test here is about
 * one of the two ways this feature fails: inventing a date that was never on
 * the page, or losing a deliverable that was.
 */

const item = (o: Record<string, unknown>) => ({ title: 'Assignment 1', kind: 'assignment', ...o });

describe('validateSyllabus', () => {
  it('keeps a fully stated deliverable', () => {
    const r = validateSyllabus({
      items: [item({ title: 'Midterm', kind: 'exam', due_date: '2026-10-15', due_time: '18:00', weight_percent: 25 })],
    });
    expect(r.items[0]).toEqual({
      title: 'Midterm',
      kind: 'exam',
      due_date: '2026-10-15',
      due_time: '18:00',
      weight_percent: 25,
    });
  });

  it('keeps an undated item undated rather than dropping it', () => {
    // "Week 6" is real work with no date. Dropping it makes the calendar
    // incomplete; dating it by counting weeks invents a deadline.
    const r = validateSyllabus({ items: [item({ title: 'Lab 3', due_date: null })] });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].due_date).toBeNull();
    expect(r.warnings.at(-1)).toMatch(/1 of 1 have no date/);
  });

  it('discards a malformed date but keeps the deliverable', () => {
    const r = validateSyllabus({ items: [item({ due_date: 'Week 6' })] });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].due_date).toBeNull();
    expect(r.warnings[0]).toMatch(/unreadable date/);
  });

  it('rejects a date that is well-formed but not a real day', () => {
    // 2026-02-30 passes a regex and fails reality.
    const r = validateSyllabus({ items: [item({ due_date: '2026-02-30' })] });
    expect(r.items[0].due_date).toBeNull();
    expect(r.warnings[0]).toMatch(/unreadable date/);
  });

  it('rejects a date outside the term, which is nearly always a guessed year', () => {
    const r = validateSyllabus(
      { items: [item({ due_date: '2025-10-15' })] },
      { from: '2026-09-01', to: '2026-12-23' },
    );
    expect(r.items[0].due_date).toBeNull();
    expect(r.warnings[0]).toMatch(/outside the term/);
  });

  it('keeps a date inside the term', () => {
    const r = validateSyllabus(
      { items: [item({ due_date: '2026-10-15' })] },
      { from: '2026-09-01', to: '2026-12-23' },
    );
    expect(r.items[0].due_date).toBe('2026-10-15');
  });

  it('drops a time that has no date to attach to', () => {
    // A bare time cannot become an instant and would vanish silently later.
    const r = validateSyllabus({ items: [item({ due_date: null, due_time: '23:59' })] });
    expect(r.items[0].due_time).toBeNull();
    expect(r.warnings.some((w) => /time but no date/.test(w))).toBe(true);
  });

  it('rejects a nonsense time', () => {
    const r = validateSyllabus({ items: [item({ due_date: '2026-10-15', due_time: '25:99' })] });
    expect(r.items[0].due_time).toBeNull();
  });

  it('classifies exams and presentations, defaulting everything else', () => {
    const r = validateSyllabus({
      items: [
        item({ title: 'Final', kind: 'exam' }),
        item({ title: 'Demo day', kind: 'presentation' }),
        item({ title: 'Problem set', kind: 'homework' }),
      ],
    });
    expect(r.items.map((i) => i.kind)).toEqual(['exam', 'presentation', 'assignment']);
  });

  it('deduplicates by title', () => {
    const r = validateSyllabus({ items: [item({ title: 'Quiz 1' }), item({ title: 'quiz 1' })] });
    expect(r.items).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/appeared twice/);
  });

  it('flags weights that cannot all be right', () => {
    const r = validateSyllabus({
      items: [
        item({ title: 'A', due_date: '2026-10-01', weight_percent: 60 }),
        item({ title: 'B', due_date: '2026-11-01', weight_percent: 60 }),
      ],
    });
    expect(r.warnings.some((w) => /add up to 120%/.test(w))).toBe(true);
  });

  it('ignores an impossible weight rather than storing it', () => {
    const r = validateSyllabus({ items: [item({ due_date: '2026-10-01', weight_percent: 400 })] });
    expect(r.items[0].weight_percent).toBeNull();
  });

  it('survives a malformed response without throwing', () => {
    expect(validateSyllabus(null).items).toEqual([]);
    expect(validateSyllabus({ items: 'no' }).items).toEqual([]);
    expect(validateSyllabus({ items: [null, 7, { title: '' }] }).items).toEqual([]);
  });
});
