/**
 * A compact text line for the trade's fills, replacing price text drawn on
 * the chart markers themselves (see the label-clipping note in
 * `TradeChart.tsx`). `lightweight-charts` positions marker text itself and
 * never reflows it off the plot, so a label near an edge — the first bar,
 * the last bar, or the top/bottom of the price range — gets silently
 * clipped. Worse, a clipped label like "2.79" (from "112.79") still reads as
 * a plausible price, so a viewer has no way to notice it's wrong short of
 * cross-checking against the axis. Moving the numbers into ordinary DOM text
 * beneath the chart, the same move already made for stop levels, sidesteps
 * the whole class of problem rather than trying to out-guess the library's
 * layout.
 *
 * Pure and independent of the component tree on purpose — a `Fill` shaped
 * value is duck-typed here rather than imported from `TradeChart.tsx`, so
 * this stays a leaf `lib/` module per the repo's convention instead of
 * creating a component -> lib -> component import cycle.
 */

export interface FillSummaryInput {
  executedAt: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
}

function formatQuantity(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  });
}

/**
 * One segment per fill — "Bought 1,000 at 13.29" / "Sold 600 at 17.46" —
 * joined with " · ", ordered by execution time so a scale-in or scale-out
 * reads in the order it actually happened regardless of what order the API
 * returned them in. Empty input yields an empty string; the caller decides
 * whether to render anything.
 */
export function formatFillsSummary(fills: FillSummaryInput[]): string {
  return [...fills]
    .sort((a, b) => a.executedAt.localeCompare(b.executedAt))
    .map(
      (f) =>
        `${f.side === 'BUY' ? 'Bought' : 'Sold'} ${formatQuantity(f.quantity)} at ${f.price.toFixed(2)}`,
    )
    .join(' · ');
}

export interface FillPriceLine {
  price: number;
  side: 'BUY' | 'SELL';
}

/**
 * One horizontal line per price actually traded, for drawing beside the
 * fill markers.
 *
 * The markers themselves are anchored to the bar, not the price
 * (`belowBar`/`aboveBar` — see TradeChart), because putting them on the
 * price covers the candle they annotate. The cost of that is a marker
 * floating at a level the owner never traded at: a PLTR sell at 167.15
 * drew an arrow up near 185, which reads as the chart being wrong about
 * the price. The line puts the real number back on the chart without
 * covering anything, and the arrow keeps saying which day and which way.
 *
 * Deduplicated by price: scaling in at one level is several fills but one
 * line, and stacking identical lines only thickens it.
 */
export function fillPriceLines(fills: FillSummaryInput[]): FillPriceLine[] {
  const bySide = new Map<number, 'BUY' | 'SELL'>();
  for (const f of fills) {
    if (!Number.isFinite(f.price) || f.price <= 0) continue;
    bySide.set(f.price, f.side);
  }
  return [...bySide.entries()]
    .map(([price, side]) => ({ price, side }))
    .sort((a, b) => a.price - b.price);
}
