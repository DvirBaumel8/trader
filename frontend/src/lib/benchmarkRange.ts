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
