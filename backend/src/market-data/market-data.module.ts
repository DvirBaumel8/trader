import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketDataService } from './market-data.service.js';
import { YahooClient } from './yahoo.client.js';
import { TwelveDataClient } from './twelvedata.client.js';
import { HistoryService } from './history.service.js';
import { DailyClose } from './daily-close.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { InstrumentsModule } from '../instruments/instruments.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([DailyClose, Instrument]),
    // Instruments depends on market data for ticker validation, so the two
    // modules reference each other.
    forwardRef(() => InstrumentsModule),
  ],
  providers: [
    YahooClient,
    // A second opinion for pre/post-market prices when Yahoo's own quote had
    // none to offer — see twelvedata.client.ts. Inert without a key.
    TwelveDataClient,
    HistoryService,
    {
      // Built by factory so the cache TTL stays an explicit constructor
      // argument, which is what makes the service testable without Nest.
      provide: MarketDataService,
      useFactory: (yahoo: YahooClient, twelveData: TwelveDataClient) =>
        new MarketDataService(yahoo, undefined, twelveData),
      inject: [YahooClient, TwelveDataClient],
    },
  ],
  exports: [MarketDataService, HistoryService],
})
export class MarketDataModule {}
