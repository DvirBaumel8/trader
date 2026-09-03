import type { RawBar } from './yahoo.client.js';

/**
 * Chart facts about a ticker, computed from bars the app fetched — the
 * numbers a trader would read off a chart before deciding.
 *
 * Every field is null when it cannot be computed honestly: a name with four
 * months of history has no 200-day average, and a bar without a high has no
 * true range. Extrapolating would produce a plausible number that is not the
 * thing it claims to be, which is the failure this codebase exists to avoid.
 *
 * Pure and dependency-free in the style of `derive.ts` and `risk.ts`: no
 * database, no network, fixture-tested. The caller does the I/O.
 */
export interface IndicatorSet {
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  /** Signed fraction of the average: 0.1 means price is 10% above it. */
  percentFromSma20: number | null;
  percentFromSma50: number | null;
  percentFromSma200: number | null;
  high52w: number | null;
  low52w: number | null;
  /** Negative below the high; positive above the low. */
  percentFromHigh52w: number | null;
  percentFromLow52w: number | null;
  atr14: number | null;
  /** ATR as a fraction of the current price — a volatility yardstick a stop can be judged against. */
  atrPercentOfPrice: number | null;
  /** Latest bar's volume against the average of the 20 before it. */
  relativeVolume: number | null;
  /** How much history this was computed from, so a caller can say "thin". */
  barsAvailable: number;
}

const TRADING_DAYS_IN_YEAR = 252;
const VOLUME_LOOKBACK = 20;
const ATR_PERIOD = 14;

function sma(bars: RawBar[], period: number): number | null {
  if (bars.length < period) return null;
  const window = bars.slice(-period);
  return window.reduce((sum, b) => sum + b.close, 0) / period;
}

function fraction(price: number, level: number | null): number | null {
  if (level === null || !(level > 0)) return null;
  return (price - level) / level;
}

export function computeIndicators(
  bars: RawBar[],
  currentPrice: number,
): IndicatorSet {
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const year = sorted.slice(-TRADING_DAYS_IN_YEAR);

  const sma20 = sma(sorted, 20);
  const sma50 = sma(sorted, 50);
  const sma200 = sma(sorted, 200);

  const highs = year.map((b) => b.high).filter((h): h is number => h !== null);
  const lows = year.map((b) => b.low).filter((l): l is number => l !== null);
  const high52w = highs.length > 0 ? Math.max(...highs) : null;
  const low52w = lows.length > 0 ? Math.min(...lows) : null;

  const atr14 = computeAtr(sorted, ATR_PERIOD);

  return {
    sma20,
    sma50,
    sma200,
    percentFromSma20: fraction(currentPrice, sma20),
    percentFromSma50: fraction(currentPrice, sma50),
    percentFromSma200: fraction(currentPrice, sma200),
    high52w,
    low52w,
    percentFromHigh52w: fraction(currentPrice, high52w),
    percentFromLow52w: fraction(currentPrice, low52w),
    atr14,
    atrPercentOfPrice:
      atr14 !== null && currentPrice > 0 ? atr14 / currentPrice : null,
    relativeVolume: computeRelativeVolume(sorted),
    barsAvailable: sorted.length,
  };
}

/**
 * Average true range. True range is the widest of the bar's own range and its
 * gap from the previous close — which is why a stop placed inside one ATR of
 * entry is inside a single ordinary day's movement.
 */
function computeAtr(bars: RawBar[], period: number): number | null {
  if (bars.length < period + 1) return null;
  const ranges: number[] = [];
  for (let i = bars.length - period; i < bars.length; i++) {
    const b = bars[i];
    const prev = bars[i - 1];
    if (b.high === null || b.low === null) return null;
    ranges.push(
      Math.max(
        b.high - b.low,
        Math.abs(b.high - prev.close),
        Math.abs(b.low - prev.close),
      ),
    );
  }
  return ranges.reduce((sum, r) => sum + r, 0) / ranges.length;
}

/** Latest bar's volume over the average of the `VOLUME_LOOKBACK` before it. */
function computeRelativeVolume(bars: RawBar[]): number | null {
  if (bars.length < VOLUME_LOOKBACK + 1) return null;
  const latest = bars[bars.length - 1].volume;
  if (latest === null || !(latest > 0)) return null;
  const priorBars = bars.slice(-(VOLUME_LOOKBACK + 1), -1);
  const priors = priorBars
    .map((b) => b.volume)
    .filter((v): v is number => v !== null && v > 0);
  if (priors.length < VOLUME_LOOKBACK) return null;
  const average = priors.reduce((sum, v) => sum + v, 0) / priors.length;
  return average > 0 ? latest / average : null;
}
