import { describe, it, expect } from 'vitest';
import { isIos } from './install';

describe('isIos', () => {
  it('knows an iPhone, and an iPad that says it is a Mac', () => {
    expect(isIos({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)', maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5, platform: 'MacIntel' })).toBe(true);
  });

  it('is not fooled by a Mac or an Android phone', () => {
    expect(isIos({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0, platform: 'MacIntel' })).toBe(false);
    expect(isIos({ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)', maxTouchPoints: 5, platform: 'Linux armv8l' })).toBe(false);
  });
});
