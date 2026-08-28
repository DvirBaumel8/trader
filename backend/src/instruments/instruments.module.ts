import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Instrument } from './instrument.entity.js';
import { InstrumentsService } from './instruments.service.js';
import { InstrumentsController } from './instruments.controller.js';
import { MarketDataModule } from '../market-data/market-data.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([Instrument]), MarketDataModule],
  providers: [InstrumentsService],
  controllers: [InstrumentsController],
  exports: [InstrumentsService],
})
export class InstrumentsModule {}
