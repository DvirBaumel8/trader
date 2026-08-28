import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Transaction } from '../transactions/transaction.entity.js';
import { CashFlow } from '../transactions/cash-flow.entity.js';
import { JournalEntry } from '../journal/journal-entry.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
import { MarketDataService } from '../market-data/market-data.service.js';
import { UsersService } from '../users/users.service.js';
import {
  derivePositions,
  deriveCash,
  type DerivedTxn,
  type DerivedFlow,
} from './derive.js';

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
    @InjectRepository(JournalEntry)
    private readonly entries: Repository<JournalEntry>,
    @InjectRepository(Instrument)
    private readonly instruments: Repository<Instrument>,
    private readonly instrumentsService: InstrumentsService,
    private readonly marketData: MarketDataService,
    private readonly users: UsersService,
    private readonly dataSource: DataSource,
  ) {}

  async getPortfolio(opts: { refresh?: boolean } = {}) {
    const user = await this.users.ensureDefaultUser();
    const [txnRows, flowRows, instrumentRows] = await Promise.all([
      this.txns.find({ where: { userId: user.id } }),
      this.flows.find({ where: { userId: user.id } }),
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

    const derived = derivePositions(derivedTxns).filter((p) => p.isOpen);
    const cash = deriveCash(derivedTxns, derivedFlows);

    const quotes = await this.marketData.getQuotes(
      derived.map((p) => p.symbol),
      opts.refresh === true,
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
        marketValue,
        unrealizedPnl: marketValue === null ? null : marketValue - p.costBasis,
        unrealizedPct:
          marketValue === null || p.costBasis === 0
            ? null
            : (marketValue - p.costBasis) / Math.abs(p.costBasis),
      };
    });

    const positionsValue = positions.reduce(
      (sum, p) => sum + (p.marketValue ?? 0),
      0,
    );

    return {
      positions,
      cash,
      positionsValue,
      accountValue: cash + positionsValue,
      hasStalePrices: positions.some((p) => p.stale),
      // When the client last got real numbers, so the UI can say "updated 17:31".
      pricedAt: new Date().toISOString(),
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

    await this.dataSource.transaction(async (manager) => {
      if (contributed !== 0) {
        const entry = await manager.save(
          manager.create(JournalEntry, {
            userId: user.id,
            kind: 'CASH',
            body: 'Opening capital (seeded)',
            occurredAt: asOf,
          }),
        );
        await manager.save(
          manager.create(CashFlow, {
            userId: user.id,
            entryId: entry.id,
            direction: contributed > 0 ? 'DEPOSIT' : 'WITHDRAW',
            amount: Math.abs(contributed),
            occurredAt: asOf,
          }),
        );
      }

      for (const { holding, instrument } of resolved) {
        const entry = await manager.save(
          manager.create(JournalEntry, {
            userId: user.id,
            kind: 'TRADE',
            body: `Opening position (seeded): ${instrument.symbol}`,
            occurredAt: asOf,
          }),
        );
        await manager.save(
          manager.create(Transaction, {
            userId: user.id,
            entryId: entry.id,
            instrumentId: instrument.id,
            side: holding.quantity >= 0 ? 'BUY' : 'SELL',
            quantity: Math.abs(holding.quantity),
            price: holding.avgCost,
            // Seeding is not a real trade, so it carries no fee.
            fee: 0,
            executedAt: asOf,
          }),
        );
      }
    });

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
