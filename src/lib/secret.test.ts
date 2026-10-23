import { describe, it, expect } from 'vitest';
import { sameSecret } from '../../supabase/functions/_shared/secret';

describe('sameSecret', () => {
  it('accepts an exact match', () => {
    expect(sameSecret('s3cret-value', 's3cret-value')).toBe(true);
  });

  it('refuses a near miss and a different length', () => {
    expect(sameSecret('s3cret-valuf', 's3cret-value')).toBe(false);
    expect(sameSecret('s3cret', 's3cret-value')).toBe(false);
  });

  it('refuses empty against empty: an unset secret must not open the endpoint', () => {
    expect(sameSecret('', '')).toBe(false);
    expect(sameSecret('anything', '')).toBe(false);
    expect(sameSecret('', 'configured')).toBe(false);
  });
});
