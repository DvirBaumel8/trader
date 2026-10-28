import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DailyClose } from '../market-data/daily-close.entity.js';
import { AssistantService } from './assistant.service.js';
import { AssistantController } from './assistant.controller.js';
import { HoldingsModule } from '../holdings/holdings.module.js';
import { WatchlistModule } from '../watchlist/watchlist.module.js';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { MarketDataModule } from '../market-data/market-data.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([DailyClose]),
    HoldingsModule,
    WatchlistModule,
    InstrumentsModule,
    MarketDataModule,
  ],
  providers: [AssistantService],
  controllers: [AssistantController],
})
export class AssistantModule {}
