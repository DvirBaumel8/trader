import { Controller, Post } from '@nestjs/common';
import { LlmService } from './llm.service.js';

@Controller('ai')
export class LlmController {
  constructor(private readonly llm: LlmService) {}

  @Post('portfolio-summary')
  portfolioSummary() {
    return this.llm.portfolioSummary();
  }
}
