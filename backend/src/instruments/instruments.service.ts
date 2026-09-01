import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Instrument } from './instrument.entity.js';
import { MarketDataService } from '../market-data/market-data.service.js';
import { HistoryService } from '../market-data/history.service.js';

@Injectable()
export class InstrumentsService {
  private readonly log = new Logger(InstrumentsService.name);

  constructor(
    @InjectRepository(Instrument)
    private readonly repo: Repository<Instrument>,
    @Inject(forwardRef(() => MarketDataService))
    private readonly marketData: MarketDataService,
    @Inject(forwardRef(() => HistoryService))
    private readonly history: HistoryService,
  ) {}

  /**
   * Validates against the provider, then stores. Throws if the ticker is
   * unknown. This is where a symbol first enters a transaction (see
   * JournalService.resolveTrade), so it also makes sure the symbol has price
   * history — an instrument with zero `daily_closes` rows is exactly what let
   * a just-bought position get valued at zero instead of at cost. A Yahoo
   * failure here must never block the write, so ensurePriced tolerates it.
   */
  async findOrCreate(symbolInput: string): Promise<Instrument> {
    const symbol = symbolInput.trim().toUpperCase();
    const existing = await this.repo.findOne({ where: { symbol } });
    if (existing) {
      await this.ensurePricedSafely(existing, symbol);
      return existing;
    }

    const quote = await this.marketData.getQuote(symbol);
    if (!quote) {
      throw new NotFoundException(`Unknown ticker "${symbol}"`);
    }
    const instrument = await this.repo.save(
      this.repo.create({ symbol, name: quote.name, type: 'STOCK' }),
    );
    await this.ensurePricedSafely(instrument, symbol);
    return instrument;
  }

  /** Never lets a price-history fetch failure surface to the caller. */
  private async ensurePricedSafely(
    instrument: Instrument,
    symbol: string,
  ): Promise<void> {
    try {
      await this.history.ensurePriced(instrument, symbol);
    } catch (err) {
      this.log.warn(`could not ensure price history for ${symbol}: ${String(err)}`);
    }
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
