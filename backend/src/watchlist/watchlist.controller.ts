import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { WatchlistService } from './watchlist.service.js';
import { UpsertWatchlistDto } from './watchlist.dto.js';
import { TradeIdeaService } from '../llm/trade-idea.service.js';

@Controller('watchlist')
export class WatchlistController {
  constructor(
    private readonly watchlist: WatchlistService,
    private readonly ideas: TradeIdeaService,
  ) {}

  // Declared before ':id' routes so "tags" is never matched as an id — the
  // same ordering the journal controller needed.
  @Get('tags')
  tags() {
    return this.watchlist.listTags();
  }

  @Get()
  list() {
    return this.watchlist.list();
  }

  @Post()
  upsert(@Body() body: UpsertWatchlistDto) {
    return this.watchlist.upsert({
      symbol: body.symbol,
      targetPrice: body.targetPrice,
      note: body.note,
      tags: body.tags,
    });
  }

  /**
   * An opinion on the watchlist ticker closest to its own target.
   *
   * The ranking is the app's and the judgement is the model's — the split the
   * trade-idea design settled. Reuses TradeIdeaService rather than growing a
   * second prompt: "should I buy this" is the same question whether the
   * ticker came from the watchlist or was typed in.
   */
  @Post('opinion')
  async opinion() {
    const best = await this.watchlist.best();
    if (!best) {
      return {
        chosen: null,
        reason: 'Nothing on the watchlist has a target to measure against.',
        idea: null,
      };
    }
    const idea = await this.ideas.analyse(best.symbol);
    return {
      chosen: best.symbol,
      distancePercent: best.distancePercent,
      reason: 'Closest to the target you set for it.',
      idea,
    };
  }

  @Post(':id/acknowledge')
  async acknowledge(@Param('id', ParseUUIDPipe) id: string) {
    await this.watchlist.acknowledge(id);
    return { ok: true };
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.watchlist.remove(id);
    return { ok: true };
  }
}
