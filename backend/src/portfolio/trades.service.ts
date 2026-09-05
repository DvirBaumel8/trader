import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, MoreThanOrEqual, Repository } from 'typeorm';
import { Transaction } from '../transactions/transaction.entity.js';
import { StopLevel } from '../transactions/stop-level.entity.js';
import { StopExecution } from '../transactions/stop-execution.entity.js';
import { JournalEntry } from '../journal/journal-entry.entity.js';
import { Tag } from '../journal/tag.entity.js';
import { EntryTag } from '../journal/entry-tag.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { DailyClose } from '../market-data/daily-close.entity.js';
import { MarketDataService } from '../market-data/market-data.service.js';
import { UsersService } from '../users/users.service.js';
import { JournalService } from '../journal/journal.service.js';
import type { StopLevelSpec } from '../journal/journal.service.js';
import { deriveTrades, summariseTrades, type DerivedTrade } from './derive-trades.js';
import { parseTradeId, windowBounds } from './trade-window.js';
import {
  computeFavorablePrice,
  evaluateStopPlan,
  resolveStopPrice,
} from './risk.js';
import { computeRelativeVolumeAtEntry } from './relative-volume.js';

/**
 * Round trips: deriving them from the transaction log, summarising them, and
 * serving one in detail.
 *
 * Split out of `PortfolioService`, which was doing this alongside pricing
 * positions and computing at-risk. A trade is a different question from a
 * position — one is a completed or running episode with an entry, an exit and
 * an R multiple; the other is what is held right now — and they were sharing
 * a class only because they read the same tables.
 *
 * `deriveAllTrades` is public because the portfolio's own at-risk box needs
 * open trades to resolve their live stops. That is the one direction the
 * dependency runs: PortfolioService uses this, never the reverse.
 */
@Injectable()
export class TradesService {
  constructor(
    @InjectRepository(Transaction)
    private readonly txns: Repository<Transaction>,
    @InjectRepository(StopLevel)
    private readonly stopLevels: Repository<StopLevel>,
    @InjectRepository(StopExecution)
    private readonly stopExecutions: Repository<StopExecution>,
    @InjectRepository(JournalEntry)
    private readonly entries: Repository<JournalEntry>,
    @InjectRepository(Tag)
    private readonly tags: Repository<Tag>,
    @InjectRepository(EntryTag)
    private readonly entryTags: Repository<EntryTag>,
    @InjectRepository(Instrument)
    private readonly instruments: Repository<Instrument>,
    @InjectRepository(DailyClose)
    private readonly closes: Repository<DailyClose>,
    private readonly marketData: MarketDataService,
    private readonly users: UsersService,
    private readonly journal: JournalService,
  ) {}

  /**
   * Every round trip, with the stop plan recorded at entry attached. Shared
   * by the stats summary and the trade detail screen so the two can never
   * disagree about what a trade is.
   */
  async deriveAllTrades(): Promise<DerivedTrade[]> {
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
        entryId: t.entryId,
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

  async getStats() {
    const trades = await this.deriveAllTrades();
    const tagsByEntry = await this.tagsByEntryId();

    return {
      ...summariseTrades(trades),
      // Fills are for the detail screen; sending them for every trade would
      // bloat a response the list view re-fetches often. Their tags are kept,
      // collapsed onto the trade: what the owner called the setup, and what he
      // called the mistake, are the only part of a fill the list wants.
      trades: trades.map(({ fills, currentStops: _stops, ...rest }) => {
        const setups = new Set<string>();
        const mistakes = new Set<string>();
        for (const f of fills) {
          const found = f.entryId ? tagsByEntry.get(f.entryId) : undefined;
          for (const t of found?.setups ?? []) setups.add(t);
          for (const t of found?.mistakes ?? []) mistakes.add(t);
        }
        return { ...rest, setups: [...setups], mistakes: [...mistakes] };
      }),
    };
  }

  /**
   * entryId -> the labels on that journal entry.
   *
   * A trade's tags are the union of the tags on every entry that composed it:
   * a setup is named when the position is opened, a mistake often only when
   * it is closed, and both belong to the same trade.
   */
  private async tagsByEntryId(): Promise<
    Map<string, { setups: string[]; mistakes: string[] }>
  > {
    const user = await this.users.ensureDefaultUser();
    const [tags, joins] = await Promise.all([
      this.tags.find({ where: { userId: user.id } }),
      this.entryTags.find(),
    ]);
    const byId = new Map(tags.map((t) => [t.id, t]));

    const out = new Map<string, { setups: string[]; mistakes: string[] }>();
    for (const join of joins) {
      const tag = byId.get(join.tagId);
      if (!tag) continue;
      const bucket = out.get(join.entryId) ?? { setups: [], mistakes: [] };
      (tag.type === 'MISTAKE' ? bucket.mistakes : bucket.setups).push(tag.label);
      out.set(join.entryId, bucket);
    }
    return out;
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
      trade: {
        ...summary,
        entryRelativeVolume,
        // Live price and the high-water mark since entry, for pricing a
        // stop-plan draft from here rather than from entry — see
        // computeRiskFromCurrentPrice's doc comment for why the Stop Plan
        // editor needs a different anchor than the entry sheet does. Both
        // null for a closed trade: nothing to protect, nothing to price.
        currentPrice: currentPriceForTrail,
        highWaterPrice,
      },
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

    // Deliberately NOT the rebuilt trade. This used to return getTrade(), a
    // payload the only caller throws away: the editor's onSuccess takes no
    // argument and immediately invalidates `trade`, `portfolio` and `stats`,
    // so the client refetches everything regardless. Building it cost up to
    // 3.6 seconds on a cold cache — fresh quotes, bars and indicators — and
    // saving a stop waited for every millisecond of it before the editor
    // would close.
    return { ok: true, levels: levels.length };
  }
}
