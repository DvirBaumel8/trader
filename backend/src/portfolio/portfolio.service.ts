import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, MoreThanOrEqual, Repository } from 'typeorm';
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
import { HistoryService } from '../market-data/history.service.js';
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
import {
  computeFavorablePrice,
  computeRiskFromCurrentPrice,
  evaluateStopPlan,
  resolveStopPrice,
  type StopLevelInput,
  type StopPlanIssue,
} from './risk.js';
import { computeRelativeVolumeAtEntry } from './relative-volume.js';
import { computeStopDistances } from './stop-distance.js';
import { bucketFees, totalFees, type FeePeriod } from './fee-buckets.js';
import type { StopLevelSpec } from '../journal/journal.service.js';

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
    private readonly history: HistoryService,
    private readonly users: UsersService,
    private readonly journal: JournalService,
    private readonly dataSource: DataSource,
  ) {}

  async getPortfolio(opts: { refresh?: boolean } = {}) {
    // Trailing stops resolve from the high-water mark since entry, which is
    // read out of `daily_closes` — so stale bars mean a stop price that is
    // quietly below the broker's. Debounced and swallowing its own failures;
    // see HistoryService.ensureFresh.
    await this.history.ensureFresh();

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

    const openTrades = (await this.deriveAllTrades()).filter((t) => t.isOpen);
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
        const currentPrice = quotes.get(t.symbol)?.price ?? null;
        highWaterPriceBySymbol.set(
          t.symbol,
          computeFavorablePrice(
            // high/low are null on bars written before that migration —
            // close is never null, and a fallback to it is still a real
            // traded price, just a less extreme one than the true high/low.
            bars.map((b) => ({ high: b.high ?? b.close, low: b.low ?? b.close })),
            t.direction,
            currentPrice,
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

    const atRisk = this.computeAtRisk(positions, openTradeCurrentStopsBySymbol);

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
   *
   * Coverage is also never allowed to exceed what is actually held (see
   * `evaluateStopPlan`). A position whose tiers merely overshoot the held
   * quantity still contributes — `computeRiskFromCurrentPrice` caps the
   * dollar figure proportionally — but a position whose tiers make no sense
   * for its CURRENT direction (a stop recorded while long, now held short)
   * contributes nothing at all: pricing it would produce a number, just not
   * a truthful one. Either kind of drift is reported separately in
   * `stopPlanNeedsUpdate`, distinct from "no stop at all" — the owner has a
   * plan on record, it just no longer matches the position.
   */
  private computeAtRisk(
    positions: Array<{
      symbol: string;
      quantity: number;
      price: number | null;
    }>,
    currentStopsBySymbol: Map<
      string,
      {
        direction: 'LONG' | 'SHORT';
        avgEntry: number;
        levels: StopLevelInput[];
        highWaterPrice: number | null;
      }
    >,
  ) {
    let amount = 0;
    const symbolsWithoutStop: string[] = [];
    const needsUpdate: Array<{
      symbol: string;
      issue: StopPlanIssue;
      recordedQuantity: number;
      heldQuantity: number;
    }> = [];

    for (const p of positions) {
      const plan = currentStopsBySymbol.get(p.symbol);
      if (!plan || plan.levels.length === 0) {
        symbolsWithoutStop.push(p.symbol);
        continue;
      }
      // A stop plan exists but there is no live price to measure it against
      // (never successfully quoted). Rare, and not the same situation as
      // having no stop at all, so it is left out of both the sum and the
      // "without a stop" count rather than guessed at.
      if (p.price === null) continue;

      const hasUnresolvedTrailing = plan.levels.some(
        (l) =>
          l.kind === 'TRAILING' &&
          l.trailPercent !== null &&
          l.trailPercent > 0 &&
          plan.highWaterPrice === null,
      );
      const status = evaluateStopPlan({
        heldQuantity: p.quantity,
        recordedDirection: plan.direction,
        levels: plan.levels,
        hasUnresolvedTrailing,
      });

      if (
        status.issue === 'DIRECTION_MISMATCH' ||
        status.issue === 'CLOSED_WITH_STOPS'
      ) {
        needsUpdate.push({
          symbol: p.symbol,
          issue: status.issue,
          recordedQuantity: status.recordedQuantity,
          heldQuantity: status.heldQuantity,
        });
        continue;
      }

      const risk = computeRiskFromCurrentPrice({
        avgEntry: plan.avgEntry,
        currentPrice: p.price,
        quantity: Math.abs(p.quantity),
        levels: plan.levels,
        direction: plan.direction,
        highWaterPrice: plan.highWaterPrice,
      });
      if (risk.amount !== null) {
        amount += Math.max(0, risk.amount);
      }

      if (status.issue === 'OVER_COVERED' || status.issue === 'UNRESOLVED_TRAILING') {
        needsUpdate.push({
          symbol: p.symbol,
          issue: status.issue,
          recordedQuantity: status.recordedQuantity,
          heldQuantity: status.heldQuantity,
        });
      }
    }

    return {
      amount: round(amount),
      positionsWithoutStop: {
        count: symbolsWithoutStop.length,
        symbols: symbolsWithoutStop,
      },
      stopPlanNeedsUpdate: {
        count: needsUpdate.length,
        positions: needsUpdate,
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
    const [txnRows, instrumentRows, levelRows, executionRows, entryRows] =
      await Promise.all([
        this.txns.find({ where: { userId: user.id } }),
        this.instruments.find(),
        this.stopLevels.find(),
        this.stopExecutions.find(),
        this.entries.find({ where: { userId: user.id } }),
      ]);
    // See getPortfolio: same-day fills tie on executedAt and the entry's
    // createdAt is the only surviving evidence of their real order.
    const recordedAtByEntry = new Map(
      entryRows.map((e) => [e.id, e.createdAt]),
    );
    const symbolById = new Map(instrumentRows.map((i) => [i.id, i.symbol]));

    const levelsByTxn = new Map<string, StopLevel[]>();
    for (const l of levelRows) {
      levelsByTxn.set(l.transactionId, [
        ...(levelsByTxn.get(l.transactionId) ?? []),
        l,
      ]);
    }

    // The owner's confirmed attribution of a reducing fill to the tier(s) it
    // executed — see stop-execution.entity.ts. Keyed by transactionId so
    // computeEffectiveStops (via deriveTrades) can consume them directly
    // instead of guessing by price, exactly as it already does for a
    // recorded exitKind.
    const executionsByTxn = new Map<
      string,
      Array<{ stopLevelId: string; quantity: number }>
    >();
    for (const ex of executionRows) {
      executionsByTxn.set(ex.transactionId, [
        ...(executionsByTxn.get(ex.transactionId) ?? []),
        { stopLevelId: ex.stopLevelId, quantity: ex.quantity },
      ]);
    }

    return deriveTrades(
      txnRows.map((t) => ({
        recordedAt: recordedAtByEntry.get(t.entryId) ?? null,
        symbol: symbolById.get(t.instrumentId) ?? 'UNKNOWN',
        side: t.side,
        quantity: t.quantity,
        price: t.price,
        fee: t.fee,
        executedAt: t.executedAt,
        // Every revision ever recorded, not just the live one — deriveTrades
        // picks the entry (earliest) and current (latest) revision itself.
        stopLevels: (levelsByTxn.get(t.id) ?? [])
          .sort((a, b) => a.revisionSeq - b.revisionSeq || a.ordinal - b.ordinal)
          .map((l) => ({
            // Carried through so computeEffectiveStops can match a recorded
            // StopExecution to the exact tier it names, not just guess by
            // price. See derive-trades.ts's selectCurrentStopsWithIds.
            id: l.id,
            kind: l.kind,
            price: l.price,
            trailPercent: l.trailPercent,
            quantity: l.quantity,
            revisionSeq: l.revisionSeq,
            createdAt: l.createdAt ? l.createdAt.toISOString() : null,
          })),
        plannedTarget: t.plannedTarget,
        executions: executionsByTxn.get(t.id),
        exitKind: t.exitKind,
      })),
    );
  }

  /**
   * Relative volume at entry — entry-day volume against the 20 trading days
   * before it — for every currently open position, keyed by symbol. This is
   * the fact that lets the AI summary check the owner's own stated rule
   * ("volume as a confirming indicator"); see relative-volume.ts.
   *
   * Deliberately not part of `getPortfolio()`: that endpoint is polled by
   * the dashboard on a normal, frequent cadence, and this does one extra
   * `daily_closes` query per open position. It is computed fresh here
   * instead, only when something actually needs it — today, that is the AI
   * summary, which already makes a fresh, uncached call on every request.
   */
  async getOpenTradeEntryVolume(): Promise<Map<string, number | null>> {
    const openTrades = (await this.deriveAllTrades()).filter((t) => t.isOpen);
    const out = new Map<string, number | null>();
    if (openTrades.length === 0) return out;

    const instrumentRows = await this.instruments.find();
    const instrumentIdBySymbol = new Map(
      instrumentRows.map((i) => [i.symbol, i.id]),
    );

    await Promise.all(
      openTrades.map(async (t) => {
        const instrumentId = instrumentIdBySymbol.get(t.symbol);
        if (!instrumentId) {
          out.set(t.symbol, null);
          return;
        }
        const entryDate = t.enteredAt.toISOString().slice(0, 10);
        // Same 45-day runway HistoryService uses ahead of a first trade —
        // comfortably more calendar days than the 20 TRADING days
        // computeRelativeVolumeAtEntry needs, even across holidays.
        const from = new Date(t.enteredAt);
        from.setUTCDate(from.getUTCDate() - 45);
        const bars = await this.closes.find({
          where: {
            instrumentId,
            date: Between(from.toISOString().slice(0, 10), entryDate),
          },
          order: { date: 'ASC' },
        });
        const { relativeVolume } = computeRelativeVolumeAtEntry(
          bars.map((b) => ({ date: b.date, volume: b.volume })),
          entryDate,
        );
        out.set(t.symbol, relativeVolume);
      }),
    );

    return out;
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

  async getStats() {
    const trades = await this.deriveAllTrades();
    return {
      ...summariseTrades(trades),
      // Fills are for the detail screen; sending them for every trade would
      // bloat a response the list view re-fetches often.
      trades: trades.map(({ fills: _fills, currentStops: _stops, ...rest }) => rest),
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

    const { fills, currentStops, ...summary } = trade;
    // Reuses the bars already fetched for the chart window above — that
    // window is padded ~21 trading days before entry (see windowBounds),
    // comfortably covering the 20-day lookback this needs. Nulled honestly
    // by computeRelativeVolumeAtEntry when a holiday-heavy stretch or a thin
    // backfill leaves fewer bars than that.
    const { relativeVolume: entryRelativeVolume } = computeRelativeVolumeAtEntry(
      bars.map((b) => ({ date: b.date, volume: b.volume })),
      trade.enteredAt.toISOString().slice(0, 10),
    );

    // A TRAILING level's concrete price needs the high-water mark since
    // entry (see resolveStopPrice/computeFavorablePrice) — bounded to the
    // trade's own life, not the padded chart window either side of it, and
    // including today's live price for a still-open trade (the backfill is
    // manual, so today's bar may not exist yet).
    const entryDate = trade.enteredAt.toISOString().slice(0, 10);
    const exitDate = trade.exitedAt ? trade.exitedAt.toISOString().slice(0, 10) : null;
    const barsSinceEntry = bars.filter(
      (b) => b.date >= entryDate && (exitDate === null || b.date <= exitDate),
    );
    const currentPriceForTrail = trade.isOpen
      ? ((await this.marketData.getQuotes([trade.symbol], false)).get(trade.symbol)
          ?.price ?? null)
      : null;
    const highWaterPrice = computeFavorablePrice(
      barsSinceEntry.map((b) => ({ high: b.high ?? b.close, low: b.low ?? b.close })),
      trade.direction,
      currentPriceForTrail,
    );
    const hasUnresolvedTrailing = currentStops.some(
      (l) =>
        l.kind === 'TRAILING' && l.trailPercent !== null && l.trailPercent > 0,
    ) && highWaterPrice === null;

    return {
      trade: { ...summary, entryRelativeVolume },
      fills,
      // The chart draws the stop that is live now, not the one at entry —
      // see DerivedTrade.currentStops. The JSON key stays `stopLevels`,
      // which is what the frontend chart already expects. Deliberately NOT
      // capped or cleared here even for a closed trade: this is the chart's
      // historical record of what was recorded during the trade's life, not
      // a live risk figure — see `stopPlanStatus` below for that.
      //
      // Each level also carries `resolvedPrice` — the concrete price it
      // currently sits at, for both FIXED and TRAILING (null for a
      // TRAILING level with no resolvable high-water price) — so the chart
      // can draw a trailing stop's live line without re-deriving risk.ts's
      // math itself.
      stopLevels: currentStops.map((l) => ({
        ...l,
        resolvedPrice: resolveStopPrice(l, trade.direction, highWaterPrice),
      })),
      // Whether the recorded plan still matches the position RIGHT NOW —
      // same check the Stops page and At-risk box use (evaluateStopPlan).
      // Additive, so a closed trade's history above is never altered by it;
      // this only tells the caller whether that history is still current.
      stopPlanStatus: evaluateStopPlan({
        heldQuantity: trade.remainingQuantity,
        recordedDirection: trade.direction,
        levels: currentStops,
        hasUnresolvedTrailing,
      }),
      // Volume is surfaced but there is no volume pane in the chart yet —
      // deliberately out of scope, see the volume/P/E work's plan.
      bars: bars.map((b) => ({
        date: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      })),
      // The chart says what it actually has rather than implying the window
      // is complete: the backfill is manual, so bars can end before the trade
      // does.
      lastBarDate: bars.at(-1)?.date ?? null,
    };
  }

  /**
   * Appends a new stop revision against the OPENING transaction of the trade
   * `tradeId` identifies — used when reducing a position prompts the owner
   * to revise its stop plan without re-editing the journal entry that opened
   * it (see journal.service.ts's `reviseStopLevels`, the only thing this
   * calls: it is still the single write path for `stop_levels`, and a
   * revision, once written, is never edited or deleted).
   */
  async reviseTradeStops(tradeId: string, levels: StopLevelSpec[]) {
    const parsed = parseTradeId(tradeId);
    if (!parsed) throw new NotFoundException('Unknown trade');

    const user = await this.users.ensureDefaultUser();
    const instrument = await this.instruments.findOne({
      where: { symbol: parsed.symbol },
    });
    if (!instrument) throw new NotFoundException('Unknown trade');

    // Same matching approach as getTrade(): a trade has no db id of its own,
    // so its opening transaction is found by exact executedAt match against
    // the timestamp baked into the trade id.
    const candidates = await this.txns.find({
      where: { userId: user.id, instrumentId: instrument.id },
    });
    const openingTxn = candidates.find(
      (t) => t.executedAt.toISOString() === parsed.enteredAt,
    );
    if (!openingTxn) throw new NotFoundException('Unknown trade');

    // An empty plan cannot be recorded. `stop_levels` is append-only and a
    // revision IS its rows, so "no stops" has no representation - writing
    // zero rows leaves revisionSeq unadvanced and selectCurrentStops keeps
    // returning the PREVIOUS revision. The save would appear to succeed while
    // the tier stayed live and stayed priced into the at-risk figure the
    // owner acts on. Rejecting loudly beats lying quietly; removing every
    // stop goes through the journal entry, which CLAUDE.md already names as
    // the one correction path.
    if (levels.length === 0) {
      const existing = await this.stopLevels.find({
        where: { transactionId: openingTxn.id },
      });
      if (existing.length > 0) {
        throw new BadRequestException(
          'A stop plan cannot be emptied here. Edit the journal entry that opened this trade to remove its stops.',
        );
      }
    }

    await this.journal.reviseStopLevels(openingTxn.id, levels);
    return this.getTrade(tradeId);
  }
}

function round(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
