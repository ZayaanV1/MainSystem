import { describe, it, expect } from 'vitest';
import { factorFrom, isKept, plan, BUFFER, type PlanInput, type PlanWork } from '../../supabase/functions/_shared/autoplan';
import { localDayKey, localHourMinute, wallClockToUTC } from '../../supabase/functions/_shared/time';

const TZ = 'America/Toronto';
const MIN = 60_000;
const at = (day: string, h: number, m = 0) => wallClockToUTC(day, h, m, 0, TZ);

function input(over: Partial<PlanInput>): PlanInput {
  return {
    now: at('2026-11-09', 8), // a Monday
    tz: TZ,
    work: [],
    busy: [],
    blocks: [],
    studyHours: null,
    offDays: [],
    dayCap: 240,
    factor: 1,
    ...over,
  };
}

const work = (id: string, dueDay: string, minutes: number | null, extra: Partial<PlanWork> = {}): PlanWork => ({
  id,
  title: id,
  due_at: at(dueDay, 23, 59).toISOString(),
  effort_minutes: minutes,
  status: 'todo',
  ...extra,
});

describe('plan', () => {
  it('never places a block on top of a timed event, buffer included', () => {
    // A dense, irregular week of classes.
    const busy = [];
    for (let d = 9; d <= 20; d++) {
      const day = `2026-11-${String(d).padStart(2, '0')}`;
      for (const [h, len] of [[9, 80], [11, 50], [13, 110], [16, 75], [19, 45]] as const) {
        const start = at(day, h, (d * 7) % 30).getTime();
        busy.push({ start, end: start + len * MIN });
      }
    }
    const r = plan(input({ busy, work: [work('a', '2026-11-13', 600), work('b', '2026-11-19', 400), work('c', '2026-11-11', 120)] }));
    expect(r.placed.length).toBeGreaterThan(0);
    for (const p of r.placed) {
      const s = Date.parse(p.starts_at);
      const e = s + p.minutes * MIN;
      for (const b of busy) expect(e + BUFFER * MIN <= b.start || s - BUFFER * MIN >= b.end).toBe(true);
    }
    // ...nor on top of each other.
    const spans = r.placed.map((p) => [Date.parse(p.starts_at), Date.parse(p.starts_at) + p.minutes * MIN]).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1]);
  });

  it('ends every block before the work is due, and inside study hours', () => {
    const r = plan(input({ work: [{ ...work('lab', '2026-11-10', 300), due_at: at('2026-11-10', 14).toISOString() }] }));
    for (const p of r.placed) {
      const end = Date.parse(p.starts_at) + p.minutes * MIN;
      expect(end).toBeLessThanOrEqual(at('2026-11-10', 14).getTime());
      const { hour } = localHourMinute(new Date(p.starts_at), TZ);
      expect(hour).toBeGreaterThanOrEqual(9);
    }
  });

  it('puts the work with least room to spare first, not the soonest due', () => {
    // Two free evenings only. The quiz is due first but fits anywhere; the essay needs both evenings.
    const studyHours = { '1': [19 * 60, 20 * 60 + 30], '2': [19 * 60, 20 * 60 + 30], '3': [19 * 60, 20 * 60 + 30] } as Record<string, [number, number]>;
    const r = plan(
      input({
        studyHours,
        work: [work('quiz', '2026-11-11', 20), work('essay', '2026-11-11', 180)],
      }),
    );
    const essay = r.placed.filter((p) => p.assignment_id === 'essay').reduce((s, p) => s + p.minutes, 0);
    expect(essay).toBe(180);
    expect(r.atRisk.find((x) => x.assignment_id === 'essay')).toBeUndefined();
  });

  it('puts Up next ahead of everything', () => {
    const r = plan(input({ work: [work('later', '2026-11-10', 60), work('next', '2026-11-20', 60, { up_next: true })] }));
    expect(r.placed[0].assignment_id).toBe('next');
    expect(r.placed[0].reason).toContain('you put it next');
  });

  it('spreads work one block a day while there is time', () => {
    const r = plan(input({ work: [work('essay', '2026-11-16', 300)] }));
    const days = r.placed.map((p) => localDayKey(new Date(p.starts_at), TZ));
    expect(new Set(days).size).toBe(days.length);
    expect(r.placed.every((p) => p.minutes <= 90)).toBe(true);
  });

  it('doubles up on a day only when one a day would miss the deadline', () => {
    const r = plan(input({ work: [work('cram', '2026-11-09', 180)] }));
    expect(r.placed.reduce((s, p) => s + p.minutes, 0)).toBe(180);
    expect(r.atRisk).toHaveLength(0);
  });

  it('says how short it is when the work cannot fit, in minutes', () => {
    const r = plan(input({ dayCap: 60, work: [work('big', '2026-11-10', 400)] }));
    expect(r.atRisk[0]).toMatchObject({ assignment_id: 'big', short: 400 - 120 });
  });

  it('places nothing for unsized work, and counts it', () => {
    const r = plan(input({ work: [work('vague', '2026-11-12', null)] }));
    expect(r.placed).toHaveLength(0);
    expect(r.unsized).toBe(1);
  });

  it('respects days off and weekdays without study hours', () => {
    const studyHours = { '2': [9 * 60, 12 * 60] } as Record<string, [number, number]>; // Tuesdays only
    const r = plan(input({ studyHours, offDays: ['2026-11-10'], work: [work('w', '2026-11-20', 60)] }));
    for (const p of r.placed) expect(localDayKey(new Date(p.starts_at), TZ)).toBe('2026-11-17');
  });

  it('honours start after', () => {
    const r = plan(input({ work: [work('w', '2026-11-20', 60, { start_after: '2026-11-16' })] }));
    expect(localDayKey(new Date(r.placed[0].starts_at), TZ) >= '2026-11-16').toBe(true);
  });

  it('counts done and kept blocks as progress and plans only the rest', () => {
    const blocks = [
      { id: 'd', assignment_id: 'w', starts_at: at('2026-11-08', 10).toISOString(), minutes: 60, state: 'done' as const, pinned: false, done_minutes: 45 },
      { id: 'p', assignment_id: 'w', starts_at: at('2026-11-12', 10).toISOString(), minutes: 60, state: 'planned' as const, pinned: true, done_minutes: null },
    ];
    const r = plan(input({ blocks, work: [work('w', '2026-11-20', 180)] }));
    expect(r.placed.reduce((s, p) => s + p.minutes, 0)).toBe(180 - 45 - 60);
    // And nothing lands on the pinned block.
    for (const p of r.placed) expect(localDayKey(new Date(p.starts_at), TZ) === '2026-11-12' && localHourMinute(new Date(p.starts_at), TZ).hour === 10).toBe(false);
  });

  it('applies how long work really takes', () => {
    const r = plan(input({ factor: 1.5, work: [work('w', '2026-11-20', 60)] }));
    expect(r.placed.reduce((s, p) => s + p.minutes, 0)).toBe(90);
  });

  it('keeps study hours in local time across the clock change', () => {
    // Toronto falls back on Sun 1 Nov 2026.
    const r = plan(input({ now: at('2026-10-30', 7), dayCap: 600, work: [work('a', '2026-11-04', 900), work('b', '2026-11-04', 900)] }));
    const days = new Set(r.placed.map((p) => localDayKey(new Date(p.starts_at), TZ)));
    expect(days.has('2026-11-01')).toBe(true);
    for (const p of r.placed) {
      const { hour, minute } = localHourMinute(new Date(p.starts_at), TZ);
      expect(hour * 60 + minute).toBeGreaterThanOrEqual(9 * 60);
      const end = localHourMinute(new Date(Date.parse(p.starts_at) + p.minutes * MIN), TZ);
      expect(end.hour * 60 + end.minute).toBeLessThanOrEqual(21 * 60);
    }
  });
});

describe('isKept', () => {
  const now = at('2026-11-09', 12);
  const b = (h: number, pinned = false) => ({ id: 'x', assignment_id: 'w', starts_at: at('2026-11-09', h).toISOString(), minutes: 90, state: 'planned' as const, pinned, done_minutes: null });
  it('locks blocks under way and starting within two hours, and pinned ones', () => {
    expect(isKept(b(11, false), now)).toBe(true);
    expect(isKept(b(13, false), now)).toBe(true);
    expect(isKept(b(15, false), now)).toBe(false);
    expect(isKept(b(15, true), now)).toBe(true);
  });
});

describe('factorFrom', () => {
  it('is 1 below five samples, the median above, and bounded', () => {
    expect(factorFrom([{ effort_minutes: 60, actual_minutes: 120 }])).toBe(1);
    const five = [1, 1.2, 1.5, 3, 10].map((r) => ({ effort_minutes: 60, actual_minutes: 60 * r }));
    expect(factorFrom(five)).toBe(1.5);
    expect(factorFrom(five.map((p) => ({ ...p, actual_minutes: p.actual_minutes * 10 })))).toBe(2.5);
  });
});
