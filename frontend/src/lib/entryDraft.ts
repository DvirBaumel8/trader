import type { StopRow } from './stopRow';

export type EntryKind = 'TRADE' | 'CASH' | 'DIVIDEND' | 'INTEREST' | 'NOTE';
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
  /** A broker-charged cost outside any trade — margin interest, to start. */
  interestAmount: string;
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
    interestAmount: '',
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
 *
 * Reads `draft.quantity`, so the caller passes the quantity actually shown —
 * which may be the held-position suggestion rather than anything typed.
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

/**
 * A live preview of the resulting platform balance, from the account's cash
 * immediately before this fill plus the fill's own signed net cash impact —
 * the same arithmetic the backend's ledger performs, previewed here so the
 * owner rarely has to type a number the app can already work out. Undefined
 * whenever there isn't enough to compute from yet: no net cash given, or the
 * previous balance isn't known (see the caller for where that comes from).
 */
export function computedBalanceFromReportedCash(
  draft: EntryDraft,
  previousBalance: number | null,
): number | undefined {
  if (previousBalance === null) return undefined;
  const netCash = signedReportedNetCash(draft);
  if (netCash === undefined) return undefined;
  return Math.round((previousBalance + netCash) * 100) / 100;
}

/**
 * The inverse of `computedPriceFromReportedCash`: a live preview of the
 * platform's net cash magnitude from a typed price — a buy pays
 * `quantity x price + fee`, a sell receives `quantity x price - fee` — rounded
 * to cents the way a platform reports it. Returned as a positive magnitude,
 * like the field itself; `signedReportedNetCash` applies the sign from the
 * side. Undefined without a usable quantity and price, or when a sell's fee
 * swallows the proceeds. Like the other previews it is display-only: the
 * caller never feeds it back into price, so the two cannot chase each other.
 */
export function computedNetCashFromPrice(draft: EntryDraft): number | undefined {
  const quantity = Math.abs(parseFloat(draft.quantity || '0'));
  const price = Math.abs(parseFloat(draft.price || '0'));
  if (!Number.isFinite(quantity) || quantity <= 0) return undefined;
  if (!Number.isFinite(price) || price <= 0) return undefined;
  const fee = Math.abs(parseFloat(draft.fee || '0')) || 0;
  const notional = quantity * price;
  const netCash = draft.side === 'BUY' ? notional + fee : notional - fee;
  const rounded = Math.round(netCash * 100) / 100;
  return rounded > 0 ? rounded : undefined;
}
