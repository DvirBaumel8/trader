import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { Money } from '../components/Money';
import { signClass } from '../components/format';
import {
  TradeChart,
  type Fill,
  type StopLevel,
} from '../components/TradeChart';
import type { Bar } from '../lib/candleScale';
import type { Trade } from '../components/TradeCard';

interface TradeDetailResponse {
  trade: Trade;
  fills: Fill[];
  stopLevels: StopLevel[];
  bars: Bar[];
  lastBarDate: string | null;
}

export function TradeDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ['trade', id],
    queryFn: () =>
      api<TradeDetailResponse>(`/portfolio/trades/${encodeURIComponent(id)}`),
    retry: false,
  });

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;

  // A trade id goes stale when its opening transaction is edited — the trade
  // still exists, under a different id. Say so rather than drawing nothing.
  if (error instanceof ApiError && error.status === 404) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">
          This trade no longer exists — it may have been edited since you opened
          it.
        </p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-sm text-accent"
        >
          Back
        </button>
      </div>
    );
  }
  if (!data) return <p className="text-sm text-down">Couldn’t load this trade.</p>;

  const { trade, fills, stopLevels, bars, lastBarDate } = data;
  const trailing = stopLevels.filter((s) => s.kind === 'TRAILING');

  // The backfill is manual, so the window can end before the trade does.
  // Never present a truncated chart as the whole story.
  const staleThrough =
    lastBarDate !== null &&
    ((trade.exitedAt !== null && lastBarDate < trade.exitedAt.slice(0, 10)) ||
      (trade.exitedAt === null &&
        lastBarDate < new Date().toISOString().slice(0, 10)))
      ? lastBarDate
      : null;

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="text-sm text-muted"
      >
        ← Back
      </button>

      <header className="space-y-1">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold text-text">{trade.symbol}</h1>
          <span className="text-xs text-muted">
            {trade.direction}
            {trade.isOpen ? ' · open' : ''}
          </span>
        </div>
        <div className={`text-2xl font-semibold ${signClass(trade.realizedPnl)}`}>
          <Money value={trade.realizedPnl} />
        </div>
        <p className="text-xs text-muted">
          {trade.rMultiple !== null && `${trade.rMultiple.toFixed(2)}R · `}
          entry <Money value={trade.avgEntry} />
          {trade.avgExit !== null && (
            <>
              {' '}
              · exit <Money value={trade.avgExit} />
            </>
          )}
          {trade.holdingDays !== null && ` · held ${trade.holdingDays}d`}
        </p>
      </header>

      <TradeChart bars={bars} fills={fills} stopLevels={stopLevels} />

      {trailing.length > 0 && (
        <p className="text-xs text-muted">
          {trailing.length === 1 ? 'A trailing stop' : 'Trailing stops'} of{' '}
          {trailing.map((s) => `${s.trailPercent}%`).join(', ')} — not drawn,
          because the level moved with price.
        </p>
      )}

      {staleThrough && (
        <p className="text-xs text-muted">
          Price history only runs to {staleThrough}. The backfill is manual —
          run it to see the rest of this trade.
        </p>
      )}
    </div>
  );
}
