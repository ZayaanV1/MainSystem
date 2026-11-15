import { describe, expect, it } from 'vitest';
import { morningDue, morningFallback } from '../../supabase/functions/_shared/morning';

describe('the morning text', () => {
  it('is due in the chosen hour, once a day', () => {
    expect(morningDue(7, 7, null, '2026-11-15')).toBe(true);
    expect(morningDue(7, 7, '2026-11-14', '2026-11-15')).toBe(true);
    expect(morningDue(7, 7, '2026-11-15', '2026-11-15')).toBe(false);
  });
  it('is never due outside its hour or when off', () => {
    expect(morningDue(8, 7, null, '2026-11-15')).toBe(false);
    expect(morningDue(7, null, null, '2026-11-15')).toBe(false);
  });
  it('falls back to the digest rather than sending nothing', () => {
    expect(morningFallback('Due today\n- Lab 3')).toEqual(["morning. here's today", 'Due today\n- Lab 3']);
  });
});
