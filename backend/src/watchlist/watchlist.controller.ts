import { Body, Controller, Delete, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { WatchlistService } from './watchlist.service.js';
import { AddWatchlistDto } from './watchlist.dto.js';

@Controller('watchlist')
export class WatchlistController {
  constructor(private readonly watchlist: WatchlistService) {}

  @Get()
  list() {
    return this.watchlist.list();
  }

  @Post()
  add(@Body() body: AddWatchlistDto) {
    return this.watchlist.add(body.symbol);
  }

  @Delete(':symbol')
  async remove(@Param('symbol') symbol: string) {
    if (!(await this.watchlist.remove(symbol))) {
      throw new NotFoundException(`${symbol.toUpperCase()} isn't on your watchlist`);
    }
    return { ok: true };
  }
}
