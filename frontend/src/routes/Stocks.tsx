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
  { value: 'LARGEST', label: 'P&L: biggest win' },
  { value: 'SMALLEST', label: 'P&L: biggest loss' },
  { value: 'FEES_HIGH', label: 'Fees: highest first' },
  { value: 'FEES_LOW', label: 'Fees: lowest first' },
];

// Three narrow numeric columns plus the symbol, which takes whatever is
// left. Named once, here, rather than once per label and once per row.
const GRID = 'grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3';

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

          {/*
            A header row names each column once, rather than every row
            repeating "closed" and "fees" down the whole list — the reason
            this moved off plain flex rows and onto a grid.
          */}
          <div
            className={`${GRID} px-0.5 text-[10px] tracking-wide text-muted uppercase`}
          >
            <span>Symbol</span>
            <span className="text-right">Closed</span>
            <span className="text-right">Fees</span>
            <span className="text-right">P&amp;L</span>
          </div>

          <ul>
            {rows.map((r) => (
              <li key={r.symbol} className="border-b border-border last:border-0">
                <Link
                  to={`/stocks/${encodeURIComponent(r.symbol)}`}
                  className={`${GRID} py-3 transition-colors hover:bg-surface-1 active:bg-surface-2`}
                >
                  <span className="truncate text-[15px] font-semibold">
                    {r.symbol}
                  </span>
                  <span className="text-right text-[13px] tabular-nums text-muted">
                    {r.closedCount}
                  </span>
                  <span className="text-right text-[13px] tabular-nums text-muted">
                    <Money value={r.feesPaid} />
                  </span>
                  <span
                    className={`text-right text-[15px] font-semibold tabular-nums ${signClass(r.totalPnl)}`}
                  >
                    <Money value={r.totalPnl} signed />
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
