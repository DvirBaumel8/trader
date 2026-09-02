import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DailyClose } from './daily-close.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { Transaction } from '../transactions/transaction.entity.js';
import { YahooClient } from './yahoo.client.js';
import { InstrumentsService } from '../instruments/instruments.service.js';

export const BENCHMARKS = ['SPY', 'QQQ'] as const;

@Injectable()
export class HistoryService {
  private readonly log = new Logger(HistoryService.name);

  constructor(
    @InjectRepository(DailyClose)
    private readonly closes: Repository<DailyClose>,
    @InjectRepository(Instrument)
    private readonly instruments: Repository<Instrument>,
    @InjectRepository(Transaction)
    private readonly txns: Repository<Transaction>,
    @Inject(forwardRef(() => InstrumentsService))
    private readonly instrumentsService: InstrumentsService,
    private readonly yahoo: YahooClient,
  ) {}

  /**
   * Fetches daily bars for everything ever traded, plus the benchmarks, from
   * the first transaction onward. Safe to run repeatedly: bars are upserted on
   * (instrument, date), so a re-run refreshes rather than duplicates.
   */
  async backfill(): Promise<{ symbols: string[]; barsWritten: number }> {
    const [txnRows, instrumentRows] = await Promise.all([
      this.txns.find(),
      this.instruments.find(),
    ]);

    const earliest = txnRows.reduce<Date | null>(
      (min, t) => (min === null || t.executedAt < min ? t.executedAt : min),
      null,
    );
    if (earliest === null) return { symbols: [], barsWritten: 0 };

    // Runway before the first trade. Seven days was enough for the benchmark
    // series to have a prior close; the trade chart needs about a month of
    // context before an entry, and Yahoo serves daily history indefinitely
    // for free, so this costs nothing but a slightly longer first backfill.
    const from = new Date(earliest);
    from.setDate(from.getDate() - 45);

    const symbolById = new Map(instrumentRows.map((i) => [i.id, i.symbol]));
    const wanted = new Set(
      txnRows
        .map((t) => symbolById.get(t.instrumentId))
        .filter((s): s is string => Boolean(s)),
    );
    for (const b of BENCHMARKS) wanted.add(b);

    let barsWritten = 0;
    const symbols: string[] = [];

    for (const symbol of wanted) {
      const instrument = await this.instrumentsService.findOrCreate(symbol);
      const isBenchmark = (BENCHMARKS as readonly string[]).includes(symbol);
      if (isBenchmark && !instrument.isBenchmark) {
        // Marked so benchmarks never appear as holdings.
        instrument.isBenchmark = true;
        await this.instruments.save(instrument);
      }

      const written = await this.fetchAndStore(instrument, symbol, from);
      if (written > 0) {
        barsWritten += written;
        symbols.push(symbol);
      }
    }

    return { symbols, barsWritten };
  }

  /**
   * Fetches bars for one symbol if — and only if — it has no `daily_closes`
   * rows at all yet. Called at the moment a new instrument first enters a
   * transaction (see InstrumentsService.findOrCreate), so a ticker traded for
   * the first time is priced immediately rather than waiting for someone to
   * remember to run the manual backfill. That gap is exactly what let CRWV
   * and NBIS get valued at zero on 2026-09-01.
   *
   * Safe to call for an already-priced instrument (a no-op) and tolerates a
   * provider failure the same way backfill() does: log and move on. Must
   * never throw, because the caller sits directly in the journal write path
   * and a Yahoo outage must not block writing a trade.
   */
  async ensurePriced(instrument: Instrument, symbol: string): Promise<void> {
    const already = await this.closes.count({
      where: { instrumentId: instrument.id },
    });
    if (already > 0) return;

    // Same 45-day runway as backfill(), anchored to now rather than the
    // trade's own date — this seam doesn't have that date available. A
    // heavily backdated first trade may still show as unpriced for its
    // earliest days until the next full backfill; unpricedSymbols in the
    // performance response says so rather than hiding it.
    const from = new Date();
    from.setDate(from.getDate() - 45);

    try {
      await this.fetchAndStore(instrument, symbol, from);
    } catch (err) {
      this.log.warn(`could not price ${symbol} on first use: ${String(err)}`);
    }
  }

  /** Fetches and upserts one symbol's bars. Returns the count written. */
  private async fetchAndStore(
    instrument: Instrument,
    symbol: string,
    from: Date,
  ): Promise<number> {
    try {
      const bars = await this.yahoo.dailyBars(symbol, from);
      if (bars.length === 0) return 0;
      await this.closes.upsert(
        bars.map((b) => ({
          instrumentId: instrument.id,
          date: b.date,
          close: b.close,
          adjClose: b.adjClose,
          open: b.open,
          high: b.high,
          low: b.low,
          volume: b.volume,
        })),
        ['instrumentId', 'date'],
      );
      return bars.length;
    } catch (err) {
      // One bad ticker must not abandon the whole backfill; the series
      // simply carries that instrument's last known price forward (or, if it
      // never had one, values it at cost — see series.ts).
      this.log.warn(`daily bars failed for ${symbol}: ${String(err)}`);
      return 0;
    }
  }
}
