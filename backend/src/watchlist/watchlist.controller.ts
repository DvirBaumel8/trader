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
import { WatchlistRankingService } from './watchlist-ranking.service.js';
import { UpsertWatchlistDto } from './watchlist.dto.js';
import { DailyBriefService } from '../market-data/daily-brief.service.js';

@Controller('watchlist')
export class WatchlistController {
  constructor(
    private readonly watchlist: WatchlistService,
    private readonly ranking: WatchlistRankingService,
    private readonly brief: DailyBriefService,
  ) {}

  // Declared before ':id' routes so "tags" and "ranking" are never matched
  // as an id — the same ordering the journal controller needed.
  @Get('tags')
  tags() {
    return this.watchlist.listTags();
  }

  /** The newest stored ranking. No model call — see WatchlistRankingService.current. */
  @Get('ranking')
  getRanking() {
    return this.ranking.current();
  }

  @Get('daily-brief')
  dailyBrief() {
    return this.brief.get();
  }

  /** Recomputes the ranking with ONE model call for the whole watchlist. */
  @Post('ranking/refresh')
  refreshRanking() {
    return this.ranking.refresh();
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
