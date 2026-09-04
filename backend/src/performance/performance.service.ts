import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { DailyClose } from '../market-data/daily-close.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { Transaction } from '../transactions/transaction.entity.js';
import { CashFlow } from '../transactions/cash-flow.entity.js';
import { Dividend } from '../transactions/dividend.entity.js';
import { UsersService } from '../users/users.service.js';
import {
  buildValuationSeries,
  pricesToReturns,
  rebase,
  toCumulativeReturns,
} from './series.js';

export type Range = '1W' | '1M' | '6M' | 'YTD' | '1Y' | 'ALL';

@Injectable()
export class PerformanceService {
  constructor(
    @InjectRepository(DailyClose)
    private readonly closes: Repository<DailyClose>,
    @InjectRepository(Instrument)
    private readonly instruments: Repository<Instrument>,
    @InjectRepository(Transaction)
    private readonly txns: Repository<Transaction>,
    @InjectRepository(CashFlow)
    private readonly flows: Repository<CashFlow>,
    @InjectRepository(Dividend)
    private readonly dividends: Repository<Dividend>,
    private readonly users: UsersService,
  ) {}

  async getSeries(range: Range = 'ALL') {
    const user = await this.users.ensureDefaultUser();
    const [txnRows, flowRows, divRows, instrumentRows] = await Promise.all([
      this.txns.find({ where: { userId: user.id } }),
      this.flows.find({ where: { userId: user.id } }),
      this.dividends.find({ where: { userId: user.id } }),
      this.instruments.find(),
    ]);

    if (txnRows.length === 0 && flowRows.length === 0) {
      return { range, points: [], deltas: null, unpricedSymbols: [] };
    }

    // The series can never start before the first trade, so neither can the
    // bars it needs. This used to load `daily_closes` unfiltered — every bar
    // of every instrument on every dashboard load — which is ~1,200 rows
    // today and grows by roughly 7,500 a year. Bounding it by date bounds it
    // on the axis that actually grows.
    const firstActivity = [
      ...txnRows.map((t) => t.executedAt),
      ...flowRows.map((f) => f.occurredAt),
    ]
      .sort((a, b) => a.getTime() - b.getTime())[0]
      ?.toISOString()
      .slice(0, 10);

    const closeRows = await this.closes.find(
      firstActivity ? { where: { date: MoreThanOrEqual(firstActivity) } } : {},
    );

    const symbolById = new Map(instrumentRows.map((i) => [i.id, i.symbol]));

    // symbol -> date -> price. Positions use raw closes; benchmarks use
    // adjusted ones, so an index keeps its dividend yield.
    const closes = new Map<string, Map<string, number>>();
    const adjusted = new Map<string, Map<string, number>>();
    for (const row of closeRows) {
      const symbol = symbolById.get(row.instrumentId);
      if (!symbol) continue;
      if (!closes.has(symbol)) closes.set(symbol, new Map());
      if (!adjusted.has(symbol)) adjusted.set(symbol, new Map());
      closes.get(symbol)!.set(row.date, row.close);
      adjusted.get(symbol)!.set(row.date, row.adjClose);
    }

    // The calendar is the set of days the benchmark traded — the market's own
    // trading days, rather than days the owner happened to be active.
    const spy = adjusted.get('SPY') ?? new Map<string, number>();
    let dates = [...spy.keys()].sort();

    if (firstActivity) dates = dates.filter((d) => d >= firstActivity);
    dates = dates.filter((d) => d >= startOf(range, dates));

    const { days: valuation, unpricedSymbols } = buildValuationSeries({
      dates,
      closes,
      txns: txnRows.map((t) => ({
        symbol: symbolById.get(t.instrumentId) ?? 'UNKNOWN',
        side: t.side,
        quantity: t.quantity,
        price: t.price,
        fee: t.fee,
        executedAt: t.executedAt,
      })),
      flows: flowRows.map((f) => ({
        direction: f.direction,
        amount: f.amount,
        occurredAt: f.occurredAt,
      })),
      dividends: divRows.map((d) => ({
        symbol: symbolById.get(d.instrumentId) ?? 'UNKNOWN',
        amount: d.amount,
        occurredAt: d.occurredAt,
      })),
    });

    const you = rebase(toCumulativeReturns(valuation));
    const sp = rebase(pricesToReturns(dates, spy));
    const nasdaq = rebase(
      pricesToReturns(dates, adjusted.get('QQQ') ?? new Map<string, number>()),
    );

    const points = dates.map((date, i) => ({
      date,
      you: you[i]?.cumulative ?? null,
      sp500: sp[i]?.cumulative ?? null,
      nasdaq: nasdaq[i]?.cumulative ?? null,
    }));

    const last = points.at(-1);
    return {
      range,
      points,
      deltas: last
        ? {
            vsSp500:
              last.you !== null && last.sp500 !== null
                ? round(last.you - last.sp500)
                : null,
            vsNasdaq:
              last.you !== null && last.nasdaq !== null
                ? round(last.you - last.nasdaq)
                : null,
          }
        : null,
      // Symbols valued at cost basis for want of a price bar somewhere in
      // this window — an estimate, not a measurement. See buildValuationSeries.
      unpricedSymbols,
    };
  }
}

/** The first date inside the requested range, given the available calendar. */
function startOf(range: Range, dates: string[]): string {
  if (range === 'ALL' || dates.length === 0) return dates[0] ?? '0000-01-01';
  const latest = new Date(dates[dates.length - 1]);
  if (range === 'YTD') return `${latest.getUTCFullYear()}-01-01`;
  if (range === '1W') {
    const from = new Date(latest);
    from.setUTCDate(from.getUTCDate() - 7);
    return from.toISOString().slice(0, 10);
  }
  const months = range === '1M' ? 1 : range === '6M' ? 6 : 12;
  const from = new Date(latest);
  from.setUTCMonth(from.getUTCMonth() - months);
  return from.toISOString().slice(0, 10);
}

function round(n: number): number {
  return Math.round(n * 1e10) / 1e10;
}
