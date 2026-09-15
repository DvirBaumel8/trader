import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WatchlistItem } from './watchlist-item.entity.js';
import { WatchlistItemTag } from './watchlist-tag.entity.js';
import { WatchlistRanking } from './watchlist-ranking.entity.js';
import { DailyClose } from '../market-data/daily-close.entity.js';
import { Tag } from '../journal/tag.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { WatchlistService } from './watchlist.service.js';
import { WatchlistRankingService } from './watchlist-ranking.service.js';
import { WatchlistController } from './watchlist.controller.js';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { UsersModule } from '../users/users.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { PortfolioModule } from '../portfolio/portfolio.module.js';
import { DailyBriefService } from '../market-data/daily-brief.service.js';
import { EconomicCalendarClient } from '../market-data/economic-calendar.client.js';

/**
 * No forwardRef here, deliberately. The watchlist depends on instruments,
 * market data, users, the LLM and (since the ranking needs the book and the
 * record) the portfolio — and none of them depends back on it, so it stays a
 * leaf. CLAUDE.md's note about the accepted Instruments/MarketData cycle says
 * not to add new edges to it, and this adds none.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      WatchlistItem,
      WatchlistItemTag,
      WatchlistRanking,
      Tag,
      Instrument,
      DailyClose,
    ]),
    InstrumentsModule,
    MarketDataModule,
    UsersModule,
    LlmModule,
    PortfolioModule,
  ],
  providers: [WatchlistService, WatchlistRankingService, DailyBriefService, EconomicCalendarClient],
  controllers: [WatchlistController],
  exports: [WatchlistService],
})
export class WatchlistModule {}
