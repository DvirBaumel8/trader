/**
 * Where to put a trade's callout labels so they annotate the price action
 * instead of covering it.
 *
 * The owner's brief, in his order: draw the candles; take the two levels that
 * matter (entry + stop, or entry + exit); for each, look at the candles in
 * the AREA around it and choose a spot that hides none of them; and never let
 * a label sit on the edge of the plot.
 *
 * Pure and in data space — bar indices and prices, never pixels. The chart
 * converts to coordinates, which keeps this testable without a DOM and keeps
 * the geometry honest when the container resizes.
 *
 * The previous version chose a side from ONE candle's geometry
 * (`markerSideForPrice`). That is why it looked amateur: a label clear of its
 * own candle still lands on its neighbours, because a marker is wider than a
 * bar.
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
  /** Price of the label box's inner edge — the arrow runs from here to `price`. */
  labelPrice: number;
  /** Bar the box is centred on. Pulled inward from the edges; `index` is untouched. */
  labelIndex: number;
}

export interface LayoutOptions {
  /** Half-width, in bars, of the AREA whose candles a label must clear. */
  windowBars: number;
  /** Half-width, in bars, of the label box itself. */
  labelBars: number;
  /** Gap between the candles and the box, as a fraction of the price span. */
  gapFraction: number;
  /** Height of the box, as a fraction of the price span. */
  labelHeightFraction: number;
}

function extent(bars: LayoutBar[]): { low: number; high: number } {
  let low = Infinity;
  let high = -Infinity;
  for (const b of bars) {
    if (b.low !== null && b.low < low) low = b.low;
    if (b.high !== null && b.high > high) high = b.high;
  }
  // A window of bars with no recorded range at all still has to yield a
  // finite answer, or every price downstream becomes NaN.
  if (!Number.isFinite(low) || !Number.isFinite(high)) return { low: 0, high: 1 };
  return { low, high };
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** Do two placed boxes occupy the same patch of chart? */
function collides(a: Placement, b: Placement, opts: LayoutOptions, span: number): boolean {
  if (Math.abs(a.labelIndex - b.labelIndex) >= 2 * opts.labelBars) return false;
  const height = opts.labelHeightFraction * span;
  const band = (p: Placement): [number, number] =>
    p.side === 'above'
      ? [p.labelPrice, p.labelPrice + height]
      : [p.labelPrice - height, p.labelPrice];
  const [aLow, aHigh] = band(a);
  const [bLow, bHigh] = band(b);
  return aLow < bHigh && bLow < aHigh;
}

/**
 * Place each callout clear of the candles around it, and clear of the other
 * callouts.
 *
 * Placed in order, each one avoiding those already placed: the first
 * annotation (the entry, by convention) gets the best spot and later ones
 * work around it, which is stable — the entry does not jump because an exit
 * was added later.
 */
export function placeAnnotations(
  bars: LayoutBar[],
  annotations: Annotation[],
  opts: LayoutOptions,
): Placement[] {
  if (bars.length === 0) return [];

  const chart = extent(bars);
  const span = chart.high - chart.low || 1;
  const gap = opts.gapFraction * span;
  const height = opts.labelHeightFraction * span;

  const placed: Placement[] = [];

  for (const a of annotations) {
    const index = clamp(a.index, 0, bars.length - 1);
    const from = Math.max(0, index - opts.windowBars);
    const to = Math.min(bars.length - 1, index + opts.windowBars);
    const local = extent(bars.slice(from, to + 1));

    // The box must clear every candle in the AREA, not just the one it
    // points at — a callout is wider than a bar.
    const above = local.high + gap;
    const below = local.low - gap;

    // Prefer the side of the area with more empty chart to sit in.
    const roomAbove = chart.high - local.high;
    const roomBelow = local.low - chart.low;
    const first: 'above' | 'below' = roomAbove >= roomBelow ? 'above' : 'below';

    // Never hang off the left or right edge — the owner's step 4. The arrow
    // still points at `index`; only the box moves.
    const labelIndex = clamp(
      index,
      Math.min(opts.labelBars, bars.length - 1),
      Math.max(0, bars.length - 1 - opts.labelBars),
    );

    const candidates: Placement[] = [
      { ...a, index, side: first, labelPrice: first === 'above' ? above : below, labelIndex },
      {
        ...a,
        index,
        side: first === 'above' ? 'below' : 'above',
        labelPrice: first === 'above' ? below : above,
        labelIndex,
      },
    ];
    // Last resort: keep the preferred side and stack outward past whatever
    // is already there, rather than overlapping it.
    const pushed = { ...candidates[0] };
    pushed.labelPrice =
      pushed.side === 'above'
        ? pushed.labelPrice + height * 1.3
        : pushed.labelPrice - height * 1.3;
    candidates.push(pushed);

    const chosen =
      candidates.find((c) => !placed.some((p) => collides(c, p, opts, span))) ??
      candidates[candidates.length - 1];
    placed.push(chosen);
  }

  return placed;
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
