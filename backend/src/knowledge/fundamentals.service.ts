import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { etDate } from '../earnings/week.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { AlphaVantageClient } from '../market-data/alpha-vantage.client.js';
import { YahooClient } from '../market-data/yahoo.client.js';
import { FundamentalsCache, FundamentalsCacheData } from './fundamentals-cache.entity.js';
import { Fundamentals, shapeFundamentals } from './fundamentals.js';

const ESTIMATES_RETRY_MS = 60 * 60 * 1000;
const TICKER = /^[A-Z0-9][A-Z0-9.\-^=]{0,14}$/;

@Injectable()
export class FundamentalsService {
  private readonly logger = new Logger(FundamentalsService.name);
  /** Concurrent opens of one ticker share a single provider call (Alpha Vantage allows 25 a day). */
  private readonly inFlight = new Map<string, Promise<FundamentalsCache>>();

  constructor(
    @InjectRepository(FundamentalsCache) private readonly cache: Repository<FundamentalsCache>,
    @InjectRepository(Instrument) private readonly instruments: Repository<Instrument>,
    private readonly yahoo: YahooClient,
    private readonly alphaVantage: AlphaVantageClient,
  ) {}

  async get(symbolInput: string, now: Date): Promise<Fundamentals> {
    const symbol = symbolInput.trim().toUpperCase();
    if (!TICKER.test(symbol)) throw this.notCompany(symbol);

    let row = await this.cache.findOneBy({ symbol });
    if (!row || !this.fresh(row, now)) {
      let pending = this.inFlight.get(symbol);
      if (!pending) {
        pending = this.refresh(symbol, row, now).finally(() => this.inFlight.delete(symbol));
        this.inFlight.set(symbol, pending);
      }
      row = await pending;
    }

    const data = row.data;
    if (data.notCompany || !data.fundamentals) throw this.notCompany(symbol);
    return this.withReportDate(symbol, data.fundamentals);
  }

  private notCompany(symbol: string) {
    return new NotFoundException(`${symbol} is not a company`);
  }

  private fresh(row: FundamentalsCache, now: Date): boolean {
    if (etDate(row.fetchedAt) !== etDate(now)) return false;
    if (row.data.estimatesMissing && now.getTime() - row.fetchedAt.getTime() >= ESTIMATES_RETRY_MS) return false;
    return true;
  }

  /** Fetches and stores; on a Yahoo failure serves what was cached, or 503. */
  private async refresh(symbol: string, previous: FundamentalsCache | null, now: Date): Promise<FundamentalsCache> {
    const [yahoo, estimates] = await Promise.allSettled([
      this.yahoo.fundamentals(symbol),
      this.alphaVantage.quarterEstimates(symbol),
    ]);

    if (yahoo.status === 'rejected') {
      this.logger.warn(`Yahoo fundamentals for ${symbol} failed: ${String(yahoo.reason)}`);
      if (previous) return previous;
      throw new ServiceUnavailableException("Couldn't load the numbers right now.");
    }

    let data: FundamentalsCacheData;
    if (yahoo.value.quoteType !== 'EQUITY') {
      data = { notCompany: true };
    } else {
      if (estimates.status === 'rejected') {
        this.logger.warn(`Alpha Vantage estimates for ${symbol} failed: ${String(estimates.reason)}`);
      }
      const shaped = shapeFundamentals(
        yahoo.value,
        estimates.status === 'fulfilled' ? estimates.value : null,
        now.toISOString(),
        etDate(now),
      );
      data = { fundamentals: shaped, ...(estimates.status === 'rejected' ? { estimatesMissing: true as const } : {}) };
    }
    return this.cache.save(this.cache.create({ symbol, data, fetchedAt: now }));
  }

  /** The upcoming report date lives on the instrument, kept fresh by the earnings feature. */
  private async withReportDate(symbol: string, f: Fundamentals): Promise<Fundamentals> {
    if (!f.next) return f;
    const instrument = await this.instruments.findOneBy({ symbol });
    const at = instrument?.nextEarningsAt;
    if (!at) return f;
    const newestReport = f.quarters[0]?.reportedAt ?? null;
    if (newestReport !== null && at.toISOString() <= newestReport) return f;
    return { ...f, next: { ...f.next, reportAt: at.toISOString() } };
  }
}
