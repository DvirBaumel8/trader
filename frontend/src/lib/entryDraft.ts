import type { StopRow } from './stopRisk';

export type EntryKind = 'TRADE' | 'CASH' | 'DIVIDEND' | 'NOTE';
export type TradeSide = 'BUY' | 'SELL';

export interface EntryDraft {
  kind: EntryKind;
  occurredAt: string;
  body: string;
  symbol: string;
  side: TradeSide;
  quantity: string;
  price: string;
  fee: string;
  target: string;
  stops: StopRow[];
  cashDirection: 'DEPOSIT' | 'WITHDRAW';
  cashAmount: string;
  dividendSymbol: string;
  dividendAmount: string;
  setups: string[];
  mistakes: string[];
}

/** Local time for a datetime-local input, not UTC. */
export function nowLocalInput(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}`
  );
}

export function emptyDraft(defaultFee: number): EntryDraft {
  return {
    kind: 'TRADE',
    occurredAt: nowLocalInput(),
    body: '',
    symbol: '',
    side: 'BUY',
    quantity: '',
    price: '',
    fee: String(defaultFee),
    target: '',
    stops: [],
    cashDirection: 'DEPOSIT',
    cashAmount: '',
    dividendSymbol: '',
    dividendAmount: '',
    setups: [],
    mistakes: [],
  };
}

/**
 * Signed quantity is what the API expects; the UI uses a Buy/Sell toggle.
 * The magnitude is taken absolutely so a typed minus cannot double-negate.
 */
export function signedQuantity(draft: EntryDraft): number {
  const magnitude = Math.abs(parseFloat(draft.quantity || '0'));
  return draft.side === 'SELL' ? -magnitude : magnitude;
}
