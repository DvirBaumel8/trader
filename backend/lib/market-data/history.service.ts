import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DailyClose } from './daily-close.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { YahooClient, type RawBar } from './yahoo.client.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
import { catchUpFrom, isHistoryBehind } from './trading-day.js';

/**
 * Calendar days of history fetched before today, for a ticker priced on
 * first use or topped up.
 *
 * It was 45, which is about 31 trading days — and that is why every long
 * indicator was quietly null or wrong. A 50-day average needs 50 bars, the
 * 150-day average he actually trades needs 150, and the 52-week high needs
 * 252; with 43 bars in the database, NONE of them could be computed. The
 * 52-week high was worse than null: it silently took the extreme of whatever
 * history existed and labelled it 52-week.
 *
 * 500 calendar days is about 345 trading days — a year of window plus room
 * for the 200-day average to be computed from the oldest bar in it. Yahoo
 * serves daily history indefinitely and for free, so the only cost is a
 * slower first fetch and roughly 500 rows per instrument.
 */
const RUNWAY_DAYS = 500;

/**
 * How often a read may trigger a top-up (or a depth re-fetch for one
 * instrument). Long enough that a page polling every 60s does not hit Yahoo
 * every time.
 */
const FRESHEN_INTERVAL_MS = 10 * 60 * 1000;

/** Days of overlap re-fetched, so a revised recent bar is corrected. */
const OVERLAP_DAYS = 7;

/**
 * How long a read may wait for the top-up before giving up on it. A stale
 * price for one more request is a far smaller problem than a dashboard that
 * hangs, and the work continues regardless.
 */
const FRESHEN_BUDGET_MS = 1500;

@Injectable()
export class HistoryService {
  private readonly log = new Logger(HistoryService.name);
  private lastFreshenAt = 0;
  private readonly lastDepthFetchAt = new Map<string, number>();

  constructor(
    @InjectRepository(DailyClose)
    private readonly closes: Repository<DailyClose>,
    @InjectRepository(Instrument)
    private readonly instruments: Repository<Instrument>,
    @Inject(forwardRef(() => InstrumentsService))
    private readonly instrumentsService: InstrumentsService,
    private readonly yahoo: YahooClient,
  ) {}

  /**
   * Fetches bars for one symbol if — and only if — it has no `daily_closes`
   * rows at all yet. Called at the moment a new instrument is first held or
   * watched, so it is priced immediately rather than waiting for a top-up.
   *
   * Safe to call for an already-priced instrument (a no-op) and tolerates a
   * provider failure the same way fetchAndStore() does: log and move on. Must
   * never throw, because the caller sits directly in the write path and a
   * Yahoo outage must not block adding a holding or a watched ticker.
   */
  async ensurePriced(instrument: Instrument, symbol: string): Promise<void> {
    const already = await this.closes.count({
      where: { instrumentId: instrument.id },
    });
    if (already > 0) return;

    // Anchored to now: this seam has no other date to start from.
    const from = new Date();
    from.setDate(from.getDate() - RUNWAY_DAYS);

    try {
      await this.fetchAndStore(instrument, symbol, from);
    } catch (err) {
      this.log.warn(`could not price ${symbol} on first use: ${String(err)}`);
    }
  }

  /**
   * Makes sure at least `period` bars are stored for one instrument, fetching
   * further back when the stored history is shallower than that (an instrument
   * priced long ago with a short runway never deepens on its own).
   *
   * Returns 'failed' only when the provider fetch threw, so the caller can say
   * "couldn't get history" instead of "not enough history". Debounced per
   * instrument; a debounced call reports 'ok'. Never throws.
   */
  async ensureDepth(instrument: Instrument, period: number): Promise<'ok' | 'failed'> {
    const stored = await this.closes.count({ where: { instrumentId: instrument.id } });
    if (stored >= period) return 'ok';

    const now = Date.now();
    const last = this.lastDepthFetchAt.get(instrument.id);
    if (last !== undefined && now - last < FRESHEN_INTERVAL_MS) return 'ok';

    const days = Math.max(RUNWAY_DAYS, Math.ceil(period * 1.5) + 30);
    const from = new Date(now);
    from.setDate(from.getDate() - days);

    try {
      await this.storeBars(instrument, instrument.symbol, from);
      // Only a successful fetch starts the debounce, so an outage is retried.
      this.lastDepthFetchAt.set(instrument.id, now);
      return 'ok';
    } catch (err) {
      this.log.warn(`could not deepen history for ${instrument.symbol}: ${String(err)}`);
      return 'failed';
    }
  }

  /**
   * Tops up daily bars when the stored history has fallen behind the market.
   *
   * Nothing else does this: `ensurePriced()` only fires for an instrument
   * with no rows at all, so every symbol would otherwise freeze on the day it
   * was first priced.
   *
   * Read-triggered rather than scheduled: the API sleeps on its free tier, so
   * a cron would not reliably fire, and this way freshness is a property of
   * asking rather than of a background job having run.
   *
   * Never throws, and never blocks on a provider that is down: the caller is
   * on the read path.
   */
  async ensureFresh(now: Date = new Date()): Promise<void> {
    if (now.getTime() - this.lastFreshenAt < FRESHEN_INTERVAL_MS) return;

    try {
      // Read through the entity rather than a raw MAX(): TypeORM maps a
      // `date` column back to a YYYY-MM-DD string, where a raw query hands
      // back whatever node-postgres parsed it into (a JS Date), which is how
      // this check silently became a no-op the first time.
      const [newest] = await this.closes.find({
        order: { date: 'DESC' },
        take: 1,
      });

      if (!isHistoryBehind(newest?.date ?? null, now)) {
        // Up to date: hold the debounce so a quiet market is not re-checked
        // on every single request.
        this.lastFreshenAt = now.getTime();
        return;
      }

      // Set before the work, not after: a slow or failing provider must not
      // let concurrent requests all start their own top-up.
      this.lastFreshenAt = now.getTime();

      const instrumentRows = await this.instruments.find();

      /**
       * How far back to fetch, decided PER INSTRUMENT.
       *
       * A gap is a property of one symbol, not of the database. One ticker
       * failing at the provider while the rest succeed leaves that ticker
       * behind, and a single global watermark reports everything as current —
       * so its gap is never repaired. The window is computed from each
       * instrument's own newest bar; see `catchUpFrom`, which carries the
       * full history of this mistake.
       */
      const newestByInstrument = new Map<string, string>();
      for (const row of await this.closes
        .createQueryBuilder('c')
        .select('c."instrumentId"', 'instrumentId')
        .addSelect('MAX(c.date)', 'newest')
        .groupBy('c."instrumentId"')
        .getRawMany<{ instrumentId: string; newest: string | Date }>()) {
        newestByInstrument.set(
          row.instrumentId,
          row.newest instanceof Date
            ? row.newest.toISOString().slice(0, 10)
            : String(row.newest),
        );
      }

      // Fetched in parallel, and never allowed to hold up the response.
      // Sequentially this took four seconds against thirty instruments —
      // on the read path, which meant the screen simply hung
      // every time the history had fallen behind.
      const work = Promise.all(
        instrumentRows.map((instrument) =>
          this.fetchAndStore(
            instrument,
            instrument.symbol,
            catchUpFrom(newestByInstrument.get(instrument.id) ?? null, now, {
              overlapDays: OVERLAP_DAYS,
              runwayDays: RUNWAY_DAYS,
            }),
          ),
        ),
      );

      // Whatever has not finished by the deadline keeps writing in the
      // background; the request stops waiting for it. Bars are upserted
      // per (instrument, date), so a partial refresh is not a broken one —
      // it is simply a smaller one, finished by the next call.
      await Promise.race([
        work,
        new Promise((resolve) => setTimeout(resolve, FRESHEN_BUDGET_MS)),
      ]);
    } catch (err) {
      this.log.warn(`could not refresh daily history: ${String(err)}`);
    }
  }

  /**
   * Bars for a symbol over a window, fetched live and never persisted —
   * every other method here exists to keep `daily_closes` current for a
   * symbol the owner holds or watches, and writing a row there for a
   * merely-researched ticker would quietly change what that table means
   * (the same rule the market-data service follows). A
   * caller that wants bars for a ticker that was only ever looked at —
   * a chat answer about any ticker — uses this instead.
   */
  async liveDailyBars(symbol: string, from: Date): Promise<RawBar[]> {
    try {
      return await this.yahoo.dailyBars(symbol, from);
    } catch (err) {
      this.log.warn(`live daily bars failed for ${symbol}: ${String(err)}`);
      return [];
    }
  }

  /** Fetches and upserts one symbol's bars. Throws on provider failure. */
  private async storeBars(
    instrument: Instrument,
    symbol: string,
    from: Date,
  ): Promise<number> {
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
  }

  /** Like storeBars, but logs and returns 0 on failure. Returns the count written. */
  private async fetchAndStore(
    instrument: Instrument,
    symbol: string,
    from: Date,
  ): Promise<number> {
    try {
      return await this.storeBars(instrument, symbol, from);
    } catch (err) {
      // One bad ticker must not abandon the whole top-up.
      this.log.warn(`daily bars failed for ${symbol}: ${String(err)}`);
      return 0;
    }
  }
}
