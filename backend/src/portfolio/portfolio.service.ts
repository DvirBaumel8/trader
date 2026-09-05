import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThanOrEqual, Repository } from 'typeorm';
import { Transaction } from '../transactions/transaction.entity.js';
import { CashFlow } from '../transactions/cash-flow.entity.js';
import { Dividend } from '../transactions/dividend.entity.js';
import { StopLevel } from '../transactions/stop-level.entity.js';
import { StopExecution } from '../transactions/stop-execution.entity.js';
import { JournalEntry } from '../journal/journal-entry.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { DailyClose } from '../market-data/daily-close.entity.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
import { MarketDataService } from '../market-data/market-data.service.js';
import { FundamentalsService } from '../market-data/fundamentals.service.js';
import { HistoryService } from '../market-data/history.service.js';
import { TradesService } from './trades.service.js';
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
import { tradeId } from './trade-window.js';
import { computeAtRisk } from './risk.js';
import { computeStopDistances } from './stop-distance.js';
import { bucketFees, totalFees, type FeePeriod } from './fee-buckets.js';

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
    @InjectRepository(StopExecution)
    private readonly stopExecutions: Repository<StopExecution>,
    @InjectRepository(JournalEntry)
    private readonly entries: Repository<JournalEntry>,
    @InjectRepository(Instrument)
    private readonly instruments: Repository<Instrument>,
    @InjectRepository(DailyClose)
    private readonly closes: Repository<DailyClose>,
    private readonly instrumentsService: InstrumentsService,
    private readonly marketData: MarketDataService,
    private readonly fundamentals: FundamentalsService,
    private readonly history: HistoryService,
    private readonly users: UsersService,
    private readonly journal: JournalService,
    private readonly trades: TradesService,
    private readonly dataSource: DataSource,
  ) {}

  async getPortfolio(opts: { refresh?: boolean } = {}) {
    // Deliberately NOT awaited. The top-up keeps `daily_closes` current for
    // trailing stops, but this endpoint is polled every 60s and the request
    // logging caught it taking 1.1s and 2.6s in real use. Nothing on THIS
    // response needs the bars that are about to arrive — they land before the
    // next poll, one minute away. Errors are swallowed inside ensureFresh;
    // the catch here is belt and braces against an unhandled rejection.
    void this.history.ensureFresh().catch(() => {});

    const user = await this.users.ensureDefaultUser();
    const [txnRows, flowRows, divRows, instrumentRows, entryRows] =
      await Promise.all([
        this.txns.find({ where: { userId: user.id } }),
        this.flows.find({ where: { userId: user.id } }),
        this.dividendRows.find({ where: { userId: user.id } }),
        this.instruments.find(),
        this.entries.find({ where: { userId: user.id } }),
      ]);
    // Journal entries record a date, not a time, so same-day fills collide on
    // executedAt. The entry's createdAt is the order the owner logged them in
    // - the tie-break compareFills uses. Taken from the ENTRY rather than the
    // transaction because an edit recreates transaction rows (and their
    // createdAt) while leaving the entry's own untouched.
    const recordedAtByEntry = new Map(
      entryRows.map((e) => [e.id, e.createdAt]),
    );

    const symbolById = new Map(instrumentRows.map((i) => [i.id, i.symbol]));
    const nameBySymbol = new Map(instrumentRows.map((i) => [i.symbol, i.name]));
    const instrumentIdBySymbol = new Map(
      instrumentRows.map((i) => [i.symbol, i.id]),
    );

    const derivedTxns: DerivedTxn[] = txnRows.map((t) => ({
      recordedAt: recordedAtByEntry.get(t.entryId) ?? null,
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
    // Production prices come from Yahoo's chart endpoint, which carries no
    // fundamentals, so the multiple is computed from a separate provider's
    // trailing EPS. A no-op where the quote already had one.
    await this.fundamentals.fillMissingPeRatios(quotes);

    const openTrades = (await this.trades.deriveAllTrades()).filter(
      (t) => t.isOpen,
    );
    const openTradeBySymbol = new Map(
      openTrades.map((t) => [t.symbol, tradeId(t.symbol, t.enteredAt)]),
    );
    // A TRAILING current stop needs the high-water price since entry to
    // resolve to a concrete level (see resolveStopPrice/computeFavorablePrice
    // in risk.ts) — fetched only for symbols that actually have one, since it
    // is the one part of this endpoint that touches daily_closes.
    const trailingSymbols = openTrades.filter((t) =>
      t.currentStops.some(
        (l) => l.kind === 'TRAILING' && l.trailPercent !== null && l.trailPercent > 0,
      ),
    );
    const highWaterPriceBySymbol = new Map<string, number | null>();
    await Promise.all(
      trailingSymbols.map(async (t) => {
        const instrumentId = instrumentIdBySymbol.get(t.symbol);
        if (!instrumentId) {
          highWaterPriceBySymbol.set(t.symbol, null);
          return;
        }
        const bars = await this.closes.find({
          where: {
            instrumentId,
            date: MoreThanOrEqual(t.enteredAt.toISOString().slice(0, 10)),
          },
        });
        highWaterPriceBySymbol.set(
          t.symbol,
          await this.trades.resolveHighWaterPrice(
            t.symbol,
            t.enteredAt,
            t.direction,
            bars,
            quotes.get(t.symbol)?.price ?? null,
          ),
        );
      }),
    );

    // "How much could I lose from here" wants the stop that is LIVE now, not
    // the one set at entry — see DerivedTrade.currentStops. Keyed the same
    // way the trade lookup above already is, so this reuses that pass rather
    // than a second one over transactions.
    const openTradeCurrentStopsBySymbol = new Map(
      openTrades.map((t) => [
        t.symbol,
        {
          direction: t.direction,
          avgEntry: t.avgEntry,
          levels: t.currentStops,
          highWaterPrice: highWaterPriceBySymbol.get(t.symbol) ?? null,
        },
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
        // Trailing P/E, fetched live alongside the price rather than stored:
        // the AI summary and the owner both want today's multiple, not a
        // history of it, and it comes free in the same Yahoo quote call.
        // Null — never 0 — when Yahoo has none or it isn't meaningful; see
        // RawQuote in yahoo.client.ts.
        peRatio: quote?.peRatio ?? null,
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

    const atRisk = computeAtRisk(positions, openTradeCurrentStopsBySymbol);

    // A position whose stop plan makes no sense for its CURRENT direction
    // (see evaluateStopPlan) cannot be priced into a per-tier distance
    // either — the "stop" price was never meant for this side of the
    // market. Left out of the Stops page's tier list the same way it is
    // left out of the At-risk dollar sum; still surfaced via
    // atRisk.stopPlanNeedsUpdate so it is never silently dropped.
    const noSensibleDistance = new Set(
      atRisk.stopPlanNeedsUpdate.positions
        .filter((p) => p.issue === 'DIRECTION_MISMATCH' || p.issue === 'CLOSED_WITH_STOPS')
        .map((p) => p.symbol),
    );

    // One row per stop TIER, priced against each position's live quote —
    // what the Stops page reads. Reuses the exact positions/quotes already
    // computed above, so this page can never disagree with the dashboard or
    // the At-risk box about a stop's distance. See stop-distance.ts.
    const stopTiers = computeStopDistances(
      positions
        .filter(
          (p) =>
            openTradeCurrentStopsBySymbol.has(p.symbol) &&
            !noSensibleDistance.has(p.symbol),
        )
        .map((p) => {
          const plan = openTradeCurrentStopsBySymbol.get(p.symbol)!;
          return {
            symbol: p.symbol,
            direction: plan.direction,
            avgEntry: plan.avgEntry,
            currentPrice: p.price,
            session: p.session,
            extended: p.extended,
            stale: p.stale,
            levels: plan.levels,
            highWaterPrice: plan.highWaterPrice,
          };
        }),
    );

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
      stopTiers,
    };
  }

  /**
   * Fees grouped into periods, for the journal's fees tab.
   *
   * Read from `transactions` rather than from journal entries: a fee is
   * charged on a fill, and transactions are the record of fills. The frontend
   * used to fetch every trade entry and total them itself.
   */
  async getFees(period: FeePeriod) {
    const user = await this.users.ensureDefaultUser();
    const rows = await this.txns.find({
      where: { userId: user.id },
      select: { executedAt: true, fee: true },
    });
    const events = rows.map((t) => ({ occurredAt: t.executedAt, fee: t.fee }));

    return {
      period,
      buckets: bucketFees(events, period),
      // The total is over EVERY fee ever paid, not just the buckets shown:
      // the window is a display limit, and a "total fees" that silently
      // excluded older trades would be wrong rather than merely partial.
      total: totalFees(events),
    };
  }

}
