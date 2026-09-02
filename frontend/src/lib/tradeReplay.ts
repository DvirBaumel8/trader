/**
 * Pure frame sequencing for the trade chart's replay mode (Phase 4, decision
 * 1 reversed 2026-09-02). Given the full ordered list of candle-bar dates
 * and, for each fill, the date of the bar its marker is anchored to
 * (`markerBar.date` from `placeFills` in `TradeChart.tsx`), this computes
 * exactly what a given replay step should show. No chart, no DOM, no timer
 * — just "which bars, which fills, are the stop lines drawn yet" — so it can
 * be covered with the same fixture-test treatment as `candleScale.ts`.
 */

export interface ReplayFrame {
  /** How many bars, counted from the start of the window, are revealed. */
  visibleBarCount: number;
  /**
   * Indices into whatever array `markerBarDates` was built from (i.e. the
   * trade's placed fills) that should be shown at this step.
   */
  visibleFillIndices: number[];
  /**
   * Whether the stop lines should be drawn. A stop is set at entry, so
   * showing it before the entry fill has appeared would tell the viewer
   * "something is about to happen here" before he knew it himself —
   * spoiling the thing replay exists to recreate. Gated on the *earliest*
   * fill's bar, which is the entry (or first entry tranche) for every real
   * trade shape in the data.
   */
  stopLinesVisible: boolean;
}

/** The last step, at which a replay is equivalent to the static chart. */
export function totalReplaySteps(barDates: string[]): number {
  return barDates.length;
}

/**
 * `step` counts bars revealed so far: 0 shows nothing, 1 shows the first
 * bar, ..., `barDates.length` shows everything (identical to the static
 * chart). Out-of-range steps are clamped rather than throwing, since the
 * component drives this from a ticking counter it does not want to guard
 * on every call site.
 */
export function replayFrame(
  barDates: string[],
  markerBarDates: string[],
  step: number,
): ReplayFrame {
  const visibleBarCount = Math.max(0, Math.min(step, barDates.length));
  const revealedThrough =
    visibleBarCount > 0 ? barDates[visibleBarCount - 1] : null;

  const visibleFillIndices: number[] = [];
  markerBarDates.forEach((date, i) => {
    if (revealedThrough !== null && date <= revealedThrough) {
      visibleFillIndices.push(i);
    }
  });

  const earliestFillDate = markerBarDates.reduce<string | null>(
    (min, date) => (min === null || date < min ? date : min),
    null,
  );
  const stopLinesVisible =
    // The final step must reproduce the static chart exactly, including
    // when a trade has no fills to gate on (shouldn't happen for a real
    // trade, but a pure function should not silently drop the stop lines
    // forever just because its input was unusual).
    visibleBarCount >= barDates.length ||
    (earliestFillDate !== null &&
      revealedThrough !== null &&
      earliestFillDate <= revealedThrough);

  return { visibleBarCount, visibleFillIndices, stopLinesVisible };
}
