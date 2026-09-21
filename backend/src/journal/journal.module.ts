import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JournalEntry } from './journal-entry.entity.js';
import { Tag } from './tag.entity.js';
import { EntryTag } from './entry-tag.entity.js';
import { Transaction } from '../transactions/transaction.entity.js';
import { CashFlow } from '../transactions/cash-flow.entity.js';
import { Dividend } from '../transactions/dividend.entity.js';
import { InterestCharge } from '../transactions/interest-charge.entity.js';
import { StopLevel } from '../transactions/stop-level.entity.js';
import { StopExecution } from '../transactions/stop-execution.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { WatchlistItem } from '../watchlist/watchlist-item.entity.js';
import { JournalService } from './journal.service.js';
import { JournalController } from './journal.controller.js';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { UsersModule } from '../users/users.module.js';
import { WatchlistChangeNotifierModule } from '../common/watchlist-change-notifier.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      JournalEntry,
      Tag,
      EntryTag,
      Transaction,
      CashFlow,
      Dividend,
      InterestCharge,
      StopLevel,
      StopExecution,
      Instrument,
      // Owned by the watchlist domain, not the journal — written to
      // directly (a watched ticker comes off the list on a buy, see
      // JournalService.writeOwnedRows) rather than through
      // WatchlistService, the same way PortfolioModule reads JournalEntry
      // directly: importing WatchlistModule would create a real cycle
      // (Journal -> Watchlist -> Portfolio -> Journal), which
      // watchlist.module.ts's own comment says not to add to.
      WatchlistItem,
    ]),
    InstrumentsModule,
    // For HistoryService, so a symbol traded for the first time gets its
    // price history fetched immediately — see JournalService.resolveTrade.
    // One-directional: nothing MarketDataModule imports depends on
    // JournalModule, so this needs no forwardRef.
    MarketDataModule,
    UsersModule,
    WatchlistChangeNotifierModule,
  ],
  providers: [JournalService],
  controllers: [JournalController],
  exports: [JournalService],
})
export class JournalModule {}
