import { Module } from '@nestjs/common';
import { AlphaVantageClient } from './alpha-vantage.client.js';
import { YahooClient } from './yahoo.client.js';

@Module({
  providers: [YahooClient, AlphaVantageClient],
  exports: [YahooClient, AlphaVantageClient],
})
export class MarketDataModule {}
