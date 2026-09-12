import type { IndicatorSet } from '../market-data/indicators.js';

/**
 * The tape's indicator lines, shared between the trade-idea opinion and the
 * watchlist ranking — the two used to carry near-identical copies of this
 * block that had already drifted apart: the ranking added a thin-history
 * warning the trade idea lacked, and dropped the P/E line the trade idea
 * carried (P/E is restored by each caller separately, since it comes from
 * `FundamentalsService`/`TickerFacts.peRatio`, not from `IndicatorSet`).
 * One function now describes these indicators to the model, for both
 * features, so the two can no longer describe the same numbers differently.
 */

export const price = (n: number): string =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const pct = (n: number | null): string =>
  n === null ? 'n/a' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;

export const level = (n: number | null): string => (n === null ? 'n/a' : price(n));

/**
 * Unindented lines (`- ...`), so a caller can use them at the top level of a
 * flat list (the trade idea) or indent them under a header (the ranking's
 * per-candidate block).
 */
export function renderIndicatorLines(i: IndicatorSet): string[] {
  return [
    `- 20-day average: ${level(i.sma20)} (price is ${pct(i.percentFromSma20)} from it)`,
    `- 50-day average: ${level(i.sma50)} (price is ${pct(i.percentFromSma50)} from it)`,
    `- 150-day average (HIS trend indicator): ${level(i.sma150)} (price is ${pct(i.percentFromSma150)} from it)`,
    `- 200-day average: ${level(i.sma200)} (price is ${pct(i.percentFromSma200)} from it)`,
    `- 52-week high: ${level(i.high52w)} (price is ${pct(i.percentFromHigh52w)} from it)`,
    `- 52-week low: ${level(i.low52w)} (price is ${pct(i.percentFromLow52w)} from it)`,
    `- ATR(14): ${level(i.atr14)}${i.atrPercentOfPrice !== null ? ` — ${(i.atrPercentOfPrice * 100).toFixed(1)}% of price` : ''}`,
    `- Relative volume: ${i.relativeVolume !== null ? `${i.relativeVolume.toFixed(2)}x its 20-day average` : 'n/a'}`,
    `- History available: ${i.barsAvailable} daily bars${i.barsAvailable < 200 ? ' (thin — treat longer-window readings above as unreliable or absent)' : ''}`,
  ];
}
