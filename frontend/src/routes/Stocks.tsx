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

function pickerLabel(selected: string[]): string {
  if (selected.length === 0) return 'All tickers';
  if (selected.length === 1) return selected[0];
  return `${selected.length} tickers`;
}

/**
 * A ticker's history can run to dozens of symbols, so this is a sheet, not a
 * row of pills stamped inline — a wall of small tap targets is exactly what
 * makes "select NVDA" occasionally register on AMD next to it. It also
 * replaces the standalone search box the list used to have of its own:
 * one search here, one filter, rather than two that silently combine and
 * leave a picked ticker sitting selected while an unrelated typed search
 * empties the list with no visible explanation.
 *
 * Left mounted (rather than conditionally rendered by the caller) so its own
 * search draft is exactly what `EntrySheet` already does for the same
 * reason: hooks stay in one place, and `open` alone decides visibility.
 */
function TickerPickerSheet({
  open,
  onClose,
  symbols,
  selected,
  onToggle,
  onClearAll,
}: {
  open: boolean;
  onClose: () => void;
  symbols: SymbolRow[];
  selected: string[];
  onToggle: (symbol: string) => void;
  onClearAll: () => void;
}) {
  const [search, setSearch] = useState('');
  if (!open) return null;

  const filtered = filterSymbols(symbols, search);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60">
      <button type="button" aria-label="Close" onClick={onClose} className="flex-1" />
      <div className="flex max-h-[80vh] flex-col rounded-t-2xl border-t border-border bg-surface-0">
        <div className="space-y-3 p-4 pb-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Tickers</span>
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-medium text-accent"
            >
              Done
            </button>
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search symbol…"
            aria-label="Search symbol"
            className={inputClasses('sm', 'w-full')}
          />
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-6">
          <button
            type="button"
            onClick={onClearAll}
            className={`flex w-full items-center justify-between rounded-lg px-2 py-3 text-sm ${
              selected.length === 0 ? 'font-medium text-accent' : 'text-text'
            }`}
          >
            All tickers
            {selected.length === 0 && <span aria-hidden="true">✓</span>}
          </button>
          <div className="my-1 border-b border-border" />
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted">
              No symbol matches &quot;{search.trim()}&quot;.
            </p>
          ) : (
            filtered.map((r) => (
              <label
                key={r.symbol}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-3 text-sm"
              >
                {r.symbol}
                <input
                  type="checkbox"
                  checked={selected.includes(r.symbol)}
                  onChange={() => onToggle(r.symbol)}
                  className="h-4 w-4 accent-accent"
                />
              </label>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Pick a stock, see its whole story. One row per symbol with at least one
 * closed trade in the selected period — a ticker you only ever opened and
 * still hold does not belong here yet, since there is no outcome to
 * summarize.
 */
export function Stocks() {
  const [range, setRange] = useState<Range>('ALL');
  const [sort, setSort] = useState<SymbolSort>('NEWEST');
  const [pickerOpen, setPickerOpen] = useState(false);
  // Which tickers are picked — an empty list means no pick was made, which
  // reads as "every symbol", not "none".
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
  const rows = sortSymbols(bySelection, sort);

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

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className={`${inputClasses('sm', 'flex-1')} flex items-center justify-between text-left`}
            >
              <div className="truncate">{pickerLabel(selected)}</div>
              <span aria-hidden="true" className="shrink-0 text-[9px] text-muted">
                ▼
              </span>
            </button>
            <Select value={sort} onChange={setSort} options={SORTS} srLabel="Sort" />
          </div>

          <TickerPickerSheet
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            symbols={bySymbol}
            selected={selected}
            onToggle={toggleSymbol}
            onClearAll={() => setSelected([])}
          />

          {rows.length === 0 ? (
            <p className="text-sm text-muted">
              No trades for the picked ticker{selected.length === 1 ? '' : 's'} in this
              period.
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
