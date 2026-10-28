import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { EarningsService } from './earnings.service.js';
import type { Instrument } from '../instruments/instrument.entity.js';

// Thursday 2026-10-29, 15:00Z (11:00 ET). Week: 10-26 .. 10-30.
const NOW = new Date('2026-10-29T15:00:00Z');
const CHECKED_TODAY = new Date('2026-10-29T13:00:00Z');
const CHECKED_YESTERDAY = new Date('2026-10-28T13:00:00Z');

function inst(symbol: string, extra: Partial<Instrument> = {}): Instrument {
  return { symbol, nextEarningsEstimated: false, ...extra } as Instrument;
}

function setup(opts: {
  instruments: Instrument[];
  holdings?: string[];
  watchlist?: string[];
  earnings?: Record<string, { at: string; estimated: boolean } | null | 'throw'>;
}) {
  const saved: Instrument[] = [];
  const repo = {
    find: vi.fn(async () => opts.instruments),
    save: vi.fn(async (i: Instrument) => {
      saved.push({ ...i });
      return i;
    }),
  };
  const yahoo = {
    nextEarnings: vi.fn(async (symbol: string) => {
      const e = opts.earnings?.[symbol];
      if (e === 'throw') throw new Error('provider down');
      return e ? { at: new Date(e.at), estimated: e.estimated } : null;
    }),
  };
  const holdings = {
    list: async () => (opts.holdings ?? []).map((symbol) => ({ symbol, name: null })),
  };
  const watchlist = {
    list: async () => (opts.watchlist ?? []).map((symbol) => ({ symbol, name: null })),
  };
  const service = new EarningsService(repo as never, yahoo as never, holdings as never, watchlist as never);
  return { service, repo, yahoo, saved };
}

describe('EarningsService.week', () => {
  it('places entries on the right day with timing and source', async () => {
    const { service } = setup({
      instruments: [inst('LMND'), inst('NVDA')],
      holdings: ['LMND'],
      watchlist: ['NVDA'],
      earnings: {
        LMND: { at: '2026-10-30T12:30:00Z', estimated: false },
        NVDA: { at: '2026-10-27T21:00:00Z', estimated: true },
      },
    });
    const res = await service.week(NOW);
    expect(res.weekStart).toBe('2026-10-26');
    expect(res.weekEnd).toBe('2026-10-30');
    expect(res.today).toBe('2026-10-29');
    expect(res.days.map((d) => d.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
    expect(res.days[1].entries).toEqual([{ symbol: 'NVDA', source: 'watchlist', timing: 'after_close', estimated: true }]);
    expect(res.days[4].entries).toEqual([{ symbol: 'LMND', source: 'holding', timing: 'before_open', estimated: false }]);
  });

  it('a symbol on both lists appears once, as a holding', async () => {
    const { service } = setup({
      instruments: [inst('AAPL')],
      holdings: ['AAPL'],
      watchlist: ['AAPL'],
      earnings: { AAPL: { at: '2026-10-28T20:30:00Z', estimated: false } },
    });
    const res = await service.week(NOW);
    expect(res.days.flatMap((d) => d.entries)).toEqual([
      { symbol: 'AAPL', source: 'holding', timing: 'after_close', estimated: false },
    ]);
    // 10-28 is before today: still listed, without a date.
    expect(res.upcoming).toEqual([
      { symbol: 'AAPL', source: 'holding', date: null, daysUntil: null, estimated: false },
    ]);
  });

  it('sorts a day by timing then symbol', async () => {
    const { service } = setup({
      instruments: [inst('ZED'), inst('BBB'), inst('AAA'), inst('MID')],
      holdings: ['ZED', 'BBB', 'AAA', 'MID'],
      earnings: {
        ZED: { at: '2026-10-30T12:00:00Z', estimated: false },
        BBB: { at: '2026-10-30T21:00:00Z', estimated: false },
        AAA: { at: '2026-10-30T21:00:00Z', estimated: false },
        MID: { at: '2026-10-30T17:00:00Z', estimated: false },
      },
    });
    const res = await service.week(NOW);
    expect(res.days[4].entries.map((e) => e.symbol)).toEqual(['ZED', 'MID', 'AAA', 'BBB']);
  });

  it('does not call Yahoo for an instrument checked today with a future date', async () => {
    const { service, yahoo, repo } = setup({
      instruments: [
        inst('LMND', { earningsCheckedAt: CHECKED_TODAY, nextEarningsAt: new Date('2026-10-30T12:30:00Z') }),
      ],
      holdings: ['LMND'],
    });
    const res = await service.week(NOW);
    expect(yahoo.nextEarnings).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
    expect(res.days[4].entries).toHaveLength(1);
  });

  it('refreshes when last checked on an earlier ET day, and stores the result', async () => {
    const { service, yahoo, saved } = setup({
      instruments: [inst('LMND', { earningsCheckedAt: CHECKED_YESTERDAY, nextEarningsAt: new Date('2026-10-31T12:00:00Z') })],
      holdings: ['LMND'],
      earnings: { LMND: { at: '2026-10-30T12:30:00Z', estimated: true } },
    });
    const res = await service.week(NOW);
    expect(yahoo.nextEarnings).toHaveBeenCalledWith('LMND');
    expect(saved[0].nextEarningsAt).toEqual(new Date('2026-10-30T12:30:00Z'));
    expect(saved[0].nextEarningsEstimated).toBe(true);
    expect(saved[0].nextEarningsDate).toBe('2026-10-30');
    expect(saved[0].earningsCheckedAt).toEqual(NOW);
    expect(res.days[4].entries[0].estimated).toBe(true);
  });

  it('does not refresh when checked today, even if the cached date has passed', async () => {
    const { service, yahoo } = setup({
      instruments: [inst('LMND', { earningsCheckedAt: CHECKED_TODAY, nextEarningsAt: new Date('2026-10-29T10:00:00Z') })],
      holdings: ['LMND'],
    });
    const res = await service.week(NOW);
    expect(yahoo.nextEarnings).not.toHaveBeenCalled();
    expect(res.days[3].entries.map((e) => e.symbol)).toEqual(['LMND']);
  });

  it('keeps a reported ticker in the week via previousEarningsAt when Yahoo rolls to next quarter', async () => {
    const { service, saved } = setup({
      instruments: [inst('LMND', { earningsCheckedAt: CHECKED_YESTERDAY, nextEarningsAt: new Date('2026-10-27T12:30:00Z'), nextEarningsEstimated: true })],
      holdings: ['LMND'],
      earnings: { LMND: { at: '2027-02-10T12:30:00Z', estimated: true } },
    });
    const res = await service.week(NOW);
    expect(saved[0].previousEarningsAt).toEqual(new Date('2026-10-27T12:30:00Z'));
    expect(res.days[1].entries).toEqual([
      { symbol: 'LMND', source: 'holding', timing: 'before_open', estimated: false },
    ]);
    expect(res.upcoming).toEqual([
      { symbol: 'LMND', source: 'holding', date: '2027-02-10', daysUntil: 104, estimated: true },
    ]);
  });

  it('a null result moves a past date into previousEarningsAt', async () => {
    const { service, saved } = setup({
      instruments: [inst('LMND', { earningsCheckedAt: CHECKED_YESTERDAY, nextEarningsAt: new Date('2026-10-27T12:30:00Z') })],
      holdings: ['LMND'],
      earnings: { LMND: null },
    });
    const res = await service.week(NOW);
    expect(saved[0].nextEarningsAt).toBeNull();
    expect(saved[0].previousEarningsAt).toEqual(new Date('2026-10-27T12:30:00Z'));
    expect(res.days[1].entries).toHaveLength(1);
  });

  it('a second load the same day makes no Yahoo call and still shows the ticker', async () => {
    const inst1 = inst('LMND', { earningsCheckedAt: CHECKED_YESTERDAY, nextEarningsAt: new Date('2026-10-27T12:30:00Z') });
    const { service, yahoo } = setup({
      instruments: [inst1],
      holdings: ['LMND'],
      earnings: { LMND: { at: '2027-02-10T12:30:00Z', estimated: false } },
    });
    await service.week(NOW);
    expect(yahoo.nextEarnings).toHaveBeenCalledTimes(1);
    const res = await service.week(NOW);
    expect(yahoo.nextEarnings).toHaveBeenCalledTimes(1);
    expect(res.days[1].entries).toHaveLength(1);
  });

  it('a throwing symbol keeps its old cache, is marked checked, and others still show', async () => {
    const { service, saved } = setup({
      instruments: [
        inst('BAD', { earningsCheckedAt: CHECKED_YESTERDAY, nextEarningsAt: new Date('2026-10-30T20:00:00Z') }),
        inst('GOOD'),
      ],
      holdings: ['BAD', 'GOOD'],
      earnings: { BAD: 'throw', GOOD: { at: '2026-10-27T12:00:00Z', estimated: false } },
    });
    const res = await service.week(NOW);
    const bad = saved.find((s) => s.symbol === 'BAD')!;
    expect(bad.nextEarningsAt).toEqual(new Date('2026-10-30T20:00:00Z'));
    expect(bad.earningsCheckedAt).toEqual(NOW);
    expect(res.days.flatMap((d) => d.entries.map((e) => e.symbol)).sort()).toEqual(['BAD', 'GOOD']);
  });

  it('503 when every refresh throws and nothing is cached', async () => {
    const { service } = setup({
      instruments: [inst('A'), inst('B')],
      holdings: ['A'],
      watchlist: ['B'],
      earnings: { A: 'throw', B: 'throw' },
    });
    await expect(service.week(NOW)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('ignores dates outside the week and clears an ETF with no date', async () => {
    const { service, saved } = setup({
      instruments: [inst('FAR', {}), inst('QQQ', { nextEarningsAt: new Date('2026-10-20T12:00:00Z'), earningsCheckedAt: CHECKED_YESTERDAY })],
      holdings: ['FAR'],
      watchlist: ['QQQ'],
      earnings: { FAR: { at: '2026-11-05T12:00:00Z', estimated: false }, QQQ: null },
    });
    const res = await service.week(NOW);
    expect(res.days.flatMap((d) => d.entries)).toEqual([]);
    expect(saved.find((s) => s.symbol === 'QQQ')!.nextEarningsAt).toBeNull();
    expect(res.upcoming).toEqual([
      { symbol: 'FAR', source: 'holding', date: '2026-11-05', daysUntil: 7, estimated: false },
      { symbol: 'QQQ', source: 'watchlist', date: null, daysUntil: null, estimated: false },
    ]);
  });

  it('upcoming sorts by days ascending, nulls last, ties by symbol', async () => {
    const { service } = setup({
      instruments: [inst('B'), inst('A'), inst('C'), inst('N')],
      holdings: ['B', 'A', 'C', 'N'],
      earnings: {
        B: { at: '2026-10-29T20:00:00Z', estimated: false },
        A: { at: '2026-10-29T12:00:00Z', estimated: false },
        C: { at: '2026-11-02T12:00:00Z', estimated: true },
      },
    });
    const res = await service.week(NOW);
    expect(res.upcoming.map((u) => [u.symbol, u.daysUntil])).toEqual([
      ['A', 0],
      ['B', 0],
      ['C', 4],
      ['N', null],
    ]);
  });

  it('limits concurrent Yahoo calls to 5', async () => {
    const symbols = Array.from({ length: 12 }, (_, i) => `S${i}`);
    let active = 0;
    let peak = 0;
    const { service, yahoo } = setup({ instruments: symbols.map((s) => inst(s)), holdings: symbols });
    yahoo.nextEarnings.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return null;
    });
    await service.week(NOW);
    expect(yahoo.nextEarnings).toHaveBeenCalledTimes(12);
    expect(peak).toBeLessThanOrEqual(5);
  });
});
