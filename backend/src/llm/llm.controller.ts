import { Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { LlmService } from './llm.service.js';
import { AiSummaryService } from './ai-summary.service.js';

@Controller('ai')
export class LlmController {
  constructor(
    private readonly llm: LlmService,
    private readonly summaries: AiSummaryService,
  ) {}

  @Post('portfolio-summary')
  portfolioSummary() {
    return this.llm.portfolioSummary();
  }

  @Get('summaries')
  list() {
    return this.summaries.list();
  }

  @Get('summaries/:id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.summaries.findOne(id);
  }

  @Delete('summaries/:id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.summaries.remove(id);
    return { ok: true };
  }
}
