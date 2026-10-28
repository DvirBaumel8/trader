# Earnings Week + Slim Market Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove unused market-data code from the running app (parked in `backend/lib/market-data/`), switch the chat router to `gemini-3.5-flash-lite` with a clear rate-limit error, and add an Earnings tab showing this week's earnings for holdings and watchlist as a Mon–Fri grid.

**Architecture:** `YahooClient` shrinks to `lookup(symbol)` and `nextEarnings(symbol)`. `InstrumentsService` validates tickers via `lookup`. A new `earnings` module computes the ET week (pure), classifies timing (pure), caches next-earnings on `instruments` (new columns), and serves `GET /earnings/week`. The frontend adds an `Earnings` route with a 5-column grid and a Both/Holdings/Watchlist filter.

**Tech Stack:** NestJS, TypeORM migrations, yahoo-finance2, Vitest, React + TanStack Query + Tailwind, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-earnings-week-and-slim-market-data-design.md`

## Global Constraints

- `backend/src/market-data/yahoo.client.ts` is the only Yahoo import in `src/`; `backend/src/llm/llm.client.ts` the only AI SDK import.
- Nothing in `backend/src` imports from `backend/lib`. `backend/lib/**` is excluded from `tsconfig.json`, `tsconfig.build.json` and both vitest configs.
- No migration drops or truncates anything. The one new migration adds `instruments."nextEarningsAt" timestamptz NULL` and `instruments."nextEarningsEstimated" boolean NOT NULL DEFAULT false`, registered by hand in `data-source.ts`.
- Week = Mon–Fri of the current week in `America/New_York`; on Saturday/Sunday the coming week.
- Timing in ET: `< 09:30` → `before_open`; `>= 16:00` → `after_close`; otherwise `during`; no time → `unknown`.
- The backend computes week, timing, de-dup (holding wins over watchlist) and sort order (before_open, during, after_close, unknown, then symbol). The frontend only filters by `source` and draws.
- Router model default `gemini-3.5-flash-lite`. On Gemini 429: `{ kind: 'error', message: "Gemini's free limit is reached — try again in a minute." }`, no prompt.
- Tests never reach the network (Yahoo and LlmClient stubbed). Never touch the local `trader` DB or a DATABASE_URL in tests.
- Local `main` only; push only in Task 6.
- Commit trailers: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01KSLpjvWMhkHqfbWoTYBnE1`.

## Review Focus

1. **DST and ET date boundary** — a report at 2026-11-02T13:30Z is 08:30 ET (before open) after DST ends; a Sunday 23:00 ET request belongs to the coming week; pinned in Task 4 unit tests.
2. **Symbol on both lists** — appears once, as `holding`; pinned in Task 4.
3. **Yahoo fails for one symbol** — others still show, the failed one keeps its old cache and isn't re-fetched on every load; pinned in Task 4.
4. **Five-letter tickers in a 70px column** — no overflow at 402px; pinned in Task 5 browser test.
5. **Ticker validation after the slim** — unknown tickers still rejected on add (holdings, watchlist, chat buy); pinned by existing e2e specs staying green in Task 1.

---

### Task 1: Park unused market-data code; slim Yahoo to lookup + earnings

**Files:**
- Move (git mv) to `backend/lib/market-data/`: from `backend/src/market-data/` — `market-data.service.ts`, `twelvedata.client.ts`, `extended-print-freshness.ts`, `market-session.ts`, `select-price.ts`, `trading-day.ts`, `history.service.ts`, `daily-close.entity.ts`, `moving-average.ts`, `indicators.ts`, and their `.spec.ts` files; also copy the current `yahoo.client.ts` and `yahoo.client.spec.ts` there as `yahoo.client.full.ts` / `yahoo.client.full.spec.ts` before slimming.
- Create: `backend/lib/market-data/README.md`.
- Rewrite: `backend/src/market-data/yahoo.client.ts` (+ spec), `backend/src/market-data/market-data.module.ts`, `backend/src/instruments/instruments.service.ts` (+ module), `backend/src/holdings/holdings.service.ts`, `backend/src/watchlist/watchlist.service.ts` (+ both modules), `backend/test/yahoo-stub.ts`, `backend/src/main.e2e.ts`.
- Modify: `backend/tsconfig.json` (add `"exclude": ["node_modules", "dist", "lib"]`), `backend/tsconfig.build.json` (add `"lib"` to exclude), `backend/vitest.config.ts` and `backend/vitest.config.e2e.ts` (add `exclude: ['lib/**', 'node_modules/**', 'dist/**']`), `.env.example` (remove TWELVEDATA), docs mentioning Twelve Data / price history as current (`AGENTS.md`, `docs/current-state.md`, `docs/DEPLOYMENT.md`, `docs/api.md`) — describe them as parked in `backend/lib/market-data`.

**Interfaces — Produces:**

```ts
// backend/src/market-data/yahoo.client.ts
export interface TickerInfo { symbol: string; name: string | null }
export interface NextEarnings { at: Date; estimated: boolean }
export class YahooClient {
  /** null when Yahoo has no such symbol. Throws on provider failure. */
  lookup(symbol: string): Promise<TickerInfo | null>;
  /** null when Yahoo has no upcoming earnings date (ETFs included). Throws on provider failure. */
  nextEarnings(symbol: string): Promise<NextEarnings | null>;
}
// MarketDataModule: providers [YahooClient], exports [YahooClient]
// InstrumentsService.findOrCreate(symbol) unchanged signature; NotFoundException when lookup returns null;
//   a provider throw also becomes NotFoundException (same as today's getQuote-null behaviour).
```

- [ ] **Step 1: Move files** with `git mv` as listed; copy the full Yahoo client into lib. Write `backend/lib/market-data/README.md`:

```md
# Parked market-data library

Not loaded by the app. Kept for later features (prices, history, moving averages,
extended-hours quotes). Excluded from the build and from test runs; imports may
point at paths that no longer exist. To revive something, move it back under
`src/`, fix its imports and re-enable its spec.
```

- [ ] **Step 2: Slim `yahoo.client.ts`** to the two methods. `lookup` uses `yf.quote(symbol)` and returns `{ symbol: upper, name: q.longName ?? q.shortName ?? null }` or null when the result is empty/has no symbol. `nextEarnings` uses `yf.quoteSummary(symbol, { modules: ['calendarEvents'] })`, takes `calendarEvents.earnings.earningsDate[0]` (a Date) and `isEarningsDateEstimate`; returns null when absent; a "No fundamentals data found" error (ETFs) returns null; other errors throw. Keep the constructor's optional injected `yf` for tests and the doc comment that this is the only Yahoo import. Rewrite `yahoo.client.spec.ts` with an injected fake `yf` covering: lookup found / not found; nextEarnings date+estimated, no date → null, "No fundamentals data found" → null, other error → throws.

- [ ] **Step 3: Instruments, holdings, watchlist.** `InstrumentsService` injects `YahooClient` (drop `MarketDataService` and the `forwardRef` cycle if no longer needed) and calls `lookup`. Remove `HistoryService` and every `ensurePriced` call from `HoldingsService` and `WatchlistService` and their modules.

- [ ] **Step 4: Test stubs.** `backend/test/yahoo-stub.ts` exports a stub with `lookup(symbol)` (null for `ZZZZ…`, else `{symbol, name: \`${SYMBOL} Inc\`}`) and `nextEarnings(symbol)` driven by an exported mutable `STUB_EARNINGS: Record<string, { at: string; estimated: boolean } | null>` (default `{}` → null). Keep `STUB_PRICES` only if something still uses it; otherwise remove. Update `main.e2e.ts` to the new stub.

- [ ] **Step 5: Config excludes and docs** as listed.

- [ ] **Step 6: Verify** `cd backend && npx tsc --noEmit -p tsconfig.json && npx tsc -p tsconfig.build.json --noEmit && npm test && npm run test:e2e` — existing holdings/watchlist/assistant e2e (including unknown-ticker rejection) must pass unchanged in behaviour; `grep -rn "lib/market-data\|from '\.\./\.\./lib" backend/src` returns nothing.

- [ ] **Step 7: Commit** `refactor(backend): park unused market-data code in backend/lib; slim Yahoo to lookup and earnings`

---

### Task 2: Router model and rate-limit error

**Files:** Modify `backend/src/llm/llm.client.ts` (+ spec), `backend/src/assistant/assistant.service.ts` (+ spec), `docs/ai-configuration.md`, `.env.example`; Mac host env is changed by the controller in Task 6.

**Interfaces — Produces:** `export class LlmRateLimitError extends Error {}` thrown by `GeminiClient.generateJson` when the SDK error is an `ApiError` with status 429 (or the message contains `RESOURCE_EXHAUSTED`). `export const RATE_LIMIT_MESSAGE = "Gemini's free limit is reached — try again in a minute."` in assistant.service.ts.

- [ ] **Step 1: Tests first.** assistant.service.spec: model stub throws `new LlmRateLimitError('429')` → reply `{ kind: 'error', message: RATE_LIMIT_MESSAGE }` and no writes; a generic `Error('timeout')` still → prompt with `FALLBACK_NOTE`. llm.client.spec: default model is `gemini-3.5-flash-lite` when `LLM_MODEL` unset (expose a `modelName()` getter for the test), and a pure exported `toLlmError(err)` maps an `ApiError`-like `{status: 429}` and a `RESOURCE_EXHAUSTED` message to `LlmRateLimitError`, other errors unchanged.
- [ ] **Step 2: Run → FAIL. Step 3: Implement.** Default model `'gemini-3.5-flash-lite'`. Wrap the call's rejection through `toLlmError`. In `AssistantService.handle`, catch `LlmRateLimitError` before the generic fallback.
- [ ] **Step 4: Docs** — ai-configuration.md: model `gemini-3.5-flash-lite` (measured 12/12, ~0.7 s, 15 req/min free on 2026-10-29), 429 behaviour. `.env.example`: `LLM_MODEL=gemini-3.5-flash-lite` (commented).
- [ ] **Step 5: Verify** backend unit + e2e. **Commit** `feat(assistant): gemini-3.5-flash-lite router; clear error on the free rate limit`

---

### Task 3: Earnings data — migration, cache, pure week/timing

**Files:**
- Create: `backend/src/database/migrations/1790121600000-AddNextEarnings.ts`, `backend/src/earnings/week.ts` (+ spec), `backend/src/earnings/timing.ts` (+ spec)
- Modify: `backend/src/database/data-source.ts`, `backend/src/instruments/instrument.entity.ts`

**Interfaces — Produces:**

```ts
// week.ts
export interface EtWeek { weekStart: string; weekEnd: string; today: string; days: string[] } // YYYY-MM-DD, days = Mon..Fri
export function etWeek(now: Date): EtWeek;
export function etDate(at: Date): string; // YYYY-MM-DD in America/New_York
// timing.ts
export type Timing = 'before_open' | 'during' | 'after_close' | 'unknown';
export function timingOf(at: Date | null): Timing;
export const TIMING_ORDER: Timing[]; // ['before_open','during','after_close','unknown']
```

- [ ] **Step 1: Tests first.**
  - `etWeek`: `2026-10-29T15:00:00Z` (Thu) → weekStart `2026-10-26`, weekEnd `2026-10-30`, today `2026-10-29`, 5 days; `2026-10-31T15:00:00Z` (Sat) → `2026-11-02`..`2026-11-06`; `2026-11-02T03:30:00Z` (Sun 22:30 ET after DST end) → `2026-11-02`..`2026-11-06`, today `2026-11-01`; `2026-10-27T03:30:00Z` (Mon 23:30 ET) → weekStart `2026-10-26`.
  - `etDate`: `2026-11-03T03:00:00Z` → `2026-11-02`.
  - `timingOf`: `2026-11-02T13:30:00Z` (08:30 EST) → before_open; `2026-10-29T12:30:00Z` (08:30 EDT) → before_open; `2026-11-02T21:00:00Z` (16:00 EST) → after_close; `2026-11-02T17:00:00Z` (12:00) → during; `2026-11-02T14:30:00Z` (09:30 EST) → during; null → unknown.
- [ ] **Step 2: Run → FAIL. Step 3: Implement** with `Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', ... })` (no new dependency). Weekday from the ET date; Sat/Sun roll to next Monday.
- [ ] **Step 4: Migration** adding the two columns (`ADD COLUMN IF NOT EXISTS`), with `down` dropping them; register after `AddHoldings1790035200000`. Entity: `nextEarningsAt?: Date | null` (`timestamptz`, nullable) and `nextEarningsEstimated: boolean` (default false). Keep `nextEarningsDate`/`earningsCheckedAt` mapped.
- [ ] **Step 5: Verify** unit + e2e (migration runs on `trader_test`). **Commit** `feat(earnings): ET week and timing helpers; next-earnings cache columns`

---

### Task 4: Earnings service and endpoint

**Files:** Create `backend/src/earnings/earnings.service.ts` (+ spec), `earnings.controller.ts`, `earnings.module.ts`, `backend/test/earnings.e2e-spec.ts`. Modify `app.module.ts`, `legacy-api-prefix.ts` (+ spec: add `/earnings`).

**Interfaces — Consumes:** `YahooClient.nextEarnings`, `HoldingsService.list()` (`{symbol,name,direction}[]`), `WatchlistService.list()` (`{symbol,name}[]`), `etWeek`, `etDate`, `timingOf`, `TIMING_ORDER`, Instrument repository.
**Produces:** `GET /earnings/week` →

```ts
interface EarningsWeek {
  weekStart: string; weekEnd: string; today: string;
  days: { date: string; entries: { symbol: string; source: 'holding' | 'watchlist'; timing: Timing; estimated: boolean }[] }[]; // always 5
  upcoming: { symbol: string; source: 'holding' | 'watchlist'; date: string | null; daysUntil: number | null; estimated: boolean }[];
}
```

`upcoming`: one row per symbol on either list (holding wins), `date = etDate(nextEarningsAt)` when `nextEarningsAt` is today-or-later (ET date ≥ today), else null; `daysUntil` = whole calendar days between `today` and `date` (0 = today), null without a date; sorted by `daysUntil` ascending, nulls last, ties by symbol. Add a pure `daysBetween(fromYmd, toYmd): number` to `week.ts` (Task 3) with tests across the DST change (`2026-10-31`→`2026-11-02` = 2).

Rules: symbols = holdings ∪ watchlist (holding wins). For each instrument, refresh when `earningsCheckedAt` ET date ≠ today, or `nextEarningsAt` is in the past; at most 5 Yahoo calls at once. On success store `nextEarningsAt`, `nextEarningsEstimated`, `nextEarningsDate = etDate(at)`, `earningsCheckedAt = now`; on null clear `nextEarningsAt` and set checked; on throw keep old values and still set `earningsCheckedAt = now`. Place an entry on `etDate(nextEarningsAt)` if that date is within the week's days. If every refresh attempted in this request threw and no instrument has a cached `nextEarningsAt`, respond 503 (`ServiceUnavailableException`).

- [ ] **Step 1: Unit tests** (service with mocked repo/yahoo/holdings/watchlist and an injected `now`): placement on the right day with timing; both-lists → once as holding; sort order within a day; cached-today → no Yahoo call; stale (checked yesterday) → refresh; one symbol throws → others shown, failed keeps old cache and `earningsCheckedAt` updated; all throw + nothing cached → throws ServiceUnavailableException; dates outside the week ignored; ETF null → absent.
- [ ] **Step 2: e2e** with `STUB_EARNINGS` set per test (restore after): holdings LMND (report Thu of the current week, computed from `etWeek(new Date())`, 12:30Z) + watchlist NVDA (Tue, 21:00Z, estimated) + AAPL on both lists → response has 5 days, LMND `before_open` holding, NVDA `after_close` watchlist estimated, AAPL once as holding; `upcoming` lists LMND, NVDA and AAPL with correct `daysUntil`, plus a watched QQQ (no stub earnings) with `date: null, daysUntil: null` last; empty lists → 5 empty days and `upcoming: []`; per-user isolation (second user sees only their own).
- [ ] **Step 3: Implement**; controller `@Controller('earnings')` `@Get('week')`; module imports `TypeOrmModule.forFeature([Instrument])`, `MarketDataModule`, `HoldingsModule`, `WatchlistModule`, `UsersModule`.
- [ ] **Step 4: Verify** backend unit + e2e + both tsc. **Commit** `feat(earnings): GET /earnings/week for holdings and watchlist`

---

### Task 5: Earnings tab

**Files:** Create `frontend/src/api/earnings.ts`, `frontend/src/routes/Earnings.tsx` (+ spec). Modify `frontend/src/main.tsx` (route `earnings`), `frontend/src/components/AppShell.tsx` (+ spec: links `Chat, Holdings, Watch, Earnings`), `e2e/navigation.spec.ts`, `e2e/earnings.spec.ts` (new), `backend/src/main.e2e.ts` (seed `STUB_EARNINGS` for browser tests: AMD before-open on Tuesday of the current week, SMCI after-close Thursday estimated — compute dates from `etWeek(new Date())`), docs (`docs/current-state.md`, `docs/api.md`).

UI (exact copy):
- Title `Earnings · {Mon d} – {Mon d}` (e.g. `Earnings · Nov 2 – Nov 6`), from `weekStart`/`weekEnd`.
- Segmented filter buttons `Both` | `Holdings` | `Watchlist` (aria-pressed); persisted with the existing `lib/persistentState` helper under key `trader.earnings.filter.v1`.
- Grid: `grid grid-cols-5 gap-1`; header cells `Mon 2`… ; today's column has an accent border. Each entry cell: ticker (`text-xs font-medium`, `~` prefix when estimated), then a line with timing icon (`☀` before_open, `🌙` after_close, `•` during, nothing for unknown) and `●` holding / `○` watchlist; `data-testid="earn-{SYMBOL}"`; cells must not overflow (`min-w-0`, `truncate` on the ticker).
- Legend under the grid: `☀ before open · 🌙 after close · ● holding · ○ watchlist · ~ estimated date`.
- Empty (after filter): `No earnings this week for your holdings or watchlist.` / `…for your holdings.` / `…for your watchlist.`
- Loading skeleton; error `Couldn't load earnings dates right now.`
- **Days-until list below the legend** (same filter): heading `Next earnings`; sort toggle `Soonest` | `A–Z` (aria-pressed), persisted under `trader.earnings.sort.v1`; rows `data-testid="next-{SYMBOL}"` showing ticker, `●`/`○`, date as `Nov 5` with `~` prefix when estimated, and days (`today`, `1 day`, `N days`); `—` in both columns when `date` is null. Soonest = backend order; A–Z = by symbol (display ordering only). Empty: `Nothing to show yet — add holdings or watch some tickers.` Specs: days wording (0/1/7), `—` for null, sort toggle changes order and persists, filter applies to the list.

- [ ] **Step 1: Specs first** (mocked `api`): title; filter hides watchlist entries on `Holdings` and holdings on `Watchlist`; estimated `~`; timing icons; empty message per filter; error message; filter persisted (re-render reads stored value).
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4:** `cd frontend && npx tsc -b && npm test && npx vite build`.
- [ ] **Step 5: Browser** `e2e/earnings.spec.ts`: sign up, add AMD to holdings and SMCI to watchlist via the API, open Earnings → both cells visible in their day columns; `Holdings` filter hides SMCI; no horizontal overflow (`scrollWidth <= innerWidth`); each `earn-*` cell's `scrollWidth <= clientWidth`. Navigation spec includes the Earnings tab. Run `npm run test:browser`.
- [ ] **Step 6: Commit** `feat(frontend): Earnings tab — this week's reports for holdings and watchlist`

---

### Task 6: Release (controller)

- [ ] Full verification (all suites + both tsc + browser).
- [ ] Set `LLM_MODEL=gemini-3.5-flash-lite` in `~/.config/trader-host/prod.env`.
- [ ] Push `main`; wait for `deploy-web`; rebuild Mac host at `origin/main`; confirm migration `AddNextEarnings1790121600000` applied on Neon.
- [ ] Live check as the dedicated test user (`~/.config/trader-host/test-user.env`): paste a holdings list (timing < 5 s), `watch` a few symbols, open Earnings at iPhone width and screenshot; send 16 quick chat messages to confirm the rate-limit error text; leave a small portfolio on the test user for future tests.

---

### Task 5b: Chat polish and long-only holdings (owner feedback 2026-10-29)

**Files:** Modify `backend/src/assistant/prompt.ts` (+ spec), `backend/src/assistant/assistant.service.ts` (+ spec) for the date, `frontend/src/routes/Chat.tsx` (+ spec), `e2e/chat.spec.ts` if it asserts the old prompt text.

**Interfaces — Consumes:** `etDate(at: Date): string` from `backend/src/earnings/week.ts` (Task 3).

- **Clear:** the reply card gets a `Clear` button (secondary, small, top-right next to Copy for prompts; top-right alone for other replies). Clearing removes the reply, resets copy state, and focuses the textarea.
- **Placeholder:** `Talk to Trader — “bought LMND”, “sold TSLA”, “watch NVDA”, or ask anything`.
- **Prompt holdings line:** symbols only: `My holdings: AMZN, AVGO, TSLA`; `none` when empty. Watchlist line unchanged.
- **Long-only holdings (owner: "I don't do shorts … assume always it's long"):** remove the direction concept from code. Backend: `HoldingsService.set(symbol, direction)` → `add(symbol): Promise<{ added: boolean; symbol: string }>` (validates via `findOrCreate`; `added: false` when already held); `find(symbol)` → `has(symbol): Promise<boolean>`; `list()` returns `{ symbol, name }[]`; the entity keeps mapping `direction` (column stays NOT NULL) but always writes `'LONG'` — no migration, nothing dropped. API: replace `PUT /holdings/:symbol {direction}` with `POST /holdings {symbol}` → `{ added, symbol }` (keep `GET /holdings`, `DELETE /holdings/:symbol`); remove `SetHoldingDto`, add `AddHoldingDto { symbol: string (1..12) }`. Assistant buy uses `has`/`add`; summary label `Added (long)` → `Added`. Earnings service consumes `list()` unchanged in shape except no `direction`. Frontend Holdings: one `Add` button (accent), no Long/Short text, no Flip; edit mode keeps Remove → confirm; `api/lists.ts` `setHolding` → `addHolding(symbol)` POSTing `{ symbol }`; `HoldingRow` without `direction`. Update every spec/e2e/browser test that referenced direction, Long/Short, Flip, `Add long`/`Add short` or `Added (long)` (holdings e2e, assistant e2e + unit, chat browser spec, navigation spec's add-buttons check → the single `Add` button, Holdings.spec). Docs (`docs/api.md`, `docs/current-state.md`, `AGENTS.md`): holdings are symbols only, always long.
- **Prompt date:** New York date, formatted `Date: Oct 28, 2026 (New York time)` — `buildPrompt` takes the ET `YYYY-MM-DD` (from `etDate(now)`) and formats it; spec covers the UTC-midnight case (`2026-10-29T00:30:00Z` → `Oct 28, 2026`).
- **Copy & open Gemini:** for prompt replies, a second button `Copy & open Gemini` that copies (same success/failure handling) and opens `https://gemini.google.com/app` in a new tab (`window.open(url, '_blank', 'noopener')`) — open after the copy promise settles, inside the same click handler.
- Tests: prompt.spec for the holdings line (list, empty) and the date; Chat.spec for Clear (removes reply, focuses input), the new placeholder, and Copy & open (clipboard called, `window.open` called with the URL).
- Commits: `feat(chat): clear button, accurate placeholder, cleaner prompt, copy & open Gemini` and `refactor: holdings are long-only symbols`

---

### Task 5c: Custom order for Holdings and Watchlist (owner: "I need the ability to determine the order — your call how")

Runs after Task 5b (holdings are long-only by then).

**Files:**
- Create: `backend/src/database/migrations/1790208000000-AddListPositions.ts`
- Modify: `backend/src/database/data-source.ts`, holdings and watchlist entity/service/controller/dto (+ specs and e2e), `backend/src/assistant/prompt.ts` callers (order already flows from `list()`), `frontend/src/api/lists.ts`, `frontend/src/routes/Holdings.tsx`, `frontend/src/routes/Watchlist.tsx` (+ specs), `e2e/` (one reorder browser test), docs (`docs/api.md`, `docs/current-state.md`). Add frontend dependency `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (`npm install -w frontend`).

**Behaviour:**
- Migration: `ALTER TABLE holdings ADD COLUMN IF NOT EXISTS position integer`; same for `watchlist_items`; backfill per user in alphabetical symbol order (`UPDATE … FROM (SELECT h.id, row_number() OVER (PARTITION BY h."userId" ORDER BY i.symbol) - 1 AS pos FROM holdings h JOIN instruments i ON i.id = h."instrumentId") …`); then `SET NOT NULL` and `DEFAULT 0`. `down` drops the columns. Nothing else changes.
- `list()` (both) orders by `position ASC`, ties by symbol. A newly added item gets `max(position) + 1` for that user.
- New endpoints: `PUT /holdings/order` and `PUT /watchlist/order`, body `{ symbols: string[] }` (1..500, strings). The service rewrites positions for that user in the given order; symbols not in the user's list → 400 `Unknown symbol in order: X`; user's symbols missing from the body keep their relative order and go after the listed ones. Declare the `order` route before `:symbol` routes. Returns the new list.
- Prompt and earnings `upcoming` "A–Z" are unaffected; the prompt's holdings and watchlist lines follow `list()` order.
- Frontend: in edit mode each row shows a drag handle (`≡`, `aria-label="Reorder {SYMBOL}"`, `touch-action: none`) using dnd-kit `SortableContext` with `PointerSensor` (activation distance 4px) and `TouchSensor` (delay 150ms, tolerance 5px) and `KeyboardSensor`. On drop: reorder locally (optimistic), `PUT …/order` with the full symbol list, invalidate the query; on failure revert and show the error text under the list. Outside edit mode no handles; rows render in server order.
- Tests: service unit (append position, reorder, unknown symbol 400, partial body); e2e (reorder persists, per-user isolation); frontend spec (handles only in edit mode; a simulated reorder via keyboard sensor calls the order endpoint with the new sequence; failure reverts); browser test at iPhone width dragging the last holding to the top and reloading to confirm the order stuck.
- Commit: `feat: drag to reorder holdings and watchlist`
