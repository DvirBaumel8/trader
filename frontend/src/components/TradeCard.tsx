import { Link } from 'react-router-dom';
import { Money } from './Money';
import { Percent } from './Percent';
import { formatQuantity, signClass } from './format';

export interface Trade {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  quantity: number;
  avgEntry: number;
  avgExit: number | null;
  enteredAt: string;
  exitedAt: string | null;
  holdingDays: number | null;
  feesPaid: number;
  realizedPnl: number | null;
  isWin: boolean | null;
  isOpen: boolean;
  riskAmount: number | null;
  riskCoversFullPosition: boolean;
  rMultiple: number | null;
}

function held(days: number | null): string {
  if (days === null) return '';
  if (days === 0) return 'same day';
  return days === 1 ? '1 day' : `${days} days`;
}

/**
 * A closed round trip: what you did, and what it returned. The result is the
 * loudest thing on the row, because this screen exists to be scanned for
 * performance rather than read for detail.
 */
export function TradeCard({ trade }: { trade: Trade }) {
  const pctReturn =
    trade.realizedPnl !== null && trade.avgEntry > 0
      ? trade.realizedPnl / (trade.avgEntry * trade.quantity)
      : null;

  return (
    <li className="border-b border-border last:border-0">
      <Link
        to={`/trades/${encodeURIComponent(`${trade.symbol}:${trade.enteredAt}`)}`}
        className="block py-3 transition-colors hover:bg-surface-1 active:bg-surface-2"
      >
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="text-[15px] font-semibold">{trade.symbol}</span>
            {trade.direction === 'SHORT' && (
              <span className="rounded bg-down/15 px-1 py-px text-[9px] font-medium tracking-wide text-down">
                SHORT
              </span>
            )}
          </div>
          <div className={`text-[15px] font-semibold ${signClass(trade.realizedPnl)}`}>
            <Money value={trade.realizedPnl} signed />
          </div>
        </div>

        <div className="mt-0.5 flex items-baseline justify-between gap-3 text-[11px] text-muted">
          <span className="truncate">
            {formatQuantity(trade.quantity)} · <Money value={trade.avgEntry} />
            {trade.avgExit !== null && (
              <>
                {' → '}
                <Money value={trade.avgExit} />
              </>
            )}
            {trade.holdingDays !== null && ` · ${held(trade.holdingDays)}`}
          </span>
          <span className="shrink-0">
            {trade.rMultiple !== null ? (
              <span className={signClass(trade.rMultiple)}>
                {trade.rMultiple > 0 ? '+' : ''}
                {trade.rMultiple.toFixed(2)}R
              </span>
            ) : (
              <Percent value={pctReturn} />
            )}
          </span>
        </div>
      </Link>
    </li>
  );
}
