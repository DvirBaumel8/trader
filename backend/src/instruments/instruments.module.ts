import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Instrument } from './instrument.entity.js';
import { InstrumentsService } from './instruments.service.js';
import { MarketDataModule } from '../market-data/market-data.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Instrument]),
    forwardRef(() => MarketDataModule),
  ],
  providers: [InstrumentsService],
  exports: [InstrumentsService],
})
export class InstrumentsModule {}
