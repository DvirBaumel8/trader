import { Module } from '@nestjs/common';
import { YahooClient } from './yahoo.client.js';

@Module({
  providers: [YahooClient],
  exports: [YahooClient],
})
export class MarketDataModule {}
