import { describe, expect, it, vi } from 'vitest';
import { InstrumentsService } from './instruments.service.js';
import type { Instrument } from './instrument.entity.js';
import type { MarketDataService } from '../market-data/market-data.service.js';
import type { HistoryService } from '../market-data/history.service.js';

function makeService(opts: {
  existing?: Instrument | null;
  quote?: { name: string } | null;
  historyError?: Error;
}) {
  const saved: Instrument[] = [];
  const repo = {
    findOne: vi.fn().mockResolvedValue(opts.existing ?? null),
    create: vi.fn().mockImplementation((data: Partial<Instrument>) => ({
      id: 'new-id',
      isBenchmark: false,
      createdAt: new Date(),
      ...data,
    })),
    save: vi.fn().mockImplementation(async (row: Instrument) => {
      saved.push(row);
      return row;
    }),
  };
  const marketData = {
    getQuote: vi.fn().mockResolvedValue(
      opts.quote === null ? null : (opts.quote ?? { name: 'CoreWeave' }),
    ),
  } as unknown as MarketDataService;
  const ensurePriced = vi.fn().mockImplementation(async () => {
    if (opts.historyError) throw opts.historyError;
  });
  const history = { ensurePriced } as unknown as HistoryService;

  const service = new InstrumentsService(repo as never, marketData, history);
  return { service, repo, marketData, ensurePriced };
}

describe('InstrumentsService.findOrCreate', () => {
  it('ensures price history for a newly created instrument', async () => {
    const { service, ensurePriced } = makeService({ existing: null });
    const instrument = await service.findOrCreate('crwv');
    expect(instrument.symbol).toBe('CRWV');
    expect(ensurePriced).toHaveBeenCalledTimes(1);
    expect(ensurePriced).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'CRWV' }),
      'CRWV',
    );
  });

  it('ensures price history for an already-known instrument too', async () => {
    const existing: Instrument = {
      id: 'inst-1',
      symbol: 'NVDA',
      name: 'NVIDIA',
      type: 'STOCK',
      isBenchmark: false,
      createdAt: new Date(),
    };
    const { service, ensurePriced } = makeService({ existing });
    const instrument = await service.findOrCreate('NVDA');
    expect(instrument).toBe(existing);
    expect(ensurePriced).toHaveBeenCalledWith(existing, 'NVDA');
  });

  it('still throws for an unknown ticker, without ever touching history', async () => {
    const { service, ensurePriced } = makeService({ existing: null, quote: null });
    await expect(service.findOrCreate('ZZZZNOTREAL')).rejects.toThrow(
      'Unknown ticker "ZZZZNOTREAL"',
    );
    expect(ensurePriced).not.toHaveBeenCalled();
  });

  it('still returns the instrument when the history fetch fails', async () => {
    // A Yahoo outage while backfilling price history must never block
    // writing the transaction that depends on this instrument existing.
    const { service } = makeService({
      existing: null,
      historyError: new Error('network down'),
    });
    const instrument = await service.findOrCreate('crwv');
    expect(instrument.symbol).toBe('CRWV');
  });
});
