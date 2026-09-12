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

/** A daily bar, as `daily_closes` stores it. */
export interface PriceBar {
  date: string;
  high: number | null;
  low: number | null;
}

/**
 * The first day the price actually touched the target, or null if it never
 * did.
 *
 * This is the owner's requirement, stated plainly: tell me whether the stock
 * reached my price at ANY point since I set it — not whether it happens to be
 * there right now. A ticker that spiked through his level and pulled back has
 * reached it, and comparing only the live price calls that a miss, which is
 * the one thing the feature must not do.
 *
 * Uses the bar's HIGH and LOW, not its close: the target was touched if the
 * stock traded there at all that day. Bars with no range recorded are skipped
 * rather than treated as a non-event, since "unknown" is not "no".
 *
 * At the level counts as reaching it — he asked to be told when it gets
 * there, and exactly there is there.
 */
export function firstReachedOn(
  bars: PriceBar[],
  target: number | null,
  direction: TargetDirection | null,
): string | null {
  if (target === null || direction === null) return null;
  for (const bar of bars) {
    if (direction === 'ABOVE') {
      if (bar.high !== null && bar.high >= target) return bar.date;
    } else if (bar.low !== null && bar.low <= target) {
      return bar.date;
    }
  }
  return null;
}

/** Has the price got to where he asked to be told about, right now? */
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
