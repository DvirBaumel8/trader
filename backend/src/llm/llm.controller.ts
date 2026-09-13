import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { IsString, Length, Matches } from 'class-validator';
import { LlmService } from './llm.service.js';
import { AiSummaryService } from './ai-summary.service.js';
import { TradeIdeaService } from './trade-idea.service.js';
import { TradeIdeaHistoryService } from './trade-idea-history.service.js';
import { TradeReviewService } from './trade-review.service.js';
import { SymbolPatternService } from './symbol-pattern.service.js';
import { RANGES, type Range } from '../common/date-range.js';

class TradeIdeaDto {
  @IsString()
  @Length(1, 12)
  // Letters, digits, dot and dash only - the shapes a real ticker takes
  // (BRK.B, RDS-A). Rejecting the rest here means a malformed symbol never
  // reaches the provider at all.
  @Matches(/^[A-Za-z0-9.-]+$/, { message: 'symbol must be a ticker' })
  symbol: string;
}

@Controller('ai')
export class LlmController {
  constructor(
    private readonly llm: LlmService,
    private readonly summaries: AiSummaryService,
    private readonly tradeIdeas: TradeIdeaService,
    private readonly tradeIdeaHistory: TradeIdeaHistoryService,
    private readonly tradeReviews: TradeReviewService,
    private readonly symbolPatterns: SymbolPatternService,
  ) {}

  @Post('trade-reviews/:tradeId')
  reviewTrade(@Param('tradeId') tradeId: string) {
    return this.tradeReviews.reviewTrade(tradeId);
  }

  /** Newline-delimited JSON — see `portfolioSummaryStream`'s own doc comment
   * for why `@Res()` is used directly here. */
  @Post('trade-reviews/:tradeId/stream')
  async reviewTradeStream(@Param('tradeId') tradeId: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    for await (const line of this.tradeReviews.reviewTradeStream(tradeId)) {
      res.write(line);
    }
    res.end();
  }

  @Get('trade-reviews/:tradeId')
  getTradeReview(@Param('tradeId') tradeId: string) {
    return this.tradeReviews.getReview(tradeId);
  }

  @Post('trade-idea')
  tradeIdea(@Body() body: TradeIdeaDto) {
    return this.tradeIdeas.analyse(body.symbol);
  }

  @Get('trade-ideas')
  listTradeIdeas() {
    return this.tradeIdeaHistory.list();
  }

  @Get('trade-ideas/:id')
  findTradeIdea(@Param('id', ParseUUIDPipe) id: string) {
    return this.tradeIdeaHistory.findOne(id);
  }

  @Delete('trade-ideas/:id')
  async removeTradeIdea(@Param('id', ParseUUIDPipe) id: string) {
    await this.tradeIdeaHistory.remove(id);
    return { ok: true };
  }

  @Get('symbol-patterns/:symbol')
  getSymbolPattern(@Param('symbol') symbol: string, @Query('range') range?: string) {
    const valid = RANGES.includes(range as Range) ? (range as Range) : 'ALL';
    return this.symbolPatterns.getLatest(symbol, valid);
  }

  @Post('symbol-patterns/:symbol')
  generateSymbolPattern(@Param('symbol') symbol: string, @Query('range') range?: string) {
    const valid = RANGES.includes(range as Range) ? (range as Range) : 'ALL';
    return this.symbolPatterns.generate(symbol, valid);
  }

  /** Newline-delimited JSON — see `portfolioSummaryStream`'s own doc comment
   * for why `@Res()` is used directly here. */
  @Post('symbol-patterns/:symbol/stream')
  async generateSymbolPatternStream(
    @Param('symbol') symbol: string,
    @Query('range') range: string | undefined,
    @Res() res: Response,
  ) {
    const valid = RANGES.includes(range as Range) ? (range as Range) : 'ALL';
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    for await (const line of this.symbolPatterns.generateStream(symbol, valid)) {
      res.write(line);
    }
    res.end();
  }

  @Post('portfolio-summary')
  portfolioSummary() {
    return this.llm.portfolioSummary();
  }

  /**
   * Newline-delimited JSON, one line per chunk — see `portfolioSummaryStream`'s
   * own doc comment for the line shapes. Uses `@Res()` directly because Nest's
   * usual JSON response handling assumes one value, not a stream of them; the
   * auth guard still runs first regardless, since it inspects the request,
   * not how this handler responds.
   */
  @Post('portfolio-summary/stream')
  async portfolioSummaryStream(@Res() res: Response) {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    for await (const line of this.llm.portfolioSummaryStream()) {
      res.write(line);
    }
    res.end();
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
