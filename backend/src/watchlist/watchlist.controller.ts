import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { WatchlistService } from './watchlist.service.js';
import { OrderSymbolsDto } from '../lists/order.dto.js';
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

  /** Declared before the ':symbol' routes. */
  @Put('order')
  reorder(@Body() body: OrderSymbolsDto) {
    return this.watchlist.reorder(body.symbols);
  }

  @Delete(':symbol')
  async remove(@Param('symbol') symbol: string) {
    if (!(await this.watchlist.remove(symbol))) {
      throw new NotFoundException(`${symbol.toUpperCase()} isn't on your watchlist`);
    }
    return { ok: true };
  }
}
