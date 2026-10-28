import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { WatchlistItem } from './watchlist-item.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
import { reorderSymbols } from '../lists/order.js';
import { normalizeSymbols, partitionKnown } from '../lists/symbols.js';
import { UsersService } from '../users/users.service.js';

export interface WatchlistRow {
  symbol: string;
  name: string | null;
}

/** How many tickers may be watched at once — keeps the list readable on a phone. */
export const WATCHLIST_LIMIT = 50;

@Injectable()
export class WatchlistService {
  constructor(
    @InjectRepository(WatchlistItem) private readonly items: Repository<WatchlistItem>,
    @InjectRepository(Instrument) private readonly instruments: Repository<Instrument>,
    private readonly instrumentsService: InstrumentsService,
    private readonly users: UsersService,
  ) {}

  async list(): Promise<WatchlistRow[]> {
    const user = await this.users.currentUser();
    const rows = await this.items.find({ where: { userId: user.id } });
    if (rows.length === 0) return [];
    const instruments = await this.instruments.find({
      where: { id: In(rows.map((r) => r.instrumentId)) },
    });
    const positionById = new Map(rows.map((r) => [r.instrumentId, r.position]));
    return instruments
      .map((i) => ({ position: positionById.get(i.id) ?? 0, symbol: i.symbol, name: i.name }))
      .sort((a, b) => a.position - b.position || a.symbol.localeCompare(b.symbol))
      .map(({ symbol, name }) => ({ symbol, name }));
  }

  /** Saves the given order (unlisted symbols follow, unchanged) and returns the new list. 400 on an unknown symbol. */
  async reorder(symbols: string[]): Promise<WatchlistRow[]> {
    const user = await this.users.currentUser();
    const current = await this.list();
    const next = reorderSymbols(current.map((r) => r.symbol), symbols);
    const rows = await this.items.find({ where: { userId: user.id } });
    const instruments = await this.instruments.find({
      where: { id: In(rows.map((r) => r.instrumentId)) },
    });
    const symbolById = new Map(instruments.map((i) => [i.id, i.symbol]));
    const positionOf = new Map(next.map((s, idx) => [s, idx]));
    for (const r of rows) r.position = positionOf.get(symbolById.get(r.instrumentId) ?? '') ?? r.position;
    await this.items.save(rows);
    return this.list();
  }

  /** Validates the ticker (404 when unknown). `added: false` when it was already watched. */
  async add(symbol: string): Promise<{ added: boolean; symbol: string }> {
    const user = await this.users.currentUser();
    const instrument = await this.instrumentsService.findOrCreate(symbol);
    const existing = await this.items.findOne({
      where: { userId: user.id, instrumentId: instrument.id },
    });
    if (existing) return { added: false, symbol: instrument.symbol };
    const count = await this.items.count({ where: { userId: user.id } });
    if (count >= WATCHLIST_LIMIT) {
      throw new BadRequestException(
        `The watchlist holds ${WATCHLIST_LIMIT} tickers at most. Remove one before adding another.`,
      );
    }
    const mine = await this.items.find({ where: { userId: user.id } });
    const position = mine.reduce((max, r) => Math.max(max, r.position), -1) + 1;
    await this.items.save(this.items.create({ userId: user.id, instrumentId: instrument.id, position }));
    return { added: true, symbol: instrument.symbol };
  }

  /** Bulk add: normalises, validates 5 at a time, reports each symbol in exactly one group. */
  async addMany(
    raw: string[],
  ): Promise<{ added: string[]; already: string[]; notFound: string[]; full: string[] }> {
    const { known, notFound } = await partitionKnown(this.instrumentsService, normalizeSymbols(raw));
    const added: string[] = [];
    const already: string[] = [];
    const full: string[] = [];
    for (const s of known) {
      try {
        ((await this.add(s)).added ? added : already).push(s);
      } catch (err) {
        if (err instanceof BadRequestException) full.push(s);
        else throw err;
      }
    }
    return { added, already, notFound, full };
  }

  /** False when the symbol was not on this user's watchlist. */
  async remove(symbol: string): Promise<boolean> {
    const user = await this.users.currentUser();
    const instrument = await this.instruments.findOne({
      where: { symbol: symbol.trim().toUpperCase() },
    });
    if (!instrument) return false;
    const res = await this.items.delete({ userId: user.id, instrumentId: instrument.id });
    return (res.affected ?? 0) > 0;
  }
}
