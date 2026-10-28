import { Body, Controller, Delete, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { WatchlistService } from './watchlist.service.js';
import { AddSymbolsDto } from '../lists/add-symbols.dto.js';

@Controller('watchlist')
export class WatchlistController {
  constructor(private readonly watchlist: WatchlistService) {}

  @Get()
  list() {
    return this.watchlist.list();
  }

  @Post()
  add(@Body() body: AddSymbolsDto) {
    return this.watchlist.addMany(body.symbols);
  }

  @Delete(':symbol')
  async remove(@Param('symbol') symbol: string) {
    if (!(await this.watchlist.remove(symbol))) {
      throw new NotFoundException(`${symbol.toUpperCase()} isn't on your watchlist`);
    }
    return { ok: true };
  }
}
