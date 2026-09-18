import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmClient, GeminiClient } from './llm.client.js';
import { LlmService } from './llm.service.js';
import { LlmController } from './llm.controller.js';
import { AiSummary } from './ai-summary.entity.js';
import { AiSummaryService } from './ai-summary.service.js';
import { AiOutcome } from './ai-outcome.entity.js';
import { AiOutcomeService } from './ai-outcome.service.js';
import { TradeIdea } from './trade-idea.entity.js';
import { TradeReview } from './trade-review.entity.js';
import { SymbolPatternRead } from './symbol-pattern.entity.js';
import { JournalEntry } from '../journal/journal-entry.entity.js';
import { PortfolioModule } from '../portfolio/portfolio.module.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { TradeIdeaService } from './trade-idea.service.js';
import { TradeIdeaHistoryService } from './trade-idea-history.service.js';
import { TradeReviewService } from './trade-review.service.js';
import { SymbolPatternService } from './symbol-pattern.service.js';
import { PerformanceModule } from '../performance/performance.module.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [
    PortfolioModule,
    PerformanceModule,
    MarketDataModule,
    UsersModule,
    TypeOrmModule.forFeature([
      AiSummary,
      AiOutcome,
      TradeIdea,
      TradeReview,
      SymbolPatternRead,
      JournalEntry,
    ]),
  ],
  providers: [
    { provide: LlmClient, useClass: GeminiClient },
    LlmService,
    AiSummaryService,
    AiOutcomeService,
    TradeIdeaService,
    TradeIdeaHistoryService,
    TradeReviewService,
    SymbolPatternService,
  ],
  controllers: [LlmController],
  // LlmClient itself is exported (not just the services built on it) because
  // WatchlistRankingService needs it directly: the ranking prompt is its own
  // thing, not a wrapper around an existing LLM service.
  exports: [TradeReviewService, TradeIdeaService, SymbolPatternService, LlmClient],
})
export class LlmModule {}
