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

export interface DailyBriefResponse {
  generatedAt: string;
  refreshAfterSeconds: number;
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

  async get(now = new Date()): Promise<DailyBriefResponse> {
    void this.history.ensureFresh().catch(() => {});
    const [portfolio, watched] = await Promise.all([
      this.portfolio.getPortfolio(),
      this.watchlist.list(),
    ]);
    const sourceBySymbol = new Map<string, 'PORTFOLIO' | 'WATCHLIST'>();
    for (const position of portfolio.positions) sourceBySymbol.set(position.symbol, 'PORTFOLIO');
    for (const row of watched) if (!sourceBySymbol.has(row.symbol)) sourceBySymbol.set(row.symbol, 'WATCHLIST');

    const symbols = [...sourceBySymbol.keys()];
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
    const priceBySymbol = new Map<string, number>();
    for (const position of portfolio.positions) if (position.price !== null) priceBySymbol.set(position.symbol, position.price);
    for (const row of watched) if (row.price !== null) priceBySymbol.set(row.symbol, row.price);

    const notes: DailyBriefResponse['notes'] = [];
    for (const symbol of symbols) {
      const price = priceBySymbol.get(symbol);
      const instrument = instrumentBySymbol.get(symbol);
      if (price !== undefined && instrument) {
        notes.push(...buildDailyBriefNotes({
          symbol,
          source: sourceBySymbol.get(symbol)!,
          price,
          bars: barsByInstrument.get(instrument.id) ?? [],
          spyBars,
        }));
      }
    }

    const weekEnd = new Date(startOfWeek(now));
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const weekDays = (days: number | null) => days !== null && days >= 0 && days <= 6;
    for (const position of portfolio.positions) {
      if (weekDays(position.daysUntilEarnings)) notes.push({ kind: 'EARNINGS', source: 'PORTFOLIO', symbol: position.symbol, title: `${position.symbol} has earnings this week`, detail: position.daysUntilEarnings === 0 ? 'Earnings are today.' : `Earnings are in ${position.daysUntilEarnings} days.` });
    }
    for (const row of watched) {
      if (weekDays(row.daysUntilEarnings) && !portfolio.positions.some((position) => position.symbol === row.symbol)) notes.push({ kind: 'EARNINGS', source: 'WATCHLIST', symbol: row.symbol, title: `${row.symbol} has earnings this week`, detail: row.daysUntilEarnings === 0 ? 'Earnings are today.' : `Earnings are in ${row.daysUntilEarnings} days.` });
    }
    const macroEvents = await this.calendar.week(isoDate(startOfWeek(now)), isoDate(weekEnd));
    for (const event of macroEvents) notes.push({ kind: 'ECONOMIC', source: 'MARKET', symbol: null, title: event.name, detail: event.actual !== null && event.expected !== null ? `${event.actual} actual vs ${event.expected} expected.` : 'Scheduled this week.', eventAt: event.date, actual: event.actual, expected: event.expected });

    return { generatedAt: now.toISOString(), refreshAfterSeconds: 300, notes };
  }
}
