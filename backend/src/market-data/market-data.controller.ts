import { Controller, Get, Param } from '@nestjs/common';
import { TickerFactsService, type TickerFacts } from './ticker-facts.service.js';

@Controller('market-data')
export class MarketDataController {
  constructor(private readonly tickerFacts: TickerFactsService) {}

  @Get('ticker-facts/:symbol')
  getTickerFacts(@Param('symbol') symbol: string): Promise<TickerFacts> {
    return this.tickerFacts.get(symbol);
  }
}
