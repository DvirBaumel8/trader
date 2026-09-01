import type { DerivedTxn } from './derive.js';
import { computeRisk, type StopLevelInput } from './risk.js';

/** A transaction carrying the stop plan recorded at entry. */
export type TradeTxn = DerivedTxn & {
  stopLevels?: StopLevelInput[];
  plannedTarget?: number | null;
};

/** One transaction inside a trade, as executed. */
export interface TradeFill {
  executedAt: Date;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  fee: number;
}

export interface DerivedTrade {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  /** Total size opened, in shares. */
  quantity: number;
  avgEntry: number;
  avgExit: number | null;
  enteredAt: Date;
  exitedAt: Date | null;
  holdingDays: number | null;
  feesPaid: number;
  /** Null while the trade is still open. Net of fees. */
  realizedPnl: number | null;
  isWin: boolean | null;
  isOpen: boolean;
  /** Dollars at risk from the opening stop tiers. Null when none were set. */
  riskAmount: number | null;
  /** False when the stop tiers covered only part of the position. */
  riskCoversFullPosition: boolean;
  /** Result in units of risk. Null without a stop. */
  rMultiple: number | null;

  /**
   * Every transaction that composed this trade, in execution order. Emitted
   * here rather than reconstructed by the caller: the grouping walk already
   * has exactly these rows, and re-deriving them from a date range would be
   * ambiguous where one trade closes and another opens at the same instant.
   */
  fills: TradeFill[];

  /**
   * The stop tiers recorded on the transaction that opened the trade — the
   * plan as it stood at entry, which is what the chart draws. Carried here
   * for the same reason as `fills`: the walk already holds them.
   */
  openingStops: StopLevelInput[];
}

const EPSILON = 1e-9;

interface OpenTrade {
  direction: 'LONG' | 'SHORT';
  position: number;
  openQty: number;
  openNotional: number;
  closeQty: number;
  closeNotional: number;
  fees: number;
  enteredAt: Date;
  /**
   * The stop plan recorded on the opening fill. Used both for the risk
   * calculation in `finish()` and, unchanged, as `DerivedTrade.openingStops`
   * — one field, since both readers want exactly the same value and neither
   * mutates it.
   */
  stopLevels: StopLevelInput[];
  fills: TradeFill[];
}

/**
 * A trade is the span from flat to flat in one symbol. Derived, never stored,
 * for the same reason positions are: it cannot then disagree with the journal.
 *
 * Scaling in and out stays ONE trade — it is one idea, and splitting it would
 * inflate the trade count and distort win rate. A re-entry after going flat is
 * a new trade.
 */
export function deriveTrades(txns: TradeTxn[]): DerivedTrade[] {
  const bySymbol = new Map<string, TradeTxn[]>();
  for (const t of txns) {
    bySymbol.set(t.symbol, [...(bySymbol.get(t.symbol) ?? []), t]);
  }

  const trades: DerivedTrade[] = [];

  for (const [symbol, list] of bySymbol) {
    const ordered = [...list].sort(
      (a, b) => a.executedAt.getTime() - b.executedAt.getTime(),
    );

    let open: OpenTrade | null = null;

    for (const t of ordered) {
      const signed = t.side === 'BUY' ? t.quantity : -t.quantity;

      if (open === null) {
        open = {
          direction: signed > 0 ? 'LONG' : 'SHORT',
          position: signed,
          openQty: t.quantity,
          openNotional: t.quantity * t.price,
          closeQty: 0,
          closeNotional: 0,
          fees: t.fee,
          enteredAt: t.executedAt,
          // The plan belongs to the opening fill; later adds do not redefine it.
          stopLevels: t.stopLevels ?? [],
          fills: [],
        };
        open.fills.push({
          executedAt: t.executedAt,
          side: t.side,
          price: t.price,
          quantity: t.quantity,
          fee: t.fee,
        });
        continue;
      }

      open.fills.push({
        executedAt: t.executedAt,
        side: t.side,
        price: t.price,
        quantity: t.quantity,
        fee: t.fee,
      });
      open.fees += t.fee;
      const adding = Math.sign(signed) === Math.sign(open.position);
      if (adding) {
        open.openQty += t.quantity;
        open.openNotional += t.quantity * t.price;
      } else {
        open.closeQty += t.quantity;
        open.closeNotional += t.quantity * t.price;
      }
      open.position += signed;

      if (Math.abs(open.position) < EPSILON) {
        trades.push(finish(symbol, open, t.executedAt));
        open = null;
      }
    }

    if (open !== null) {
      trades.push(finish(symbol, open, null));
    }
  }

  return trades.sort((a, b) => b.enteredAt.getTime() - a.enteredAt.getTime());
}

function finish(
  symbol: string,
  open: OpenTrade,
  exitedAt: Date | null,
): DerivedTrade {
  const avgEntry = round(open.openNotional / open.openQty);
  const avgExit =
    open.closeQty > EPSILON ? round(open.closeNotional / open.closeQty) : null;

  let realizedPnl: number | null = null;
  if (exitedAt !== null && avgExit !== null) {
    const gross =
      open.direction === 'LONG'
        ? (avgExit - avgEntry) * open.closeQty
        : (avgEntry - avgExit) * open.closeQty;
    realizedPnl = round(gross - open.fees);
  }

  // Risk comes from the stop tiers on the opening fill, against the average
  // entry. Tiers may cover only part of the position; computeRisk reports that
  // rather than pretending the whole position was protected.
  const risk = computeRisk({
    avgEntry,
    quantity: open.openQty,
    levels: open.stopLevels,
    direction: open.direction,
  });

  return {
    symbol,
    direction: open.direction,
    quantity: round(open.openQty),
    avgEntry,
    avgExit,
    enteredAt: open.enteredAt,
    exitedAt,
    holdingDays:
      exitedAt === null
        ? null
        : Math.round(
            (exitedAt.getTime() - open.enteredAt.getTime()) / 86_400_000,
          ),
    feesPaid: round(open.fees),
    realizedPnl,
    // Break-even is not a win. Counting a scratch as a win flatters the rate.
    isWin: realizedPnl === null ? null : realizedPnl > 0,
    isOpen: exitedAt === null,
    riskAmount: risk.amount,
    riskCoversFullPosition: risk.fullyCovered,
    rMultiple:
      realizedPnl !== null && risk.amount !== null && risk.amount > EPSILON
        ? round(realizedPnl / risk.amount)
        : null,
    fills: open.fills,
    openingStops: open.stopLevels,
  };
}

export interface TradeSummary {
  closedCount: number;
  openCount: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  /**
   * Average dollars at risk per trade that set a stop. Open trades count:
   * risk is fixed at entry and does not depend on the outcome.
   */
  avgRisk: number | null;
  /** How many trades the risk figure is based on. */
  riskTradeCount: number;
  expectancyDollars: number | null;
  /** Averaged over trades that had a stop. Null when none did. */
  expectancyR: number | null;
  /** How many trades the R figure is based on, so the number stays honest. */
  rTradeCount: number;
}

type Summarisable = Pick<
  DerivedTrade,
  'realizedPnl' | 'isOpen' | 'isWin' | 'rMultiple' | 'riskAmount'
>;

export function summariseTrades(trades: Summarisable[]): TradeSummary {
  const closed = trades.filter((t) => !t.isOpen && t.realizedPnl !== null);
  const wins = closed.filter((t) => t.isWin === true);
  const losses = closed.filter((t) => t.isWin === false);
  const withR = closed.filter((t) => t.rMultiple !== null);
  // Risk is known at entry, so an open trade contributes to average risk.
  const withRisk = trades.filter((t) => t.riskAmount !== null);

  const mean = (xs: number[]) =>
    xs.length === 0 ? null : round(xs.reduce((a, b) => a + b, 0) / xs.length);

  return {
    closedCount: closed.length,
    openCount: trades.filter((t) => t.isOpen).length,
    winRate: closed.length === 0 ? null : round(wins.length / closed.length),
    avgWin: mean(wins.map((t) => t.realizedPnl as number)),
    // Reported as a positive magnitude so "avg loss $920" reads naturally.
    avgLoss: mean(losses.map((t) => Math.abs(t.realizedPnl as number))),
    avgRisk: mean(withRisk.map((t) => t.riskAmount as number)),
    riskTradeCount: withRisk.length,
    expectancyDollars: mean(closed.map((t) => t.realizedPnl as number)),
    expectancyR: mean(withR.map((t) => t.rMultiple as number)),
    rTradeCount: withR.length,
  };
}

function round(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
