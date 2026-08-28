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

function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/**
 * An explicit edit control rather than a whole-row button: the row is a dense
 * list item people scroll past, and making all of it tappable turns every
 * scroll into a near-miss.
 */
function EditButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Edit ${label}`}
      className="-m-2 shrink-0 rounded-lg p-2 text-muted active:bg-surface-2 active:text-text"
    >
      <PencilIcon />
    </button>
  );
}

export function EntryCard({
  entry,
  onOpen,
}: {
  entry: Entry;
  onOpen: (entry: Entry) => void;
}) {
  const label = entry.trade?.symbol ?? entry.dividend?.symbol ?? 'entry';

  return (
    <li className="flex items-start justify-between gap-3 border-b border-border py-3 last:border-0">
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
          <p className="text-sm leading-snug whitespace-pre-wrap">
            {entry.body}
          </p>
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

      <EditButton onClick={() => onOpen(entry)} label={label} />
    </li>
  );
}
