# Brief Redesign — Slice 1 (Clean-up + Market Mood) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Brief's repeated price-card "coverage" and source grouping, and add a one-line market mood (SPY/QQQ trend and change, VIX, leading/lagging sector) with this week's economic events under it. Watch-list signals become "watch triggers": only a breakout, or momentum on its first day.

**Architecture:** A new pure module `backend/src/market-data/brief-mood.ts` computes the mood from quotes and SPY/QQQ bars. `DailyBriefService` fetches the mood quotes through `MarketDataService`, and its response drops `coverage`/`notes` for `mood`, `events`, `holdingNotes` and `watchTriggers`. The AI facts block is rewritten for that shape. `frontend/src/routes/Brief.tsx` becomes display-only over the new response, using two small components.

**Tech Stack:** NestJS + TypeORM backend, React + TanStack Query + Tailwind frontend, Vitest (unit), Playwright (iPhone-WebKit browser suite).

**Spec:** `docs/superpowers/specs/2026-10-06-brief-redesign-design.md`. This plan is delivery slice 1 of 4.

## Global Constraints

- Read `AGENTS.md` first. Its invariants apply to every task.
- The frontend displays; the backend computes. No trend rule, threshold, sector name or business wording is defined in `frontend/`. Formatting numbers for display is fine.
- Only `backend/src/market-data/yahoo.client.ts` imports Yahoo. The Brief reaches quotes through `MarketDataService.getQuotes`, never `YahooClient`.
- Tests must not call Yahoo, an LLM or any external service. Stub every provider.
- Never touch the real `trader` database destructively. The manual check in Task 6 is read-only.
- Never show a stale price as fresh: a stale index or VIX quote is labelled `STALE`, and a stale sector quote is left out of the leader/laggard ranking.
- Percent values on the wire are fractions (0.004 means +0.40%), the same convention as `unrealizedPct`. The frontend's `formatPercent` multiplies by 100.
- Mood quotes call `getQuotes(symbols, refresh, false)`. `augment: false` leaves Twelve Data's free budget to positions and stops (see the doc comment on `MarketDataService.getQuotes`).
- **Interim field:** `holdingNotes` (the per-holding signal and earnings notes) stays only until the decision queue (slice 2) and movers (slice 3) replace it. Keep it simple; do not polish it.
- Commit style: `feat(brief): ...` / `test(brief): ...`. End every commit message with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01KSLpjvWMhkHqfbWoTYBnE1
  ```
  Commit locally on `main`. Do not push.

## Review Focus

1. **`^VIX` comes back missing.** The quote fallback can't resolve it, or the provider omits it. Expected: `vix: null` and the rest of the line still renders. Pinned in Task 1 (pure) and Task 4 (service).
2. **Flat day, or the test stub, where every sector has the same change.** Expected: no "Leading X / Lagging X" pair naming the same number. Leader and laggard are both null when the best equals the worst. Pinned in Task 1.
3. **`getQuotes` throws.** Expected: the brief is still served with an empty mood, and the page says "Market mood unavailable right now." instead of erroring. Pinned in Task 4 (service) and Task 5 (page).
4. **A ticker that is both held and watched.** Expected: it never appears as a watch trigger, only under holdings. Pinned in Task 4.
5. **Stale index quote, e.g. a weekend or a provider outage.** Expected: the index stays on the line, labelled `STALE`. Pinned in Task 5.

---

### Task 1: Pure market-mood module

**Files:**
- Modify: `backend/src/market-data/daily-brief.ts`: export the existing `ema`, `sma` and `fiveDayEmaAgo` helpers (add `export`; no behaviour change)
- Create: `backend/src/market-data/brief-mood.ts`
- Test: `backend/src/market-data/brief-mood.spec.ts`

**Interfaces:**
- Consumes: `ema(values: number[], period: number): number | null`, `sma(values: number[], period: number): number | null`, `fiveDayEmaAgo(bars: RawBar[]): number | null` from `daily-brief.ts` (bars sorted ascending by date).
- Produces (used by Tasks 3, 4 and, as wire types, 5):
  ```ts
  export type MoodIndex = 'SPY' | 'QQQ';
  export const MOOD_INDICES: readonly MoodIndex[];
  export const VIX_SYMBOL = '^VIX';
  export const SECTOR_ETFS: Readonly<Record<string, string>>;
  export const MOOD_QUOTE_SYMBOLS: readonly string[];
  export type Trend = 'uptrend' | 'downtrend' | 'mixed';
  export interface MoodQuote { price: number; previousClose: number | null; stale: boolean; extended: boolean }
  export interface MoodInput { quotes: ReadonlyMap<string, MoodQuote>; indexBars: Readonly<Record<MoodIndex, RawBar[]>> }
  export interface MoodSector { symbol: string; name: string; changePct: number }
  export interface MoodIndexRow { symbol: MoodIndex; trend: Trend | null; changePct: number | null; stale: boolean; extended: boolean }
  export interface Mood { indices: MoodIndexRow[]; vix: { level: number; change: number | null; stale: boolean } | null; leader: MoodSector | null; laggard: MoodSector | null }
  export function trendOf(bars: RawBar[], price: number): Trend | null;
  export function buildMood(input: MoodInput): Mood;
  export const EMPTY_MOOD: Mood;
  ```

- [ ] **Step 1: Write the failing test**

`backend/src/market-data/brief-mood.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { RawBar } from './yahoo.client.js';
import { buildMood, EMPTY_MOOD, trendOf, type MoodQuote } from './brief-mood.js';

function bars(closes: number[]): RawBar[] {
  return closes.map((close, i) => ({
    date: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    close, adjClose: close, open: close, high: close + 1, low: close - 1, volume: 1_000_000,
  }));
}
const rising = bars(Array.from({ length: 60 }, (_, i) => 100 + i));
const falling = bars(Array.from({ length: 60 }, (_, i) => 160 - i));
const flat = bars(Array.from({ length: 60 }, () => 100));

function quote(price: number, previousClose: number | null, over: Partial<MoodQuote> = {}): MoodQuote {
  return { price, previousClose, stale: false, extended: false, ...over };
}

describe('trendOf', () => {
  it('is an uptrend when price > EMA20 > SMA50 and EMA20 is rising', () => {
    expect(trendOf(rising, 160)).toBe('uptrend');
  });
  it('is a downtrend in the mirror case', () => {
    expect(trendOf(falling, 100)).toBe('downtrend');
  });
  it('is mixed when neither holds', () => {
    expect(trendOf(flat, 100)).toBe('mixed');
  });
  it('is null, never guessed, without enough history for a 50-day average', () => {
    expect(trendOf(rising.slice(0, 30), 160)).toBeNull();
  });
  it('sorts bars itself rather than trusting their order', () => {
    expect(trendOf([...rising].reverse(), 160)).toBe('uptrend');
  });
});

describe('buildMood', () => {
  it('reports each index with its trend and change since the prior close, as a fraction', () => {
    const mood = buildMood({
      quotes: new Map([
        ['SPY', quote(502, 500)],
        ['QQQ', quote(399, 400, { extended: true })],
      ]),
      indexBars: { SPY: rising, QQQ: flat },
    });
    expect(mood.indices).toEqual([
      { symbol: 'SPY', trend: 'uptrend', changePct: 0.004, stale: false, extended: false },
      { symbol: 'QQQ', trend: 'mixed', changePct: -0.0025, stale: false, extended: true },
    ]);
  });

  it('keeps a stale index on the line, marked stale', () => {
    const mood = buildMood({ quotes: new Map([['SPY', quote(500, 500, { stale: true })]]), indexBars: { SPY: rising, QQQ: [] } });
    expect(mood.indices).toEqual([expect.objectContaining({ symbol: 'SPY', stale: true })]);
  });

  it('omits an index with no quote rather than inventing one', () => {
    const mood = buildMood({ quotes: new Map(), indexBars: { SPY: rising, QQQ: rising } });
    expect(mood.indices).toEqual([]);
  });

  it('gives a null change when there is no prior close', () => {
    const mood = buildMood({ quotes: new Map([['SPY', quote(500, null)]]), indexBars: { SPY: rising, QQQ: [] } });
    expect(mood.indices[0].changePct).toBeNull();
  });

  it('reports VIX as a level and a point change', () => {
    const mood = buildMood({ quotes: new Map([['^VIX', quote(17.8, 16.7)]]), indexBars: { SPY: [], QQQ: [] } });
    expect(mood.vix?.level).toBe(17.8);
    expect(mood.vix?.change).toBeCloseTo(1.1, 10);
    expect(mood.vix?.stale).toBe(false);
  });

  it('is null for VIX when the provider returned no VIX quote', () => {
    expect(buildMood({ quotes: new Map(), indexBars: { SPY: [], QQQ: [] } }).vix).toBeNull();
  });

  it('names the best and worst sector by today\'s change, skipping stale quotes', () => {
    const mood = buildMood({
      quotes: new Map([
        ['XLE', quote(101.2, 100)],
        ['XLK', quote(99.1, 100)],
        ['XLF', quote(100.5, 100)],
        ['XLU', quote(110, 100, { stale: true })],
      ]),
      indexBars: { SPY: [], QQQ: [] },
    });
    expect(mood.leader?.symbol).toBe('XLE');
    expect(mood.leader?.name).toBe('Energy');
    expect(mood.leader?.changePct).toBeCloseTo(0.012, 10);
    expect(mood.laggard?.symbol).toBe('XLK');
    expect(mood.laggard?.name).toBe('Technology');
  });

  it('names no leader or laggard when every sector moved the same', () => {
    const mood = buildMood({
      quotes: new Map([['XLE', quote(102, 100)], ['XLK', quote(102, 100)]]),
      indexBars: { SPY: [], QQQ: [] },
    });
    expect(mood.leader).toBeNull();
    expect(mood.laggard).toBeNull();
  });

  it('names no leader or laggard with fewer than two usable sectors', () => {
    const mood = buildMood({ quotes: new Map([['XLE', quote(102, 100)]]), indexBars: { SPY: [], QQQ: [] } });
    expect(mood.leader).toBeNull();
    expect(mood.laggard).toBeNull();
  });

  it('EMPTY_MOOD is what no quotes at all produce', () => {
    expect(buildMood({ quotes: new Map(), indexBars: { SPY: [], QQQ: [] } })).toEqual(EMPTY_MOOD);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/market-data/brief-mood.spec.ts`
Expected: FAIL, cannot resolve `./brief-mood.js`.

- [ ] **Step 3: Export the helpers and write the module**

In `backend/src/market-data/daily-brief.ts`, change `function ema(`, `function sma(` and `function fiveDayEmaAgo(` to `export function ...`. Nothing else in that file changes in this task.

`backend/src/market-data/brief-mood.ts`:

```ts
import type { RawBar } from './yahoo.client.js';
import { ema, fiveDayEmaAgo, sma } from './daily-brief.js';

/**
 * The Brief's one-line read of the market's mood, before any single name:
 * a swing trader's morning starts with regime — are the indexes trending,
 * is fear rising, where is money rotating — and only then the book. Pure
 * and dependency-free; the service fetches the quotes and bars.
 */

export type MoodIndex = 'SPY' | 'QQQ';
export const MOOD_INDICES: readonly MoodIndex[] = ['SPY', 'QQQ'];
export const VIX_SYMBOL = '^VIX';

/** The 11 SPDR sector ETFs, with the name the screen shows for each. */
export const SECTOR_ETFS: Readonly<Record<string, string>> = {
  XLK: 'Technology',
  XLF: 'Financials',
  XLE: 'Energy',
  XLV: 'Health care',
  XLI: 'Industrials',
  XLY: 'Consumer discretionary',
  XLP: 'Consumer staples',
  XLU: 'Utilities',
  XLB: 'Materials',
  XLRE: 'Real estate',
  XLC: 'Communication services',
};

export const MOOD_QUOTE_SYMBOLS: readonly string[] = [
  ...MOOD_INDICES,
  VIX_SYMBOL,
  ...Object.keys(SECTOR_ETFS),
];

export type Trend = 'uptrend' | 'downtrend' | 'mixed';

export interface MoodQuote {
  price: number;
  previousClose: number | null;
  stale: boolean;
  extended: boolean;
}

export interface MoodInput {
  quotes: ReadonlyMap<string, MoodQuote>;
  indexBars: Readonly<Record<MoodIndex, RawBar[]>>;
}

export interface MoodSector {
  symbol: string;
  name: string;
  changePct: number;
}

export interface MoodIndexRow {
  symbol: MoodIndex;
  trend: Trend | null;
  changePct: number | null;
  stale: boolean;
  extended: boolean;
}

export interface Mood {
  indices: MoodIndexRow[];
  vix: { level: number; change: number | null; stale: boolean } | null;
  leader: MoodSector | null;
  laggard: MoodSector | null;
}

export const EMPTY_MOOD: Mood = { indices: [], vix: null, leader: null, laggard: null };

const TREND_PERIOD = 20;
const LONG_TREND_PERIOD = 50;

function changePct(quote: MoodQuote): number | null {
  return quote.previousClose !== null && quote.previousClose > 0
    ? (quote.price - quote.previousClose) / quote.previousClose
    : null;
}

/**
 * The same trend test the momentum rule uses, minus relative strength: an
 * index cannot outperform itself. Null without enough history — a trend
 * label from 30 bars would be a guess.
 */
export function trendOf(bars: RawBar[], price: number): Trend | null {
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const closes = sorted.map((bar) => bar.close);
  const ema20 = ema(closes, TREND_PERIOD);
  const sma50 = sma(closes, LONG_TREND_PERIOD);
  const ema20FiveDaysAgo = fiveDayEmaAgo(sorted);
  if (ema20 === null || sma50 === null || ema20FiveDaysAgo === null) return null;
  if (price > ema20 && ema20 > sma50 && ema20 > ema20FiveDaysAgo) return 'uptrend';
  if (price < ema20 && ema20 < sma50 && ema20 < ema20FiveDaysAgo) return 'downtrend';
  return 'mixed';
}

export function buildMood(input: MoodInput): Mood {
  const indices = MOOD_INDICES.flatMap((symbol): MoodIndexRow[] => {
    const quote = input.quotes.get(symbol);
    if (!quote) return [];
    return [{
      symbol,
      trend: trendOf(input.indexBars[symbol], quote.price),
      changePct: changePct(quote),
      stale: quote.stale,
      extended: quote.extended,
    }];
  });

  const vixQuote = input.quotes.get(VIX_SYMBOL);
  const vix = vixQuote
    ? {
        level: vixQuote.price,
        change: vixQuote.previousClose !== null ? vixQuote.price - vixQuote.previousClose : null,
        stale: vixQuote.stale,
      }
    : null;

  // A stale sector quote is yesterday's move; ranking it against today's
  // would name a "leader" that is not leading anything today.
  const sectors = Object.entries(SECTOR_ETFS)
    .flatMap(([symbol, name]): MoodSector[] => {
      const quote = input.quotes.get(symbol);
      if (!quote || quote.stale) return [];
      const pct = changePct(quote);
      return pct === null ? [] : [{ symbol, name, changePct: pct }];
    })
    .sort((a, b) => b.changePct - a.changePct);
  const best = sectors[0];
  const worst = sectors.at(-1);
  // With every sector level, "leading" and "lagging" would name two
  // sectors at the same number — a distinction that is not there.
  const ranked = sectors.length >= 2 && best.changePct !== worst!.changePct;

  return {
    indices,
    vix,
    leader: ranked ? best : null,
    laggard: ranked ? worst! : null,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/market-data/brief-mood.spec.ts src/market-data/daily-brief.spec.ts`
Expected: PASS, all tests in both files.

- [ ] **Step 5: Commit**

```bash
git add backend/src/market-data/brief-mood.ts backend/src/market-data/brief-mood.spec.ts backend/src/market-data/daily-brief.ts
git commit -m "feat(brief): pure market-mood line — index trend, VIX, sector leader and laggard"
```

---

### Task 2: Watch triggers, only on the day a signal starts

**Files:**
- Modify: `backend/src/market-data/daily-brief.ts`: add `streakDays` to MOMENTUM notes; add `isWatchTrigger`
- Test: `backend/src/market-data/daily-brief.spec.ts`

**Interfaces:**
- Consumes: the existing `buildDailyBriefNotes`, `momentumStreakDays`.
- Produces (used by Task 4):
  ```ts
  // BriefNote gains: streakDays?: number  (set on MOMENTUM notes only)
  export function isWatchTrigger(note: BriefNote): boolean;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/market-data/daily-brief.spec.ts` (add `isWatchTrigger` and `type BriefNote` to the existing import from `./daily-brief.js`):

```ts
describe('isWatchTrigger', () => {
  const note = (over: Partial<BriefNote>): BriefNote => ({
    kind: 'MOMENTUM', symbol: 'FSLR', source: 'WATCHLIST', title: 't', detail: 'd', ...over,
  });

  it('keeps a confirmed breakout', () => {
    expect(isWatchTrigger(note({ kind: 'BREAKOUT' }))).toBe(true);
  });
  it('keeps momentum on its first day', () => {
    expect(isWatchTrigger(note({ kind: 'MOMENTUM', streakDays: 1 }))).toBe(true);
  });
  // Pre-market the bars end yesterday, so a trend that only qualifies on
  // today's live price has a streak of 0 — that is still its first day.
  it('keeps momentum that holds only on the live price so far', () => {
    expect(isWatchTrigger(note({ kind: 'MOMENTUM', streakDays: 0 }))).toBe(true);
  });
  it('drops a momentum streak already running, which is not news', () => {
    expect(isWatchTrigger(note({ kind: 'MOMENTUM', streakDays: 2 }))).toBe(false);
  });
  it('drops a large daily move, which is not a setup on a watch row', () => {
    expect(isWatchTrigger(note({ kind: 'ATR_MOVE' }))).toBe(false);
  });
});

it('carries the momentum streak on the note it produced', () => {
  const values = Array.from({ length: 60 }, (_, i) => 100 + i * 0.2);
  const spy = bars(Array.from({ length: 60 }, () => 100));
  const momentum = buildDailyBriefNotes(input({ bars: bars(values), spyBars: spy }))
    .find((n) => n.kind === 'MOMENTUM');
  expect(momentum?.streakDays).toBe(momentumStreakDays(bars(values), spy));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/market-data/daily-brief.spec.ts`
Expected: FAIL, `isWatchTrigger` is not exported and `streakDays` is undefined.

- [ ] **Step 3: Implement**

In `backend/src/market-data/daily-brief.ts`:

1. Add the field to `BriefNote`:
   ```ts
   export interface BriefNote {
     kind: BriefKind;
     symbol: string;
     source: BriefSource;
     title: string;
     detail: string;
     /** MOMENTUM only: consecutive days the trend has held, from `momentumStreakDays`. */
     streakDays?: number;
   }
   ```
2. In the MOMENTUM `notes.push({...})` inside `buildDailyBriefNotes`, add `streakDays: streak,`.
3. Append:
   ```ts
   /**
    * A watch row earns a place on the Brief only the day something starts: a
    * confirmed breakout, or momentum on its first day. A streak already
    * running repeated the same sentence every morning — the stale alert a
    * daily reader learns to skip — and a big move alone is not a setup.
    */
   export function isWatchTrigger(note: BriefNote): boolean {
     if (note.kind === 'BREAKOUT') return true;
     return note.kind === 'MOMENTUM' && (note.streakDays ?? 0) <= 1;
   }
   ```
4. Any existing test in this file that does `toEqual` on a whole MOMENTUM note now needs `streakDays` in its expected object. Add the value the test's fixture produces; don't loosen the matcher.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/market-data/daily-brief.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/market-data/daily-brief.ts backend/src/market-data/daily-brief.spec.ts
git commit -m "feat(brief): watch triggers fire only the day a breakout or momentum starts"
```

---

### Task 3: AI facts block for the new shape

**Files:**
- Modify (rewrite): `backend/src/llm/daily-brief-context.ts`
- Modify (rewrite): `backend/src/llm/daily-brief-context.spec.ts`

`daily-brief-prompt.ts` does not change. Its instruction still fits.

**Interfaces:**
- Consumes: `Mood` from `../market-data/brief-mood.js` (type-only import); `MarketSession` from `../market-data/market-session.js`.
- Produces (used by Task 4):
  ```ts
  export interface ContextLine { title: string; detail: string }
  export interface DailyBriefContextInput {
    generatedAt: string;
    session: MarketSession;
    mood: Mood;
    events: ContextLine[];
    holdingNotes: ContextLine[];
    watchTriggers: ContextLine[];
  }
  export function buildDailyBriefContext(input: DailyBriefContextInput): string;
  ```

- [ ] **Step 1: Write the failing test**

Replace `backend/src/llm/daily-brief-context.spec.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { buildDailyBriefContext, type DailyBriefContextInput } from './daily-brief-context.js';
import { EMPTY_MOOD } from '../market-data/brief-mood.js';

function input(over: Partial<DailyBriefContextInput> = {}): DailyBriefContextInput {
  return {
    generatedAt: '2026-09-16T14:00:00.000Z',
    session: 'REGULAR',
    mood: EMPTY_MOOD,
    events: [],
    holdingNotes: [],
    watchTriggers: [],
    ...over,
  };
}

describe('buildDailyBriefContext', () => {
  it('states the time and the market session up top', () => {
    const facts = buildDailyBriefContext(input({ session: 'PRE' }));
    expect(facts).toContain('daily brief as of 2026-09-16T14:00:00.000Z, market session PRE');
  });

  it('writes the mood line with every figure exactly as computed', () => {
    const facts = buildDailyBriefContext(input({
      mood: {
        indices: [
          { symbol: 'SPY', trend: 'uptrend', changePct: 0.004, stale: false, extended: false },
          { symbol: 'QQQ', trend: null, changePct: -0.0025, stale: true, extended: true },
        ],
        vix: { level: 17.8, change: 1.1, stale: false },
        leader: { symbol: 'XLE', name: 'Energy', changePct: 0.012 },
        laggard: { symbol: 'XLK', name: 'Technology', changePct: -0.009 },
      },
    }));
    expect(facts).toContain('- SPY: uptrend, +0.40% today');
    expect(facts).toContain('- QQQ: trend unknown, -0.25% today (extended-hours print) (stale)');
    expect(facts).toContain('- VIX: 17.80 (+1.10)');
    expect(facts).toContain('- Leading sector: Energy (XLE) +1.20%');
    expect(facts).toContain('- Lagging sector: Technology (XLK) -0.90%');
  });

  it('says plainly when the mood is unavailable', () => {
    expect(buildDailyBriefContext(input())).toContain('- Market mood unavailable.');
  });

  it('quotes events, holding notes and watch triggers verbatim, each in its own section', () => {
    const facts = buildDailyBriefContext(input({
      events: [{ title: 'Fed raised rates 25 bp', detail: 'Target range is now 3.75–4.00%.' }],
      holdingNotes: [{ title: 'MSFT has good momentum', detail: 'Above rising trend averages and outperforming SPY by 2.7%.' }],
      watchTriggers: [{ title: 'FSLR confirmed a breakout', detail: 'Closed above its prior 20-day high on 2.1× average volume.' }],
    }));
    expect(facts).toContain('Economic events this week\n- Fed raised rates 25 bp: Target range is now 3.75–4.00%.');
    expect(facts).toContain('Your holdings\n- MSFT has good momentum: Above rising trend averages and outperforming SPY by 2.7%.');
    expect(facts).toContain('Watchlist triggers\n- FSLR confirmed a breakout: Closed above its prior 20-day high on 2.1× average volume.');
  });

  it('says plainly when a section is empty, rather than leaving it blank', () => {
    const facts = buildDailyBriefContext(input());
    expect(facts).toContain('- No economic events this week.');
    expect(facts).toContain('- Nothing notable on your holdings today.');
    expect(facts).toContain('- No new watchlist triggers.');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/llm/daily-brief-context.spec.ts`
Expected: FAIL, the input shape and strings don't match.

- [ ] **Step 3: Rewrite the module**

Replace `backend/src/llm/daily-brief-context.ts` with:

```ts
/**
 * Assembles the facts block the model reads for the Daily Brief narrative.
 * Every figure is quoted from what DailyBriefService already computed —
 * nothing here recalculates one, in the same spirit as portfolio-context.ts.
 * Pure and dependency-free so it is covered by fixture-driven tests.
 */
import type { Mood } from '../market-data/brief-mood.js';
import type { MarketSession } from '../market-data/market-session.js';

export interface ContextLine {
  title: string;
  detail: string;
}

export interface DailyBriefContextInput {
  generatedAt: string;
  session: MarketSession;
  mood: Mood;
  events: ContextLine[];
  holdingNotes: ContextLine[];
  watchTriggers: ContextLine[];
}

function percent(fraction: number): string {
  return `${fraction >= 0 ? '+' : '-'}${(Math.abs(fraction) * 100).toFixed(2)}%`;
}

function points(value: number): string {
  return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(2)}`;
}

function moodLines(mood: Mood): string[] {
  const lines: string[] = [];
  for (const index of mood.indices) {
    const parts = [`${index.symbol}: ${index.trend ?? 'trend unknown'}`];
    if (index.changePct !== null) parts.push(`, ${percent(index.changePct)} today`);
    if (index.extended) parts.push(' (extended-hours print)');
    if (index.stale) parts.push(' (stale)');
    lines.push(`- ${parts.join('')}`);
  }
  if (mood.vix) {
    const change = mood.vix.change !== null ? ` (${points(mood.vix.change)})` : '';
    lines.push(`- VIX: ${mood.vix.level.toFixed(2)}${change}${mood.vix.stale ? ' (stale)' : ''}`);
  }
  if (mood.leader) lines.push(`- Leading sector: ${mood.leader.name} (${mood.leader.symbol}) ${percent(mood.leader.changePct)}`);
  if (mood.laggard) lines.push(`- Lagging sector: ${mood.laggard.name} (${mood.laggard.symbol}) ${percent(mood.laggard.changePct)}`);
  return lines.length > 0 ? lines : ['- Market mood unavailable.'];
}

function section(heading: string, items: ContextLine[], empty: string): string[] {
  return [
    heading,
    ...(items.length === 0 ? [`- ${empty}`] : items.map((item) => `- ${item.title}: ${item.detail}`)),
    '',
  ];
}

export function buildDailyBriefContext(input: DailyBriefContextInput): string {
  return [
    `FACTS (daily brief as of ${input.generatedAt}, market session ${input.session}, computed by the app — quote these, do not recalculate)`,
    '',
    'Market mood',
    ...moodLines(input.mood),
    '',
    ...section('Economic events this week', input.events, 'No economic events this week.'),
    ...section('Your holdings', input.holdingNotes, 'Nothing notable on your holdings today.'),
    ...section('Watchlist triggers', input.watchTriggers, 'No new watchlist triggers.'),
  ].join('\n').trimEnd();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/llm/daily-brief-context.spec.ts src/llm/daily-brief-prompt.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/llm/daily-brief-context.ts backend/src/llm/daily-brief-context.spec.ts
git commit -m "feat(brief): AI facts block reads the market mood, holdings and watch triggers"
```

---

### Task 4: Service and response reshape

**Files:**
- Modify: `backend/src/market-data/daily-brief.service.ts`
- Modify (rewrite): `backend/src/market-data/daily-brief.service.spec.ts`

**Interfaces:**
- Consumes: `buildMood`, `EMPTY_MOOD`, `MOOD_INDICES`, `MOOD_QUOTE_SYMBOLS`, `type Mood`, `type MoodQuote` (Task 1); `isWatchTrigger` (Task 2); `buildDailyBriefContext` with `DailyBriefContextInput` (Task 3); `MarketDataService.getQuotes(symbols: string[], force?: boolean, augment?: boolean): Promise<Map<string, Quote>>`; `computeMarketSession(now: Date): MarketSession` from `./market-session.js`.
- Produces (the wire contract Task 5 mirrors):
  ```ts
  export interface BriefEvent { title: string; detail: string; eventAt: string }
  export interface HoldingNote { kind: 'ATR_MOVE' | 'MOMENTUM' | 'BREAKOUT' | 'EARNINGS'; symbol: string; title: string; detail: string }
  export interface WatchTrigger { kind: 'BREAKOUT' | 'MOMENTUM'; symbol: string; title: string; detail: string }
  export interface DailyBriefResponse {
    generatedAt: string;
    refreshAfterSeconds: number;
    session: MarketSession;
    marketDataAvailable: boolean;
    mood: Mood;
    events: BriefEvent[];
    holdingNotes: HoldingNote[];   // interim — slices 2–3 replace it
    watchTriggers: WatchTrigger[];
    narrative: string | null;
    narrativeAt: string | null;
  }
  ```
  The constructor gains a trailing optional `private readonly marketData?: MarketDataService`, after `users`. Nest injects it by type; `MarketDataModule`, already imported by `WatchlistModule`, exports it. Without it the mood is `EMPTY_MOOD`.

- [ ] **Step 1: Write the failing tests**

Rewrite `backend/src/market-data/daily-brief.service.spec.ts`. Keep the file's existing `describe('the AI narrative', ...)` block and its tests. Its `baseDeps()` stays six positional mocks, and its assertions read `narrative`/`narrativeAt`, which keep their names in this slice. If a test there asserts on `notes`, change it to read `holdingNotes`. Replace everything above that block with the helpers and tests below. These tests replace the old ones as follows:
- **Moved to `holdingNotes` (same behaviour):** missing stop, no-stop absent when a stop exists, partial stop, earnings ordered ahead of momentum.
- **Deleted:** the coverage assertions, the "uses the portfolio quote for a ticker that is also watched" test (now covered by the held-and-watched test below), and both quiet-day tests (`QUIET_DAY` is retired).

```ts
import { describe, expect, it, vi } from 'vitest';
import { DailyBriefService } from './daily-brief.service.js';
import { EMPTY_MOOD } from './brief-mood.js';

/** 21 flat bars then a close above the range on 3× volume: a confirmed breakout (and an ATR move). */
function breakoutBars(instrumentId: string) {
  const flat = Array.from({ length: 21 }, (_, i) => ({
    instrumentId, date: `2026-08-${String(i + 1).padStart(2, '0')}`,
    close: 100, adjClose: 100, open: 100, high: 101, low: 99, volume: 1_000_000,
  }));
  return [...flat, { instrumentId, date: '2026-08-22', close: 110, adjClose: 110, open: 101, high: 111, low: 100, volume: 3_000_000 }];
}

function deps(over: {
  positions?: unknown[];
  watched?: unknown[];
  instruments?: { id: string; symbol: string }[];
  bars?: unknown[];
  calendar?: { available: boolean; events: unknown[] };
  atRisk?: unknown;
} = {}) {
  return [
    { getPortfolio: vi.fn().mockResolvedValue({ positions: over.positions ?? [], atRisk: over.atRisk ?? { positionsWithoutStop: { count: 0, symbols: [] } } }) } as any,
    { list: vi.fn().mockResolvedValue(over.watched ?? []) } as any,
    { find: vi.fn().mockResolvedValue(over.bars ?? []) } as any,
    { find: vi.fn().mockResolvedValue(over.instruments ?? []) } as any,
    { ensureFresh: vi.fn().mockResolvedValue(undefined) } as any,
    { week: vi.fn().mockResolvedValue(over.calendar ?? { available: true, events: [] }) } as any,
  ] as const;
}

function quote(price: number, previousClose: number) {
  return { symbol: '', name: null, price, stale: false, session: 'REGULAR', extended: false, regularPrice: price, previousClose, peRatio: null };
}

describe('DailyBriefService', () => {
  it('serves the mood from the market-data quotes, without spending the Twelve Data budget', async () => {
    const getQuotes = vi.fn().mockResolvedValue(new Map([
      ['SPY', quote(502, 500)],
      ['^VIX', quote(17.8, 16.7)],
      ['XLE', quote(101.2, 100)],
      ['XLK', quote(99.1, 100)],
    ]));
    const service = new DailyBriefService(...deps(), undefined, undefined, { getQuotes } as any);

    const result = await service.get({ refresh: true, now: new Date('2026-09-16T15:00:00Z') });

    expect(getQuotes).toHaveBeenCalledWith(expect.arrayContaining(['SPY', 'QQQ', '^VIX', 'XLK']), true, false);
    expect(result.mood.indices).toEqual([expect.objectContaining({ symbol: 'SPY', changePct: 0.004 })]);
    expect(result.mood.vix?.level).toBe(17.8);
    expect(result.mood.leader?.symbol).toBe('XLE');
    expect(result.mood.laggard?.symbol).toBe('XLK');
    expect(result.session).toBe('REGULAR');
  });

  it('still serves the brief with an empty mood when the quote fetch throws', async () => {
    const getQuotes = vi.fn().mockRejectedValue(new Error('provider down'));
    const service = new DailyBriefService(...deps(), undefined, undefined, { getQuotes } as any);

    const result = await service.get();

    expect(result.mood).toEqual(EMPTY_MOOD);
  });

  it('leaves VIX null when the provider returned no VIX quote', async () => {
    const getQuotes = vi.fn().mockResolvedValue(new Map([['SPY', quote(502, 500)]]));
    const service = new DailyBriefService(...deps(), undefined, undefined, { getQuotes } as any);

    expect((await service.get()).mood.vix).toBeNull();
  });

  it('serves no coverage or grouped notes any more', async () => {
    const result = await new DailyBriefService(...deps()).get();
    expect(result).not.toHaveProperty('coverage');
    expect(result).not.toHaveProperty('notes');
  });

  it('lists this week\'s economic events on their own', async () => {
    const service = new DailyBriefService(...deps({ calendar: { available: true, events: [
      { kind: 'RATE_DECISION', name: 'Federal Reserve rate decision', date: '2026-09-16', title: 'Fed raised rates 25 bp', detail: 'Target range is now 3.75–4.00%.' },
    ] } }));

    const result = await service.get({ now: new Date('2026-09-16T09:00:00Z') });

    expect(result.events).toEqual([{ title: 'Fed raised rates 25 bp', detail: 'Target range is now 3.75–4.00%.', eventAt: '2026-09-16' }]);
    expect(result.marketDataAvailable).toBe(true);
  });

  it('reports an unavailable macro source', async () => {
    const service = new DailyBriefService(...deps({ calendar: { available: false, events: [] } }));
    await expect(service.get()).resolves.toMatchObject({ marketDataAvailable: false, events: [] });
  });

  it('turns a watch row\'s breakout into a trigger, and drops its plain big move', async () => {
    const service = new DailyBriefService(...deps({
      watched: [{ symbol: 'FSLR', price: 110, regularPrice: 110, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: null }],
      instruments: [{ id: 'i-fslr', symbol: 'FSLR' }],
      bars: breakoutBars('i-fslr'),
    }));

    const result = await service.get();

    expect(result.watchTriggers).toEqual([expect.objectContaining({ kind: 'BREAKOUT', symbol: 'FSLR' })]);
    expect(result.watchTriggers.some((t) => (t.kind as string) === 'ATR_MOVE')).toBe(false);
  });

  it('never lists a held ticker as a watch trigger, even when it is also watched', async () => {
    const row = { symbol: 'FSLR', price: 110, regularPrice: 110, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: null };
    const service = new DailyBriefService(...deps({
      positions: [row],
      watched: [row],
      instruments: [{ id: 'i-fslr', symbol: 'FSLR' }],
      bars: breakoutBars('i-fslr'),
    }));

    const result = await service.get();

    expect(result.watchTriggers).toEqual([]);
    expect(result.holdingNotes).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'BREAKOUT', symbol: 'FSLR' })]));
  });

  it('drops earnings on a watch row, which is no longer a Brief item', async () => {
    const service = new DailyBriefService(...deps({
      watched: [{ symbol: 'PLTR', price: 25, regularPrice: 25, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: 1 }],
    }));
    const result = await service.get();
    expect(result.watchTriggers).toEqual([]);
    expect(result.holdingNotes).toEqual([]);
  });
});
```

Then port the four holding-note tests named above, so that they read `result.holdingNotes`:
- **Missing stop and no-stop-absent:** assert `holdingNotes` contains an `ATR_MOVE` for the symbol whose `detail` ends with / omits ` No stop is set on this position.`
- **Partial stop:** the `detail` contains `Partial stop: only X of Y shares are covered.`
- **Earnings ordering:** the `EARNINGS` note's index in `holdingNotes` is lower than the `MOMENTUM` note's.

Their positional constructor calls become `new DailyBriefService(...deps({...}))`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/market-data/daily-brief.service.spec.ts`
Expected: FAIL, because `mood`, `holdingNotes`, `watchTriggers` and `events` don't exist yet.

- [ ] **Step 3: Implement**

In `backend/src/market-data/daily-brief.service.ts`:

1. **Imports:** add
   ```ts
   import { MarketDataService } from './market-data.service.js';
   import { computeMarketSession, type MarketSession } from './market-session.js';
   import { buildMood, EMPTY_MOOD, MOOD_INDICES, MOOD_QUOTE_SYMBOLS, type Mood, type MoodQuote } from './brief-mood.js';
   ```
   Change `import { buildDailyBriefNotes, type BriefNote } from './daily-brief.js';` to `import { buildDailyBriefNotes, isWatchTrigger } from './daily-brief.js';`, and remove `import type { MarketSession } from './select-price.js';`.
2. **Response types:** replace the whole `DailyBriefResponse` interface with the `BriefEvent`, `HoldingNote`, `WatchTrigger` and `DailyBriefResponse` declarations from the **Produces** block above. Keep the existing doc comment on `narrative`. On `holdingNotes`, add: `/** Interim (Brief redesign slice 1): replaced by the decision queue and movers in slices 2–3. */`.
3. **Priority:** replace `NOTE_KIND_PRIORITY` with
   ```ts
   const HOLDING_NOTE_PRIORITY: Record<HoldingNote['kind'], number> = { EARNINGS: 0, ATR_MOVE: 1, BREAKOUT: 2, MOMENTUM: 3 };
   ```
4. **Constructor:** append `private readonly marketData?: MarketDataService,` after `users`, with a comment in the existing style: optional so the existing positional call sites read as "no mood".
5. **`get()`:** replace the body from `const [portfolio, watched, calendar] = ...` through the final `return` with:
   ```ts
   const [portfolio, watched, calendar, moodQuotes] = await Promise.all([
     this.portfolio.getPortfolio({ refresh }),
     this.watchlist.list({ refresh }),
     this.calendar.week(isoDate(weekStart), isoDate(weekEnd)),
     this.moodQuotes(refresh),
   ]);
   const held = new Set<string>(portfolio.positions.map((position: { symbol: string }) => position.symbol));
   const watchOnly = watched.filter((row) => !held.has(row.symbol));
   const symbols = [...held, ...watchOnly.map((row) => row.symbol)];

   const instruments = await this.instruments.find({ where: { symbol: In([...symbols, ...MOOD_INDICES]) } });
   const instrumentBySymbol = new Map(instruments.map((instrument) => [instrument.symbol, instrument]));
   const bars = await this.closes.find({
     where: { instrumentId: In(instruments.map((instrument) => instrument.id)) },
     order: { date: 'ASC' },
   });
   const barsByInstrument = new Map<string, typeof bars>();
   for (const bar of bars) {
     const current = barsByInstrument.get(bar.instrumentId) ?? [];
     current.push(bar);
     barsByInstrument.set(bar.instrumentId, current);
   }
   const barsFor = (symbol: string) => barsByInstrument.get(instrumentBySymbol.get(symbol)?.id ?? '') ?? [];
   const spyBars = barsFor('SPY');
   ```
   Keep the existing `symbolsWithoutStop` and `partialStopBySymbol` blocks with their comments, unchanged. Then:
   ```ts
   const holdingNotes: HoldingNote[] = [];
   for (const position of portfolio.positions) {
     if (position.price !== null && position.price !== undefined && instrumentBySymbol.has(position.symbol)) {
       const notes = buildDailyBriefNotes({ symbol: position.symbol, source: 'PORTFOLIO', price: position.price, bars: barsFor(position.symbol), spyBars });
       const partialStop = partialStopBySymbol.get(position.symbol);
       for (const note of notes) {
         let detail = note.detail;
         if (symbolsWithoutStop.has(position.symbol)) detail = `${detail} No stop is set on this position.`;
         else if (partialStop) detail = `${detail} Partial stop: only ${partialStop.coveredQuantity} of ${partialStop.heldQuantity} shares are covered.`;
         holdingNotes.push({ kind: note.kind, symbol: note.symbol, title: note.title, detail });
       }
     }
     const days = position.daysUntilEarnings;
     if (days !== null && days !== undefined && days >= 0 && days <= 6) {
       holdingNotes.push({
         kind: 'EARNINGS', symbol: position.symbol,
         title: `${position.symbol} has earnings this week`,
         detail: days === 0 ? 'Earnings are today.' : `Earnings are in ${days} days.`,
       });
     }
   }
   holdingNotes.sort((a, b) => HOLDING_NOTE_PRIORITY[a.kind] - HOLDING_NOTE_PRIORITY[b.kind]);

   const watchTriggers: WatchTrigger[] = [];
   for (const row of watchOnly) {
     if (row.price === null || row.price === undefined || !instrumentBySymbol.has(row.symbol)) continue;
     const notes = buildDailyBriefNotes({ symbol: row.symbol, source: 'WATCHLIST', price: row.price, bars: barsFor(row.symbol), spyBars });
     for (const note of notes) {
       if (isWatchTrigger(note)) {
         watchTriggers.push({ kind: note.kind as WatchTrigger['kind'], symbol: note.symbol, title: note.title, detail: note.detail });
       }
     }
   }

   const events: BriefEvent[] = calendar.events.map((event) => ({ title: event.title, detail: event.detail, eventAt: event.date }));
   const mood = buildMood({ quotes: moodQuotes, indexBars: { SPY: barsFor('SPY'), QQQ: barsFor('QQQ') } });
   const session = computeMarketSession(now);
   const narrative = await this.buildNarrative(now, { session, mood, events, holdingNotes, watchTriggers });

   return {
     generatedAt: now.toISOString(), refreshAfterSeconds: 300, session,
     marketDataAvailable: calendar.available, mood, events, holdingNotes, watchTriggers,
     narrative: narrative?.text ?? null, narrativeAt: narrative?.at.toISOString() ?? null,
   };
   ```
6. **Mood quotes:** add a private method:
   ```ts
   /**
    * Never throws: the mood is context, not a fact the rest of the brief
    * depends on. `augment: false` leaves Twelve Data's free budget to the
    * positions and stops that must be right (see MarketDataService.getQuotes).
    */
   private async moodQuotes(refresh: boolean): Promise<Map<string, MoodQuote>> {
     if (!this.marketData) return new Map();
     try {
       const quotes = await this.marketData.getQuotes([...MOOD_QUOTE_SYMBOLS], refresh, false);
       return new Map([...quotes].map(([symbol, q]) => [symbol, { price: q.price, previousClose: q.previousClose, stale: q.stale, extended: q.extended }]));
     } catch (err) {
       this.logger.warn(`daily brief mood quotes failed: ${err instanceof Error ? err.message : String(err)}`);
       return new Map();
     }
   }
   ```
7. **`buildNarrative`:** change its signature to `(now: Date, facts: Omit<DailyBriefContextInput, 'generatedAt'>)`, importing `type DailyBriefContextInput` from `../llm/daily-brief-context.js`. Change the signature object to:
   ```ts
   const signature = JSON.stringify({
     day: now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
     events: [...facts.holdingNotes, ...facts.watchTriggers].map((n) => [n.kind, n.symbol]),
     macro: facts.events.map((e) => e.title),
   });
   ```
   Build the facts with `buildDailyBriefContext({ generatedAt: now.toISOString(), ...facts })`. Its doc comment should now say "the brief's facts" instead of "notes and coverage".
8. **Delete** `biggestMoverNote` and its doc comment. If `EMPTY_MOOD` ends up unused in this file, don't import it.

- [ ] **Step 4: Run tests and type-check**

Run: `cd backend && npx vitest run src/market-data src/llm && npx tsc --noEmit -p tsconfig.json`
Expected: all tests PASS and tsc prints nothing.

- [ ] **Step 5: Run the backend e2e suite**

Run: `npm run test:e2e --prefix backend`
Expected: PASS. No e2e spec should depend on `coverage`. If one does, update it to the new shape and say so in the report.

- [ ] **Step 6: Commit**

```bash
git add backend/src/market-data/daily-brief.service.ts backend/src/market-data/daily-brief.service.spec.ts
git commit -m "feat(brief): serve market mood, events, holdings and watch triggers instead of coverage"
```

---

### Task 5: Frontend — display-only Brief over the new response

**Files:**
- Modify: `frontend/src/api/dailyBrief.ts`: add the wire types
- Create: `frontend/src/components/brief/MoodLine.tsx`
- Create: `frontend/src/components/brief/BriefNoteList.tsx`
- Modify (rewrite): `frontend/src/routes/Brief.tsx`
- Modify (rewrite): `frontend/src/routes/Brief.spec.tsx`

**Interfaces:**
- Consumes: the Task 4 response. Existing helpers `formatPercent`, `signClass` and `formatTimestamp` from `../components/format`; `SessionBadge`, `RefreshButton` and `Markdown` from `../components/*`.
- Produces: `BriefResponse` and its member types, exported from `frontend/src/api/dailyBrief.ts`.

- [ ] **Step 1: Add the wire types**

Append to `frontend/src/api/dailyBrief.ts`:

```ts
export type MarketSession = 'PRE' | 'REGULAR' | 'POST' | 'OVERNIGHT' | 'CLOSED';

export interface BriefMood {
  indices: { symbol: string; trend: 'uptrend' | 'downtrend' | 'mixed' | null; changePct: number | null; stale: boolean; extended: boolean }[];
  vix: { level: number; change: number | null; stale: boolean } | null;
  leader: { symbol: string; name: string; changePct: number } | null;
  laggard: { symbol: string; name: string; changePct: number } | null;
}

export interface BriefEvent { title: string; detail: string; eventAt: string }
export interface BriefLine { kind: string; symbol: string; title: string; detail: string }

export interface BriefResponse {
  generatedAt: string;
  refreshAfterSeconds: number;
  session: MarketSession;
  marketDataAvailable: boolean;
  mood: BriefMood;
  events: BriefEvent[];
  holdingNotes: BriefLine[];
  watchTriggers: BriefLine[];
  /** Null whenever there is nothing to show — no AI configured, or the call failed. Silent by design. */
  narrative: string | null;
  /** When the narrative was written; earlier than generatedAt when the server reused it. */
  narrativeAt: string | null;
}
```

- [ ] **Step 2: Write the failing page tests**

Rewrite `frontend/src/routes/Brief.spec.tsx`. Keep the existing imports, the `vi.mock('../api/client', ...)`, `beforeEach`/`afterEach` and `renderBrief()`. Replace the fixture with:

```ts
const initialBrief = {
  generatedAt: '2026-09-17T08:00:00.000Z',
  refreshAfterSeconds: 300,
  session: 'PRE',
  marketDataAvailable: true,
  mood: {
    indices: [
      { symbol: 'SPY', trend: 'uptrend', changePct: 0.004, stale: false, extended: true },
      { symbol: 'QQQ', trend: 'mixed', changePct: -0.002, stale: true, extended: false },
    ],
    vix: { level: 17.8, change: 1.1, stale: false },
    leader: { symbol: 'XLE', name: 'Energy', changePct: 0.012 },
    laggard: { symbol: 'XLK', name: 'Technology', changePct: -0.009 },
  },
  events: [{ title: 'Fed rate decision', detail: 'Fed raised rates 25 bp to 3.75–4.00%.', eventAt: '2026-09-17' }],
  holdingNotes: [{ kind: 'MOMENTUM', symbol: 'NVDA', title: 'NVDA has good momentum', detail: 'Above rising averages.' }],
  watchTriggers: [],
  narrative: null,
  narrativeAt: null,
};
```

Add these tests:

```ts
it('reads the market mood as one line, every figure from the server', async () => {
  (api as ReturnType<typeof vi.fn>).mockResolvedValue(initialBrief);
  renderBrief();
  const market = await screen.findByRole('region', { name: 'Market' });
  expect(market).toHaveTextContent('SPY uptrend +0.40%');
  expect(market).toHaveTextContent('QQQ mixed -0.20%');
  expect(market).toHaveTextContent('VIX 17.80 (+1.10)');
  expect(market).toHaveTextContent('Leading Energy +1.20%');
  expect(market).toHaveTextContent('Lagging Technology -0.90%');
});

it('labels a stale index rather than passing it off as fresh', async () => {
  (api as ReturnType<typeof vi.fn>).mockResolvedValue(initialBrief);
  renderBrief();
  const market = await screen.findByRole('region', { name: 'Market' });
  expect(within(market).getByText('STALE')).toBeInTheDocument();
});

it('lists this week\'s economic events under the mood', async () => {
  (api as ReturnType<typeof vi.fn>).mockResolvedValue(initialBrief);
  renderBrief();
  const market = await screen.findByRole('region', { name: 'Market' });
  expect(market).toHaveTextContent('Fed rate decision');
  expect(market).toHaveTextContent('Fed raised rates 25 bp to 3.75–4.00%.');
});

it('says the mood is unavailable instead of an empty line', async () => {
  (api as ReturnType<typeof vi.fn>).mockResolvedValue({
    ...initialBrief, mood: { indices: [], vix: null, leader: null, laggard: null },
  });
  renderBrief();
  expect(await screen.findByText('Market mood unavailable right now.')).toBeInTheDocument();
});

it('no longer repeats the portfolio and watch list as price cards', async () => {
  (api as ReturnType<typeof vi.fn>).mockResolvedValue(initialBrief);
  renderBrief();
  await screen.findByRole('region', { name: 'Market' });
  expect(screen.queryByRole('region', { name: 'Current coverage' })).not.toBeInTheDocument();
});

it('links a holding note to the holding and a watch trigger to its watch row', async () => {
  (api as ReturnType<typeof vi.fn>).mockResolvedValue({
    ...initialBrief,
    watchTriggers: [{ kind: 'BREAKOUT', symbol: 'FSLR', title: 'FSLR confirmed a breakout', detail: 'Closed above its prior 20-day high on 2.1× average volume.' }],
  });
  renderBrief();
  const holding = await screen.findByRole('link', { name: /NVDA has good momentum/ });
  expect(holding).toHaveAttribute('href', '/?symbol=NVDA');
  const trigger = screen.getByRole('link', { name: /FSLR confirmed a breakout/ });
  expect(trigger).toHaveAttribute('href', '/watchlist?symbol=FSLR');
});

it('hides empty sections and says once that there is nothing to act on', async () => {
  (api as ReturnType<typeof vi.fn>).mockResolvedValue({ ...initialBrief, holdingNotes: [], watchTriggers: [] });
  renderBrief();
  expect(await screen.findByText('No holding or watch signals right now.')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Holdings' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Watch triggers' })).not.toBeInTheDocument();
});

it('states the session once, in the header', async () => {
  (api as ReturnType<typeof vi.fn>).mockResolvedValue(initialBrief);
  renderBrief();
  await screen.findByRole('region', { name: 'Market' });
  expect(screen.getAllByText('PRE-MARKET')).toHaveLength(1);
});
```

Port the existing tests that still apply:
- **AI take:** "labels an AI take older than the brief…", "does not label a take written with this brief", "shows the AI take above…" and "shows nothing extra when there is no AI take…". For the ordering one, the AI take must come before the `Market` region in document order.
- **Refresh:** the four tests, "forces a fresh Brief…", "keeps the forced Brief when an earlier normal request settles afterward", "keeps forced coverage when a normal read starts…" and "keeps completed coverage visible while a manual refresh is pending and after it fails". Their fresh fixture is `{ ...initialBrief, watchTriggers: [{ kind: 'BREAKOUT', symbol: 'FSLR', title: 'FSLR confirmed a breakout', detail: 'd' }] }`. Wherever they asserted a coverage card for the new or old ticker, assert the text `FSLR confirmed a breakout` (fresh) or its absence (stale).
- **Failure:** "does not claim to show a completed brief…" and "calls out unavailable Federal Reserve updates…", unchanged apart from the fixture.

Delete the tests that only make sense with coverage or grouping:
- "says a session shared by every quote once…" (replaced by "states the session once")
- "keeps notable events ahead of long ticker coverage"
- "shows current session coverage…"
- "groups notable notes…"
- "labels stale and extended quotes beside affected technical notes"
- "surfaces the macro decision before per-ticker signals"

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/routes/Brief.spec.tsx`
Expected: FAIL; no `Market` region exists yet.

- [ ] **Step 4: Write the components**

`frontend/src/components/brief/MoodLine.tsx`:

```tsx
import { Fragment, type ReactNode } from 'react';
import type { BriefEvent, BriefMood } from '../../api/dailyBrief';
import { formatPercent, signClass } from '../format';

function Change({ value }: { value: number | null }) {
  if (value === null) return null;
  return <span className={`tabular-nums ${signClass(value)}`}>{formatPercent(value)}</span>;
}

function Stale() {
  return <span className="text-[10px] font-medium tracking-wide text-down">STALE</span>;
}

/**
 * The market's mood in one line, before any single name. Every word and
 * figure is the server's; this only lays them out.
 */
export function MoodLine({ mood, events }: { mood: BriefMood; events: BriefEvent[] }) {
  const parts: { key: string; node: ReactNode }[] = [];
  for (const index of mood.indices) {
    parts.push({
      key: index.symbol,
      node: <>{index.symbol}{index.trend && ` ${index.trend}`} <Change value={index.changePct} />{index.stale && <> <Stale /></>}</>,
    });
  }
  if (mood.vix) {
    const { level, change, stale } = mood.vix;
    parts.push({
      key: 'vix',
      node: <>VIX <span className="tabular-nums">{level.toFixed(2)}{change !== null && ` (${change >= 0 ? '+' : '-'}${Math.abs(change).toFixed(2)})`}</span>{stale && <> <Stale /></>}</>,
    });
  }
  if (mood.leader) parts.push({ key: 'leader', node: <>Leading {mood.leader.name} <Change value={mood.leader.changePct} /></> });
  if (mood.laggard) parts.push({ key: 'laggard', node: <>Lagging {mood.laggard.name} <Change value={mood.laggard.changePct} /></> });

  return (
    <section aria-label="Market" className="space-y-2 rounded-xl border border-border bg-surface-1 p-3">
      {parts.length === 0 ? (
        <p className="text-sm text-muted">Market mood unavailable right now.</p>
      ) : (
        <p className="flex flex-wrap gap-x-2 gap-y-1 text-sm">
          {parts.map((part, i) => (
            <Fragment key={part.key}>
              {i > 0 && <span aria-hidden="true" className="text-muted">·</span>}
              <span>{part.node}</span>
            </Fragment>
          ))}
        </p>
      )}
      {events.length > 0 && (
        <ul className="space-y-1 text-xs text-muted">
          {events.map((event) => (
            <li key={`${event.eventAt}-${event.title}`}>
              <span className="font-medium text-fg">{event.title}</span> — {event.detail}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

Before using the class `text-fg`, check `frontend/src/index.css` or the Tailwind config for the token the app uses for primary text. Use that name; if there isn't one, drop the class.

`frontend/src/components/brief/BriefNoteList.tsx`:

```tsx
import { Link } from 'react-router-dom';
import type { BriefLine } from '../../api/dailyBrief';

/** A labelled list of server-written notes, each linking to where the owner acts on it. Renders nothing when empty. */
export function BriefNoteList({
  label,
  notes,
  destination,
}: {
  label: string;
  notes: BriefLine[];
  destination: (symbol: string) => string;
}) {
  if (notes.length === 0) return null;
  return (
    <section aria-label={label} className="space-y-2">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted">{label}</h2>
      {notes.map((note, index) => (
        <Link
          key={`${note.kind}-${note.symbol}-${index}`}
          to={destination(note.symbol)}
          className="block rounded-xl border border-border bg-surface-1 p-3 transition-colors active:bg-surface-2"
        >
          <h3 className="text-sm font-medium">{note.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">{note.detail}</p>
        </Link>
      ))}
    </section>
  );
}
```

- [ ] **Step 5: Rewrite the page**

Replace `frontend/src/routes/Brief.tsx`. Keep the existing `useQuery` setup, the `refresh` function with its `refreshInFlight` logic and comments, the refresh-failed alert, and the loading and error states, unchanged. Change only what the page renders:

```tsx
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { SessionBadge } from '../components/SessionBadge';
import { formatTimestamp } from '../components/format';
import { RefreshButton } from '../components/RefreshButton';
import { Markdown } from '../components/Markdown';
import { MoodLine } from '../components/brief/MoodLine';
import { BriefNoteList } from '../components/brief/BriefNoteList';
import { DAILY_BRIEF_QUERY_KEY, fetchDailyBrief, type BriefResponse } from '../api/dailyBrief';

const QUERY_KEY = DAILY_BRIEF_QUERY_KEY;
const holdingDestination = (symbol: string) => `/?symbol=${encodeURIComponent(symbol)}`;
const watchDestination = (symbol: string) => `/watchlist?symbol=${encodeURIComponent(symbol)}`;

export function Brief() {
  // ...the existing queryClient, refreshInFlight, refreshFailed, query, brief and refresh, unchanged...

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Daily brief</h1>
          {brief && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              Updated {formatTimestamp(brief.generatedAt)}
              <SessionBadge session={brief.session} extended={false} />
            </p>
          )}
        </div>
        <RefreshButton label="Refresh brief" onRefresh={refresh} />
      </header>
      {/* existing refreshFailed alert, pending text and error text — unchanged */}
      {brief && <>
        {/* existing !marketDataAvailable notice — unchanged */}
        {/* existing narrative <section aria-label="AI take"> — unchanged */}
        <MoodLine mood={brief.mood} events={brief.events} />
        <BriefNoteList label="Holdings" notes={brief.holdingNotes} destination={holdingDestination} />
        <BriefNoteList label="Watch triggers" notes={brief.watchTriggers} destination={watchDestination} />
        {brief.holdingNotes.length === 0 && brief.watchTriggers.length === 0 && (
          <p className="text-sm text-muted">No holding or watch signals right now.</p>
        )}
      </>}
    </div>
  );
}
```

The comment placeholders above mark JSX that must be carried over **verbatim** from the current file; they are not to be left as comments. Delete the local `Source`, `Coverage`, `BriefNote` and `BriefResponse` types, `GROUPS`, `destination`, `sharedSession`, `CoverageCard` and `NoteCard`. Also remove the `Link` and `Money` imports if nothing else uses them.

- [ ] **Step 6: Run the tests and type-check**

Run: `cd frontend && npx vitest run src/routes/Brief.spec.tsx src/components/AppShell.spec.tsx && npx tsc -b`
Expected: PASS, and tsc prints nothing.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/dailyBrief.ts frontend/src/components/brief frontend/src/routes/Brief.tsx frontend/src/routes/Brief.spec.tsx
git commit -m "feat(brief): mood line up top; drop the repeated price-card coverage"
```

---

### Task 6: Browser test and real-app check

**Files:**
- Modify: `e2e/navigation.spec.ts`

- [ ] **Step 1: Add the browser test**

In `e2e/navigation.spec.ts`, next to the existing `'Brief uses the offline Federal Reserve fixture'` test, add the test below. In the browser server, the Yahoo stub prices `^VIX` at the default 100, with `previousClose = price / 1.02`.

```ts
test('Brief opens on the market mood, with no repeated price cards, and fits the phone', async ({ page }) => {
  await page.goto('/brief');
  const market = page.getByRole('region', { name: 'Market' });
  await expect(market).toContainText('SPY');
  await expect(market).toContainText('VIX 100.00');
  await expect(page.getByRole('region', { name: 'Current coverage' })).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
```

- [ ] **Step 2: Run the browser suite**

Run: `npm run test:browser`
Expected: PASS, including the existing `'Brief uses the offline Federal Reserve fixture'` test.

- [ ] **Step 3: Run the full unit suites**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/navigation.spec.ts
git commit -m "test(brief): browser check for the mood line and phone fit"
```

- [ ] **Step 5: Real-app inspection (orchestrator, not the implementer)**

With `npm run start:dev --prefix backend` and `npm run dev --prefix frontend` running against the real `trader` database (read-only: open the page only), open `http://localhost:5173/brief` at 402 px wide and check:
- The mood line shows SPY, QQQ, VIX and a sector leader and laggard with live numbers. If `^VIX` is missing, Yahoo's fallback does not resolve it; record that as a finding rather than silently shipping without VIX.
- No price-card coverage.
- Holdings and watch triggers link correctly.
- Nothing is clipped horizontally.

Then hand the slice to the owner for his iPhone check before slice 2 is planned.
