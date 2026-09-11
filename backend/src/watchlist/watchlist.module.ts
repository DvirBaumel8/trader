import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WatchlistItem } from './watchlist-item.entity.js';
import { WatchlistItemTag } from './watchlist-tag.entity.js';
import { Tag } from '../journal/tag.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { WatchlistService } from './watchlist.service.js';
import { WatchlistController } from './watchlist.controller.js';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { UsersModule } from '../users/users.module.js';
import { LlmModule } from '../llm/llm.module.js';

/**
 * No forwardRef here, deliberately. The watchlist depends on instruments,
 * market data, users and the LLM, and none of them depends back on it — it is
 * a leaf. CLAUDE.md's note about the accepted Instruments/MarketData cycle
 * says not to add new edges to it, and this adds none.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([WatchlistItem, WatchlistItemTag, Tag, Instrument]),
    InstrumentsModule,
    MarketDataModule,
    UsersModule,
    LlmModule,
  ],
  providers: [WatchlistService],
  controllers: [WatchlistController],
  exports: [WatchlistService],
})
export class WatchlistModule {}
