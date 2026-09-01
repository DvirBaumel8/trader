import { Module } from '@nestjs/common';
import { LlmClient, GeminiClient } from './llm.client.js';
import { LlmService } from './llm.service.js';
import { LlmController } from './llm.controller.js';
import { PortfolioModule } from '../portfolio/portfolio.module.js';
import { PerformanceModule } from '../performance/performance.module.js';

@Module({
  imports: [PortfolioModule, PerformanceModule],
  providers: [{ provide: LlmClient, useClass: GeminiClient }, LlmService],
  controllers: [LlmController],
})
export class LlmModule {}
