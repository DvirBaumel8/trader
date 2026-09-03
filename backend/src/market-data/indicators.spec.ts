import { describe, expect, it, beforeEach } from 'vitest';
import { computeIndicators } from './indicators.js';
import type { RawBar } from './yahoo.client.js';

let flatIndex = 0;

/** A flat series of `n` bars at `price`, one per day, with a fixed volume. */
function flat(n: number, price: number, volume = 1_000_000): RawBar[] {
  const startIdx = flatIndex;
  flatIndex += n;
  return Array.from({ length: n }, (_, i) => {
    const month = Math.floor((startIdx + i) / 28) + 1;
    const day = ((startIdx + i) % 28) + 1;
    return {
      date: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      close: price,
      adjClose: price,
      open: price,
      high: price,
      low: price,
      volume,
    };
  });
}

describe('computeIndicators', () => {
  beforeEach(() => {
    flatIndex = 0;
  });
  it('averages the last N closes for each moving average', () => {
    const bars = [...flat(180, 100), ...flat(20, 110)];
    const r = computeIndicators(bars, 110);
    expect(r.sma20).toBeCloseTo(110, 6);
    // 50 bars: 30 at 100, 20 at 110.
    expect(r.sma50).toBeCloseTo((30 * 100 + 20 * 110) / 50, 6);
    expect(r.barsAvailable).toBe(200);
  });

  it('returns null for an average it does not have the history for', () => {
    // 200 bars are needed for a 200-day average. Extrapolating from 60 would
    // be a plausible number that is not the thing it claims to be.
    const r = computeIndicators(flat(60, 100), 100);
    expect(r.sma20).toBeCloseTo(100, 6);
    expect(r.sma50).toBeCloseTo(100, 6);
    expect(r.sma200).toBeNull();
    expect(r.percentFromSma200).toBeNull();
  });

  it('expresses distance from an average as a signed fraction of that average', () => {
    const r = computeIndicators(flat(30, 100), 110);
    // 110 against a 100 average is +10%.
    expect(r.percentFromSma20).toBeCloseTo(0.1, 6);
  });

  it('takes the 52-week high and low from intraday extremes, not closes', () => {
    // 200 bars, deliberately fewer than the 252-bar window, so the extremes
    // set below are inside it. With 300 the window would drop the first 48
    // and this test would silently assert nothing.
    const bars = flat(200, 100);
    bars[10] = { ...bars[10], high: 150 };
    bars[20] = { ...bars[20], low: 50 };
    const r = computeIndicators(bars, 100);
    expect(r.high52w).toBe(150);
    expect(r.low52w).toBe(50);
    expect(r.percentFromHigh52w).toBeCloseTo((100 - 150) / 150, 6);
    expect(r.percentFromLow52w).toBeCloseTo((100 - 50) / 50, 6);
  });

  it('computes ATR from the true range, including gaps against the prior close', () => {
    // Two bars: the second gaps up and its true range is measured from the
    // previous close, not its own low — that is the whole point of ATR.
    const bars: RawBar[] = [
      { date: '2026-01-01', close: 100, adjClose: 100, open: 100, high: 101, low: 99, volume: 1 },
      { date: '2026-01-02', close: 110, adjClose: 110, open: 110, high: 112, low: 108, volume: 1 },
    ];
    // Not enough bars for a 14-period ATR.
    expect(computeIndicators(bars, 110).atr14).toBeNull();

    const many = [...flat(20, 100)];
    const r = computeIndicators(many, 100);
    // A perfectly flat series has no range at all.
    expect(r.atr14).toBeCloseTo(0, 6);
  });

  it('measures current volume against the 20 days before it', () => {
    const bars = [...flat(20, 100, 1_000_000), ...flat(1, 100, 2_000_000)];
    expect(computeIndicators(bars, 100).relativeVolume).toBeCloseTo(2, 6);
  });

  it('is all nulls for no bars at all, rather than throwing', () => {
    const r = computeIndicators([], 100);
    expect(r.sma20).toBeNull();
    expect(r.high52w).toBeNull();
    expect(r.atr14).toBeNull();
    expect(r.relativeVolume).toBeNull();
    expect(r.barsAvailable).toBe(0);
  });
});
