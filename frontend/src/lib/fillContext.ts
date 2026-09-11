import type { TradeSide } from './entryDraft';

/** Just enough of a derived position for the composer to reason about. */
export interface HeldPosition {
  symbol: string;
  quantity: number;
}

export interface FillContext {
  /** Signed net quantity held, 0 when the symbol is not in the portfolio. */
  held: number;
  /** True when this fill REDUCES what is held — a sell of a long, a buy of a short. */
  closing: boolean;
  /** The magnitude to prefill, as an input value; null when nothing to offer. */
  suggested: string | null;
}

/**
 * Fractional share counts make exact zero unreliable, so "holds nothing" is a
 * band rather than a point. Mirrors the backend's REVISION_EPSILON.
 */
const EPSILON = 1e-8;

/**
 * Which side of a position a fill lands on, and how much of it is there.
 *
 * This decides WHICH reason chips to show and what to prefill — display
 * choices. The enforcing copy of the same rule lives in the backend's
 * `validateExitAttribution`, and that one is authoritative: drift here shows
 * the wrong chips, never a wrong number.
 *
 * Quantities come from the derived portfolio, so this never does arithmetic
 * on money — only a sign test on a figure the backend computed.
 */
export function fillContext(
  positions: HeldPosition[] | undefined,
  symbol: string,
  side: TradeSide,
): FillContext {
  const wanted = symbol.trim().toUpperCase();
  const held =
    positions?.find((p) => p.symbol.toUpperCase() === wanted)?.quantity ?? 0;
  const closing =
    (side === 'SELL' && held > EPSILON) || (side === 'BUY' && held < -EPSILON);
  return {
    held,
    closing,
    suggested: closing ? String(Math.abs(held)) : null,
  };
}
