import { describe, expect, it } from 'vitest';
import { frameStats } from './frames';

describe('frameStats', () => {
  it('reports the median and the 99th percentile', () => {
    const intervals = [...Array(99).fill(8.3), 50];
    expect(frameStats(intervals)).toEqual({ frames: 100, median: 8.3, worst: 50 });
  });
  it('has nothing to say about no frames', () => {
    expect(frameStats([])).toBeNull();
  });
});
