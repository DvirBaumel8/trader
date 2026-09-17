import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Money } from '../components/Money';
import { signClass } from '../components/format';
import { RangeSelector } from '../components/ui/RangeSelector';
import { Select } from '../components/ui/Select';
import { inputClasses } from '../components/ui/inputClasses';
import { usePersistentState } from '../lib/persistentState';
import type { Range } from '../lib/benchmarkRange';
import {
  filterSymbols,
  sortSymbols,
  type SymbolRow,
  type SymbolSort,
} from '../lib/entryFilters';

const SORTS: { value: SymbolSort; label: string }[] = [
  { value: 'NEWEST', label: 'Newest first' },
  { value: 'OLDEST', label: 'Oldest first' },
  { value: 'LARGEST', label: 'P&L: biggest win' },
  { value: 'SMALLEST', label: 'P&L: biggest loss' },
  { value: 'FEES_HIGH', label: 'Fees: highest first' },
  { value: 'FEES_LOW', label: 'Fees: lowest first' },
  { value: 'TRADES_MOST', label: 'Trades: most first' },
  { value: 'TRADES_FEWEST', label: 'Trades: fewest first' },
];

const HEADER_CELL = 'text-[10px] tracking-wide text-muted uppercase';
// A row's own hover/tap feedback and vertical rhythm, applied per cell
// rather than to the row as a box — see the comment on the grid below for
// why there is no row box to put it on.
const ROW_CELL =
  'py-3 transition-colors group-hover:bg-surface-1 group-active:bg-surface-2';

/**
 * Pick a stock, see its whole story. One row per symbol with at least one
 * closed trade in the selected period — a ticker you only ever opened and
 * still hold does not belong here yet, since there is no outcome to
 * summarize.
 */
export function Stocks() {
  const [range, setRange] = useState<Range>('ALL');
  const [sort, setSort] = useState<SymbolSort>('NEWEST');
  const [search, setSearch] = useState('');
  // Which tickers are picked, on top of range/search — an empty list means
  // no pick was made, which reads as "every symbol", not "none".
  const [selected, setSelected] = usePersistentState<string[]>(
    'trader.stocks.selectedSymbols',
    [],
  );

  const { data, isLoading } = useQuery({
    queryKey: ['symbols', range],
    queryFn: () => api<SymbolRow[]>(`/portfolio/symbols?range=${range}`),
  });

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;
  const bySymbol = data ?? [];
  const bySelection =
    selected.length === 0
      ? bySymbol
      : bySymbol.filter((r) => selected.includes(r.symbol));
  const rows = sortSymbols(filterSymbols(bySelection, search), sort);

  const totalPnl = rows.reduce((sum, r) => sum + (r.totalPnl ?? 0), 0);
  const totalFees = rows.reduce((sum, r) => sum + r.feesPaid, 0);

  function toggleSymbol(symbol: string) {
    setSelected((prev) =>
      prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol],
    );
  }

  return (
    <div className="space-y-3">
      <RangeSelector range={range} onRangeChange={setRange} />

      {bySymbol.length === 0 ? (
        <p className="text-sm text-muted">
          {range === 'ALL'
            ? 'No closed trades yet. A ticker shows up here once you have closed at least one trade in it.'
            : 'No trades closed in this period.'}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <div className="min-w-[140px] flex-1 rounded-xl border border-border bg-surface-1 p-3">
              <div className="text-xs text-muted">Total P&amp;L</div>
              <div className={`mt-1 text-lg font-medium ${signClass(totalPnl)}`}>
                <Money value={totalPnl} signed className="total-pnl" />
              </div>
            </div>
            <div className="min-w-[140px] flex-1 rounded-xl border border-border bg-surface-1 p-3">
              <div className="text-xs text-muted">Total fees</div>
              <div className="mt-1 text-lg font-medium">
                <Money value={totalFees} className="total-fees" />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={selected.length === 0}
              onClick={() => setSelected([])}
              className={`rounded-lg border px-2 py-1 text-[11px] ${
                selected.length === 0
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border text-muted'
              }`}
            >
              All tickers
            </button>
            {[...bySymbol]
              .map((r) => r.symbol)
              .sort()
              .map((symbol) => (
                <button
                  key={symbol}
                  type="button"
                  aria-pressed={selected.includes(symbol)}
                  onClick={() => toggleSymbol(symbol)}
                  className={`rounded-lg border px-2 py-1 text-[11px] ${
                    selected.includes(symbol)
                      ? 'border-accent/40 bg-accent/10 text-accent'
                      : 'border-border text-muted'
                  }`}
                >
                  {symbol}
                </button>
              ))}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search symbol…"
              aria-label="Search symbol"
              className={inputClasses('sm', 'flex-1')}
            />
            <Select value={sort} onChange={setSort} options={SORTS} srLabel="Sort" />
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-muted">
              No symbol matches &quot;{search.trim()}&quot;.
            </p>
          ) : (
            /*
              Header and every row share ONE grid, not one each — a header
              and a body row built as separate grids auto-size their `auto`
              columns from their own content alone, so "Fees" lined up with
              one row's figure and drifted from the next the moment fee or
              P&L strings differed in width. A shared grid instance is the
              only way the three numeric columns size from the widest value
              across the whole table, header included.
              Each row is an `<a>` with `contents` so its cells become direct
              items of this grid with no extra nesting level; since that
              removes the row's own box, its hover/tap background moves onto
              every cell (via `group`) and the divider between rows becomes
              its own full-width grid item instead of a border on the row.
            */
            <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3">
              <span className={`px-0.5 ${HEADER_CELL}`}>Symbol</span>
              <span className={`text-right ${HEADER_CELL}`}>Closed</span>
              <span className={`text-right ${HEADER_CELL}`}>Fees</span>
              <span className={`text-right ${HEADER_CELL}`}>P&amp;L</span>

              {rows.map((r, i) => (
                <Fragment key={r.symbol}>
                  <Link
                    to={`/stocks/${encodeURIComponent(r.symbol)}`}
                    className="group contents"
                  >
                    <span className={`truncate text-[15px] font-semibold ${ROW_CELL}`}>
                      {r.symbol}
                    </span>
                    <span
                      className={`text-right text-[13px] tabular-nums text-muted ${ROW_CELL}`}
                    >
                      {r.closedCount}
                    </span>
                    <span
                      className={`text-right text-[13px] tabular-nums text-muted ${ROW_CELL}`}
                    >
                      <Money value={r.feesPaid} />
                    </span>
                    <span
                      className={`text-right text-[15px] font-semibold tabular-nums ${signClass(r.totalPnl)} ${ROW_CELL}`}
                    >
                      <Money value={r.totalPnl} signed />
                    </span>
                  </Link>
                  {i < rows.length - 1 && (
                    <div className="col-span-full border-b border-border" />
                  )}
                </Fragment>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
