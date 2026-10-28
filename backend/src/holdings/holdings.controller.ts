import { Body, Controller, Delete, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { HoldingsService } from './holdings.service.js';
import { AddSymbolsDto } from '../lists/add-symbols.dto.js';

@Controller('holdings')
export class HoldingsController {
  constructor(private readonly holdings: HoldingsService) {}

  @Get()
  list() {
    return this.holdings.list();
  }

  @Post()
  add(@Body() body: AddSymbolsDto) {
    return this.holdings.addMany(body.symbols);
  }

  @Delete(':symbol')
  async remove(@Param('symbol') symbol: string) {
    if (!(await this.holdings.remove(symbol))) {
      throw new NotFoundException(`You don't hold ${symbol.toUpperCase()}`);
    }
    return { ok: true };
  }
}
