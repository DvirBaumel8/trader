# Trader

A portfolio and trading journal for one active trader. Mobile-first dark web app,
installable to the iPhone home screen, running locally.

## Required reading

These are **imported into context automatically** — not optional links. Read them
as part of this file.

@docs/product-brief.md
@docs/working-agreement.md

If the imports above did not resolve for any reason, open both files directly
before doing anything else. The short version, which must hold either way:

- **The owner is an active daily trader.** Value to him first; friends and a
  subscription second. That second goal is why the UI bar is a product bar.
- **Start slow, resist features, stay free.** No paid services while this serves
  one user.
- **Small testable slices with human checkpoints.** Never a batch of work handed
  over unverified. Never destructive commands against his real database.
- **Mobile is the primary device**, and honest numbers beat pretty ones.

## The core idea

**Seed the portfolio once. From then on, the diary maintains it.**

There is no separate "add transaction" screen. You write a journal entry about a
trade, and the portfolio updates as a consequence. This is the product's central
design decision — it collapses two features into one and makes the journal
self-sustaining. Preserve it.

## Stack

- **Backend**: NestJS 12 + TypeORM + PostgreSQL 18 (local Homebrew, no Docker)
- **Frontend**: React 19 + Vite 8 + Tailwind v4 + TanStack Query + React Router
- **Market data**: `yahoo-finance2` v4 (free, no API key)
- **Tests**: Vitest on both sides

## Running it

```bash
npm run dev          # both apps; backend :3000, frontend :5173
npm test             # backend unit + e2e, then frontend
npm run build        # production build of both
```

The dev server binds to `0.0.0.0` and Vite runs with `host: true`, so the phone on
the same Wi-Fi can load it. The frontend only ever calls **relative** `/api/...`
paths, which Vite proxies to the backend — so the identical build works from
`localhost` and from a LAN address. **Never hardcode a host in frontend code.**

## Deployment

Production runs on Cloudflare Pages (frontend) + Render (API) + Neon
(Postgres) — see `docs/DEPLOYMENT.md` for account setup, environment
variables, and the keep-warm/data-migration runbook. Local development is
unaffected; `main` deploys automatically on push.

## Invariants — do not break these

1. **Positions are derived, never stored.** `portfolio/derive.ts` computes them
   from the immutable transaction log. This is why they cannot drift out of sync
   with the journal.
2. **Transactions are only ever written through a journal entry.** Seeding obeys
   this too. One write path into the portfolio.
3. **Buys and sells are NOT cash flows.** Only deposits and withdrawals are. This
   is what will make the Phase 3 benchmark comparison honest — a deposit must
   never register as a gain.
4. **Cash may be negative.** That is margin, a legitimate state. Never block it,
   never warn about it.
5. **`yahoo.client.ts` is the only file allowed to import `yahoo-finance2`.**
   Swapping data providers should touch one file.
6. **Never show a stale price as if it were fresh.** On provider failure, serve
   the cached quote flagged `stale` and surface that in the UI.
7. **Price by session.** `select-price.ts` chooses pre-market, regular or
   after-hours based on Yahoo's `marketState`, so the portfolio is current
   outside regular hours. Extended-hours prints are thinner and can gap, so
   they are always labelled in the UI, never passed off as the close.

## Testing conventions

- **`derive.ts` is the highest-risk code in the repo** — a bug there produces
  plausible-looking wrong numbers. It is pure functions with no database and no
  network, covered by fixture-driven tests. Keep it that way.
- **Tests never touch the network.** No test may reach Yahoo, an LLM, or any
  other external system: stub the client instead. A suite that needs the
  internet fails on a plane, fails in CI without secrets, and fails randomly
  when a provider is slow — and a test that depends on a live market price is
  asserting something different every day. `test/global-setup.ts` already
  blanks `LLM_API_KEY` for this reason; `YahooClient` is stubbed with
  `overrideProvider`. NOTE: the e2e specs written before this rule still call
  Yahoo for real (they validate `NVDA` and expect a 404 for `ZZZZNOTREAL`);
  making them hermetic is tracked work, not a settled state.
- **e2e tests run against `trader_test`**, never `trader`. When verifying by hand
  with curl, use the test database or read-only calls — do not run seed/reset
  against the database the user's real portfolio lives in.

## Layout

```
backend/src/
  market-data/   Yahoo adapter + quote cache (in memory, 60s TTL, force-refreshable);
                 daily_closes backfill (OHLC + adjClose) for held instruments and benchmarks
  instruments/   ticker validation and storage
  journal/       journal entry, tag and stop-level entities; the only write path
                 into transactions and cash flows
  transactions/  transaction + cash flow entities
  portfolio/     derive.ts (pure), derive-trades.ts (pure), risk.ts (pure),
                 service, controller — including /portfolio/trades/:id
  performance/   series.ts (pure): valuation -> time-weighted return -> rebased series
frontend/src/
  api/           fetch wrapper over /api
  components/    formatters, display primitives, BenchmarkChart, TradeChart
  lib/           pure logic (sorting, draft persistence, candle/date scaling)
  routes/        Dashboard, Journal, TradeDetail, Seed, TickerProbe (dev only, not in nav)
```

## Reading the dev server's logs

`npm run dev` tees both processes to `logs/api.log` and `logs/web.log`
(git-ignored, overwritten each start). Read those rather than asking the
owner to copy something out of his terminal — a backend error he reports is
almost always already there, e.g. `grep -n "Gemini call attempt" logs/api.log`
for LLM failures. The files only exist once `npm run dev` has been started
since this was added.

## Do not run `nest build` while `npm run dev` is running

Both write `backend/dist`, and the build wipes it out from under the watcher,
crashing the backend with `Cannot find module dist/main`. It looks like an
application bug and is not. To typecheck without disturbing the dev server use
`npx tsc --noEmit -p tsconfig.json` from `backend/`. This has bitten twice.

## Mobile gotchas learned the hard way

- **The iOS decimal keypad has no minus key.** Never require a typed `-`; use an
  explicit toggle. This made margin and shorts unenterable once already.
- **iOS Safari discards backgrounded tabs.** Any multi-field form must persist its
  draft to `localStorage` (`lib/draftStorage.ts`) or users lose their work
  switching to their broker app.
- **Verify UI on the phone, not just via typecheck.** Several bugs existed only
  there.

## Phase status

- **Phase 1 — portfolio, live**: complete. Seed, derived positions, live pricing,
  cash and account value, sorting, manual refresh, PWA install.
- **Phase 2 — the diary**: complete. Trade, note and cash journal entries that
  are the only write path into the portfolio; tiered stops (fixed and
  percentage-trailing) captured at entry; setup/mistake tags; full edit and
  delete (retiring reset-and-re-seed as the correction tool); position detail;
  round-trip trades derived from the transaction log; a stats header (win
  rate, average dollar risk, expectancy in R); default-fee settings; and a
  fees tab with a per-period bar chart.
- **Phase 3 — vs the market**: complete. `daily_closes` backfill for held
  instruments plus SPY and QQQ; a time-weighted return series so deposits
  never register as gains; the three-line benchmark chart (you vs S&P 500 vs
  Nasdaq) with a range selector and delta chips, on the Portfolio tab.
- **Phase 4 — trade replay**: complete. `daily_closes` gained OHLC and the
  backfill window widened to give a month of context either side; a
  `GET /portfolio/trades/:id` endpoint serves one trade plus its bars, fills
  and stop levels; an annotated daily candle chart of a single trade
  (`lightweight-charts`, after a hand-rolled-SVG attempt was reversed on
  device) is reachable from the Journal's Trades tab and from a Portfolio
  position.

## Documentation map

Which file answers which question, and whether it loads on its own:

| File | Answers | Loaded |
|---|---|---|
| `CLAUDE.md` | How to work in this codebase | Automatically |
| `docs/product-brief.md` | Who it is for, why it exists, the principles | Imported above |
| `docs/working-agreement.md` | How work should proceed | Imported above |
| `docs/superpowers/specs/2026-08-28-trader-design.md` | What v1 is and the reasoning behind each decision | On demand |
| `docs/superpowers/plans/2026-08-28-trader-phase-1-portfolio.md` | Phase 1 task-by-task plan and its recorded deviations | On demand |
| `docs/trader-profile.md` | The owner's edge, setups, risk/exit rules — read by `backend/src/llm/` at runtime and fed into the AI summary prompt | On demand |
| `docs/superpowers/plans/2026-08-29-trader-phase-2-diary.md` | Phase 2 task-by-task plan and its recorded deviations | On demand |
| `docs/superpowers/plans/2026-08-31-trader-phase-3-benchmark.md` | Phase 3 task-by-task plan and its recorded deviations | On demand |
| `docs/superpowers/specs/2026-09-01-trade-replay-design.md` | What Phase 4 (trade replay) is and the reasoning behind each decision, including the mid-implementation reversal from a hand-rolled chart to `lightweight-charts` | On demand |
| `docs/superpowers/plans/2026-09-01-trader-phase-4-replay.md` | Phase 4 task-by-task plan and its recorded deviations | On demand |
| `docs/superpowers/specs/2026-09-03-stop-executions-design.md` | Why stop executions are recorded rather than inferred, the entry-anchored signed at-risk change, and the one-off historical backfill | On demand |
| `docs/superpowers/specs/2026-09-03-trade-idea-design.md` | The pre-trade opinion: what the app computes vs what the model may judge, and why proposing a stop is allowed where inventing a number is not | On demand |
| `docs/DEPLOYMENT.md` | How to deploy, and the account setup behind it | On demand |

The spec and plan documents above are deliberately **not** imported: they are
long, mostly historical, and only relevant when revisiting a decision or
writing the next phase. Read them when that is the task.

**Read a plan by section, never whole.** They are big: the Phase 2 plan alone is
~34k tokens and the five together are ~92k, so opening one in full spends a
third of a context window on a document you needed one task from. Find the task
with `grep -n '^## ' <plan>`, then read just it with `sed -n 'START,ENDp'`.

The same discipline applies to everything read mid-session, because context is
cumulative — whatever is read on an early turn is re-sent on every later one, so
cost is roughly tokens x turns remaining. In practice: `git diff --stat` before
any `git diff`, and then one file at a time; line ranges rather than whole files
for the big ones (`portfolio.service.ts` is ~9k tokens); verbose commands piped
through `tail` or `grep`; a single spec file rather than the whole suite while
iterating, with the full run saved for the checkpoint.

**When adding a new document**, decide which category it is in. If it changes how
work should be done or what the product is for, import it here. If it is
reference material for a specific task, add a row to this table and leave it on
demand. A document nobody is pointed at will not be read.

## Known shortcuts

- Schema changes go through TypeORM migrations
  (`backend/src/database/migrations/`), not `synchronize: true` — that
  stopped being safe once production runs against a persistent, shared
  Neon database. Run `npm run migration:run` after adding one, in both
  local `trader` and (per `docs/DEPLOYMENT.md`) production.
- No service worker, so no offline support. The manifest gives home-screen install.
- Reset-and-re-seed is no longer the only way to correct a position: Phase 2
  shipped full edit and delete on journal entries, which recomputes the
  derived portfolio. Do not build a separate position-editing UI — editing a
  journal entry is the one correction path.
