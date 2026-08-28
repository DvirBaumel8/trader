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
  kind: 'TRADE' | 'NOTE' | 'CASH' | 'DIVIDEND';
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
  dividend: { symbol: string; amount: number } | null;
  tags: { id: string; type: 'SETUP' | 'MISTAKE'; label: string }[];
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function EntryBody({ entry }: { entry: Entry }) {
  return (
    <div className="min-w-0 flex-1 space-y-1">
      {entry.trade && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${
              entry.trade.side === 'BUY'
                ? 'bg-up/15 text-up'
                : 'bg-down/15 text-down'
            }`}
          >
            {entry.trade.side}
          </span>
          <span className="text-[15px] font-semibold">
            {entry.trade.symbol}
          </span>
          <span className="text-xs text-muted">
            {formatQuantity(entry.trade.quantity)} @{' '}
            <Money value={entry.trade.price} />
          </span>
          {entry.trade.riskAmount !== null && (
            <span className="text-[11px] text-muted">
              · risk <Money value={entry.trade.riskAmount} />
            </span>
          )}
        </div>
      )}

      {entry.cash && (
        <div className="flex items-baseline gap-2 text-sm">
          <span className="text-muted">
            {entry.cash.direction === 'DEPOSIT' ? 'Deposit' : 'Withdraw'}
          </span>
          <Money value={entry.cash.amount} />
        </div>
      )}

      {entry.dividend && (
        <div className="flex items-baseline gap-2 text-sm">
          <span className="rounded bg-up/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-up">
            DIV
          </span>
          <span className="font-semibold">{entry.dividend.symbol}</span>
          <Money value={entry.dividend.amount} className="text-up" />
        </div>
      )}

      {entry.body && (
        <p className="text-sm leading-snug whitespace-pre-wrap">{entry.body}</p>
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
    </div>
  );
}

/**
 * Rows are inert until edit mode is switched on for the whole list. A dense
 * list is something you scroll past, so making every row permanently tappable
 * turns each scroll into a near-miss.
 */
export function EntryCard({
  entry,
  editMode,
  onOpen,
}: {
  entry: Entry;
  editMode: boolean;
  onOpen: (entry: Entry) => void;
}) {
  const label = entry.trade?.symbol ?? entry.dividend?.symbol ?? 'entry';

  if (!editMode) {
    return (
      <li className="border-b border-border py-3 last:border-0">
        <EntryBody entry={entry} />
      </li>
    );
  }

  return (
    <li className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => onOpen(entry)}
        aria-label={`Edit ${label}`}
        className="flex w-full items-center gap-3 py-3 text-left active:bg-surface-1"
      >
        <EntryBody entry={entry} />
        <span className="text-accent">
          <ChevronIcon />
        </span>
      </button>
    </li>
  );
}
