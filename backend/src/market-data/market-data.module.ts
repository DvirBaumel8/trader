import { Module } from '@nestjs/common';
import { MarketDataService } from './market-data.service.js';
import { YahooClient } from './yahoo.client.js';

@Module({
  providers: [
    YahooClient,
    {
      // Built by factory so the cache TTL stays an explicit constructor
      // argument, which is what makes the service testable without Nest.
      provide: MarketDataService,
      useFactory: (yahoo: YahooClient) => new MarketDataService(yahoo),
      inject: [YahooClient],
    },
  ],
  exports: [MarketDataService],
})
export class MarketDataModule {}
