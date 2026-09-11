import { describe, expect, it } from 'vitest';
import {
  paddedRange,
  placeAnnotations,
  resolveOverlaps,
  type LayoutBar,
} from './annotationLayout';

const flat = (n: number, low = 100, high = 110): LayoutBar[] =>
  Array.from({ length: n }, () => ({ low, high }));

const opts = { windowBars: 3, labelBars: 4 };

describe('placeAnnotations', () => {
  /**
   * The bug that made the first version invisible: it returned a price ABOVE
   * the highest high, which is outside the chart's auto-scaled range, so
   * priceToCoordinate returned null and every callout was dropped. What comes
   * back must be a price the chart can actually place.
   */
  it('clears a price that is really on the chart, never one beyond it', () => {
    const bars = flat(21);
    const [p] = placeAnnotations(bars, [{ index: 10, price: 105 }], opts);
    expect(p.clearancePrice).toBeLessThanOrEqual(110);
    expect(p.clearancePrice).toBeGreaterThanOrEqual(100);
  });

  it('clears the tallest candle in its area, not just its own', () => {
    const bars = flat(21);
    bars[13] = { low: 100, high: 160 }; // inside the window
    const [p] = placeAnnotations(bars, [{ index: 10, price: 105 }], opts);
    expect(p.side).toBe('above');
    expect(p.clearancePrice).toBe(160);
  });

  it('ignores candles outside the area it was told to consider', () => {
    const bars = flat(41);
    bars[30] = { low: 100, high: 300 };
    const [p] = placeAnnotations(bars, [{ index: 10, price: 105 }], opts);
    expect(p.clearancePrice).toBe(110);
  });

  it('drops below when there is more room under the candles than over them', () => {
    const bars = flat(21, 100, 110);
    for (let i = 7; i <= 13; i++) bars[i] = { low: 190, high: 200 };
    const [p] = placeAnnotations(bars, [{ index: 10, price: 195 }], opts);
    expect(p.side).toBe('below');
    expect(p.clearancePrice).toBe(190);
  });

  it('pulls a label at the left edge inward so the box stays on the plot', () => {
    const [p] = placeAnnotations(flat(21), [{ index: 0, price: 105 }], opts);
    expect(p.index).toBe(0);
    expect(p.labelIndex).toBeGreaterThanOrEqual(opts.labelBars);
  });

  it('pulls a label at the right edge inward too', () => {
    const [p] = placeAnnotations(flat(21), [{ index: 20, price: 105 }], opts);
    expect(p.index).toBe(20);
    expect(p.labelIndex).toBeLessThanOrEqual(20 - opts.labelBars);
  });

  it('still points at exactly the price it was given', () => {
    const [p] = placeAnnotations(flat(21), [{ index: 10, price: 105.5 }], opts);
    expect(p.price).toBe(105.5);
    expect(p.index).toBe(10);
  });

  /** Entry and exit a couple of bars apart must not both hang the same way. */
  it('sends a close neighbour to the opposite side', () => {
    const [a, b] = placeAnnotations(
      flat(21),
      [
        { index: 9, price: 105 },
        { index: 11, price: 106 },
      ],
      opts,
    );
    expect(a.side).not.toBe(b.side);
  });

  it('leaves distant annotations free to pick their own best side', () => {
    const bars = flat(41);
    const [a, b] = placeAnnotations(
      bars,
      [
        { index: 5, price: 105 },
        { index: 35, price: 105 },
      ],
      opts,
    );
    expect(a.side).toBe(b.side);
  });

  it('has nothing to place when there are no bars', () => {
    expect(placeAnnotations([], [{ index: 0, price: 1 }], opts)).toEqual([]);
  });

  it('falls back to the annotated price when no bar nearby has a range', () => {
    const bars: LayoutBar[] = [
      { low: null, high: null },
      { low: null, high: null },
      { low: null, high: null },
    ];
    const [p] = placeAnnotations(bars, [{ index: 1, price: 105 }], opts);
    expect(p.clearancePrice).toBe(105);
  });
});

describe('resolveOverlaps', () => {
  const box = (y: number, side: 'above' | 'below' = 'above') => ({
    x: 100,
    y,
    width: 60,
    height: 30,
    side,
  });

  it('leaves boxes that do not touch exactly where they are', () => {
    const out = resolveOverlaps([box(50), { ...box(200), x: 400 }]);
    expect(out[1].y).toBe(200);
  });

  it('pushes an overlapping box clear of the one already placed', () => {
    const out = resolveOverlaps([box(100), box(105)]);
    expect(Math.abs(out[1].y - out[0].y)).toBeGreaterThanOrEqual(30);
  });

  it('pushes upward for a box hanging above and downward for one below', () => {
    const up = resolveOverlaps([box(100), box(105, 'above')]);
    expect(up[1].y).toBeLessThan(105);
    const down = resolveOverlaps([box(100, 'below'), box(105, 'below')]);
    expect(down[1].y).toBeGreaterThan(105);
  });

  /** A pathological input must not spin here. */
  it('gives up rather than looping forever', () => {
    const many = Array.from({ length: 6 }, () => box(100));
    expect(() => resolveOverlaps(many)).not.toThrow();
  });
});

describe('paddedRange', () => {
  it('leaves breathing room on both sides of the action', () => {
    expect(paddedRange(60, [10, 20], 8)).toEqual({ from: 2, to: 28 });
  });

  it('clamps to the data it actually has', () => {
    expect(paddedRange(20, [1, 18], 8)).toEqual({ from: 0, to: 19 });
  });

  it('falls back to the whole window when nothing is annotated', () => {
    expect(paddedRange(30, [], 8)).toEqual({ from: 0, to: 29 });
  });
});
