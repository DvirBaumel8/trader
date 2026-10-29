export const DASH = '\u2014';
const MINUS = '\u2212';

/**
 * `$1.2T`, `$96.2B`, `$850M`; a real minus sign for negatives; an em dash for null.
 * A non-USD currency code replaces the `$`: `TWD 1.5T`. No code means USD.
 */
export function formatMoney(n: number | null, currency: string | null = 'USD'): string {
  if (n === null) return DASH;
  const sign = n < 0 ? MINUS : '';
  const abs = Math.abs(n);
  const tenths = (n: number) => n.toFixed(1);
  let body: string;
  if (abs >= 1e12 || (abs >= 1e9 && tenths(abs / 1e9) === '1000.0')) body = `${tenths(abs / 1e12)}T`;
  else if (abs >= 1e9 || Math.round(abs / 1e6) >= 1000) body = `${tenths(abs / 1e9)}B`;
  else if (abs >= 1e6) body = `${Math.round(abs / 1e6)}M`;
  else body = Math.round(abs).toLocaleString('en-US');
  const unit = currency === null || currency === 'USD' ? '$' : `${currency} `;
  return `${sign}${unit}${body}`;
}

export function formatEps(n: number | null): string {
  if (n === null) return DASH;
  return `${n < 0 ? MINUS : ''}${Math.abs(n).toFixed(2)}`;
}
