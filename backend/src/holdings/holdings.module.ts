import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Holding } from './holding.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { HoldingsService } from './holdings.service.js';
import { HoldingsController } from './holdings.controller.js';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Holding, Instrument]),
    InstrumentsModule,
    MarketDataModule,
    UsersModule,
  ],
  providers: [HoldingsService],
  controllers: [HoldingsController],
  exports: [HoldingsService],
})
export class HoldingsModule {}
