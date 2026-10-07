import { describe, expect, it } from 'vitest';
import { buildQueue, type QueueInput, type QueueStopTier } from './brief-queue.js';

// Wednesday 2026-10-07, 10:00 ET.
const NOW = new Date('2026-10-07T14:00:00Z');

function input(over: Partial<QueueInput> = {}): QueueInput {
  return {
    now: NOW,
    session: 'REGULAR',
    positions: [],
    stopTiers: [],
    symbolsWithoutStop: [],
    atrBySymbol: new Map(),
    earningsDateBySymbol: new Map(),
    theses: [],
    ...over,
  };
}

function tier(over: Partial<QueueStopTier> = {}): QueueStopTier {
  return { symbol: 'NVDA', stopPrice: 95, currentPrice: 100, distance: 0.05, passed: false, ...over };
}

const nvda = { symbol: 'NVDA', marketValue: 10_000, stale: false };

describe('buildQueue — stops', () => {
  it('flags a crossed stop in regular hours, telling him to check the order', () => {
    const queue = buildQueue(input({
      positions: [nvda],
      stopTiers: [tier({ stopPrice: 95, currentPrice: 93, distance: -0.0215, passed: true })],
    }));
    expect(queue).toEqual([{
      kind: 'STOP_CROSSED',
      symbol: 'NVDA',
      title: 'NVDA is through its stop at $95.00',
      detail: 'Last $93.00. If the stop has not filled, act on it now.',
    }]);
  });

  it('says a stop crossed outside regular hours will not fire until the open', () => {
    for (const session of ['PRE', 'POST', 'OVERNIGHT', 'CLOSED'] as const) {
      const [item] = buildQueue(input({
        session,
        positions: [nvda],
        stopTiers: [tier({ stopPrice: 95, currentPrice: 93, distance: -0.0215, passed: true })],
      }));
      expect(item.detail).toBe('Last $93.00 outside regular hours. The stop will not fire until the open.');
    }
  });

  it('names the crossed tier nearest the price when several are crossed, and adds no near-stop item', () => {
    const queue = buildQueue(input({
      positions: [nvda],
      atrBySymbol: new Map([['NVDA', 10]]),
      stopTiers: [
        tier({ stopPrice: 95, currentPrice: 90, distance: -0.0556, passed: true }),
        tier({ stopPrice: 91, currentPrice: 90, distance: -0.0111, passed: true }),
        tier({ stopPrice: 85, currentPrice: 90, distance: 0.0556, passed: false }),
      ],
    }));
    expect(queue).toHaveLength(1);
    expect(queue[0].title).toBe('NVDA is through its stop at $91.00');
  });

  it('flags a stop within 1 ATR, measured in dollars from the nearest tier', () => {
    const queue = buildQueue(input({
      positions: [nvda],
      atrBySymbol: new Map([['NVDA', 6]]),
      stopTiers: [tier({ stopPrice: 95, currentPrice: 100, distance: 0.05 }), tier({ stopPrice: 80, currentPrice: 100, distance: 0.2 })],
    }));
    expect(queue).toEqual([{
      kind: 'NEAR_STOP',
      symbol: 'NVDA',
      title: 'NVDA is within 1 ATR of its stop',
      detail: 'Stop $95.00, last $100.00: 0.8 ATR (5.0%) away.',
    }]);
  });

  it('does not flag a stop more than 1 ATR away', () => {
    const queue = buildQueue(input({
      positions: [nvda],
      atrBySymbol: new Map([['NVDA', 4]]),
      stopTiers: [tier({ stopPrice: 95, currentPrice: 100, distance: 0.05 })],
    }));
    expect(queue).toEqual([]);
  });

  it('skips the near-stop check, rather than guessing, when ATR is unknown', () => {
    const queue = buildQueue(input({ positions: [nvda], stopTiers: [tier()] }));
    expect(queue).toEqual([]);
  });

  it('flags a position with no stop, even when it has no quote yet', () => {
    const queue = buildQueue(input({
      positions: [{ symbol: 'PLTR', marketValue: null, stale: true }],
      symbolsWithoutStop: ['PLTR'],
    }));
    expect(queue).toEqual([{
      kind: 'NO_STOP',
      symbol: 'PLTR',
      title: 'PLTR has no stop',
      detail: 'Nothing limits the loss on this position. Quote is stale.',
    }]);
  });

  it('ignores stop rows for a symbol that is no longer held', () => {
    const queue = buildQueue(input({ stopTiers: [tier({ passed: true, distance: -0.02, currentPrice: 93 })] }));
    expect(queue).toEqual([]);
  });

  it('says so when the crossed-stop quote is stale', () => {
    const [item] = buildQueue(input({
      positions: [{ ...nvda, stale: true }],
      stopTiers: [tier({ stopPrice: 95, currentPrice: 93, distance: -0.0215, passed: true })],
    }));
    expect(item.detail).toBe('Last $93.00. If the stop has not filled, act on it now. Quote is stale.');
  });

  it('orders by urgency first, then by position size', () => {
    const queue = buildQueue(input({
      positions: [
        { symbol: 'SMALL', marketValue: 1_000, stale: false },
        { symbol: 'BIG', marketValue: 50_000, stale: false },
        { symbol: 'CROSS', marketValue: 500, stale: false },
        { symbol: 'SHORTY', marketValue: -20_000, stale: false },
      ],
      symbolsWithoutStop: ['SMALL', 'BIG', 'SHORTY'],
      stopTiers: [tier({ symbol: 'CROSS', passed: true, distance: -0.01, currentPrice: 94 })],
    }));
    expect(queue.map((i) => `${i.kind}:${i.symbol}`)).toEqual([
      'STOP_CROSSED:CROSS',
      'NO_STOP:BIG',
      'NO_STOP:SHORTY',
      'NO_STOP:SMALL',
    ]);
  });
});
