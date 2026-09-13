import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Money } from '../components/Money';
import { signClass } from '../components/format';
import { RangeSelector } from '../components/ui/RangeSelector';
import { Select } from '../components/ui/Select';
import type { Range } from '../lib/benchmarkRange';
import { sortSymbols, type SymbolRow, type SymbolSort } from '../lib/entryFilters';

const SORTS: { value: SymbolSort; label: string }[] = [
  { value: 'NEWEST', label: 'Newest first' },
  { value: 'OLDEST', label: 'Oldest first' },
  { value: 'LARGEST', label: 'Largest first' },
  { value: 'SMALLEST', label: 'Smallest first' },
];

/**
 * Pick a stock, see its whole story. One row per symbol with at least one
 * closed trade in the selected period — a ticker you only ever opened and
 * still hold does not belong here yet, since there is no outcome to
 * summarize.
 */
export function Stocks() {
  const [range, setRange] = useState<Range>('ALL');
  const [sort, setSort] = useState<SymbolSort>('NEWEST');

  const { data, isLoading } = useQuery({
    queryKey: ['symbols', range],
    queryFn: () => api<SymbolRow[]>(`/portfolio/symbols?range=${range}`),
  });

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;
  const rows = sortSymbols(data ?? [], sort);

  return (
    <div className="space-y-3">
      <RangeSelector range={range} onRangeChange={setRange} />

      {rows.length === 0 ? (
        <p className="text-sm text-muted">
          {range === 'ALL'
            ? 'No closed trades yet. A ticker shows up here once you have closed at least one trade in it.'
            : 'No trades closed in this period.'}
        </p>
      ) : (
        <>
          <div className="flex justify-end">
            <Select value={sort} onChange={setSort} options={SORTS} srLabel="Sort" />
          </div>
          <ul>
            {rows.map((r) => (
              <li key={r.symbol} className="border-b border-border last:border-0">
                <Link
                  to={`/stocks/${encodeURIComponent(r.symbol)}`}
                  className="flex items-baseline justify-between gap-3 py-3 transition-colors hover:bg-surface-1 active:bg-surface-2"
                >
                  <span className="text-[15px] font-semibold">{r.symbol}</span>
                  <span className="flex items-baseline gap-2">
                    <span className="text-[11px] text-muted">
                      {r.closedCount} closed
                    </span>
                    <span
                      className={`text-[15px] font-semibold ${signClass(r.totalPnl)}`}
                    >
                      <Money value={r.totalPnl} signed />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
