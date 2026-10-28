import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Instrument } from '../instruments/instrument.entity.js';
import { YahooClient } from '../market-data/yahoo.client.js';
import { HoldingsService } from '../holdings/holdings.service.js';
import { WatchlistService } from '../watchlist/watchlist.service.js';
import { TIMING_ORDER, timingOf, type Timing } from './timing.js';
import { daysBetween, etDate, etWeek } from './week.js';

export type EarningsSource = 'holding' | 'watchlist';

export interface EarningsEntry {
  symbol: string;
  source: EarningsSource;
  timing: Timing;
  estimated: boolean;
}

export interface UpcomingRow {
  symbol: string;
  source: EarningsSource;
  date: string | null;
  daysUntil: number | null;
  estimated: boolean;
}

export interface EarningsWeek {
  weekStart: string;
  weekEnd: string;
  today: string;
  days: { date: string; entries: EarningsEntry[] }[];
  upcoming: UpcomingRow[];
}

const MAX_CONCURRENT_LOOKUPS = 5;

@Injectable()
export class EarningsService {
  private readonly logger = new Logger(EarningsService.name);

  constructor(
    @InjectRepository(Instrument) private readonly instruments: Repository<Instrument>,
    private readonly yahoo: YahooClient,
    private readonly holdings: HoldingsService,
    private readonly watchlist: WatchlistService,
  ) {}

  /** `now` is a parameter so tests are deterministic. */
  async week(now: Date = new Date()): Promise<EarningsWeek> {
    const week = etWeek(now);

    // Holding wins over watchlist.
    const sources = new Map<string, EarningsSource>();
    for (const w of await this.watchlist.list()) sources.set(w.symbol, 'watchlist');
    for (const h of await this.holdings.list()) sources.set(h.symbol, 'holding');

    const days = week.days.map((date) => ({ date, entries: [] as EarningsEntry[] }));
    if (sources.size === 0) return { ...pick(week), days, upcoming: [] };

    const instruments = await this.instruments.find({ where: { symbol: In([...sources.keys()]) } });

    const stale = instruments.filter(
      (i) =>
        !i.earningsCheckedAt || etDate(i.earningsCheckedAt) !== week.today,
    );
    const failures = await this.refresh(stale, now);
    if (stale.length > 0 && failures === stale.length && !instruments.some((i) => i.nextEarningsAt)) {
      throw new ServiceUnavailableException('Earnings dates are unavailable right now.');
    }

    const dayByDate = new Map(days.map((d) => [d.date, d]));
    const upcoming: UpcomingRow[] = [];
    for (const i of instruments) {
      const source = sources.get(i.symbol)!;
      const at = i.nextEarningsAt ?? null;
      const date = at ? etDate(at) : null;
      const prev = i.previousEarningsAt ?? null;
      const prevDate = prev ? etDate(prev) : null;
      const day = date ? dayByDate.get(date) : undefined;
      day?.entries.push({
        symbol: i.symbol,
        source,
        timing: timingOf(at),
        estimated: i.nextEarningsEstimated,
      });
      // A report that already happened stays on this week's calendar.
      const prevDay = prevDate && prevDate !== date ? dayByDate.get(prevDate) : undefined;
      prevDay?.entries.push({ symbol: i.symbol, source, timing: timingOf(prev), estimated: false });
      const future = date !== null && date >= week.today;
      upcoming.push({
        symbol: i.symbol,
        source,
        date: future ? date : null,
        daysUntil: future ? daysBetween(week.today, date) : null,
        estimated: future ? i.nextEarningsEstimated : false,
      });
    }

    for (const d of days) {
      d.entries.sort(
        (a, b) =>
          TIMING_ORDER.indexOf(a.timing) - TIMING_ORDER.indexOf(b.timing) ||
          a.symbol.localeCompare(b.symbol),
      );
    }
    upcoming.sort(
      (a, b) =>
        (a.daysUntil ?? Infinity) - (b.daysUntil ?? Infinity) || a.symbol.localeCompare(b.symbol),
    );
    return { ...pick(week), days, upcoming };
  }

  /** Refreshes in place, at most 5 lookups at once. Returns how many threw. */
  private async refresh(list: Instrument[], now: Date): Promise<number> {
    let failures = 0;
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const i = list[next++];
        try {
          const found = await this.yahoo.nextEarnings(i.symbol);
          if (
            i.nextEarningsAt &&
            i.nextEarningsAt.getTime() < now.getTime() &&
            i.nextEarningsAt.getTime() !== found?.at.getTime()
          ) {
            i.previousEarningsAt = i.nextEarningsAt;
          }
          i.nextEarningsAt = found?.at ?? null;
          i.nextEarningsEstimated = found?.estimated ?? false;
          i.nextEarningsDate = found ? etDate(found.at) : null;
        } catch (err) {
          failures++;
          this.logger.warn(`Earnings lookup failed for ${i.symbol}: ${(err as Error).message}`);
        }
        i.earningsCheckedAt = now;
        await this.instruments.save(i);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT_LOOKUPS, list.length) }, worker),
    );
    return failures;
  }
}

function pick(w: ReturnType<typeof etWeek>) {
  return { weekStart: w.weekStart, weekEnd: w.weekEnd, today: w.today };
}
