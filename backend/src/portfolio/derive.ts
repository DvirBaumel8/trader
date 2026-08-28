export type Side = 'BUY' | 'SELL';
export type CashDirection = 'DEPOSIT' | 'WITHDRAW';

export interface DerivedTxn {
  symbol: string;
  side: Side;
  quantity: number; // always positive
  price: number;
  fee: number;
  executedAt: Date;
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
    const ordered = [...list].sort(
      (a, b) => a.executedAt.getTime() - b.executedAt.getTime(),
    );

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
): number {
  let cash = 0;
  for (const f of flows) {
    cash += f.direction === 'DEPOSIT' ? f.amount : -f.amount;
  }
  for (const t of txns) {
    const notional = t.quantity * t.price;
    cash += t.side === 'BUY' ? -notional : notional;
    cash -= t.fee;
  }
  // Dividends add to cash but never to contributed capital.
  for (const d of dividends) {
    cash += d.amount;
  }
  return round(cash);
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
