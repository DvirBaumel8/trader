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
 * `trailPercent` measured from the **high-water price** for TRAILING — the
 * most favorable price reached since entry (the high for a long, the low for
 * a short), not the entry price itself. A trail's entire purpose is that it
 * ratchets toward price and never gives ground back, so anchoring it to
 * entry (what this used to do) makes it a fixed stop wearing a trailing
 * label: it never moves, understating the level and overstating both room
 * and dollars at risk. The caller supplies `highWaterPrice` — this stays a
 * pure function with no database access, so it cannot compute a high-water
 * mark itself; see `computeFavorablePrice` for the helper that does, from
 * bars `portfolio.service.ts` already fetches.
 *
 * Returns null for an unresolved TRAILING level (no `highWaterPrice`)
 * rather than falling back to the entry-anchored price — a wrong stop level
 * is worse than an absent one. Shared by `computeRiskFromCurrentPrice` and
 * the stops page's per-tier distance so the two never disagree about what a
 * tier's price is.
 *
 * Takes no entry price, and that is the point: a trail resolves from the
 * high-water mark, a fixed stop from its own level, so entry never enters
 * into it. It was a parameter once, passed by every caller and read by none,
 * which implied the opposite of what the function does.
 */
export function resolveStopPrice(
  level: StopLevelInput,
  direction: 'LONG' | 'SHORT',
  highWaterPrice: number | null,
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
    if (highWaterPrice === null || !(highWaterPrice > 0)) return null;
    return long
      ? highWaterPrice * (1 - level.trailPercent / 100)
      : highWaterPrice * (1 + level.trailPercent / 100);
  }
  return null;
}

/**
 * The most favorable price reached since entry, direction-adjusted: the
 * highest daily high for a long (a trail ratchets UP as price rises), the
 * lowest daily low for a short (a trail ratchets DOWN as price falls). Never
 * moves back once set — a pullback after a new high, or a bounce after a
 * new low, must not lower a long's trail or raise a short's, which is
 * exactly why this takes the max/min over the whole run rather than just
 * the latest price.
 *
 * `currentPrice` is folded into the same max/min because today's bar may
 * not be written to `daily_closes` yet — omitting it would let the trail
 * silently lag by up to a day. Null when there is nothing to compute from
 * (no bars and no current price), which `resolveStopPrice` then treats as
 * "cannot resolve" rather than guessing.
 */
export function computeFavorablePrice(
  bars: Array<{ high: number; low: number }>,
  direction: 'LONG' | 'SHORT',
  currentPrice: number | null,
): number | null {
  const values = bars.map((b) => (direction === 'LONG' ? b.high : b.low));
  if (currentPrice !== null && currentPrice > 0) values.push(currentPrice);
  if (values.length === 0) return null;
  return direction === 'LONG' ? Math.max(...values) : Math.min(...values);
}

/**
 * Risk at entry, summed across stop tiers.
 *
 * A TRAILING level starts exactly `trailPercent` below the entry (above, for a
 * short), so risk at entry is knowable and fixed even though the level later
 * moves with the price. That is what lets a percentage trail coexist with
 * immutable, honest R.
 *
 * A level beyond the entry in the FAVOURABLE direction — a stop above entry on
 * a long — is a profit lock, not a typo, and it covers its shares like any
 * other stop. This was originally read the other way (skipped as a
 * misentry), which told the owner that a winning position's protected shares
 * were unprotected: a real META plan with a tier at 602.93 against a 593.49
 * entry reported "covers 20 of 46 sh" in red.
 *
 * Its contribution to the dollar figure is floored at zero rather than
 * allowed to go negative. Risk at entry is what R is measured against, and a
 * tier that can only produce a gain must not net against real risk elsewhere
 * and quietly shrink it. Erring toward overstating risk is the one safe
 * direction. `computeRiskFromCurrentPrice` answers a different question and
 * deliberately does let its figure go negative — see its doc comment.
 */
export function computeRisk(input: RiskInput): RiskResult {
  const direction = input.direction ?? 'LONG';
  const long = direction === 'LONG';
  const heldQuantity = Math.max(0, input.quantity);

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
      // Floored, not rejected: a profit-locking tier still covers its shares,
      // but contributes no risk. See the doc comment.
      perShare = Math.max(0, distance);
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

  const overCovered = covered > heldQuantity + EPSILON;
  const cappedCover = Math.min(covered, heldQuantity);
  // Coverage can never exceed what is actually held — a stop cannot protect
  // shares that are gone. When tiers overshoot, the dollar figure is scaled
  // down by the same ratio as the share count, rather than dropping any one
  // tier: the app cannot know which recorded level is stale (see
  // `evaluateStopPlan`, which surfaces the discrepancy itself instead of
  // guessing). Zero held (a fully closed position) falls out of this the
  // same way: cappedCover is 0, so amount is capped to 0 and then reported
  // as null below — a closed position contributes no risk at all.
  const cappedAmount =
    overCovered && covered > EPSILON ? amount * (cappedCover / covered) : amount;

  return {
    amount: cappedCover > EPSILON ? round(cappedAmount) : null,
    coveredQuantity: round(cappedCover),
    fullyCovered:
      cappedCover > EPSILON && Math.abs(cappedCover - heldQuantity) < EPSILON,
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
  /**
   * The high-water price since entry (see `computeFavorablePrice`), needed
   * to resolve a TRAILING level's current implied price. Null if unknown —
   * any TRAILING level is then treated as unresolved (skipped, counted as
   * invalid) rather than priced from entry.
   */
  highWaterPrice?: number | null;
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
 * A TRAILING level's implied price here is `trailPercent` from the
 * high-water price since entry (see `resolveStopPrice` and
 * `computeFavorablePrice`), NOT from the entry price — unlike `computeRisk`,
 * which deliberately stays entry-anchored forever so risk-at-entry (and R)
 * never changes after the fact. This function answers a different question
 * ("what could I lose from here, right now") and a trail that never moved
 * off its entry-anchored level would answer it wrong.
 */
export function computeRiskFromCurrentPrice(
  input: RiskFromPriceInput,
): RiskResult {
  const direction = input.direction ?? 'LONG';
  const long = direction === 'LONG';
  const heldQuantity = Math.max(0, input.quantity);

  let amount = 0;
  let covered = 0;
  let invalid = 0;

  for (const level of input.levels) {
    if (!(level.quantity > EPSILON)) {
      invalid += 1;
      continue;
    }

    const stopPrice = resolveStopPrice(
      level,
      direction,
      input.highWaterPrice ?? null,
    );

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

  const overCovered = covered > heldQuantity + EPSILON;
  const cappedCover = Math.min(covered, heldQuantity);
  // Same proportional cap as computeRisk, and the same reason: coverage (and
  // the dollar figure it implies) can never exceed what is actually held,
  // and a fully closed position (heldQuantity 0) contributes nothing.
  const cappedAmount =
    overCovered && covered > EPSILON ? amount * (cappedCover / covered) : amount;

  return {
    amount: cappedCover > EPSILON ? round(cappedAmount) : null,
    coveredQuantity: round(cappedCover),
    fullyCovered:
      cappedCover > EPSILON && Math.abs(cappedCover - heldQuantity) < EPSILON,
    overCovered,
    invalidLevels: invalid,
  };
}

export type StopPlanIssue =
  | 'CLOSED_WITH_STOPS'
  | 'DIRECTION_MISMATCH'
  | 'OVER_COVERED'
  | 'UNRESOLVED_TRAILING';

export interface StopPlanStatus {
  /** True when the recorded tiers no longer describe the position honestly. */
  needsUpdate: boolean;
  issue: StopPlanIssue | null;
  /** Sum of tier quantities as recorded — raw, not capped to what is held. */
  recordedQuantity: number;
  /** Shares actually held right now (unsigned). */
  heldQuantity: number;
}

/**
 * Whether a position's recorded stop plan still describes reality. Stop
 * tiers attach to the transaction that opened a position and are never
 * reconciled when the position later changes (see stop-level.entity.ts), so
 * three kinds of drift are possible, checked in this order:
 *
 *  1. The position is fully closed (0 held) but tiers are still on record —
 *     a stop on shares that no longer exist, possibly sold BY that very
 *     tier.
 *  2. The position's live direction differs from the direction the tiers
 *     were recorded under (a long that has since flipped short, or vice
 *     versa). A stop set for one direction is meaningless for the other:
 *     `computeRiskFromCurrentPrice` will still produce a number for it
 *     (it deliberately does not skip levels on the "wrong side" of price,
 *     see its doc comment), but that number would not be truthful, so
 *     callers must treat this case as needing attention rather than pricing
 *     it.
 *  3. The tiers add up to more shares than are currently held — a partial
 *     exit executed one tier and the rest were never reconciled.
 *  4. A TRAILING tier has no high-water price to resolve against (see
 *     `resolveStopPrice`/`computeFavorablePrice`) — its distance and dollar
 *     figure cannot be trusted, so the plan is flagged rather than silently
 *     priced at the wrong, entry-anchored level. Checked last: it is the
 *     mildest of the four (the tier itself is not necessarily stale, the
 *     data to price it is just temporarily missing), so a closed, flipped,
 *     or over-covered plan is reported as that instead.
 *
 * Deliberately does NOT decide which tier is stale — `computeRisk` and
 * `computeRiskFromCurrentPrice` cap the dollar effect proportionally
 * instead of dropping a specific tier, and this function only reports THAT
 * something needs the owner's attention, never which recorded level to
 * trust or discard.
 */
export function evaluateStopPlan(input: {
  /** Signed, live: negative is short, 0 is flat/closed. */
  heldQuantity: number;
  /** The direction the recorded tiers were written under. */
  recordedDirection: 'LONG' | 'SHORT';
  levels: StopLevelInput[];
  /**
   * True when at least one TRAILING tier could not be resolved to a price
   * (see `resolveStopPrice`) — the caller already knows this, having tried
   * to resolve the same levels against a `highWaterPrice`.
   */
  hasUnresolvedTrailing?: boolean;
}): StopPlanStatus {
  const heldAbs = Math.abs(input.heldQuantity);
  const recordedQuantity = input.levels.reduce(
    (sum, l) => sum + (l.quantity > EPSILON ? l.quantity : 0),
    0,
  );

  if (recordedQuantity <= EPSILON) {
    return {
      needsUpdate: false,
      issue: null,
      recordedQuantity: 0,
      heldQuantity: heldAbs,
    };
  }
  if (heldAbs <= EPSILON) {
    return {
      needsUpdate: true,
      issue: 'CLOSED_WITH_STOPS',
      recordedQuantity,
      heldQuantity: 0,
    };
  }

  const liveDirection: 'LONG' | 'SHORT' =
    input.heldQuantity > 0 ? 'LONG' : 'SHORT';
  if (liveDirection !== input.recordedDirection) {
    return {
      needsUpdate: true,
      issue: 'DIRECTION_MISMATCH',
      recordedQuantity,
      heldQuantity: heldAbs,
    };
  }

  if (recordedQuantity > heldAbs + EPSILON) {
    return {
      needsUpdate: true,
      issue: 'OVER_COVERED',
      recordedQuantity,
      heldQuantity: heldAbs,
    };
  }

  if (input.hasUnresolvedTrailing) {
    return {
      needsUpdate: true,
      issue: 'UNRESOLVED_TRAILING',
      recordedQuantity,
      heldQuantity: heldAbs,
    };
  }

  return {
    needsUpdate: false,
    issue: null,
    recordedQuantity,
    heldQuantity: heldAbs,
  };
}

function round(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
