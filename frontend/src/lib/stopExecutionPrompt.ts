/**
 * Whether journalling this fill should ask the owner "was this a stop?".
 *
 * Only a fill that REDUCES an existing position can have executed a stop, so
 * the sign of the fill must oppose the sign of what is held: a sale against a
 * long, a covering buy against a short. Adding to a position never triggers
 * the question, however many tiers are recorded.
 *
 * `tierCount` gates it too, because with no recorded tiers there is nothing to
 * attribute the exit to, and asking would be a question with no useful answer.
 */
export function shouldAskAboutStop(input: {
  /** The fill being journalled: negative sells, positive buys. */
  signedQuantity: number;
  /** Shares held before this fill: negative is short, 0 is flat. */
  heldQuantity: number;
  /** Live stop tiers recorded against the position. */
  tierCount: number;
}): boolean {
  if (input.tierCount <= 0) return false;
  if (input.signedQuantity === 0 || input.heldQuantity === 0) return false;
  return input.signedQuantity > 0 !== input.heldQuantity > 0;
}

/**
 * The tier to pre-select: the one whose price sits nearest the fill.
 *
 * Mirrors `suggestTierForFill` in the backend's derive-trades.ts. The two sit
 * on opposite sides of an HTTP boundary and cannot share a module, so they
 * must be kept in step by hand — if they drift, the sheet will default to one
 * tier while the backend's own fallback picks another, and the owner would
 * never see the disagreement.
 *
 * Returns null when no tier has a resolvable price, which is every-tier-is-
 * trailing. A trailing tier's live price depends on the high-water mark since
 * entry, which this form does not have, and guessing it is how the MSTR exit
 * would have been misfiled as a stop it never reached. Null means "nothing
 * pre-selected", not "not a stop" — the owner still chooses.
 */
export function defaultTierId(
  tiers: Array<{ id: string; price: number | null; trailPercent: number | null }>,
  fillPrice: number,
): string | null {
  let best: { id: string; gap: number } | null = null;
  for (const tier of tiers) {
    if (tier.price === null || !(tier.price > 0)) continue;
    const gap = Math.abs(tier.price - fillPrice);
    if (best === null || gap < best.gap) best = { id: tier.id, gap };
  }
  return best?.id ?? null;
}
