# ATR Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Each task is shipped (pushed to `main` and deployed) on its own once reviewed — owner's hard rule. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A `Show ATR` toggle on Holdings and Watchlist that adds ATR% and Today% columns (green/red when the move exceeds ATR), with sortable column headers — delivered as three independently shippable tasks.

**Architecture:** Backend `market` module: slim `YahooClient` regains `dailyBars` and `quote`; pure `atr.ts` and `session.ts`; `MovesService` with in-memory caches; `GET /market/moves`. Frontend: a shared `useMoves(symbols, enabled)` hook and a table mode in both list screens; then header sorting that returns to "My order".

**Tech Stack:** NestJS, yahoo-finance2, Vitest, React + TanStack Query, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-atr-columns-design.md`

## Global Constraints

- Only `backend/src/market-data/yahoo.client.ts` imports yahoo-finance2. Revived code comes from `backend/lib/market-data/` (copy what's needed into `src/` as small modules with their specs; leave the lib files in place).
- ATR = Wilder's 14-period ATR over **completed regular-session daily bars**, true range = max(high − low, |high − prevClose|, |low − prevClose|); `atrPercent = ATR / reference close × 100`, rounded to 1 decimal.
- Session rule (America/New_York, US market holidays and early closes from the parked `market-session.ts`): during the regular session (09:30–16:00, or the early close) `live = true`, move = (regularMarketPrice − previous close) / previous close; ATR from the 14 completed sessions before today. Otherwise `live = false`, move = last completed session close vs the close before it; ATR from the 14 completed sessions before that last session. `asOf` = the ET date of the session the move belongs to.
- Pre-market and after-hours prices are never used.
- Null (`—`) when fewer than 15 usable bars, missing quote fields, or provider failure.
- Backend computes all numbers and rounding; the frontend displays, colours (|move| > ATR: up green `text-up`, down red `text-down`; equal → no colour) and sorts.
- Tests never reach the network; never touch the local `trader` DB or a DATABASE_URL.
- Local `main` only; the controller pushes and deploys after each task's review.
- Commit trailers: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01KSLpjvWMhkHqfbWoTYBnE1`.

## Review Focus

1. **Gap day** — true range must use the previous close when the bar gaps; pinned in Task 1 unit test.
2. **Today's partial bar** — Yahoo's chart can include today's in-progress bar during the session; it must be excluded from ATR and from the "completed sessions" list; pinned in Task 1.
3. **Holiday / early close / weekend** — `live` and `asOf` correct (e.g. Thanksgiving 2026-11-26, the 13:00 early close 2026-11-27); pinned in Task 1.
4. **Narrow phone** — table with two extra columns fits 402px without horizontal overflow; pinned in Task 2 browser test.
5. **Sort with `—` rows** — always last, both directions; pinned in Task 3.

---

### Task 1: `GET /market/moves` (backend only — invisible to the owner)

**Files:**
- Modify: `backend/src/market-data/yahoo.client.ts` (+ spec), `backend/test/yahoo-stub.ts`, `backend/src/legacy-api-prefix.ts` (+ spec: add `/market`), `backend/src/app.module.ts`, `docs/api.md`
- Create: `backend/src/market-data/atr.ts` (+ spec), `backend/src/market-data/session.ts` (+ spec, adapted from `backend/lib/market-data/market-session.ts` and `trading-day.ts`: holidays, early closes, `isRegularSessionOpen(now)`, `completedSessionDates(...)` as needed), `backend/src/market/moves.service.ts` (+ spec), `backend/src/market/market.controller.ts`, `backend/src/market/market.module.ts`, `backend/test/market.e2e-spec.ts`

**Interfaces — Produces:**

```ts
// yahoo.client.ts additions
export interface DailyBar { date: string; open: number | null; high: number | null; low: number | null; close: number } // regular session, date = ET YYYY-MM-DD
export interface RegularQuote { price: number; previousClose: number }
YahooClient.dailyBars(symbol: string, from: Date): Promise<DailyBar[]>; // throws on provider failure
YahooClient.quote(symbol: string): Promise<RegularQuote | null>;        // regularMarketPrice + regularMarketPreviousClose; null when absent

// atr.ts
export function wilderAtr(bars: { high: number | null; low: number | null; close: number }[], period = 14): number | null; // bars oldest→newest, needs period+1 bars

// moves.service.ts
export interface Move { symbol: string; atrPercent: number | null; movePercent: number | null; live: boolean; asOf: string | null }
MovesService.moves(symbols: string[], now = new Date()): Promise<Move[]>; // same order as input, upper-cased, de-duplicated
// GET /market/moves?symbols=A,B  (1..60 after trimming/dedupe; otherwise 400)
```

- Caches: bars per symbol keyed by ET date (fetch ~45 calendar days back), quote per symbol 60 s. Fetch at most 5 symbols at a time. A failing symbol yields nulls without failing the request.
- Port `computeAtr` behaviour from `lib/market-data/indicators.ts`, but make it Wilder-smoothed if it isn't, and document it.
- Tests: ATR on a fixed 15/20-bar series (hand-computed expected value), gap day, <15 bars → null; session rule cases (Thu 11:00 ET live; Thu 17:00 ET after close → asOf Thu; Fri 08:00 ET pre-market → asOf Thu; Sat → asOf Fri; 2026-11-26 Thanksgiving → asOf Wed 11-25; 2026-11-27 13:30 ET after early close → not live, asOf 11-27); partial today bar excluded while live; rounding; e2e with stub bars/quotes incl. an unknown symbol → nulls and a 61-symbol request → 400.
- Commit: `feat(market): GET /market/moves — daily ATR% and regular-session move%`

### Task 2: `Show ATR` toggle and columns

**Files:** Create `frontend/src/api/moves.ts` (`useMoves(symbols, enabled)`); modify `frontend/src/routes/Holdings.tsx`, `Watchlist.tsx` and their row component (`ReorderableList.tsx`) (+ specs); `e2e/atr.spec.ts`; `backend/src/main.e2e.ts` (stub bars/quotes so the browser test shows numbers); docs (`docs/current-state.md`).

- Toggle button `Show ATR` / `Hide ATR` (aria-pressed) next to the edit pencil on both screens; state persisted via `usePersistentState` with TTL `Infinity`, keys `trader.holdings.atr.v1` / `trader.watchlist.atr.v1`.
- When on: a header row `Ticker · ATR · Today` (`Today (close)` when every returned move has `live: false`), and per row `3.2%` and `+4.1%` / `−2.3%` (real minus sign, 1 decimal, `+` for positive, `0.0%` for zero); `—` for nulls. Row colour rule from Global Constraints applied to the ticker and the Today cell.
- Fetch only when on; `refetchInterval` 60 s while any returned move is `live`, otherwise none.
- Off: the screen renders exactly as today.
- Specs: toggle shows/hides columns and persists; formatting; colours up/down/equal/null; header text live vs close; no fetch when off. Browser: at 402px with the toggle on, no horizontal overflow and the stubbed values visible.
- Commit: `feat(frontend): Show ATR — ATR% and today's move on holdings and watchlist`

### Task 3: Sort by column

**Files:** modify `Holdings.tsx`, `Watchlist.tsx`, a small pure `frontend/src/lib/sortRows.ts` (+ spec), route specs, `e2e/atr.spec.ts`.

- In table mode, headers `Ticker`, `ATR`, `Today` are buttons. Cycle: first tap descending (Ticker: A–Z first), second ascending, third back to **My order** (server order). Active header shows ▼/▲; `aria-sort` set.
- `—` rows last in both directions; ties by symbol.
- Entering edit mode resets to My order; drag handles appear only in My order.
- Persist per screen: `trader.holdings.sort.v1` / `trader.watchlist.sort.v1`, TTL `Infinity`.
- Specs: cycle, null placement, edit-mode reset, persistence. Browser: tap `Today` sorts the stubbed rows.
- Commit: `feat(frontend): sort holdings and watchlist by ticker, ATR or today's move`
