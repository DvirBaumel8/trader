/**
 * Split out of `BenchmarkChart.tsx` so that file exports only the component —
 * Fast Refresh only hot-swaps a module that exports nothing else, and mixing
 * a component with constants forces a full reload on every edit instead.
 */
export type Range = '1W' | '1M' | '6M' | 'YTD' | '1Y' | 'ALL';

export const RANGES: { value: Range; label: string }[] = [
  { value: '1W', label: '1W' },
  { value: '1M', label: '1M' },
  { value: '6M', label: '6M' },
  { value: 'YTD', label: 'YTD' },
  { value: '1Y', label: '1Y' },
  { value: 'ALL', label: 'All' },
];

export interface Point {
  date: string;
  you: number | null;
  sp500: number | null;
  nasdaq: number | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A trailing wall-clock window, for filtering an activity list to "the last
 * N" — unlike `rangeStartDate` on the backend, this has no trading-calendar
 * awareness (no bar history to align to), and doesn't need one: an activity
 * either happened in the window or it didn't.
 */
export function rangeToDates(
  range: Range,
  now: Date = new Date(),
): { from: string; to: string } {
  if (range === 'ALL') return { from: '', to: '' };
  const to = isoDate(now);
  const from = new Date(now);
  switch (range) {
    case '1W':
      from.setDate(from.getDate() - 7);
      break;
    case '1M':
      from.setMonth(from.getMonth() - 1);
      break;
    case '6M':
      from.setMonth(from.getMonth() - 6);
      break;
    case 'YTD':
      from.setMonth(0, 1);
      break;
    case '1Y':
      from.setFullYear(from.getFullYear() - 1);
      break;
  }
  return { from: isoDate(from), to };
}
