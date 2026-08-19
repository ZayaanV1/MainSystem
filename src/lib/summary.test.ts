import { describe, it, expect } from 'vitest';
import {
  fingerprint,
  isEmptyDay,
  validateSummary,
  type SummaryInput,
} from '../../supabase/functions/_shared/summary';

const base: SummaryInput = {
  today: '2026-08-19',
  now: '08:30',
  dueToday: [],
  dueSoon: [],
  overdue: [],
  chores: [],
};

const input = (o: Partial<SummaryInput>) => ({ ...base, ...o });
const item = (title: string, due: string | null) =>
  ({ title, due, kind: 'assignment' as const, minutes: null });

describe('fingerprint', () => {
  it('is stable for the same work', () => {
    const a = input({ dueToday: [item('Lab 2', '2026-08-19')] });
    expect(fingerprint(a)).toBe(fingerprint(input({ dueToday: [item('Lab 2', '2026-08-19')] })));
  });

  it('changes when something is ticked off', () => {
    const before = input({ chores: ['Adderall', 'Creatine'] });
    const after = input({ chores: ['Creatine'] });
    expect(fingerprint(before)).not.toBe(fingerprint(after));
  });

  it('changes when a deadline moves', () => {
    expect(fingerprint(input({ dueToday: [item('Lab 2', '2026-08-19')] })))
      .not.toBe(fingerprint(input({ dueToday: [item('Lab 2', '2026-08-20')] })));
  });

  it('ignores the clock', () => {
    // Opening the app an hour later is not a reason to spend a model call.
    expect(fingerprint(input({ now: '08:30' }))).toBe(fingerprint(input({ now: '19:45' })));
  });
});

describe('isEmptyDay', () => {
  it('is true only when there is genuinely nothing', () => {
    expect(isEmptyDay(base)).toBe(true);
    expect(isEmptyDay(input({ chores: ['Creatine'] }))).toBe(false);
    expect(isEmptyDay(input({ overdue: [item('Old thing', '2026-08-01')] }))).toBe(false);
  });
});

describe('validateSummary', () => {
  const withWork = input({ dueToday: [item('Assembly lab 2', '2026-08-19')] });

  it('keeps a normal briefing', () => {
    const r = validateSummary(
      { summary: 'Assembly lab 2 is due tonight and it is the only hard deadline today. Worth starting it before the laundry.' },
      withWork,
    );
    expect(r.summary).toMatch(/^Assembly lab 2 is due tonight/);
    expect(r.warnings).toEqual([]);
  });

  it('flattens a model that returned a list anyway', () => {
    const r = validateSummary({ summary: '- Assembly lab 2 is due today.\n- Start early.' }, withWork);
    expect(r.summary).toBe('Assembly lab 2 is due today. Start early.');
  });

  it('drops a summary citing a date that was never given', () => {
    // The one failure that matters: nobody confirms this text before reading
    // it, so an invented deadline would be believed.
    const r = validateSummary(
      { summary: 'Your lab is due 2026-09-30, so there is time.' },
      withWork,
    );
    expect(r.summary).toBe('');
    expect(r.warnings[0]).toMatch(/2026-09-30, which is not in your data/);
  });

  it('accepts a date that WAS given', () => {
    const r = validateSummary({ summary: 'Assembly lab 2 is due 2026-08-19.' }, withWork);
    expect(r.summary).toContain('2026-08-19');
    expect(r.warnings).toEqual([]);
  });

  it('drops something far too long rather than showing a wall of text', () => {
    const r = validateSummary({ summary: 'word '.repeat(120) }, withWork);
    expect(r.summary).toBe('');
    expect(r.warnings[0]).toMatch(/words and was dropped/);
  });

  it('survives an empty or malformed response', () => {
    expect(validateSummary({}, withWork).summary).toBe('');
    expect(validateSummary(null, withWork).summary).toBe('');
    expect(validateSummary({ summary: '   ' }, withWork).summary).toBe('');
  });
});
