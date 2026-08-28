import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Instrument } from './instrument.entity.js';
import { MarketDataService } from '../market-data/market-data.service.js';

@Injectable()
export class InstrumentsService {
  constructor(
    @InjectRepository(Instrument)
    private readonly repo: Repository<Instrument>,
    private readonly marketData: MarketDataService,
  ) {}

  /** Validates against the provider, then stores. Throws if the ticker is unknown. */
  async findOrCreate(symbolInput: string): Promise<Instrument> {
    const symbol = symbolInput.trim().toUpperCase();
    const existing = await this.repo.findOne({ where: { symbol } });
    if (existing) return existing;

    const quote = await this.marketData.getQuote(symbol);
    if (!quote) {
      throw new NotFoundException(`Unknown ticker "${symbol}"`);
    }
    return this.repo.save(
      this.repo.create({ symbol, name: quote.name, type: 'STOCK' }),
    );
  }

  async lookup(symbolInput: string) {
    const instrument = await this.findOrCreate(symbolInput);
    const quote = await this.marketData.getQuote(instrument.symbol);
    if (!quote) {
      throw new NotFoundException(`No price for "${instrument.symbol}"`);
    }
    return {
      id: instrument.id,
      symbol: instrument.symbol,
      name: instrument.name,
      price: quote.price,
      stale: quote.stale,
    };
  }
}
