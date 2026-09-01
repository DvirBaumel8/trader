import {
  derivePositions,
  deriveCash,
  type DerivedTxn,
  type DerivedFlow,
  type DerivedDividend,
} from '../portfolio/derive.js';

export interface DayInput {
  date: string;
  /** Total account value at that day's close: positions plus cash. */
  value: number;
  /** Deposits minus withdrawals that day. Trades are NOT flows. */
  externalFlow: number;
}

export interface ReturnPoint {
  date: string;
  /** Cumulative return as a fraction: 0.1 is +10%. */
  cumulative: number;
}

export interface SeriesInput {
  dates: string[];
  /** symbol -> date -> close */
  closes: Map<string, Map<string, number>>;
  txns: DerivedTxn[];
  flows: DerivedFlow[];
  dividends: DerivedDividend[];
}

const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

export interface ValuationSeries {
  days: DayInput[];
  /**
   * Symbols that, on at least one day of the window, had never had a price
   * bar at all (as opposed to a mid-series gap, which carries the last known
   * price forward). Those days value the position at cost basis instead —
   * see the comment below. Surfaced so the UI can say the figure is an
   * estimate rather than presenting it as measured.
   */
  unpricedSymbols: string[];
}

/**
 * Walks the calendar, valuing the portfolio at each day's close.
 *
 * Deliberately re-derives positions and cash from scratch for every day rather
 * than mutating a running total: it is the same code path the dashboard uses,
 * so the series and the live figures can never disagree.
 */
export function buildValuationSeries(input: SeriesInput): ValuationSeries {
  const lastKnown = new Map<string, number>();
  const unpriced = new Set<string>();

  const days = input.dates.map((date) => {
    const upTo = (when: Date) => dayOf(when) <= date;

    const txns = input.txns.filter((t) => upTo(t.executedAt));
    const flows = input.flows.filter((f) => upTo(f.occurredAt));
    const dividends = input.dividends.filter((d) => upTo(d.occurredAt));

    const cash = deriveCash(txns, flows, dividends);

    let positionsValue = 0;
    for (const p of derivePositions(txns)) {
      if (!p.isOpen) continue;
      const close = input.closes.get(p.symbol)?.get(date);
      if (close !== undefined) lastKnown.set(p.symbol, close);
      // A missing bar (holiday, halt, thin name) carries the last known price
      // rather than valuing the position at zero.
      const price = close ?? lastKnown.get(p.symbol);
      if (price !== undefined) {
        positionsValue += price * p.quantity;
      } else {
        // No bar has ever appeared for this symbol (e.g. bought today and the
        // backfill hasn't run yet). Valuing at cost basis is the conservative
        // estimate: it contributes no fictional gain or loss, unlike the
        // previous behaviour of dropping the position to zero while cash had
        // already paid for it.
        positionsValue += p.costBasis;
        unpriced.add(p.symbol);
      }
    }

    const externalFlow = input.flows
      .filter((f) => dayOf(f.occurredAt) === date)
      .reduce(
        (sum, f) => sum + (f.direction === 'DEPOSIT' ? f.amount : -f.amount),
        0,
      );

    return {
      date,
      value: round(cash + positionsValue),
      externalFlow: round(externalFlow),
    };
  });

  return { days, unpricedSymbols: [...unpriced].sort() };
}

/**
 * Time-weighted return, chained daily.
 *
 *   r = (V - CF) / V_prev - 1
 *
 * Subtracting the flow before dividing is what stops a deposit registering as
 * a gain — the single most important property in this file.
 */
export function toCumulativeReturns(days: DayInput[]): ReturnPoint[] {
  const out: ReturnPoint[] = [];
  let growth = 1;

  days.forEach((day, i) => {
    if (i === 0) {
      // The opening capital arrives against a prior value of zero, which has
      // no defined return. Day one is the baseline.
      out.push({ date: day.date, cumulative: 0 });
      return;
    }
    const prev = days[i - 1].value;
    if (prev > 0) {
      growth *= (day.value - day.externalFlow) / prev;
    }
    // With no positive prior value the return is undefined; carry the last
    // figure rather than emitting NaN or Infinity.
    out.push({ date: day.date, cumulative: round(growth - 1) });
  });

  return out;
}

/** Shifts a cumulative series so its first point sits at zero. */
export function rebase(points: ReturnPoint[]): ReturnPoint[] {
  if (points.length === 0) return [];
  const base = 1 + points[0].cumulative;
  if (base === 0) return points.map((p) => ({ ...p, cumulative: 0 }));
  return points.map((p) => ({
    date: p.date,
    cumulative: round((1 + p.cumulative) / base - 1),
  }));
}

/** Converts a price series into a cumulative return series. */
export function pricesToReturns(
  dates: string[],
  closes: Map<string, number>,
): ReturnPoint[] {
  const out: ReturnPoint[] = [];
  let first: number | null = null;
  let last: number | null = null;

  for (const date of dates) {
    const price: number | null = closes.get(date) ?? last;
    if (price === null) continue;
    last = price;
    if (first === null) first = price;
    // `first` is non-null here: it was just assigned if it was null.
    out.push({ date, cumulative: round(price / first - 1) });
  }
  return out;
}

function round(n: number): number {
  return Math.round(n * 1e10) / 1e10;
}
