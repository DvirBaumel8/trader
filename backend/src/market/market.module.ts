import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { MarketController } from './market.controller.js';
import { MovesService } from './moves.service.js';

@Module({
  imports: [MarketDataModule],
  providers: [MovesService],
  controllers: [MarketController],
})
export class MarketModule {}
