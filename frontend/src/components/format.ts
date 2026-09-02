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

/**
 * Share counts, grouped. Ungrouped, 1800 and 18000 look alike at a glance —
 * which is exactly the mistake you do not want to make reading your own book.
 * Fractional shares keep their precision without trailing zero padding.
 */
export function formatQuantity(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  });
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${(Math.abs(value) * 100).toFixed(2)}%`;
}

/**
 * A compact local timestamp: just the time when it's today (e.g. "2:34 PM"),
 * date and time otherwise (e.g. "Aug 12, 2:34 PM") — so a summary from
 * earlier today doesn't carry a redundant date, but one from last week isn't
 * mistaken for today's.
 */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const isToday = date.toDateString() === new Date().toDateString();
  return isToday
    ? date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
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
