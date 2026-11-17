import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, DEFAULT_SKIN, isLook, isSkin } from './theme';

describe('first-run defaults', () => {
  it('a new account starts on Glass in Velvet', () => {
    expect(DEFAULT_LOOK).toBe('glass');
    expect(DEFAULT_SKIN).toBe('velvet');
    expect(isLook(DEFAULT_LOOK)).toBe(true);
    expect(isSkin(DEFAULT_SKIN)).toBe(true);
  });
});
