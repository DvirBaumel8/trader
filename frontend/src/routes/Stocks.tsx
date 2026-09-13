import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Money } from '../components/Money';
import { signClass } from '../components/format';

interface SymbolRow {
  symbol: string;
  closedCount: number;
  totalPnl: number | null;
}

/**
 * Pick a stock, see its whole story. One row per symbol with at least one
 * closed trade — a ticker you only ever opened and still hold does not
 * belong here yet, since there is no outcome to summarize.
 */
export function Stocks() {
  const { data, isLoading } = useQuery({
    queryKey: ['symbols'],
    queryFn: () => api<SymbolRow[]>('/portfolio/symbols'),
  });

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;
  const rows = data ?? [];

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted">
        No closed trades yet. A ticker shows up here once you have closed at
        least one trade in it.
      </p>
    );
  }

  return (
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
  );
}
