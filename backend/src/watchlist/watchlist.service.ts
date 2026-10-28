import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { WatchlistItem } from './watchlist-item.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
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
    return instruments
      .map((i) => ({ symbol: i.symbol, name: i.name }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
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
    await this.items.save(this.items.create({ userId: user.id, instrumentId: instrument.id }));
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
