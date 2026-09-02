export type StopKind = 'FIXED' | 'TRAILING';

export interface StopLevelInput {
  kind: StopKind;
  price: number | null;
  trailPercent: number | null;
  quantity: number;
}

export interface RiskInput {
  avgEntry: number;
  /** Position size, used to report coverage. */
  quantity: number;
  levels: StopLevelInput[];
  direction?: 'LONG' | 'SHORT';
}

export interface RiskResult {
  /** Dollars at risk across covered shares. Null when nothing is covered. */
  amount: number | null;
  coveredQuantity: number;
  fullyCovered: boolean;
  /** Tiers covering more shares than are held — a data error worth surfacing. */
  overCovered: boolean;
  /** Levels skipped as unusable, so the UI can say why risk looks wrong. */
  invalidLevels: number;
}

const EPSILON = 1e-9;

/**
 * The stop price a tier implies right now: the level itself for FIXED, or
 * `trailPercent` measured from the entry for TRAILING (see the caveat on
 * `computeRiskFromCurrentPrice` — a trail has no live-updating price in this
 * model, so its implied price is fixed at what it was worth at entry).
 * Shared by `computeRiskFromCurrentPrice` and the stops page's per-tier
 * distance so the two never disagree about what a tier's price is.
 */
export function resolveStopPrice(
  level: StopLevelInput,
  avgEntry: number,
  direction: 'LONG' | 'SHORT',
): number | null {
  const long = direction === 'LONG';
  if (level.kind === 'FIXED' && level.price !== null && level.price > 0) {
    return level.price;
  }
  if (
    level.kind === 'TRAILING' &&
    level.trailPercent !== null &&
    level.trailPercent > EPSILON
  ) {
    return long
      ? avgEntry * (1 - level.trailPercent / 100)
      : avgEntry * (1 + level.trailPercent / 100);
  }
  return null;
}

/**
 * Risk at entry, summed across stop tiers.
 *
 * A TRAILING level starts exactly `trailPercent` below the entry (above, for a
 * short), so risk at entry is knowable and fixed even though the level later
 * moves with the price. That is what lets a percentage trail coexist with
 * immutable, honest R.
 *
 * Levels on the wrong side of the entry are skipped rather than counted: a
 * "stop" above entry on a long is a typo, and counting it would report
 * negative risk.
 */
export function computeRisk(input: RiskInput): RiskResult {
  const direction = input.direction ?? 'LONG';
  const long = direction === 'LONG';

  let amount = 0;
  let covered = 0;
  let invalid = 0;

  for (const level of input.levels) {
    if (!(level.quantity > EPSILON)) {
      invalid += 1;
      continue;
    }

    let perShare: number | null = null;

    if (level.kind === 'FIXED' && level.price !== null && level.price > 0) {
      const distance = long
        ? input.avgEntry - level.price
        : level.price - input.avgEntry;
      perShare = distance > EPSILON ? distance : null;
    } else if (
      level.kind === 'TRAILING' &&
      level.trailPercent !== null &&
      level.trailPercent > EPSILON
    ) {
      perShare = input.avgEntry * (level.trailPercent / 100);
    }

    if (perShare === null) {
      invalid += 1;
      continue;
    }

    amount += perShare * level.quantity;
    covered += level.quantity;
  }

  const overCovered = covered > input.quantity + EPSILON;
  const cappedCover = Math.min(covered, input.quantity);

  return {
    amount: covered > EPSILON ? round(amount) : null,
    coveredQuantity: round(cappedCover),
    fullyCovered:
      covered > EPSILON && Math.abs(cappedCover - input.quantity) < EPSILON,
    overCovered,
    invalidLevels: invalid,
  };
}

export interface RiskFromPriceInput {
  avgEntry: number;
  /** The live (or last-known) price the position could be closed at now. */
  currentPrice: number;
  /** Position size actually held now, used to report coverage. */
  quantity: number;
  levels: StopLevelInput[];
  direction?: 'LONG' | 'SHORT';
}

/**
 * Dollars at risk **from here** — what changes hands if every stop tier were
 * hit at the current price, rather than at entry. This is a sibling of
 * `computeRisk`, not an extension of it, because the two questions have
 * different valid answers for the same input:
 *
 *  - `computeRisk` skips a level on the "wrong" side of the entry, because
 *    there a stop above entry on a long can only be a typo.
 *  - Here, a stop above the *current* price on a long is completely ordinary
 *    — it is a trail that has been walked up to lock in profit — so it is
 *    kept, and its per-share amount is allowed to go negative. Flooring it at
 *    zero would silently hide that this position is no longer a source of
 *    loss; skipping it would hide the stop entirely. Callers that sum this
 *    across positions should decide deliberately whether a negative amount
 *    should be allowed to net against real risk elsewhere — see
 *    `portfolio.service.ts`, which does not let it.
 *
 * A TRAILING level still has no live-updating price in this model (see
 * `computeRisk`'s doc comment) — its stop is implied as `trailPercent` from
 * the entry, fixed, and that implied price is what gets compared to the
 * current price here.
 */
export function computeRiskFromCurrentPrice(
  input: RiskFromPriceInput,
): RiskResult {
  const direction = input.direction ?? 'LONG';
  const long = direction === 'LONG';

  let amount = 0;
  let covered = 0;
  let invalid = 0;

  for (const level of input.levels) {
    if (!(level.quantity > EPSILON)) {
      invalid += 1;
      continue;
    }

    const stopPrice = resolveStopPrice(level, input.avgEntry, direction);

    if (stopPrice === null) {
      invalid += 1;
      continue;
    }

    // Signed on purpose — see the doc comment above.
    const perShare = long
      ? input.currentPrice - stopPrice
      : stopPrice - input.currentPrice;

    amount += perShare * level.quantity;
    covered += level.quantity;
  }

  const overCovered = covered > input.quantity + EPSILON;
  const cappedCover = Math.min(covered, input.quantity);

  return {
    amount: covered > EPSILON ? round(amount) : null,
    coveredQuantity: round(cappedCover),
    fullyCovered:
      covered > EPSILON && Math.abs(cappedCover - input.quantity) < EPSILON,
    overCovered,
    invalidLevels: invalid,
  };
}

function round(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
