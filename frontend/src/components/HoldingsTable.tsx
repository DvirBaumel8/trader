import { useState, type Ref } from 'react';
import { DataTable, type Column, type TableSort } from './ui/DataTable';
import { Money } from './Money';
import { Percent } from './Percent';
import { SessionBadge } from './SessionBadge';
import { EarningsBadge } from './EarningsBadge';
import { formatMoney, formatMoneyCompact, formatQuantity } from './format';
import { sanitizeSort, sortPositions, type SortDir, type SortKey } from '../lib/sortPositions';
import { loadDraft, saveDraft } from '../lib/draftStorage';

type Session = 'PRE' | 'REGULAR' | 'POST' | 'OVERNIGHT' | 'CLOSED' | null;

export interface Position {
  symbol: string;
  name: string | null;
  quantity: number;
  avgCost: number;
  costBasis: number;
  feesPaid: number;
  realizedPnl: number;
  price: number | null;
  stale: boolean;
  session: Session;
  extended: boolean;
  regularPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPct: number | null;
  dayChange: number | null;
  dayChangePct: number | null;
  dayPnl: number | null;
  tradeId: string | null;
  daysUntilEarnings: number | null;
}

export interface PortfolioTotals {
  marketValue: number | null;
  dayPnl: number | null;
  unrealizedPnl: number | null;
}

const SORT_KEY = 'trader.holdingsSort.v1';
/** Biggest position first: the most useful default for a working trader. */
const DEFAULT_SORT: { key: SortKey; dir: SortDir } = { key: 'marketValue', dir: 'desc' };

/** Sorts no header shows. Headers cover symbol, value, day P&L and P&L $. */
const MORE_SORTS: (TableSort & { label: string })[] = [
  { key: 'unrealizedPct', dir: 'desc', label: 'P&L % — best first' },
  { key: 'unrealizedPct', dir: 'asc', label: 'P&L % — worst first' },
  { key: 'marketValue', dir: 'desc', label: 'Value — largest first' },
  { key: 'daysUntilEarnings', dir: 'asc', label: 'Earnings — soonest first' },
  { key: 'symbol', dir: 'asc', label: 'Symbol — A to Z' },
];

const BADGE = 'rounded px-1 py-px text-[9px] font-medium tracking-wide';
function SymbolCell({ p }: { p: Position }) {
  const e = p.daysUntilEarnings;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="font-semibold">{p.symbol}</span>
      {p.quantity < 0 && <span className={`${BADGE} bg-down/15 text-down`}>SHORT</span>}
      {p.stale && <span className={`${BADGE} text-down`}>STALE</span>}
      {e !== null && <EarningsBadge days={e} />}
    </span>
  );
}

const COLUMNS: Column<Position>[] = [
  {
    id: 'symbol',
    header: 'Symbol',
    align: 'left',
    sortKey: 'symbol',
    firstDir: 'asc',
    primary: (p) => <SymbolCell p={p} />,
    secondary: (p) => `${formatQuantity(p.quantity)} @ ${formatMoney(p.avgCost)}`,
  },
  {
    id: 'last',
    header: 'Last',
    align: 'right',
    sortKey: 'marketValue',
    primary: (p) => <Money value={p.price} />,
    secondary: (p) => formatMoneyCompact(p.marketValue),
  },
  {
    id: 'day',
    header: 'Day',
    align: 'right',
    sortKey: 'dayPnl',
    primary: (p) => <Money value={p.dayChange} signed colored />,
    secondary: (p) => <Percent value={p.dayChangePct} />,
  },
  {
    id: 'pnl',
    header: 'P&L',
    align: 'right',
    sortKey: 'unrealizedPnl',
    primary: (p) => <Money value={p.unrealizedPnl} signed colored />,
    secondary: (p) => <Percent value={p.unrealizedPct} />,
  },
];

/**
 * The portfolio as a table, like a broker's positions screen: one header,
 * two-line cells, and no field names inside rows (the owner's original
 * complaint was "Qty" repeated once per ticker). Extended-hours prices are
 * labeled once in the title, not per row.
 */
export function HoldingsTable({
  positions,
  totals,
  marketSession,
  pricesAreExtended,
  focusedSymbol,
  focusedRef,
}: {
  positions: Position[];
  totals: PortfolioTotals;
  marketSession: Session;
  pricesAreExtended: boolean;
  focusedSymbol: string | null;
  focusedRef?: Ref<HTMLSpanElement>;
}) {
  const [sort, setSort] = useState(() =>
    sanitizeSort(loadDraft(SORT_KEY, DEFAULT_SORT), DEFAULT_SORT),
  );
  const changeSort = (s: TableSort) => {
    const next = sanitizeSort(s, DEFAULT_SORT);
    setSort(next);
    saveDraft(SORT_KEY, next);
  };
  const count = positions.length;

  return (
    <DataTable<Position>
      title={
        <>
          <span className="text-xs tracking-wide text-text/70 uppercase">Holdings</span>
          {/* `GET /portfolio` already filters to open positions; shorts count too. */}
          <span className="text-xs text-muted">
            {count} {count === 1 ? 'position' : 'positions'}
          </span>
          <SessionBadge session={marketSession} extended={pricesAreExtended} />
        </>
      }
      columns={COLUMNS}
      rows={sortPositions(positions, sort.key, sort.dir)}
      rowKey={(p) => p.symbol}
      rowHref={(p) => (p.tradeId !== null ? `/trades/${encodeURIComponent(p.tradeId)}` : null)}
      rowTestId={(p) => `holding-${p.symbol}`}
      sort={sort}
      onSortChange={changeSort}
      moreSorts={MORE_SORTS}
      focusedKey={focusedSymbol}
      focusedRef={focusedRef}
      totals={
        count === 0
          ? undefined
          : [
              <span key="t" className="text-muted">
                Total
              </span>,
              formatMoneyCompact(totals.marketValue),
              <Money key="d" value={totals.dayPnl} signed colored />,
              <Money key="p" value={totals.unrealizedPnl} signed colored />,
            ]
      }
    />
  );
}
