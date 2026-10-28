import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Holding } from './holding.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
import { normalizeSymbols, partitionKnown } from '../lists/symbols.js';
import { UsersService } from '../users/users.service.js';

export interface HoldingRow {
  symbol: string;
  name: string | null;
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
        return { symbol: i?.symbol ?? 'UNKNOWN', name: i?.name ?? null };
      })
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  async has(symbol: string): Promise<boolean> {
    return (await this.rowFor(symbol)) !== null;
  }

  /** Always long. Validates the ticker first: unknown → NotFoundException. `added: false` when already held. */
  async add(symbol: string): Promise<{ added: boolean; symbol: string }> {
    const user = await this.users.currentUser();
    const instrument = await this.instrumentsService.findOrCreate(symbol);
    const existing = await this.holdings.findOne({
      where: { userId: user.id, instrumentId: instrument.id },
    });
    if (existing) return { added: false, symbol: instrument.symbol };
    await this.holdings.save(
      this.holdings.create({ userId: user.id, instrumentId: instrument.id, direction: 'LONG' }),
    );
    return { added: true, symbol: instrument.symbol };
  }

  /** Bulk add: normalises, validates 5 at a time, reports each symbol in exactly one group. */
  async addMany(raw: string[]): Promise<{ added: string[]; already: string[]; notFound: string[] }> {
    const { known, notFound } = await partitionKnown(this.instrumentsService, normalizeSymbols(raw));
    const added: string[] = [];
    const already: string[] = [];
    for (const s of known) ((await this.add(s)).added ? added : already).push(s);
    return { added, already, notFound };
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
