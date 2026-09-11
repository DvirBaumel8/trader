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

/**
 * `ensureFresh` needs more of the repositories than `ensurePriced` does: the
 * newest stored bar, and the list of instruments to top up.
 */
function makeFreshService(opts: {
  newestDate: string | null;
  instruments: Instrument[];
  perInstrument?: { instrumentId: string; newest: string }[];
}) {
  const requestedFrom: Date[] = [];
  const requestedBySymbol = new Map<string, Date>();
  const closes = {
    count: vi.fn().mockResolvedValue(1),
    upsert: vi.fn().mockResolvedValue(undefined),
    find: vi
      .fn()
      .mockResolvedValue(opts.newestDate ? [{ date: opts.newestDate }] : []),
    // The per-instrument watermark. `perInstrument` lets a test put one
    // symbol behind while the rest are current — the case a single global
    // watermark could never see.
    createQueryBuilder: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      getRawMany: vi.fn().mockResolvedValue(
        opts.perInstrument ??
          (opts.newestDate
            ? opts.instruments.map((i) => ({
                instrumentId: i.id,
                newest: opts.newestDate,
              }))
            : []),
      ),
    }),
  };
  const instruments = {
    find: vi.fn().mockResolvedValue(opts.instruments),
  };
  const yahoo = {
    dailyBars: vi.fn().mockImplementation(async (sym: string, from: Date) => {
      requestedFrom.push(from);
      requestedBySymbol.set(sym, from);
      return [];
    }),
  } as unknown as YahooClient;

  const service = new HistoryService(
    closes as never,
    instruments as never,
    {} as never,
    {} as never,
    yahoo,
  );
  return { service, requestedFrom, requestedBySymbol };
}

describe('HistoryService.ensureFresh', () => {
  const days = (from: Date, to: Date) =>
    Math.round((to.getTime() - from.getTime()) / 86_400_000);

  /**
   * The gap that could never close. The top-up used a FIXED seven-day
   * window, so leaving the app unopened for ten days fetched only the last
   * seven — days eight to ten were never fetched, and never would be, since
   * every later top-up reached back seven days too. A permanent hole, and a
   * 150-day average computed across one is quietly wrong.
   */
  it('reaches back past the newest stored bar when the history has fallen far behind', async () => {
    const now = new Date('2026-09-20T15:00:00Z');
    const { service, requestedFrom } = makeFreshService({
      newestDate: '2026-09-01', // 19 days stale
      instruments: [CRWV],
    });

    await service.ensureFresh(now);

    expect(requestedFrom.length).toBeGreaterThan(0);
    // Must start before the newest bar we hold, not seven days before today.
    expect(requestedFrom[0].getTime()).toBeLessThan(
      new Date('2026-09-01T00:00:00Z').getTime(),
    );
    expect(days(requestedFrom[0], now)).toBeGreaterThan(7);
  });

  /**
   * A current history still asks for about a week, not a long re-fetch. Dated
   * on a Friday with Thursday's bar stored: a weekend with Friday's bar is a
   * different case entirely, and correctly does nothing at all.
   */
  it('asks for about a week when the history is current', async () => {
    const now = new Date('2026-09-18T15:00:00Z');
    const { service, requestedFrom } = makeFreshService({
      newestDate: '2026-09-17',
      instruments: [CRWV],
    });

    await service.ensureFresh(now);

    expect(requestedFrom.length).toBeGreaterThan(0);
    expect(days(requestedFrom[0], now)).toBeLessThanOrEqual(9);
  });

  /** A weekend holding Friday's bar is finished business — nothing to fetch. */
  it('does nothing on a Sunday holding Friday data', async () => {
    const { service, requestedFrom } = makeFreshService({
      newestDate: '2026-09-18',
      instruments: [CRWV],
    });

    await service.ensureFresh(new Date('2026-09-20T15:00:00Z'));

    expect(requestedFrom).toHaveLength(0);
  });
});

describe('HistoryService.ensureFresh, per instrument', () => {
  const OTHER: Instrument = { ...CRWV, id: 'inst-nvda', symbol: 'NVDA' };

  /**
   * The same defect one level down, found by asking step 4 of the bug
   * process: where else does this pattern live? Deriving the window from the
   * newest bar fixed the everything-is-behind case, but the watermark was
   * GLOBAL — so one symbol failing at the provider while the others succeed
   * left it behind forever, with the database reporting itself current.
   */
  it('catches up a lagging instrument even while the others are current', async () => {
    const now = new Date('2026-09-18T15:00:00Z');
    const { service, requestedBySymbol } = makeFreshService({
      newestDate: '2026-09-17',
      instruments: [CRWV, OTHER],
      perInstrument: [
        { instrumentId: 'inst-nvda', newest: '2026-09-17' }, // current
        { instrumentId: 'inst-crwv', newest: '2026-08-01' }, // far behind
      ],
    });

    await service.ensureFresh(now);

    const laggard = requestedBySymbol.get('CRWV')!;
    const current = requestedBySymbol.get('NVDA')!;
    const daysBack = (d: Date) =>
      Math.round((now.getTime() - d.getTime()) / 86_400_000);

    expect(daysBack(laggard)).toBeGreaterThan(40);
    expect(daysBack(current)).toBeLessThanOrEqual(9);
  });
});
