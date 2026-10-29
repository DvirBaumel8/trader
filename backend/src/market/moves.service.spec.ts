import { describe, expect, it, vi } from 'vitest';
import { MovesService } from './moves.service.js';
import { previousTradingDay } from '../market-data/session.js';
import type { DailyBar, RegularQuote } from '../market-data/yahoo.client.js';

/**
 * `count` trading days ending on `end` (inclusive). Every bar closes at 100
 * with a range of 98..102, so every true range is 4 and Wilder's ATR is
 * exactly 4. The last two bars are overridden to make the numbers distinct:
 * the bar before `end` closes at 102 (range 99..103, TR still 4), `end` at 104.
 */
function series(end: string, count = 20): DailyBar[] {
  const dates = [end];
  while (dates.length < count) dates.unshift(previousTradingDay(dates[0]));
  const bars: DailyBar[] = dates.map((date) => ({ date, open: 100, high: 102, low: 98, close: 100 }));
  bars[count - 2] = { ...bars[count - 2], high: 103, low: 99, close: 102 };
  bars[count - 1] = { date: end, open: 102, high: 105, low: 101, close: 104 };
  return bars;
}

function fake(opts: {
  bars?: (symbol: string) => DailyBar[] | Error;
  quote?: (symbol: string) => RegularQuote | null | Error;
}) {
  const yahoo = {
    dailyBars: vi.fn(async (symbol: string) => {
      const r = opts.bars?.(symbol) ?? [];
      if (r instanceof Error) throw r;
      return r;
    }),
    quote: vi.fn(async (symbol: string) => {
      const r = opts.quote?.(symbol) ?? null;
      if (r instanceof Error) throw r;
      return r;
    }),
  };
  return { yahoo, service: new MovesService(yahoo as never) };
}

const THU_11AM = new Date('2026-10-29T15:00:00Z');
const THU_5PM = new Date('2026-10-29T21:00:00Z');

describe('MovesService.moves', () => {
  it('live: excludes the partial today bar, moves from the regular price', async () => {
    // Today's forming bar is wild (would wreck ATR) and must be ignored.
    const bars = series('2026-10-28');
    bars.push({ date: '2026-10-29', open: 100, high: 160, low: 90, close: 150 });
    const { service } = fake({
      bars: () => bars,
      quote: () => ({ price: 108.2, previousClose: 104 }),
    });
    const [m] = await service.moves(['aapl'], THU_11AM);
    // Last completed close is Wed's 104. ATR 4 / 104 = 3.846% -> 3.8 ;
    // (108.2 - 104) / 104 = 4.038% -> 4.0
    expect(m).toEqual({ symbol: 'AAPL', atrPercent: 3.8, movePercent: 4.0, live: true, asOf: '2026-10-29' });
  });

  it('after the close: last completed session vs the one before', async () => {
    const { service } = fake({ bars: () => series('2026-10-29') });
    const [m] = await service.moves(['AAPL'], THU_5PM);
    // ATR from bars before Thu = 4, reference close 102 -> 3.9 ; (104 - 102)/102 = 1.96% -> 2.0
    expect(m).toEqual({ symbol: 'AAPL', atrPercent: 3.9, movePercent: 2.0, live: false, asOf: '2026-10-29' });
  });

  it('pre-market Friday still reports Thursday and never uses the quote', async () => {
    const { service, yahoo } = fake({
      bars: () => series('2026-10-29'),
      quote: () => ({ price: 999, previousClose: 104 }),
    });
    const [m] = await service.moves(['AAPL'], new Date('2026-10-30T12:00:00Z'));
    expect(m.asOf).toBe('2026-10-29');
    expect(m.live).toBe(false);
    expect(m.movePercent).toBe(2.0);
    expect(yahoo.quote).not.toHaveBeenCalled();
  });

  it('Saturday reports Friday; Thanksgiving reports Wednesday', async () => {
    const sat = fake({ bars: () => series('2026-10-30') });
    expect((await sat.service.moves(['A'], new Date('2026-10-31T15:00:00Z')))[0].asOf).toBe('2026-10-30');
    const thanks = fake({ bars: () => series('2026-11-25') });
    const [m] = await thanks.service.moves(['A'], new Date('2026-11-26T16:00:00Z'));
    expect(m).toMatchObject({ asOf: '2026-11-25', live: false, movePercent: 2.0 });
  });

  it('after the early close on 11-27 is not live and reports that day', async () => {
    const { service } = fake({ bars: () => series('2026-11-27') });
    const [m] = await service.moves(['A'], new Date('2026-11-27T18:30:00Z'));
    expect(m).toMatchObject({ asOf: '2026-11-27', live: false, movePercent: 2.0 });
  });

  it('after the close but before the provider has the bar: nulls, not yesterday', async () => {
    const { service } = fake({ bars: () => series('2026-10-28') });
    const [m] = await service.moves(['A'], THU_5PM);
    expect(m).toEqual({ symbol: 'A', atrPercent: null, movePercent: null, live: false, asOf: '2026-10-29' });
  });

  it('fewer than 15 usable bars -> null ATR (live move still shown)', async () => {
    const { service } = fake({
      bars: () => series('2026-10-28', 14),
      quote: () => ({ price: 108.2, previousClose: 104 }),
    });
    const [m] = await service.moves(['A'], THU_11AM);
    expect(m).toMatchObject({ atrPercent: null, movePercent: 4.0, live: true });
  });

  it('non-live needs 15 bars before the last session', async () => {
    const enough = fake({ bars: () => series('2026-10-29', 16) });
    expect((await enough.service.moves(['A'], THU_5PM))[0].atrPercent).toBe(3.9);
    const short = fake({ bars: () => series('2026-10-29', 15) });
    expect((await short.service.moves(['A'], THU_5PM))[0]).toMatchObject({ atrPercent: null, movePercent: 2.0 });
  });

  it('live with no quote -> null move, ATR kept', async () => {
    const { service } = fake({ bars: () => series('2026-10-28'), quote: () => null });
    const [m] = await service.moves(['A'], THU_11AM);
    expect(m).toMatchObject({ atrPercent: 3.8, movePercent: null, live: true });
  });

  it('a failing symbol yields nulls without failing the others', async () => {
    const { service } = fake({
      bars: (s) => (s === 'BAD' ? new Error('429') : series('2026-10-29')),
    });
    const res = await service.moves(['BAD', 'GOOD'], THU_5PM);
    expect(res[0]).toEqual({ symbol: 'BAD', atrPercent: null, movePercent: null, live: false, asOf: '2026-10-29' });
    expect(res[1].atrPercent).toBe(3.9);
  });

  it('upper-cases, de-duplicates and keeps input order', async () => {
    const { service, yahoo } = fake({ bars: () => series('2026-10-29') });
    const res = await service.moves(['nvda', 'AAPL', 'NVDA', ' aapl '], THU_5PM);
    expect(res.map((m) => m.symbol)).toEqual(['NVDA', 'AAPL']);
    expect(yahoo.dailyBars).toHaveBeenCalledTimes(2);
  });

  it('caches bars for the day and the quote for 60 seconds', async () => {
    const { service, yahoo } = fake({
      bars: () => series('2026-10-28'),
      quote: () => ({ price: 108.2, previousClose: 104 }),
    });
    await service.moves(['A'], THU_11AM);
    await service.moves(['A'], new Date(THU_11AM.getTime() + 30_000));
    expect(yahoo.dailyBars).toHaveBeenCalledTimes(1);
    expect(yahoo.quote).toHaveBeenCalledTimes(1);
    await service.moves(['A'], new Date(THU_11AM.getTime() + 61_000));
    expect(yahoo.dailyBars).toHaveBeenCalledTimes(1);
    expect(yahoo.quote).toHaveBeenCalledTimes(2);
  });

  it('does not reuse live-session bars after the close', async () => {
    let call = 0;
    const { service, yahoo } = fake({
      bars: () => (call++ === 0 ? series('2026-10-28') : series('2026-10-29')),
      quote: () => ({ price: 108.2, previousClose: 104 }),
    });
    await service.moves(['A'], THU_11AM);
    const [m] = await service.moves(['A'], THU_5PM);
    expect(yahoo.dailyBars).toHaveBeenCalledTimes(2);
    expect(m.movePercent).toBe(2.0);
  });

  it('fetches at most 5 symbols at a time', async () => {
    let inFlight = 0;
    let max = 0;
    const yahoo = {
      dailyBars: async () => {
        inFlight++;
        max = Math.max(max, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return series('2026-10-29');
      },
      quote: async () => null,
    };
    const service = new MovesService(yahoo as never);
    const symbols = Array.from({ length: 12 }, (_, i) => `S${i}`);
    const res = await service.moves(symbols, THU_5PM);
    expect(res).toHaveLength(12);
    expect(max).toBe(5);
  });
});
