import { describe, it, expect } from 'vitest';
import { validateBreakdown } from '../../supabase/functions/_shared/breakdown';

/**
 * The point of a breakdown is the difference between "Write research paper"
 * and "open a doc and write three possible thesis sentences". A model asked to
 * break down a task will, left alone, return the first thing in four pieces —
 * so these tests are mostly about rejecting that.
 */

const steps = (...s: { title: string; minutes?: number }[]) => ({
  steps: s.map((x) => ({ title: x.title, minutes: x.minutes ?? 15 })),
});

describe('validateBreakdown', () => {
  it('keeps concrete first moves', () => {
    const result = validateBreakdown(
      steps(
        { title: 'Open the syllabus and copy the marking criteria into a doc', minutes: 10 },
        { title: 'Write three possible thesis sentences', minutes: 20 },
      ),
      'Write research paper',
    );

    expect(result.steps).toEqual([
      { title: 'Open the syllabus and copy the marking criteria into a doc', minutes: 10 },
      { title: 'Write three possible thesis sentences', minutes: 20 },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('drops the vague verbs that are the original problem in miniature', () => {
    const result = validateBreakdown(
      steps(
        { title: 'Research the topic' },
        { title: 'Review the literature' },
        { title: 'Plan the structure' },
        { title: 'Open a doc and list four sources you already know' },
      ),
      'Write research paper',
    );

    expect(result.steps.map((s) => s.title)).toEqual([
      'Open a doc and list four sources you already know',
    ]);
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings[0]).toMatch(/causes the paralysis/);
  });

  it('drops a step that is just the assignment title again', () => {
    const result = validateBreakdown(
      steps({ title: 'Write research paper' }, { title: 'Write the first paragraph badly on purpose' }),
      'Write research paper',
    );
    expect(result.steps).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/title again/);
  });

  it('matches the title loosely, so punctuation does not smuggle it through', () => {
    const result = validateBreakdown(steps({ title: 'Write  Research Paper!' }), 'Write research paper');
    expect(result.steps).toHaveLength(0);
  });

  it('keeps a repeated step once and says so', () => {
    const result = validateBreakdown(
      steps({ title: 'Open a doc' }, { title: 'open a doc' }),
      'Essay',
    );
    expect(result.steps).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/came back twice/);
  });

  it('caps an estimate that is not a first move, and says the number', () => {
    const result = validateBreakdown(
      steps({ title: 'Draft the whole methods section', minutes: 180 }),
      'Lab report',
    );
    expect(result.steps[0].minutes).toBe(40);
    expect(result.warnings[0]).toMatch(/180 minutes/);
  });

  it('fills in a missing or nonsense estimate rather than dropping the step', () => {
    const bad = validateBreakdown({ steps: [{ title: 'Open the lab manual to page 4' }] }, 'Lab');
    expect(bad.steps[0].minutes).toBe(15);

    const zero = validateBreakdown(steps({ title: 'Email the TA one question', minutes: 0 }), 'Lab');
    expect(zero.steps[0].minutes).toBe(5);
  });

  it('trims a long list rather than returning a plan', () => {
    const many = validateBreakdown(
      steps(...Array.from({ length: 9 }, (_, i) => ({ title: `Open file number ${i}` }))),
      'Project',
    );
    expect(many.steps).toHaveLength(6);
    expect(many.warnings.at(-1)).toMatch(/first six were kept/);
  });

  it('survives a malformed response without throwing', () => {
    expect(validateBreakdown(null, 'X').steps).toEqual([]);
    expect(validateBreakdown({ steps: 'nope' }, 'X').steps).toEqual([]);
    expect(validateBreakdown({ steps: [null, 42, { title: '' }] }, 'X').steps).toEqual([]);
  });
});
