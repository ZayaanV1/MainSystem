import { describe, it, expect } from 'vitest';
import { chooseWork, essentialsFor } from '../../supabase/functions/_shared/lowbattery';
import type { ChecklistItem } from './checklist';

const item = (id: string, essential: boolean): ChecklistItem => ({
  id,
  title: id,
  recurrence: 'daily',
  weekdays: null,
  interval_days: null,
  anchor_day: null,
  active: true,
  sort_order: 0,
  essential,
  remind_at: null,
  tracks_doses: false,
  doses_remaining: null,
  doses_per_completion: 1,
  refill_warning_days: 3,
});

interface Work {
  id: string;
  status: string;
  due_at: string | null;
  effort_minutes: number | null;
}

const work = (id: string, o: Partial<Work> = {}): Work => ({
  id,
  status: 'todo',
  due_at: null,
  effort_minutes: null,
  ...o,
});

const at = (day: string) => `${day}T16:00:00.000Z`;

// Before every date the tests below use, so all of that work is still ahead.
const NOW = new Date('2026-08-18T12:00:00.000Z');

describe('what survives', () => {
  it('keeps only what was marked non-negotiable', () => {
    const items = [item('meds', true), item('creatine', true), item('gym', false)];
    expect(essentialsFor(items, [], NOW).items.map((i) => i.id)).toEqual(['meds', 'creatine']);
  });

  it('keeps nothing when nothing is marked', () => {
    // Not a bug: an unconfigured low-battery mode showing everything would
    // defeat the point entirely, so it shows nothing and says so.
    expect(essentialsFor([item('a', false)], [], NOW).items).toEqual([]);
  });

  it('offers exactly one piece of work, never a list', () => {
    // Choosing between five things is itself the task you cannot face today.
    const w = [work('a', { due_at: at('2026-08-20') }), work('b', { due_at: at('2026-08-21') })];
    expect(essentialsFor([], w, NOW).work?.id).toBe('a');
  });

  it('offers nothing when there is no work', () => {
    expect(essentialsFor([], [], NOW).work).toBeNull();
  });

  it('counts what it hid, without naming it', () => {
    const items = [item('meds', true), item('gym', false), item('read', false)];
    const w = [work('a'), work('b'), work('c')];
    // Two items hidden, two of three pieces of work hidden.
    expect(essentialsFor(items, w, NOW).hiddenCount).toBe(4);
  });
});

describe('choosing the one task', () => {
  it('prefers something small over something soon', () => {
    // On a bad day the win that matters is finishing anything at all. A
    // 20-minute task finished beats a 3-hour task started.
    const w = [
      work('big', { due_at: at('2026-08-19'), effort_minutes: 180 }),
      work('small', { due_at: at('2026-08-25'), effort_minutes: 20 }),
    ];
    expect(chooseWork(w, NOW)?.id).toBe('small');
  });

  it('picks the soonest among small ones', () => {
    const w = [
      work('later', { due_at: at('2026-08-25'), effort_minutes: 15 }),
      work('sooner', { due_at: at('2026-08-20'), effort_minutes: 25 }),
    ];
    expect(chooseWork(w, NOW)?.id).toBe('sooner');
  });

  it('falls back to the most urgent when nothing is small', () => {
    const w = [
      work('a', { due_at: at('2026-08-25'), effort_minutes: 120 }),
      work('b', { due_at: at('2026-08-19'), effort_minutes: 90 }),
    ];
    expect(chooseWork(w, NOW)?.id).toBe('b');
  });

  it('does not offer the thing that has been avoided longest', () => {
    // The most overdue item is usually the one avoided the longest, and it is
    // avoided for a reason. Handing it over as today's single task on the
    // worst day of the month is how this feature would backfire.
    const w = [
      work('dreaded', { due_at: at('2026-07-01'), effort_minutes: 240 }),
      work('quick', { due_at: at('2026-08-30'), effort_minutes: 15 }),
    ];
    expect(chooseWork(w, NOW)?.id).toBe('quick');
  });

  it('does not fall back to the most overdue thing when nothing is small', () => {
    // Found by the end-to-end suite on the sample account: with no task under
    // half an hour, the fallback sorted by due date, oldest first, and handed
    // over the overdue lab report instead of the 45-minute set due today.
    const now = new Date('2026-10-14T14:00:00.000Z');
    const w = [
      work('late lab report', { due_at: '2026-10-14T03:59:00.000Z', effort_minutes: 120 }),
      work('set due today', { due_at: '2026-10-14T19:00:00.000Z', effort_minutes: 45 }),
      work('problem set tonight', { due_at: '2026-10-15T03:59:00.000Z', effort_minutes: 90 }),
    ];
    expect(chooseWork(w, now)?.id).toBe('set due today');
  });

  it('prefers anything still ahead over anything overdue', () => {
    const w = [
      work('small but late', { due_at: at('2026-08-10'), effort_minutes: 10 }),
      work('big but ahead', { due_at: at('2026-08-30'), effort_minutes: 240 }),
    ];
    expect(chooseWork(w, NOW)?.id).toBe('big but ahead');
  });

  it('when everything is overdue, offers the least overdue, small first', () => {
    const w = [
      work('oldest', { due_at: at('2026-07-01'), effort_minutes: 20 }),
      work('recent big', { due_at: at('2026-08-16'), effort_minutes: 180 }),
      work('recent small', { due_at: at('2026-08-15'), effort_minutes: 20 }),
    ];
    expect(chooseWork(w, NOW)?.id).toBe('recent small');
  });

  it('sorts undated work after dated work rather than first', () => {
    const w = [work('undated', { effort_minutes: 10 }), work('dated', { due_at: at('2026-08-20'), effort_minutes: 10 })];
    expect(chooseWork(w, NOW)?.id).toBe('dated');
  });

  it('ignores finished work', () => {
    const w = [work('done', { status: 'done', effort_minutes: 5 }), work('open', { effort_minutes: 90 })];
    expect(chooseWork(w, NOW)?.id).toBe('open');
  });

  it('treats an unestimated task as ordinary rather than tiny', () => {
    // Assuming no estimate means "small" would surface arbitrary work as the
    // one thing to do today.
    const w = [
      work('unknown', { due_at: at('2026-08-19') }),
      work('known small', { due_at: at('2026-08-22'), effort_minutes: 10 }),
    ];
    expect(chooseWork(w, NOW)?.id).toBe('known small');
  });
});

describe('low-battery mode never creates a debt', () => {
  it('reports nothing about what was hidden beyond how much', () => {
    const result = essentialsFor([item('a', false)], [work('x')], NOW);
    const keys = Object.keys(result).join(' ');
    expect(keys).not.toMatch(/skipped|missed|deferred|overdue|failed/i);
  });
});
