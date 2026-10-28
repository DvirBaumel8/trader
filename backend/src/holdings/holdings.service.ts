import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Holding, type Direction } from './holding.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
import { UsersService } from '../users/users.service.js';

export interface HoldingRow {
  symbol: string;
  name: string | null;
  direction: Direction;
}

@Injectable()
export class HoldingsService {
  constructor(
    @InjectRepository(Holding) private readonly holdings: Repository<Holding>,
    @InjectRepository(Instrument) private readonly instruments: Repository<Instrument>,
    private readonly instrumentsService: InstrumentsService,
    private readonly users: UsersService,
  ) {}

  async list(): Promise<HoldingRow[]> {
    const user = await this.users.currentUser();
    const rows = await this.holdings.find({ where: { userId: user.id } });
    if (rows.length === 0) return [];
    const instruments = await this.instruments.find({
      where: { id: In(rows.map((r) => r.instrumentId)) },
    });
    const byId = new Map(instruments.map((i) => [i.id, i]));
    return rows
      .map((r) => {
        const i = byId.get(r.instrumentId);
        return { symbol: i?.symbol ?? 'UNKNOWN', name: i?.name ?? null, direction: r.direction };
      })
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  /** The direction held, or null. Never creates an instrument. */
  async find(symbol: string): Promise<Direction | null> {
    const row = await this.rowFor(symbol);
    return row?.direction ?? null;
  }

  /** Adds or flips. Validates the ticker first: unknown → NotFoundException. */
  async set(
    symbol: string,
    direction: Direction,
  ): Promise<{ symbol: string; direction: Direction; previous: Direction | null }> {
    const user = await this.users.currentUser();
    const instrument = await this.instrumentsService.findOrCreate(symbol);
    const existing = await this.holdings.findOne({
      where: { userId: user.id, instrumentId: instrument.id },
    });
    if (existing) {
      const previous = existing.direction;
      if (previous !== direction) {
        existing.direction = direction;
        await this.holdings.save(existing);
      }
      return { symbol: instrument.symbol, direction, previous };
    }
    await this.holdings.save(
      this.holdings.create({ userId: user.id, instrumentId: instrument.id, direction }),
    );
    return { symbol: instrument.symbol, direction, previous: null };
  }

  /** False when this user did not hold the symbol. */
  async remove(symbol: string): Promise<boolean> {
    const row = await this.rowFor(symbol);
    if (!row) return false;
    await this.holdings.delete({ id: row.id });
    return true;
  }

  private async rowFor(symbol: string): Promise<Holding | null> {
    const user = await this.users.currentUser();
    const instrument = await this.instruments.findOne({
      where: { symbol: symbol.trim().toUpperCase() },
    });
    if (!instrument) return null;
    return this.holdings.findOne({ where: { userId: user.id, instrumentId: instrument.id } });
  }
}
