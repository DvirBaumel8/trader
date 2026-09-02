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
