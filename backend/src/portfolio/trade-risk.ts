/**
 * What the model's two proposed levels actually imply, in the owner's own
 * terms.
 *
 * The model proposes WHERE; every number here is the app's. A risk/reward
 * ratio worked out by a language model is exactly the kind of plausible wrong
 * number this codebase refuses to display, and the whole point of asking for
 * structured levels is so the arithmetic never has to be trusted to it.
 *
 * Pure: no database, no network, fixture-tested — the house style of
 * `derive.ts` and `risk.ts`.
 */
export interface TradeRiskInput {
  entryPrice: number;
  stop: number;
  target: number;
  /**
   * The owner's average risk per trade, from his own closed history. Null when
   * he has none yet, in which case no position size is offered — sizing
   * against a made-up yardstick would be worse than offering none.
   */
  usualRisk: number | null;
}

export interface TradeRiskResult {
  direction: 'LONG' | 'SHORT';
  riskPerShare: number;
  rewardPerShare: number;
  riskReward: number | null;
  /** Shares that would risk exactly `usualRisk` with this stop. Null without one. */
  sharesAtUsualRisk: number | null;
  positionValueAtUsualRisk: number | null;
}

const EPSILON = 1e-9;

export function computeTradeRisk(input: TradeRiskInput): TradeRiskResult | null {
  const { entryPrice, stop, target, usualRisk } = input;
  if (!(entryPrice > 0) || !(stop > 0) || !(target > 0)) return null;

  // Direction is inferred from the levels rather than asked for: a stop below
  // and a target above is a long, the reverse is a short. Anything else —
  // both on the same side of entry, or a stop sitting on it — is not a trade
  // with a direction, and gets no numbers at all rather than a guess.
  const long = stop < entryPrice && target > entryPrice;
  const short = stop > entryPrice && target < entryPrice;
  if (!long && !short) return null;

  const riskPerShare = Math.abs(entryPrice - stop);
  const rewardPerShare = Math.abs(target - entryPrice);
  if (riskPerShare < EPSILON) return null;

  // Rounded DOWN on purpose: rounding up would risk more than he actually
  // risks, which is the one direction this number must never err in.
  const shares =
    usualRisk !== null && usualRisk > 0
      ? Math.floor(usualRisk / riskPerShare)
      : null;

  return {
    direction: long ? 'LONG' : 'SHORT',
    riskPerShare: round(riskPerShare),
    rewardPerShare: round(rewardPerShare),
    riskReward: round(rewardPerShare / riskPerShare),
    sharesAtUsualRisk: shares,
    positionValueAtUsualRisk: shares !== null ? round(shares * entryPrice) : null,
  };
}

function round(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
