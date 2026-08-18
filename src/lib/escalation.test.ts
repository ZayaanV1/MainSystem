import { describe, it, expect } from 'vitest';
import {
  dueForEscalation,
  escalationKey,
  renderEscalation,
  shouldEscalate,
  type EscalatableEvent,
} from '../../supabase/functions/_shared/escalation';

const TZ = 'America/Toronto';
const TODAY = '2026-09-21'; // a Monday

const ev = (o: Partial<EscalatableEvent> & { id: string }): EscalatableEvent => ({
  title: o.id,
  kind: 'exam',
  starts_at: '2026-09-22T18:00:00.000Z',
  all_day: false,
  location: null,
  ...o,
});

describe('what earns its own notification', () => {
  it('escalates exams and presentations', () => {
    expect(shouldEscalate(ev({ id: 'a', kind: 'exam' }))).toBe(true);
    expect(shouldEscalate(ev({ id: 'b', kind: 'presentation' }))).toBe(true);
  });

  it('does not escalate labs or anything else', () => {
    // If everything escalates, nothing does — the second notification becomes
    // as ignorable as the first, and then so does the digest.
    expect(shouldEscalate(ev({ id: 'c', kind: 'lab' }))).toBe(false);
    expect(shouldEscalate(ev({ id: 'd', kind: 'other' }))).toBe(false);
  });
});

describe('timing — the night before, not the morning of', () => {
  it('picks up something happening tomorrow', () => {
    // 14:00 EDT on 22 Sep.
    const e = ev({ id: 'midterm', starts_at: '2026-09-22T18:00:00.000Z' });
    expect(dueForEscalation([e], TODAY, TZ).map((x) => x.id)).toEqual(['midterm']);
  });

  it('ignores something happening today', () => {
    // A reminder on the morning of an exam is information you already have
    // and can do nothing with.
    const e = ev({ id: 'today', starts_at: '2026-09-21T18:00:00.000Z' });
    expect(dueForEscalation([e], TODAY, TZ)).toEqual([]);
  });

  it('ignores something two days out', () => {
    expect(dueForEscalation([ev({ id: 'later', starts_at: '2026-09-23T18:00:00.000Z' })], TODAY, TZ)).toEqual([]);
  });

  it('uses the local day, not the UTC one', () => {
    // 01:00Z on 23 Sep is 21:00 EDT on the 22nd — tomorrow, locally.
    const e = ev({ id: 'evening', starts_at: '2026-09-23T01:00:00.000Z' });
    expect(dueForEscalation([e], TODAY, TZ).map((x) => x.id)).toEqual(['evening']);
  });

  it('handles an all-day event stored at local midnight', () => {
    const e = ev({ id: 'allday', starts_at: '2026-09-22T04:00:00.000Z', all_day: true });
    expect(dueForEscalation([e], TODAY, TZ).map((x) => x.id)).toEqual(['allday']);
  });

  it('orders several by time', () => {
    const a = ev({ id: 'afternoon', starts_at: '2026-09-22T18:00:00.000Z' });
    const b = ev({ id: 'morning', starts_at: '2026-09-22T13:00:00.000Z' });
    expect(dueForEscalation([a, b], TODAY, TZ).map((x) => x.id)).toEqual(['morning', 'afternoon']);
  });
});

describe('the message', () => {
  it('states the fact and the time, and stops', () => {
    const e = ev({ id: 'x', title: 'MATH 205 midterm', starts_at: '2026-09-22T18:00:00.000Z' });
    const msg = renderEscalation([e], TODAY, TZ);
    expect(msg.title).toBe('Tomorrow');
    expect(msg.body).toBe('MATH 205 midterm — 2:00 p.m.');
  });

  it('includes a location when there is one', () => {
    const e = ev({ id: 'x', title: 'PHYS 205 midterm', location: 'H-110' });
    expect(renderEscalation([e], TODAY, TZ).body).toContain('H-110');
  });

  it('says the time is not set rather than inventing midnight', () => {
    const e = ev({ id: 'x', title: 'Exam', all_day: true, starts_at: '2026-09-22T04:00:00.000Z' });
    expect(renderEscalation([e], TODAY, TZ).body).toBe('Exam — time not set');
  });

  it('names the day when there is more than one', () => {
    const msg = renderEscalation(
      [ev({ id: 'a', title: 'One' }), ev({ id: 'b', title: 'Two' })],
      TODAY,
      TZ,
    );
    expect(msg.title).toContain('Tue, Sep 22');
    expect(msg.body.split('\n')).toHaveLength(2);
  });

  it('does not nudge, ask, or exclaim', () => {
    // The night before an exam is the worst possible moment to be prodded by
    // software with an opinion.
    const msg = renderEscalation([ev({ id: 'x', title: 'Final' })], TODAY, TZ);
    expect(`${msg.title} ${msg.body}`).not.toMatch(
      /ready|don't forget|remember|good luck|you |your |!|prepare/i,
    );
  });
});

describe('idempotency', () => {
  it('keys on the event, so two exams tomorrow each escalate', () => {
    const a = ev({ id: 'a' });
    const b = ev({ id: 'b' });
    expect(escalationKey(a, TODAY)).not.toBe(escalationKey(b, TODAY));
  });

  it('keys on the day too, so a rescheduled exam escalates again', () => {
    const e = ev({ id: 'a' });
    expect(escalationKey(e, '2026-09-21')).not.toBe(escalationKey(e, '2026-10-05'));
  });

  it('is stable for the same event on the same day', () => {
    const e = ev({ id: 'a' });
    expect(escalationKey(e, TODAY)).toBe(escalationKey(e, TODAY));
  });
});
