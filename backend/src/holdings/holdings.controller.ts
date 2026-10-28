import { Body, Controller, Delete, Get, NotFoundException, Param, Put } from '@nestjs/common';
import { HoldingsService } from './holdings.service.js';
import { SetHoldingDto } from './holdings.dto.js';

@Controller('holdings')
export class HoldingsController {
  constructor(private readonly holdings: HoldingsService) {}

  @Get()
  list() {
    return this.holdings.list();
  }

  @Put(':symbol')
  set(@Param('symbol') symbol: string, @Body() body: SetHoldingDto) {
    return this.holdings.set(symbol, body.direction);
  }

  @Delete(':symbol')
  async remove(@Param('symbol') symbol: string) {
    if (!(await this.holdings.remove(symbol))) {
      throw new NotFoundException(`You don't hold ${symbol.toUpperCase()}`);
    }
    return { ok: true };
  }
}
