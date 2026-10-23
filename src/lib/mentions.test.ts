import { describe, it, expect } from 'vitest';
import { dayHref, splitMentions, workHref, type Mention } from './mentions';

const work = (title: string, id = 'a1b2c3d4-0000-4000-8000-000000000001'): Mention => ({
  title,
  href: workHref(id),
  kind: 'work',
});

describe('splitMentions', () => {
  it('links a title wherever it appears and keeps the words around it', () => {
    const pieces = splitMentions('Your Lab report is due Thursday.', [work('lab report')]);
    expect(pieces.map((p) => p.text)).toEqual(['Your ', 'Lab report', ' is due Thursday.']);
    expect(pieces[1].mention?.kind).toBe('work');
  });

  it('prefers the longest title when two overlap', () => {
    const pieces = splitMentions('Finish Lab report 2 first.', [work('Lab report'), work('Lab report 2', 'ffffffff-0000-4000-8000-000000000002')]);
    const linked = pieces.filter((p) => p.mention);
    expect(linked).toHaveLength(1);
    expect(linked[0].text).toBe('Lab report 2');
  });

  it('only links whole words', () => {
    const pieces = splitMentions('Reading essays all week', [work('Essay')]);
    expect(pieces.every((p) => !p.mention)).toBe(true);
    expect(splitMentions('The essay, then rest', [work('Essay')]).some((p) => p.mention)).toBe(true);
  });

  it('matches across curly and straight quotes', () => {
    const pieces = splitMentions('Start the TA’s quiz now', [work("TA's quiz")]);
    expect(pieces.find((p) => p.mention)?.text).toBe('TA’s quiz');
  });

  it('links every occurrence and ignores titles too short to be safe', () => {
    const pieces = splitMentions('Midterm today, midterm again, ok', [work('Midterm'), work('ok')]);
    expect(pieces.filter((p) => p.mention)).toHaveLength(2);
  });

  it('returns the text untouched when nothing matches', () => {
    expect(splitMentions('Nothing here', [work('Midterm')])).toEqual([{ text: 'Nothing here' }]);
    expect(splitMentions('', [])).toEqual([{ text: '' }]);
  });

  it('rebuilds the original text exactly', () => {
    const text = 'Midterm 1 is Friday; the Lab report follows. Midterm 1 again.';
    const pieces = splitMentions(text, [work('Midterm 1'), work('Lab report')]);
    expect(pieces.map((p) => p.text).join('')).toBe(text);
  });
});

describe('addresses', () => {
  it('points work at its page and an exam at its day', () => {
    expect(workHref('a1b2c3d4-0000-4000-8000-000000000001')).toBe('/work/a1b2c3d4-0000-4000-8000-000000000001');
    expect(dayHref('2026-10-29')).toBe('/month?day=2026-10-29');
  });
});
