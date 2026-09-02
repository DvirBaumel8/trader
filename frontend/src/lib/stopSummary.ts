/**
 * Which stop levels have a real, drawable price today, and how to describe
 * them — pure data shaping, kept out of `TradeChart.tsx` so it can be
 * fixture-tested the way `tradeReplay.ts` and `candleScale.ts` are.
 *
 * A fixed stop's `resolvedPrice` is just the level the owner set. A trailing
 * stop's is computed by the backend from the high-water mark since entry —
 * it moves as price does, and the backend returns `null` (never a guess)
 * when it can't be computed yet, most often for lack of high-water data.
 * Only `resolvedPrice` decides drawability; the historical `price` field
 * (fixed-only) is not consulted here.
 */

export interface StopSummaryInput {
  kind: 'FIXED' | 'TRAILING';
  resolvedPrice?: number | null;
  trailPercent: number | null;
}

export interface ResolvedStopLine {
  kind: 'FIXED' | 'TRAILING';
  price: number;
  /** Price formatted to 2dp, with the trail percent appended for a trailing
   * stop — e.g. "118.50" or "15.02 (11.9% trail)". */
  label: string;
}

/**
 * Stops with a concrete level to draw, sorted highest price first — top to
 * bottom, matching how they read on the chart itself. `resolvedPrice` may be
 * `undefined` rather than `null` if the API hasn't shipped the field yet;
 * both are treated as "not resolved" so this degrades to "draw nothing" —
 * the pre-fix behaviour — instead of throwing.
 */
export function resolvedStopLines(
  stops: StopSummaryInput[],
): ResolvedStopLine[] {
  return stops
    .filter(
      (s): s is StopSummaryInput & { resolvedPrice: number } =>
        s.resolvedPrice !== null && s.resolvedPrice !== undefined,
    )
    .map((s) => ({
      kind: s.kind,
      price: s.resolvedPrice,
      label:
        s.kind === 'TRAILING' && s.trailPercent !== null
          ? `${s.resolvedPrice.toFixed(2)} (${s.trailPercent}% trail)`
          : s.resolvedPrice.toFixed(2),
    }))
    .sort((a, b) => b.price - a.price);
}

/**
 * Trailing tiers with no resolved level — high-water data missing, or the
 * API not yet returning `resolvedPrice` at all — which must stay text-only
 * rather than be drawn at a guessed price.
 */
export function unresolvedTrailingStops<
  T extends { kind: 'FIXED' | 'TRAILING'; resolvedPrice?: number | null },
>(stops: T[]): T[] {
  return stops.filter(
    (s) =>
      s.kind === 'TRAILING' &&
      (s.resolvedPrice === null || s.resolvedPrice === undefined),
  );
}
