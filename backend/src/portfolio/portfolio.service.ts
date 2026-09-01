import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, MoreThanOrEqual, Repository } from 'typeorm';
import { Transaction } from '../transactions/transaction.entity.js';
import { CashFlow } from '../transactions/cash-flow.entity.js';
import { Dividend } from '../transactions/dividend.entity.js';
import { StopLevel } from '../transactions/stop-level.entity.js';
import { JournalEntry } from '../journal/journal-entry.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { DailyClose } from '../market-data/daily-close.entity.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
import { MarketDataService } from '../market-data/market-data.service.js';
import { UsersService } from '../users/users.service.js';
import { JournalService } from '../journal/journal.service.js';
import {
  derivePositions,
  deriveCash,
  deriveContributedCapital,
  type DerivedTxn,
  type DerivedFlow,
  type DerivedDividend,
} from './derive.js';
import {
  deriveTrades,
  summariseTrades,
  type DerivedTrade,
} from './derive-trades.js';
import { parseTradeId, tradeId, windowBounds } from './trade-window.js';
import { computeRiskFromCurrentPrice, type StopLevelInput } from './risk.js';

export interface SeedHolding {
  symbol: string;
  quantity: number;
  avgCost: number;
}

export interface SeedRequest {
  asOf: string;
  startingCash: number;
  holdings: SeedHolding[];
}

@Injectable()
export class PortfolioService {
  constructor(
    @InjectRepository(Transaction)
    private readonly txns: Repository<Transaction>,
    @InjectRepository(CashFlow)
    private readonly flows: Repository<CashFlow>,
    @InjectRepository(Dividend)
    private readonly dividendRows: Repository<Dividend>,
    @InjectRepository(StopLevel)
    private readonly stopLevels: Repository<StopLevel>,
    @InjectRepository(JournalEntry)
    private readonly entries: Repository<JournalEntry>,
    @InjectRepository(Instrument)
    private readonly instruments: Repository<Instrument>,
    @InjectRepository(DailyClose)
    private readonly closes: Repository<DailyClose>,
    private readonly instrumentsService: InstrumentsService,
    private readonly marketData: MarketDataService,
    private readonly users: UsersService,
    private readonly journal: JournalService,
    private readonly dataSource: DataSource,
  ) {}

  async getPortfolio(opts: { refresh?: boolean } = {}) {
    const user = await this.users.ensureDefaultUser();
    const [txnRows, flowRows, divRows, instrumentRows] = await Promise.all([
      this.txns.find({ where: { userId: user.id } }),
      this.flows.find({ where: { userId: user.id } }),
      this.dividendRows.find({ where: { userId: user.id } }),
      this.instruments.find(),
    ]);

    const symbolById = new Map(instrumentRows.map((i) => [i.id, i.symbol]));
    const nameBySymbol = new Map(instrumentRows.map((i) => [i.symbol, i.name]));

    const derivedTxns: DerivedTxn[] = txnRows.map((t) => ({
      symbol: symbolById.get(t.instrumentId) ?? 'UNKNOWN',
      side: t.side,
      quantity: t.quantity,
      price: t.price,
      fee: t.fee,
      executedAt: t.executedAt,
    }));
    const derivedFlows: DerivedFlow[] = flowRows.map((f) => ({
      direction: f.direction,
      amount: f.amount,
      occurredAt: f.occurredAt,
    }));

    const derivedDividends: DerivedDividend[] = divRows.map((d) => ({
      symbol: symbolById.get(d.instrumentId) ?? 'UNKNOWN',
      amount: d.amount,
      occurredAt: d.occurredAt,
    }));

    const derived = derivePositions(derivedTxns).filter((p) => p.isOpen);
    const cash = deriveCash(derivedTxns, derivedFlows, derivedDividends);

    const quotes = await this.marketData.getQuotes(
      derived.map((p) => p.symbol),
      opts.refresh === true,
    );

    const openTrades = (await this.deriveAllTrades()).filter((t) => t.isOpen);
    const openTradeBySymbol = new Map(
      openTrades.map((t) => [t.symbol, tradeId(t.symbol, t.enteredAt)]),
    );
    // The stop plan lives on the opening fill, keyed the same way, so risk
    // "from here" can reuse the trade lookup this endpoint already does for
    // tradeId rather than a second pass over transactions.
    const openTradeStopsBySymbol = new Map(
      openTrades.map((t) => [
        t.symbol,
        { direction: t.direction, avgEntry: t.avgEntry, levels: t.openingStops },
      ]),
    );

    const positions = derived.map((p) => {
      const quote = quotes.get(p.symbol);
      const price = quote?.price ?? null;
      const marketValue = price === null ? null : price * p.quantity;
      return {
        symbol: p.symbol,
        name: nameBySymbol.get(p.symbol) ?? null,
        quantity: p.quantity,
        avgCost: p.avgCost,
        costBasis: p.costBasis,
        feesPaid: p.feesPaid,
        realizedPnl: p.realizedPnl,
        price,
        stale: quote?.stale ?? true,
        // Which session this price came from, so the row can say so.
        session: quote?.session ?? null,
        extended: quote?.extended ?? false,
        regularPrice: quote?.regularPrice ?? null,
        marketValue,
        unrealizedPnl: marketValue === null ? null : marketValue - p.costBasis,
        unrealizedPct:
          marketValue === null || p.costBasis === 0
            ? null
            : (marketValue - p.costBasis) / Math.abs(p.costBasis),
        tradeId: openTradeBySymbol.get(p.symbol) ?? null,
      };
    });

    const positionsValue = positions.reduce(
      (sum, p) => sum + (p.marketValue ?? 0),
      0,
    );

    const atRisk = this.computeAtRisk(positions, openTradeStopsBySymbol);

    return {
      positions,
      cash,
      positionsValue,
      accountValue: cash + positionsValue,
      hasStalePrices: positions.some((p) => p.stale),
      // Capital the owner actually put in. Dividends raise cash but are
      // earned, not contributed — see dividend.entity.ts.
      contributedCapital: deriveContributedCapital(derivedFlows),
      dividendsReceived: derivedDividends.reduce((s, d) => s + d.amount, 0),
      // One session for the header badge. Quotes come from the same market, so
      // the first priced position is representative.
      marketSession: positions.find((p) => p.session !== null)?.session ?? null,
      pricesAreExtended: positions.some((p) => p.extended),
      // When the client last got real numbers, so the UI can say "updated 17:31".
      pricedAt: new Date().toISOString(),
      atRisk,
    };
  }

  /**
   * Total dollars lost if every recorded stop tier were hit right now, plus
   * how many open positions carry no stop at all — an unbounded risk that
   * must stay visible rather than being silently folded into "no risk".
   *
   * A position whose only stop is a trail raised above the current price (a
   * profit lock) prices out negative — a gain, not a loss. That is correct
   * per position, but it is deliberately NOT allowed to net against real risk
   * elsewhere in the total: this box answers "how much could I lose", and
   * letting a locked-in gain quietly cancel out someone else's real exposure
   * would understate risk exactly when a big winner is carrying a small,
   * dangerous position along with it. Each position's contribution to the sum
   * is floored at zero; the unfloored, possibly-negative number is still the
   * one attached to the position, it just is not summed as if it were risk.
   */
  private computeAtRisk(
    positions: Array<{
      symbol: string;
      quantity: number;
      price: number | null;
    }>,
    stopsBySymbol: Map<
      string,
      {
        direction: 'LONG' | 'SHORT';
        avgEntry: number;
        levels: StopLevelInput[];
      }
    >,
  ) {
    let amount = 0;
    const symbolsWithoutStop: string[] = [];

    for (const p of positions) {
      const plan = stopsBySymbol.get(p.symbol);
      if (!plan || plan.levels.length === 0) {
        symbolsWithoutStop.push(p.symbol);
        continue;
      }
      // A stop plan exists but there is no live price to measure it against
      // (never successfully quoted). Rare, and not the same situation as
      // having no stop at all, so it is left out of both the sum and the
      // "without a stop" count rather than guessed at.
      if (p.price === null) continue;

      const risk = computeRiskFromCurrentPrice({
        avgEntry: plan.avgEntry,
        currentPrice: p.price,
        quantity: Math.abs(p.quantity),
        levels: plan.levels,
        direction: plan.direction,
      });
      if (risk.amount !== null) {
        amount += Math.max(0, risk.amount);
      }
    }

    return {
      amount: round(amount),
      positionsWithoutStop: {
        count: symbolsWithoutStop.length,
        symbols: symbolsWithoutStop,
      },
    };
  }

  /**
   * Every round trip, with the stop plan recorded at entry attached. Shared
   * by the stats summary and the trade detail screen so the two can never
   * disagree about what a trade is.
   */
  private async deriveAllTrades(): Promise<DerivedTrade[]> {
    const user = await this.users.ensureDefaultUser();
    const [txnRows, instrumentRows, levelRows] = await Promise.all([
      this.txns.find({ where: { userId: user.id } }),
      this.instruments.find(),
      this.stopLevels.find(),
    ]);
    const symbolById = new Map(instrumentRows.map((i) => [i.id, i.symbol]));

    const levelsByTxn = new Map<string, StopLevel[]>();
    for (const l of levelRows) {
      levelsByTxn.set(l.transactionId, [
        ...(levelsByTxn.get(l.transactionId) ?? []),
        l,
      ]);
    }

    return deriveTrades(
      txnRows.map((t) => ({
        symbol: symbolById.get(t.instrumentId) ?? 'UNKNOWN',
        side: t.side,
        quantity: t.quantity,
        price: t.price,
        fee: t.fee,
        executedAt: t.executedAt,
        stopLevels: (levelsByTxn.get(t.id) ?? [])
          .sort((a, b) => a.ordinal - b.ordinal)
          .map((l) => ({
            kind: l.kind,
            price: l.price,
            trailPercent: l.trailPercent,
            quantity: l.quantity,
          })),
        plannedTarget: t.plannedTarget,
      })),
    );
  }

  async getStats() {
    const trades = await this.deriveAllTrades();
    return {
      ...summariseTrades(trades),
      // Fills are for the detail screen; sending them for every trade would
      // bloat a response the list view re-fetches often.
      trades: trades.map(({ fills, openingStops, ...rest }) => rest),
    };
  }

  /**
   * One trade with everything the chart draws: its fills, the stop tiers
   * recorded at entry, and the daily bars either side of it.
   */
  async getTrade(id: string) {
    const parsed = parseTradeId(id);
    if (!parsed) throw new NotFoundException('Unknown trade');

    const trades = await this.deriveAllTrades();
    const trade = trades.find(
      (t) =>
        t.symbol === parsed.symbol &&
        t.enteredAt.toISOString() === parsed.enteredAt,
    );
    // A stale link after the opening transaction was edited lands here. The
    // trade still exists under a new id; this one no longer identifies it.
    if (!trade) throw new NotFoundException('Unknown trade');

    const instrument = await this.instruments.findOne({
      where: { symbol: trade.symbol },
    });
    if (!instrument) throw new NotFoundException('Unknown trade');

    const { fromDate, toDate } = windowBounds(trade.enteredAt, trade.exitedAt);
    const bars = await this.closes.find({
      where: {
        instrumentId: instrument.id,
        date: toDate ? Between(fromDate, toDate) : MoreThanOrEqual(fromDate),
      },
      order: { date: 'ASC' },
    });

    const { fills, openingStops, ...summary } = trade;
    return {
      trade: summary,
      fills,
      stopLevels: openingStops,
      bars: bars.map((b) => ({
        date: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
      // The chart says what it actually has rather than implying the window
      // is complete: the backfill is manual, so bars can end before the trade
      // does.
      lastBarDate: bars.at(-1)?.date ?? null,
    };
  }

  async isSeeded(): Promise<boolean> {
    const user = await this.users.ensureDefaultUser();
    return (await this.entries.count({ where: { userId: user.id } })) > 0;
  }

  /**
   * One-time: writes an opening BUY per holding plus an opening-capital
   * deposit, each wrapped in a journal entry so the "transactions only via
   * journal" invariant holds from the very first row.
   */
  async seed(req: SeedRequest) {
    const user = await this.users.ensureDefaultUser();
    if (await this.isSeeded()) {
      throw new ConflictException(
        'Portfolio already seeded. Reset it before seeding again.',
      );
    }

    // Validate every ticker BEFORE writing anything, so one bad symbol cannot
    // leave a half-seeded portfolio behind.
    const resolved = await Promise.all(
      req.holdings.map(async (h) => ({
        holding: h,
        instrument: await this.instrumentsService.findOrCreate(h.symbol),
      })),
    );

    const asOf = new Date(`${req.asOf}T00:00:00Z`);

    /**
     * `startingCash` is the cash held RIGHT NOW, standing alongside holdings
     * already owned. But the opening BUYs about to be written will each
     * subtract their cost from cash. So the seed deposit must be the capital
     * actually contributed — cash plus what the holdings cost — otherwise the
     * opening trades would eat the balance the user just reported.
     *
     *   contributed = startingCash + Σ(signed quantity × avgCost)
     *
     * A short has negative quantity, so it correctly reduces contributed
     * capital by the proceeds it generated. After derivation, cash ===
     * startingCash.
     */
    const holdingsCost = req.holdings.reduce(
      (sum, h) => sum + h.quantity * h.avgCost,
      0,
    );
    const contributed = req.startingCash + holdingsCost;

    // Written through the journal service, the single write path into
    // transactions and cash flows. Tickers were validated above, so the
    // realistic failure mode is already gone; a partial seed is recoverable
    // with reset-and-re-seed.
    if (contributed !== 0) {
      await this.journal.create({
        kind: 'CASH',
        // No 'seeded' marker: where a row came from is not the user's concern.
        body: '',
        occurredAt: asOf.toISOString(),
        cash: {
          direction: contributed > 0 ? 'DEPOSIT' : 'WITHDRAW',
          amount: Math.abs(contributed),
        },
      });
    }

    for (const { holding, instrument } of resolved) {
      await this.journal.create({
        kind: 'TRADE',
        body: '',
        occurredAt: asOf.toISOString(),
        trade: {
          symbol: instrument.symbol,
          quantity: holding.quantity,
          price: holding.avgCost,
          // Seeding is not a real trade, so it carries no fee.
          fee: 0,
        },
      });
    }

    return this.getPortfolio();
  }

  async reset() {
    const user = await this.users.ensureDefaultUser();
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(Transaction, { userId: user.id });
      await manager.delete(CashFlow, { userId: user.id });
      await manager.delete(JournalEntry, { userId: user.id });
    });
  }
}

function round(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
