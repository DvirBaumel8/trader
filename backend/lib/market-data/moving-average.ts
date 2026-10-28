/**
 * Simple or exponential moving average of the last `period` closes.
 *
 * Null when there are fewer closes than the period: averaging what history
 * exists would be a plausible number that is not the thing it claims to be.
 * Pure; the caller supplies closes oldest first.
 */
export function movingAverage(
  closes: number[],
  period: number,
  kind: 'SMA' | 'EMA',
): number | null {
  if (!(period > 0) || closes.length < period) return null;
  if (kind === 'SMA') {
    const window = closes.slice(-period);
    return window.reduce((sum, c) => sum + c, 0) / period;
  }
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((sum, c) => sum + c, 0) / period;
  for (const close of closes.slice(period)) ema = close * k + ema * (1 - k);
  return ema;
}
