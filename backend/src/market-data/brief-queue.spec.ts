import { describe, expect, it } from 'vitest';
import { buildQueue, nextTradingDate, type QueueInput, type QueueStopTier, type QueueThesis } from './brief-queue.js';
import type { RawBar } from './yahoo.client.js';

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

/** Consecutive calendar-day bars ending on `end`, high/low one point either side of the close. */
function series(closes: number[], end = '2026-10-07', highLow = 1): RawBar[] {
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return closes.map((close, i) => {
    const date = new Date(endMs - (closes.length - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { date, close, adjClose: close, open: close, high: close + highLow, low: close - highLow, volume: 1_000_000 };
  });
}

describe('nextTradingDate', () => {
  it('is the next weekday', () => {
    expect(nextTradingDate('2026-10-07')).toBe('2026-10-08');
  });
  it('skips the weekend', () => {
    expect(nextTradingDate('2026-10-09')).toBe('2026-10-12');
  });
  it('skips a market holiday', () => {
    expect(nextTradingDate('2026-11-25')).toBe('2026-11-27'); // Thanksgiving is the 26th
  });
});

describe('buildQueue — earnings', () => {
  const held = [{ symbol: 'NVDA', marketValue: 10_000, stale: false }];

  it('flags earnings today, with the stop status', () => {
    const [item] = buildQueue(input({
      positions: held,
      earningsDateBySymbol: new Map([['NVDA', '2026-10-07']]),
      stopTiers: [tier({ distance: 0.082 })],
    }));
    expect(item).toEqual({
      kind: 'EARNINGS',
      symbol: 'NVDA',
      title: 'NVDA reports today',
      detail: 'Earnings before the next session. Nearest stop 8.2% away.',
    });
  });

  it('flags earnings on the next trading day, and says when there is no stop', () => {
    const item = buildQueue(input({
      positions: held,
      symbolsWithoutStop: ['NVDA'],
      earningsDateBySymbol: new Map([['NVDA', '2026-10-08']]),
    })).find((i) => i.kind === 'EARNINGS');
    expect(item?.title).toBe('NVDA reports tomorrow');
    expect(item?.detail).toBe('Earnings before the next session. No stop.');
  });

  // A stop with no priced row (no quote yet) is not "no stop".
  it('does not claim there is no stop when the stop just has no priced row', () => {
    const [item] = buildQueue(input({
      positions: held,
      earningsDateBySymbol: new Map([['NVDA', '2026-10-08']]),
    }));
    expect(item.detail).toBe('Earnings before the next session. Stop distance unknown.');
  });

  it('on a Friday, counts Monday as the next session and names the day', () => {
    const [item] = buildQueue(input({
      now: new Date('2026-10-09T20:30:00Z'), // Friday, after the close
      session: 'POST',
      positions: held,
      earningsDateBySymbol: new Map([['NVDA', '2026-10-12']]),
      stopTiers: [tier({ distance: 0.05 })],
    }));
    expect(item.title).toBe('NVDA reports Monday');
  });

  it('does not flag earnings two sessions away', () => {
    expect(buildQueue(input({
      positions: held,
      earningsDateBySymbol: new Map([['NVDA', '2026-10-09']]),
    }))).toEqual([]);
  });

  it('ignores a stored earnings date already in the past', () => {
    expect(buildQueue(input({
      positions: held,
      earningsDateBySymbol: new Map([['NVDA', '2026-10-01']]),
    }))).toEqual([]);
  });

  it('says the stop is already crossed rather than giving a negative distance', () => {
    const items = buildQueue(input({
      positions: held,
      earningsDateBySymbol: new Map([['NVDA', '2026-10-07']]),
      stopTiers: [tier({ distance: -0.02, currentPrice: 93, passed: true })],
    }));
    expect(items.find((i) => i.kind === 'EARNINGS')?.detail).toBe('Earnings before the next session. Stop already crossed.');
  });
});

describe('buildQueue — thesis', () => {
  const held = [{ symbol: 'NVDA', marketValue: 10_000, stale: false }];
  const thesis = (over: Partial<QueueThesis>): QueueThesis => ({
    symbol: 'NVDA', direction: 'LONG', reasons: ['ENTRY_SMA_150'], entryDate: '2026-05-01', bars: [], ...over,
  });

  it('flags a long entered on the 150 SMA that closed below it', () => {
    const [item] = buildQueue(input({
      session: 'POST',
      positions: held,
      theses: [thesis({ bars: series([...Array(159).fill(100), 90]) })],
    }));
    expect(item.kind).toBe('THESIS_BROKEN');
    expect(item.title).toBe('NVDA closed below its 150 SMA');
    expect(item.detail).toBe('You entered on the 150 SMA. Close $90.00, SMA $99.93.');
  });

  it('flags a short entered on the 150 SMA that closed above it', () => {
    const [item] = buildQueue(input({
      session: 'POST',
      positions: held,
      theses: [thesis({ direction: 'SHORT', bars: series([...Array(159).fill(100), 110]) })],
    }));
    expect(item.title).toBe('NVDA closed above its 150 SMA');
  });

  it('ignores today\'s partial bar in pre-market and regular hours', () => {
    const bars = series([...Array(159).fill(100), 90]); // last bar is dated today, 2026-10-07
    for (const session of ['PRE', 'REGULAR'] as const) {
      expect(buildQueue(input({ session, positions: held, theses: [thesis({ bars })] }))).toEqual([]);
    }
  });

  it('needs 150 completed bars before judging the SMA', () => {
    expect(buildQueue(input({
      session: 'POST',
      positions: held,
      theses: [thesis({ bars: series([...Array(100).fill(100), 90]) })],
    }))).toEqual([]);
  });

  it('flags a long breakout that closed back under the prior 20-day high', () => {
    // 20 bars at 100 (high 101) before entry on 2026-09-28, then 9 at 105, then a close at 99.
    const bars = series([...Array(20).fill(100), ...Array(9).fill(105), 99]);
    const [item] = buildQueue(input({
      session: 'POST',
      positions: held,
      theses: [thesis({ reasons: ['ENTRY_BREAKOUT'], entryDate: '2026-09-28', bars })],
    }));
    expect(item.title).toBe('NVDA closed back under its breakout level');
    expect(item.detail).toBe('You entered on a breakout over $101.00. Last close $99.00.');
  });

  it('does not flag a breakout that is holding', () => {
    const bars = series([...Array(20).fill(100), ...Array(9).fill(105), 102]);
    expect(buildQueue(input({
      session: 'POST',
      positions: held,
      theses: [thesis({ reasons: ['ENTRY_BREAKOUT'], entryDate: '2026-09-28', bars })],
    }))).toEqual([]);
  });

  it('flags a short breakdown that closed back above the prior 20-day low', () => {
    const bars = series([...Array(20).fill(100), ...Array(9).fill(95), 101]);
    const [item] = buildQueue(input({
      session: 'POST',
      positions: held,
      theses: [thesis({ direction: 'SHORT', reasons: ['ENTRY_BREAKOUT'], entryDate: '2026-09-28', bars })],
    }));
    expect(item.title).toBe('NVDA closed back above its breakdown level');
    expect(item.detail).toBe('You entered on a breakdown under $99.00. Last close $101.00.');
  });

  it('needs 20 bars before the entry to know the breakout level', () => {
    const bars = series([...Array(10).fill(100), ...Array(9).fill(105), 99]);
    expect(buildQueue(input({
      session: 'POST',
      positions: held,
      theses: [thesis({ reasons: ['ENTRY_BREAKOUT'], entryDate: '2026-09-28', bars })],
    }))).toEqual([]);
  });

  it('has no rule for volume or news entries', () => {
    const bars = series([...Array(159).fill(100), 90]);
    expect(buildQueue(input({
      session: 'POST',
      positions: held,
      theses: [thesis({ reasons: ['ENTRY_VOLUME', 'ENTRY_NEWS'], bars })],
    }))).toEqual([]);
  });

  it('gives one thesis item per symbol even when both rules broke', () => {
    const bars = series([...Array(140).fill(100), ...Array(19).fill(105), 90]);
    const items = buildQueue(input({
      session: 'POST',
      positions: held,
      theses: [thesis({ reasons: ['ENTRY_SMA_150', 'ENTRY_BREAKOUT'], entryDate: '2026-09-20', bars })],
    }));
    expect(items.filter((i) => i.kind === 'THESIS_BROKEN')).toHaveLength(1);
  });
});
