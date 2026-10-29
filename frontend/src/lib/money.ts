export const DASH = '\u2014';
const MINUS = '\u2212';

/** `$1.2T`, `$96.2B`, `$850M`; a real minus sign for negatives; an em dash for null. */
export function formatMoney(n: number | null): string {
  if (n === null) return DASH;
  const sign = n < 0 ? MINUS : '';
  const abs = Math.abs(n);
  let body: string;
  if (abs >= 1e12) body = `${(abs / 1e12).toFixed(1)}T`;
  else if (abs >= 1e9 || Math.round(abs / 1e6) >= 1000) body = `${(abs / 1e9).toFixed(1)}B`;
  else if (abs >= 1e6) body = `${Math.round(abs / 1e6)}M`;
  else body = Math.round(abs).toLocaleString('en-US');
  return `${sign}$${body}`;
}

export function formatEps(n: number | null): string {
  if (n === null) return DASH;
  return `${n < 0 ? MINUS : ''}${Math.abs(n).toFixed(2)}`;
}
