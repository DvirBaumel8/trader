import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Transaction } from '../transactions/transaction.entity.js';
import { CashFlow } from '../transactions/cash-flow.entity.js';
import { JournalEntry } from '../journal/journal-entry.entity.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
import { UsersService } from '../users/users.service.js';
import { JournalService } from '../journal/journal.service.js';

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

/**
 * Getting a portfolio into the app for the first time, and taking it back out.
 *
 * Split from `PortfolioService`, which had grown to 857 lines covering
 * reading, deriving, pricing and writing at once. Seeding is the most clearly
 * separable of those: it runs once in the app's life, it is the only place
 * that writes an opening position, and it shares no state with the read path.
 *
 * `seed` deliberately does NOT return the portfolio. It used to, which meant
 * this had to depend on PortfolioService; the controller composes the two
 * instead, and the response is unchanged.
 */
@Injectable()
export class SeedService {
  constructor(
    @InjectRepository(JournalEntry)
    private readonly entries: Repository<JournalEntry>,
    private readonly instrumentsService: InstrumentsService,
    private readonly users: UsersService,
    private readonly journal: JournalService,
    private readonly dataSource: DataSource,
  ) {}

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
    // Called for the side effect, not the value: the default user must exist
    // before anything below writes a row against it.
    await this.users.ensureDefaultUser();
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
