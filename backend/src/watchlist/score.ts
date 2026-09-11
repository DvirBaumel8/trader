import type { TargetDirection } from './watchlist-item.entity.js';

/**
 * Which way the price has to move for a target to count as reached.
 *
 * Decided when the target is SET, from the price at that moment, and then
 * stored. Re-deriving it at read time would be wrong: once the price has
 * moved past the level, "did he want it to rise to here or fall to here"
 * is no longer inferable, and guessing turns a hit into a miss.
 */
export function directionFor(price: number, target: number): TargetDirection {
  return target >= price ? 'ABOVE' : 'BELOW';
}

/** Has the price got to where he asked to be told about? */
export function targetReached(
  price: number | null,
  target: number | null,
  direction: TargetDirection | null,
): boolean {
  if (price === null || target === null || direction === null) return false;
  return direction === 'ABOVE' ? price >= target : price <= target;
}

/**
 * How far the price still has to move to reach the target, as a FRACTION of
 * today's price. Positive means it has to rise, negative that it has to fall.
 *
 * A fraction, not a percentage, because that is this codebase's convention —
 * `unrealizedPct` is `(value - cost) / |cost|` and `stop-distance.ts` names
 * the convention explicitly. Returning a percentage here instead put a target
 * $0.04 away on screen as "-1.83% away", because `formatPercent` multiplies
 * by 100 on the way out. A hundredfold error in the only number the feature
 * exists to show.
 *
 * Null rather than 0 when there is no price or no target — a missing number
 * must not read as "already there", which is the whole honest-numbers rule.
 */
export function distanceToTarget(
  price: number | null,
  target: number | null,
): number | null {
  if (price === null || target === null || price === 0) return null;
  return (target - price) / price;
}

/**
 * The watchlist ticker worth an opinion.
 *
 * Closest to its own target wins. That is the only ranking that means the
 * same thing for a target above the price and one below it: ranking by
 * "most upside" would treat a buy-the-dip level as a profit target and put
 * the least interesting name first. The app ranks; the model judges — the
 * split the trade-idea design already settled.
 */
export function bestCandidate<T extends { distanceToTarget: number | null }>(
  candidates: T[],
): T | null {
  const measurable = candidates.filter((c) => c.distanceToTarget !== null);
  if (measurable.length === 0) return null;
  return measurable.reduce((best, c) =>
    Math.abs(c.distanceToTarget as number) < Math.abs(best.distanceToTarget as number)
      ? c
      : best,
  );
}
