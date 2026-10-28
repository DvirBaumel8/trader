import { describe, expect, it } from 'vitest';
import { movingAverage } from './moving-average.js';

describe('movingAverage', () => {
  it('SMA is the mean of the last N closes', () => {
    expect(movingAverage([1, 2, 3, 4, 5], 3, 'SMA')).toBeCloseTo(4);
  });
  it('returns null with fewer closes than the period', () => {
    expect(movingAverage([1, 2], 3, 'SMA')).toBeNull();
    expect(movingAverage([1, 2], 3, 'EMA')).toBeNull();
  });
  it('EMA seeds with the SMA of the first N, then smooths with k = 2/(N+1)', () => {
    // seed = mean(1,2,3) = 2; k = 0.5; 4 → 3; 5 → 4
    expect(movingAverage([1, 2, 3, 4, 5], 3, 'EMA')).toBeCloseTo(4);
    // seed = mean(10,10) = 10; k = 2/3; 13 → 12
    expect(movingAverage([10, 10, 13], 2, 'EMA')).toBeCloseTo(12);
  });
  it('rejects a non-positive period', () => {
    expect(movingAverage([1, 2, 3], 0, 'SMA')).toBeNull();
  });
});
