import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Instrument } from '../instruments/instrument.entity.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { UsersModule } from '../users/users.module.js';
import { FundamentalsCache } from './fundamentals-cache.entity.js';
import { FundamentalsService } from './fundamentals.service.js';
import { KnowledgeGraph } from './knowledge-graph.entity.js';
import { KnowledgeVersion } from './knowledge-version.entity.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([KnowledgeGraph, KnowledgeVersion, FundamentalsCache, Instrument]),
    InstrumentsModule,
    MarketDataModule,
    UsersModule,
  ],
  providers: [KnowledgeService, FundamentalsService],
  controllers: [KnowledgeController],
})
export class KnowledgeModule {}
