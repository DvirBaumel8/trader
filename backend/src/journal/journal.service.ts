import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { JournalEntry } from './journal-entry.entity.js';
import { Tag } from './tag.entity.js';
import { EntryTag } from './entry-tag.entity.js';
import { Transaction } from '../transactions/transaction.entity.js';
import { CashFlow } from '../transactions/cash-flow.entity.js';
import { Dividend } from '../transactions/dividend.entity.js';
import { StopLevel } from '../transactions/stop-level.entity.js';
import { StopExecution } from '../transactions/stop-execution.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
import { HistoryService } from '../market-data/history.service.js';
import { UsersService } from '../users/users.service.js';
import { computeRisk } from '../portfolio/risk.js';

/**
 * The UI sends a signed quantity; storage keeps side and magnitude separate.
 * Zero is always a mistake, never a valid trade.
 */
export function resolveTradeSide(signedQuantity: number): {
  side: 'BUY' | 'SELL';
  quantity: number;
} {
  if (!Number.isFinite(signedQuantity) || signedQuantity === 0) {
    throw new BadRequestException('Quantity must be a non-zero number');
  }
  return {
    side: signedQuantity > 0 ? 'BUY' : 'SELL',
    quantity: Math.abs(signedQuantity),
  };
}

/** Tags fragment badly if "Pullback" and "pullback" are different rows. */
export function normaliseTagLabel(label: string): string {
  const clean = label.trim().replace(/\s+/g, ' ').toLowerCase();
  if (clean === '') throw new BadRequestException('Tag label cannot be empty');
  return clean;
}

export interface StopLevelSpec {
  kind: 'FIXED' | 'TRAILING';
  price?: number | null;
  trailPercent?: number | null;
  quantity: number;
}

const REVISION_EPSILON = 1e-9;

function numEq(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < REVISION_EPSILON;
}

/**
 * Whether a requested tier set is identical, tier for tier and in order, to
 * the stop's current (ordinal-sorted) revision — used to decide whether
 * saving an entry should append a new stop revision at all. Order matters:
 * the tiers come from the same ordinal-ordered UI list both times, so two
 * revisions with the same levels in a different order are treated as a real
 * change rather than special-cased as equal.
 */
function sameTierSet(current: StopLevel[], requested: StopLevelSpec[]): boolean {
  if (current.length !== requested.length) return false;
  return current.every((level, i) => {
    const other = requested[i];
    return (
      level.kind === other.kind &&
      numEq(level.price, other.price ?? null) &&
      numEq(level.trailPercent, other.trailPercent ?? null) &&
      numEq(level.quantity, Math.abs(other.quantity))
    );
  });
}

export type EntryKindInput = 'TRADE' | 'NOTE' | 'CASH' | 'DIVIDEND';

export interface EntryView {
  id: string;
  kind: EntryKindInput;
  body: string;
  occurredAt: string;
  trade: {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    fee: number;
    plannedTarget: number | null;
    stopLevels: StopLevelSpec[];
    /** Dollars at risk from the tiers, computed for display. */
    riskAmount: number | null;
    /** The owner's confirmation of how this fill came about, if a reducing fill. */
    exitKind: 'STOP' | 'DISCRETIONARY' | null;
    /**
     * The owner's confirmation of which stop tier(s) this fill executed.
     * Exposed so an edit form can round-trip it: `update()` is a full
     * replace, so keeping a confirmed execution across an unrelated edit
     * requires resending it, which requires being able to read it back.
     */
    stopExecutions: { stopLevelId: string; quantity: number }[];
  } | null;
  cash: { direction: 'DEPOSIT' | 'WITHDRAW'; amount: number } | null;
  dividend: { symbol: string; amount: number } | null;
  tags: { id: string; type: 'SETUP' | 'MISTAKE'; label: string }[];
}

export interface CreateEntryInput {
  kind: EntryKindInput;
  body: string;
  occurredAt: string;
  trade?: {
    symbol: string;
    quantity: number;
    price: number;
    fee: number;
    plannedTarget?: number | null;
    stopLevels?: StopLevelSpec[];
    /** The owner's confirmation of how a reducing fill came about. */
    exitKind?: 'STOP' | 'DISCRETIONARY' | null;
    /** The owner's confirmation of which stop tier(s) a reducing fill executed. */
    stopExecutions?: { stopLevelId: string; quantity: number }[];
  };
  cash?: { direction: 'DEPOSIT' | 'WITHDRAW'; amount: number };
  dividend?: { symbol: string; amount: number };
  tags?: { type: 'SETUP' | 'MISTAKE'; label: string }[];
}

export interface ListFilters {
  symbol?: string;
  kind?: EntryKindInput;
  tagId?: string;
}

@Injectable()
export class JournalService {
  private readonly log = new Logger(JournalService.name);

  constructor(
    @InjectRepository(JournalEntry)
    private readonly entries: Repository<JournalEntry>,
    @InjectRepository(Transaction)
    private readonly txns: Repository<Transaction>,
    @InjectRepository(CashFlow)
    private readonly flows: Repository<CashFlow>,
    @InjectRepository(Dividend)
    private readonly dividends: Repository<Dividend>,
    @InjectRepository(StopLevel)
    private readonly stopLevels: Repository<StopLevel>,
    @InjectRepository(StopExecution)
    private readonly stopExecutions: Repository<StopExecution>,
    @InjectRepository(Tag) private readonly tags: Repository<Tag>,
    @InjectRepository(EntryTag)
    private readonly entryTags: Repository<EntryTag>,
    @InjectRepository(Instrument)
    private readonly instruments: Repository<Instrument>,
    private readonly instrumentsService: InstrumentsService,
    private readonly history: HistoryService,
    private readonly users: UsersService,
    private readonly dataSource: DataSource,
  ) {}

  async list(filters: ListFilters = {}): Promise<EntryView[]> {
    const user = await this.users.ensureDefaultUser();
    const [entries, txns, flows, divs, instruments, allTags, joins, levels, executions] =
      await Promise.all([
        this.entries.find({
          where: { userId: user.id },
          order: { occurredAt: 'DESC', createdAt: 'DESC' },
        }),
        this.txns.find({ where: { userId: user.id } }),
        this.flows.find({ where: { userId: user.id } }),
        this.dividends.find({ where: { userId: user.id } }),
        this.instruments.find(),
        this.tags.find({ where: { userId: user.id } }),
        this.entryTags.find(),
        this.stopLevels.find(),
        this.stopExecutions.find(),
      ]);

    const symbolById = new Map(instruments.map((i) => [i.id, i.symbol]));
    const txnByEntry = new Map(txns.map((t) => [t.entryId, t]));
    const flowByEntry = new Map(flows.map((f) => [f.entryId, f]));
    const divByEntry = new Map(divs.map((d) => [d.entryId, d]));
    const tagById = new Map(allTags.map((t) => [t.id, t]));

    // stopLevels holds every revision ever recorded, not just the live one
    // (see stop-level.entity.ts) — this view always wants the current one,
    // both for editing and for the risk figure shown per entry.
    const levelsByTxn = new Map<string, StopLevel[]>();
    for (const l of levels) {
      levelsByTxn.set(l.transactionId, [
        ...(levelsByTxn.get(l.transactionId) ?? []),
        l,
      ]);
    }
    const currentLevels = (txnId: string): StopLevel[] => {
      const all = levelsByTxn.get(txnId) ?? [];
      if (all.length === 0) return [];
      const maxSeq = Math.max(...all.map((l) => l.revisionSeq));
      return all
        .filter((l) => l.revisionSeq === maxSeq)
        .sort((a, b) => a.ordinal - b.ordinal);
    };

    const executionsByTxn = new Map<string, StopExecution[]>();
    for (const ex of executions) {
      executionsByTxn.set(ex.transactionId, [
        ...(executionsByTxn.get(ex.transactionId) ?? []),
        ex,
      ]);
    }

    const tagIdsByEntry = new Map<string, string[]>();
    for (const j of joins) {
      tagIdsByEntry.set(j.entryId, [
        ...(tagIdsByEntry.get(j.entryId) ?? []),
        j.tagId,
      ]);
    }

    const views: EntryView[] = entries.map((e) => {
      const t = txnByEntry.get(e.id);
      const f = flowByEntry.get(e.id);
      const d = divByEntry.get(e.id);

      let trade: EntryView['trade'] = null;
      if (t) {
        const tiers = currentLevels(t.id);
        const risk = computeRisk({
          avgEntry: t.price,
          quantity: t.quantity,
          direction: t.side === 'BUY' ? 'LONG' : 'SHORT',
          levels: tiers.map((l) => ({
            kind: l.kind,
            price: l.price,
            trailPercent: l.trailPercent,
            quantity: l.quantity,
          })),
        });
        trade = {
          symbol: symbolById.get(t.instrumentId) ?? 'UNKNOWN',
          side: t.side,
          quantity: t.quantity,
          price: t.price,
          fee: t.fee,
          plannedTarget: t.plannedTarget,
          stopLevels: tiers.map((l) => ({
            kind: l.kind,
            price: l.price,
            trailPercent: l.trailPercent,
            quantity: l.quantity,
          })),
          riskAmount: risk.amount,
          exitKind: t.exitKind,
          stopExecutions: (executionsByTxn.get(t.id) ?? []).map((ex) => ({
            stopLevelId: ex.stopLevelId,
            quantity: ex.quantity,
          })),
        };
      }

      return {
        id: e.id,
        kind: e.kind,
        body: e.body,
        occurredAt: e.occurredAt.toISOString(),
        trade,
        cash: f ? { direction: f.direction, amount: f.amount } : null,
        dividend: d
          ? {
              symbol: symbolById.get(d.instrumentId) ?? 'UNKNOWN',
              amount: d.amount,
            }
          : null,
        tags: (tagIdsByEntry.get(e.id) ?? [])
          .map((id) => tagById.get(id))
          .filter((t): t is Tag => t !== undefined)
          .map((t) => ({ id: t.id, type: t.type, label: t.label })),
      };
    });

    return views.filter((v) => {
      if (filters.kind && v.kind !== filters.kind) return false;
      if (filters.symbol) {
        const wanted = filters.symbol.toUpperCase();
        const matches =
          v.trade?.symbol === wanted || v.dividend?.symbol === wanted;
        if (!matches) return false;
      }
      if (filters.tagId && !v.tags.some((t) => t.id === filters.tagId)) {
        return false;
      }
      return true;
    });
  }

  async listTags() {
    const user = await this.users.ensureDefaultUser();
    return this.tags.find({
      where: { userId: user.id },
      order: { type: 'ASC', label: 'ASC' },
    });
  }

  /**
   * The ONLY write path into transactions and cash flows. Everything — the
   * composer, and seeding — goes through here, so the invariant that a
   * transaction always belongs to an entry cannot be bypassed.
   */
  async create(input: CreateEntryInput): Promise<EntryView> {
    const user = await this.users.ensureDefaultUser();
    const resolved = await this.resolveTrade(input);

    const entryId = await this.dataSource.transaction(async (manager) => {
      const entry = await manager.save(
        manager.create(JournalEntry, {
          userId: user.id,
          kind: input.kind,
          body: input.body ?? '',
          occurredAt: new Date(input.occurredAt),
        }),
      );

      await this.writeOwnedRows(manager, user.id, entry.id, input, resolved, null);
      await this.applyTags(manager, user.id, entry.id, input.tags ?? []);
      return entry.id;
    });

    const [view] = (await this.list()).filter((e) => e.id === entryId);
    return view;
  }

  /**
   * Replaces the entry's rows wholesale rather than diffing them. Positions are
   * derived, so deleting and rewriting the transaction is both simpler and
   * exactly equivalent — and it makes changing an entry's kind fall out for
   * free.
   *
   * Stop levels are the one exception: they are history, not state, so they
   * must survive the transaction row being deleted and recreated underneath
   * them. The previous transaction (if this was already a TRADE entry) is
   * looked up before `clearOwnedRows` deletes it, and its stop-level rows are
   * re-parented onto whatever new transaction this update produces — see
   * `writeOwnedRows`. If the entry stops being a TRADE, or was never one,
   * there is no new transaction to re-parent onto, so any leftover history
   * is deleted along with everything else this entry owned.
   */
  async update(id: string, input: CreateEntryInput): Promise<EntryView> {
    const user = await this.users.ensureDefaultUser();
    const existing = await this.entries.findOne({
      where: { id, userId: user.id },
    });
    if (!existing) throw new NotFoundException('Entry not found');

    const resolved = await this.resolveTrade(input);

    await this.dataSource.transaction(async (manager) => {
      const previousTxn = await manager.findOne(Transaction, {
        where: { entryId: id },
      });

      await manager.update(
        JournalEntry,
        { id },
        {
          kind: input.kind,
          body: input.body ?? '',
          occurredAt: new Date(input.occurredAt),
        },
      );
      await this.clearOwnedRows(manager, id);
      await this.writeOwnedRows(
        manager,
        user.id,
        id,
        input,
        resolved,
        previousTxn?.id ?? null,
      );
      await this.applyTags(manager, user.id, id, input.tags ?? []);

      // A previous trade transaction whose stop history was not re-parented
      // above (because this update no longer produces a TRADE transaction to
      // re-parent it onto) can no longer be reached through any live row —
      // delete it rather than leave it orphaned.
      const stillTrade = input.kind === 'TRADE' && !!resolved;
      if (previousTxn && !stillTrade) {
        await manager.delete(StopLevel, { transactionId: previousTxn.id });
      }
    });

    const [view] = (await this.list()).filter((e) => e.id === id);
    return view;
  }

  async remove(id: string): Promise<void> {
    const user = await this.users.ensureDefaultUser();
    const existing = await this.entries.findOne({
      where: { id, userId: user.id },
    });
    if (!existing) throw new NotFoundException('Entry not found');

    await this.dataSource.transaction(async (manager) => {
      const txns = await manager.find(Transaction, { where: { entryId: id } });
      for (const t of txns) {
        await manager.delete(StopLevel, { transactionId: t.id });
      }
      await this.clearOwnedRows(manager, id);
      await manager.delete(EntryTag, { entryId: id });
      await manager.delete(JournalEntry, { id });
    });
  }

  /**
   * Validates and resolves the instrument BEFORE any transaction opens, so an
   * unknown ticker fails without leaving a half-written entry behind.
   *
   * Also ensures the instrument has price history: a symbol traded for the
   * first time has no `daily_closes` rows until someone remembers to run the
   * manual backfill, and until then the performance chart values it at zero
   * instead of at cost (see series.ts) — this is what happened to CRWV and
   * NBIS on 2026-09-01. Hung here rather than in
   * InstrumentsService.findOrCreate: that seam sits on the far side of a
   * module cycle already held together by forwardRef
   * (InstrumentsModule <-> MarketDataModule), and giving InstrumentsService a
   * direct HistoryService dependency tightened that into a cycle Node
   * couldn't initialize (a live ReferenceError, "Cannot access
   * 'InstrumentsService' before initialization" — tsc and the unit tests
   * never boot the Nest container, so neither caught it). JournalModule's
   * dependency on MarketDataModule is one-directional, so no such cycle here.
   */
  private async resolveTrade(input: CreateEntryInput) {
    if (input.kind === 'TRADE') {
      if (!input.trade) {
        throw new BadRequestException('A trade entry needs trade details');
      }
      const { side, quantity } = resolveTradeSide(input.trade.quantity);
      const instrument = await this.instrumentsService.findOrCreate(
        input.trade.symbol,
      );
      await this.ensurePricedSafely(instrument);
      // exitKind/stopExecutions are validated later, inside writeOwnedRows,
      // against the SAME EntityManager as the write — not here. This method
      // runs before the write transaction opens (see its doc comment), and
      // that ownership/quantity check must read the data it guards inside
      // the same transaction as the write, not on a separate connection
      // that data could change underneath before the write commits.
      return { side, quantity, instrumentId: instrument.id };
    }
    if (input.kind === 'CASH' && !input.cash) {
      throw new BadRequestException('A cash entry needs an amount');
    }
    if (input.kind === 'DIVIDEND') {
      if (!input.dividend) {
        throw new BadRequestException('A dividend needs a ticker and amount');
      }
      const instrument = await this.instrumentsService.findOrCreate(
        input.dividend.symbol,
      );
      await this.ensurePricedSafely(instrument);
      return { side: 'BUY' as const, quantity: 0, instrumentId: instrument.id };
    }
    return null;
  }

  /**
   * The instrument's net signed position (positive long, negative short)
   * from every transaction on record, read through `manager` — the SAME
   * connection as the write this guards, inside the SAME transaction. In
   * `update()`, `writeOwnedRows` always runs after `clearOwnedRows` has
   * already deleted this entry's own prior transaction row on this manager,
   * so that prior row is correctly invisible here without needing to filter
   * it out by entry id.
   */
  private async currentNetQuantity(
    manager: EntityManager,
    instrumentId: string,
  ): Promise<number> {
    const txns = await manager.find(Transaction, { where: { instrumentId } });
    return txns.reduce(
      (sum, t) => sum + (t.side === 'BUY' ? t.quantity : -t.quantity),
      0,
    );
  }

  /**
   * Guards the owner's confirmed stop attribution (`exitKind` /
   * `stopExecutions`) against three ways it can go wrong before it ever
   * reaches the database. Runs on `manager` — the SAME `EntityManager` as
   * the write it guards, inside the SAME `dataSource.transaction(...)` —
   * rather than the injected repositories, which are separate,
   * non-transactional connections: reading through a different connection
   * than the one that performs the write leaves a TOCTOU window where the
   * data validated against could change before the write commits. A
   * `BadRequestException` thrown here still rolls back the whole
   * transaction and still surfaces as a 400, exactly as it did before.
   *
   * 1. It only means anything on a fill that actually REDUCES an existing
   *    position — derivation (`computeEffectiveStops`) only ever reads it on
   *    a reducing fill; an opening or adding fill has no tier to have
   *    executed. Checked against the instrument's current net position
   *    rather than blindly by side, because on margin a BUY can be a
   *    reducing fill too (covering a short) — see product-brief.md.
   * 2. Each `stopLevelId` must resolve to a stop level that ACTUALLY
   *    protects this instrument. Without this, a cross-instrument id is
   *    written silently, which is worse than a no-op: it makes
   *    `fill.executions` non-empty, so `computeEffectiveStops` takes the
   *    "confirmed" branch, finds no matching tier among this trade's own,
   *    and skips price matching entirely — the real tier is never consumed
   *    and the position reports stop coverage it does not have. A
   *    well-formed but nonexistent id is rejected here too, rather than
   *    left to surface as a 500 from the foreign key.
   * 3. The executions named for one fill cannot claim more shares than the
   *    fill itself sold — over-claiming does not corrupt derivation
   *    (`computeEffectiveStops` clamps at zero) but it silently
   *    UNDER-reports stop coverage, an "honest numbers" violation reachable
   *    from one mistyped digit.
   */
  private async validateExitAttribution(
    manager: EntityManager,
    trade: NonNullable<CreateEntryInput['trade']>,
    instrumentId: string,
    side: 'BUY' | 'SELL',
    quantity: number,
  ): Promise<void> {
    const netQty = await this.currentNetQuantity(manager, instrumentId);
    const isReducing =
      (side === 'SELL' && netQty > REVISION_EPSILON) ||
      (side === 'BUY' && netQty < -REVISION_EPSILON);
    if (!isReducing) {
      throw new BadRequestException(
        'exitKind and stopExecutions only apply to a fill that reduces an existing position',
      );
    }

    const stopExecutions = trade.stopExecutions ?? [];
    const requestedTotal = stopExecutions.reduce(
      (sum, exec) => sum + exec.quantity,
      0,
    );
    if (requestedTotal - quantity > REVISION_EPSILON) {
      throw new BadRequestException(
        'stopExecutions cannot claim more shares than the fill itself',
      );
    }

    for (const exec of stopExecutions) {
      const level = await manager.findOne(StopLevel, {
        where: { id: exec.stopLevelId },
      });
      if (!level) {
        throw new BadRequestException(
          `Unknown stop level ${exec.stopLevelId}`,
        );
      }
      const owningTxn = await manager.findOne(Transaction, {
        where: { id: level.transactionId },
      });
      if (!owningTxn || owningTxn.instrumentId !== instrumentId) {
        throw new BadRequestException(
          `Stop level ${exec.stopLevelId} does not belong to this instrument`,
        );
      }
    }
  }

  /**
   * Never lets a price-history fetch failure block the journal write — a
   * Yahoo outage, or any other hiccup here, is logged and the entry still
   * gets written, exactly as the existing manual backfill tolerates one bad
   * ticker.
   */
  private async ensurePricedSafely(instrument: Instrument): Promise<void> {
    try {
      await this.history.ensurePriced(instrument, instrument.symbol);
    } catch (err) {
      this.log.warn(
        `could not ensure price history for ${instrument.symbol}: ${String(err)}`,
      );
    }
  }

  private async writeOwnedRows(
    manager: EntityManager,
    userId: string,
    entryId: string,
    input: CreateEntryInput,
    resolved: { side: 'BUY' | 'SELL'; quantity: number; instrumentId: string } | null,
    /**
     * The TRADE transaction this entry owned before this write, if any.
     * `update()` deletes and recreates the transaction row on every save (see
     * its doc comment), which would otherwise sever `stop_levels` from its
     * history — this is what re-parents that history onto the new row rather
     * than losing it. `null` for `create()`, where there is no previous
     * transaction to carry forward.
     */
    previousTransactionId: string | null,
  ): Promise<void> {
    if (input.kind === 'TRADE' && input.trade && resolved) {
      const hasAttribution =
        !!input.trade.exitKind || (input.trade.stopExecutions ?? []).length > 0;
      if (hasAttribution) {
        // Validated here, against `manager` — the same connection and the
        // same transaction as the write below — rather than earlier in
        // `resolveTrade` (which runs before this transaction opens, on the
        // injected repositories' own connections). Must run BEFORE the
        // Transaction row is inserted, so the net-position check reads this
        // instrument's position as it stood before this fill.
        await this.validateExitAttribution(
          manager,
          input.trade,
          resolved.instrumentId,
          resolved.side,
          resolved.quantity,
        );
      }

      const txn = await manager.save(
        manager.create(Transaction, {
          userId,
          entryId,
          instrumentId: resolved.instrumentId,
          side: resolved.side,
          quantity: resolved.quantity,
          price: Math.abs(input.trade.price),
          fee: Math.abs(input.trade.fee ?? 0),
          plannedTarget: input.trade.plannedTarget ?? null,
          executedAt: new Date(input.occurredAt),
        }),
      );
      if (previousTransactionId && previousTransactionId !== txn.id) {
        await manager.update(
          StopLevel,
          { transactionId: previousTransactionId },
          { transactionId: txn.id },
        );
      }
      await this.writeStopRevision(manager, txn.id, input.trade.stopLevels);

      // The owner's own confirmation of how this fill came about, and which
      // tier(s) it executed — see stop-execution.entity.ts. An execution is
      // a claim about THIS fill, so on update() it is rewritten from the new
      // payload exactly like tags: `clearOwnedRows` deletes the previous
      // Transaction row, which cascades away its `stop_executions` rows, and
      // this recreates them against the fresh transaction id. That means an
      // edit to any field of a TRADE entry must resend `exitKind` /
      // `stopExecutions` to keep a previously confirmed attribution — the
      // same way it must already resend `stopLevels` to keep the stop plan
      // (stopLevels alone survives because it is re-parented, not deleted).
      if (input.trade.exitKind) {
        await manager.update(Transaction, txn.id, {
          exitKind: input.trade.exitKind,
        });
      }
      for (const exec of input.trade.stopExecutions ?? []) {
        await manager.save(
          manager.create(StopExecution, {
            stopLevelId: exec.stopLevelId,
            transactionId: txn.id,
            quantity: Math.abs(exec.quantity),
          }),
        );
      }
    }

    if (input.kind === 'CASH' && input.cash) {
      await manager.save(
        manager.create(CashFlow, {
          userId,
          entryId,
          direction: input.cash.direction,
          amount: Math.abs(input.cash.amount),
          occurredAt: new Date(input.occurredAt),
        }),
      );
    }

    if (input.kind === 'DIVIDEND' && input.dividend && resolved) {
      await manager.save(
        manager.create(Dividend, {
          userId,
          entryId,
          instrumentId: resolved.instrumentId,
          amount: Math.abs(input.dividend.amount),
          occurredAt: new Date(input.occurredAt),
        }),
      );
    }
  }

  /**
   * Deletes the entry's Transaction/CashFlow/Dividend rows. Stop levels are
   * deliberately NOT touched here — they are history, kept across an
   * `update()`'s delete-and-recreate of the transaction row (see
   * `writeOwnedRows`) and only ever hard-deleted by `remove()`, or by
   * `update()` itself when the entry stops being a TRADE at all.
   */
  private async clearOwnedRows(
    manager: EntityManager,
    entryId: string,
  ): Promise<void> {
    await manager.delete(Transaction, { entryId });
    await manager.delete(CashFlow, { entryId });
    await manager.delete(Dividend, { entryId });
  }

  /**
   * Appends a new stop revision only when the requested tier set actually
   * differs from the current one — so re-saving an entry whose stops were
   * untouched (e.g. correcting a typo in the note) does not spam a revision
   * with no real change. This is the ONLY write path for `stop_levels`: a
   * revision, once written, is never edited or deleted (only re-parented
   * onto a new transaction id — see `writeOwnedRows` — or removed wholesale
   * with its entry). This is the fix for the bug that made every closed
   * trade's R-multiple null: trailing a stop used to delete and rewrite the
   * row in place, destroying the stop set at entry the moment it was ever
   * moved.
   */
  private async writeStopRevision(
    manager: EntityManager,
    transactionId: string,
    levels: StopLevelSpec[] | undefined,
  ): Promise<void> {
    const requested = levels ?? [];
    const current = (
      await manager.find(StopLevel, { where: { transactionId } })
    ).sort((a, b) => a.ordinal - b.ordinal);

    const maxSeq =
      current.length === 0
        ? -1
        : Math.max(...current.map((l) => l.revisionSeq));
    const latestRevision = current.filter((l) => l.revisionSeq === maxSeq);

    if (maxSeq === -1 && requested.length === 0) return; // Nothing to record.
    if (maxSeq !== -1 && sameTierSet(latestRevision, requested)) return;

    const nextSeq = maxSeq + 1;
    const now = new Date();
    let ordinal = 0;
    for (const level of requested) {
      await manager.save(
        manager.create(StopLevel, {
          transactionId,
          kind: level.kind,
          price: level.kind === 'FIXED' ? (level.price ?? null) : null,
          trailPercent:
            level.kind === 'TRAILING' ? (level.trailPercent ?? null) : null,
          quantity: Math.abs(level.quantity),
          ordinal: ordinal++,
          revisionSeq: nextSeq,
          createdAt: now,
        }),
      );
    }
  }

  /**
   * Appends a stop revision directly against an existing transaction,
   * outside the normal create/update-entry flow — used when reducing a
   * position prompts the owner to revise its stop plan without reopening
   * (and re-editing) the entry that originally opened it. Reuses
   * `writeStopRevision` so this stays the ONE write path for `stop_levels`:
   * a revision, once written, is never edited or deleted, only appended.
   */
  async reviseStopLevels(
    transactionId: string,
    levels: StopLevelSpec[],
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.writeStopRevision(manager, transactionId, levels);
    });
  }

  /** Find-or-create each tag, then replace the entry's joins with exactly these. */
  private async applyTags(
    manager: EntityManager,
    userId: string,
    entryId: string,
    tags: { type: 'SETUP' | 'MISTAKE'; label: string }[],
  ): Promise<void> {
    await manager.delete(EntryTag, { entryId });
    for (const t of tags) {
      const label = normaliseTagLabel(t.label);
      let tag = await manager.findOne(Tag, {
        where: { userId, type: t.type, label },
      });
      if (!tag) {
        tag = await manager.save(
          manager.create(Tag, { userId, type: t.type, label }),
        );
      }
      await manager.save(manager.create(EntryTag, { entryId, tagId: tag.id }));
    }
  }
}
