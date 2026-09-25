import { describe, expect, it } from 'vitest';
import { computeDayChange, sumNullable } from './day-change.js';

describe('computeDayChange', () => {
  it('measures a long position from the previous regular close', () => {
    const r = computeDayChange(102, 100, 10);
    expect(r.dayChange).toBeCloseTo(2);
    expect(r.dayChangePct).toBeCloseTo(0.02); // a FRACTION, like unrealizedPct
    expect(r.dayPnl).toBeCloseTo(20);
  });

  /** A short loses when the price rises: the signed quantity carries that. */
  it('makes a rising price a loss for a short', () => {
    const r = computeDayChange(102, 100, -10);
    expect(r.dayChange).toBeCloseTo(2); // per-share move is the market's, not the position's
    expect(r.dayChangePct).toBeCloseTo(0.02);
    expect(r.dayPnl).toBeCloseTo(-20);
  });

  /**
   * An extended-hours price is still the selected price (Handy Trader
   * behavior): the move keeps counting after the close, not frozen at it.
   */
  it('uses whatever price it is given, including an after-hours print', () => {
    expect(computeDayChange(95, 100, 1).dayChange).toBeCloseTo(-5);
  });

  it('is all null without a price or a previous close, never zero', () => {
    const none = { dayChange: null, dayChangePct: null, dayPnl: null };
    expect(computeDayChange(null, 100, 10)).toEqual(none);
    expect(computeDayChange(100, null, 10)).toEqual(none);
  });

  it('is all null rather than dividing by zero when the previous close is zero', () => {
    expect(computeDayChange(100, 0, 10)).toEqual({
      dayChange: null,
      dayChangePct: null,
      dayPnl: null,
    });
  });
});

describe('sumNullable', () => {
  it('sums the priced members and skips nulls', () => {
    expect(sumNullable([1, null, 2.5])).toBeCloseTo(3.5);
  });

  /** "Nothing could be priced" must not read as "$0.00 moved". */
  it('is null when every member is null, or there are none', () => {
    expect(sumNullable([null, null])).toBeNull();
    expect(sumNullable([])).toBeNull();
  });
});
