import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Money } from '../components/Money';
import { Percent } from '../components/Percent';
import { signClass } from '../components/format';

interface Position {
  symbol: string;
  name: string | null;
  quantity: number;
  avgCost: number;
  costBasis: number;
  feesPaid: number;
  realizedPnl: number;
  price: number | null;
  stale: boolean;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPct: number | null;
}

interface Portfolio {
  positions: Position[];
  cash: number;
  positionsValue: number;
  accountValue: number;
  hasStalePrices: boolean;
}

function PositionRow({ p }: { p: Position }) {
  return (
    <li className="flex items-center justify-between border-b border-border py-3 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{p.symbol}</span>
          {p.quantity < 0 && (
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] tracking-wide text-muted">
              SHORT
            </span>
          )}
          {p.stale && <span className="text-[10px] text-down">stale</span>}
        </div>
        <div className="truncate text-xs text-muted">
          {p.quantity} @ <Money value={p.avgCost} />
        </div>
      </div>
      <div className="text-right">
        <div className="font-medium">
          <Money value={p.marketValue} />
        </div>
        <div className="text-xs">
          <Percent value={p.unrealizedPct} />{' '}
          <span className={signClass(p.unrealizedPnl)}>
            (<Money value={p.unrealizedPnl} signed />)
          </span>
        </div>
      </div>
    </li>
  );
}

export function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => api<Portfolio>('/portfolio'),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return <p className="text-sm text-muted">Loading…</p>;
  }
  if (error) {
    return <p className="text-sm text-down">{(error as Error).message}</p>;
  }
  if (!data || data.positions.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">No portfolio yet.</p>
        <Link
          to="/seed"
          className="inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface-0"
        >
          Seed your portfolio
        </Link>
      </div>
    );
  }

  const totalUnrealized = data.positions.reduce(
    (sum, p) => sum + (p.unrealizedPnl ?? 0),
    0,
  );

  return (
    <div className="space-y-6">
      <section>
        <div className="text-xs uppercase tracking-wide text-muted">
          Account value
        </div>
        <div className="mt-1 text-4xl font-semibold">
          <Money value={data.accountValue} />
        </div>
        <div className="mt-1 text-sm">
          <span className={signClass(totalUnrealized)}>
            <Money value={totalUnrealized} signed /> unrealized
          </span>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-surface-1 p-3">
          <div className="text-xs text-muted">Cash</div>
          <div
            className={`mt-1 text-lg font-medium ${data.cash < 0 ? 'text-down' : ''}`}
          >
            <Money value={data.cash} />
          </div>
          {data.cash < 0 && (
            <div className="text-[10px] tracking-wide text-down">ON MARGIN</div>
          )}
        </div>
        <div className="rounded-xl border border-border bg-surface-1 p-3">
          <div className="text-xs text-muted">Deployed</div>
          <div className="mt-1 text-lg font-medium">
            <Money value={data.positionsValue} />
          </div>
        </div>
      </section>

      <section>
        <div className="mb-1 text-xs uppercase tracking-wide text-muted">
          Holdings
        </div>
        <ul>
          {data.positions.map((p) => (
            <PositionRow key={p.symbol} p={p} />
          ))}
        </ul>
      </section>
    </div>
  );
}
