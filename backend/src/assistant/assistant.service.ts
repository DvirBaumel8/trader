import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { parseMessage, type Intent } from './parse.js';
import { buildPrompt } from './prompt.js';
import { HoldingsService } from '../holdings/holdings.service.js';
import { WatchlistService } from '../watchlist/watchlist.service.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
import { MarketDataService } from '../market-data/market-data.service.js';
import { HistoryService } from '../market-data/history.service.js';
import { DailyClose } from '../market-data/daily-close.entity.js';
import { movingAverage } from '../market-data/moving-average.js';

export type AssistantReply =
  | { kind: 'done'; message: string }
  | { kind: 'confirm'; message: string; action: { symbol: string; direction: 'LONG' | 'SHORT'; label: string } }
  | {
      kind: 'answer';
      message: string;
      facts: {
        symbol: string;
        price: number;
        stale: boolean;
        session: string | null;
        average: 'SMA' | 'EMA';
        period: number;
        value: number;
        percentFrom: number;
      };
    }
  | { kind: 'prompt'; text: string }
  | { kind: 'error'; message: string };

const SESSION_WORD: Record<string, string> = {
  PRE: 'pre-market',
  POST: 'after-hours',
  OVERNIGHT: 'overnight',
};

const usd = (n: number) => `$${n.toFixed(2)}`;

@Injectable()
export class AssistantService {
  constructor(
    private readonly holdings: HoldingsService,
    private readonly watchlist: WatchlistService,
    private readonly instruments: InstrumentsService,
    private readonly marketData: MarketDataService,
    private readonly history: HistoryService,
    @InjectRepository(DailyClose) private readonly closes: Repository<DailyClose>,
  ) {}

  async handle(text: string, now: Date = new Date()): Promise<AssistantReply> {
    const intent = parseMessage(text);
    try {
      return await this.execute(intent, text, now);
    } catch (err) {
      if (err instanceof NotFoundException && 'symbol' in intent) {
        return {
          kind: 'error',
          message: `I couldn't find the ticker ${intent.symbol}. Check the spelling, or try again in a minute.`,
        };
      }
      if (err instanceof BadRequestException) {
        return { kind: 'error', message: err.message };
      }
      throw err;
    }
  }

  private async execute(intent: Intent, text: string, now: Date): Promise<AssistantReply> {
    switch (intent.kind) {
      case 'add-holding': {
        const held = await this.holdings.find(intent.symbol);
        const word = intent.direction.toLowerCase();
        if (held === intent.direction) {
          return { kind: 'done', message: `You already hold ${intent.symbol} ${word}.` };
        }
        if (held !== null) {
          return {
            kind: 'confirm',
            message: `You hold ${intent.symbol} ${held.toLowerCase()}. Flip it to ${word}?`,
            action: { symbol: intent.symbol, direction: intent.direction, label: `Flip to ${word}` },
          };
        }
        const res = await this.holdings.set(intent.symbol, intent.direction);
        return { kind: 'done', message: `Added ${res.symbol} (${word}) to your holdings.` };
      }
      case 'remove-holding':
        return (await this.holdings.remove(intent.symbol))
          ? { kind: 'done', message: `Removed ${intent.symbol} from your holdings.` }
          : { kind: 'error', message: `You don't hold ${intent.symbol}.` };
      case 'watch': {
        const res = await this.watchlist.add(intent.symbol);
        return res.added
          ? { kind: 'done', message: `Watching ${res.symbol}.` }
          : { kind: 'done', message: `${res.symbol} is already on your watchlist.` };
      }
      case 'unwatch':
        return (await this.watchlist.remove(intent.symbol))
          ? { kind: 'done', message: `Stopped watching ${intent.symbol}.` }
          : { kind: 'error', message: `${intent.symbol} isn't on your watchlist.` };
      case 'ma-check':
        return this.maCheck(intent);
      case 'unknown':
        return {
          kind: 'prompt',
          text: buildPrompt({
            message: text.trim(),
            date: now.toISOString().slice(0, 10),
            holdings: (await this.holdings.list()).map((h) => ({ symbol: h.symbol, direction: h.direction })),
            watchlist: (await this.watchlist.list()).map((w) => w.symbol),
          }),
        };
    }
  }

  private async maCheck(intent: Extract<Intent, { kind: 'ma-check' }>): Promise<AssistantReply> {
    const { symbol, period, average, comparator } = intent;
    const instrument = await this.instruments.findOrCreate(symbol); // unknown → NotFoundException
    await this.history.ensurePriced(instrument, instrument.symbol);
    await this.history.ensureFresh();
    // force: a cached price must never hide an outage; getQuote marks its fallback stale.
    const quote = await this.marketData.getQuote(instrument.symbol, true);
    if (!quote) return { kind: 'error', message: `Couldn't get ${instrument.symbol}'s price right now.` };

    const rows = await this.closes.find({
      where: { instrumentId: instrument.id },
      order: { date: 'ASC' },
    });
    const value = movingAverage(rows.map((r) => r.close), period, average);
    if (value === null) {
      return { kind: 'error', message: `Not enough history for a ${period}-day ${average} on ${instrument.symbol}.` };
    }

    const percentFrom = (quote.price - value) / value;
    const side = quote.price >= value ? 'above' : 'below';
    const session = quote.stale ? null : SESSION_WORD[quote.session] ?? null;
    let message =
      `${side === comparator ? 'Yes' : 'No'}. ${instrument.symbol} (${usd(quote.price)}) is ` +
      `${(Math.abs(percentFrom) * 100).toFixed(2)}% ${side} its ${period}-day ${average} (${usd(value)}).`;
    if (quote.stale) message += ' The price is stale.';
    else if (session) message += ` The price is ${session}.`;

    return {
      kind: 'answer',
      message,
      facts: { symbol: instrument.symbol, price: quote.price, stale: quote.stale, session, average, period, value, percentFrom },
    };
  }
}
