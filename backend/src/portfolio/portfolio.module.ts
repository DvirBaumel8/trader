import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from '../transactions/transaction.entity.js';
import { CashFlow } from '../transactions/cash-flow.entity.js';
import { Dividend } from '../transactions/dividend.entity.js';
import { StopLevel } from '../transactions/stop-level.entity.js';
import { StopExecution } from '../transactions/stop-execution.entity.js';
import { JournalEntry } from '../journal/journal-entry.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { DailyClose } from '../market-data/daily-close.entity.js';
import { PortfolioService } from './portfolio.service.js';
import { SeedService } from './seed.service.js';
import { TradesService } from './trades.service.js';
import { PortfolioController } from './portfolio.controller.js';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { UsersModule } from '../users/users.module.js';
import { JournalModule } from '../journal/journal.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Transaction,
      CashFlow,
      Dividend,
      StopLevel,
      StopExecution,
      JournalEntry,
      Instrument,
      DailyClose,
    ]),
    InstrumentsModule,
    MarketDataModule,
    UsersModule,
    JournalModule,
  ],
  providers: [PortfolioService, SeedService, TradesService],
  controllers: [PortfolioController],
  exports: [PortfolioService, SeedService, TradesService],
})
export class PortfolioModule {}
