import { describe, it, expect, vi } from 'vitest';
import { TradesService } from './trades.service.js';
import { tradeId } from './trade-window.js';

const ENTERED = new Date('2026-03-02T15:00:00.000Z');
const EXITED = new Date('2026-03-04T15:00:00.000Z');

function bar(date: string, high: number, low: number, close: number) {
  return { date, open: close, high, low, close, volume: 1000 };
}

function build(opts: {
  isOpen: boolean;
  quotes: () => Promise<Map<string, { price: number }>>;
  extremes: () => Promise<{ high: number | null; low: number | null }>;
}) {
  const bars = [
    bar('2026-03-02', 101, 99, 100),
    bar('2026-03-03', 105, 100, 104),
    bar('2026-03-04', 106, 103, 105),
    // Post-exit bar: must never lift a closed trade's high-water mark.
    bar('2026-03-05', 150, 140, 145),
  ];
  const marketData = {
    getQuotes: vi.fn(opts.quotes),
    getExtendedExtremes: vi.fn(opts.extremes),
  };
  const svc = new TradesService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { findOne: async () => ({ id: 1, symbol: 'ABC' }) } as never,
    { find: async () => bars } as never,
    marketData as never,
    {} as never,
    {} as never,
  );
  vi.spyOn(svc, 'deriveAllTrades').mockResolvedValue([
    {
      symbol: 'ABC',
      direction: 'LONG',
      enteredAt: ENTERED,
      exitedAt: opts.isOpen ? null : EXITED,
      isOpen: opts.isOpen,
      remainingQuantity: opts.isOpen ? 10 : 0,
      fills: [],
      currentStops: [
        { kind: 'TRAILING', trailPercent: 10, price: null, quantity: 10 },
      ],
    },
  ] as never);
  return { svc, marketData };
}

describe('TradesService.getTrade provider usage', () => {
  it('a closed trade never asks for extended extremes and ignores post-exit prices', async () => {
    const { svc, marketData } = build({
      isOpen: false,
      quotes: async () => new Map(),
      extremes: async () => ({ high: 999, low: null }),
    });
    const res = await svc.getTrade(tradeId('ABC', ENTERED));
    expect(marketData.getExtendedExtremes).not.toHaveBeenCalled();
    expect(marketData.getQuotes).not.toHaveBeenCalled();
    expect(res.trade.highWaterPrice).toBe(106);
  });

  it('an open trade starts the quote and extremes lookups before either resolves', async () => {
    const releases: Array<() => void> = [];
    const gate = () => new Promise<void>((r) => releases.push(r));
    const { svc, marketData } = build({
      isOpen: true,
      quotes: async () => {
        await gate();
        return new Map([['ABC', { price: 110 }]]);
      },
      extremes: async () => {
        await gate();
        return { high: 200, low: null };
      },
    });
    const pending = svc.getTrade(tradeId('ABC', ENTERED));
    await vi.waitFor(() => {
      expect(marketData.getQuotes).toHaveBeenCalledTimes(1);
      expect(marketData.getExtendedExtremes).toHaveBeenCalledTimes(1);
    });
    releases.forEach((r) => r());
    const res = await pending;
    expect(res.trade.currentPrice).toBe(110);
    expect(res.trade.highWaterPrice).toBe(200);
  });
});
