import { describe, it, expect } from 'vitest';
import { dueOn, isDueOn, recentDays, refillStatus, type ChecklistItem } from './checklist';
import { isoWeekday } from './time';

const base: ChecklistItem = {
  id: 'x',
  title: 'Item',
  recurrence: 'daily',
  weekdays: null,
  interval_days: null,
  anchor_day: null,
  active: true,
  sort_order: 0,
  tracks_doses: false,
  doses_remaining: null,
  doses_per_completion: 1,
  refill_warning_days: 3,
};

const item = (o: Partial<ChecklistItem>): ChecklistItem => ({ ...base, ...o });

describe('isoWeekday', () => {
  it('numbers Monday through Sunday as 1 to 7', () => {
    // 17 Aug 2026 is a Monday.
    expect(isoWeekday('2026-08-17')).toBe(1);
    expect(isoWeekday('2026-08-22')).toBe(6); // Saturday
    expect(isoWeekday('2026-08-23')).toBe(7); // Sunday
  });

  it('is unaffected by DST transitions', () => {
    expect(isoWeekday('2026-03-08')).toBe(7);
    expect(isoWeekday('2026-11-01')).toBe(7);
  });
});

describe('daily items', () => {
  it('are due every day', () => {
    for (const d of ['2026-08-17', '2026-08-18', '2026-11-01', '2027-01-01']) {
      expect(isDueOn(item({}), d)).toBe(true);
    }
  });

  it('are not due once deactivated', () => {
    expect(isDueOn(item({ active: false }), '2026-08-17')).toBe(false);
  });
});

describe('weekday items', () => {
  const weekdaysOnly = item({ recurrence: 'weekdays', weekdays: [1, 2, 3, 4, 5] });

  it('appear on weekdays', () => {
    expect(isDueOn(weekdaysOnly, '2026-08-17')).toBe(true); // Mon
    expect(isDueOn(weekdaysOnly, '2026-08-21')).toBe(true); // Fri
  });

  it('do not appear at the weekend', () => {
    expect(isDueOn(weekdaysOnly, '2026-08-22')).toBe(false); // Sat
    expect(isDueOn(weekdaysOnly, '2026-08-23')).toBe(false); // Sun
  });

  it('never appear when the weekday list is empty', () => {
    expect(isDueOn(item({ recurrence: 'weekdays', weekdays: [] }), '2026-08-17')).toBe(false);
  });
});

describe('interval items', () => {
  const everyTwoWeeks = item({
    recurrence: 'interval',
    interval_days: 14,
    anchor_day: '2026-08-17',
  });

  it('are due on the anchor day', () => {
    expect(isDueOn(everyTwoWeeks, '2026-08-17')).toBe(true);
  });

  it('are due every N days after it', () => {
    expect(isDueOn(everyTwoWeeks, '2026-08-31')).toBe(true);
    expect(isDueOn(everyTwoWeeks, '2026-09-14')).toBe(true);
  });

  it('are not due in between', () => {
    expect(isDueOn(everyTwoWeeks, '2026-08-24')).toBe(false);
    expect(isDueOn(everyTwoWeeks, '2026-08-30')).toBe(false);
  });

  it('are never due before the anchor', () => {
    // An item configured today must not retroactively appear to have been
    // missed every fortnight since January.
    expect(isDueOn(everyTwoWeeks, '2026-08-03')).toBe(false);
    expect(isDueOn(everyTwoWeeks, '2026-01-05')).toBe(false);
  });

  it('counts calendar days across a DST transition, not 24-hour blocks', () => {
    const daily2 = item({
      recurrence: 'interval',
      interval_days: 2,
      anchor_day: '2026-10-30',
    });
    // 30 Oct, 1 Nov, 3 Nov — the 25-hour day on 1 Nov must not shift the cycle.
    expect(isDueOn(daily2, '2026-11-01')).toBe(true);
    expect(isDueOn(daily2, '2026-11-02')).toBe(false);
    expect(isDueOn(daily2, '2026-11-03')).toBe(true);
  });

  it('is not due when misconfigured, rather than crashing', () => {
    expect(isDueOn(item({ recurrence: 'interval', interval_days: null }), '2026-08-17')).toBe(false);
  });
});

describe('dueOn', () => {
  it('returns only due items, in display order', () => {
    const items = [
      item({ id: 'c', title: 'Third', sort_order: 3 }),
      item({ id: 'a', title: 'First', sort_order: 1 }),
      item({ id: 'w', title: 'Weekend only', recurrence: 'weekdays', weekdays: [6, 7], sort_order: 2 }),
    ];
    // 17 Aug 2026 is a Monday, so the weekend item is absent.
    expect(dueOn(items, '2026-08-17').map((i) => i.title)).toEqual(['First', 'Third']);
  });
});

describe('the medication counter', () => {
  // Adderall XR 20mg, one a day, three days of lead time for a refill.
  const med = (doses: number | null): ChecklistItem =>
    item({
      title: 'Adderall XR 20mg',
      tracks_doses: true,
      doses_remaining: doses,
      doses_per_completion: 1,
      refill_warning_days: 3,
    });

  it('says nothing for an item that does not track doses', () => {
    expect(refillStatus(item({})).label).toBeNull();
  });

  it('reports a comfortable supply plainly', () => {
    const s = refillStatus(med(30));
    expect(s).toMatchObject({ doses: 30, daysLeft: 30, needsRefill: false, empty: false });
    expect(s.label).toBe('30 left');
  });

  it('warns exactly when the lead time is reached, not at a round number', () => {
    // Three days of lead time means the warning fires at three doses, which is
    // the last moment acting on it still works.
    expect(refillStatus(med(4)).needsRefill).toBe(false);
    expect(refillStatus(med(3)).needsRefill).toBe(true);
  });

  it('says what to do when the warning fires', () => {
    expect(refillStatus(med(3)).label).toBe('3 left, 3 days — time to refill');
  });

  it('gets the singular right on the last day', () => {
    expect(refillStatus(med(1)).label).toBe('1 left, 1 day — time to refill');
  });

  it('states empty as a fact, with no reproach', () => {
    // Today's real state. Running out is a supply fact, not a personal
    // failing, and a counter that tuts is a counter you stop looking at.
    const s = refillStatus(med(0));
    expect(s).toMatchObject({ doses: 0, daysLeft: 0, empty: true, needsRefill: true });
    expect(s.label).toBe('None left');
    expect(s.label).not.toMatch(/should|forgot|missed|again|!/i);
  });

  it('treats an unset count as empty rather than as unlimited', () => {
    expect(refillStatus(med(null)).empty).toBe(true);
  });

  it('scales days-left by the daily dose', () => {
    const twiceDaily = item({
      tracks_doses: true,
      doses_remaining: 10,
      doses_per_completion: 2,
      refill_warning_days: 3,
    });
    expect(refillStatus(twiceDaily).daysLeft).toBe(5);
  });
});

describe('recentDays', () => {
  it('returns the window oldest-first, ending today', () => {
    expect(recentDays('2026-08-17', 5)).toEqual([
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
      '2026-08-16',
      '2026-08-17',
    ]);
  });

  it('crosses a month boundary correctly', () => {
    expect(recentDays('2026-09-02', 4)).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ]);
  });
});
