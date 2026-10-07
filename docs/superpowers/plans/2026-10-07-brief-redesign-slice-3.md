# Brief Redesign — Slice 3 (Movers with Headlines) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Brief's interim "Holdings" notes with a **Movers** section: up to 5 holdings whose move since the prior close is at least 1 ATR. Each row shows the move (% and × ATR), the dollar change on the position, the entry-reason chips, and the newest company headline from the last 24 hours.

**Architecture:**
- A new pure `backend/src/market-data/brief-movers.ts` ranks holdings.
  - It takes each position's existing `dayChange`/`dayChangePct`/`dayPnl`. Those are already session-aware via `dayChangeBase`, so pre-market moves are measured from the last close.
  - It divides by `priorAtr` and keeps the top 5 at ≥ 1 ATR.
- `NewsService` gains `latestHeadline(symbol, since)`, built on its existing cache.
- `DailyBriefService` attaches one headline per mover and serves `movers`.
  - It drops `holdingNotes`.
  - It feeds the movers into the AI facts and cache signature.
- The frontend replaces the Holdings list with a `Movers` section.
- The per-mover AI thesis line is slice 4; the field ships now as `null`.

**Tech Stack:** NestJS + TypeORM, React + TanStack Query + Tailwind, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-06-brief-redesign-design.md`, section "Movers". This plan is delivery slice 3 of 4. Slices 1–2 are shipped.

## Global Constraints

- Read `AGENTS.md` first.
- The backend computes; the frontend displays. The frontend formats numbers it is given (percent, money, ×ATR to one decimal) and renders backend strings verbatim. It holds no ranking, threshold or reason vocabulary.
- **Movers reuse the portfolio's figures:**
  - **move:** `dayChange`, `dayChangePct` and `dayPnl` from `PortfolioService.getPortfolio().positions`;
  - **ATR:** `priorAtr` from `daily-brief.ts`.
  - Never re-derive the day change. That keeps the Brief consistent with the Portfolio screen and with the pre-market fix (`e97fa14`).
- Missing data gives no row, never a guess. That covers no ATR, a null `dayChange`, and a stale quote with no move.
- `stale` and `extended` are carried on each mover. A stale mover is labelled `STALE`, and an extended move carries the session badge.
- Finnhub is reached only through `NewsService` → `FinnhubClient`. If it is unconfigured or fails, the row reads "No news found". The headline is enrichment and never blocks the Brief.
- Reason labels come from `backend/src/journal/reasons.ts` (`ENTRY_REASONS`). An unknown code is dropped, never shown raw.
- Tests never call Yahoo, Finnhub, an LLM or any network.
- Never touch the real `trader` database destructively.
- Commit style is `feat(brief): …` or `test(brief): …`, local on `main` only, with no push. End every commit message with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01KSLpjvWMhkHqfbWoTYBnE1
  ```

## Review Focus

1. **A short that rises.** `dayPnl` is negative while `dayChangePct` is positive. Expected: the row shows `+x%` and `-$y`, with the sign of each coming from the backend. Pinned in Task 1 and Task 4.
2. **Pre-market with no extended print.** `dayChange` is 0. Expected: not a mover. Pinned in Task 1.
3. **More than 5 qualifying holdings.** Expected: the 5 largest by × ATR, in descending order. Pinned in Task 1.
4. **A headline older than 24h, or none at all.** Expected: `headline: null`, and the row reads "No news found". Pinned in Tasks 2 and 4.
5. **Finnhub throws or is unconfigured.** Expected: the brief is still served, with movers that have `headline: null`. Pinned in Task 3.

---

### Task 1: Pure movers ranking

**Files:**
- Create: `backend/src/market-data/brief-movers.ts`
- Test: `backend/src/market-data/brief-movers.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface MoverInput { symbol: string; dayChange: number | null; dayChangePct: number | null; dayPnl: number | null; extended: boolean; stale: boolean; session: MarketSession | null }
  export interface MoverRow {
    symbol: string; changePct: number; atrMultiple: number; dollarChange: number | null;
    extended: boolean; stale: boolean; session: MarketSession | null;
    reasons: { code: string; label: string }[];
    headline: { title: string; source: string; url: string; at: string } | null;
    thesis: string | null;
  }
  export const MOVER_LIMIT = 5;
  export function rankMovers(positions: MoverInput[], atrBySymbol: ReadonlyMap<string, number>, reasonsBySymbol: ReadonlyMap<string, string[]>): MoverRow[];
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { rankMovers, type MoverInput } from './brief-movers.js';

function pos(symbol: string, dayChange: number | null, over: Partial<MoverInput> = {}): MoverInput {
  return { symbol, dayChange, dayChangePct: dayChange === null ? null : dayChange / 100, dayPnl: dayChange === null ? null : dayChange * 10, extended: false, stale: false, session: 'REGULAR', ...over };
}

describe('rankMovers', () => {
  it('keeps holdings that moved at least 1 ATR, largest first, with the portfolio\'s own figures', () => {
    const rows = rankMovers(
      [pos('SMALL', 1), pos('BIG', 6), pos('MID', 3)],
      new Map([['SMALL', 2], ['BIG', 2], ['MID', 2]]),
      new Map(),
    );
    expect(rows.map((r) => r.symbol)).toEqual(['BIG', 'MID']);
    expect(rows[0]).toEqual({
      symbol: 'BIG', changePct: 0.06, atrMultiple: 3, dollarChange: 60,
      extended: false, stale: false, session: 'REGULAR', reasons: [], headline: null, thesis: null,
    });
  });

  it('ranks a fall the same as a rise', () => {
    const rows = rankMovers([pos('UP', 3), pos('DOWN', -5)], new Map([['UP', 2], ['DOWN', 2]]), new Map());
    expect(rows.map((r) => r.symbol)).toEqual(['DOWN', 'UP']);
    expect(rows[0].atrMultiple).toBe(2.5);
  });

  it('keeps a short\'s signs from the portfolio: price up, position down', () => {
    const [row] = rankMovers([pos('SHRT', 4, { dayChangePct: 0.04, dayPnl: -400 })], new Map([['SHRT', 2]]), new Map());
    expect(row.changePct).toBe(0.04);
    expect(row.dollarChange).toBe(-400);
  });

  it('caps at five', () => {
    const symbols = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const rows = rankMovers(symbols.map((s, i) => pos(s, 10 + i)), new Map(symbols.map((s) => [s, 1])), new Map());
    expect(rows.map((r) => r.symbol)).toEqual(['G', 'F', 'E', 'D', 'C']);
  });

  it('skips a holding with no ATR, no move, or a zero move (pre-market without a print)', () => {
    const rows = rankMovers(
      [pos('NOATR', 9), pos('NOMOVE', null), pos('FLAT', 0)],
      new Map([['NOMOVE', 1], ['FLAT', 1]]),
      new Map(),
    );
    expect(rows).toEqual([]);
  });

  it('carries extended, stale and session for the screen to label', () => {
    const [row] = rankMovers([pos('X', 5, { extended: true, stale: true, session: 'PRE' })], new Map([['X', 2]]), new Map());
    expect(row).toMatchObject({ extended: true, stale: true, session: 'PRE' });
  });

  it('labels entry reasons from the shared vocabulary and drops unknown codes', () => {
    const [row] = rankMovers([pos('X', 5)], new Map([['X', 2]]), new Map([['X', ['ENTRY_BREAKOUT', 'ENTRY_VOLUME', 'NOT_A_CODE']]]));
    expect(row.reasons).toEqual([{ code: 'ENTRY_BREAKOUT', label: 'Breakout' }, { code: 'ENTRY_VOLUME', label: 'Volume' }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/market-data/brief-movers.spec.ts`
Expected: FAIL, because the module does not exist yet.

- [ ] **Step 3: Implement**

```ts
import type { MarketSession } from './market-session.js';
import { ENTRY_REASONS } from '../journal/reasons.js';

/**
 * The holdings that moved enough to matter today, measured in ATR so a
 * volatile name's ordinary day does not crowd out a quiet name's real move.
 * Takes the portfolio's own day-change figures (already session-aware: a
 * pre-market move is measured from the last close) rather than re-deriving
 * them, so the Brief can never disagree with the Portfolio screen.
 */

export interface MoverInput {
  symbol: string;
  dayChange: number | null;
  dayChangePct: number | null;
  dayPnl: number | null;
  extended: boolean;
  stale: boolean;
  session: MarketSession | null;
}

export interface MoverRow {
  symbol: string;
  changePct: number;
  atrMultiple: number;
  dollarChange: number | null;
  extended: boolean;
  stale: boolean;
  session: MarketSession | null;
  reasons: { code: string; label: string }[];
  headline: { title: string; source: string; url: string; at: string } | null;
  /** The AI's one-line thesis check — slice 4; null until then. */
  thesis: string | null;
}

export const MOVER_LIMIT = 5;
const MIN_ATR_MULTIPLE = 1;
const LABEL_BY_CODE = new Map(ENTRY_REASONS.map((r) => [r.code, r.label]));

export function rankMovers(
  positions: MoverInput[],
  atrBySymbol: ReadonlyMap<string, number>,
  reasonsBySymbol: ReadonlyMap<string, string[]>,
): MoverRow[] {
  const rows: MoverRow[] = [];
  for (const p of positions) {
    const atr = atrBySymbol.get(p.symbol);
    if (atr === undefined || !(atr > 0) || p.dayChange === null || p.dayChangePct === null) continue;
    const atrMultiple = Math.abs(p.dayChange) / atr;
    if (atrMultiple < MIN_ATR_MULTIPLE) continue;
    rows.push({
      symbol: p.symbol,
      changePct: p.dayChangePct,
      atrMultiple,
      dollarChange: p.dayPnl,
      extended: p.extended,
      stale: p.stale,
      session: p.session,
      reasons: (reasonsBySymbol.get(p.symbol) ?? []).flatMap((code) => {
        const label = LABEL_BY_CODE.get(code);
        return label ? [{ code, label }] : [];
      }),
      headline: null,
      thesis: null,
    });
  }
  return rows.sort((a, b) => b.atrMultiple - a.atrMultiple).slice(0, MOVER_LIMIT);
}
```

`FLAT` with a `0` move has `atrMultiple` 0, which is below 1, so it is skipped by the same rule.

- [ ] **Step 4: Run the tests and type-check**

Run: `cd backend && npx vitest run src/market-data/brief-movers.spec.ts && npx tsc --noEmit -p tsconfig.json`
Expected: the tests pass and tsc reports no errors.

- [ ] **Step 5: Commit**

Commit message: `feat(brief): rank today's movers by ATR from the portfolio's own day change`

---

### Task 2: NewsService.latestHeadline

**Files:**
- Modify: `backend/src/market-data/news.service.ts`
- Modify: `backend/src/market-data/market-data.module.ts` (add `NewsService` to `exports`)
- Test: `backend/src/market-data/news.service.spec.ts` (extend)

**Interfaces:**
- `NewsHeadline` gains `publishedAt: string` (ISO timestamp from Finnhub's `datetime`). `publishedOn` stays as it is for its existing callers.
- Produces:
  ```ts
  async latestHeadline(symbol: string, since: Date): Promise<{ title: string; source: string; url: string; at: string } | null>;
  ```
  It reuses `recentHeadlines(symbol)`, including that method's cache and its rule of never caching an empty list. It returns the newest item with `publishedAt >= since`, or `null`. It never throws.

- [ ] **Step 1: Write the failing tests**

Read the existing `news.service.spec.ts` and follow how it builds `NewsService` with a stubbed `FinnhubClient`. Add these tests:

```ts
describe('latestHeadline', () => {
  const now = Date.parse('2026-10-07T12:00:00Z') / 1000;
  const item = (headline: string, hoursAgo: number) => ({
    headline, summary: 's', source: 'Reuters', datetime: now - hoursAgo * 3600, url: `https://x.test/${headline}`,
  });

  it('is the newest headline inside the window, with its time', async () => {
    const service = new NewsService({ companyNews: async () => [item('older', 5), item('newest', 1), item('stale', 30)] } as never);
    await expect(service.latestHeadline('NVDA', new Date('2026-10-06T12:00:00Z'))).resolves.toEqual({
      title: 'newest', source: 'Reuters', url: 'https://x.test/newest', at: '2026-10-07T11:00:00.000Z',
    });
  });

  it('is null when every headline is older than the window', async () => {
    const service = new NewsService({ companyNews: async () => [item('stale', 30)] } as never);
    await expect(service.latestHeadline('NVDA', new Date('2026-10-06T12:00:00Z'))).resolves.toBeNull();
  });

  it('is null, not an error, when the provider gives nothing', async () => {
    const service = new NewsService({ companyNews: async () => [] } as never);
    await expect(service.latestHeadline('NVDA', new Date('2026-10-06T12:00:00Z'))).resolves.toBeNull();
  });
});
```

Also assert, in an existing `recentHeadlines` test or a new one, that `publishedAt` is the ISO form of `datetime * 1000`.

Run: `cd backend && npx vitest run src/market-data/news.service.spec.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

- In `recentHeadlines`, add `publishedAt: new Date(r.datetime * 1000).toISOString()` to the mapped object, and add `publishedAt: string;` to `NewsHeadline`.
- Add the method below.
- Add `NewsService` to `MarketDataModule`'s `exports`.

```ts
  /**
   * The newest headline published since `since`, for the Brief's movers —
   * "why did it move" wants today's news, not last week's. Never throws:
   * `recentHeadlines` already swallows provider failures into an empty list.
   */
  async latestHeadline(
    symbol: string,
    since: Date,
  ): Promise<{ title: string; source: string; url: string; at: string } | null> {
    const newest = (await this.recentHeadlines(symbol)).find(
      (h) => Date.parse(h.publishedAt) >= since.getTime(),
    );
    return newest
      ? { title: newest.headline, source: newest.source, url: newest.url, at: newest.publishedAt }
      : null;
  }
```

`recentHeadlines` already sorts newest first, so the first match is the newest one.

- [ ] **Step 3: Run the tests**

Run: `cd backend && npx vitest run src/market-data && npx tsc --noEmit -p tsconfig.json`
Expected: the tests pass and tsc reports no errors.

- [ ] **Step 4: Commit**

Commit message: `feat(news): latest headline since a time, with its timestamp`

---

### Task 3: Service, response and AI facts — movers replace holding notes

**Files:**
- Modify: `backend/src/market-data/daily-brief.service.ts`, `daily-brief.service.spec.ts`
- Modify: `backend/src/llm/daily-brief-context.ts`, `daily-brief-context.spec.ts`

**Interfaces:**
- Consumes:
  - `rankMovers` and `MoverRow` (Task 1);
  - `NewsService.latestHeadline` (Task 2);
  - `priorAtr`;
  - the existing `this.openTradeEntries()` (slice 2), for the reasons;
  - `portfolio.positions[]`, which has `dayChange`, `dayChangePct`, `dayPnl`, `extended`, `stale` and `session`.
- Produces:
  - `DailyBriefResponse` gains `movers: MoverRow[]` and loses `holdingNotes`. The `HoldingNote` type, `HOLDING_NOTE_PRIORITY`, and the per-holding `buildDailyBriefNotes` loop and its stop-suffix code are deleted. The watch-row loop that builds `watchTriggers` stays.
  - `BriefFacts` gains `movers` and loses `holdingNotes`. The cache signature replaces the holding-notes part with `movers: facts.movers.map((m) => [m.symbol, m.headline?.url ?? null])`.
  - `DailyBriefContextInput` swaps `holdingNotes: ContextLine[]` for `movers: ContextMover[]`, where `ContextMover = { symbol: string; changePct: number; atrMultiple: number; dollarChange: number | null; extended: boolean; stale: boolean; headline: { title: string; source: string } | null }`.
  - The constructor gains a trailing optional `news?: NewsService`.

- [ ] **Step 1: AI facts — failing tests**

In `daily-brief-context.spec.ts`:
- In the `input()` defaults, replace `holdingNotes: []` with `movers: []`.
- Update any test that used `holdingNotes`, so it uses `queue` or `movers` instead.
- Add these tests:

```ts
  it('writes each mover with figures as given and its headline', () => {
    const facts = buildDailyBriefContext(input({
      movers: [
        { symbol: 'NVDA', changePct: 0.042, atrMultiple: 2.31, dollarChange: 1234.5, extended: false, stale: false, headline: { title: 'Nvidia wins deal', source: 'Reuters' } },
        { symbol: 'MRNA', changePct: 0.03, atrMultiple: 1.2, dollarChange: -600, extended: true, stale: false, headline: null },
      ],
    }));
    expect(facts).toContain('Movers\n- NVDA: +4.20% since prior close (2.3× ATR), +$1234.50 on the position. Headline: "Nvidia wins deal" (Reuters)');
    expect(facts).toContain('- MRNA: +3.00% since prior close (1.2× ATR), -$600.00 on the position (extended-hours print). No headline found.');
  });

  it('says plainly when nothing moved enough', () => {
    expect(buildDailyBriefContext(input())).toContain('- No holding moved 1 ATR or more.');
  });
```

Run the spec. Expected: FAIL.

- [ ] **Step 2: Implement the facts section**

In `daily-brief-context.ts`:
- Add the `ContextMover` interface.
- Replace the `Your holdings` section with a `Movers` block, placed where holdings was (after `Needs attention`).
- Each line is built from these parts, in order:
  1. `- ${symbol}: ${percent(changePct)} since prior close (${atrMultiple.toFixed(1)}× ATR)`
  2. if `dollarChange !== null`: `, ${money(dollarChange)} on the position`, where `money` is a signed `$` amount with 2 decimals and no thousands grouping, e.g. `+$1234.50` or `-$600.00`;
  3. if `extended`: ` (extended-hours print)`;
  4. if `stale`: ` (stale)`;
  5. `. `;
  6. if `headline` is present: `Headline: "${title}" (${source})`, otherwise `No headline found.`
- When the list is empty, the block is `- No holding moved 1 ATR or more.`

Run the context spec. Expected: PASS.

- [ ] **Step 3: Service — failing tests**

In `daily-brief.service.spec.ts`:
- Delete the tests that assert on `holdingNotes`: the missing/partial stop suffixes, momentum/ATR notes on holdings, and the held-and-watched test's `holdingNotes` assertion. Keep that test's `watchTriggers: []` assertion.
- The queue already covers stop status.
- Add a `newsStub(headline)` helper: `{ latestHeadline: vi.fn().mockResolvedValue(headline) }`.
- `news` is the constructor argument after `trades`.
- Add these tests:

```ts
  describe('movers', () => {
    // 15 bars at 100 with high 101 / low 99 give priorAtr = 2.
    const flat = (instrumentId: string) => Array.from({ length: 16 }, (_, i) => ({
      instrumentId, date: `2026-09-${String(i + 10).padStart(2, '0')}`,
      close: 100, adjClose: 100, open: 100, high: 101, low: 99, volume: 1_000_000,
    }));
    const position = (symbol: string, dayChange: number) => ({
      symbol, price: 100 + dayChange, regularPrice: 100, stale: false, session: 'REGULAR', extended: false,
      daysUntilEarnings: null, marketValue: 10_000, dayChange, dayChangePct: dayChange / 100, dayPnl: dayChange * 100,
    });

    it('serves holdings that moved 1 ATR or more, with a headline and entry reasons', async () => {
      const news = { latestHeadline: vi.fn().mockResolvedValue({ title: 'Deal', source: 'Reuters', url: 'https://x.test', at: '2026-10-07T13:00:00.000Z' }) };
      const service = new DailyBriefService(
        ...deps({ positions: [position('NVDA', 5), position('QUIET', 1)], instruments: [{ id: 'i-n', symbol: 'NVDA' }, { id: 'i-q', symbol: 'QUIET' }], bars: [...flat('i-n'), ...flat('i-q')] }),
        undefined, undefined, undefined,
        tradesStub([{ symbol: 'NVDA', direction: 'LONG', enteredAt: new Date('2026-09-01T14:00:00Z'), reasons: ['ENTRY_BREAKOUT'] }]),
        news as any,
      );
      const result = await service.get({ now: new Date('2026-10-07T15:00:00Z') });
      expect(result.movers).toEqual([expect.objectContaining({
        symbol: 'NVDA', atrMultiple: 2.5, dollarChange: 500,
        reasons: [{ code: 'ENTRY_BREAKOUT', label: 'Breakout' }],
        headline: { title: 'Deal', source: 'Reuters', url: 'https://x.test', at: '2026-10-07T13:00:00.000Z' },
        thesis: null,
      })]);
      expect(news.latestHeadline).toHaveBeenCalledWith('NVDA', new Date('2026-10-06T15:00:00Z'));
      expect(news.latestHeadline).toHaveBeenCalledTimes(1); // only movers ask for news
      expect(result).not.toHaveProperty('holdingNotes');
    });

    it('serves movers without headlines when the news lookup fails', async () => {
      const news = { latestHeadline: vi.fn().mockRejectedValue(new Error('finnhub down')) };
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      try {
        const service = new DailyBriefService(
          ...deps({ positions: [position('NVDA', 5)], instruments: [{ id: 'i-n', symbol: 'NVDA' }], bars: flat('i-n') }),
          undefined, undefined, undefined, undefined, news as any,
        );
        const result = await service.get({ now: new Date('2026-10-07T15:00:00Z') });
        expect(result.movers).toEqual([expect.objectContaining({ symbol: 'NVDA', headline: null })]);
      } finally {
        warn.mockRestore();
      }
    });

    it('hands movers to the AI and re-asks when a new headline arrives', async () => {
      const complete = vi.fn().mockResolvedValue('NVDA is moving on news.');
      const llm = { isConfigured: () => true, complete } as any;
      const news = { latestHeadline: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ title: 'Deal', source: 'Reuters', url: 'https://x.test', at: '2026-10-07T13:00:00.000Z' }) };
      const service = new DailyBriefService(
        ...deps({ positions: [position('NVDA', 5)], instruments: [{ id: 'i-n', symbol: 'NVDA' }], bars: flat('i-n') }),
        llm, undefined, undefined, undefined, news as any,
      );
      await service.get({ now: new Date('2026-10-07T15:00:00Z') });
      expect(complete.mock.calls[0][0].user).toContain('Movers\n- NVDA:');
      await service.get({ now: new Date('2026-10-07T15:05:00Z') });
      expect(complete).toHaveBeenCalledTimes(2);
    });
  });
```

If `deps()` doesn't pass `dayChange`/`dayPnl` through, it doesn't need to: `positions` are given verbatim. If the bars fixture gives a different `priorAtr`, compute the real value and adjust `atrMultiple`/`dayChange`. Keep the ATR at 2 and the moves at 5 and 1, so one name qualifies and the other does not.

Run the spec. Expected: FAIL.

- [ ] **Step 4: Implement the service**

In `daily-brief.service.ts`:
1. Import `NewsService` from `./news.service.js` and `rankMovers`/`MoverRow` from `./brief-movers.js`. Append `private readonly news?: NewsService,` to the constructor, after `trades`. Nest injects it, because `MarketDataModule` now exports it.
2. Delete:
   - the `HoldingNote` interface;
   - `HOLDING_NOTE_PRIORITY`;
   - the per-position `buildDailyBriefNotes` loop, together with the `symbolsWithoutStop`/`partialStopBySymbol` suffix maps if nothing else uses them;
   - `holdingNotes` from the response, `BriefFacts` and the return value.

   The queue still reads `atRisk` directly.
3. Build an `atrBySymbol` map once (it is already built for the queue). Reuse it for movers rather than computing `priorAtr` twice.
4. Rank the movers:
   ```ts
   const ranked = rankMovers(
     portfolio.positions.map((p: any) => ({
       symbol: p.symbol, dayChange: p.dayChange ?? null, dayChangePct: p.dayChangePct ?? null,
       dayPnl: p.dayPnl ?? null, extended: p.extended ?? false, stale: p.stale ?? true, session: p.session ?? null,
     })),
     atrBySymbol,
     new Map(openEntries.map((e) => [e.symbol, e.reasons])),
   );
   const movers = await this.attachHeadlines(ranked, now);
   ```
   Type the `positions` element properly if the portfolio return type allows it. Avoid `any` if you can.
5. Add `attachHeadlines`:
   ```ts
   /** One headline per mover from the last 24 hours. Never throws: news is enrichment. */
   private async attachHeadlines(movers: MoverRow[], now: Date): Promise<MoverRow[]> {
     if (!this.news || movers.length === 0) return movers;
     const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
     return Promise.all(movers.map(async (m) => {
       try {
         return { ...m, headline: await this.news!.latestHeadline(m.symbol, since) };
       } catch (err) {
         this.logger.warn(`daily brief headline for ${m.symbol} failed: ${err instanceof Error ? err.message : String(err)}`);
         return m;
       }
     }));
   }
   ```
6. Pass `movers` into `BriefFacts`, mapped to `ContextMover` (`headline` reduced to `{ title, source }`). Pass it into the response too. Update the cache signature as described in Interfaces above.

Run: `cd backend && npx vitest run src/market-data src/llm src/portfolio && npx tsc --noEmit -p tsconfig.json`, then `npm run test:e2e --prefix backend`.
Expected: all pass. If an e2e spec read `holdingNotes`, update it and say so.

- [ ] **Step 5: Commit**

Commit message: `feat(brief): serve movers with headlines in place of holding notes`

---

### Task 4: Frontend — the Movers section

**Files:**
- Modify: `frontend/src/api/dailyBrief.ts`
- Create: `frontend/src/components/brief/MoverList.tsx`
- Modify: `frontend/src/routes/Brief.tsx`, `frontend/src/routes/Brief.spec.tsx`

**Interfaces:**
- `BriefResponse` gains `movers: BriefMover[]` and loses `holdingNotes`.
  ```ts
  export interface BriefMover {
    symbol: string; changePct: number; atrMultiple: number; dollarChange: number | null;
    extended: boolean; stale: boolean; session: MarketSession | null;
    reasons: { code: string; label: string }[];
    headline: { title: string; source: string; url: string; at: string } | null;
    thesis: string | null;
  }
  ```

- [ ] **Step 1: Write the failing tests**

In `Brief.spec.tsx`:
- In `initialBrief`, replace `holdingNotes` with:
  ```ts
  movers: [{
    symbol: 'NVDA', changePct: 0.042, atrMultiple: 2.31, dollarChange: 1234.5, extended: false, stale: false, session: 'REGULAR',
    reasons: [{ code: 'ENTRY_BREAKOUT', label: 'Breakout' }],
    headline: { title: 'Nvidia wins deal', source: 'Reuters', url: 'https://news.test/nvda', at: '2026-09-17T07:00:00.000Z' },
    thesis: null,
  }]
  ```
- Update every test that referred to the Holdings region or to holding-note titles. The ordering test becomes Market → Needs attention → Movers.
- Delete the "No holding or watch signals right now." test, because that line is removed.
- Add these tests:

```ts
it('shows each mover with its move, dollars, reasons and today\'s headline', async () => {
  (api as ReturnType<typeof vi.fn>).mockResolvedValue(initialBrief);
  renderBrief();
  const movers = await screen.findByRole('region', { name: 'Movers' });
  expect(movers).toHaveTextContent('NVDA');
  expect(movers).toHaveTextContent('+4.20%');
  expect(movers).toHaveTextContent('2.3× ATR');
  expect(movers).toHaveTextContent('+$1,234.50');
  expect(within(movers).getByText('Breakout')).toBeInTheDocument();
  const headline = within(movers).getByRole('link', { name: /Nvidia wins deal/ });
  expect(headline).toHaveAttribute('href', 'https://news.test/nvda');
  expect(headline).toHaveAttribute('target', '_blank');
  expect(headline).toHaveAttribute('rel', expect.stringContaining('noopener'));
  expect(movers).toHaveTextContent('Reuters');
  expect(within(movers).getByRole('link', { name: 'NVDA' })).toHaveAttribute('href', '/?symbol=NVDA');
});

it('says when a mover has no news', async () => {
  (api as ReturnType<typeof vi.fn>).mockResolvedValue({ ...initialBrief, movers: [{ ...initialBrief.movers[0], headline: null }] });
  renderBrief();
  const movers = await screen.findByRole('region', { name: 'Movers' });
  expect(movers).toHaveTextContent('No news found');
});

it('shows a short\'s signs as served: price up, position down', async () => {
  (api as ReturnType<typeof vi.fn>).mockResolvedValue({ ...initialBrief, movers: [{ ...initialBrief.movers[0], changePct: 0.03, dollarChange: -600 }] });
  renderBrief();
  const movers = await screen.findByRole('region', { name: 'Movers' });
  expect(movers).toHaveTextContent('+3.00%');
  expect(movers).toHaveTextContent('-$600.00');
});

it('labels a stale or extended-hours mover', async () => {
  (api as ReturnType<typeof vi.fn>).mockResolvedValue({ ...initialBrief, movers: [{ ...initialBrief.movers[0], stale: true, extended: true, session: 'POST' }] });
  renderBrief();
  const movers = await screen.findByRole('region', { name: 'Movers' });
  expect(within(movers).getByText('STALE')).toBeInTheDocument();
  expect(within(movers).getByText('AFTER HOURS')).toBeInTheDocument();
});

it('hides Movers when nothing moved enough, and no longer shows a Holdings list', async () => {
  (api as ReturnType<typeof vi.fn>).mockResolvedValue({ ...initialBrief, movers: [] });
  renderBrief();
  await screen.findByRole('region', { name: 'Market' });
  expect(screen.queryByRole('region', { name: 'Movers' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Holdings' })).not.toBeInTheDocument();
});
```

Run: `cd frontend && npx vitest run src/routes/Brief.spec.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement**

`frontend/src/components/brief/MoverList.tsx`:
- Render `null` when `movers` is empty. Otherwise render `<section aria-label="Movers">` with an `<h2>` reading "Movers", styled like `BriefNoteList`'s heading.
- One card per mover, using the card classes `BriefNoteList` uses:
  - **Top line:**
    - A `Link` to `/?symbol=${encodeURIComponent(symbol)}`. Its text is exactly the symbol, so its accessible name is the symbol.
    - The change: `<span className={signClass(changePct)}>{formatPercent(changePct)}</span>`.
    - `{atrMultiple.toFixed(1)}× ATR`, muted.
    - When `dollarChange !== null`: `<span className={signClass(dollarChange)}>{formatMoney(dollarChange, { signed: true })}</span>`.
    - `<SessionBadge session={session} extended />` when `extended`.
    - The same `STALE` marker style as `MoodLine` when `stale`.
  - **Reason chips:** one small rounded `bg-surface-2` chip per reason, showing `label`.
  - **Headline:** when present, `<a href={url} target="_blank" rel="noopener noreferrer">{title}</a>`, followed by a muted `{source} · {formatTimestamp(at)}`. When absent, a muted "No news found".
  - When `thesis` is set, render it as a muted line. It is always null until slice 4.

`Brief.tsx`:
- Replace `<BriefNoteList label="Holdings" … />` with `<MoverList movers={brief.movers} />`.
- Keep `Watch triggers` after it.
- Delete the "No holding or watch signals right now." block.

`dailyBrief.ts`: update the types as described above.

- [ ] **Step 3: Run the tests and type-check**

Run: `cd frontend && npx vitest run src/routes/Brief.spec.tsx && npx tsc -b && cd .. && npm test`
Expected: the tests pass and tsc reports no errors.

- [ ] **Step 4: Run the browser suite**

Run: `npm run test:browser`
Expected: all pass. The e2e stub's flat bars give moves below 1 ATR, so no Movers section is shown and none of the existing tests depend on one. If a test referred to "Holdings" on the Brief, update it and say so.

- [ ] **Step 5: Commit**

Commit message: `feat(brief): movers section with headlines replaces holding notes`
