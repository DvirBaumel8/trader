import { Money } from './Money';
import { formatQuantity } from './format';

export interface StopLevel {
  kind: 'FIXED' | 'TRAILING';
  price: number | null;
  trailPercent: number | null;
  quantity: number;
}

export interface Entry {
  id: string;
  kind: 'TRADE' | 'NOTE' | 'CASH';
  body: string;
  occurredAt: string;
  trade: {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    fee: number;
    plannedTarget: number | null;
    stopLevels: StopLevel[];
    riskAmount: number | null;
  } | null;
  cash: { direction: 'DEPOSIT' | 'WITHDRAW'; amount: number } | null;
  tags: { id: string; type: 'SETUP' | 'MISTAKE'; label: string }[];
}

function TradeHeader({ trade }: { trade: NonNullable<Entry['trade']> }) {
  const buying = trade.side === 'BUY';
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${
          buying ? 'bg-up/15 text-up' : 'bg-down/15 text-down'
        }`}
      >
        {trade.side}
      </span>
      <span className="text-[15px] font-semibold">{trade.symbol}</span>
      <span className="text-xs text-muted">
        {formatQuantity(trade.quantity)} @ <Money value={trade.price} />
      </span>
      {trade.riskAmount !== null && (
        <span className="text-[11px] text-muted">
          · risk <Money value={trade.riskAmount} />
        </span>
      )}
    </div>
  );
}

export function EntryCard({
  entry,
  onOpen,
}: {
  entry: Entry;
  onOpen: (entry: Entry) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(entry)}
        className="w-full space-y-1.5 border-b border-border py-3 text-left last:border-0"
      >
        {entry.trade && <TradeHeader trade={entry.trade} />}

        {entry.cash && (
          <div className="flex items-baseline gap-2 text-sm">
            <span className="text-muted">
              {entry.cash.direction === 'DEPOSIT' ? 'Deposit' : 'Withdraw'}
            </span>
            <Money value={entry.cash.amount} />
          </div>
        )}

        {entry.body ? (
          <p className="text-sm leading-snug whitespace-pre-wrap">
            {entry.body}
          </p>
        ) : (
          entry.kind === 'TRADE' && (
            // Notes are optional but never silently absent — an unannotated
            // trade is exactly the thing this product exists to prevent.
            <p className="text-xs text-muted italic">
              No thesis recorded — tap to add
            </p>
          )
        )}

        {entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {entry.tags.map((t) => (
              <span
                key={t.id}
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  t.type === 'SETUP'
                    ? 'bg-surface-2 text-muted'
                    : 'bg-down/10 text-down'
                }`}
              >
                {t.label}
              </span>
            ))}
          </div>
        )}
      </button>
    </li>
  );
}
