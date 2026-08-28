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

function round(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
