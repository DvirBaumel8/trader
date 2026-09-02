import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmClient, GeminiClient } from './llm.client.js';
import { LlmService } from './llm.service.js';
import { LlmController } from './llm.controller.js';
import { AiSummary } from './ai-summary.entity.js';
import { AiSummaryService } from './ai-summary.service.js';
import { PortfolioModule } from '../portfolio/portfolio.module.js';
import { PerformanceModule } from '../performance/performance.module.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [
    PortfolioModule,
    PerformanceModule,
    UsersModule,
    TypeOrmModule.forFeature([AiSummary]),
  ],
  providers: [
    { provide: LlmClient, useClass: GeminiClient },
    LlmService,
    AiSummaryService,
  ],
  controllers: [LlmController],
})
export class LlmModule {}
