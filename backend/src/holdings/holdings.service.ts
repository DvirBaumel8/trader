import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Holding } from './holding.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
import { reorderSymbols } from '../lists/order.js';
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
        return { position: r.position, symbol: i?.symbol ?? 'UNKNOWN', name: i?.name ?? null };
      })
      .sort((a, b) => a.position - b.position || a.symbol.localeCompare(b.symbol))
      .map(({ symbol, name }) => ({ symbol, name }));
  }

  /** Saves the given order (unlisted symbols follow, unchanged) and returns the new list. 400 on an unknown symbol. */
  async reorder(symbols: string[]): Promise<HoldingRow[]> {
    const user = await this.users.currentUser();
    const current = await this.list();
    const next = reorderSymbols(current.map((r) => r.symbol), symbols);
    const rows = await this.holdings.find({ where: { userId: user.id } });
    const instruments = await this.instruments.find({
      where: { id: In(rows.map((r) => r.instrumentId)) },
    });
    const symbolById = new Map(instruments.map((i) => [i.id, i.symbol]));
    const positionOf = new Map(next.map((s, idx) => [s, idx]));
    for (const r of rows) r.position = positionOf.get(symbolById.get(r.instrumentId) ?? '') ?? r.position;
    await this.holdings.save(rows);
    return this.list();
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
    const mine = await this.holdings.find({ where: { userId: user.id } });
    const position = mine.reduce((max, r) => Math.max(max, r.position), -1) + 1;
    await this.holdings.save(
      this.holdings.create({ userId: user.id, instrumentId: instrument.id, direction: 'LONG', position }),
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
