import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { Money } from '../components/Money';
import { formatQuantity, signClass } from '../components/format';
import {
  TradeChart,
  type Fill,
  type StopLevel,
} from '../components/TradeChart';
import { unresolvedTrailingStops } from '../lib/stopSummary';
import { StopPlanEditor } from '../components/StopPlanEditor';
import type { Bar } from '../lib/candleScale';
import type { Trade } from '../components/TradeCard';

interface TradeDetailResponse {
  trade: Trade & {
    // Null for a closed trade — nothing left to protect, nothing to price
    // from. See StopPlanEditor's `priceFrom` doc comment.
    currentPrice: number | null;
    highWaterPrice: number | null;
    /** The level aimed for, recorded at entry. Null when none was set. */
    plannedTarget: number | null;
  };
  fills: Fill[];
  stopLevels: StopLevel[];
  bars: Bar[];
  lastBarDate: string | null;
}

/**
 * Only the fields this screen needs from a position — the full shape lives
 * in `Dashboard.tsx`. An open trade's live P&L and current size come from
 * here, not from the trade-detail endpoint, which has no price feed of its
 * own: `tradeId` is what Task 2 added to `GET /portfolio` precisely so a
 * position and its open trade can be matched up without a new endpoint.
 */
interface Position {
  tradeId: string | null;
  quantity: number;
  unrealizedPnl: number | null;
}

/**
 * The most recent trading day strictly before `now` — i.e. the last session
 * that should already have a bar, assuming the backfill has run at all
 * since it happened. Today's own session may not have closed yet (or the
 * manual backfill may not have run since it did), so today is never the
 * thing to compare against — only warn once a *prior* session is missing.
 * Not holiday-aware (no holiday calendar), but that is a rarer false
 * positive than firing every single day, which is the bug this replaces.
 */
function priorTradingDay(now: Date): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  do {
    d.setUTCDate(d.getUTCDate() - 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
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

  // An open trade's unrealized P&L and current size live on its matching
  // position, not on the trade itself — `GET /portfolio` is already fetched
  // (and cached) by the Portfolio tab most of the time, so this is usually
  // a cache hit, not a new round trip.
  const isOpenTrade = data?.trade.isOpen === true;
  const { data: portfolio } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => api<{ positions: Position[] }>('/portfolio'),
    enabled: isOpenTrade,
  });
  const position = portfolio?.positions.find((p) => p.tradeId === id) ?? null;

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
  // Only a trailing tier the backend still can't resolve to a level (no
  // high-water data yet) keeps this text-only treatment — one that has
  // resolved is now drawn on the chart itself (see TradeChart.tsx) and
  // named in its stop-summary line instead, so listing it again here would
  // be redundant and wrongly imply it isn't drawn.
  const unresolvedTrailing = unresolvedTrailingStops(stopLevels);

  // The backfill is manual, so the window can end before the trade does.
  // Never present a truncated chart as the whole story. For an open trade,
  // "expected" means the last session that should already be backfilled —
  // today's own bar may not exist yet regardless of how current the
  // backfill is, so today itself is never the threshold.
  const staleThrough =
    lastBarDate !== null &&
    ((trade.exitedAt !== null && lastBarDate < trade.exitedAt.slice(0, 10)) ||
      (trade.exitedAt === null &&
        lastBarDate < priorTradingDay(new Date())))
      ? lastBarDate
      : null;

  const daysHeldSoFar = trade.isOpen
    ? Math.max(
        0,
        Math.floor(
          (new Date().getTime() - new Date(trade.enteredAt).getTime()) /
            86_400_000,
        ),
      )
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

        {trade.isOpen ? (
          // realizedPnl is null by design for an open trade — an empty
          // muted "—" here would look broken on 18 of the owner's 21
          // positions. Show live unrealized P&L when the matching position
          // has one; otherwise show no hero number at all rather than a
          // placeholder that looks like missing data.
          position &&
          position.unrealizedPnl !== null && (
            <div
              className={`text-2xl font-semibold ${signClass(position.unrealizedPnl)}`}
            >
              <Money value={position.unrealizedPnl} signed />
              <span className="ml-1 text-sm font-normal text-muted">
                unrealized
              </span>
            </div>
          )
        ) : (
          <div className={`text-2xl font-semibold ${signClass(trade.realizedPnl)}`}>
            <Money value={trade.realizedPnl} />
          </div>
        )}

        <p className="text-xs text-muted">
          {trade.isOpen ? (
            <>
              {formatQuantity(position?.quantity ?? trade.quantity)} · entry{' '}
              <Money value={trade.avgEntry} />
              {daysHeldSoFar !== null && ` · ${daysHeldSoFar}d so far`}
            </>
          ) : (
            <>
              {trade.rMultiple !== null && `${trade.rMultiple.toFixed(2)}R · `}
              entry <Money value={trade.avgEntry} />
              {trade.avgExit !== null && (
                <>
                  {' '}
                  · exit <Money value={trade.avgExit} />
                </>
              )}
              {trade.holdingDays !== null && ` · held ${trade.holdingDays}d`}
            </>
          )}
        </p>
      </header>

      {/*
        Keyed on the trade id so opening a different trade is a fresh mount —
        its replay position resets for free instead of via an effect racing
        the first paint. See the `step` state's doc comment in TradeChart.
      */}
      <TradeChart
        key={id}
        bars={bars}
        fills={fills}
        stopLevels={stopLevels}
        plannedTarget={trade.plannedTarget}
      />

      {/*
        Only an OPEN trade gets an editable plan: a stop on a position that no
        longer exists protects nothing, and letting one be edited would invite
        exactly the drift the Stops page flags.
      */}
      {trade.isOpen && (
        <StopPlanEditor
          tradeId={id!}
          tiers={stopLevels}
          avgEntry={trade.avgEntry}
          // What is still HELD, not the total ever opened. Prefilling the
          // latter on a partly-exited position (1000 opened, 600 stopped,
          // 400 held) produces a plan covering 1000 shares, which
          // evaluateStopPlan flags as OVER_COVERED - dropping the position
          // out of the Stops list and leaving its risk unpriced.
          quantity={trade.remainingQuantity}
          direction={trade.direction}
          currentPrice={trade.currentPrice}
          highWaterPrice={trade.highWaterPrice}
        />
      )}

      {unresolvedTrailing.length > 0 && (
        <p className="text-xs text-muted">
          {unresolvedTrailing.length === 1
            ? 'A trailing stop'
            : 'Trailing stops'}{' '}
          of {unresolvedTrailing.map((s) => `${s.trailPercent}%`).join(', ')}{' '}
          — not drawn yet, because there isn't enough price history since
          entry to know where the level sits.
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
