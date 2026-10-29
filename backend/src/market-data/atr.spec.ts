import { describe, expect, it } from 'vitest';
import { wilderAtr } from './atr.js';

/** Flat close of 100; bar i has high 100 + i and low 100, so TR_i = i (no gap). */
function rampBars(count: number) {
  const bars: { high: number | null; low: number | null; close: number }[] = [{ high: 100, low: 100, close: 100 }];
  for (let i = 1; i < count; i++) bars.push({ high: 100 + i, low: 100, close: 100 });
  return bars;
}

describe('wilderAtr', () => {
  it('seeds with the simple mean of the first 14 true ranges (15 bars)', () => {
    // TR_1..TR_14 = 1..14, mean = (14 * 15 / 2) / 14 = 7.5
    expect(wilderAtr(rampBars(15))).toBe(7.5);
  });

  it('smooths later bars the Wilder way (20 bars)', () => {
    // Bars 15..19 each have TR = 14. ATR_n = (ATR_{n-1} * 13 + 14) / 14, which
    // converges on 14 as A_n = 14 - (14 - 7.5) * (13/14)^(n-14):
    //   A15 = (7.5*13 + 14)/14 = 7.9642857
    //   A16 = 8.3954082, A17 = 8.7957362, A18 = 9.1674700, A19 = 9.51265
    const bars = rampBars(15);
    for (let i = 15; i < 20; i++) bars.push({ high: 114, low: 100, close: 100 });
    const atr = wilderAtr(bars)!;
    expect(atr).toBeCloseTo(9.51265, 4);
    expect(atr).toBeCloseTo(14 - 6.5 * (13 / 14) ** 5, 9);
  });

  it('counts a gap against the previous close', () => {
    // 14 bars with TR 2 (range 99..101 around close 100), except the last: it
    // gaps to 108..110 (own range 2) but |high - prevClose| = 10, so TR = 10.
    // ATR = (13 * 2 + 10) / 14 = 36 / 14
    const bars = [{ high: 101, low: 99, close: 100 }];
    for (let i = 1; i < 14; i++) bars.push({ high: 101, low: 99, close: 100 });
    bars.push({ high: 110, low: 108, close: 109 });
    expect(wilderAtr(bars)).toBeCloseTo(36 / 14, 9);
  });

  it('needs period + 1 bars', () => {
    expect(wilderAtr(rampBars(14))).toBeNull();
    expect(wilderAtr([])).toBeNull();
  });

  it('is null when a bar lacks its high or low', () => {
    const bars = rampBars(16);
    bars[10] = { high: null, low: 100, close: 100 };
    expect(wilderAtr(bars)).toBeNull();
  });

  it('honours a custom period', () => {
    // period 3, TRs 1,2,3 -> mean 2
    expect(wilderAtr(rampBars(4), 3)).toBe(2);
  });
});
