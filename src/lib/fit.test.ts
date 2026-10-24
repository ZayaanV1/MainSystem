import { describe, it, expect } from 'vitest';
import {
  PUSH_MAX_BODY_BYTES,
  TELEGRAM_MAX_CHARS,
  byteLength,
  clampBytes,
  clampText,
  fitSections,
  type FitSection,
} from '../../supabase/functions/_shared/fit';
import { renderDigest } from '../../supabase/functions/_shared/digest';
import { describeAlert } from '../../supabase/functions/_shared/alerts';

/**
 * The regression: a 4,239-character digest was refused by both channels for a
 * week, so nothing arrived. Every test here is about a long day still getting
 * through, and saying what it left out.
 */

const items = (n: number, label: string) => Array.from({ length: n }, (_, i) => `${label} ${i + 1}, a title of ordinary length — Fri, Oct 23`);

const longDay = (): FitSection[] => [
  { kind: 'overdue', heading: 'Overdue', items: items(6, 'Late work') },
  { kind: 'due', heading: 'Due in the next 7 days', items: items(40, 'Assignment') },
  { kind: 'events', heading: 'Coming up in 14 days', items: items(60, 'Event') },
  { kind: 'today', heading: 'Today', items: ['Take medication', 'Plan tomorrow', 'Review notes'] },
];

describe('fitSections', () => {
  it('leaves a short day exactly as it was', () => {
    const s: FitSection[] = [{ kind: 'due', heading: 'Due soon', items: ['Lab — tomorrow'] }];
    expect(fitSections(s, 1000, 'chars')).toBe('Due soon\n- Lab — tomorrow');
  });

  it('holds a very long day inside the budget, in characters and in bytes', () => {
    expect(fitSections(longDay(), 3000, 'chars').length).toBeLessThanOrEqual(3000);
    expect(byteLength(fitSections(longDay(), PUSH_MAX_BODY_BYTES, 'bytes'))).toBeLessThanOrEqual(PUSH_MAX_BODY_BYTES);
  });

  it('says how many it left out rather than dropping them quietly', () => {
    const out = fitSections(longDay(), 1100, 'bytes');
    expect(out).toMatch(/- and \d+ more/);
  });

  it('keeps today’s checklist whole and cuts events first', () => {
    const out = fitSections(longDay(), 1100, 'bytes');
    expect(out).toContain('Take medication');
    expect(out).toContain('Plan tomorrow');
    expect(out).toContain('Review notes');
    expect(out).toContain('Late work 1');
    // Events shrink before anything else does.
    expect((out.match(/Event \d+/g) ?? []).length).toBeLessThan(5);
  });

  it('keeps at least one item per list', () => {
    const out = fitSections(longDay(), 400, 'bytes');
    for (const h of ['Overdue', 'Due in the next 7 days', 'Coming up in 14 days', 'Today']) expect(out).toContain(h);
  });
});

describe('clampText', () => {
  it('leaves short text alone', () => {
    expect(clampText('one\ntwo', 100, 'chars')).toBe('one\ntwo');
  });

  it('cuts at a line break and counts what it omitted', () => {
    const text = Array.from({ length: 50 }, (_, i) => `line number ${i}`).join('\n');
    const out = clampText(text, 200, 'chars');
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out).toMatch(/and \d+ more in the app$/);
    expect(out.startsWith('line number 0\nline number 1')).toBe(true);
  });

  it('never splits a multi-byte character', () => {
    const text = '日本語のタイトル '.repeat(200);
    const out = clampText(text, 120, 'bytes');
    expect(byteLength(out)).toBeLessThanOrEqual(120);
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(out))).not.toThrow();
  });

  it('cuts inside a single over-long line as a last resort', () => {
    const out = clampText('x'.repeat(5000), 100, 'chars');
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('clampBytes', () => {
  it('keeps short strings and trims long ones on a character', () => {
    expect(clampBytes('ok', 10)).toBe('ok');
    const out = clampBytes('é'.repeat(100), 20);
    expect(byteLength(out)).toBeLessThanOrEqual(20);
  });
});

describe('the digest that failed in production', () => {
  // 24 open assignments, 40 events: the shape of the 21 Oct digest.
  const sections = [
    { kind: 'overdue' as const, heading: 'Overdue', items: items(8, 'Late') },
    { kind: 'due' as const, heading: 'Due in the next 7 days', items: items(24, 'Assignment') },
    { kind: 'events' as const, heading: 'Coming up in 14 days', items: items(40, 'Lecture') },
    { kind: 'today' as const, heading: 'Today', items: ['Take medication'] },
  ];

  it('fits Telegram in full and push in short, and keeps the facts that matter', () => {
    const msg = renderDigest('2026-10-21', sections, 'America/Toronto', 'https://planner.example/');
    expect(msg.body.length).toBeLessThanOrEqual(3000);
    expect(msg.body.length).toBeLessThan(TELEGRAM_MAX_CHARS);
    expect(msg.short).toBeDefined();
    expect(byteLength(msg.short as string)).toBeLessThanOrEqual(PUSH_MAX_BODY_BYTES);
    expect(msg.short).toContain('Take medication');
    expect(msg.short).toContain('Late 1');
  });

  it('adds no short form when the whole digest already fits', () => {
    const msg = renderDigest('2026-10-21', [{ kind: 'due', heading: 'Due', items: ['One'] }], 'America/Toronto');
    expect(msg.short).toBeUndefined();
  });
});

describe('alerts', () => {
  it('describe an account by a short id and carry no titles', () => {
    const text = describeAlert({ kind: 'digest-failing', userId: '123e4567-e89b-12d3-a456-426614174000', detail: '6 attempts failed.' });
    expect(text).toContain('123e4567');
    expect(text).not.toContain('e89b-12d3');
    expect(text).toMatch(/failing to deliver/);
  });
});
