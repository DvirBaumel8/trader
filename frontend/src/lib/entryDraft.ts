import type { StopRow } from './stopRow';

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
  /** Codes from the backend's reason vocabulary — why this fill was taken. */
  reasons: string[];
  /**
   * The platform's reported numbers for this fill, typed as plain positive
   * amounts like price and fee — `signedReportedNetCash` applies the sign
   * from `side`, since a sell credits cash and a buy debits it. Blank means
   * not given.
   */
  reportedNetCash: string;
  /** The platform's cash balance right after this fill. Can be negative — margin is legitimate. */
  reportedBalance: string;
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
    reasons: [],
    reportedNetCash: '',
    reportedBalance: '',
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

/**
 * The platform's net cash impact, signed the way `deriveCash` on the backend
 * expects: negative on a buy, positive on a sell. Typed as a plain positive
 * amount, same as price and fee — the Buy/Sell toggle supplies the sign, so
 * a stray minus typed by habit cannot double-negate it.
 */
export function signedReportedNetCash(draft: EntryDraft): number | undefined {
  if (draft.reportedNetCash.trim() === '') return undefined;
  const magnitude = Math.abs(parseFloat(draft.reportedNetCash));
  return draft.side === 'SELL' ? magnitude : -magnitude;
}

/** Unlike net cash, the resulting balance is read straight off the platform and can legitimately be negative (margin). */
export function parsedReportedBalance(draft: EntryDraft): number | undefined {
  if (draft.reportedBalance.trim() === '') return undefined;
  return parseFloat(draft.reportedBalance);
}

/**
 * A live preview of the price the backend will actually store once
 * `reportedNetCash` is given — it recomputes the fill from cash rather than
 * trusting a typed 2-decimal guess (see `priceFromNetCash` on the backend,
 * which this mirrors for display only; the backend's own computation at
 * save time is what is actually stored). Undefined whenever there isn't
 * enough to compute from yet, so the caller falls back to a typed price.
 */
export function computedPriceFromReportedCash(
  draft: EntryDraft,
): number | undefined {
  const netCash = signedReportedNetCash(draft);
  if (netCash === undefined) return undefined;
  const quantity = Math.abs(parseFloat(draft.quantity || '0'));
  if (!Number.isFinite(quantity) || quantity <= 0) return undefined;
  const fee = Math.abs(parseFloat(draft.fee || '0'));
  const magnitude = Math.abs(netCash);
  const notional = draft.side === 'BUY' ? magnitude - fee : magnitude + fee;
  return notional > 0 ? notional / quantity : undefined;
}
