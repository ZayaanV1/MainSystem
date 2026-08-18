import { describe, it, expect } from 'vitest';
import {
  asWeeks,
  buildHistory,
  dayFill,
  describeDay,
  HISTORY_DAYS,
  type CompletionRecord,
} from '../../supabase/functions/_shared/history';
import type { ChecklistItem } from './checklist';

const TODAY = '2026-08-18';

const item = (id: string, o: Partial<ChecklistItem> = {}): ChecklistItem => ({
  id,
  title: id,
  recurrence: 'daily',
  weekdays: null,
  interval_days: null,
  anchor_day: null,
  active: true,
  sort_order: 0,
  essential: false,
  tracks_doses: false,
  doses_remaining: null,
  doses_per_completion: 1,
  refill_warning_days: 3,
  ...o,
});

const done = (item_id: string, local_day: string): CompletionRecord => ({ item_id, local_day });

describe('the window', () => {
  it('is five weeks, ending today', () => {
    const h = buildHistory([], [], TODAY);
    expect(h).toHaveLength(HISTORY_DAYS);
    expect(h[HISTORY_DAYS - 1].day).toBe(TODAY);
    expect(h[0].day).toBe('2026-07-15'); // 35 days ending 18 Aug
  });

  it('never runs past today', () => {
    // A row of future blanks reads as things already missed.
    const h = buildHistory([], [], TODAY);
    expect(h.every((d) => d.day <= TODAY)).toBe(true);
    expect(h.some((d) => d.isFuture)).toBe(false);
  });

  it('marks today exactly once', () => {
    const h = buildHistory([], [], TODAY);
    expect(h.filter((d) => d.isToday)).toHaveLength(1);
  });

  it('splits into weeks of seven', () => {
    const weeks = asWeeks(buildHistory([], [], TODAY));
    expect(weeks).toHaveLength(5);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });
});

describe('a day has four states, not a number', () => {
  const items = [item('med'), item('creatine')];

  it('is none-due when nothing was expected', () => {
    const weekendOnly = [item('gym', { recurrence: 'weekdays', weekdays: [6, 7] })];
    // 18 Aug 2026 is a Tuesday.
    expect(dayFill(weekendOnly, new Set(), TODAY)).toBe('none-due');
  });

  it('is open when something was expected and nothing ticked', () => {
    expect(dayFill(items, new Set(), TODAY)).toBe('open');
  });

  it('is partial when some are ticked', () => {
    expect(dayFill(items, new Set(['med']), TODAY)).toBe('partial');
  });

  it('is complete when all are ticked', () => {
    expect(dayFill(items, new Set(['med', 'creatine']), TODAY)).toBe('complete');
  });

  it('ignores completions belonging to another day', () => {
    const h = buildHistory(items, [done('med', '2026-08-17')], TODAY);
    expect(h.find((d) => d.day === '2026-08-17')!.fill).toBe('partial');
    expect(h.find((d) => d.day === TODAY)!.fill).toBe('open');
  });

  it('respects recurrence, so a day off is not a day missed', () => {
    // A weekday item on a Saturday was never expected, so the day is none-due
    // rather than open.
    const weekdays = [item('gym', { recurrence: 'weekdays', weekdays: [1, 2, 3, 4, 5] })];
    const h = buildHistory(weekdays, [], TODAY);
    expect(h.find((d) => d.day === '2026-08-15')!.fill).toBe('none-due'); // Saturday
    expect(h.find((d) => d.day === '2026-08-14')!.fill).toBe('open'); // Friday
  });
});

describe('rule 3 — nothing here scores anything', () => {
  it('exposes no count, ratio, streak or total anywhere in the result', () => {
    const h = buildHistory([item('med')], [done('med', TODAY)], TODAY);
    const keys = new Set(h.flatMap((d) => Object.keys(d)));
    for (const banned of [/count/i, /total/i, /streak/i, /percent/i, /ratio/i, /score/i, /missed/i]) {
      expect([...keys].some((k) => banned.test(k)), `key matching ${banned}`).toBe(false);
    }
  });

  it('describes an untouched day by what can be done, not by what did not happen', () => {
    const h = buildHistory([item('med')], [], TODAY);
    const text = describeDay(h[h.length - 1], 'Tue, Aug 18');

    expect(text).toContain('tap to fill it in');
    expect(text).not.toMatch(/missed|failed|behind|should|you |streak|incomplete/i);
  });

  it('never calls a quiet day a failure', () => {
    const h = buildHistory([], [], TODAY);
    const text = describeDay(h[0], 'Thu, Jul 16');
    expect(text).toBe('Thu, Jul 16, nothing was on the list');
    expect(text).not.toMatch(/missed|none done|empty|failed/i);
  });

  it('may be warm about a finished day, but never comparative', () => {
    // Praise for a moment is safe. Praise that accumulates — a streak, a best
    // week, a chain — creates something losable, and losing it is what makes
    // the app hard to reopen.
    const h = buildHistory([item('med')], [done('med', TODAY)], TODAY);
    const text = describeDay(h[h.length - 1], 'Tue, Aug 18');
    expect(text).toBe('Tue, Aug 18, all done');
    expect(text).not.toMatch(/streak|in a row|days running|best|chain|record|again/i);
  });
});

describe('across a DST boundary', () => {
  it('produces five clean weeks with no repeated or skipped day', () => {
    const h = buildHistory([], [], '2026-11-10');
    expect(h).toHaveLength(HISTORY_DAYS);
    expect(new Set(h.map((d) => d.day)).size).toBe(HISTORY_DAYS);
    expect(h.some((d) => d.day === '2026-11-01')).toBe(true);
  });
});
