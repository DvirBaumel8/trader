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
- **Layout**: an npm-workspaces monorepo — the root `package.json` declares
  `backend` and `frontend` as workspaces, and root scripts delegate with
  `--prefix`. Install with `npm run install:all`, not a bare `npm install`,
  or a workspace's own dependencies can be missed (`pg-mem` was, and three
  files stopped typechecking).

## Running it

There are **two ways to run this**, and they are not interchangeable.

**Iterating — two processes, hot reload, the one to use while writing code:**

```bash
npm run start:dev --prefix backend   # nest watch, :3000
npm run dev --prefix frontend        # vite, :5173 — open THIS one
```

Vite runs with `host: true` and proxies `/api/*` to `localhost:3000`, so the
phone on the same Wi-Fi loads `http://<mac-lan-ip>:5173`.

**Production-shaped — one process, no hot reload:**

```bash
npm run dev     # builds the backend, then serves it AND frontend/dist on :3000
```

Root `npm run dev` is NOT the two-process dev server any more. It is
`build:backend && node backend/dist/main.js`, and `main.ts` serves
`frontend/dist` statically with an SPA fallback. Use it to check what
production will actually do; never expect a file save to show up.

```bash
npm test             # root: backend unit, then frontend — NOT e2e
npm run build        # production build of both
```

**`npm test` at the root does not run the e2e suite.** Root `test` delegates to
each workspace's `test`, and the backend's is `vitest run` (unit only). Run
`npm run test:e2e --prefix backend` separately. CI has the same gap.

**Never hardcode a host in frontend code.** `api/client.ts` builds every URL as
`VITE_API_BASE_URL + /api + path` — empty base in dev (so Vite's proxy handles
it), the Render origin in production.

### The `/api` prefix, and the allowlist behind it

Backend routes are served under a **global prefix of `/api`**
(`setGlobalPrefix('api')` in `main.ts`, with `health` and `health/ping`
excluded). Ahead of it sits a rewrite middleware that maps legacy unprefixed
paths onto it — and it works off a **hardcoded list** of route prefixes:
`portfolio`, `performance`, `journal`, `auth`, `ai`, `settings`,
`instruments`, `market-data`, `history`.

**Adding a controller with a new top-level path means adding it to that list**,
or unprefixed requests to it fall through to the SPA fallback and return
`index.html` with a 200 — which reads as a JSON parse error in the client, not
as a routing mistake. The e2e suite cannot catch this: it builds the app
through `Test.createTestingModule` and never runs `main.ts`.

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
5. **The frontend displays; the backend computes.** No business logic or
   money arithmetic in `frontend/`. Parsing input text, ordering rows for
   display, chart geometry and browser storage are display concerns and stay;
   anything that decides what a number *means* is the backend's. This is not
   theoretical: the frontend kept its own copy of the risk rule, it drifted
   from the real one twice, and the second drift reported $1,200 at risk on a
   plan actually worth $750. A stateless endpoint (`POST /portfolio/stop-risk`)
   serves the live figure instead. `docs/backlog.md` lists what has not moved
   yet. The same rule covers *vocabulary*: the entry/exit reason chips are
   defined in `journal/reasons.ts` and served on `GET /settings`, so the
   frontend renders a list it is handed and never keeps its own copy.

   The one deliberate exception is `lib/fillContext.ts`, which repeats the
   backend's "does this fill reduce a position?" sign test to choose which
   chips to show and what quantity to offer. The enforcing copy in
   `validateExitAttribution` stays authoritative; drift here shows the wrong
   chips, never a wrong number. Keep it that way — if it ever decides
   something a number depends on, move it.
6. **`yahoo.client.ts` is the only file allowed to import `yahoo-finance2`.**
   Swapping data providers should touch one file.
7. **Never show a stale price as if it were fresh.** On provider failure, serve
   the cached quote flagged `stale` and surface that in the UI.
8. **A stop revision is never zero rows.** `stop_levels` is append-only and a
   revision IS its rows, so an emptied plan is one tombstone row carrying
   `cleared`, not an absence. Writing zero rows leaves `revisionSeq`
   unadvanced and every reader taking `max(revisionSeq)` serves the PREVIOUS
   revision — a removed stop that stays live and stays priced into at-risk.
   `transactions/stop-revisions.ts` is the only code that picks a revision or
   tests the flag; nothing else should compute `max(revisionSeq)` itself.
   Clearing never touches revision 0, so risk-at-entry and R survive it.

9. **Every service resolves `usersService.currentUser()`, never
   `ensureDefaultUser()`.** The app is multi-user: the request's identity
   arrives through `users/user-context.ts` (AsyncLocalStorage, set by
   `UserContextMiddleware` before the guard runs) and `currentUser()` is the
   one place that reads it. A service calling `ensureDefaultUser()` serves
   the OWNER's data to whoever asked — a data leak that no type checker will
   catch, because both return a `User`. The two exceptions are deliberate and
   commented: `AuthService`'s shared-password path, which IS the owner, and
   `currentUser()`'s own fallback.

10. **Price by session.** `select-price.ts` chooses pre-market, regular or
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
  `overrideProvider`. **This is enforced, not just documented**:
  `test/offline-guard.ts` is a `setupFiles` entry in both vitest configs and
  throws on any connection to a non-localhost host, naming the host that was
  called. It must be `setupFiles` rather than `globalSetup` — the latter runs
  once in vitest's main process and specs run in workers that would never see
  it. (The frontend suite has no such guard yet.) Every e2e spec that boots
  `AppModule` overrides `YahooClient` with the shared `test/yahoo-stub.ts`
  — including a new one, or it silently starts
  calling Yahoo. The stub returns `null` from `quote` for anything beginning
  `ZZZZ`, which is what keeps the unknown-ticker 404s honest, and serves bars
  only when asked (`yahooStub({ withBars: true })`), so specs that insert their
  own `daily_closes` rows are not overwritten by volunteered history.
- **Measure coverage across BOTH suites, never one.** `npm run test:cov:all`
  (from `backend/`) runs unit and e2e, then merges the reports. Unit coverage
  alone reads ~59% and is misleading: `portfolio.service.ts` shows 0.5% while
  being exercised heavily by the e2e suite. Merged, the real figure is ~92% of
  lines. Chasing the unit-only number means writing duplicate tests for code
  that is already covered.
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
                 into transactions and cash flows. reasons.ts holds the entry/exit
                 reason vocabulary — the one definition, served on GET /settings
  transactions/  transaction + cash flow entities
  portfolio/     derive.ts (pure), derive-trades.ts (pure), risk.ts (pure),
                 service, controller — including /portfolio/trades/:id
  performance/   series.ts (pure): valuation -> time-weighted return -> rebased series
  llm/           AI summary, plus the trade review (context, prompt, parse, service)
  database/      migrations (registered by hand in data-source.ts), in-memory-db.ts
frontend/src/
  api/           client.ts (fetch wrapper, prefixes /api), settings.ts (shared query)
  components/    formatters, display primitives, BenchmarkChart, TradeChart,
                 EntrySheet (the composer), TradeReviewCard
  lib/           pure logic (sorting, draft persistence, candle/date scaling,
                 fillContext.ts: does this fill open or close a position?)
  routes/        Dashboard, Journal, TradeDetail, Seed, TickerProbe (dev only, not in nav)
```

## Reading the dev server's logs

The old root `npm run dev` teed both processes to `logs/api.log` and
`logs/web.log`. **The monorepo restructure removed that** — root `dev` is now
`build:backend && node backend/dist/main.js` and tees nothing. The files may
still exist on disk from an older run; check their timestamps before trusting
a line in them, because a stale log that looks current is worse than no log.

If a session needs them back, tee explicitly rather than assuming:

```bash
npm run start:dev --prefix backend 2>&1 | tee logs/api.log
```

The principle stands: read the logs rather than asking the owner to copy
something out of his terminal — a backend error he reports is almost always
already there, e.g. `grep -n "Gemini call attempt" logs/api.log` for LLM
failures.

## Do not run a build while a watcher is running

`nest build`, `npm run build`, and **root `npm run dev`** all write
`backend/dist`. Any of them run while `npm run start:dev --prefix backend` is
watching wipes `dist` out from under it, crashing the backend with `Cannot
find module dist/main`. It looks like an application bug and is not. This has
bitten twice, and root `npm run dev` is now a third way to do it — it *is* a
build.

To typecheck without disturbing anything, from `backend/`:

```bash
npx tsc --noEmit -p tsconfig.json         # everything, specs included
npx tsc -p tsconfig.build.json --noEmit   # exactly what the build compiles
```

**Both of those are `backend/` commands.** In `frontend/`, `tsconfig.json` is
a solution file — `"files": []` plus references to `tsconfig.app.json` and
`tsconfig.node.json` — so `tsc --noEmit -p tsconfig.json` there checks
**zero files and exits 0**. It looks like a clean typecheck and proves
nothing; it reported success over a component used without being imported.
From `frontend/`, use:

```bash
npx tsc -b            # follows the references — what `npm run build` runs
```

The second is the one that answers "will the deploy fail?" —
`tsconfig.build.json` excludes `**/*spec.ts`, so a type error in a spec fails
the first and not the second. That difference is live right now: four errors
in `llm.controller.spec.ts` and one in `trade-review.service.spec.ts` fail a
plain `tsc` while the build and both suites stay green.

## UI conventions — reuse before invention

The product bar is a **product** bar (see `product-brief.md`): this is meant to
be shared and eventually charged for, and inconsistent interaction is one of
the fastest ways an app reads as amateur. The invariants above protect the
numbers; these protect the feel.

**Before building a screen or a control, find the screen that already solves
the same problem and copy its interaction.** Introducing a second pattern for
the same job needs a stated reason. This is not a style preference — it is the
rule that was missing when the Ideas page invented its own row-level delete
and the AI summary list then copied Ideas, leaving three different answers to
"how do I remove a row".

The patterns, and the one implementation of each:

| Pattern | Use | Canonical |
|---|---|---|
| Reveal destructive controls | `components/ui/EditModeToggle.tsx` | Journal, Ideas, AiSummary |
| Long generated content | `components/ui/CollapsibleCard.tsx` | AiSummary, TradeReviewCard |
| Buttons | `components/ui/Button.tsx` — variants, never ad-hoc classes | everywhere |
| Text inputs | `components/ui/inputClasses.ts` | everywhere |
| Correcting a record | edit the journal entry; there is no second editor | `EntrySheet` |

**Any AI answer is collapsible, and collapsed means ONE header line.** All
four of them: the portfolio summary, the trade review, the watchlist opinion
and the trade idea. The idea card was missed in the very commit that wrote
this rule down — writing a convention is not applying it, so when a rule like
this lands, grep for the other places it already applies before claiming it
is done. A
model's answer runs to several hundred words and buries the rest of a phone
screen. Not "the prose is hidden but a verdict and a metrics grid remain" —
that is what the trade review did, and it was inches tall while claiming to
be minimised. Anything that must survive collapsing goes in the card's
`header`; everything else is `children`. It opens expanded: it was just asked
for.

**Destructive actions are never ambient.** A delete control does not sit
permanently on a row: the list is read-only until edit mode is switched on.
And delete is always **two taps** — a phone screen is exactly where a stray
tap costs something. Both halves matter; the confirm is not a substitute for
the mode.

**A convention that lives only in prose gets missed.** Where a pattern can be
a shared component, make it one — `EditModeToggle` and `CollapsibleCard` both
exist because the same markup copied a third time is what caused the bug.
Prefer the import over the paragraph.

### Look at it before handing it over

**Any change that alters what appears on screen gets opened in a real browser
by whoever made it, before it is called done.** Not the type checker, not the
test suite, not a screenshot from the owner — actual eyes on the actual
rendered thing.

This is not the same rule as "verify on the phone". That one is his, and it
stands. This one is the agent's: he should be confirming that a working thing
suits him, not discovering that it never rendered.

The cost of not doing it is measured. The trade-chart callouts were delivered
three times and were invisible all three: once because the label price sat
off the scale, once because coordinates were requested a frame before the
chart laid itself out, and finally because the library's canvases are
`z-index: 1` and `2` while the overlay was left at `auto` — it had been
rendering correctly, underneath the canvas, the whole time. Every unit test
passed through all three. Each round cost him a deploy and a screenshot.

**How, when there is no page to visit yet** — a component in isolation, or a
flow that needs data the dev database lacks:

1. Write a throwaway entry point in `frontend/` (`probe-x.html` plus a small
   `src/probe-x.tsx` that renders the component with fixture props).
2. The Vite dev server serves it at `/probe-x.html`. Open it with the Chrome
   tools and LOOK at it; `document.elementFromPoint` over an element that
   should be visible is what found the z-index bug in seconds after three
   rounds of guessing.
3. Check it at phone width too — set the wrapper to 390px and reload, because
   a resize and a load are different code paths.
4. Delete the probe files in the same commit that fixes the bug.

A pure unit test cannot see any of this. All three failures were in the seam
between our code and a third-party renderer, which is exactly where a test
double agrees with you and the browser does not.

### When a bug is found, four steps — not one

The owner's rule, and it is not optional. Fixing the symptom and moving on is
how the same defect gets shipped three times in different clothes.

1. **Fix it.**
2. **Cover it with a test** that fails without the fix, and whose name states
   the behaviour rather than the code.
3. **Stop. Post-mortem.** Why did this exist, and — separately, and more
   importantly — **why did the tests not find it?** A bug that passed a green
   suite is two failures: the defect, and the blind spot that hid it. Fix the
   blind spot as well.
4. **Sweep for the same shape elsewhere.** Where else does this pattern live?
   Fix those too. If the answer is "in several places", that is the signal to
   pull the logic into one place rather than patch each — the specific
   implementation becoming generic code.

Step 4 is the one that pays. Every miss in the table below was a second
instance of something already solved, and each was found by a person rather
than by the sweep that should have followed the first fix.

**Worked example — the history gap, and why it is in this file.**

*Fix:* the daily top-up fetched a fixed seven days back. Ten days away from
the app meant days eight to ten were never fetched — and never would be,
since every later top-up also reached back seven. A permanent hole, and every
average computed across it quietly wrong.

*Test:* `ensureFresh` had **no tests at all**. The spec file existed and
covered `ensurePriced` only, so the file looked tested while the path that
runs on every request in production was not. Coverage of a FILE is not
coverage of a BEHAVIOUR, and a spec file's existence is not evidence.

*Post-mortem:* one constant served two policies. `OVERLAP_DAYS = 7` was chosen
to re-fetch recently revised bars, then silently reused as the bound on how
far behind the history could be. The comment above it even said "rather than
only the missing ones" — the author had the second question in mind and
answered it with the first question's number.

*Sweep:* the same shape one level down. The first fix derived the window from
the newest stored bar — but the GLOBAL newest, across all instruments. One
symbol failing at the provider while the rest succeed leaves it behind, with
the database reporting itself current. A gap is a property of an instrument,
so the window is now computed per instrument, through one helper
(`catchUpFrom`) that carries the whole story.

### The shape of these misses

Three have now landed the same way, and the pattern is worth recognising
before writing the fourth:

| Solved once | Missed again in |
|---|---|
| Journal's edit-mode delete | Ideas, then AiSummary copied Ideas |
| AiSummary's collapsible answer | TradeReviewCard |
| Risk arithmetic on the backend | the frontend's own copy, twice |
| Verifying UI in a browser | the chart callouts, three deploys running |
| CollapsibleCard for AI answers | the Ideas card — missed while writing the rule |
| A fixed catch-up window | the same gap per-instrument, one fix later |

Every one is **a newer screen re-solving a problem an older screen had already
solved**, and every one degraded in the copy: the delete became permanent, the
collapse stopped collapsing, the risk figure drifted to $1,200 on a $750 plan.
None was caught by tests, because each re-implementation was internally
consistent and passed its own.

So the check before building a screen is not "does this work?" — it is
**"where else does this app already do this, and am I about to do it
differently?"** If the answer is a second implementation, that is the bug,
before a single line is wrong.

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

- **Since the phases** — shipped incrementally, not as a numbered phase:
  the trade review (an LLM read of one closed trade: `llm/trade-review-*`,
  `TradeReviewCard`), the monorepo restructure with static serving, and the
  composer's **fill context** — a closing fill prefills the quantity you hold
  and offers exit reason chips, an opening one offers entry chips.

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
| `docs/api.md` | What the running app exposes, and how to authenticate against it — the route map, which routes are public, and which ones write | On demand |

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
- **`InstrumentsModule` and `MarketDataModule` are circular, and that is
  accepted.** Four `forwardRef`s hold it together. The cycle is thin and
  domain-real: an instrument is named from a quote
  (`InstrumentsService.findOrCreate` → `MarketDataService.getQuote`), and
  `HistoryService.backfill` needs `findOrCreate` for exactly one reason —
  creating the SPY/QQQ rows on a first run, since every other symbol it
  backfills already exists as an instrument. Breaking it was considered and
  rejected: a second instrument-creation path would duplicate logic this
  repo has been bitten by duplicating before, and the alternatives cost a
  module restructure or a benchmark row with no name. Leave the
  `forwardRef`s; do not add new edges to the cycle.
