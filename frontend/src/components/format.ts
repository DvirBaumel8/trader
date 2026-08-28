export function formatMoney(
  value: number | null | undefined,
  opts: { signed?: boolean } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const abs = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (value < 0) return `-$${abs}`;
  return opts.signed ? `+$${abs}` : `$${abs}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${(Math.abs(value) * 100).toFixed(2)}%`;
}

/** Colour always means one thing: green up, red down, muted flat or unknown. */
export function signClass(value: number | null | undefined): string {
  if (
    value === null ||
    value === undefined ||
    Number.isNaN(value) ||
    value === 0
  ) {
    return 'text-muted';
  }
  return value > 0 ? 'text-up' : 'text-down';
}
