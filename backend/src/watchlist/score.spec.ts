import { describe, expect, it } from 'vitest';
import { directionFor, distanceToTargetPercent, targetReached, bestCandidate } from './score.js';

describe('directionFor', () => {
  it('reads a target above the price as "tell me when it gets there"', () => {
    expect(directionFor(100, 120)).toBe('ABOVE');
  });
  it('reads a target below the price as "tell me when it comes back down"', () => {
    expect(directionFor(100, 80)).toBe('BELOW');
  });
  /** A target set at today's price is already met; treat it as an upward watch. */
  it('treats a target at the price as ABOVE', () => {
    expect(directionFor(100, 100)).toBe('ABOVE');
  });
});

describe('targetReached', () => {
  it('fires an ABOVE target at or past the level', () => {
    expect(targetReached(120, 120, 'ABOVE')).toBe(true);
    expect(targetReached(121, 120, 'ABOVE')).toBe(true);
    expect(targetReached(119.99, 120, 'ABOVE')).toBe(false);
  });

  it('fires a BELOW target at or under the level', () => {
    expect(targetReached(80, 80, 'BELOW')).toBe(true);
    expect(targetReached(79, 80, 'BELOW')).toBe(true);
    expect(targetReached(80.01, 80, 'BELOW')).toBe(false);
  });

  it('never fires without a price or a target', () => {
    expect(targetReached(null, 120, 'ABOVE')).toBe(false);
    expect(targetReached(120, null, 'ABOVE')).toBe(false);
    expect(targetReached(120, 120, null)).toBe(false);
  });
});

describe('distanceToTargetPercent', () => {
  it('measures how far the price still has to move, as a percentage', () => {
    expect(distanceToTargetPercent(100, 120)).toBeCloseTo(20);
    expect(distanceToTargetPercent(100, 80)).toBeCloseTo(-20);
  });

  it('is zero once the price is exactly there', () => {
    expect(distanceToTargetPercent(120, 120)).toBe(0);
  });

  it('declines to divide by a price it does not have', () => {
    expect(distanceToTargetPercent(null, 120)).toBeNull();
    expect(distanceToTargetPercent(0, 120)).toBeNull();
    expect(distanceToTargetPercent(100, null)).toBeNull();
  });
});

describe('bestCandidate', () => {
  /**
   * "Best" is the one CLOSEST to the level the owner himself set — the only
   * ranking that means the same thing for a target above the price and one
   * below it. An "most upside" ranking would treat a buy-the-dip target as if
   * it were a profit target and rank it backwards.
   */
  it('picks the ticker nearest its own target', () => {
    const best = bestCandidate([
      { symbol: 'NVDA', distancePercent: 18 },
      { symbol: 'PLTR', distancePercent: -3 },
      { symbol: 'AMD', distancePercent: 9 },
    ]);
    expect(best?.symbol).toBe('PLTR');
  });

  it('ignores tickers with no target to measure against', () => {
    const best = bestCandidate([
      { symbol: 'NVDA', distancePercent: null },
      { symbol: 'AMD', distancePercent: 9 },
    ]);
    expect(best?.symbol).toBe('AMD');
  });

  it('has no opinion when nothing has a target', () => {
    expect(bestCandidate([{ symbol: 'NVDA', distancePercent: null }])).toBeNull();
    expect(bestCandidate([])).toBeNull();
  });
});
