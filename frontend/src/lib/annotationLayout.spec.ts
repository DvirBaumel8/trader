import { describe, expect, it } from 'vitest';
import { placeAnnotations, paddedRange, type LayoutBar } from './annotationLayout';

/** A flat wall of identical candles, so any placement difference is the algorithm's. */
const flat = (n: number, low = 100, high = 110): LayoutBar[] =>
  Array.from({ length: n }, () => ({ low, high }));

const opts = { windowBars: 3, labelBars: 4, gapFraction: 0.04, labelHeightFraction: 0.1 };

describe('placeAnnotations', () => {
  it('hangs the label clear of the tallest candle in its area, not just its own', () => {
    const bars = flat(21);
    // One spike three bars to the right of the anchor — inside the window,
    // so it must be cleared even though the anchor's own candle is short.
    bars[13] = { low: 100, high: 160 };

    const [p] = placeAnnotations(bars, [{ index: 10, price: 105 }], opts);

    expect(p.side).toBe('above');
    expect(p.labelPrice).toBeGreaterThan(160);
  });

  it('ignores candles outside the area it was told to consider', () => {
    const bars = flat(41);
    bars[30] = { low: 100, high: 300 }; // far away — irrelevant
    const [p] = placeAnnotations(bars, [{ index: 10, price: 105 }], opts);
    expect(p.labelPrice).toBeLessThan(300);
  });

  it('drops below when there is more room under the candles than over them', () => {
    // Anchor sits in a window pinned to the top of the chart's range.
    const bars = flat(21, 100, 110);
    for (let i = 7; i <= 13; i++) bars[i] = { low: 190, high: 200 };
    const [p] = placeAnnotations(bars, [{ index: 10, price: 195 }], opts);
    expect(p.side).toBe('below');
    expect(p.labelPrice).toBeLessThan(190);
  });

  /** Step 4: never let a label hang off the left or right edge. */
  it('pulls a label at the left edge inward so the box stays on the plot', () => {
    const bars = flat(21);
    const [p] = placeAnnotations(bars, [{ index: 0, price: 105 }], opts);
    expect(p.index).toBe(0); // still points at the right bar
    expect(p.labelIndex).toBeGreaterThanOrEqual(opts.labelBars);
  });

  it('pulls a label at the right edge inward too', () => {
    const bars = flat(21);
    const [p] = placeAnnotations(bars, [{ index: 20, price: 105 }], opts);
    expect(p.index).toBe(20);
    expect(p.labelIndex).toBeLessThanOrEqual(20 - opts.labelBars);
  });

  it('still points at the price it was given, whatever it does with the box', () => {
    const bars = flat(21);
    const [p] = placeAnnotations(bars, [{ index: 10, price: 105.5 }], opts);
    expect(p.price).toBe(105.5);
    expect(p.index).toBe(10);
  });

  /**
   * Two annotations close together used to be the failure: entry and exit a
   * couple of bars apart both chose the same side and drew on top of each
   * other.
   */
  it('keeps two nearby labels from overlapping each other', () => {
    const bars = flat(21);
    const [a, b] = placeAnnotations(
      bars,
      [
        { index: 9, price: 105 },
        { index: 11, price: 106 },
      ],
      opts,
    );
    const near = Math.abs(a.labelIndex - b.labelIndex) < 2 * opts.labelBars;
    const sameSide = a.side === b.side;
    const bandsOverlap =
      Math.abs(a.labelPrice - b.labelPrice) <
      opts.labelHeightFraction * (110 - 100);
    expect(near && sameSide && bandsOverlap).toBe(false);
  });

  it('has nothing to place when there are no bars', () => {
    expect(placeAnnotations([], [{ index: 0, price: 1 }], opts)).toEqual([]);
  });

  it('survives bars with no high or low recorded', () => {
    const bars: LayoutBar[] = [
      { low: null, high: null },
      { low: 100, high: 110 },
      { low: null, high: null },
    ];
    const [p] = placeAnnotations(bars, [{ index: 1, price: 105 }], opts);
    expect(Number.isFinite(p.labelPrice)).toBe(true);
  });
});

describe('paddedRange', () => {
  /** Step 4: show some time before the entry and after the sell. */
  it('leaves breathing room on both sides of the action', () => {
    const r = paddedRange(60, [10, 20], 8);
    expect(r.from).toBe(2);
    expect(r.to).toBe(28);
  });

  it('clamps to the data it actually has', () => {
    const r = paddedRange(20, [1, 18], 8);
    expect(r.from).toBe(0);
    expect(r.to).toBe(19);
  });

  it('falls back to the whole window when nothing is annotated', () => {
    expect(paddedRange(30, [], 8)).toEqual({ from: 0, to: 29 });
  });
});
