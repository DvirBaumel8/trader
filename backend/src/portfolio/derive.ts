export type Side = 'BUY' | 'SELL';
export type CashDirection = 'DEPOSIT' | 'WITHDRAW';

export interface DerivedTxn {
  symbol: string;
  side: Side;
  quantity: number; // always positive
  price: number;
  fee: number;
  executedAt: Date;
  /**
   * When the owner LOGGED this fill — the journal entry's `createdAt`. Used
   * only to break a tie on `executedAt`; see `compareFills`. Optional because
   * the pure derivation must stay usable from fixtures that do not care.
   */
  recordedAt?: Date | null;
}

/**
 * Chronological order for one instrument's fills.
 *
 * A journal entry records a DATE, not a time, so every fill logged for the
 * same day arrives with an identical `executedAt` and the tie falls to
 * whatever order the database happened to return. That is not cosmetic: get
 * it wrong on a close followed by a same-day re-entry and the position never
 * crosses zero, so the completed round trip is swallowed by the new one and
 * disappears from the history win rate, expectancy and R are computed from.
 *
 * `recordedAt` breaks the tie with the order the owner actually logged them
 * in — the only evidence of sequence that exists once time-of-day is gone.
 * When it is missing on either side the comparator returns 0 and leaves the
 * original relative order standing, because `Array.prototype.sort` is stable
 * and inventing an order would be worse than preserving the caller's.
 *
 * Deliberately NOT "process reducing fills first": with nothing held, a sell
 * ordered before its own buy reads as opening a short, which breaks every
 * intraday round trip.
 */
export function compareFills(
  a: { executedAt: Date; recordedAt?: Date | null },
  b: { executedAt: Date; recordedAt?: Date | null },
): number {
  const byExecuted = a.executedAt.getTime() - b.executedAt.getTime();
  if (byExecuted !== 0) return byExecuted;
  if (a.recordedAt == null || b.recordedAt == null) return 0;
  return a.recordedAt.getTime() - b.recordedAt.getTime();
}

export interface DerivedFlow {
  direction: CashDirection;
  amount: number; // always positive
  occurredAt: Date;
}

/**
 * Income paid by a holding. Increases cash but is NOT a contribution — see
 * dividend.entity.ts for why that distinction matters to the benchmark.
 */
export interface DerivedDividend {
  symbol: string;
  amount: number; // always positive
  occurredAt: Date;
}

/**
 * A broker-charged cost outside any trade — margin interest, to start.
 * The mirror image of a dividend: it lowers cash but is NOT a withdrawal —
 * see interest-charge.entity.ts for why that distinction matters to the
 * benchmark the same way it does for a dividend.
 */
export interface DerivedInterestCharge {
  amount: number; // always positive
  occurredAt: Date;
}

export interface DerivedPosition {
  symbol: string;
  /** Negative means short. */
  quantity: number;
  /** Signed: negative for a short. Fees excluded. */
  costBasis: number;
  /** Always positive — the price per share, not the signed basis. */
  avgCost: number;
  feesPaid: number;
  /** Closing gains net of ALL fees on this instrument. */
  realizedPnl: number;
  isOpen: boolean;
}

interface Lot {
  quantity: number; // signed: positive long, negative short
  price: number;
}

const EPSILON = 1e-9;

/**
 * Positions are never stored — they are always derived from the immutable
 * transaction log, so they cannot drift out of sync with the journal.
 *
 * Lot matching is FIFO. Shorts are not a special case: selling below zero
 * simply produces negatively-signed lots, and the same close/flip logic
 * applies in both directions.
 */
export function derivePositions(txns: DerivedTxn[]): DerivedPosition[] {
  const bySymbol = new Map<string, DerivedTxn[]>();
  for (const t of txns) {
    const list = bySymbol.get(t.symbol) ?? [];
    list.push(t);
    bySymbol.set(t.symbol, list);
  }

  const positions: DerivedPosition[] = [];

  for (const [symbol, list] of bySymbol) {
    const ordered = [...list].sort(compareFills);

    const lots: Lot[] = [];
    let realizedGains = 0;
    let feesPaid = 0;

    for (const t of ordered) {
      feesPaid += t.fee;
      let remaining = t.side === 'BUY' ? t.quantity : -t.quantity;

      // Consume opposing lots FIFO.
      while (Math.abs(remaining) > EPSILON && lots.length > 0) {
        const lot = lots[0];
        const opposing = Math.sign(lot.quantity) !== Math.sign(remaining);
        if (!opposing) break;

        const closed = Math.min(Math.abs(lot.quantity), Math.abs(remaining));
        // Long lot: gain when the exit price exceeds the entry price.
        // Short lot: gain when the exit price is below the entry price.
        realizedGains +=
          lot.quantity > 0
            ? (t.price - lot.price) * closed
            : (lot.price - t.price) * closed;

        lot.quantity -= Math.sign(lot.quantity) * closed;
        remaining -= Math.sign(remaining) * closed;
        if (Math.abs(lot.quantity) < EPSILON) lots.shift();
      }

      // Anything left opens (or extends) a position in this direction.
      if (Math.abs(remaining) > EPSILON) {
        lots.push({ quantity: remaining, price: t.price });
      }
    }

    const quantity = round(lots.reduce((sum, l) => sum + l.quantity, 0));
    const costBasis = round(
      lots.reduce((sum, l) => sum + l.quantity * l.price, 0),
    );

    positions.push({
      symbol,
      quantity,
      costBasis,
      avgCost:
        Math.abs(quantity) > EPSILON ? round(Math.abs(costBasis / quantity)) : 0,
      feesPaid: round(feesPaid),
      realizedPnl: round(realizedGains - feesPaid),
      isOpen: Math.abs(quantity) > EPSILON,
    });
  }

  return positions.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * Cash may legitimately be negative — that is margin, not an error.
 */
export function deriveCash(
  txns: DerivedTxn[],
  flows: DerivedFlow[],
  dividends: DerivedDividend[] = [],
  interestCharges: DerivedInterestCharge[] = [],
): number {
  let cash = 0;
  for (const f of flows) {
    cash += f.direction === 'DEPOSIT' ? f.amount : -f.amount;
  }
  for (const t of txns) {
    cash += tradeNetCash(t);
  }
  // Dividends add to cash but never to contributed capital.
  for (const d of dividends) {
    cash += d.amount;
  }
  // Interest charges subtract from cash but never from contributed capital —
  // the mirror image of a dividend.
  for (const i of interestCharges) {
    cash -= i.amount;
  }
  return round(cash);
}

/** A single fill's cash impact: negative notional plus fee on a buy, positive notional minus fee on a sell. */
export function tradeNetCash(t: {
  side: Side;
  quantity: number;
  price: number;
  fee: number;
}): number {
  const notional = t.quantity * t.price;
  return round((t.side === 'BUY' ? -notional : notional) - t.fee);
}

/**
 * The exact per-share price implied by the platform's own reported net cash,
 * inverting `tradeNetCash` — a 2-decimal typed price is often a rounded
 * guess at an average fill, while the platform's cash figure is exact. The
 * result can be zero or negative when the fee exceeds the reported amount;
 * the caller decides whether that is an error, since this stays a pure
 * calculation with no business rule of its own.
 */
export function priceFromNetCash(
  side: Side,
  quantity: number,
  fee: number,
  netCashMagnitude: number,
): number {
  const notional =
    side === 'BUY' ? netCashMagnitude - fee : netCashMagnitude + fee;
  return round(notional / quantity);
}

export interface CashEvent {
  id: string;
  /** Signed cash impact of this event: a trade's net cash, a deposit's +amount, a withdrawal's -amount, a dividend's +amount. */
  delta: number;
  executedAt?: Date;
  occurredAt?: Date;
  recordedAt?: Date | null;
}

/**
 * The running cash balance immediately after each event, keyed by event id.
 * Ordered the same way `compareFills` orders same-day fills — a journal
 * entry records a date, not a time, so `recordedAt` (when the owner logged
 * it) is what breaks a same-day tie between, say, a deposit and a trade.
 */
export function cashBalancesAfter(events: CashEvent[]): Map<string, number> {
  const ordered = [...events].sort((a, b) =>
    compareFills(
      { executedAt: a.executedAt ?? a.occurredAt!, recordedAt: a.recordedAt },
      { executedAt: b.executedAt ?? b.occurredAt!, recordedAt: b.recordedAt },
    ),
  );
  const balances = new Map<string, number>();
  let running = 0;
  for (const e of ordered) {
    running = round(running + e.delta);
    balances.set(e.id, running);
  }
  return balances;
}

/** Net capital the owner actually put in. Dividends deliberately excluded. */
export function deriveContributedCapital(flows: DerivedFlow[]): number {
  let total = 0;
  for (const f of flows) {
    total += f.direction === 'DEPOSIT' ? f.amount : -f.amount;
  }
  return round(total);
}

/** Kills floating-point dust without pulling in a decimal library. */
function round(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
