import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { describeHealth, sentence } from './health';
import { setActiveTimezone } from './time';

const base = { lastChannel: 'webpush', failuresSince: 0, stale: false, noChannel: false };

describe('sentence', () => {
  it('adds a full stop to a sentence without one', () => {
    expect(sentence('Last notification Mon, Oct 5')).toBe('Last notification Mon, Oct 5.');
  });

  it('never doubles the one a time already ends in', () => {
    expect(sentence('Last notification today 7:00 a.m.')).toBe('Last notification today 7:00 a.m.');
  });
});

describe('describeHealth', () => {
  it('ends a morning delivery with a single full stop', () => {
    setActiveTimezone('America/Toronto');
    const morning = new Date();
    morning.setUTCHours(11, 0, 0, 0); // 7:00 a.m. in Toronto during EDT, 6:00 in EST
    const { text } = describeHealth({ ...base, lastDeliveredAt: morning });
    expect(text).toMatch(/m\.$/);
    expect(text).not.toMatch(/\.\.$/);
  });

  it('keeps the failure count after the closed sentence', () => {
    setActiveTimezone('America/Toronto');
    const at = new Date('2026-10-04T11:00:00Z');
    const { text } = describeHealth({ ...base, lastDeliveredAt: at, failuresSince: 2 });
    expect(text).not.toContain('..');
    expect(text.endsWith(' 2 failed since.')).toBe(true);
  });
});
