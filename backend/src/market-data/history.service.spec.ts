import { describe, expect, it, vi } from 'vitest';
import { HistoryService } from './history.service.js';
import type { Instrument } from '../instruments/instrument.entity.js';
import type { YahooClient } from './yahoo.client.js';

const CRWV: Instrument = {
  id: 'inst-crwv',
  symbol: 'CRWV',
  name: 'CoreWeave',
  type: 'STOCK',
  isBenchmark: false,
  createdAt: new Date('2026-09-01'),
};

function makeService(opts: {
  existingBarCount: number;
  bars?: {
    date: string;
    close: number;
    adjClose: number;
    open: number | null;
    high: number | null;
    low: number | null;
    volume: number | null;
  }[];
  yahooError?: Error;
  upsert?: (rows: unknown[]) => void;
}) {
  const closes = {
    count: vi.fn().mockResolvedValue(opts.existingBarCount),
    upsert: vi.fn().mockImplementation(async (rows: unknown[]) => {
      opts.upsert?.(rows);
    }),
  };
  const yahoo = {
    dailyBars: vi.fn().mockImplementation(async () => {
      if (opts.yahooError) throw opts.yahooError;
      return opts.bars ?? [];
    }),
  } as unknown as YahooClient;

  // Only `closes` and `yahoo` matter for ensurePriced; the rest are unused
  // by that path.
  const service = new HistoryService(
    closes as never,
    {} as never,
    {} as never,
    {} as never,
    yahoo,
  );
  return { service, closes, yahoo };
}

describe('HistoryService.ensurePriced', () => {
  it('does nothing when the instrument already has bars', async () => {
    const { service, yahoo } = makeService({ existingBarCount: 5 });
    await service.ensurePriced(CRWV, 'CRWV');
    expect(yahoo.dailyBars).not.toHaveBeenCalled();
  });

  it('fetches and stores bars for an instrument with no price history at all', async () => {
    const { service, closes, yahoo } = makeService({
      existingBarCount: 0,
      bars: [
        {
          date: '2026-09-01',
          close: 163.88,
          adjClose: 163.88,
          open: null,
          high: null,
          low: null,
          volume: 5_123_456,
        },
      ],
    });
    await service.ensurePriced(CRWV, 'CRWV');
    expect(yahoo.dailyBars).toHaveBeenCalledWith('CRWV', expect.any(Date));
    expect(closes.upsert).toHaveBeenCalledTimes(1);
    const [rows] = closes.upsert.mock.calls[0];
    expect(rows).toEqual([
      expect.objectContaining({
        instrumentId: 'inst-crwv',
        date: '2026-09-01',
        volume: 5_123_456,
      }),
    ]);
  });

  it('logs and does not throw when the provider fails', async () => {
    const { service } = makeService({
      existingBarCount: 0,
      yahooError: new Error('network down'),
    });
    await expect(service.ensurePriced(CRWV, 'CRWV')).resolves.toBeUndefined();
  });
});
