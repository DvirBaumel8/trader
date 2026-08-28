import {
  BadRequestException,
  Injectable,
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
import { Instrument } from '../instruments/instrument.entity.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
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
    @InjectRepository(Tag) private readonly tags: Repository<Tag>,
    @InjectRepository(EntryTag)
    private readonly entryTags: Repository<EntryTag>,
    @InjectRepository(Instrument)
    private readonly instruments: Repository<Instrument>,
    private readonly instrumentsService: InstrumentsService,
    private readonly users: UsersService,
    private readonly dataSource: DataSource,
  ) {}

  async list(filters: ListFilters = {}): Promise<EntryView[]> {
    const user = await this.users.ensureDefaultUser();
    const [entries, txns, flows, divs, instruments, allTags, joins, levels] =
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
      ]);

    const symbolById = new Map(instruments.map((i) => [i.id, i.symbol]));
    const txnByEntry = new Map(txns.map((t) => [t.entryId, t]));
    const flowByEntry = new Map(flows.map((f) => [f.entryId, f]));
    const divByEntry = new Map(divs.map((d) => [d.entryId, d]));
    const tagById = new Map(allTags.map((t) => [t.id, t]));

    const levelsByTxn = new Map<string, StopLevel[]>();
    for (const l of levels) {
      levelsByTxn.set(l.transactionId, [
        ...(levelsByTxn.get(l.transactionId) ?? []),
        l,
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
        const tiers = (levelsByTxn.get(t.id) ?? []).sort(
          (a, b) => a.ordinal - b.ordinal,
        );
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

      await this.writeOwnedRows(manager, user.id, entry.id, input, resolved);
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
   */
  async update(id: string, input: CreateEntryInput): Promise<EntryView> {
    const user = await this.users.ensureDefaultUser();
    const existing = await this.entries.findOne({
      where: { id, userId: user.id },
    });
    if (!existing) throw new NotFoundException('Entry not found');

    const resolved = await this.resolveTrade(input);

    await this.dataSource.transaction(async (manager) => {
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
      await this.writeOwnedRows(manager, user.id, id, input, resolved);
      await this.applyTags(manager, user.id, id, input.tags ?? []);
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
      await this.clearOwnedRows(manager, id);
      await manager.delete(EntryTag, { entryId: id });
      await manager.delete(JournalEntry, { id });
    });
  }

  /**
   * Validates and resolves the instrument BEFORE any transaction opens, so an
   * unknown ticker fails without leaving a half-written entry behind.
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
      return { side: 'BUY' as const, quantity: 0, instrumentId: instrument.id };
    }
    return null;
  }

  private async writeOwnedRows(
    manager: EntityManager,
    userId: string,
    entryId: string,
    input: CreateEntryInput,
    resolved: { side: 'BUY' | 'SELL'; quantity: number; instrumentId: string } | null,
  ): Promise<void> {
    if (input.kind === 'TRADE' && input.trade && resolved) {
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
      await this.writeStopLevels(manager, txn.id, input.trade.stopLevels);
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

  /** Stop levels hang off the transaction, so they must go before it. */
  private async clearOwnedRows(
    manager: EntityManager,
    entryId: string,
  ): Promise<void> {
    const txns = await manager.find(Transaction, { where: { entryId } });
    for (const t of txns) {
      await manager.delete(StopLevel, { transactionId: t.id });
    }
    await manager.delete(Transaction, { entryId });
    await manager.delete(CashFlow, { entryId });
    await manager.delete(Dividend, { entryId });
  }

  /**
   * Replaces this transaction's stop tiers with exactly the ones given, so a
   * corrected stop never leaves an orphan tier behind.
   */
  private async writeStopLevels(
    manager: EntityManager,
    transactionId: string,
    levels: StopLevelSpec[] | undefined,
  ): Promise<void> {
    await manager.delete(StopLevel, { transactionId });
    let ordinal = 0;
    for (const level of levels ?? []) {
      await manager.save(
        manager.create(StopLevel, {
          transactionId,
          kind: level.kind,
          price: level.kind === 'FIXED' ? (level.price ?? null) : null,
          trailPercent:
            level.kind === 'TRAILING' ? (level.trailPercent ?? null) : null,
          quantity: Math.abs(level.quantity),
          ordinal: ordinal++,
        }),
      );
    }
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
