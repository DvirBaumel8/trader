import { resolveStopPrice, type StopLevelInput } from './risk.js';

export type MarketSession = 'PRE' | 'REGULAR' | 'POST' | 'CLOSED';

/** One open position's live stop plan, priced against its current quote. */
export interface StopDistanceInput {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  avgEntry: number;
  /** Null when never successfully quoted — the position is skipped, not guessed at. */
  currentPrice: number | null;
  session: MarketSession | null;
  extended: boolean;
  stale: boolean;
  levels: StopLevelInput[];
  /**
   * The high-water price since entry (see `computeFavorablePrice` in
   * risk.ts), needed to resolve a TRAILING tier's current price. Null skips
   * any TRAILING tier rather than pricing it from entry.
   */
  highWaterPrice: number | null;
}

/**
 * One row per stop TIER, not per symbol — a scaled-out position (e.g. BITX at
 * 17.46 and 17.07) produces two rows, each with its own quantity and
 * distance, because an averaged distance would not be a real price level.
 */
export interface StopDistanceRow {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  stopPrice: number;
  /** Shares this tier covers, always positive. */
  quantity: number;
  currentPrice: number;
  session: MarketSession | null;
  extended: boolean;
  stale: boolean;
  /**
   * Fraction of the current price — same convention as `unrealizedPct` on a
   * position, not pre-multiplied by 100. Positive means room: the stop has
   * not been reached and this is how far price has to travel to hit it.
   * Negative means the level has ALREADY been passed — current price has
   * already crossed it — which is a materially different, more urgent
   * statement than "a small distance" and must never be rendered as if it
   * were just a smaller number. `passed` below exists so callers do not have
   * to infer that from the sign themselves.
   */
  distance: number;
  /** True when the current price has already crossed this stop level. */
  passed: boolean;
  /**
   * Dollars given back if this tier fires: `distance x currentPrice x
   * quantity`, which resolves to (current - stop) for a long and
   * (stop - current) for a short because `distance` is already signed by
   * direction. Negative exactly when `passed` — the level has been crossed
   * and firing it now would realise more than the stop promised. The
   * headline sum in portfolio.service.ts floors each position at zero for
   * that reason; this row-level figure stays honest about the sign.
   */
  amountAtRisk: number;
}

const EPSILON = 1e-9;

/**
 * Per-tier distance-to-stop for every currently open position with a live
 * stop plan. Positions with no stop, or with no live price yet, contribute no
 * rows — the caller (portfolio.service.ts) already tracks "no stop at all"
 * separately via `atRisk.positionsWithoutStop`, and a row with a guessed
 * price would be worse than no row.
 *
 * Reuses `resolveStopPrice` from risk.ts rather than re-deriving a tier's
 * implied stop price, so this page can never disagree with the At-risk box
 * about what a stop is worth.
 */
export function computeStopDistances(
  positions: StopDistanceInput[],
): StopDistanceRow[] {
  const rows: StopDistanceRow[] = [];

  for (const p of positions) {
    if (p.currentPrice === null || !(p.currentPrice > 0)) continue;
    const long = p.direction === 'LONG';

    for (const level of p.levels) {
      if (!(level.quantity > EPSILON)) continue;
      const stopPrice = resolveStopPrice(
        level,
        p.avgEntry,
        p.direction,
        p.highWaterPrice,
      );
      if (stopPrice === null) continue;

      // Signed on purpose — positive is room, negative is already passed.
      // See the doc comment on `distance`.
      const perShare = long
        ? p.currentPrice - stopPrice
        : stopPrice - p.currentPrice;
      const distance = perShare / p.currentPrice;

      rows.push({
        symbol: p.symbol,
        direction: p.direction,
        stopPrice: round(stopPrice),
        quantity: round(level.quantity),
        currentPrice: p.currentPrice,
        session: p.session,
        extended: p.extended,
        stale: p.stale,
        distance: round(distance),
        passed: perShare < 0,
        amountAtRisk: distance * p.currentPrice * level.quantity,
      });
    }
  }

  return rows;
}

function round(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
