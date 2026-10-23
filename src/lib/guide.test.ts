import { describe, it, expect } from 'vitest';
import { guideToMarkdown, isGuide, validateGuide } from '../../supabase/functions/_shared/guide';

const raw = {
  overview: '  A problem set on limits and derivatives.  ',
  requirements: ['Typed or scanned, one PDF', 'Typed or scanned, one PDF', 'Show all working'],
  parts: [
    { label: 'Question 1', approach: 'Factor the numerator, cancel the common term, then substitute.', concepts: ['Limits', 'Factoring'] },
    { label: 'Question 2', approach: 'The answer is 42', concepts: [] },
    { label: 'Question 3', approach: '12 + 4 = 16', concepts: [] },
    { label: '', approach: 'No label', concepts: [] },
  ],
  pitfalls: ['Forgetting the domain'],
  ask: [],
};

describe('validateGuide', () => {
  it('keeps real methods and drops bare answers', () => {
    const { guide, warnings } = validateGuide(raw);
    expect(guide.parts.map((p) => p.label)).toEqual(['Question 1']);
    expect(warnings.some((w) => /Question 2/.test(w))).toBe(true);
    expect(warnings.some((w) => /Question 3/.test(w))).toBe(true);
  });

  it('collapses whitespace and removes duplicate lines', () => {
    const { guide } = validateGuide(raw);
    expect(guide.overview).toBe('A problem set on limits and derivatives.');
    expect(guide.requirements).toEqual(['Typed or scanned, one PDF', 'Show all working']);
  });

  it('survives garbage', () => {
    const { guide } = validateGuide(null);
    expect(guide).toEqual({ overview: '', requirements: [], parts: [], pitfalls: [], ask: [] });
    expect(validateGuide({ parts: 'nope' }).guide.parts).toEqual([]);
  });

  it('caps how many parts it keeps and says so', () => {
    const parts = Array.from({ length: 20 }, (_, i) => ({ label: `Q${i}`, approach: 'Set up the integral first.', concepts: [] }));
    const { guide, warnings } = validateGuide({ parts });
    expect(guide.parts).toHaveLength(14);
    expect(warnings.join(' ')).toMatch(/left out/);
  });
});

describe('guideToMarkdown', () => {
  it('writes every section that has content and no empty ones', () => {
    const { guide } = validateGuide(raw);
    const md = guideToMarkdown('Problem set 3', guide);
    expect(md).toContain('# Guide: Problem set 3');
    expect(md).toContain('### Question 1');
    expect(md).toContain('Needs: Limits; Factoring');
    expect(md).not.toContain('## Worth asking');
    expect(md.endsWith('\n')).toBe(true);
  });
});

describe('isGuide', () => {
  it('accepts what validateGuide makes and refuses anything else', () => {
    expect(isGuide(validateGuide(raw).guide)).toBe(true);
    expect(isGuide({ overview: 'x' })).toBe(false);
    expect(isGuide(null)).toBe(false);
  });
});
