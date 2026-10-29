import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { RawFundamentals } from '../market-data/yahoo.client.js';
import type { QuarterEstimate } from '../market-data/alpha-vantage.client.js';
import { FundamentalsCache } from './fundamentals-cache.entity.js';
import { FundamentalsService } from './fundamentals.service.js';

const B = 1_000_000_000;
const raw: RawFundamentals = {
  quoteType: 'EQUITY',
  currency: 'USD',
  epsQuarters: [{ periodEnd: '2026-07-31', fiscalQuarter: '2Q2027', actual: 2.22, reportedAt: '2026-08-26T20:20:00.000Z' }],
  cash: 62 * B,
  debt: 38 * B,
  series: [{ periodEnd: '2026-07-31', revenue: 96 * B, fcf: 45 * B }],
};
const estimates: QuarterEstimate[] = [
  { periodEnd: '2026-07-31', epsEstimate: 2.09, revenueEstimate: 92 * B },
  { periodEnd: '2026-10-31', epsEstimate: 2.47, revenueEstimate: 109 * B },
];

// 2026-10-29 15:00 ET and later the same ET day / the next one.
const D1 = new Date('2026-10-29T19:00:00Z');
const D1_LATE = new Date('2026-10-30T02:00:00Z'); // 22:00 ET same day
const D1_PLUS_2H = new Date('2026-10-29T21:00:00Z');
const D2 = new Date('2026-10-30T14:00:00Z');

function setup(opts: { nextEarningsAt?: Date | null } = {}) {
  const rows = new Map<string, FundamentalsCache>();
  const calls = { yahoo: 0, av: 0 };
  const behaviour = { yahoo: 'ok' as 'ok' | 'fail' | 'etf', av: 'ok' as 'ok' | 'fail', raw };
  const cache = {
    findOneBy: async ({ symbol }: { symbol: string }) => rows.get(symbol) ?? null,
    create: (d: Partial<FundamentalsCache>) => d as FundamentalsCache,
    save: async (r: FundamentalsCache) => {
      rows.set(r.symbol, r);
      return r;
    },
  };
  const instruments = { findOneBy: async () => (opts.nextEarningsAt ? { nextEarningsAt: opts.nextEarningsAt } : null) };
  const yahoo = {
    fundamentals: async () => {
      calls.yahoo++;
      if (behaviour.yahoo === 'fail') throw new Error('boom');
      if (behaviour.yahoo === 'etf') return { ...raw, quoteType: 'ETF', epsQuarters: [], series: [] };
      return behaviour.raw;
    },
  };
  const av = {
    quarterEstimates: async () => {
      calls.av++;
      if (behaviour.av === 'fail') throw new Error('quota');
      return estimates;
    },
  };
  const service = new FundamentalsService(cache as never, instruments as never, yahoo as never, av as never);
  return { service, rows, calls, behaviour };
}

describe('FundamentalsService', () => {
  it('fetches, shapes and caches', async () => {
    const { service, rows, calls } = setup();
    const out = await service.get('nvda', D1);
    expect(out.quarters[0]).toMatchObject({ label: 'Q2 FY27', revenueSurprisePct: 4.3 });
    expect(out.next?.label).toBe('Q3 FY27');
    expect(out.netCash).toBe(24 * B);
    expect(calls).toEqual({ yahoo: 1, av: 1 });
    expect(rows.get('NVDA')?.data.estimatesMissing).toBeUndefined();
  });

  it('serves a same-ET-day request from the cache, even late in the evening', async () => {
    const { service, calls } = setup();
    await service.get('NVDA', D1);
    await service.get('NVDA', D1_LATE);
    expect(calls).toEqual({ yahoo: 1, av: 1 });
  });

  it('refreshes on the next ET day', async () => {
    const { service, calls } = setup();
    await service.get('NVDA', D1);
    await service.get('NVDA', D2);
    expect(calls).toEqual({ yahoo: 2, av: 2 });
  });

  it('shares one provider call between simultaneous opens', async () => {
    const { service, calls } = setup();
    await Promise.all([service.get('NVDA', D1), service.get('NVDA', D1)]);
    expect(calls).toEqual({ yahoo: 1, av: 1 });
  });

  it('serves stale cache with its date when Yahoo fails', async () => {
    const { service, behaviour } = setup();
    const first = await service.get('NVDA', D1);
    behaviour.yahoo = 'fail';
    const out = await service.get('NVDA', D2);
    expect(out.fetchedAt).toBe(first.fetchedAt);
  });

  it('does not spend an Alpha Vantage call when Yahoo fails, and retries Yahoo at most hourly', async () => {
    const { service, calls, behaviour } = setup();
    await service.get('NVDA', D1);
    behaviour.yahoo = 'fail';
    await service.get('NVDA', D2);
    expect(calls).toEqual({ yahoo: 2, av: 1 });
    await service.get('NVDA', new Date(D2.getTime() + 10 * 60_000));
    expect(calls).toEqual({ yahoo: 2, av: 1 });
    behaviour.yahoo = 'ok';
    await service.get('NVDA', new Date(D2.getTime() + 2 * 3_600_000));
    expect(calls).toEqual({ yahoo: 3, av: 2 });
  });

  it('does not hammer Yahoo during an outage with nothing cached', async () => {
    const { service, calls, behaviour } = setup();
    behaviour.yahoo = 'fail';
    await expect(service.get('NVDA', D1)).rejects.toThrow(ServiceUnavailableException);
    await expect(service.get('NVDA', new Date(D1.getTime() + 60_000))).rejects.toThrow(ServiceUnavailableException);
    expect(calls.yahoo).toBe(1);
  });

  it('carries the earlier expectations forward when Alpha Vantage fails on a refresh', async () => {
    const { service, rows, behaviour } = setup();
    await service.get('NVDA', D1);
    behaviour.av = 'fail';
    const out = await service.get('NVDA', D2);
    expect(out.quarters[0].epsEstimate).toBe(2.09);
    expect(out.next?.epsEstimate).toBe(2.47);
    expect(out.fetchedAt).toBe(D2.toISOString());
    expect(rows.get('NVDA')?.data.estimatesMissing).toBe(true);
  });

  it('503s when Yahoo fails with nothing cached', async () => {
    const { service, behaviour } = setup();
    behaviour.yahoo = 'fail';
    await expect(service.get('NVDA', D1)).rejects.toThrow(ServiceUnavailableException);
    await expect(service.get('NVDA', D1)).rejects.toThrow("Couldn't load the numbers right now.");
  });

  it('caches the actuals when Alpha Vantage fails, and retries estimates after an hour', async () => {
    const { service, rows, calls, behaviour } = setup();
    behaviour.av = 'fail';
    const out = await service.get('NVDA', D1);
    expect(out.quarters[0].eps).toBe(2.22);
    expect(out.quarters[0].epsEstimate).toBeNull();
    expect(out.next).toBeNull();
    expect(rows.get('NVDA')?.data.estimatesMissing).toBe(true);

    await service.get('NVDA', new Date(D1.getTime() + 10 * 60_000));
    expect(calls.av).toBe(1);

    behaviour.av = 'ok';
    const retried = await service.get('NVDA', D1_PLUS_2H);
    expect(calls.av).toBe(2);
    expect(retried.quarters[0].epsEstimate).toBe(2.09);
    expect(rows.get('NVDA')?.data.estimatesMissing).toBeUndefined();
  });

  it('404s a non-company and remembers it for the day', async () => {
    const { service, calls, behaviour } = setup();
    behaviour.yahoo = 'etf';
    await expect(service.get('QQQ', D1)).rejects.toThrow(NotFoundException);
    await expect(service.get('QQQ', D1)).rejects.toThrow('QQQ is not a company');
    expect(calls.yahoo).toBe(1);
    expect(calls.av).toBe(0);
    await expect(service.get('QQQ', D2)).rejects.toThrow(NotFoundException);
    expect(calls.yahoo).toBe(2);
  });

  it('404s a malformed ticker without asking Yahoo', async () => {
    const { service, calls } = setup();
    await expect(service.get('no good!', D1)).rejects.toThrow(NotFoundException);
    expect(calls.yahoo).toBe(0);
  });

  it('fills next.reportAt from the instrument when it is after the newest report', async () => {
    const at = new Date('2026-11-19T21:20:00Z');
    expect((await setup({ nextEarningsAt: at }).service.get('NVDA', D1)).next?.reportAt).toBe(at.toISOString());
    const stale = new Date('2026-08-26T20:20:00Z');
    expect((await setup({ nextEarningsAt: stale }).service.get('NVDA', D1)).next?.reportAt).toBeNull();
    expect((await setup().service.get('NVDA', D1)).next?.reportAt).toBeNull();
  });
});
