import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { InstrumentsService } from './instruments.service.js';

@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly instruments: InstrumentsService) {}

  @Get('lookup')
  async lookup(@Query('symbol') symbol?: string) {
    if (!symbol || symbol.trim() === '') {
      throw new BadRequestException('symbol is required');
    }
    return this.instruments.lookup(symbol);
  }
}
