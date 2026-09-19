import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketDataService } from './market-data.service.js';
import { YahooClient } from './yahoo.client.js';
import { FinnhubClient } from './finnhub.client.js';
import { TwelveDataClient } from './twelvedata.client.js';
import { FundamentalsService } from './fundamentals.service.js';
import { NewsService } from './news.service.js';
import { HistoryService } from './history.service.js';
import { HistoryController } from './history.controller.js';
import { TickerFactsService } from './ticker-facts.service.js';
import { MarketDataController } from './market-data.controller.js';
import { DailyClose } from './daily-close.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { Transaction } from '../transactions/transaction.entity.js';
import { EarningsService } from './earnings.service.js';
import { InstrumentsModule } from '../instruments/instruments.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([DailyClose, Instrument, Transaction]),
    // Instruments depends on market data for ticker validation, so the two
    // modules reference each other.
    forwardRef(() => InstrumentsModule),
  ],
  providers: [
    YahooClient,
    // Fundamentals only, and only because Yahoo's crumb-gated quote endpoint
    // is blocked from Render — see finnhub.client.ts. Inert without a key.
    FinnhubClient,
    // A second opinion for pre/post-market prices when Yahoo's own quote had
    // none to offer — see twelvedata.client.ts. Inert without a key.
    TwelveDataClient,
    FundamentalsService,
    NewsService,
    EarningsService,
    HistoryService,
    TickerFactsService,
    {
      // Built by factory so the cache TTL stays an explicit constructor
      // argument, which is what makes the service testable without Nest.
      provide: MarketDataService,
      useFactory: (yahoo: YahooClient, twelveData: TwelveDataClient) =>
        new MarketDataService(yahoo, undefined, twelveData),
      inject: [YahooClient, TwelveDataClient],
    },
  ],
  controllers: [HistoryController, MarketDataController],
  exports: [
    MarketDataService,
    HistoryService,
    TickerFactsService,
    FundamentalsService,
    EarningsService,
  ],
})
export class MarketDataModule {}
