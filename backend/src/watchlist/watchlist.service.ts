import { Injectable, NotFoundException } from '@nestjs/common';
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
  bestCandidate,
  directionFor,
  distanceToTarget,
  targetReached,
} from './score.js';

export interface WatchlistRow {
  id: string;
  symbol: string;
  name: string | null;
  price: number | null;
  stale: boolean;
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
  note: string;
  tags: { id: string; label: string }[];
}

export interface UpsertInput {
  symbol: string;
  targetPrice?: number | null;
  note?: string;
  tags?: string[];
}

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
    private readonly instrumentsService: InstrumentsService,
    private readonly marketData: MarketDataService,
    private readonly users: UsersService,
  ) {}

  async list(): Promise<WatchlistRow[]> {
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
    const quotes = await this.marketData.getQuotes(
      instruments.map((i) => i.symbol),
    );

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
      const reached = targetReached(price, r.targetPrice, r.targetDirection);
      return {
        id: r.id,
        symbol: instrument?.symbol ?? 'UNKNOWN',
        name: instrument?.name ?? null,
        price,
        stale: quote?.stale ?? false,
        targetPrice: r.targetPrice,
        targetDirection: r.targetDirection,
        distanceToTarget: distanceToTarget(price, r.targetPrice),
        reached,
        alerting: reached && r.acknowledgedAt === null,
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

    let item = await this.items.findOne({
      where: { userId: user.id, instrumentId: instrument.id },
    });
    if (!item) {
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
      } else {
        const quote = await this.marketData.getQuote(instrument.symbol);
        // Direction is fixed from the price NOW — see directionFor.
        item.targetDirection = quote ? directionFor(quote.price, target) : 'ABOVE';
        item.targetPrice = target;
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

  /**
   * Which ticker deserves an opinion, and why — the deterministic half.
   *
   * The app ranks, the model judges: exactly the split the trade-idea design
   * settled. Nothing here asks a model anything; it returns the candidate and
   * the number that chose it, so the reason is always inspectable.
   */
  async best(): Promise<{ symbol: string; distanceToTarget: number } | null> {
    const rows = await this.list();
    const chosen = bestCandidate(rows);
    return chosen && chosen.distanceToTarget !== null
      ? { symbol: chosen.symbol, distanceToTarget: chosen.distanceToTarget }
      : null;
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
