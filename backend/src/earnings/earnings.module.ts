import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Instrument } from '../instruments/instrument.entity.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { HoldingsModule } from '../holdings/holdings.module.js';
import { WatchlistModule } from '../watchlist/watchlist.module.js';
import { UsersModule } from '../users/users.module.js';
import { EarningsService } from './earnings.service.js';
import { EarningsController } from './earnings.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Instrument]),
    MarketDataModule,
    HoldingsModule,
    WatchlistModule,
    UsersModule,
  ],
  providers: [EarningsService],
  controllers: [EarningsController],
})
export class EarningsModule {}
