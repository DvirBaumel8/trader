import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from '../transactions/transaction.entity.js';
import { CashFlow } from '../transactions/cash-flow.entity.js';
import { Dividend } from '../transactions/dividend.entity.js';
import { StopLevel } from '../transactions/stop-level.entity.js';
import { JournalEntry } from '../journal/journal-entry.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { PortfolioService } from './portfolio.service.js';
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
      JournalEntry,
      Instrument,
    ]),
    InstrumentsModule,
    MarketDataModule,
    UsersModule,
    JournalModule,
  ],
  providers: [PortfolioService],
  controllers: [PortfolioController],
  exports: [PortfolioService],
})
export class PortfolioModule {}
