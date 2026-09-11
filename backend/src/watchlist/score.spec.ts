import { describe, expect, it } from 'vitest';
import {
  bestCandidate,
  directionFor,
  distanceToTarget,
  firstReachedOn,
  targetReached,
} from './score.js';

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

describe('distanceToTarget', () => {
  /**
   * A FRACTION, matching `unrealizedPct` and `stop-distance.ts`. Returning a
   * percentage here made `formatPercent` — which multiplies by 100 — show a
   * target four cents away as "-1.83% away". Caught by looking at the live
   * page, not by any test, which is why this one is explicit about the unit.
   */
  it('measures how far the price still has to move, as a fraction of it', () => {
    expect(distanceToTarget(100, 120)).toBeCloseTo(0.2);
    expect(distanceToTarget(100, 80)).toBeCloseTo(-0.2);
  });

  it('is a small fraction for a target within pennies, not a whole percent', () => {
    expect(distanceToTarget(218.63, 218.59)).toBeCloseTo(-0.000183, 6);
  });

  it('is zero once the price is exactly there', () => {
    expect(distanceToTarget(120, 120)).toBe(0);
  });

  it('declines to divide by a price it does not have', () => {
    expect(distanceToTarget(null, 120)).toBeNull();
    expect(distanceToTarget(0, 120)).toBeNull();
    expect(distanceToTarget(100, null)).toBeNull();
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
      { symbol: 'NVDA', distanceToTarget: 18 },
      { symbol: 'PLTR', distanceToTarget: -3 },
      { symbol: 'AMD', distanceToTarget: 9 },
    ]);
    expect(best?.symbol).toBe('PLTR');
  });

  it('ignores tickers with no target to measure against', () => {
    const best = bestCandidate([
      { symbol: 'NVDA', distanceToTarget: null },
      { symbol: 'AMD', distanceToTarget: 9 },
    ]);
    expect(best?.symbol).toBe('AMD');
  });

  it('has no opinion when nothing has a target', () => {
    expect(bestCandidate([{ symbol: 'NVDA', distanceToTarget: null }])).toBeNull();
    expect(bestCandidate([])).toBeNull();
  });
});

describe('firstReachedOn', () => {
  const bars = [
    { date: '2026-09-01', high: 105, low: 95 },
    { date: '2026-09-02', high: 118, low: 104 },
    { date: '2026-09-03', high: 112, low: 99 },
  ];

  /**
   * The owner's actual requirement: did it reach the target at ANY point
   * since he set it — not "is it there right now". A stock that touched his
   * level and pulled back has still reached it, and the first version, which
   * only compared the live price, called that a miss.
   */
  it('finds the day an upward target was touched, even intraday', () => {
    expect(firstReachedOn(bars, 115, 'ABOVE')).toBe('2026-09-02');
  });

  it('finds the day a downward target was touched', () => {
    expect(firstReachedOn(bars, 96, 'BELOW')).toBe('2026-09-01');
  });

  it('reports the FIRST crossing, not the latest', () => {
    expect(firstReachedOn(bars, 104, 'ABOVE')).toBe('2026-09-01');
  });

  it('says nothing when the level was never touched', () => {
    expect(firstReachedOn(bars, 130, 'ABOVE')).toBeNull();
    expect(firstReachedOn(bars, 80, 'BELOW')).toBeNull();
  });

  it('ignores bars with no range recorded', () => {
    expect(
      firstReachedOn([{ date: '2026-09-01', high: null, low: null }], 100, 'ABOVE'),
    ).toBeNull();
  });

  it('has nothing to say without a target or a direction', () => {
    expect(firstReachedOn(bars, null, 'ABOVE')).toBeNull();
    expect(firstReachedOn(bars, 100, null)).toBeNull();
  });

  /** A high that exactly equals the target counts — he asked to be told AT it. */
  it('counts a touch exactly on the level', () => {
    expect(firstReachedOn(bars, 118, 'ABOVE')).toBe('2026-09-02');
    expect(firstReachedOn(bars, 95, 'BELOW')).toBe('2026-09-01');
  });
});
