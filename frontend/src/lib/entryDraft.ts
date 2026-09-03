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
  /**
   * How an exit came about, as one field with three states rather than two
   * that could contradict each other: a stop tier's id when the owner says
   * that tier fired, the literal 'DISCRETIONARY' when he says it was his own
   * decision, or null when the question does not apply or is unanswered.
   *
   * Persisted with the rest of the draft because iOS Safari discards
   * backgrounded tabs, and switching to a broker app to check a fill is
   * exactly when this gets lost.
   */
  exitAttribution: string | null;
}

/** The local calendar date, for a `<input type="date">`. */
export function localDate(when: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}

/**
 * A picked date becomes local midday rather than midnight. Midnight sits within
 * a timezone offset of the day boundary, so it can render or filter as the
 * neighbouring day; midday has hours of slack in both directions.
 */
export function dateToIso(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();
}

export function emptyDraft(defaultFee: number): EntryDraft {
  return {
    kind: 'TRADE',
    occurredAt: localDate(),
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
    exitAttribution: null,
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
