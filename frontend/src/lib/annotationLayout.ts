/**
 * Where to put a trade's callout labels so they annotate the price action
 * instead of covering it.
 *
 * The owner's brief, in his order: draw the candles; take the two levels that
 * matter (entry + stop, or entry + exit); for each, look at the candles in
 * the AREA around it and choose a spot that hides none of them; and never let
 * a label sit on the edge of the plot.
 *
 * Two stages, and the split matters. This module works in DATA space and
 * answers only "which side, and which candle extreme must it clear" — both
 * decidable from bars alone, so they are testable without a DOM. The pixel
 * offset is the chart's job, because a gap that reads well is a number of
 * pixels, not a number of dollars: the same 6% of range is a comfortable gap
 * on a quiet stock and a mile on a volatile one.
 *
 * The first attempt returned an absolute `labelPrice` above the highest high,
 * which is OUTSIDE the chart's auto-scaled range — `priceToCoordinate`
 * returned null for every one of them and not a single callout rendered.
 * Clearing a price that is always on screen is what makes this reliable.
 */
export interface LayoutBar {
  high: number | null;
  low: number | null;
}

/** A level worth calling out: the entry, and either its stop or its exit. */
export interface Annotation {
  /** Bar index the callout points at. */
  index: number;
  /** The price it points at. */
  price: number;
}

export interface Placement extends Annotation {
  side: 'above' | 'below';
  /**
   * The candle extreme the label has to clear — the highest high or lowest
   * low in its area. Always a real traded price, so it is always inside the
   * chart's own range and always convertible to a coordinate.
   */
  clearancePrice: number;
}

export interface LayoutOptions {
  /** Half-width, in bars, of the AREA whose candles a label must clear. */
  windowBars: number;
  /**
   * How close, in bars, two callouts have to be before they are assumed to
   * collide and sent to opposite sides. Only a heuristic: whether they REALLY
   * overlap is decided later, in pixels, by `resolveOverlaps`.
   *
   * Keeping a label away from the left and right edges is a pixel job too —
   * expressing it in bars pulled both of a right-edge trade's callouts onto
   * the SAME bar, stacking them one above the other with long connector
   * lines, because six bars is far wider than a 74px box.
   */
  labelBars: number;
}

function extent(bars: LayoutBar[]): { low: number; high: number } | null {
  let low = Infinity;
  let high = -Infinity;
  for (const b of bars) {
    if (b.low !== null && b.low < low) low = b.low;
    if (b.high !== null && b.high > high) high = b.high;
  }
  return Number.isFinite(low) && Number.isFinite(high) ? { low, high } : null;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/**
 * Which side each callout hangs on, and what it must clear.
 *
 * Placed in order, each one avoiding the side already taken by a neighbour:
 * the first annotation (the entry, by convention) gets the best side and
 * later ones work around it, which is stable — the entry does not jump
 * because an exit was added later.
 */
export function placeAnnotations(
  bars: LayoutBar[],
  annotations: Annotation[],
  opts: LayoutOptions,
): Placement[] {
  if (bars.length === 0) return [];
  const chart = extent(bars);

  const placed: Placement[] = [];

  for (const a of annotations) {
    const index = clamp(a.index, 0, bars.length - 1);
    const from = Math.max(0, index - opts.windowBars);
    const to = Math.min(bars.length - 1, index + opts.windowBars);
    // The box must clear every candle in the AREA, not just the one it
    // points at — a callout is wider than a bar.
    const local = extent(bars.slice(from, to + 1)) ?? { low: a.price, high: a.price };

    // Prefer the side of the area with more empty chart to sit in.
    const roomAbove = chart ? chart.high - local.high : 0;
    const roomBelow = chart ? local.low - chart.low : 0;
    let side: 'above' | 'below' = roomAbove >= roomBelow ? 'above' : 'below';

    // A neighbour close enough to collide takes its side with it; the next
    // callout goes opposite rather than stacking on top of it.
    const neighbour = placed.find(
      (p) => Math.abs(p.index - index) < 2 * opts.labelBars,
    );
    if (neighbour && neighbour.side === side) {
      side = side === 'above' ? 'below' : 'above';
    }

    placed.push({
      ...a,
      index,
      side,
      clearancePrice: side === 'above' ? local.high : local.low,
    });
  }

  return placed;
}

/**
 * Keep a box's centre inside the plot.
 *
 * The owner's step 4, in the space it belongs to. Expressed in bars it was
 * hopeless: six bars is far wider than a 74px box, so a trade near the right
 * edge had BOTH its callouts dragged onto the same bar and stacked one above
 * the other. In pixels it moves a box only as far as it actually has to.
 *
 * A plot too small to hold the box at all leaves the value alone rather than
 * returning a nonsense midpoint.
 */
export function clampToPlot(
  value: number,
  boxSize: number,
  plotSize: number,
  pad = 2,
): number {
  const lo = boxSize / 2 + pad;
  const hi = plotSize - boxSize / 2 - pad;
  return hi < lo ? value : Math.max(lo, Math.min(hi, value));
}

/** A positioned box, in container pixels. */
export interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Nudge boxes apart until none overlaps another.
 *
 * Done in pixels because that is the only space in which "overlapping" is a
 * fact rather than an estimate — two boxes a dollar apart may be inches apart
 * or touching, depending on the price scale. Each box moves away from the one
 * it hit, in the direction it was already hanging, and the result is clamped
 * by the caller.
 */
export function resolveOverlaps<T extends PixelBox & { side: 'above' | 'below' }>(
  boxes: T[],
  gap = 6,
): T[] {
  const out: T[] = [];
  for (const box of boxes) {
    const moved = { ...box };
    let guard = 0;
    // Bounded: a box can only be pushed so many times before it is clear of
    // everything already placed, and the guard means a pathological input
    // cannot spin here.
    while (
      guard++ < 8 &&
      out.some(
        (other) =>
          Math.abs(other.x - moved.x) < (other.width + moved.width) / 2 &&
          Math.abs(other.y - moved.y) < (other.height + moved.height) / 2 + gap,
      )
    ) {
      moved.y += moved.side === 'above' ? -(moved.height + gap) : moved.height + gap;
    }
    out.push(moved);
  }
  return out;
}

/**
 * The slice of bars to show: the annotated action plus breathing room either
 * side, so a trade never sits flush against the edge of the plot with no
 * context before the entry or after the exit.
 */
export function paddedRange(
  barCount: number,
  annotatedIndices: number[],
  padBars: number,
): { from: number; to: number } {
  if (barCount === 0) return { from: 0, to: 0 };
  if (annotatedIndices.length === 0) return { from: 0, to: barCount - 1 };
  const lo = Math.min(...annotatedIndices);
  const hi = Math.max(...annotatedIndices);
  return {
    from: clamp(lo - padBars, 0, barCount - 1),
    to: clamp(hi + padBars, 0, barCount - 1),
  };
}
