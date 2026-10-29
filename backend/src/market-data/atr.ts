export interface AtrBar {
  high: number | null;
  low: number | null;
  close: number;
}

/**
 * Wilder's average true range, bars oldest to newest.
 *
 * True range = max(high - low, |high - prevClose|, |low - prevClose|). The
 * first ATR is the simple mean of the first `period` true ranges; every later
 * bar smooths it: ATR = (prevATR * (period - 1) + TR) / period. Needs
 * `period + 1` bars (the first only supplies a previous close). Null when
 * there are too few bars or any bar lacks its high or low.
 *
 * (The parked lib/market-data/indicators.ts averaged only the last `period`
 * true ranges, a simple mean rather than Wilder's smoothing.)
 */
export function wilderAtr(bars: AtrBar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  let atr = 0;
  for (let i = 1; i < bars.length; i++) {
    const { high, low } = bars[i];
    if (high === null || low === null) return null;
    const prevClose = bars[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    atr = i <= period ? atr + tr / period : (atr * (period - 1) + tr) / period;
  }
  return atr;
}
