import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PortfolioService } from '../portfolio/portfolio.service.js';
import { WatchlistService } from '../watchlist/watchlist.service.js';
import { DailyClose } from './daily-close.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { HistoryService } from './history.service.js';
import { EconomicCalendarClient } from './economic-calendar.client.js';
import { buildDailyBriefNotes, type BriefNote } from './daily-brief.js';
import type { MarketSession } from './select-price.js';

export interface DailyBriefResponse {
  generatedAt: string;
  refreshAfterSeconds: number;
  marketDataAvailable: boolean;
  coverage: {
    source: 'PORTFOLIO' | 'WATCHLIST';
    symbol: string;
    price: number | null;
    regularPrice: number | null;
    stale: boolean;
    session: MarketSession | null;
    extended: boolean;
  }[];
  notes: (BriefNote | {
    kind: 'EARNINGS' | 'ECONOMIC';
    source: 'PORTFOLIO' | 'WATCHLIST' | 'MARKET';
    symbol: string | null;
    title: string;
    detail: string;
    eventAt?: string;
    actual?: number | null;
    expected?: number | null;
  })[];
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfWeek(now: Date): Date {
  const start = new Date(now);
  const day = start.getUTCDay();
  start.setUTCDate(start.getUTCDate() - (day === 0 ? 6 : day - 1));
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

@Injectable()
export class DailyBriefService {
  constructor(
    private readonly portfolio: PortfolioService,
    private readonly watchlist: WatchlistService,
    @InjectRepository(DailyClose)
    private readonly closes: Repository<DailyClose>,
    @InjectRepository(Instrument)
    private readonly instruments: Repository<Instrument>,
    private readonly history: HistoryService,
    private readonly calendar: EconomicCalendarClient,
  ) {}

  async get(options: { refresh?: boolean; now?: Date } = {}): Promise<DailyBriefResponse> {
    const now = options.now ?? new Date();
    const refresh = options.refresh === true;
    void this.history.ensureFresh().catch(() => {});
    const weekStart = startOfWeek(now);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const [portfolio, watched, calendar] = await Promise.all([
      this.portfolio.getPortfolio({ refresh }),
      this.watchlist.list({ refresh }),
      this.calendar.week(isoDate(weekStart), isoDate(weekEnd)),
    ]);
    const coverageBySymbol = new Map<string, DailyBriefResponse['coverage'][number]>();
    for (const position of portfolio.positions) coverageBySymbol.set(position.symbol, {
      source: 'PORTFOLIO', symbol: position.symbol, price: position.price,
      regularPrice: position.regularPrice, stale: position.stale,
      session: position.session, extended: position.extended,
    });
    for (const row of watched) if (!coverageBySymbol.has(row.symbol)) coverageBySymbol.set(row.symbol, {
      source: 'WATCHLIST', symbol: row.symbol, price: row.price,
      regularPrice: row.regularPrice, stale: row.stale,
      session: row.session, extended: row.extended,
    });

    const symbols = [...coverageBySymbol.keys()];
    const instruments = await this.instruments.find({ where: { symbol: In([...symbols, 'SPY']) } });
    const instrumentBySymbol = new Map(instruments.map((instrument) => [instrument.symbol, instrument]));
    const bars = await this.closes.find({
      where: { instrumentId: In(instruments.map((instrument) => instrument.id)) },
      order: { date: 'ASC' },
    });
    const barsByInstrument = new Map<string, typeof bars>();
    for (const bar of bars) {
      const current = barsByInstrument.get(bar.instrumentId) ?? [];
      current.push(bar);
      barsByInstrument.set(bar.instrumentId, current);
    }
    const spyBars = barsByInstrument.get(instrumentBySymbol.get('SPY')?.id ?? '') ?? [];
    const notes: DailyBriefResponse['notes'] = [];
    for (const symbol of symbols) {
      const price = coverageBySymbol.get(symbol)?.price;
      const instrument = instrumentBySymbol.get(symbol);
      if (price !== undefined && price !== null && instrument) {
        notes.push(...buildDailyBriefNotes({
          symbol,
          source: coverageBySymbol.get(symbol)!.source,
          price,
          bars: barsByInstrument.get(instrument.id) ?? [],
          spyBars,
        }));
      }
    }

    const weekDays = (days: number | null) => days !== null && days >= 0 && days <= 6;
    for (const position of portfolio.positions) {
      if (weekDays(position.daysUntilEarnings)) notes.push({ kind: 'EARNINGS', source: 'PORTFOLIO', symbol: position.symbol, title: `${position.symbol} has earnings this week`, detail: position.daysUntilEarnings === 0 ? 'Earnings are today.' : `Earnings are in ${position.daysUntilEarnings} days.` });
    }
    for (const row of watched) {
      if (weekDays(row.daysUntilEarnings) && !portfolio.positions.some((position) => position.symbol === row.symbol)) notes.push({ kind: 'EARNINGS', source: 'WATCHLIST', symbol: row.symbol, title: `${row.symbol} has earnings this week`, detail: row.daysUntilEarnings === 0 ? 'Earnings are today.' : `Earnings are in ${row.daysUntilEarnings} days.` });
    }
    for (const event of calendar.events) notes.push({ kind: 'ECONOMIC', source: 'MARKET', symbol: null, title: event.title, detail: event.detail, eventAt: event.date });

    return { generatedAt: now.toISOString(), refreshAfterSeconds: 300, marketDataAvailable: calendar.available, coverage: [...coverageBySymbol.values()], notes };
  }
}
