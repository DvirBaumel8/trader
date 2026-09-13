import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { formatMoney, signClass } from '../components/format';
import { TradeCard, type Trade } from '../components/TradeCard';
import { SymbolPatternCard } from '../components/SymbolPatternCard';
import { Stat } from '../components/ui/Stat';
import { RangeSelector } from '../components/ui/RangeSelector';
import type { Range } from '../lib/benchmarkRange';

interface SymbolSummary {
  symbol: string;
  closedCount: number;
  openCount: number;
  winRate: number | null;
  totalPnl: number | null;
  avgPositionSize: number | null;
  avgHoldingDays: number | null;
  feesPaid: number;
  trades: Trade[];
}

/**
 * One ticker's whole story over a chosen period — the first screen whose
 * whole subject is a single symbol, reached from the Trades tab's index.
 */
export function StockDetail() {
  const { symbol = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [range, setRange] = useState<Range>('ALL');

  // Same "nowhere to go" case TradeDetail's own goBack handles: a reload or
  // a home-screen PWA opening straight onto this URL leaves no history.
  const goBack = () => {
    if (location.key === 'default') navigate('/stocks');
    else navigate(-1);
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['symbol', symbol, range],
    queryFn: () =>
      api<SymbolSummary>(
        `/portfolio/symbols/${encodeURIComponent(symbol)}?range=${range}`,
      ),
    retry: false,
  });

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;

  if (error instanceof ApiError && error.status === 404) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">
          No trades in {symbol.toUpperCase()} at all.
        </p>
        <button type="button" onClick={goBack} className="text-sm text-accent">
          Back
        </button>
      </div>
    );
  }
  if (!data) return <p className="text-sm text-down">Couldn’t load {symbol}.</p>;

  return (
    <div className="space-y-4">
      <button type="button" onClick={goBack} className="text-sm text-muted">
        ← Back
      </button>

      <h1 className="text-lg font-semibold text-text">{data.symbol}</h1>

      <RangeSelector range={range} onRangeChange={setRange} />

      {data.closedCount === 0 ? (
        <p className="text-sm text-muted">No trades closed in this period.</p>
      ) : (
        <>
          <div className="flex gap-2">
            <Stat
              label="Win rate"
              value={`${Math.round((data.winRate ?? 0) * 100)}%`}
              sub={`${data.closedCount} closed`}
            />
            <Stat
              label="Total P&L"
              value={formatMoney(data.totalPnl, { signed: true })}
              tone={signClass(data.totalPnl)}
            />
          </div>
          <div className="flex gap-2">
            <Stat label="Avg position" value={formatMoney(data.avgPositionSize)} />
            <Stat
              label="Avg hold (days)"
              value={
                data.avgHoldingDays !== null
                  ? `${data.avgHoldingDays.toFixed(1)}d`
                  : '—'
              }
            />
            <Stat label="Fees paid" value={formatMoney(data.feesPaid)} />
          </div>

          <SymbolPatternCard symbol={data.symbol} range={range} />
        </>
      )}

      {data.trades.length > 0 && (
        <ul>
          {data.trades.map((t) => (
            <TradeCard key={`${t.symbol}-${t.enteredAt}`} trade={t} />
          ))}
        </ul>
      )}
    </div>
  );
}
