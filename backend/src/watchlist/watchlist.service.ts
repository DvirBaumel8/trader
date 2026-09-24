import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { WatchlistItem } from './watchlist-item.entity.js';
import { WatchlistItemTag } from './watchlist-tag.entity.js';
import { Tag } from '../journal/tag.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
import { MarketDataService } from '../market-data/market-data.service.js';
import { UsersService } from '../users/users.service.js';
import {
  directionFor,
  distanceToTarget,
  firstReachedOn,
  targetReached,
  todayChangePercent,
} from './score.js';
import { DailyClose } from '../market-data/daily-close.entity.js';
import { HistoryService } from '../market-data/history.service.js';
import { EarningsService } from '../market-data/earnings.service.js';
import type { MarketSession } from '../market-data/select-price.js';

export interface WatchlistRow {
  id: string;
  symbol: string;
  name: string | null;
  price: number | null;
  regularPrice: number | null;
  /** Today's move from the previous close, as a fraction. Null without both prices. */
  todayChangePercent: number | null;
  stale: boolean;
  session: MarketSession | null;
  extended: boolean;
  targetPrice: number | null;
  targetDirection: 'ABOVE' | 'BELOW' | null;
  /** How far the price still has to move, as a percentage. Null without both numbers. */
  distanceToTarget: number | null;
  /** The price is at or through the target right now. */
  reached: boolean;
  /**
   * Reached AND not yet acknowledged — what the page shouts about on open.
   * Separate from `reached` so the list can keep showing a hit quietly after
   * the banner has been dismissed.
   */
  alerting: boolean;
  /**
   * The day it first touched the target, or null if it never has. What makes
   * the answer checkable: "NVDA hit your price on Sep 9" rather than an
   * unexplained badge.
   */
  reachedOn: string | null;
  note: string;
  tags: { id: string; label: string }[];
  daysUntilEarnings: number | null;
}

export interface UpsertInput {
  symbol: string;
  targetPrice?: number | null;
  note?: string;
  tags?: string[];
}

/**
 * How many tickers may be watched at once.
 *
 * Fifty is a product decision, not a technical one, and it does two jobs: it
 * keeps the list readable, and it bounds the ranking prompt, which is what
 * makes one model call for the whole watchlist possible. Enforced as a
 * refusal rather than a truncation — a ranking that silently covers part of a
 * list is worse than a list that will not grow.
 */
export const WATCHLIST_LIMIT = 50;

@Injectable()
export class WatchlistService {
  constructor(
    @InjectRepository(WatchlistItem)
    private readonly items: Repository<WatchlistItem>,
    @InjectRepository(WatchlistItemTag)
    private readonly itemTags: Repository<WatchlistItemTag>,
    @InjectRepository(Tag) private readonly tags: Repository<Tag>,
    @InjectRepository(Instrument)
    private readonly instruments: Repository<Instrument>,
    @InjectRepository(DailyClose)
    private readonly closes: Repository<DailyClose>,
    private readonly history: HistoryService,
    private readonly instrumentsService: InstrumentsService,
    private readonly marketData: MarketDataService,
    private readonly users: UsersService,
    private readonly earnings: EarningsService,
  ) {}

  async list(options: { refresh?: boolean } = {}): Promise<WatchlistRow[]> {
    const user = await this.users.currentUser();
    const rows = await this.items.find({
      where: { userId: user.id },
      order: { createdAt: 'ASC' },
    });
    if (rows.length === 0) return [];

    const instruments = await this.instruments.find({
      where: { id: In(rows.map((r) => r.instrumentId)) },
    });
    const byId = new Map(instruments.map((i) => [i.id, i]));

    // One batched quote call for the whole list — the cache makes a repeat
    // visit free for 60s, and a per-row call would be N round trips.
    // `augment: false` — Twelve Data's extended-print second opinion is a
    // shared 8-requests-a-minute budget (see `getQuotes`'s doc comment), and
    // the watchlist's live pre/post price is a nicety next to what account
    // value and the Stops page need from that same budget.
    const [quotes, earningsBySymbol] = await Promise.all([
      this.marketData.getQuotes(
        instruments.map((i) => i.symbol),
        options.refresh === true,
        false,
      ),
      this.earnings.daysUntil(instruments),
    ]);

    /**
     * Daily bars for every watched instrument, so "did it reach my price"
     * can look back rather than only at this instant. Loaded once for the
     * whole list; the window per item is sliced below.
     */
    const bars = await this.closes.find({
      where: { instrumentId: In(rows.map((r) => r.instrumentId)) },
      order: { date: 'ASC' },
    });
    const barsByInstrument = new Map<string, DailyClose[]>();
    for (const bar of bars) {
      const list = barsByInstrument.get(bar.instrumentId);
      if (list) list.push(bar);
      else barsByInstrument.set(bar.instrumentId, [bar]);
    }

    const links = await this.itemTags.find({
      where: { itemId: In(rows.map((r) => r.id)) },
    });
    const tagRows = links.length
      ? await this.tags.find({ where: { id: In(links.map((l) => l.tagId)) } })
      : [];
    const tagById = new Map(tagRows.map((t) => [t.id, t]));

    return rows.map((r) => {
      const instrument = byId.get(r.instrumentId);
      const quote = instrument ? quotes.get(instrument.symbol.toUpperCase()) : undefined;
      const price = quote?.price ?? null;

      /**
       * The owner's requirement: did it reach the target at any point FROM
       * THE MOMENT HE SET IT TO NOW — not "is it there this second". A
       * ticker that spiked through his level and pulled back has reached it.
       *
       * Two sources, because neither alone is enough. Daily bars cover every
       * session since the target was set, including intraday touches the
       * close hides; the live quote covers today, whose bar is provisional
       * and may not yet know about a move made minutes ago.
       */
      const since = r.targetSetAt;
      const window = (barsByInstrument.get(r.instrumentId) ?? []).filter(
        (b) => since === null || b.date >= since.toISOString().slice(0, 10),
      );
      const reachedOn = firstReachedOn(
        window.map((b) => ({ date: b.date, high: b.high, low: b.low })),
        r.targetPrice,
        r.targetDirection,
      );
      const reachedNow = targetReached(price, r.targetPrice, r.targetDirection);
      const reached = reachedOn !== null || reachedNow;
      return {
        id: r.id,
        symbol: instrument?.symbol ?? 'UNKNOWN',
        name: instrument?.name ?? null,
        daysUntilEarnings: instrument
          ? earningsBySymbol.get(instrument.symbol) ?? null
          : null,
        price,
        regularPrice: quote?.regularPrice ?? null,
        todayChangePercent: todayChangePercent(price, quote?.previousClose ?? null),
        stale: quote?.stale ?? true,
        session: quote?.session ?? null,
        extended: quote?.extended ?? false,
        targetPrice: r.targetPrice,
        targetDirection: r.targetDirection,
        distanceToTarget: distanceToTarget(price, r.targetPrice),
        reached,
        alerting: reached && r.acknowledgedAt === null,
        reachedOn,
        note: r.note,
        tags: links
          .filter((l) => l.itemId === r.id)
          .map((l) => tagById.get(l.tagId))
          .filter((t): t is Tag => t !== undefined)
          .map((t) => ({ id: t.id, label: t.label })),
      };
    });
  }

  /**
   * Add a ticker, or update the one already there.
   *
   * Upsert rather than a separate create/update pair because the unique
   * constraint makes "add NVDA twice" an error the owner would have to
   * understand and recover from, for no gain — he meant "watch NVDA", and it
   * is now watched.
   */
  async upsert(input: UpsertInput): Promise<WatchlistRow> {
    const user = await this.users.currentUser();
    // findOrCreate validates the ticker against the provider, so a typo is a
    // 404 here rather than a row for a symbol that does not exist.
    const instrument = await this.instrumentsService.findOrCreate(input.symbol);
    /**
     * Give a watched ticker its daily history.
     *
     * `ensurePriced` is otherwise only called from the journal write path, so
     * a ticker he watches but does not own had no bars at all — and with no
     * bars there is nothing to look back through, which makes "did it reach
     * my price since I set it" unanswerable. A no-op once the rows exist, and
     * it never throws: a provider outage must not block adding a ticker.
     */
    await this.history.ensurePriced(instrument, instrument.symbol);

    let item = await this.items.findOne({
      where: { userId: user.id, instrumentId: instrument.id },
    });
    if (!item) {
      const count = await this.items.count({ where: { userId: user.id } });
      if (count >= WATCHLIST_LIMIT) {
        throw new BadRequestException(
          `The watchlist holds ${WATCHLIST_LIMIT} tickers at most. Remove one before adding another.`,
        );
      }
      item = this.items.create({
        userId: user.id,
        instrumentId: instrument.id,
        note: input.note ?? '',
      });
    }
    if (input.note !== undefined) item.note = input.note;

    if (input.targetPrice !== undefined) {
      const target = input.targetPrice;
      if (target === null) {
        item.targetPrice = null;
        item.targetDirection = null;
        item.targetSetAt = null;
      } else {
        const quote = await this.marketData.getQuote(instrument.symbol);
        // Direction is fixed from the price NOW — see directionFor.
        item.targetDirection = quote ? directionFor(quote.price, target) : 'ABOVE';
        item.targetPrice = target;
        // The window "has it reached it" searches starts here, and only a
        // change to the target itself moves it.
        item.targetSetAt = new Date();
      }
      // A new target has never been announced, whatever was acknowledged
      // about the old one.
      item.acknowledgedAt = null;
    }

    const saved = await this.items.save(item);
    if (input.tags !== undefined) {
      await this.setTags(saved.id, user.id, input.tags);
    }

    const rows = await this.list();
    const row = rows.find((r) => r.id === saved.id);
    if (!row) throw new NotFoundException('Watchlist item not found');
    return row;
  }

  async remove(id: string): Promise<void> {
    const user = await this.users.currentUser();
    const item = await this.items.findOne({ where: { id, userId: user.id } });
    if (!item) throw new NotFoundException('Watchlist item not found');
    await this.items.delete({ id });
  }

  /** Empties the whole watchlist in one request, rather than one DELETE per row. */
  async removeAll(): Promise<void> {
    const user = await this.users.currentUser();
    await this.items.delete({ userId: user.id });
  }

  /** "Yes, I have seen that." Silences the banner until the target changes. */
  async acknowledge(id: string): Promise<void> {
    const user = await this.users.currentUser();
    const item = await this.items.findOne({ where: { id, userId: user.id } });
    if (!item) throw new NotFoundException('Watchlist item not found');
    item.acknowledgedAt = new Date();
    await this.items.save(item);
  }

  /** Every WATCH tag the owner has used, for the composer's suggestions. */
  async listTags() {
    const user = await this.users.currentUser();
    const rows = await this.tags.find({
      where: { userId: user.id, type: 'WATCH' },
      order: { label: 'ASC' },
    });
    return rows.map((t) => ({ id: t.id, label: t.label }));
  }

  private async setTags(itemId: string, userId: string, labels: string[]) {
    await this.itemTags.delete({ itemId });
    const wanted = [...new Set(labels.map((l) => l.trim()).filter(Boolean))];
    for (const label of wanted) {
      let tag = await this.tags.findOne({
        where: { userId, type: 'WATCH', label },
      });
      if (!tag) {
        tag = await this.tags.save(
          this.tags.create({ userId, type: 'WATCH', label }),
        );
      }
      await this.itemTags.save(this.itemTags.create({ itemId, tagId: tag.id }));
    }
  }
}
