# Brief Redesign — Slice 2 (Decision Queue) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Brief's **Needs attention** section. It is a backend-computed decision queue of stops crossed, stops within 1 ATR, positions with no stop, earnings before the next session, and broken entry theses. Items are ordered by urgency and then by position size, and each item links to its holding.

**Architecture:** A new pure module, `backend/src/market-data/brief-queue.ts`, turns facts the app already computes into queue items:
- per-tier stop distances, from `PortfolioService.getPortfolio().stopTiers`
- the no-stop list, from `atRisk.positionsWithoutStop`
- ATR, from the bars the Brief already loads
- earnings dates, from `Instrument.nextEarningsDate`
- each open trade's entry reasons, from a new `TradesService.openTradeEntries()` that reads the opening fill's journal entry, filtered by user

`DailyBriefService` wires these in, and adds `queue` to the response and to the AI facts. The frontend renders the queue with the existing `BriefNoteList`, which gets an empty-state option.

**Tech Stack:** NestJS + TypeORM, React + TanStack Query + Tailwind, Vitest, Playwright (iPhone WebKit).

**Spec:** `docs/superpowers/specs/2026-10-06-brief-redesign-design.md`, section "Decision queue". This plan is delivery slice 2 of 4. Slice 1 is shipped (`e98dd95..f1edc94`).

## Global Constraints

- Read `AGENTS.md` first; its invariants apply to every task.
- Every per-user read filters by `userId` from `usersService.currentUser()`, including the new journal-entry read in `TradesService.openTradeEntries()`.
- The backend computes and the frontend displays. Queue titles and details are written in the backend. The frontend renders `title` and `detail` verbatim and holds no rule, threshold or wording about stops, ATR, earnings or theses.
- Stop prices come only from `portfolio/stop-distance.ts` rows (`stopTiers`), never re-derived, so the Brief cannot disagree with the Stops page.
- Missing data means no item, never a guess. That covers no ATR, missing bars, no 150 bars for the SMA, fewer than 20 bars before entry, no earnings date, and an unknown entry reason.
- Long and short are mirrored throughout. For a short, a stop is "crossed" when the price is above it; the `stopTiers` rows already carry this as `passed`.
- Stale quotes are said to be stale. Any queue item for a symbol whose quote is stale appends ` Quote is stale.` to its detail.
- Tests never call Yahoo, an LLM or any network.
- Never touch the real `trader` database destructively.
- Percent strings in queue copy use one decimal, e.g. `8.2%`. Money uses `$` and two decimals, e.g. `$95.00`.
- Commit style is `feat(brief): …` or `test(brief): …`. End every commit message with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01KSLpjvWMhkHqfbWoTYBnE1
  ```
  Commit locally on `main`. Do not push.

## Review Focus

1. **A position with several stop tiers, one of them crossed.** Expected: one `STOP_CROSSED` item for that symbol, naming the crossed tier. No `NEAR_STOP` item for the same symbol. Pinned in Task 1.
2. **A crossed stop outside regular hours (pre-market, after-hours, weekend).** Expected: the copy says the stop won't fire until the open. In regular hours it says to check the order. Pinned in Task 1.
3. **A position held but missing from `stopTiers` because it has no quote yet, while also listed as having no stop.** Expected: `NO_STOP` still appears; it does not depend on a price. Pinned in Task 1.
4. **Earnings on the Monday after a Friday, and earnings across a market holiday.** Expected: on a Friday, Monday earnings count as "before next session". The day before Thanksgiving, the following Friday counts. Pinned in Task 2.
5. **During regular hours, today's partial bar must not decide a thesis break.** Expected: in `PRE` and `REGULAR` the bar dated today is ignored, and in `POST`/`CLOSED`/`OVERNIGHT` it counts. Pinned in Task 2.

---

### Task 1: Pure queue — stops crossed, near stop, no stop, ordering

**Files:**
- Modify: `backend/src/market-data/daily-brief.ts`. Export the existing `priorAtr` (add `export` only).
- Create: `backend/src/market-data/brief-queue.ts`
- Test: `backend/src/market-data/brief-queue.spec.ts`

**Interfaces:**
- Consumes: `MarketSession` from `./market-session.js`.
- Produces (used by Tasks 2 and 3):
  ```ts
  export type QueueKind = 'STOP_CROSSED' | 'NEAR_STOP' | 'NO_STOP' | 'EARNINGS' | 'THESIS_BROKEN';
  export interface QueueItem { kind: QueueKind; symbol: string; title: string; detail: string }
  export interface QueueStopTier { symbol: string; stopPrice: number; currentPrice: number; distance: number; passed: boolean }
  export interface QueuePosition { symbol: string; marketValue: number | null; stale: boolean }
  export interface QueueThesis { symbol: string; direction: 'LONG' | 'SHORT'; reasons: string[]; entryDate: string; bars: RawBar[] }
  export interface QueueInput {
    now: Date;
    session: MarketSession;
    positions: QueuePosition[];
    stopTiers: QueueStopTier[];
    symbolsWithoutStop: readonly string[];
    atrBySymbol: ReadonlyMap<string, number>;
    earningsDateBySymbol: ReadonlyMap<string, string>;
    theses: QueueThesis[];
  }
  export function buildQueue(input: QueueInput): QueueItem[];
  ```
  Task 1 implements the stop items and ordering. It leaves `earningsDateBySymbol` and `theses` unread; Task 2 adds them to the same function.

- [ ] **Step 1: Write the failing test**

`backend/src/market-data/brief-queue.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/market-data/brief-queue.spec.ts`
Expected: FAIL. It cannot resolve `./brief-queue.js`.

- [ ] **Step 3: Implement**

In `backend/src/market-data/daily-brief.ts`, change `function priorAtr(` to `export function priorAtr(`.

`backend/src/market-data/brief-queue.ts`:

```ts
import type { RawBar } from './yahoo.client.js';
import type { MarketSession } from './market-session.js';

/**
 * The Brief's decision queue: what needs a decision today, most urgent
 * first. Pure — every input is something the app already computed
 * (stop-distance rows, the no-stop list, ATR, earnings dates, entry
 * reasons) — so the rules are fixture-tested and nothing here can disagree
 * with the Stops page about a stop. Missing data means no item, never a
 * guessed one.
 */

export type QueueKind = 'STOP_CROSSED' | 'NEAR_STOP' | 'NO_STOP' | 'EARNINGS' | 'THESIS_BROKEN';

export interface QueueItem {
  kind: QueueKind;
  symbol: string;
  title: string;
  detail: string;
}

/** The fields of a `StopDistanceRow` (portfolio/stop-distance.ts) the queue reads. */
export interface QueueStopTier {
  symbol: string;
  stopPrice: number;
  currentPrice: number;
  /** Signed fraction of price: positive is room, negative is already passed. */
  distance: number;
  passed: boolean;
}

export interface QueuePosition {
  symbol: string;
  marketValue: number | null;
  stale: boolean;
}

export interface QueueThesis {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  /** Entry reason codes from journal/reasons.ts, on the fill that opened the position. */
  reasons: string[];
  /** YYYY-MM-DD of the opening fill. */
  entryDate: string;
  bars: RawBar[];
}

export interface QueueInput {
  now: Date;
  session: MarketSession;
  positions: QueuePosition[];
  stopTiers: QueueStopTier[];
  symbolsWithoutStop: readonly string[];
  atrBySymbol: ReadonlyMap<string, number>;
  earningsDateBySymbol: ReadonlyMap<string, string>;
  theses: QueueThesis[];
}

const PRIORITY: Record<QueueKind, number> = {
  STOP_CROSSED: 0,
  NEAR_STOP: 1,
  NO_STOP: 2,
  EARNINGS: 3,
  THESIS_BROKEN: 4,
};

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function percent(fraction: number): string {
  return `${(Math.abs(fraction) * 100).toFixed(1)}%`;
}

function stopItems(input: QueueInput, held: ReadonlyMap<string, QueuePosition>): QueueItem[] {
  const tiersBySymbol = new Map<string, QueueStopTier[]>();
  for (const t of input.stopTiers) {
    if (!held.has(t.symbol)) continue;
    tiersBySymbol.set(t.symbol, [...(tiersBySymbol.get(t.symbol) ?? []), t]);
  }

  const items: QueueItem[] = [];
  for (const [symbol, tiers] of tiersBySymbol) {
    const crossed = tiers.filter((t) => t.passed);
    if (crossed.length > 0) {
      // Of the crossed tiers, the one price is closest to: the level that
      // was hit most recently, which is the one he would check first.
      const t = crossed.reduce((a, b) => (b.distance > a.distance ? b : a));
      items.push({
        kind: 'STOP_CROSSED',
        symbol,
        title: `${symbol} is through its stop at ${money(t.stopPrice)}`,
        detail:
          input.session === 'REGULAR'
            ? `Last ${money(t.currentPrice)}. If the stop has not filled, act on it now.`
            // Stops do not fire outside regular hours; a gap past one
            // fills at the open, not at the stop.
            : `Last ${money(t.currentPrice)} outside regular hours. The stop will not fire until the open.`,
      });
      continue; // A crossed stop is not also "near".
    }

    const atr = input.atrBySymbol.get(symbol);
    if (atr === undefined || !(atr > 0)) continue;
    const nearest = tiers.reduce((a, b) => (b.distance < a.distance ? b : a));
    const room = nearest.distance * nearest.currentPrice;
    if (room <= atr) {
      items.push({
        kind: 'NEAR_STOP',
        symbol,
        title: `${symbol} is within 1 ATR of its stop`,
        detail: `Stop ${money(nearest.stopPrice)}, last ${money(nearest.currentPrice)}: ${(room / atr).toFixed(1)} ATR (${percent(nearest.distance)}) away.`,
      });
    }
  }
  return items;
}

function noStopItems(input: QueueInput, held: ReadonlyMap<string, QueuePosition>): QueueItem[] {
  return input.symbolsWithoutStop
    .filter((symbol) => held.has(symbol))
    .map((symbol) => ({
      kind: 'NO_STOP' as const,
      symbol,
      title: `${symbol} has no stop`,
      detail: 'Nothing limits the loss on this position.',
    }));
}

export function buildQueue(input: QueueInput): QueueItem[] {
  const held = new Map(input.positions.map((p) => [p.symbol, p]));
  const items = [...stopItems(input, held), ...noStopItems(input, held)];

  for (const item of items) {
    if (held.get(item.symbol)?.stale) item.detail = `${item.detail} Quote is stale.`;
  }

  const size = (symbol: string) => Math.abs(held.get(symbol)?.marketValue ?? 0);
  return items.sort(
    (a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || size(b.symbol) - size(a.symbol),
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/market-data/brief-queue.spec.ts src/market-data/daily-brief.spec.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, and tsc prints nothing.

- [ ] **Step 5: Commit**

```bash
git add backend/src/market-data/brief-queue.ts backend/src/market-data/brief-queue.spec.ts backend/src/market-data/daily-brief.ts
git commit -m "feat(brief): decision queue — stops crossed, near stop, no stop"
```

---

### Task 2: Pure queue — earnings before next session, broken thesis

**Files:**
- Modify: `backend/src/market-data/brief-queue.ts`
- Test: `backend/src/market-data/brief-queue.spec.ts` (append)

**Interfaces:**
- Consumes: `marketDate(now: Date): string` from `./trading-day.js`; `isUsMarketHoliday(date: string): boolean` from `./market-session.js`; `sma(values: number[], period: number): number | null` from `./daily-brief.js` (already exported in slice 1).
- Produces: `export function nextTradingDate(date: string): string`, plus EARNINGS and THESIS_BROKEN items from `buildQueue`.

- [ ] **Step 1: Write the failing tests**

Append to `brief-queue.spec.ts`. Add `nextTradingDate` and `type QueueThesis` to the import from `./brief-queue.js`, and `import type { RawBar } from './yahoo.client.js';`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/market-data/brief-queue.spec.ts`
Expected: FAIL, because `nextTradingDate` is not exported and no EARNINGS or THESIS_BROKEN items are produced.

- [ ] **Step 3: Implement**

In `brief-queue.ts`, add these imports:

```ts
import { isUsMarketHoliday } from './market-session.js';
import { marketDate } from './trading-day.js';
import { sma } from './daily-brief.js';
```

Add these functions:

```ts
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** The first exchange session after `date` (YYYY-MM-DD), skipping weekends and full-closure holidays. */
export function nextTradingDate(date: string): string {
  let next = addDays(date, 1);
  while (isWeekend(next) || isUsMarketHoliday(next)) next = addDays(next, 1);
  return next;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function whenLabel(date: string, today: string): string {
  if (date === today) return 'today';
  if (date === addDays(today, 1)) return 'tomorrow';
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

function stopStatus(tiers: QueueStopTier[], noStop: boolean): string {
  if (noStop) return 'No stop.';
  if (tiers.length === 0) return 'Stop distance unknown.';
  if (tiers.some((t) => t.passed)) return 'Stop already crossed.';
  const nearest = tiers.reduce((a, b) => (b.distance < a.distance ? b : a));
  return `Nearest stop ${percent(nearest.distance)} away.`;
}

function earningsItems(input: QueueInput, held: ReadonlyMap<string, QueuePosition>): QueueItem[] {
  const today = marketDate(input.now);
  const next = nextTradingDate(today);
  const items: QueueItem[] = [];
  for (const symbol of held.keys()) {
    const date = input.earningsDateBySymbol.get(symbol);
    if (!date || date < today || date > next) continue;
    items.push({
      kind: 'EARNINGS',
      symbol,
      title: `${symbol} reports ${whenLabel(date, today)}`,
      detail: `Earnings before the next session. ${stopStatus(
        input.stopTiers.filter((t) => t.symbol === symbol),
        input.symbolsWithoutStop.includes(symbol),
      )}`,
    });
  }
  return items;
}

const BREAKOUT_LOOKBACK = 20;
const SMA_PERIOD = 150;

/**
 * Bars that are a finished session. In PRE and REGULAR, a bar dated today
 * is Yahoo's partial bar for a session still in progress (or not begun),
 * and a thesis should not break on a print that may not hold to the close.
 */
function completedBars(bars: RawBar[], session: MarketSession, today: string): RawBar[] {
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  return session === 'PRE' || session === 'REGULAR'
    ? sorted.filter((bar) => bar.date < today)
    : sorted;
}

function thesisItem(thesis: QueueThesis, session: MarketSession, today: string): QueueItem | null {
  const bars = completedBars(thesis.bars, session, today);
  const last = bars.at(-1);
  if (!last) return null;
  const long = thesis.direction === 'LONG';
  const { symbol } = thesis;

  if (thesis.reasons.includes('ENTRY_SMA_150')) {
    const average = sma(bars.map((bar) => bar.close), SMA_PERIOD);
    if (average !== null && (long ? last.close < average : last.close > average)) {
      return {
        kind: 'THESIS_BROKEN',
        symbol,
        title: `${symbol} closed ${long ? 'below' : 'above'} its 150 SMA`,
        detail: `You entered on the 150 SMA. Close ${money(last.close)}, SMA ${money(average)}.`,
      };
    }
  }

  if (thesis.reasons.includes('ENTRY_BREAKOUT')) {
    const before = bars.filter((bar) => bar.date < thesis.entryDate).slice(-BREAKOUT_LOOKBACK);
    if (before.length === BREAKOUT_LOOKBACK) {
      const level = long
        ? Math.max(...before.map((bar) => bar.high ?? bar.close))
        : Math.min(...before.map((bar) => bar.low ?? bar.close));
      if (long ? last.close < level : last.close > level) {
        return {
          kind: 'THESIS_BROKEN',
          symbol,
          title: long
            ? `${symbol} closed back under its breakout level`
            : `${symbol} closed back above its breakdown level`,
          detail: long
            ? `You entered on a breakout over ${money(level)}. Last close ${money(last.close)}.`
            : `You entered on a breakdown under ${money(level)}. Last close ${money(last.close)}.`,
        };
      }
    }
  }
  return null;
}
```

In `buildQueue`, extend the list of items:

```ts
  const today = marketDate(input.now);
  const items = [
    ...stopItems(input, held),
    ...noStopItems(input, held),
    ...earningsItems(input, held),
    ...input.theses
      .filter((t) => held.has(t.symbol))
      .map((t) => thesisItem(t, input.session, today))
      .filter((item): item is QueueItem => item !== null),
  ];
```

Remove the now-duplicate `const today` inside `earningsItems` if you hoist it. Either is fine, but keep one source.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/market-data/brief-queue.spec.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, and tsc prints nothing.

- [ ] **Step 5: Commit**

```bash
git add backend/src/market-data/brief-queue.ts backend/src/market-data/brief-queue.spec.ts
git commit -m "feat(brief): decision queue — earnings before the next session, broken entry thesis"
```

---

### Task 3: Wire the queue into the service, the response and the AI facts

**Files:**
- Modify: `backend/src/portfolio/trades.service.ts`. Add `openTradeEntries()`.
- Test: `backend/src/portfolio/trades.service.open-entries.spec.ts` (new)
- Modify: `backend/src/market-data/daily-brief.service.ts`
- Modify: `backend/src/market-data/daily-brief.service.spec.ts`
- Modify: `backend/src/llm/daily-brief-context.ts`
- Modify: `backend/src/llm/daily-brief-context.spec.ts`

**Interfaces:**
- Consumes: `buildQueue`, `QueueItem` (Tasks 1–2); `priorAtr(bars: RawBar[]): number | null` from `daily-brief.ts`; `PortfolioService.getPortfolio()`, which already returns `stopTiers`, `atRisk.positionsWithoutStop.symbols`, and per position `marketValue` and `stale`.
- Produces:
  ```ts
  // TradesService
  async openTradeEntries(): Promise<Array<{ symbol: string; direction: 'LONG' | 'SHORT'; enteredAt: Date; reasons: string[] }>>;
  // DailyBriefResponse gains
  queue: QueueItem[];
  // HoldingNote.kind loses 'EARNINGS' (earnings now live in the queue)
  // DailyBriefContextInput gains
  queue: ContextLine[];
  ```

- [ ] **Step 1: TradesService.openTradeEntries — failing test**

`backend/src/portfolio/trades.service.open-entries.spec.ts`. The constructor order is: txns, stopLevels, stopExecutions, entries, tags, entryTags, instruments, closes, marketData, users, journal.

```ts
import { describe, expect, it, vi } from 'vitest';
import { In } from 'typeorm';
import { TradesService } from './trades.service.js';

function build(trades: unknown[], entries: unknown[]) {
  const find = vi.fn().mockResolvedValue(entries);
  const svc = new TradesService(
    {} as never, {} as never, {} as never,
    { find } as never,
    {} as never, {} as never, {} as never, {} as never, {} as never,
    { currentUser: async () => ({ id: 'user-1' }) } as never,
    {} as never,
  );
  vi.spyOn(svc, 'deriveAllTrades').mockResolvedValue(trades as never);
  return { svc, find };
}

const ENTERED = new Date('2026-09-28T14:00:00Z');

describe('TradesService.openTradeEntries', () => {
  it('returns each open trade with the reasons on its opening fill\'s entry', async () => {
    const { svc } = build(
      [
        { symbol: 'NVDA', direction: 'LONG', enteredAt: ENTERED, isOpen: true, fills: [{ entryId: 'e1' }, { entryId: 'e2' }] },
        { symbol: 'OLD', direction: 'LONG', enteredAt: ENTERED, isOpen: false, fills: [{ entryId: 'e3' }] },
      ],
      [{ id: 'e1', reasons: ['ENTRY_BREAKOUT'] }],
    );
    await expect(svc.openTradeEntries()).resolves.toEqual([
      { symbol: 'NVDA', direction: 'LONG', enteredAt: ENTERED, reasons: ['ENTRY_BREAKOUT'] },
    ]);
  });

  it('reads journal entries for the current user only', async () => {
    const { svc, find } = build(
      [{ symbol: 'NVDA', direction: 'SHORT', enteredAt: ENTERED, isOpen: true, fills: [{ entryId: 'e1' }] }],
      [],
    );
    await svc.openTradeEntries();
    expect(find).toHaveBeenCalledWith({ where: { userId: 'user-1', id: In(['e1']) } });
  });

  it('gives no reasons, without a query, when no opening fill names an entry', async () => {
    const { svc, find } = build(
      [{ symbol: 'NVDA', direction: 'LONG', enteredAt: ENTERED, isOpen: true, fills: [{}] }],
      [],
    );
    await expect(svc.openTradeEntries()).resolves.toEqual([
      { symbol: 'NVDA', direction: 'LONG', enteredAt: ENTERED, reasons: [] },
    ]);
    expect(find).not.toHaveBeenCalled();
  });
});
```

Run: `cd backend && npx vitest run src/portfolio/trades.service.open-entries.spec.ts`
Expected: FAIL, because `openTradeEntries` is not a function.

- [ ] **Step 2: Implement openTradeEntries**

In `trades.service.ts`, add `In` to the `typeorm` import and add this method after `deriveAllTrades`:

```ts
  /**
   * Each open trade with the entry reasons recorded on its OPENING fill's
   * journal entry — what the Brief's thesis check reads. Fills are in
   * execution order, so the first is the one that opened the position;
   * later adds may carry their own reasons, but the thesis is the opening
   * one.
   */
  async openTradeEntries(): Promise<
    Array<{ symbol: string; direction: 'LONG' | 'SHORT'; enteredAt: Date; reasons: string[] }>
  > {
    const user = await this.users.currentUser();
    const open = (await this.deriveAllTrades()).filter((t) => t.isOpen);
    const entryIds = [
      ...new Set(open.map((t) => t.fills[0]?.entryId).filter((id): id is string => !!id)),
    ];
    const entries =
      entryIds.length === 0
        ? []
        : await this.entries.find({ where: { userId: user.id, id: In(entryIds) } });
    const reasonsById = new Map(entries.map((e) => [e.id, e.reasons]));
    return open.map((t) => ({
      symbol: t.symbol,
      direction: t.direction,
      enteredAt: t.enteredAt,
      reasons: reasonsById.get(t.fills[0]?.entryId ?? '') ?? [],
    }));
  }
```

Run the test again. Expected: PASS.

- [ ] **Step 3: AI facts — failing test**

In `backend/src/llm/daily-brief-context.spec.ts`, add `queue: []` to the `input()` helper defaults, then add:

```ts
  it('lists what needs attention verbatim, first among the per-name sections', () => {
    const facts = buildDailyBriefContext(input({
      queue: [{ title: 'NVDA is through its stop at $95.00', detail: 'Last $93.00. If the stop has not filled, act on it now.' }],
      holdingNotes: [{ title: 'MSFT has good momentum', detail: 'd' }],
    }));
    expect(facts).toContain('Needs attention\n- NVDA is through its stop at $95.00: Last $93.00. If the stop has not filled, act on it now.');
    expect(facts.indexOf('Needs attention')).toBeLessThan(facts.indexOf('Your holdings'));
  });

  it('says plainly when nothing needs attention', () => {
    expect(buildDailyBriefContext(input())).toContain('- Nothing needs a decision today.');
  });
```

Run: `cd backend && npx vitest run src/llm/daily-brief-context.spec.ts`. Expected: FAIL.

- [ ] **Step 4: Implement the facts section**

In `daily-brief-context.ts`:
- Add `queue: ContextLine[];` to `DailyBriefContextInput`.
- In `buildDailyBriefContext`, insert this line right after the economic-events section and before `Your holdings`:
  ```ts
      ...section('Needs attention', input.queue, 'Nothing needs a decision today.'),
  ```

Run the context and prompt specs. Expected: PASS. `daily-brief.service.ts` will not type-check until Step 6; that is expected.

- [ ] **Step 5: Service — failing tests**

In `backend/src/market-data/daily-brief.service.spec.ts`:

1. Extend the `deps()` helper's portfolio mock so that `getPortfolio` resolves `{ positions, atRisk, stopTiers: over.stopTiers ?? [] }`. Add `stopTiers?: unknown[]` to its options.
2. Add this helper:
   ```ts
   function tradesStub(entries: unknown[] = []) {
     return { openTradeEntries: vi.fn().mockResolvedValue(entries) } as any;
   }
   ```
   The service's constructor gains a trailing optional `trades` param after `marketData`. Tests that pass it call `new DailyBriefService(...deps({...}), undefined, undefined, undefined, tradesStub(...))`.
3. Add these tests:

```ts
  describe('the decision queue', () => {
    const position = (symbol: string, over: object = {}) => ({
      symbol, price: 93, regularPrice: 93, stale: false, session: 'REGULAR', extended: false,
      daysUntilEarnings: null, marketValue: 9_300, ...over,
    });

    it('serves a crossed stop from the portfolio\'s own stop rows', async () => {
      const service = new DailyBriefService(...deps({
        positions: [position('NVDA')],
        stopTiers: [{ symbol: 'NVDA', stopPrice: 95, currentPrice: 93, distance: -0.0215, passed: true, quantity: 100 }],
      }));
      const result = await service.get({ now: new Date('2026-10-07T15:00:00Z') });
      expect(result.queue).toEqual([expect.objectContaining({ kind: 'STOP_CROSSED', symbol: 'NVDA' })]);
    });

    it('lists a held position with no stop', async () => {
      const service = new DailyBriefService(...deps({
        positions: [position('PLTR')],
        atRisk: { positionsWithoutStop: { count: 1, symbols: ['PLTR'] } },
      }));
      const result = await service.get({ now: new Date('2026-10-07T15:00:00Z') });
      expect(result.queue).toEqual([expect.objectContaining({ kind: 'NO_STOP', symbol: 'PLTR' })]);
    });

    it('reads the earnings date from the instrument and moves earnings out of holding notes', async () => {
      const service = new DailyBriefService(...deps({
        positions: [position('NVDA', { daysUntilEarnings: 1 })],
        instruments: [{ id: 'i-nvda', symbol: 'NVDA', nextEarningsDate: '2026-10-08' }],
      }));
      const result = await service.get({ now: new Date('2026-10-07T15:00:00Z') });
      expect(result.queue).toEqual([expect.objectContaining({ kind: 'EARNINGS', symbol: 'NVDA', title: 'NVDA reports tomorrow' })]);
      expect(result.holdingNotes.some((n) => (n.kind as string) === 'EARNINGS')).toBe(false);
    });

    it('checks the thesis from the opening entry\'s reasons and the symbol\'s bars', async () => {
      const bars = Array.from({ length: 160 }, (_, i) => {
        const date = new Date(Date.UTC(2026, 4, 1) + i * 86_400_000).toISOString().slice(0, 10);
        const close = i === 159 ? 90 : 100;
        return { instrumentId: 'i-nvda', date, close, adjClose: close, open: close, high: close + 1, low: close - 1, volume: 1_000_000 };
      });
      const service = new DailyBriefService(
        ...deps({ positions: [position('NVDA', { price: 90 })], instruments: [{ id: 'i-nvda', symbol: 'NVDA' }], bars }),
        undefined, undefined, undefined,
        tradesStub([{ symbol: 'NVDA', direction: 'LONG', enteredAt: new Date('2026-06-01T14:00:00Z'), reasons: ['ENTRY_SMA_150'] }]),
      );
      // After the close on the last bar's date, so that bar is a completed session.
      const result = await service.get({ now: new Date(`${bars.at(-1)!.date}T22:00:00Z`) });
      expect(result.queue).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'THESIS_BROKEN', symbol: 'NVDA' })]));
    });

    it('still serves the brief, without thesis items, when the trades read fails', async () => {
      const trades = { openTradeEntries: vi.fn().mockRejectedValue(new Error('db down')) } as any;
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      try {
        const service = new DailyBriefService(...deps({ positions: [position('NVDA')] }), undefined, undefined, undefined, trades);
        await expect(service.get()).resolves.toMatchObject({ queue: [] });
        expect(warn).toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it('hands the queue to the AI and re-asks when it changes', async () => {
      const complete = vi.fn().mockResolvedValue('Act on NVDA.');
      const llm = { isConfigured: () => true, complete } as any;
      const portfolio = { getPortfolio: vi.fn() };
      portfolio.getPortfolio.mockResolvedValueOnce({ positions: [position('PLTR')], atRisk: { positionsWithoutStop: { count: 1, symbols: ['PLTR'] } }, stopTiers: [] });
      portfolio.getPortfolio.mockResolvedValueOnce({ positions: [position('PLTR')], atRisk: { positionsWithoutStop: { count: 0, symbols: [] } }, stopTiers: [] });
      const [, ...rest] = deps();
      const service = new DailyBriefService(portfolio as any, ...rest, llm);

      await service.get({ now: new Date('2026-10-07T15:00:00Z') });
      expect(complete.mock.calls[0][0].user).toContain('Needs attention\n- PLTR has no stop');
      await service.get({ now: new Date('2026-10-07T15:05:00Z') });
      expect(complete).toHaveBeenCalledTimes(2);
    });
  });
```

The `Logger` import comes from `@nestjs/common`. If the spec already imports it from Slice 1's fix round, reuse that import. If `deps()` already returns more than six items, adjust the `[, ...rest]` destructure so the portfolio mock replaces the first element. Update any existing test that asserted an `EARNINGS` holding note: the "earnings ordered ahead of momentum" test is deleted, because earnings no longer live in `holdingNotes`.

Run: `cd backend && npx vitest run src/market-data/daily-brief.service.spec.ts`. Expected: FAIL.

- [ ] **Step 6: Implement the service wiring**

In `backend/src/market-data/daily-brief.service.ts`:

1. Add these imports:
   ```ts
   import { TradesService } from '../portfolio/trades.service.js';
   import { buildQueue, type QueueItem } from './brief-queue.js';
   ```
   Add `priorAtr` to the existing import from `./daily-brief.js`.
2. Response types:
   - Add `queue: QueueItem[];` to `DailyBriefResponse`, placed after `mood`/`events`.
   - Change `HoldingNote['kind']` to `'ATR_MOVE' | 'MOMENTUM' | 'BREAKOUT'` and remove `EARNINGS` from `HOLDING_NOTE_PRIORITY`.
   - Add `queue: QueueItem[];` to `BriefFacts`.
3. Constructor: append `private readonly trades?: TradesService,` after `marketData`. Nest injects it by type, because `PortfolioModule`, which `WatchlistModule` already imports, exports `TradesService`.
4. In `get()`, run `this.openTradeEntries()` in parallel inside the existing `Promise.all`. Add this private method:
   ```ts
   /** Never throws: thesis checks are an extra, not something the brief depends on. */
   private async openTradeEntries(): Promise<Awaited<ReturnType<TradesService['openTradeEntries']>>> {
     if (!this.trades) return [];
     try {
       return await this.trades.openTradeEntries();
     } catch (err) {
       this.logger.warn(`daily brief thesis read failed: ${err instanceof Error ? err.message : String(err)}`);
       return [];
     }
   }
   ```
5. Delete the block that pushes `EARNINGS` holding notes.
6. After `const session = computeMarketSession(now);`, build the queue:
   ```ts
   const queue = buildQueue({
     now,
     session,
     positions: portfolio.positions.map((p: { symbol: string; marketValue: number | null; stale: boolean }) => ({
       symbol: p.symbol, marketValue: p.marketValue ?? null, stale: p.stale,
     })),
     stopTiers: portfolio.stopTiers ?? [],
     symbolsWithoutStop: portfolio.atRisk?.positionsWithoutStop?.symbols ?? [],
     atrBySymbol: new Map(
       [...held].flatMap((symbol) => {
         const atr = priorAtr(barsFor(symbol));
         return atr === null ? [] : [[symbol, atr] as const];
       }),
     ),
     earningsDateBySymbol: new Map(
       [...held].flatMap((symbol) => {
         const date = instrumentBySymbol.get(symbol)?.nextEarningsDate;
         return date ? [[symbol, date] as const] : [];
       }),
     ),
     theses: openEntries
       .filter((entry) => held.has(entry.symbol))
       .map((entry) => ({
         symbol: entry.symbol,
         direction: entry.direction,
         reasons: entry.reasons,
         entryDate: entry.enteredAt.toISOString().slice(0, 10),
         bars: barsFor(entry.symbol),
       })),
   });
   ```
   `barsFor` returns `DailyClose` rows, which are structurally compatible with `RawBar`, the same as the existing `buildDailyBriefNotes` calls.
7. Pass `queue` into `buildNarrative` facts and into the returned object.
8. In `buildNarrative`'s cache signature, add `queue: facts.queue.map((q) => [q.kind, q.symbol]),`.

Run: `cd backend && npx vitest run src/market-data src/llm src/portfolio && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, and tsc prints nothing.

- [ ] **Step 7: Backend e2e**

Run: `npm run test:e2e --prefix backend`
Expected: PASS. If a spec asserted an `EARNINGS` holding note on the brief, update it to read `queue` and say so in your report.

- [ ] **Step 8: Commit**

```bash
git add backend/src/portfolio/trades.service.ts backend/src/portfolio/trades.service.open-entries.spec.ts backend/src/market-data/daily-brief.service.ts backend/src/market-data/daily-brief.service.spec.ts backend/src/llm/daily-brief-context.ts backend/src/llm/daily-brief-context.spec.ts
git commit -m "feat(brief): serve the decision queue and hand it to the AI"
```

---

### Task 4: Frontend — the "Needs attention" section

**Files:**
- Modify: `frontend/src/api/dailyBrief.ts`
- Modify: `frontend/src/components/brief/BriefNoteList.tsx`
- Modify: `frontend/src/routes/Brief.tsx`
- Modify: `frontend/src/routes/Brief.spec.tsx`

**Interfaces:**
- Consumes: `queue: { kind: string; symbol: string; title: string; detail: string }[]` on the response, which has the same shape as `BriefLine`.
- Produces: `BriefNoteList` gains an optional `empty?: string` prop. When `notes` is empty and `empty` is given, it renders the section heading with that line instead of nothing.

- [ ] **Step 1: Write the failing tests**

In `Brief.spec.tsx`, add `queue: []` to `initialBrief`, then add:

```ts
it('puts what needs a decision in its own section, each item linking to the holding', async () => {
  (api as ReturnType<typeof vi.fn>).mockResolvedValue({
    ...initialBrief,
    queue: [
      { kind: 'STOP_CROSSED', symbol: 'NVDA', title: 'NVDA is through its stop at $95.00', detail: 'Last $93.00. If the stop has not filled, act on it now.' },
      { kind: 'NO_STOP', symbol: 'PLTR', title: 'PLTR has no stop', detail: 'Nothing limits the loss on this position.' },
    ],
  });
  renderBrief();
  const section = await screen.findByRole('region', { name: 'Needs attention' });
  const links = within(section).getAllByRole('link');
  expect(links.map((l) => l.getAttribute('href'))).toEqual(['/?symbol=NVDA', '/?symbol=PLTR']);
  expect(links[0]).toHaveTextContent('NVDA is through its stop at $95.00');
});

it('says when nothing needs a decision, rather than hiding the section', async () => {
  (api as ReturnType<typeof vi.fn>).mockResolvedValue(initialBrief);
  renderBrief();
  const section = await screen.findByRole('region', { name: 'Needs attention' });
  expect(section).toHaveTextContent('Nothing needs a decision today.');
});

it('shows the queue after the market line and before holdings', async () => {
  (api as ReturnType<typeof vi.fn>).mockResolvedValue(initialBrief);
  renderBrief();
  const queue = await screen.findByRole('region', { name: 'Needs attention' });
  const market = screen.getByRole('region', { name: 'Market' });
  const holdings = screen.getByRole('region', { name: 'Holdings' });
  expect(market.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(queue.compareDocumentPosition(holdings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
```

Run: `cd frontend && npx vitest run src/routes/Brief.spec.tsx`. Expected: FAIL.

- [ ] **Step 2: Implement**

- In `frontend/src/api/dailyBrief.ts`, add `queue: BriefLine[];` to `BriefResponse`.
- In `BriefNoteList.tsx`, add `empty?: string` to the props. Change the early return to:
  ```tsx
  if (notes.length === 0 && !empty) return null;
  ```
  When `notes` is empty, render `<p className="text-sm text-muted">{empty}</p>` under the heading instead of the links.
- In `Brief.tsx`, insert this directly after `<MoodLine … />`:
  ```tsx
  <BriefNoteList label="Needs attention" notes={brief.queue} destination={holdingDestination} empty="Nothing needs a decision today." />
  ```
  The empty-state wording is the spec's own text, so it is display copy rather than business logic. The existing "No holding or watch signals right now." line stays as it is.

- [ ] **Step 3: Run the tests and type-check**

Run: `cd frontend && npx vitest run src/routes/Brief.spec.tsx && npx tsc -b && cd .. && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/dailyBrief.ts frontend/src/components/brief/BriefNoteList.tsx frontend/src/routes/Brief.tsx frontend/src/routes/Brief.spec.tsx
git commit -m "feat(brief): needs-attention section for the decision queue"
```

---

### Task 5: Browser test

**Files:**
- Modify: `e2e/navigation.spec.ts`

- [ ] **Step 1: Add the test**

Next to the existing Brief tests, add the test below. It follows the existing holding-fixture test's pattern of logging a trade through `/api/journal`.

```ts
test('Brief lists a new position with no stop under Needs attention', async ({ page }) => {
  const status = await page.evaluate(async () => {
    const token = localStorage.getItem('trader.authToken.v1');
    return fetch('/api/journal', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        kind: 'TRADE', body: 'queue fixture', occurredAt: new Date().toISOString(),
        trade: { symbol: 'NVDA', quantity: 1, price: 100, fee: 0 },
      }),
    }).then((r) => r.status);
  });
  expect(status).toBe(201);
  await page.goto('/brief');
  const section = page.getByRole('region', { name: 'Needs attention' });
  await expect(section).toContainText('NVDA has no stop');
  await section.getByRole('link', { name: /NVDA has no stop/ }).click();
  await expect(page).toHaveURL(/\/\?symbol=NVDA$/);
});
```

- [ ] **Step 2: Run the suites**

Run `npm run test:browser`, then `npm test`, from the repo root.
Expected: all browser tests pass (19), and the unit suites pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/navigation.spec.ts
git commit -m "test(brief): browser check that a stopless position reaches Needs attention"
```
