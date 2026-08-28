import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JournalEntry } from './journal-entry.entity.js';
import { Tag } from './tag.entity.js';
import { EntryTag } from './entry-tag.entity.js';
import { Transaction } from '../transactions/transaction.entity.js';
import { CashFlow } from '../transactions/cash-flow.entity.js';
import { Dividend } from '../transactions/dividend.entity.js';
import { StopLevel } from '../transactions/stop-level.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { JournalService } from './journal.service.js';
import { JournalController } from './journal.controller.js';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      JournalEntry,
      Tag,
      EntryTag,
      Transaction,
      CashFlow,
      Dividend,
      StopLevel,
      Instrument,
    ]),
    InstrumentsModule,
    UsersModule,
  ],
  providers: [JournalService],
  controllers: [JournalController],
  exports: [JournalService],
})
export class JournalModule {}
