import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Instrument } from './instrument.entity.js';
import { YahooClient } from '../market-data/yahoo.client.js';

@Injectable()
export class InstrumentsService {
  constructor(
    @InjectRepository(Instrument)
    private readonly repo: Repository<Instrument>,
    private readonly yahoo: YahooClient,
  ) {}

  /** Validates against the provider, then stores. Throws if the ticker is unknown. */
  async findOrCreate(symbolInput: string): Promise<Instrument> {
    const symbol = symbolInput.trim().toUpperCase();
    const existing = await this.repo.findOne({ where: { symbol } });
    if (existing) return existing;

    // A provider failure is treated like an unknown ticker: we cannot confirm it.
    const info = await this.yahoo.lookup(symbol).catch(() => null);
    if (!info) {
      throw new NotFoundException(`Unknown ticker "${symbol}"`);
    }
    return this.repo.save(
      this.repo.create({ symbol, name: info.name, type: 'STOCK' }),
    );
  }
}
