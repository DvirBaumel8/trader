import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WatchlistItem } from './watchlist-item.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { WatchlistService } from './watchlist.service.js';
import { WatchlistController } from './watchlist.controller.js';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([WatchlistItem, Instrument]),
    InstrumentsModule,
    MarketDataModule,
    UsersModule,
  ],
  providers: [WatchlistService],
  controllers: [WatchlistController],
  exports: [WatchlistService],
})
export class WatchlistModule {}
