/**
 * The preset windows shared by the benchmark chart and the Trades tab's
 * period totals — one picker, reused, rather than two screens each growing
 * their own idea of "1M".
 */
export type Range = '1W' | '1M' | '6M' | 'YTD' | '1Y' | 'ALL';

export const RANGES: Range[] = ['1W', '1M', '6M', 'YTD', '1Y', 'ALL'];

/**
 * The first date inside `range`, anchored at `latest`.
 *
 * `range === 'ALL'` returns `earliest` unchanged — the caller decides what
 * "no lower bound" means for its own data (the first daily-close bar ever
 * fetched, an account's opening date, whatever the domain actually has).
 * Everything else counts back from `latest`, which is deliberately a
 * parameter rather than "today": the benchmark chart anchors to the latest
 * fetched bar, not the calendar date, so a stale `daily_closes` table still
 * produces a consistent window instead of one that silently shrinks.
 */
export function rangeStartDate(range: Range, latest: string, earliest: string): string {
  if (range === 'ALL') return earliest;

  const anchor = new Date(latest);
  if (range === 'YTD') return `${anchor.getUTCFullYear()}-01-01`;
  if (range === '1W') {
    const from = new Date(anchor);
    from.setUTCDate(from.getUTCDate() - 7);
    return from.toISOString().slice(0, 10);
  }

  const months = range === '1M' ? 1 : range === '6M' ? 6 : 12;
  const from = new Date(anchor);
  from.setUTCMonth(from.getUTCMonth() - months);
  return from.toISOString().slice(0, 10);
}
