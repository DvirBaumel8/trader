import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmClient, GeminiClient } from './llm.client.js';
import { LlmService } from './llm.service.js';
import { LlmController } from './llm.controller.js';
import { AiSummary } from './ai-summary.entity.js';
import { AiSummaryService } from './ai-summary.service.js';
import { TradeIdea } from './trade-idea.entity.js';
import { PortfolioModule } from '../portfolio/portfolio.module.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { TradeIdeaService } from './trade-idea.service.js';
import { PerformanceModule } from '../performance/performance.module.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [
    PortfolioModule,
    PerformanceModule,
    MarketDataModule,
    UsersModule,
    TypeOrmModule.forFeature([AiSummary, TradeIdea]),
  ],
  providers: [
    { provide: LlmClient, useClass: GeminiClient },
    LlmService,
    AiSummaryService,
    TradeIdeaService,
  ],
  controllers: [LlmController],
})
export class LlmModule {}
